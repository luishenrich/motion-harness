# motion-harness

Eyes and hands for AI agents that make videos. A CLI next to a React video project (the
Remotion API, rendered by its own engine or by Remotion), with skills for Claude Code, Codex,
Cursor and every agentskills.io client, and an MCP server for the hosts that do not have a
shell.

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

- **a native engine**: Vite serves the film through a shim of the Remotion API, Playwright drives
  Chrome one frame at a time over the devtools protocol, frames stream into ffmpeg. No Remotion
  install, no company license, no version pin. One still in 60 ms instead of 570, a 59 second
  film in 35 s instead of 51 (measured, `docs/benchmark-2026-09-06.md`), the same pixels as
  Remotion (the film's `interpolate`, `spring`, `Easing` and `random` are ports, pinned by tests
  against the real package). `--engine remotion` keeps the project's Remotion when you want it
- **stills, subtitles, voice, loudness, deliveries**: every `<Still>` linted like a frame, an SRT
  and burned captions from the timeline, voice lines synthesised and measured, loudness per
  platform, a delivery folder with per-platform copies, a manifest with sha1 and chapters, upload
- **a second opinion**: `mh judge` hands a clip to a model that watches video and returns
  findings with film times; `mh motion --reference` compares a scene's motion curve with a clip
- **receipts**: every command records what it produced, from which sources, with sha1

Nothing here replaces the React video model. It is the harness around it that agents need.

## Install

```bash
npx motion-harness help                        # or: bun add -g motion-harness; then mh help
mh init --project my-film                      # writes harness.config.ts
mh doctor --project my-film
```

Requirements: Bun 1.2+, ffmpeg on the PATH, a Chrome (the Remotion headless shell of the
project or the harness is found and reused; else `bunx playwright install chromium`, or set
`MH_CHROME`). Remotion is optional: with `engine: "native"` (or `--engine native`) the project
needs only `react`, `react-dom` and its own components; the `remotion` import resolves to the
shim. With the remotion engine the project's Remotion is used as is.

From source:

```bash
git clone https://github.com/luishenrich/motion-harness && cd motion-harness && bun install
bash examples/basic/make-assets.sh            # two generated audio files for the example
bun run src/cli.ts check --project examples/basic --engine native
```

Skills for agents: `npx skills add luishenrich/motion-harness` installs the loop, the feedback,
sound and delivery skills into Claude Code, Codex, Cursor or Gemini CLI. `mh mcp` serves the
same commands as MCP tools (`claude mcp add motion-harness -- mh mcp`).

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

One edit round in one command: `mh check --scene probe --format all` runs the project's
typecheck, one bundle, static and timeline lint, doctor, the cursor targets (below), check
frames with contact sheets and the rendered lint of the touched scenes, per format, and prints
one pass/fail table (exit 2 on failure).

Around the film, not only inside it:

```bash
mh frame turn+40 20.5s --format all         # exactly these frames, now; any address resolve accepts
mh still all --jpg --width 1280 --sheet     # every <Still> (thumbnails, covers, OG image) linted like a frame
mh srt --out film-en.srt                    # subtitles from the timeline (scene text, or `caption`)
mh render --format all --out-dir out/       # both formats, one command; size and bitrate per segment and film
mh deliver --out docs/.../deliverables --stills all
                                            # films, stills, srt, manifest (sizes, sha1, chapters), .gitignore for the mp4
```

## Any film, not one kind of film

The harness does not know what a "product film" is. A film is a timeline of scenes; a scene
is a text card, a clip of footage, a still, or whatever a component renders. From the top:

```bash
mh ingest footage/ --transcribe --look      # every file probed: streams, length, loudness, shot changes, silences, colour, its own bars,
                                            # a transcript with word times (Gemini listens, ffmpeg's silences sharpen the edges),
                                            # the subject of the mid frame with its box and kind (Gemini looks)
mh transcribe interview.mp4 --spans         # the spoken spans a silence cut would keep
mh look clip.mp4 --at 3.5                   # one frame: the subject, its kind (person, interface, scenery...), its box, readable text
mh new my-film --brief "..." --assets footage/ --transcribe --look
                                            # the script model sees the footage, its words and its subjects, writes scenes (text, clip,
                                            # image), places the voice note and a music bed as cues, picks a palette and Google fonts
                                            # from the brief; the scaffold writes a project the harness checks on the spot
```

The scaffold's components are starting points: a text card, a clip with a headline over a scrim,
a still with a slow zoom. Framing follows what ingest measured: the subject's box stays inside
every crop and caps the zoom and the push-in, so a vertical cut or a near-square clip in 16:9
never loses the person it is about; a clip that carries its own bars (dark on every sampled frame
and narrow) is zoomed past them as far as the subject allows; an interface is letterboxed in a
frame of the other orientation instead of cropped, a photo is cover-cropped; footage sits on the
ground its own edges blend into (a dark clip on ink, a bright one on paper) and each scene's exit
fades into that ground, never through the film's ink. `SHOW_VISUAL_NOTES`
in `Film.tsx` puts each scene's visual note on the frame while blocking. Everything after that is
the same loop as for any other film: `mh check`, `mh frame`, `mh render`, `mh deliver`.

From nothing to a checkable project, and out of the harness into an editor:

```bash
mh new my-film --brief "30 seconds: ..." --formats wide,vertical
                                            # a model writes the script (Azure, OpenRouter or OpenAI keys from the env),
                                            # the scaffold writes timeline, components, Root, config, installs react; mh check runs on it
mh image "a wooden desk from above, warm light" --width 1920 --height 1080
                                            # a plate from the image provider (Azure Foundry MAI or FLUX, OpenAI), fitted, registered
mh otio --out film.otio                     # the cut for Resolve, Premiere, Final Cut: a clip per scene on the rendered segments
mh clips add clip.mp4 --model kling --attempts 3 --credits 105 --license "Kling commercial"
                                            # generated clips with cost and rights; lint clip-colour-drift between consecutive clips
mh judge --scene probe                      # Gemini watches the clip and returns findings with film times (leads, not verdicts)
```

`mh lint --rendered` refuses a frames run rendered from an older bundle than the sources on
disk (`--allow-stale` reads it anyway). `mh audio` judges a short sfx cue by the peak of the
high-passed mix in a 60 ms window against the 200 ms before it, reports where a music file
becomes audible so a cold-start trim is read off, and treats a cue that ramps up from its own
start as a fade-in, not silence. A ramp that resolves before the film starts is a lint warning.
The project comes from `--project`, else `$MH_PROJECT`, else the cwd, else the last project used.

The film's one hand is timeline data too. Declare it on the film in `harness.config.ts`, and
`mh cursor` (or `mh check`) measures every leg with the DOM probe per format and writes the
`CURSOR_TARGETS` module the composition reads. Frame files are named by scene address
(`probe+14.png`); the part frame stays in `manifest.json`.

```ts
cursor: {
  legs: [["probe.pick1", "opt-0"], ["probe.next", "next"], ["probe.next+16", "park"]],
  out: { wide: "src/cursor-targets.ts", vertical: "src/cursor-targets-vertical.ts" },
}
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
src/cursor/     cursor legs -> probe-measured targets module per format (hover legs, dwell)
src/still/      every registered <Still> through the probe: lint, jpg, sheet
src/srt/        subtitles and chapter lines from the timeline
src/deliver/    a delivery folder with manifest and .gitignore
src/sheet/      contact sheets (sharp)
src/lint/       static colors, timeline rules, painted colors / safe zone / expected probes
src/diff/       frame set comparison with diff images
src/motion/     per-scene motion curve (renderFrames, small jpegs)
src/audio/      RMS profile via ffmpeg, short-cue audibility (high-passed peak), onsets, beat grid
src/film/       scene segments (cached), part audio, concat, mix from cues
src/review/     the review player (Bun.serve) and feedback export
src/cli.ts      mh
examples/basic  a two-part film whose compositions read the timeline
skill/SKILL.md  the agent skill
```

## Two engines

| | native | remotion |
|---|---|---|
| bundling | Vite dev server, one module transform per edit | webpack bundle, cached by source hash |
| browser | Playwright over the Remotion headless shell or any Chrome | @remotion/renderer's Chrome |
| one still, warm | 0.06 s | 0.57 s |
| 70 check frames with the probe | 4.3 s | 6.4 s |
| one 144 f segment, full quality, 4 pages | 2.1 s (70 f/s) | 3.5 s (41 f/s) |
| the 59 s film, 1760 frames, forced, one format | 35 s | 51 s |
| draft segment (half size, jpeg) | 3.3 s | 1.9 s (hardware encoder) |
| composition sound (`<Audio>`) | not rendered; sound is timeline cues (`part.audio: false`) | rendered |
| license | MIT | Remotion's, company license above three people |
| pixels | identical on static frames; moving text edges differ under 0.1 % of pixels | reference |

Both sit behind one `Engine` interface; segment caches, frames runs and receipts are keyed by
engine, so switching never reuses the other engine's pixels.

## Why not a JSON video editor, a video-understanding model, or an MCP

JSON render APIs (Shotstack, Creatomate) have addressable timelines but cannot render your React
components. Prompt-to-video products give you pixels, not an editable project. Video models can
watch a file but cost tokens per second and cannot tell you the bounding box of a button. And
Remotion itself has deprecated its MCP in favor of agent skills: code is the source of truth,
the agent needs tools, not a chat. This repo is those tools.

## Status

Built against a 59 second launch film with 23 scenes and two formats, and the film about the
tool itself (`examples/mh-film`, 21 seconds, native engine, no Remotion, rendered in 35 s for
both formats). Everything in the loop above has run end to end on both. Known gaps: `<Audio>`
inside a composition is not rendered by the native engine (sound is timeline cues), string
output ranges in `interpolate` are not ported, the review page's shared comments are only
verified against the type definitions, `mh voice` has not run against a live ElevenLabs key,
and Windows is untested. The market research behind the product direction and the release
order live in `docs/product.md`.

## License

MIT.
