# Motion graphics as data: native engine vs Remotion engine parity

Verifies that `examples/mograph` (the pure-data motion graphics film, film.mograph.json
drawn by src/mograph/runtime.tsx) renders the same under the Remotion engine as under the
harness's own native engine. Run from the worktree `/Users/luishenrich-bandis/VSCode/mh-work/parity`
(branch `night/parity`) against the checked-in example, no source under `src/` touched.

Environment: macOS (Darwin 25.5.0, arm64), Bun 1.3.3, ffmpeg 8.1, remotion@4.0.475,
@remotion/bundler@4.0.475, @remotion/renderer@4.0.475 (from this worktree's node_modules,
a symlink to the main repo's). Chrome for both engines resolves to the same binary: the
Remotion-managed `chrome-headless-shell` under `node_modules/.remotion` (`mh doctor` and
the native engine's own boot log both name it).

## Method

1. `mh doctor --project examples/mograph --engine remotion` — does the project bundle under
   Remotion's webpack pipeline at all.
2. `mh frames --project examples/mograph --scene hook,stat,loop,speed,cmd,end --engine
   native --tag native` and the same with `--engine remotion --tag remotion`, then
   `mh diff native remotion --project examples/mograph`. Repeated once more in isolation
   (`--scene hook` only, tags `native2`/`remotion2`) to check whether the result is
   reproducible or a one-off artifact of render order.
3. Full film, both formats, both engines: `mh render --project examples/mograph --format all
   --engine <native|remotion> --out-dir /tmp/mh-parity-out/<engine>`. Compared with
   `ffprobe` (duration, size, bitrate, pixel format, frame types) and by extracting frames
   at matching timestamps with ffmpeg and diffing them.
4. Grepped every `from "remotion"` import reachable from the mograph runtime and checked
   each export against the shim (`src/engine/shim/remotion.tsx`).
5. Checked DOM-level layout parity with `mh probe <ref> --mode text --json` against both
   engines at a frame where the pixel diff was largest, to separate "the browsers laid this
   out differently" from "the browsers painted it differently."

`mh diff`'s built-in comparison downscales 2x before diffing (fine for scanning many
frames for a review). Where an exact number mattered here, frames were also compared at
full resolution with `scripts/parity/pixel-diff.ts` (added by this audit) and cross-checked
against `mh diff`'s output; the two agree everywhere they were compared against each other.
`scripts/parity/compare-video-frames.ts` does the same for two mp4s at given timestamps
(ffmpeg extract + full-res diff).

## Results

### 1. Bundling under Remotion

No fix needed. `mh doctor --project examples/mograph --engine remotion` bundles clean in
1.6s and reports "doctor: all clear". This was worth checking because
`examples/mograph/src/Root.tsx` and `examples/mograph/src/timeline.ts` import the mograph
runtime and schema from outside the project directory with explicit `.tsx`/`.ts`
extensions (`"../../../src/mograph/runtime.tsx"`, `"../../../src/mograph/schema.ts"`,
`"../../../src/mograph/timeline.ts"`), and `timeline.ts` does a bare JSON import
(`import raw from "../film.mograph.json"`) — all three are exactly the kind of thing that
can trip up a bundler's root/rootDir assumptions or its module resolution. `@remotion/bundler`'s
webpack config resolves the literal file path before falling back to extension-probing, so
files with the extension already in the specifier resolve directly, and webpack's default
JSON handling covers the raw import. Nothing in `examples/mograph/{tsconfig.json,
harness.config.ts}` needed to change, and no `webpackOverride` was added.

### 2. Check frames, `hook,stat,loop,speed,cmd,end`, wide format

First run (all six scenes rendered together, tags `native`/`remotion`):

| scene | frames | touched (>=0.2% px) | worst frame | mean of touched |
|---|---|---|---|---|
| hook  | 34 | 29/34 | 3.1% (hook+48, f48)  | 2.2% |
| stat  | 36 | 34/36 | 2.7% (stat+22, f118) | 2.5% |
| loop  | 31 | 17/31 | 2.2% (loop+30, f222) | 1.0% |
| speed | 38 | 0/38  | 0.0% | — |
| cmd   | 28 | 0/28  | 0.0% | — |
| end   | 38 | 0/38  | 0.0% | — |

205 common frames, 80 "changed" at the CLI's default >=0.2%-of-pixels threshold, all of
them in hook/stat/loop; 125 frames are pixel-identical. Full-resolution numbers (via
`pixel-diff.ts`) for the three worst frames:

| frame | max channel delta | mean delta (all px) | pixels differing | mean delta (differing px) | bbox |
|---|---|---|---|---|---|
| hook+48 | 224/255 | 5.85/255 | 66,747 (3.22%) | 181.67/255 | x223-1692 y405-606 |
| stat+22 | 224/255 | 4.94/255 | 57,936 (2.79%) | 176.90/255 | (matches `mh diff`'s box) |
| loop+30 | 224/255 | 2.36/255 | 37,849 (1.83%) | 129.45/255 | (matches `mh diff`'s box) |

Second run, hook alone in isolation (tags `native2`/`remotion2`, otherwise identical
command): 34 frames, only 7 touched (hook+8 through hook+22), worst 1.5% (hook+22), and
**every frame from hook+24 onward is bit-identical** (max channel delta 0/255, confirmed
at full resolution) — including hook+48, which was the single worst frame (3.1%) in the
six-scene run. Diff images: `examples/mograph/.harness/frames/spot-wide/remotion/diff-vs-native/diff-f000{48,52,56,58,60}.png`
(first run) and `.../remotion2/diff-vs-native2/diff-f000{08,10,12,16,18,20,22}.png`
(isolated run).

**Reading this**: the divergence is not tied to a scene or a layer type. It is a
transient that appears only in the first few dozen frames rendered by a freshly-launched
engine (its length varies with how many frames precede it in that particular run — 22
frames deep into "hook alone", but persisting until frame 87 of "hook" when five more
scenes' worth of frames follow it in the same run), and it converges to **exactly**
bit-identical pixels for the rest of the render, every time. Every frame at or after the
scene where each run's transient ends was checked at full resolution and found to have
`max channel delta: 0/255` — not "close", identical.

To rule out a text-layout bug (wrong font, wrong metrics, wrong word-wrap) rather than a
paint-only difference, `mh probe hook+48 --mode text --json` was run against both engines.
Every one of the 7 word spans in hook.line (`An`, `agent`, `cannot`, `see`, `its`, `own`,
`video.`) reports **identical** `x`, `y`, `w`, `h`, `fontSize: "104px"`, `fontWeight: "700"`,
`fontFamily: "Sora"` in both engines, at the exact frame where the pixel diff peaks at
3.1%/224-of-255. The DOM layout — and therefore the font actually in effect — is the same
in both engines; what differs is only how that identical layout gets rasterized during the
warm-up window. That also matches the character of the diff images: the differing pixels
sit on the edges of the text mass (bbox roughly the size of the two-line block, but only
~3% of pixels inside it actually flip), consistent with the whole text block being
rasterized a few pixels off during warm-up, not a different typeface being substituted.

Both engines already explicitly wait for `document.fonts.ready` before treating a frame as
settled — native at `src/engine/host/main.tsx:87` (`if (document.fonts?.ready) await
document.fonts.ready;`, inside `window.__mh.frame()`, run on every single frame), and
Remotion internally at `node_modules/@remotion/renderer/dist/seek-to-frame.js:146`
(`await page.evaluateHandle('document.fonts.ready')`, called from `seekToFrame`, which
`renderFrames`/`renderMedia` use for every frame). So this isn't a missing await — it's
that `document.fonts.ready` resolving is necessary but not sufficient for the *very first*
paints of a freshly-loaded page to be pixel-stable; something in the browser's glyph
rasterizer/cache needs a handful of paints to reach steady state, and the two engines
(Playwright-driven CDP screenshots for native vs. Puppeteer-driven capture inside
`@remotion/renderer` for remotion) don't reach it in exactly the same number of frames.
This is a Chromium-rasterizer-level effect, not a bug in the harness's Remotion-API shim or
in `src/mograph/runtime.tsx`'s use of it.

**Practical impact**: small. It only touches the first ~1-3 seconds of frames rendered in
a given run, on scenes that happen to render first, and every frame past it is exactly
identical. It would matter for a byte-exact regression-diff gate run cold; it doesn't
matter for how the film looks. If a byte-exact frame gate is ever wanted, the cheap fix is
a throwaway warm-up frame (render frame 0 once per fresh engine/page and discard it before
capturing anything that gets compared or delivered) rather than anything in the shim.

### 3. Full film, both formats, both engines

`mh render --format all --out-dir ... --engine <native|remotion>`, 660 frames/format, no
audio cues in this film (`film.mograph.json`'s `audio: []`).

| | native wide | remotion wide | native vertical | remotion vertical |
|---|---|---|---|---|
| duration | 22.000000s | 22.000000s | 22.000000s | 22.000000s |
| size | 452,723 B | 865,020 B | 447,223 B | 779,462 B |
| bitrate | 164.6 kbit/s | 314.6 kbit/s | 162.6 kbit/s | 283.4 kbit/s |
| pix_fmt | `yuv420p` | `yuvj420p` | `yuv420p` | `yuvj420p` |
| I/P/B frames (wide) | 6 / 216 / 438 | 6 / 227 / 427 | — | — |
| render wall time | 6.6s + 6.3s | 8.9s + 8.2s | | |

Duration is exact and identical, as expected (timeline-driven, not engine-dependent).

**Finding: the two engines tag their h264 output with a different color range**, despite
both explicitly requesting the same pixel format. Native's ffmpeg invocation passes
`-pix_fmt yuv420p` explicitly (`src/engine/native.ts:232`); the remotion engine passes
`pixelFormat: "yuv420p"` into `@remotion/renderer`'s `renderMedia()`
(`src/render/remotion-engine.ts:37`). The resulting file is `yuv420p` (standard,
limited/MPEG range) for native and `yuvj420p` (full/JPEG range) for remotion, on both
formats. This tracks with the size difference: remotion's output is 74-91% larger at the
same nominal CRF (18) and preset (`medium`), which is consistent with full-range encoding
giving x264 more distinct sample values to spend bits on for the same CRF. Decoded through
ffmpeg (a range-aware decoder), the mean luma of matching frames is within <1/255 between
engines (see below), so a compliant player will not show a visible brightness/contrast
shift — but the two engines are not producing bit-for-bit-comparable output streams, and
anything downstream that assumes consistent color-range tagging across engines (a
thumbnail pipeline, a strict frame-hash cache, a player that doesn't honor the range flag)
would see it. Worth the core team's time to find out why `renderMedia`'s explicit
`pixelFormat: "yuv420p"` doesn't prevent the full-range tag — most likely Remotion's own
frame-capture step for `renderMedia` produces full-range intermediate images (e.g. via a
JPEG-based capture path) and its ffmpeg invocation doesn't force `-color_range mpeg` /
an explicit range-conversion filter the way native's does implicitly by piping raw PNG.

ffmpeg-extracted frames at matching timestamps, wide format
(`scripts/parity/compare-video-frames.ts native/spot-wide.mp4 remotion/spot-wide.mp4
1.6,4.5,8.0,12.5,15.5,19.5`):

| t | mean abs delta | max delta |
|---|---|---|
| 1.6s | 0.834/255 | 54 |
| 4.5s | 0.769/255 | 41 |
| 8.0s | 0.939/255 | 88 |
| 12.5s | 0.800/255 | 47 |
| 15.5s | 0.698/255 | 49 |
| 19.5s | 0.871/255 | 70 |

Vertical format, 1.6s/8.0s/19.5s: mean abs delta 2.10-2.20/255, max 62-72. These are all
small (≤2.2/255 mean, well under 1% of range), present at *every* sampled timestamp
including ones deep inside scenes already shown to be pixel-identical at the raw-PNG
level (e.g. t=19.5s falls in `end`, which was 0/38 touched in the check-frame diff above).
That confirms these residual differences come from the encode step itself — independent
x264 encoding decisions plus the yuv420p/yuvj420p range difference — not from the
render/rasterization difference in section 2. Visually the two are indistinguishable (a
frame at t=8.0s, the `loop` scene's numbered list, was inspected at full size in both and
is identical to the eye).

### 4. Remotion API surface used by the mograph runtime

Every `from "remotion"` import reachable from `src/mograph/*`:

- `src/mograph/runtime.tsx:10` — `AbsoluteFill, Img, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig`
- `src/mograph/easing.ts:7` — `Easing, spring, measureSpring`
- `src/mograph/script.ts:163` and `examples/mograph/src/Root.tsx:2` — `Composition`

All of these are implemented in `src/engine/shim/remotion.tsx`. No gap: the mograph
runtime never touches the parts of the shim that are known-incomplete (`interpolateColors`
throws in the shim — grep confirms mograph never calls it; `interpolate` with string/color
output ranges is unported in the shim — every `interpolate()` call in
`src/mograph/runtime.tsx` uses numeric ranges, `[0,1]` or `[1,0]`; `<Audio>`/`<Video>` are
supported by the shim but the native engine doesn't render composition sound through
them — mograph has no audio/video layers at all, it's typography/shapes/counters/lists
only, so this doesn't apply here). This is a real, checked negative: the "motion graphics
as data" runtime's dependency on the Remotion API is fully covered by the native engine's
shim today.

### 5. Fonts, Img+svg, hidden elements, data-lint

- **Google Fonts loading**: `src/mograph/runtime.tsx:302-306` injects
  `<style>{'@import url("https://fonts.googleapis.com/...")'}</style>` once, inside
  `MgFilmView`, for the whole film — not through Remotion's documented font-loading
  contract (`@remotion/google-fonts` + `delayRender`/`continueRender`). Both engines still
  wait on `document.fonts.ready` before every frame (see section 2), and the DOM-level
  metrics probe identically in both — so the font itself is not the problem. The residual
  difference in section 2 is downstream of that (rasterization warm-up), not a missing
  wait.
- **Img with svg**: `end.mark` is `mark.svg` drawn through the shared `<Img>` (mograph
  `ImageView`, `src/mograph/runtime.tsx:144-153`, `staticFile(layer.src)`). All 38 `end`
  frames in the six-scene diff (section 2) are pixel-identical (0/38 touched, confirmed at
  full resolution: max channel delta 0/255 on `end+119`). No SVG-specific gap between the
  shim's `Img` (which delays render until `<img>` fires `load`/`error`) and Remotion's own
  `Img`.
- **visibility:hidden pre-animation elements**: every layer starts hidden via
  `visibility: pose.visible ? "visible" : "hidden"` (`src/mograph/runtime.tsx:51`, the
  `Box` component). The first frames of every scene (hook+0/2/4/6, stat+0, loop+0, speed+0,
  cmd's settled frame, end+0) are all pixel-identical between engines at full resolution —
  the hidden state paints the same way (nothing) in both.
- **`data-lint`**: mograph sets `data-lint="none"` on layers with `probe: false`
  (`src/mograph/runtime.tsx:51`); no layer in `film.mograph.json` sets `probe: false`, so
  this attribute never actually appears in this film. It's a plain DOM attribute either
  way — not something either engine's rendering path treats specially — so this isn't a
  parity axis for pixels, only for whatever downstream lint code reads the attribute
  (unaffected by which engine produced the frame).

## Fixes applied in examples/mograph

None. Bundling worked with the project as committed; no changes were needed to
`examples/mograph/tsconfig.json`, `examples/mograph/harness.config.ts`, or a
`webpackOverride`.

## What was not verified

- `mh still` / `--variants`, `mh review`/`mh deliver`, and the cursor/editor tooling —
  out of scope for this pass, not exercised at all.
- The non-mograph example projects (`examples/basic`, `examples/mh-film`), which drive
  Remotion through hand-written React components rather than the mograph JSON runtime —
  this audit is scoped to `src/mograph/runtime.tsx` and `examples/mograph` only, per the
  task.
- Audio: this film declares no audio cues and no `<Audio>` layers, so the native engine's
  known audio gap was not exercised either way.
- Windows, and any Linux-specific Chrome flag paths (`--single-process` etc. in
  `@remotion/renderer`'s default args) — this was run entirely on macOS/arm64.
- Root-causing *why* the two engines' text rasterizer needs a different number of frames
  to warm up (section 2) beyond what's shown here — confirmed reproducible and confirmed
  DOM-identical, but the exact Chromium-internal mechanism (glyph atlas, GPU raster cache,
  something else) was not instrumented further.
- Root-causing why Remotion's `renderMedia` produces `yuvj420p` despite the explicit
  `pixelFormat: "yuv420p"` (section 3) — the discrepancy is demonstrated and localized to
  two call sites, but the fix inside `@remotion/renderer` (or a workaround in
  `src/render/remotion-engine.ts`) was not attempted, per the instruction not to edit
  `src/`.
- Concurrency values other than the CLI defaults (4 for `frames`, cpu-count-based for
  `render`) were not swept; the warm-up window's exact length may depend on them.

## Commands to reproduce

```bash
cd /Users/luishenrich-bandis/VSCode/mh-work/parity
bun run src/cli.ts doctor --project examples/mograph --engine remotion

bun run src/cli.ts frames --project examples/mograph --scene hook,stat,loop,speed,cmd,end --engine native --tag native
bun run src/cli.ts frames --project examples/mograph --scene hook,stat,loop,speed,cmd,end --engine remotion --tag remotion
bun run src/cli.ts diff native remotion --project examples/mograph

bun run src/cli.ts render --project examples/mograph --format all --engine native --out-dir /tmp/mh-parity-out/native
bun run src/cli.ts render --project examples/mograph --format all --engine remotion --out-dir /tmp/mh-parity-out/remotion

bun run scripts/parity/pixel-diff.ts <a.png> <b.png> [diff.png]
bun run scripts/parity/compare-video-frames.ts <a.mp4> <b.mp4> 1.6,8.0,19.5 [outDir]
```

---

# Second pass: groups, camera, transitions, effects (2026-09-07, morning)

Extends the pass above to the parts of the vocabulary the first pass did not exercise:
groups, the scene camera, scene transitions (all 8 handover types the vocabulary defines),
gradients, colour tracks, effects (shadow, glow, stroke, highlight, gradientText, blend,
roundCaps), the flip/track/scramble text presets, drawn shapes (path/arrow/star), a line
chart, a set of rings, an odometer counter and a field of particles. Three example films:
`examples/mograph` (8 scenes: groups in `card` and `travel`, camera in `hook` and `travel`,
transitions on `stat`/`card`/`loop`/`travel`), `examples/mograph-effects` (7 scenes: every
effect and preset above, no camera or transitions), `examples/mograph-reel` (12 scenes,
all of the above plus 12 sfx cues). Run directly in this repo (`/Users/luishenrich-bandis/VSCode/motion-harness`,
branch `main`), no worktree. Same environment as the first pass: macOS arm64, Bun 1.3.3 or
compatible, ffmpeg 8.1, remotion/@remotion-bundler/@remotion-renderer 4.0.475, both engines
resolving to the same `chrome-headless-shell` binary. `src/` was not edited. The fix the
first pass flagged for the colour-range mismatch (`src/render/remotion-engine.ts:37-39`,
`pixelFormat: "yuv420p"` plus `colorSpace: "bt709"`) is already in the tree (commit
`49db47f`), so this pass starts from code where that mismatch is already gone; the "Full
render: duration, container, colour range" section below reconfirms it at the container
level on all three films rather than treating it as still open.

## Method

1. `mh doctor --project <film> --engine remotion` for all three films.
2. `mh frames --project <film> --scene <all scene ids> --dense 4 --engine native --tag
   pnative` and the same with `--engine remotion --tag premotion`, then `mh diff pnative
   premotion --project <film>`. `--dense 4` was available and used throughout (`mh frames
   --help` lists it) so transitions, camera moves, staggers and the odometer roll are
   sampled every 4 frames between their named check points, not just at enter/settled/exit.
3. Every scene was also rendered **in isolation** as the first (and only) scene of a fresh
   `mh frames` run, to separate the warm-up transient the first pass found (native vs.
   remotion's screenshot pipelines need a few dozen paints after a fresh page load to reach
   pixel-identical rasterisation, see the first pass, section 2) from anything genuinely
   tied to a feature. If a scene shows the same touched-then-converges pattern in isolation
   regardless of which feature it carries, that is warm-up, not the feature. If a scene
   shows a difference **only** when deep in a fully-warmed-up render (hundreds of frames
   in) and that difference does not shrink or converge over time, that is real.
4. `mh diff`'s built-in comparison downscales 2x before diffing, same as the first pass
   noted. This pass found a case where that matters more than "a fine detail to
   cross-check": a real, reproducible difference (the odometer, below) sits entirely inside
   `mh diff`'s "unchanged" bucket for every scene it appears in, in all three films, because
   the difference is a thin outline around each rolling digit and 2x-downscaling blends it
   below the 0.2%-of-pixels threshold. A new script, `scripts/parity/scan-frames.ts`, was
   added to close that gap: it full-resolution-diffs every common frame between two `mh
   frames` runs in one process (no per-frame `bun` start-up cost) and reports every frame
   with so much as one differing pixel, not just the ones over a threshold. All "real
   difference" claims below were found or confirmed with it, then double-checked with the
   existing `scripts/parity/pixel-diff.ts` on the specific worst frame.
5. Full render, both formats, both engines, all three films: `mh render --project <film>
   --format all --engine <native|remotion> --out-dir /tmp/mh-parity2/<film>/<engine>`.
   Compared with `ffprobe` (duration, size, pix_fmt, color_range, color_space) and by
   extracting frames at 6 timestamps with `scripts/parity/compare-video-frames.ts`, chosen
   per film to hit: inside a transition, mid camera move, mid stagger, a drawn path mid
   draw, the odometer mid roll, and particles (exact timestamps are listed per film below;
   not every film has every feature, so the six were chosen from what each film actually
   contains). Wide format got the full six per film; vertical format got a 3-timestamp spot
   check per film, same as the first pass's approach.
6. Sound: `mograph-reel`'s wide render was the only one with cues. Its audio track was
   extracted from both the native-engine and remotion-engine outputs with ffmpeg and
   compared by MD5, `mh audio` was run on both mp4s, and `ffprobe` compared the audio
   stream's codec/sample-rate/channels/duration on both.

## Results

### mograph (8 scenes: groups in card/travel, camera in hook/travel, transitions on stat/card/loop/travel)

Full run, wide format, dense 4, all 8 scenes together:

| | frames compared | bit-identical | warm-up transient | real feature difference |
|---|---|---|---|---|
| hook | 46 | 18 | 28 | 0 |
| stat | 45 | 8 | 37 | 0 |
| card | 68 | 68 | 0 | 0 |
| loop | 49 | 49 | 0 | 0 |
| speed | 49 | 49 | 0 | 0 |
| travel | 59 | 59 | 0 | 0 |
| cmd | 38 | 38 | 0 | 0 |
| end | 49 | 40 | 0 | 9 (negligible, see below) |
| **total** | **403 common** | **329** | **65** | **9 (negligible)** |

`end`'s 9 touched frames top out at 23/255 max channel delta on 0.012% of pixels (about
250 px out of 2,073,600), a handful of stray pixels on text edges, the same order of
magnitude as ordinary antialiasing noise between two independent rasterisers, not a
feature-tied difference (nothing in `end` differs structurally from the scenes that came
out at exactly 0 above). None of `card`, `loop`, `speed`, `travel` or `cmd`, the four
scenes that actually carry the features this pass targets (2 groups, camera in 2 scenes,
transitions on 4 scenes), show even one differing pixel anywhere, confirmed at full
resolution with `scripts/parity/scan-frames.ts`.

**Isolation check** (each rendered alone, as the first scene of a fresh engine pair):
`card` (group + wipe-left transition) touched 42/68 frames when isolated, worst 2.6% at
`card+0`; `travel` (camera + group + dip transition) touched 54/59 frames when isolated,
worst 1.2% at `travel+0`. Both show the identical shape as `hook`/`stat` above: large at
the run's first frames, shrinking, gone entirely a few dozen frames in. That is the same
warm-up transient the first pass found on plain text, now confirmed on groups, a moving
camera and a transition handover: the transient is a function of how many frames the
engine has painted since launch, not of what is being painted. Once `card` and `travel`
are not first in the queue (the 8-scene run above), they are pixel-identical throughout,
camera move and all.

### mograph-effects (7 scenes: gradients, colour tracks, effects, presets, path/arrow/star, rings, line chart, odometer, particles)

Full run, wide format, dense 4, all 7 scenes together:

| scene | feature | frames | bit-identical | warm-up | real (odometer/rings) | negligible |
|---|---|---|---|---|---|---|
| hook | particles (blend), flip text, track text | 52 | 46 | 6 | 0 | 0 |
| sweep | highlight effect, line-wipe preset | 45 | 45 | 0 | 0 | 0 |
| draw | path/arrow/star, roundCaps | 47 | 25 | 0 | 0 | 22 (1px each) |
| count | odometer roll, shadow effect, radial gradient ground | 42 | 5 | 0 | 37 | 0 |
| rings | scramble text, rings | 41 | 35 | 0 | 6 | 0 |
| chart | gradientText, line chart draw | 50 | 48 | 0 | 0 | 2 (1px each) |
| end | colour tracks, particles (confetti), stroke effect | 50 | 46 | 0 | 0 | 4 |
| **total** | | **327 common** | **250** | **6** | **43** | **28** |

Two real, reproducible findings, both confirmed deep in the run (hundreds of frames past
any warm-up window, on content proven static by checking the frame right before and right
after) and both invisible to `mh diff`'s default 2x-downscaled comparison:

**1. The odometer (`count` scene, 37/42 frames touched, up to 0.77% of pixels, max channel
delta up to 230/255).** `count+0` (roll not started) and `count+99` (roll finished, last
frame of the scene) are exactly bit-identical; every sampled frame in between, whether the
digits are actively rolling or already resting on their final value, shows a thin, 1-2px
outline around each digit glyph plus a faint ripple in the drop-shadow halo around the
whole counter. Diff image: `/tmp/mh-diff-count40.png` (frame `count+40`, filmFrame 350,
0.503% of pixels, max delta 160/255), a probe of the same frame (`mh probe count+40
--mode probe --engine native|remotion --project examples/mograph-effects`) confirms the
counter's box (`x=673 y=363 w=575 h=181`) is pixel-for-pixel identical between engines, so
this is not a layout or timing bug, only a rasterisation one. Cause: `Odometer` in
`src/mograph/views.tsx:276-297` sets each digit column's cell height to `const h = size *
0.86` (line 279, `size` here is 210 u-px, so `h` = 180.6, not a whole number) and positions
the rolling strip with `transform: translateY(${-(c.offset % 10) * h}px)` plus `willChange:
"transform"` (line 285) inside a `overflow: hidden` span (line 284). `c.offset` (from
`odometerCells` in `src/mograph/shapes.ts`) is a continuously-eased float, so the resulting
translateY is essentially never a whole pixel. `willChange: "transform"` is set nowhere
else in the mograph runtime, not on the scene camera (`cameraStyle`,
`src/mograph/runtime.tsx:426-435`, which carries its own sub-pixel `translate`/`scale`
values to 3-5 decimal places but shows zero divergence anywhere in this pass) and not on
any pose transform in `Box` (`src/mograph/runtime.tsx:85-98`). That is the one structural
difference between the odometer's transform and every other transform in the runtime, and
it lines up with the task's own hint to check `will-change`: a GPU-layer-promoted element
translated by a sub-pixel amount is exactly where two different capture pipelines (native's
Playwright CDP `Page.captureScreenshot` vs. `@remotion/renderer`'s own frame capture) would
be most likely to snap to the pixel grid slightly differently. Smallest fix: round the cell
height and the translateY to whole pixels, e.g. `const h = Math.round(size * 0.86);` at
line 279 and `translateY(${Math.round(-(c.offset % 10) * h)}px)` at line 285, so the
element only ever sits at an integer offset in both engines.

**2. Rings (`rings` scene, 6/41 frames touched, ~0.06% of pixels, max channel delta
28-44/255).** Diff image: `/tmp/mh-diff-reel-lints80.png` is the `mograph-reel` twin of
this (see below, same component); the `mograph-effects` frames are
`.harness/frames/effects-wide/{pnative,premotion}/film/rings+52.png` (regenerate with
`bun run scripts/parity/pixel-diff.ts <a> <b> out.png`, not written to a committed path by
this audit). The differing pixels sit exactly on the antialiased edge of each ring's
stroke, nowhere else. Likely the same class of cause as the odometer: `RingsView` in
`src/mograph/views.tsx:227-271` draws each ring's animated arc via `strokeDasharray`/
`strokeDashoffset` from `ringGeometry` (`src/mograph/shapes.ts:86`), and the two engines'
SVG rasterisers round the sub-pixel arc endpoint slightly differently. An order of
magnitude smaller than the odometer (28-44 vs. up to 230 max channel delta, a thin edge
vs. a filled digit) and, unlike the odometer, this one is genuinely close to the "sub-pixel
antialiasing, not a real difference" line the task asked to exclude, it is reported here
only because it is reproducible and localised to one component, not because it is visually
significant.

Everything else in this film reads as ordinary antialiasing noise, not a feature
difference: `draw` (path/arrow/star + roundCaps) is touched on 22 frames but every single
one is exactly 1 pixel out of 2,073,600 at 1/255 delta; `chart` (gradientText + a line
chart drawn live) is touched on 2 frames at 1/255; `end` (colour-tracked shape, confetti
particles, stroke effect) is touched on 4 frames at 2-3/255. `sweep` (highlight effect,
line-wipe preset) has zero differing pixels anywhere, and so does `draw`'s and `end`'s
particle/shape content once the 1-3px antialiasing rows above are set aside, no scene
here shows the CLI-visible >=0.2% pattern outside `count` and `rings`.

### mograph-reel (12 scenes, everything above plus 12 sfx cues)

Full run, both formats, dense 4, all 12 scenes together (wide / vertical):

| scene | feature | frames (wide=vert) | real (wide) | real (vert) |
|---|---|---|---|---|
| title | camera, headline stagger | 50 | 0 (2 warm-up) | 0 (6 warm-up) |
| blind | dissolve transition | 55 | 0 | 0 |
| file | push-up transition, group + stagger | 82 | 0 | 0 |
| address | wipe-left transition, text stagger | 58 | 0 | 0 |
| travel | camera, dip transition, 3 groups + stagger | 80 | 0 (9 negligible) | 0 |
| pass | zoom transition, drawn path mid-draw | 57 | 0 | 0 |
| speed | push-left transition, bars stagger | 56 | 0 (1 negligible) | 0 |
| lints | wipe-up transition, rings + stagger | 58 | 23 (rings, see above) | 23 |
| count | dissolve transition, odometer roll | 52 | 32 (odometer) | 43 (odometer) |
| loop | push-down transition, list stagger | 63 | 0 (3 negligible) | 0 |
| sting | zoom transition, particles | 51 | 0 (32 negligible) | 0 (24 negligible) |
| end-card | dip transition, title stagger | 65 | 0 | 0 |
| **total** | | **727 common** | **55 (odometer+rings)** | **66 (odometer+rings)** |

Every scene that is not `count` or `lints` is either exactly bit-identical or touched only
by the same negligible 1-11px antialiasing noise seen in the other two films (`travel`'s 9,
`speed`'s 1, `loop`'s 3, `sting`'s 32 are all single-digit-to-low-double-digit pixel counts
at low channel deltas, spread across a 1920x1080 or 1080x1920 frame, see the "particles"
finding below for why `sting` specifically is worth calling out despite the noise). `count`
(the odometer) and `lints` (rings) reproduce exactly the two real findings from
`mograph-effects` above, in a different film with a different counter size, see below for
why that matters. `mh diff pnative premotion --project examples/mograph-reel` (the default,
2x-downscaled comparison) reports only `title` as touched, for both formats: it misses
`count` and `lints` entirely, the same gap `mh diff` had on `mograph-effects`.

**Odometer, cross-film confirmation.** `mograph-reel`'s counter (`examples/mograph-reel/film.mograph.json`,
scene `count`, layer `big`) uses `size: 200` for wide format, so `h = 200 * 0.86 = 172.0`
exactly, a whole number, unlike `mograph-effects`'s `size: 210` (`h = 180.6`). That is a
natural experiment: does the divergence need a fractional cell height, or does it come from
somewhere else? Answer, from `scripts/parity/scan-frames.ts` on the full 12-scene run:
`count` in `mograph-reel` wide format still touches 32/52 frames (`count+0` and `count+119`,
the scene's first and last frame, are the only two checked frames confirmed at exactly
0/255; everything between is intermittently touched, up to 0.49% of pixels and 174/255 max
delta), so a whole-number `h` reduces the problem but does not remove it, the other term
in the transform, `c.offset % 10` from the eased progress value, is itself essentially
never a whole number, so `-(c.offset % 10) * h` lands off the pixel grid most frames
regardless of `h`. Vertical format's counter uses `size: 190` (`h = 163.4`, fractional
again), and there it is worse: 43/52 frames touched, up to 0.42% of pixels. Diff image:
`/tmp/mh-diff-reel-count24.png` (wide, `count+24`, filmFrame roughly mid-roll, 0.394% of
pixels, max delta 184/255), visually identical in character to the `mograph-effects`
diff image (a thin outline around each rolling digit, plus the shadow-filter ripple around
it).

**Rings, cross-film confirmation.** `lints`'s `dials` rings layer reproduces the same
thin-stroke-edge divergence as `mograph-effects`'s `rings` scene: 23/58 frames touched in
both formats, ~0.06% of pixels, max channel delta 28/255. Diff image:
`/tmp/mh-diff-reel-lints80.png` (`lints+80`, 0.063% of pixels), every differing pixel sits
on the antialiased edge of one of the three concentric ring strokes, nothing inside or
outside the rings themselves.

**Particles: deterministic, effectively identical.** `sting`'s `dust` particle field (60
particles, shape `dot`) is not exactly 0 diff at full resolution, `scripts/parity/scan-frames.ts`
finds 32/51 frames with at least one differing pixel, but every one of those 32 frames
differs by between 1 and 79 pixels out of 2,073,600 (0.000-0.005%), the same magnitude as
the antialiasing noise on ordinary shapes and text edges elsewhere in this audit, not the
kind of change that would show if particle positions themselves differed between engines
(that would move far more than a handful of edge pixels, on every particle, every frame).
`src/mograph/particles.ts`'s own contract (`rng`, a seeded mulberry32 generator, and
`particlesAt`, pure arithmetic on `frame` alone, no `Math.random`, no per-frame state) is
confirmed at the pixel level: particles are the same field, same 400-particle cap, same
positions, in both engines. The few stray pixels are consistent with ordinary sub-pixel
edge antialiasing on the particles' own `border-radius: 50%` circles, not a determinism gap.

**Drawn path, cross-film confirmation.** `pass`'s `tick` shape (`shape: "path"`, drawn with
`pathLength={1}` and `strokeDashoffset`) shows zero differing pixels anywhere in either
format, at every sampled frame including mid-draw. Combined with `mograph-effects`'s `draw`
scene (path/arrow/star, touched only by the same 1px antialiasing noise as everywhere else),
svg `pathLength`/`strokeDashoffset` drawn-shape rendering is clean between engines.

### Full render: duration, container, colour range

`ffprobe`, both formats, all three films, native vs. remotion:

| film | duration | frame count | pix_fmt (both) | color_range | color_space |
|---|---|---|---|---|---|
| mograph wide | 30.466667s / 30.466667s | 914 / 914 | yuv420p / yuv420p | unknown / tv | unknown / bt709 |
| mograph vertical | 30.466667s / 30.466667s | 914 / 914 | yuv420p / yuv420p | unknown / tv | unknown / bt709 |
| mograph-effects wide | 24.332682s / 24.333333s | 730 / 730 | yuv420p / yuv420p | unknown / tv | unknown / bt709 |
| mograph-effects vertical | 24.330990s / 24.333000s | 730 / 730 | yuv420p / yuv420p | unknown / tv | unknown / bt709 |
| mograph-reel wide | 53.133333s / 53.133000s | 1594 / 1594 | yuv420p / yuv420p | unknown / tv | unknown / bt709 |
| mograph-reel vertical | 53.133333s / 53.133333s | 1594 / 1594 | yuv420p / yuv420p | unknown / tv | unknown / bt709 |

The `yuvj420p` (full-range) mismatch the first pass flagged is fixed: both engines now tag
`yuv420p`, confirmed on all three films, both formats. `color_range`/`color_space` still
differ in how they are tagged (native leaves the container's colour metadata unset, an
implicit "assume limited range" that virtually every decoder honours for `yuv420p`;
remotion tags it explicitly `tv`/`bt709`, which is the same thing said out loud). Not a
defect: the earlier `compare-video-frames.ts` numbers below decode both through the same
ffmpeg, range-aware either way, and read within a few tenths of a level of 255 of each
other. Frame counts and (sub-frame-rounding) durations match exactly on all three films,
both formats, as expected for a timeline-driven film.

Rendered frame counts differ per scene between a fully-cached run and a from-scratch one,
so file sizes are only comparable within one clean run: this pass's `mograph` remotion
render came out to 1.5MB (wide) vs. native's 0.9MB, roughly the same 60-90% gap the first
pass measured; `mograph-effects` came out much closer (2.3MB vs. 2.2MB, remotion 4% larger);
`mograph-reel` was 4.1MB vs. 3.1MB (32% larger). The size gap is present at every film and
both formats, but its magnitude is not consistent across films, which is more evidence for
the first pass's theory (different x264 encoding decisions on a full-range-ish intermediate,
not a difference in what is actually drawn) than for anything scene-specific.

### Full render: 6-timestamp ffmpeg extraction, wide format

`scripts/parity/compare-video-frames.ts`, timestamps chosen per film to land inside a
transition, mid camera move, mid stagger, a drawn path mid-draw, the odometer mid-roll and
particles (not every film has every feature; timestamps below are what each film has):

**mograph** (1.0s hook mid-stagger, 3.3s stat push-up transition, 6.7s card wipe-left
transition + group, 11.5s loop mid-list-stagger, 20.5s travel mid-camera-move, 23.4s travel
dip-transition-out):

| t | mean abs delta | max delta |
|---|---|---|
| 1.0s | 0.209/255 | 59 |
| 3.3s | 0.295/255 | 57 |
| 6.7s | 0.700/255 | 50 |
| 11.5s | 0.239/255 | 74 |
| 20.5s | 0.477/255 | 62 |
| 23.4s | 0.005/255 | 5 |

**mograph-effects** (2.0s hook particles+blend, 10.7s draw mid-draw, 11.9s draw/count
boundary, 16.5s rings mid-stagger, 21.0s chart gradientText+line-draw, 23.8s end
colour-tracks+particles):

| t | mean abs delta | max delta |
|---|---|---|
| 2.0s | 1.157/255 | 71 |
| 10.7s | 2.633/255 | 247 |
| 11.9s | 2.569/255 | 244 |
| 16.5s | 0.973/255 | 62 |
| 21.0s | 1.827/255 | 227 |
| 23.8s | 2.122/255 | 237 |

**mograph-reel** (3.9s blind dissolve transition, 18.5s travel mid-camera-move, 0.3s title
mid-headline-stagger, 23.3s pass mid-drawn-path, 36.5s count mid-odometer-roll, 45.5s sting
mid-particles):

| t | mean abs delta | max delta |
|---|---|---|
| 3.9s | 1.156/255 | 58 |
| 18.5s | 1.432/255 | 65 |
| 0.3s | 3.143/255 | 59 |
| 23.3s | 0.636/255 | 65 |
| 36.5s | 1.348/255 | 64 |
| 45.5s | 1.264/255 | 56 |

All of these are small (mean well under 3.2/255) and present at every sampled timestamp,
including ones that fall inside scenes already proven pixel-identical or near-identical at
the raw-frame level above (e.g. `mograph`'s 23.4s, deep in `travel`, which is 0/59 touched
at the raw-frame level and correspondingly the smallest number here by a wide margin: 0.005
mean, max 5). Same conclusion as the first pass: this is x264 encoding noise on top of the
render, not the render itself, except that where the render itself does have a real
difference (`mograph-effects` 10.7-23.8s, which cross a `draw`/`count`/`chart`/`end` span
that includes the odometer), the encode-level number is visibly higher (2.1-2.6 mean vs.
0.2-1.4 elsewhere), consistent with, not contradicting, the odometer finding above.

Vertical format, 3-timestamp spot check per film: `mograph` (6.7s/11.5s/20.5s) 0.55-1.05
mean, 57-67 max; `mograph-effects` (10.7s/11.9s/23.8s, all inside the odometer/end span)
2.2-2.6 mean, 236-248 max, matching wide format's elevated numbers in the same span;
`mograph-reel` (18.5s/36.5s/45.5s) 0.42-0.91 mean, 61-78 max. No format-specific surprises.

### Sound

`mograph-reel` wide, native vs. remotion: the audio track extracted from each rendered mp4
with ffmpeg (`-vn -acodec pcm_s16le`) is byte-for-byte identical, MD5
`930c9d09c7149cd3d6ebd99c20a0c1b8` on both. `mh audio <file> --project examples/mograph-reel`
produces character-for-character identical output on both files: same peak, same RMS
sparkline, same 7 silent-scene markers, same integrated loudness (-12.0 LUFS, true peak
-3.7 dBTP), same per-platform loudness deltas, and the same 12 cues at the same timestamps
with the same before/after RMS and the same AUDIBLE/NOTHING AUDIBLE verdicts.
`ffprobe`: both audio streams are AAC, 48kHz, stereo, 53.141s, matching duration to the
millisecond on both formats. This confirms the render command's audio mix
(`concat 12 segments + 0 audio tracks` then `mixed 12 cues`) runs from the timeline's cue
data through ffmpeg independent of which picture engine rendered the video, nothing about
`--engine remotion` changes how sound is mixed, because nothing in that step reads which
picture engine was used.

## What was not verified

- `mh still`, `--variants`, `mh review`/`mh deliver`, `mh captions`, `mh voice`, cursor
  targets, the editor, and every non-mograph example (`examples/basic`, `examples/mh-film`,
  `examples/mograph-templates`), out of scope for this pass, same as the first.
- The exact Chromium-internal mechanism behind the odometer and rings findings (a
  compositor sub-pixel-snapping difference between native's Playwright CDP screenshot path
  and `@remotion/renderer`'s own capture path is the best-supported hypothesis here, tied
  to `willChange: "transform"` being unique to the odometer in this runtime, but it was not
  instrumented at the Chromium level to confirm), same epistemic caveat the first pass
  gave for the warm-up transient's mechanism.
- Whether rounding the odometer's cell height and translateY to whole pixels (the fix
  proposed above) actually closes the gap, proposed, not applied or tested, per the
  instruction not to edit `src/`.
- Concurrency values other than the CLI defaults, Windows, and non-macOS Chrome flag paths:
  not swept, same as the first pass.
- `mh lint --rendered` was not run against any of this pass's renders; only pixel-level
  parity was checked, not the harness's own colour/overflow/collision lints.
- Frame-type (I/P/B) breakdowns and bitrate-vs-CRF analysis of the new renders, which the
  first pass did for `mograph`, not repeated here; the file-size gap is reported but not
  decomposed further.
- Vertical format got a 3-timestamp spot check per film at the render level (matching the
  first pass's approach) rather than the full 6; the raw check-frame diffs (section by
  section above) do cover vertical format in full for `mograph-reel` (both `count` and
  `lints` findings are confirmed independently in both formats) but not for `mograph` or
  `mograph-effects`, where only wide format got the full dense-4 all-scenes raw-frame
  sweep.

## Files added

- `scripts/parity/scan-frames.ts`, full-resolution sweep of every common frame between two
  `mh frames` runs, in one process; reports any frame with at least one differing pixel,
  not just ones over a threshold. Usage: `bun run scripts/parity/scan-frames.ts dirA dirB
  [minPct]`.

`scripts/parity/pixel-diff.ts` and `scripts/parity/compare-video-frames.ts` (from the first
pass) were reused as-is, no changes.

## Commands to reproduce (this pass)

```bash
cd /Users/luishenrich-bandis/VSCode/motion-harness

# 1. doctor, all three films
for f in mograph mograph-effects mograph-reel; do
  bun run src/cli.ts doctor --project examples/$f --engine remotion
done

# 2. raw check frames, dense 4, full scene list per film, both engines, then diff
bun run src/cli.ts frames --project examples/mograph --scene hook,stat,card,loop,speed,travel,cmd,end --dense 4 --engine native --tag pnative
bun run src/cli.ts frames --project examples/mograph --scene hook,stat,card,loop,speed,travel,cmd,end --dense 4 --engine remotion --tag premotion
bun run src/cli.ts diff pnative premotion --project examples/mograph
bun run scripts/parity/scan-frames.ts examples/mograph/.harness/frames/spot-wide/pnative/film examples/mograph/.harness/frames/spot-wide/premotion/film 0

# (repeat with examples/mograph-effects --scene hook,sweep,draw,count,rings,chart,end
#  and examples/mograph-reel --scene title,blind,file,address,travel,pass,speed,lints,count,loop,sting,end-card
#  optionally --format vertical)

# 3. isolation check (warm-up vs. real): render one scene alone, fresh tags, diff
bun run src/cli.ts frames --project examples/mograph --scene card --dense 4 --engine native --tag cardnative
bun run src/cli.ts frames --project examples/mograph --scene card --dense 4 --engine remotion --tag cardremotion
bun run src/cli.ts diff cardnative cardremotion --project examples/mograph

# 4. full render, ffprobe, 6-timestamp diff
bun run src/cli.ts render --project examples/mograph-reel --format all --engine native --out-dir /tmp/mh-parity2/mograph-reel/native
bun run src/cli.ts render --project examples/mograph-reel --format all --engine remotion --out-dir /tmp/mh-parity2/mograph-reel/remotion
ffprobe -v error -show_entries stream=pix_fmt,color_range,color_space -show_entries format=duration,size /tmp/mh-parity2/mograph-reel/native/reel-wide.mp4
bun run scripts/parity/compare-video-frames.ts /tmp/mh-parity2/mograph-reel/native/reel-wide.mp4 /tmp/mh-parity2/mograph-reel/remotion/reel-wide.mp4 3.9,18.5,0.3,23.3,36.5,45.5

# 5. sound
ffmpeg -y -v error -i /tmp/mh-parity2/mograph-reel/native/reel-wide.mp4 -vn -acodec pcm_s16le /tmp/native-audio.wav
ffmpeg -y -v error -i /tmp/mh-parity2/mograph-reel/remotion/reel-wide.mp4 -vn -acodec pcm_s16le /tmp/remotion-audio.wav
md5 /tmp/native-audio.wav /tmp/remotion-audio.wav   # or md5sum on Linux
bun run src/cli.ts audio /tmp/mh-parity2/mograph-reel/native/reel-wide.mp4 --project examples/mograph-reel
bun run src/cli.ts audio /tmp/mh-parity2/mograph-reel/remotion/reel-wide.mp4 --project examples/mograph-reel
```
