#!/usr/bin/env bash
# Arena sandbox shim for the coworld CLI: reading and uploading only.
# Anything that needs Docker/OrbStack, local game runs, or replay downloads is refused.
set -euo pipefail
real=/opt/coworld-tools/coworld/bin/coworld
cmd="${1:-}"
refuse() {
  echo "coworld ${cmd}: not available in the arena sandbox. $1" >&2
  exit 86
}
case "$cmd" in
  ""|-h|--help|help) exec "$real" "$@" ;;
  leagues|divisions|results|rounds|memberships|submissions|events|episodes|episode-stats|episode-results|docs|list|show|status|power-analysis|campaign|reporters)
    exec "$real" "$@" ;;
  episode-logs)
    for arg in "$@"; do case "$arg" in --download|--output|-o) refuse "Logs can be shown, not downloaded.";; esac; done
    exec "$real" "$@" ;;
  upload-policy)
    with_file=0
    for arg in "$@"; do [ "$arg" = "--file" ] && with_file=1; done
    [ "$with_file" = 1 ] || refuse "Only file policies can be uploaded here: coworld upload-policy --file hero.bas --name <policy>. Image uploads need Docker."
    exec "$real" "$@" ;;
  xp-request)
    case "${2:-}" in
      create|list|get|episodes|watch|""|-h|--help) exec "$real" "$@" ;;
      *) refuse "xp-request ${2:-}: only create, list, get, episodes, and watch are allowed; evidence and replay downloads are off." ;;
    esac ;;
  download|run-episode|scrimmage|play|replay|replays|replay-open|optimize|certify|build|deploy-audit|upload-coworld|patch-commissioner|retry-certification|hosted-game|images|next-version|manifest-schema)
    refuse "It needs Docker, a local game run, or a replay download. Read results with episodes, episode-stats, episode-results, and results instead." ;;
  submit|retire-membership)
    refuse "League entry goes through the enter_league tool so the student approves it in the chat." ;;
  *) refuse "Allowed: leagues, divisions, results, rounds, memberships, submissions, events, episodes, episode-stats, episode-results, episode-logs, docs, list, show, status, power-analysis, campaign, reporters, upload-policy --file, xp-request create|list|get|episodes|watch." ;;
esac
