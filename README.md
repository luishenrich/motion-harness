# motion-harness

Eyes and hands for coding agents that make videos with [Remotion](https://remotion.dev).

Remotion renders real React components pixel-perfect into video, which is why a product team
can build a launch film from the same code as the product. But an agent working on that film
is blind and slow: it cannot watch the video, every check is a full render plus ffmpeg plus a
subagent reading frames, timing is scattered in constants across components, and the human's
feedback arrives as "second 21 is too fast" or "picture 2" while the code only knows frames.

motion-harness sits next to a Remotion project and gives the agent:

- **a timeline as data** (parts, scenes, events, audio cues, rules), compiled to absolute frames,
  film seconds and settled frames, with a resolver for every way a human refers to a moment
  (`21s`, `f630`, `probe.pick1`, `probe+14`, `product:f310`, `#17`, `product - 9s`)
- **check frames in seconds**, not full renders: enter, settled, each event, mid, last, with one
  contact sheet per scene whose cells carry a frame address and a reason, and mark transitions so
  nobody reports a wipe as a bug
- **a DOM probe**: element boxes, visibility, colors and fonts straight from the rendered page.
  Where is the button, what color is that word, is the card inside the safe zone
- **lint before and after rendering**: source colors and painted colors against design tokens,
  text durations, events inside scenes, safe zones, expected elements visible
- **motion as numbers**: a frame-to-frame difference curve per scene, when it settles, how long it
  holds, where it jumps, checked against rules
- **diff between runs**: which check frames changed after an edit, with diff images
- **the film from the timeline**: scene segments rendered and cached individually, parts
  concatenated, music and sfx mixed from the cues. A music change is a mux, a scene change is
  one segment
- **an audio probe**: RMS profile, silence, every cue of the timeline checked
- **cuts against the beat**: onsets from the mix, tempo and beat grid from the music bed, every scene cut
  and sfx cue measured against them, and `--suggest` proposes the scene-length changes that put the
  cuts on the grid
- **a review player** for humans: the film, a scene bar, hotkeys, and comments that land as
  `scene+frame` instead of seconds. `mh feedback` hands them to the agent
- **cursor targets from the DOM**: `mh probe <scene.event> --key <data-probe> --json` prints an
  element's centre in film px, so one global cursor can swing through every cut with measured
  targets instead of hand-typed coordinates (recipe in the skill)
- **an agent skill** (`skill/SKILL.md`) that teaches the loop

Nothing here replaces Remotion. It is the harness Remotion does not ship.

## Install

```bash
git clone <this repo> motion-harness && cd motion-harness && bun install
bash examples/basic/make-assets.sh            # two generated audio files for the example
bun run src/cli.ts doctor --project examples/basic
```

Requirements: Bun 1.3+, ffmpeg on the PATH, and a Remotion project on the same Remotion
version as this repo's devDependencies (the renderer refuses to open bundles of a different
version). Chrome Headless Shell is downloaded by Remotion on first use.

For your own project, add a `harness.config.ts` next to its `package.json`
(`mh init` writes a template) and run `mh doctor --project <dir>`. The harness bundles your
Root through a generated wrapper inside `<cacheDir>/entry`, so `remotion` and `react` resolve
to your project's copies and no project file is modified.

## The loop

```bash
mh resolve 21s                          # -> probe+14  (part product f310, film f630 21.00s) after pick1+2
mh frames --scene probe --probe text --sheet
mh probe probe.pick1 --find "Next"      # box, color, font, visible
# edit the composition
mh frames --scene probe --tag after && mh diff before after
mh motion --scene probe
mh lint --rendered && mh doctor
mh render --web && mh audio && mh beats
mh review                               # the human comments, then:
mh feedback
```

`mh help` lists every command and flag.

## Timeline

```ts
import { defineTimeline } from "motion-harness/timeline";

export const timeline = defineTimeline({
  fps: 30,
  parts: [
    {
      id: "product",
      composition: { wide: "launch-product-wide", vertical: "launch-product-vertical" },
      enterFrames: 12,
      overlap: 22,
      scenes: [
        { id: "map", dur: 80, enter: "blurWipe", ground: "dark", events: { expand: 16, bars: 30 } },
        { id: "probe", dur: 78, enter: "cut", ground: "cream", events: { pick1: 12, next: 24 }, probes: ["next-button"] },
      ],
    },
  ],
  audio: [{ id: "bed", kind: "music", file: "public/bed.mp3", at: "product - 9s", gain: 0.24, ramps: [{ at: "product", to: 0.44, over: 2 }], fadeOut: 2.2, loop: true }],
  rules: { minSceneDur: 12, maxEnterFrames: 14, holdFrames: [18, 120], safeZone: { vertical: { top: 220, bottom: 320, x: 60 } } },
});
```

Compositions should read scene lengths and event frames from the compiled timeline
(`examples/basic/src/scenes.tsx` shows the pattern: a `Montage` mounts scenes as `Sequence`s,
a context hands each scene its compiled record, `ev(scene, "click")` returns the frame). Then
`mh doctor` can never report drift, and `mh docs` generates the edit list instead of anyone
hand-editing a markdown table.

Existing projects can start by building the timeline from whatever arrays they already export
(see the StudyPDF config in the commit history of this repo for a `BEATS` array turned into
scenes); `mh doctor` checks the totals against the compositions.

## Layout

```
src/timeline/   schema (defineTimeline, compile), resolve, docs
src/render/     bundle (wrapper entry + cache), frames (renderStill through one browser, probe capture)
src/probe/      the injected DOM probe (plain JS, runs inside the page)
src/sheet/      contact sheets (sharp)
src/lint/       static colors, timeline rules, painted colors / safe zone / expected probes
src/diff/       frame set comparison with diff images
src/motion/     per-scene motion curve (renderFrames, small jpegs)
src/audio/      RMS profile via ffmpeg
src/film/       scene segments (cached), part audio, concat, mix from cues
src/review/     the review player (Bun.serve) and feedback export
src/cli.ts      mh
examples/basic  a two-part film whose compositions read the timeline
skill/SKILL.md  the agent skill
```

## Why not a JSON video editor, a video-understanding model, or an MCP

JSON render APIs (Shotstack, Creatomate) have addressable timelines but cannot render your React
components. Prompt-to-video products give you pixels, not an editable project. Video models can
watch a file but cost tokens per second and cannot tell you the bounding box of a button. And
Remotion itself has deprecated its MCP in favor of agent skills: code is the source of truth,
the agent needs tools, not a chat. This repo is those tools.

## Status

Built in one day against a 59 second launch film with 35 scenes and two formats. Everything in
the loop above has run end to end on that film and on the example. Known gaps: the review player
has no auth (run it locally), `mh motion` on more than six scenes needs `--yes`, and Windows is
untested.

## License

MIT.
