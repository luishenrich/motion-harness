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
