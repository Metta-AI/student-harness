## Compile only on the dedicated research VM. Never advances a game tick.
import std/[json, os]
include bots

let source = readFile(getEnv("AUDIT_SOURCE"))
try:
  let structured = usesStructures(source)
  let limits = if structured: structureLimits(neuralLimits()) else: neuralLimits()
  discard compile(if structured: StructureSource & "\n" & source else: source,
    initHeroHost(0), limits)
  echo $(%*{"valid": true, "max_globals": limits.maxGlobals})
except CatchableError as error:
  echo $(%*{"valid": false, "error": error.msg})
