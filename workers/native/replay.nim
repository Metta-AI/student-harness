## Release-pinned replay decoder. Build on the research host; replay-only.
import std/[json, strutils, os, tables, sets]
import game, sim, replays, content, scores, events

when not defined(replayEvents):
  {.error: "Replay diagnostics require -d:replayEvents".}

doAssert run.replayMode, "Audit worker only accepts recorded replays"

var maxWork, maxInstructions: array[10, int64]
var samples = newJArray()
var milestones = newJArray()
var milestoneCount = 0
var objectiveEvents = newJArray()
var objectiveEventCount = 0
var previousObjectiveHp = initTable[string, int32]()
var damagedObjectives = initHashSet[string]()
var objectiveIds = initHashSet[int32]()
let subject = parseInt(getEnv("AUDIT_SLOT", "0"))
doAssert subject >= 0 and subject < 10
var objectiveEffects = newJArray()
var subjectEvents = newJArray()
var objectiveEffectCount, subjectEventCount: int
let initialXp = run.world.heroes[subject].totalXp.int64
var awardedXp: int64
if not run.replayMode:
  startReplayRecording(uint32(options.maximumTicks))

proc objectiveRows(): JsonNode =
  result = newJArray()
  for b in run.world.buildings:
    result.add(%*{"id": b.id, "kind": $b.kind, "team": b.team.ord,
      "lane": b.lane, "tier": $b.tier, "guards_god": b.guardsGod,
      "hp": b.hp, "max_hp": b.maxHp,
      "x_tiles": b.position.x.float / WorldScale.float,
      "z_tiles": b.position.z.float / WorldScale.float})
  for f in run.world.forts:
    result.add(%*{"id": f.id, "kind": "fort", "team": f.team.ord,
      "hp": f.hp, "x_tiles": f.center.x.float / WorldScale.float,
      "z_tiles": f.center.z.float / WorldScale.float})

proc captureObjective(key, kind: string, id, hp: int32, team: int) =
  let before = previousObjectiveHp.getOrDefault(key, hp)
  let firstDamage = hp < before and key notin damagedObjectives
  if hp < before: damagedObjectives.incl(key)
  if firstDamage or (before > 0 and hp <= 0):
    inc objectiveEventCount
    if objectiveEvents.len < 2000:
      objectiveEvents.add(%*{"tick": run.world.tick, "battle_tick": run.world.battleTick,
        "id": id, "objective_kind": kind, "team": team,
        "kind": (if hp <= 0: "destroyed" else: "first_damage"),
        "first_damage": firstDamage, "hp_before": before, "hp_after": hp})
  previousObjectiveHp[key] = hp

proc captureObjectives() =
  for b in run.world.buildings:
    objectiveIds.incl(b.id)
    captureObjective("building:" & $b.id, $b.kind, b.id, b.hp, b.team.ord)
  for f in run.world.forts:
    objectiveIds.incl(f.id)
    captureObjective("fort:" & $f.id, "fort", f.id, f.hp, f.team.ord)

captureObjectives()

proc heroRows(): JsonNode =
  result = newJArray()
  for slot, hero in run.world.heroes:
    result.add(%*{"slot": slot, "team": hero.team.ord, "team_name": $hero.team,
      "class": hero.class.ord, "class_name": heroSpec(hero.class).name,
      "drafted": hero.drafted, "hp": hero.hp, "x": hero.position.x,
      "z": hero.position.z, "x_tiles": hero.position.x.float / WorldScale.float,
      "z_tiles": hero.position.z.float / WorldScale.float,
      "score": xpPerMinute(hero.totalXp.int, run.world.tick.int), "deaths": hero.deaths,
      "xp": hero.totalXp, "hits": hero.attacksLanded, "level": hero.level,
      "gold": hero.gold, "ranks": hero.abilityLevels, "inventory": hero.inventory,
      "item_counts": hero.itemCounts, "max_work": maxWork[slot],
      "max_instructions": maxInstructions[slot]})

proc eventRow(event: GameEvent, index: int): JsonNode =
  ## `related` indexes the engine's full current-tick buffer, not our filtered list.
  %*{"tick": event.tick, "battle_tick": run.world.battleTick,
    "event_index": index, "kind": $event.kind,
    "actor": event.actor, "target": event.target, "cause": $event.cause,
    "detail": event.detail, "amount": event.amount, "requested": event.requested,
    "before": event.before, "after": event.after, "related": event.related}

proc captureEffects() =
  for index, event in run.world.events:
    if event.kind == XpGained and event.target.player == subject:
      awardedXp += event.amount
    if event.kind in {Damage, Death} and event.target.id in objectiveIds:
      inc objectiveEffectCount
      if objectiveEffects.len < 10000:
        objectiveEffects.add(eventRow(event, index))
    if (event.kind == XpGained and event.target.player == subject) or
        (event.actor.player == subject and event.kind in
          {PortalStarted, PortalCompleted, PortalInterrupted, ItemConsumed, ItemPurchased}):
      inc subjectEventCount
      if subjectEvents.len < 4000:
        subjectEvents.add(eventRow(event, index))

while (if run.replayMode: run.world.tick < run.replayData.hashes.len
       else: not run.finished()):
  let beforeXp = run.world.heroes[subject].totalXp
  let beforeDeaths = run.world.heroes[subject].deaths
  let beforeHp = run.world.heroes[subject].hp
  advanceGame()
  captureEffects()
  captureObjectives()
  let after = run.world.heroes[subject]
  if after.deaths > beforeDeaths or after.totalXp - beforeXp >= 100:
    inc milestoneCount
    if milestones.len < 1000:
      milestones.add(%*{"tick": run.world.tick, "battle_tick": run.world.battleTick,
        "kind": (if after.deaths > beforeDeaths: "death" else: "xp_gain"),
        "xp_delta": after.totalXp - beforeXp, "hp_before": beforeHp,
        "gold": after.gold, "level": after.level, "deaths": after.deaths,
        "hp_after": after.hp, "x_tiles": after.position.x.float / WorldScale.float,
        "z_tiles": after.position.z.float / WorldScale.float,
        "inventory": after.inventory, "item_counts": after.itemCounts})
  if not run.replayMode:
    for slot, vm in run.heroVms:
      if vm.failed:
        raise newException(ValueError, "VM failed slot " & $slot & ": " & vm.lastError)
      maxWork[slot] = max(maxWork[slot], vm.lastWork)
      maxInstructions[slot] = max(maxInstructions[slot], vm.lastInstructions)
  if run.world.phase == Playing and run.world.battleTick mod 2400 == 0:
    samples.add(%*{"tick": run.world.tick, "battle_tick": run.world.battleTick,
      "fort_hp": [run.world.forts[0].hp, run.world.forts[1].hp], "heroes": heroRows(), "objectives": objectiveRows()})

let tape = if run.replayMode: run.replayData else: run.recorder.data
var commands: array[10, array[19, int]]
var itemActions = newJArray()
var itemActionCount = 0
for action in tape.actions:
  let slot = run.world.heroIndex(action.heroId)
  inc commands[slot][action.kind]
  if slot == subject and action.kind in {ActionBuyItem, ActionUseItem, ActionUseItemAt, ActionBuyback, ActionDraft}:
    inc itemActionCount
    if itemActions.len < 1000:
      let label = case action.kind
        of ActionBuyItem: "buy_item"
        of ActionUseItem: "use_item"
        of ActionUseItemAt: "use_item_at"
        of ActionBuyback: "buyback"
        else: "draft"
      itemActions.add(%*{"tick": action.tick, "kind": label, "slot": action.slot,
        "first": action.first, "second": action.second})
if run.replayMode:
  doAssert run.hashCheck.mismatches == 0
  doAssert run.replayPlayer.actionIndex == tape.actions.len
else:
  if options.recordPath.len > 0: saveRecording()
echo $(%*{"ticks": run.world.tick, "battle_ticks": run.world.battleTick,
  "draft_ticks": run.world.draftTicks, "seed": tape.config.seed,
  "winner": (if run.world.gameOver and not run.world.draw: run.world.winner.ord else: -1),
  "simultaneous_draw": run.world.draw, "fort_hp": [run.world.forts[0].hp, run.world.forts[1].hp],
  "actions": tape.actions.len, "hash_mismatches": run.hashCheck.mismatches,
  "state_hash": run.stateHash().toHex(16), "heroes": heroRows(),
  "objectives": objectiveRows(), "objective_events": objectiveEvents,
  "objective_event_count": objectiveEventCount, "objective_timeline_version": 1,
  "effect_timeline_version": 1,
  "objective_effects": objectiveEffects, "objective_effect_count": objectiveEffectCount,
  "subject_events": subjectEvents, "subject_event_count": subjectEventCount,
  "xp_reconciliation": {"initial": initialXp, "awarded": awardedXp,
    "final": run.world.heroes[subject].totalXp,
    "matched": initialXp + awardedXp == run.world.heroes[subject].totalXp.int64},
  "commands": commands, "samples": samples,
  "semantics": {"world_units_per_tile": WorldScale, "ticks_per_second": TickRate,
    "positions": "x/z are raw world units; x_tiles/z_tiles are arena tiles, not BASIC map coordinates",
    "ticks": "tick includes drafting; battle_tick starts at play",
    "actions": "Recorded commands, not inferred intent. Item-use slot/first fields follow the pinned replay format; commands alone do not establish damage or competitive causality.",
    "milestones": "Subject deaths and XP gains >= 100 in one tick; sparse observations, not a complete reward-event ledger",
    "objectives": "Omniscient replay state, not policy visibility. Samples/final state include buildings and forts; objective_events record first HP reduction and destruction.",
    "effects": "Pinned engine events: objective_effects attribute effective structure/fort damage and deaths; subject_events contain this subject's XP awards, portal lifecycle and item purchase/consumption. XP actor is the reward source, not necessarily this subject's kill. related refers to event_index in the complete same-tick engine buffer; its referenced event may be omitted here. Positions are raw world units. Damage attribution establishes an engine event, not the causal effect of a policy change. XP reconciliation sums all awards even if the retained ledger is truncated."},
  "subject": subject, "milestones": milestones, "milestone_count": milestoneCount,
  "item_actions": itemActions, "item_action_count": itemActionCount,
  "timeline_truncated": milestoneCount > milestones.len or itemActionCount > itemActions.len or objectiveEventCount > objectiveEvents.len or objectiveEffectCount > objectiveEffects.len or subjectEventCount > subjectEvents.len})
