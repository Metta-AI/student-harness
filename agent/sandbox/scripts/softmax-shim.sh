#!/usr/bin/env bash
# Arena sandbox shim for the softmax CLI: documentation and auth status only.
set -euo pipefail
real=/opt/coworld-tools/coworld/bin/softmax
case "${1:-}" in
  ""|-h|--help|help|docs|status) exec "$real" "$@" ;;
  *) echo "softmax ${1}: not available in the arena sandbox. The student is already signed in; use softmax docs, softmax status, or the coworld read commands." >&2; exit 86 ;;
esac
