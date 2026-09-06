# Motion graphics as data, measured 2026-09-07

Summary a launch post could quote: on this machine, a brief becomes a checked, two-format
20 second motion graphics film in a minute or so, most of it one model call. Once the film
exists, a single value edit with its lint takes under 0.2 seconds, an agent can push about
340 of those edits a minute, a full two-format render from nothing takes 13 seconds and a
re-render after a picture-only change takes 0.8 seconds. The whole six-scene, two-format
example film is 532 lines and 11 KB of JSON; a hand-written Remotion equivalent of just two
of those six scenes, in one of the two formats, is already 293 lines and 11.4 KB, before
adding lint, events, probes, or the second format. 31 of the harness's 41 lint rules catch a
problem before a single frame is rendered. One real gap turned up while measuring this: a
model-authored color error that survives the automatic repair round is not caught again by
`mh check`, so it can ship silently. That is noted below, not hidden.

## Machine and versions

- MacBook Pro, Apple M4 Pro, 12 cores, 24 GB RAM, macOS 26.5 (build 25F71)
- Bun 1.3.3, ffmpeg 8.1, playwright-core 1.57.0
- remotion, @remotion/bundler, @remotion/renderer all pinned to 4.0.475
- Chromium used by both engines: chrome-headless-shell mac_arm-150.0.7871.24 (the Remotion
  headless shell, reused by the native engine too, per `mh doctor`)
- Repo: motion-harness, worktree `/Users/luishenrich-bandis/VSCode/mh-work/bench`, branch
  `night/bench`, on top of commit `d5c2ec1` (2026-09-06)
- Model for `mh new --mograph`'s script writing: Azure `DeepSeek-V4-Pro` (whatever the
  project's Azure deployment resolves to; picked by the harness, not chosen for this run)
- Every command below ran as `bun run src/cli.ts <cmd> --project <dir>` from the worktree
  root, with the Azure env exported first. Every timed number is wall clock from
  `/usr/bin/time -p` (the `real` line), not the CLI's own printed timer, except where a table
  says otherwise. Each measurement is 3 runs; tables report median and the min-max spread.
  Helper scripts live in `scripts/bench/` in this worktree; raw logs in `scripts/bench/logs/`.

## 1. Brief to checked film

`mh new /tmp/mh-bench-<n> --mograph --brief "<brief>" --seconds 20`, three different 20 second
product-spot briefs (Flowline, a task manager; Ledgerly, a budgeting app; Pulseform, a fitness
app), each run once end to end (model call, scaffold, `bun install` into the target dir,
`mh check --format all`). Script: `scripts/bench/run-brief-to-film.sh`, briefs in
`scripts/bench/briefs.txt`, logs `brief-to-film-run{1,2,3}.log`.

| metric | Flowline | Ledgerly | Pulseform | median | spread |
|---|---|---|---|---|---|
| total wall clock | 74.47s | 38.73s | 72.20s | 72.20s | 38.73-74.47s |
| model call (CLI-printed) | 50.8s | 19.7s | 48.6s | 48.6s | 19.7-50.8s |
| check phase (sum of `mh check` step times) | 23.3s | 18.8s | 23.3s | 23.3s | 18.8-23.3s |
| scaffold + bun install (derived: total - model - check) | 0.37s | 0.23s | 0.30s | 0.30s | 0.23-0.37s |
| scenes | 4 | 4 | 4 | 4 | 4-4 |
| layers | 13 | 10 | 11 | 11 | 10-13 |
| film.mograph.json bytes | 10582 | 7983 | 10035 | 10035 | 7983-10582 |
| film.mograph.json lines | 449 | 368 | 416 | 416 | 368-449 |
| lint errors, first draft | 3 | 0 | 1 | 1 | 0-3 |
| lint errors, after the repair round | 3 | 0 | 0 | 0 | 0-3 |
| warnings, `mh check`'s lint static+timeline step (post layout) | 0 | 0 | 0 | 0 | 0-0 |
| `mh check --format all` | pass | pass | pass | 3/3 pass | |

`bun install` into a fresh `/tmp` project (react, react-dom, typescript) cost well under half a
second every time; bun's global package cache already held these from the worktree's own
install, so this number does not include a cold network fetch.

Note on the repair round: for the Flowline brief the model invented three shape colors
(`stickyYellow`, `stickyPink`, `stickyGreen`) that are neither a design color nor a hex value.
`writeFilm`'s repair round asked the model to fix them, got back a film with the same three
errors, and accepted it anyway (the code keeps a fix whose error count is `<=` the original,
not strictly less). Those three invalid colors are still in the final `film.mograph.json`, and
`mh check --format all` passed cleanly regardless: the check pipeline's "lint static+timeline"
step (`lintStaticColors` + `lintTimeline`, source-file and timeline-rule checks) is not the same
lint as the mograph-specific per-layer color validator (`lintFilm`) that caught the problem the
first time. `lintFilm` only runs at `mh new` / `mh set` / `mh add` / `mh key` time, not inside
`mh check`. This is a real gap, found by running the benchmark rather than by reading the code:
an unresolved model color mistake can ship past a passing `mh check --format all`.

## 2. Edit round trip (examples/mograph)

On the shipped example (6 scenes, 660 frames per format, 22s at 30fps). Script:
`scripts/bench/run-edit-roundtrip.sh`; the film's `hook.line.size` was set to 110 and restored
to 104 (`git checkout --`) afterward, so the example ships unchanged.

| command | run 1 | run 2 | run 3 | median | spread |
|---|---|---|---|---|---|
| `mh set hook.line.size 110` (includes the lint) | 0.18s | 0.17s | 0.17s | 0.17s | 0.17-0.18s |
| `mh frame hook.lineSettled --format all` | 0.73s | 0.76s | 0.73s | 0.73s | 0.73-0.76s |
| `mh check --scene hook --format all` | 5.98s | 6.11s | 5.98s | 5.98s | 5.98-6.11s |
| `mh render --format all`, cold (after `mh clean --all`) | 13.43s | 13.01s | 13.44s | 13.43s | 13.01-13.44s |
| `mh render --format all`, warm (cache reused) | 0.80s | 0.79s | 0.80s | 0.80s | 0.79-0.80s |

The cold render is 1320 frames total (660 x 2 formats), about 98 frames/s; the warm render just
decodes 12 cached segments and re-concats, no frames re-rendered. `mh set` writes the file and
runs the full mograph lint in the same 0.17-0.18s; the single frame command spins up the native
engine (vite + one Playwright page) and renders 2 PNGs (wide, vertical) in under 0.8s including
that engine start.

## 3. Native engine vs Remotion, same example

`mh doctor --project examples/mograph --engine remotion` bundles and passes cleanly (bundled in
0.5-1.6s across runs), so the Remotion engine does render this example; both engines were then
compared. Script: `scripts/bench/run-engine-compare.sh`.

Full cold render, both formats, 1320 frames total (`mh render --format all --force`, cache
cleared before each run):

| engine | run 1 | run 2 | run 3 | median | frames/s at median |
|---|---|---|---|---|---|
| native | 12.61s | 13.51s | 13.41s | 13.41s | 98.4 f/s |
| remotion | 17.36s | 17.13s | 17.60s | 17.36s | 76.0 f/s |

Native is about 1.29x faster on the full render.

`mh frames --scene hook,stat,loop --dense 2 --format wide` (168 frames, one format, a fresh
`bun run src/cli.ts` process per run, no engine kept warm across runs):

| engine | run 1 | run 2 | run 3 | median | frames/s at median |
|---|---|---|---|---|---|
| native | 2.82s | 2.59s | 2.52s | 2.59s | 64.9 f/s |
| remotion | 16.65s | 16.53s | 14.76s | 16.53s | 10.2 f/s |

Native is about 6.4x faster here, a much bigger gap than the full render's 1.29x. The CLI's own
printed timer explains why: native printed "168 frames in 2.5s" against a 2.59s measured
process, but remotion printed "168 frames in 6.6s" against a 16.53s measured process, a ~10s
gap the printed timer does not show. As a cross-check, the shipped `mh bench --scene hook
--engines remotion,native` command (which keeps one engine and one browser warm across all of
its measurements in a single process) reported native check-frames at 17.8 f/s and remotion at
11.4 f/s, a 1.56x gap, in line with `docs/benchmark-2026-09-06.md`'s 1.5x. So: measured as an
agent actually calls `mh` (one fresh process per command, the normal check loop), remotion's
per-invocation cost dominates small commands far more than the shipped benchmark's warm,
one-process numbers suggest. Both numbers are real; they answer different questions. An agent
running many small `mh frames` / `mh check` calls against Remotion, each a fresh process, pays
this cold cost every time; `mh bench` and a single long-lived render do not.

## 4. Code size and effort proxy

`examples/mograph/film.mograph.json`, the whole film: 6 scenes, 15 layers, both formats (wide
and vertical, via per-layer `formats` overrides), design tokens, easings, defaults, audio.

| | lines | bytes |
|---|---|---|
| whole film.mograph.json (6 scenes, 2 formats) | 532 | 11023 |
| just the hook + speed scenes' JSON (both formats, extracted with `jq`) | 172 | 2947 |
| hand-written Remotion equivalent, hook + speed only, one format (wide) | 293 (251 non-blank/non-comment) | 11426 |

The hand-written file is `scripts/bench/hand-written/HookAndSpeedScenes.tsx`, plain Remotion API
(`AbsoluteFill`, `Sequence`, `interpolate`, `Easing`), not wired into any project, written to
match the two scenes' visible behavior: the headline's per-word rise-in stagger, the growing
rule line, the two-bar chart's staggered grow-in with a custom cubic-bezier ease and `0.00`
number formatting, and the fade-in note. It covers one format only. Comparing like for like:
172 lines of JSON (both formats) versus 293 lines of hand code (one format) for the same two
scenes; a real vertical layout in the hand-written file would need a second full set of
position/size constants or a format-conditional branch through every layer, roughly doubling it.
The whole six-scene, two-format film's JSON (532 lines) is about the same size as hand-written
React for a third of those scenes in half the formats (293 lines).

What the JSON gets for free that the hand-written file has to redo or skip:
- both formats from one set of `formats.vertical` overrides, no duplicated layout code
- 32 timeline events auto-derived from the 15 layers' `in`/`out` timing (`hook.lineIn`,
  `hook.lineSettled`, `hook.ruleIn`, ...), addressable by `mh frame` and `mh resolve`
- a probe window per layer for the DOM probe (12 across the film's 6 scenes, see section 6),
  wired through `data-probe` / `data-mg` attributes the runtime already emits
- 31 lint rules that run on the JSON with no render (color/easing/preset validity, an `in` past
  the scene end, a stagger that runs past the scene, text that will not hold long enough to
  read, missing image files, duplicate ids, scene/event integrity)
- `mh set` / `mh key` / `mh layout` / `mh add` / `mh edit` all operate on the same file with no
  extra code; a hand-written component has no equivalent surface without building one
- a receipt of every edit (see section 5)
- the film compiles into the same timeline the harness already checks, renders, diffs and
  reviews; the hand-written component has none of that until someone builds it

## 5. Editing without rendering

Three loops of 20 `mh set hook.line.size <104|105>` calls each (alternating the value so every
call does real work, not a no-op), on `examples/mograph`, timed with `date +%s.%N` around the
loop; restored to 104 afterward. Script: `scripts/bench/run-set-loop.sh`.

| loop | 20 calls, wall clock | edits/minute |
|---|---|---|
| 1 | 3.489s | 343.9 |
| 2 | 3.625s | 331.1 |
| 3 | 3.539s | 339.1 |
| median | 3.539s | 339.1 |
| spread | 3.489-3.625s | 331.1-343.9 |

About 340 lint-checked edits a minute from a script driving the CLI directly (no model call, no
render, no browser). Each `mh set` writes one receipt: 625 bytes of JSON (command, args,
before/after via the log line, output file with its sha1, source hash, engine, elapsed ms).
One thing this loop surfaced: receipt filenames are stamped to the second
(`<stamp>-set.json`). At the loop's ~5.6 calls/second, most calls in the same wall-clock second
overwrite the previous receipt: 61 total `mh set` calls (60 loop calls plus the final restore)
left only 12 distinct receipt files on disk. Receipts are a complete audit trail at human
editing speed; at automated-loop speed they are not, unless the caller slows down or the
receipt naming gets sub-second resolution.

## 6. Other measurable differences

- 6 of the 6 example scenes have at least one probe window (12 probe windows total across the
  film's 15 layers; the 2 shape-only layers, `hook.rule` and `cmd.ring`, are excluded from
  probes by design but still contribute timeline events). This costs the film author nothing:
  every non-shape layer becomes a probe window automatically unless it sets `probe: false`.
- 32 timeline events are derived from the 15 layers across 6 scenes (`<id>In`, `<id>Settled`,
  and `<id>Out` where the layer has an `out`), an average of about 2.1 events per layer, all
  named and addressable without the film author writing any of them.
- 41 distinct lint rule identifiers exist in the harness; 31 of them run with no render at all:
  23 in the mograph-specific per-layer validator (`lintFilm`, run on every `mh new` / `mh set` /
  `mh add` / `mh key`) plus 8 in the static-source and timeline-rule checks that open
  `mh check`. The other 10 (contrast, wrap, overflow, collision, safe-zone, the probe-presence
  checks, format parity) need a rendered frame and the DOM probe. So more than three quarters of
  the lint surface catches a problem before a single pixel is drawn, which is also why the
  Flowline color bug in section 1 is notable: it fell through the one lint path (`lintFilm`)
  that would have caught it, because that path does not run again inside `mh check`.

## What this does not measure, and where the comparison is unfair

- Everything ran on one machine, one time of day, against one Azure deployment for the model
  calls. Model call time (19.7-50.8s across three briefs) is the least reproducible number in
  this document; a different model, a different provider, or a busier deployment would move it
  independent of anything the harness does.
- Section 1 is 3 runs, one brief each, not 3 runs of the same brief; some of the spread (scenes,
  layers, lint errors) is brief-to-brief model variance, not measurement noise. The three briefs
  were deliberately similar in shape (a 20s product spot, a before/after story, a named product)
  to make the comparison meaningful at all.
- Section 3's "6.4x" and the cross-check's "1.56x" are both real measurements of the same two
  engines on the same scene; they differ because they measure different things (cold
  per-invocation cost vs warm in-process cost). Neither number alone is "the" native/Remotion
  ratio; an agent's actual experience depends on how many separate `mh` processes its check loop
  spawns.
- Section 4's hand-written file is one person's (in this case one model's) idea of how a
  competent developer would write these two scenes by hand. A more terse or more abstracted
  hand-written version could be shorter; the point is not the exact line count but that it does
  not include a second format, lint, events, probes, or any of the editing surface the JSON
  file gets from the shared runtime for free, and that adding those would grow it, not shrink
  it.
- None of this measures render quality, only speed, size, and pass/fail. Pixel parity between
  engines was already measured in `docs/benchmark-2026-09-06.md` (byte-identical static frames,
  under 0.1% pixel difference on frames with text in motion) and was not re-checked here.
- Receipt collision (section 5) was observed at one loop speed (~5.6 calls/s) on one machine; it
  is a property of second-resolution timestamps, not of this machine specifically, but the exact
  collision rate would differ at a different call rate.
- `mh edit` (the browser editor) and `mh review` (the human feedback loop) were not measured;
  both are part of the "editing as data" story but are interactive, not scriptable the way the
  rest of this benchmark is.
