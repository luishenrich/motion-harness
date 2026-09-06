#!/usr/bin/env bash
# Category 2: edit round trip on examples/mograph.
# Times, 3 runs each: `mh set`, `mh frame`, `mh check --scene hook`,
# a cold `mh render --format all` (after `mh clean --all`), and a warm one.
set -uo pipefail
cd "$(dirname "$0")/../.."   # repo root of the worktree

set -a
. /Users/luishenrich-bandis/VSCode/studypdf/apps/api/.env.local >/dev/null 2>&1
set +a

PROJ="examples/mograph"
LOGDIR="scripts/bench/logs"
mkdir -p "$LOGDIR"
RUNS=3

run_timed() {
  local name="$1"; shift
  for n in $(seq 1 "$RUNS"); do
    local logfile="$LOGDIR/${name}-run${n}.log"
    { /usr/bin/time -p "$@" ; echo "EXIT:$?"; } > "$logfile" 2>&1
    echo "  $name run $n -> $logfile"
  done
}

echo "=== mh set hook.line.size 110 (x$RUNS) ==="
run_timed "set" bun run src/cli.ts set hook.line.size 110 --project "$PROJ"

echo "=== mh frame hook.lineSettled --format all (x$RUNS) ==="
run_timed "frame" bun run src/cli.ts frame hook.lineSettled --format all --project "$PROJ"

echo "=== mh check --scene hook --format all (x$RUNS) ==="
run_timed "check-scene" bun run src/cli.ts check --scene hook --format all --project "$PROJ"

echo "=== cold mh render --format all (mh clean --all before each) (x$RUNS) ==="
for n in $(seq 1 "$RUNS"); do
  bun run src/cli.ts clean --all --project "$PROJ" > "$LOGDIR/clean-before-cold-render-run${n}.log" 2>&1
  logfile="$LOGDIR/render-cold-run${n}.log"
  { /usr/bin/time -p bun run src/cli.ts render --format all --force --project "$PROJ" ; echo "EXIT:$?"; } > "$logfile" 2>&1
  echo "  render cold run $n -> $logfile"
done

echo "=== warm mh render --format all (no clean, cache reused) (x$RUNS) ==="
run_timed "render-warm" bun run src/cli.ts render --format all --project "$PROJ"

echo "done"
