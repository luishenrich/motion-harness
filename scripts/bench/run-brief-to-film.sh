#!/usr/bin/env bash
# Category 1: brief to checked film. Runs `mh new --mograph` three times with
# three different briefs, capturing full logs under scripts/bench/logs/.
set -uo pipefail
cd "$(dirname "$0")/../.."   # repo root of the worktree

set -a
. /Users/luishenrich-bandis/VSCode/studypdf/apps/api/.env.local >/dev/null 2>&1
set +a

LOGDIR="scripts/bench/logs"
mkdir -p "$LOGDIR"

briefs_file="scripts/bench/briefs.txt"
i=0
while IFS= read -r brief; do
  i=$((i + 1))
  [ -z "$brief" ] && continue
  target="/tmp/mh-bench-$i"
  rm -rf "$target"
  echo "=== run $i: $target ==="
  logfile="$LOGDIR/brief-to-film-run$i.log"
  { /usr/bin/time -p bun run src/cli.ts new "$target" --mograph --brief "$brief" --seconds 20 ; echo "EXIT:$?"; } > "$logfile" 2>&1
  echo "  -> $logfile"
done < "$briefs_file"
