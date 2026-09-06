#!/usr/bin/env bash
# Category 3: native vs remotion engine on the mograph example.
# doctor on remotion first, then cold full render on both engines,
# then `mh frames --scene hook,stat,loop --dense 2` on both engines, 3 runs each.
set -uo pipefail
cd "$(dirname "$0")/../.."   # repo root of the worktree

set -a
. /Users/luishenrich-bandis/VSCode/studypdf/apps/api/.env.local >/dev/null 2>&1
set +a

PROJ="examples/mograph"
LOGDIR="scripts/bench/logs"
mkdir -p "$LOGDIR"
RUNS=3

echo "=== doctor --engine remotion ==="
bun run src/cli.ts doctor --project "$PROJ" --engine remotion > "$LOGDIR/doctor-remotion.log" 2>&1
cat "$LOGDIR/doctor-remotion.log"

run_timed() {
  local name="$1"; shift
  for n in $(seq 1 "$RUNS"); do
    local logfile="$LOGDIR/${name}-run${n}.log"
    { /usr/bin/time -p "$@" ; echo "EXIT:$?"; } > "$logfile" 2>&1
    echo "  $name run $n -> $logfile"
  done
}

for engine in native remotion; do
  echo "=== cold render --engine $engine (clean before each) (x$RUNS) ==="
  for n in $(seq 1 "$RUNS"); do
    bun run src/cli.ts clean --all --project "$PROJ" > "$LOGDIR/clean-before-render-${engine}-run${n}.log" 2>&1
    logfile="$LOGDIR/render-${engine}-run${n}.log"
    { /usr/bin/time -p bun run src/cli.ts render --format all --force --project "$PROJ" --engine "$engine" ; echo "EXIT:$?"; } > "$logfile" 2>&1
    echo "  render $engine run $n -> $logfile"
  done
done

for engine in native remotion; do
  echo "=== mh frames --scene hook,stat,loop --dense 2 --engine $engine (x$RUNS) ==="
  run_timed "frames-dense-${engine}" bun run src/cli.ts frames --scene hook,stat,loop --dense 2 --format wide --project "$PROJ" --engine "$engine"
done

echo "done"
