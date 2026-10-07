## Adapted from the supplied GoTA reference session VM audit.
import std/[json, os, strutils]
import game
include bots

when defined(candidateProbe):
  import std/deques
  var diagnosticEvents = initDeque[JsonNode]()
  var diagnosticEventCount = 0
  var diagnosticTextTruncated = false

  proc diagnosticOutput(): JsonNode =
    var events = newJArray()
    for event in diagnosticEvents: events.add(event)
    %*{"events": events, "event_count": diagnosticEventCount,
      "truncated": diagnosticEventCount > diagnosticEvents.len or diagnosticTextTruncated,
      "note": "Policy-authored PRINT events, retaining the last 256 events. Labels are not independently verified. Instrumentation changes source and consumes normal VM work/output limits; matching world hashes checks behavior only over the validated prefix. Printed requests do not prove acceptance or damage."}

proc applyRecorded(world: World, action: ReplayAction): bool {.discardable.} =
  ## Applies one recorded bot command without requiring its private VM.
  case action.kind
  of ActionWalkTo:
    applyWalkTo(world, action.heroId, action.first, action.second, action.offset)
  of ActionAttackMove:
    applyAttackMove(
      world, action.heroId, action.first, action.second, action.offset
    )
  of ActionAttackTarget:
    applyAttackTarget(world, action.heroId, action.first)
  of ActionBuyItem:
    applyBuyItem(world, action.heroId, action.first)
  of ActionBuyback:
    applyBuyback(world, action.heroId)
  of ActionUseItem:
    applyUseItem(world, action.heroId, action.first)
  of ActionUseItemAt:
    applyUseItemAt(world, action.heroId, action.slot,
      action.first, action.second, action.offset)
  of ActionCastTarget:
    applyCastTarget(world, action.heroId,
      action.slot, action.first)
  of ActionCastPoint:
    applyCastPoint(world, action.heroId,
      action.slot, action.first, action.second, action.offset)
  of ActionLevelAbility:
    applyLevelAbility(world, action.heroId, action.slot)
  of ActionDraft:
    applyDraft(world, action.heroId, action.first)
  else:
    raise newException(ReplayError, "replay action kind is invalid")

# Compile against the exact hosted GoTA source with --path:examples/gods_of_the_arena.
# The VM executes the submitted source; rivals replay recorded commands only for
# hash verification, never for estimating competitive outcomes.
doAssert game.run.replayMode
let tape = game.run.replayData
let subject = parseInt(getEnv("AUDIT_SLOT"))
doAssert subject >= 0 and subject < 10
game.run.loadBots([BotGroup(path: getEnv("AUDIT_SOURCE"), count: 10)])
for i in 0..<10:
  if i != subject: game.run.heroVms[i] = nil
when defined(candidateProbe):
  game.run.heroVms[subject].output = proc(event: PrintEvent) =
    inc diagnosticEventCount
    var entry = %*{"tick": game.run.world.tick,
      "battle_tick": game.run.world.battleTick, "kind": $event.kind}
    case event.kind
    of TextPrint:
      var kept = min(event.text.len, 256)
      if kept < event.text.len:
        diagnosticTextTruncated = true
        while kept > 0 and (ord(event.text[kept]) and 0xc0) == 0x80:
          dec kept
      entry["text"] = %event.text[0..<kept]
    of ValuePrint: entry["value"] = %event.value
    of FixedPrint: entry["value"] = %($event.fixedValue)
    of NewlinePrint: discard
    if diagnosticEvents.len == 256: discard diagnosticEvents.popFirst()
    diagnosticEvents.addLast(entry)
var index, validated: int
game.run.historyPlayback = false
while game.run.world.tick < tape.hashes.len:
  tickWorld(game.run, proc() =
    let w = game.run.world
    var perSlot: array[10, seq[ReplayAction]]
    while index < tape.actions.len and tape.actions[index].tick == uint32(w.tick):
      let a = tape.actions[index]
      perSlot[w.heroIndex(a.heroId)].add(a)
      inc index
    let drafting = w.phase == Drafting
    let drafter = if drafting: w.heroIndex(w.draftHeroId()) else: -1
    for offset in 0..<10:
      let slot = if drafting: offset else: (w.heroTurnStart + offset) mod 10
      if slot == subject:
        if not drafting or drafter == subject:
          runHeroScript(game.run, subject)
          doAssert not game.run.heroVms[subject].failed, game.run.heroVms[subject].lastError
      else:
        for a in perSlot[slot]: discard applyRecorded(w, a)
    if not drafting: w.heroTurnStart = (w.heroTurnStart + 1) mod 10
  )
  if game.run.stateHash() != tape.hashes[game.run.world.tick - 1]:
    when defined(candidateProbe):
      # Stop immediately: recorded rivals are no longer a valid counterfactual
      # after this point. This receipt diagnoses activation, never performance.
      echo $(%*{"validated_hashes": validated, "subject": subject,
        "first_divergence_tick": game.run.world.tick,
        "battle_tick": game.run.world.battleTick,
        "diagnostic_output": diagnosticOutput()})
      quit(0)
    else:
      doAssert false, "VM replay mismatch at " & $game.run.world.tick
  inc validated
when defined(candidateProbe):
  echo $(%*{"validated_hashes": validated, "subject": subject,
    "first_divergence_tick": newJNull(),
    "diagnostic_output": diagnosticOutput()})
else:
  echo $(%*{"validated_hashes": validated, "subject": subject})
