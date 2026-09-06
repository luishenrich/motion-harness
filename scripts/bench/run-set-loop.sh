#!/usr/bin/env bash
# Category 5: editing without rendering. Loop 20 `mh set` calls (alternating
# a value so each call does real work, not a no-op) on examples/mograph,
# three separate loops, timed. Restores the original value at the end.
set -uo pipefail
cd "$(dirname "$0")/../.."   # repo root of the worktree

PROJ="examples/mograph"
LOGDIR="scripts/bench/logs"
mkdir -p "$LOGDIR"

bun run src/cli.ts clean --all --project "$PROJ" > /dev/null 2>&1

for loop in 1 2 3; do
  logfile="$LOGDIR/set-loop-${loop}.log"
  echo "=== set loop $loop (20 calls) ===" | tee "$logfile"
  t0=$(date +%s.%N)
  for i in $(seq 1 20); do
    val=$((104 + (i % 2)))   # alternates 104/105 so every call changes the value
    bun run src/cli.ts set hook.line.size "$val" --project "$PROJ" >> "$logfile" 2>&1
  done
  t1=$(date +%s.%N)
  elapsed=$(echo "$t1 - $t0" | bc)
  echo "loop $loop: 20 calls in ${elapsed}s" | tee -a "$logfile"
done

# restore the original value
bun run src/cli.ts set hook.line.size 104 --project "$PROJ" > "$LOGDIR/set-loop-restore.log" 2>&1
git checkout -- "$PROJ/film.mograph.json"
git status --porcelain "$PROJ/film.mograph.json"
echo "restored"

echo "=== receipts written by the set command ==="
find "$PROJ/.harness/receipts" -name "*-set.json" -exec ls -la {} \; | tee "$LOGDIR/set-receipts-listing.log"
echo "sample receipt content:"
find "$PROJ/.harness/receipts" -name "*-set.json" | head -1 | xargs cat
