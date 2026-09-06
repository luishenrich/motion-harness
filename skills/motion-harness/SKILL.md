---
name: motion-harness
description: Work on a React video (Remotion API, rendered by the native engine or Remotion) with eyes and hands. Use whenever you edit, review, or verify a film that has a harness.config.ts: resolve feedback like "second 21" or "the check button clicks too late" to a scene and frame, render exact frames and contact sheets in seconds instead of full renders, read element boxes and painted colors from the DOM, measure motion, mix the film from the timeline, render both formats, and read comments from the review player. Triggers: remotion, mh, motion-harness, launch film, product video, scene, beat, contact sheet, timeline, review comments, too fast, too slow, frame, render.
---

# motion-harness for agents

You are working on a video project that carries a `harness.config.ts`: React components with
the Remotion API (`useCurrentFrame`, `Sequence`, `interpolate`, `spring`) and a timeline as
data. The CLI is `mh` (`npx mh`, the `mh` bin, or `bun run <harness repo>/src/cli.ts <cmd>`);
the project is `--project <dir>`, `$MH_PROJECT`, the cwd, or the last one used. Two engines
render it: `native` (Vite + Playwright, no Remotion install, a frame in about 40 ms, a
60 second film in about a minute) and `remotion` (the project's Remotion). Prefer
`--engine native` (or `engine: "native"` in the config); the frames are the same pixels.

The commands that make up one edit round, in order: `mh resolve` (what is at that moment),
`mh frame` (look at it), edit, `mh check --scene <id> --format all` (typecheck, lint, doctor,
cursor targets, sheets, rendered lint), `mh diff` (what else moved), `mh render --format all`.
Every command leaves a receipt in `<cache>/receipts/` with its outputs and their sha1.

## The one rule

Never guess where something is in time and never guess what a frame looks like. Ask the harness.

## Vocabulary

- **film** = the assembled video. **part** = one Remotion composition (e.g. `opening`, `product`).
  **scene** = one beat inside a part, with a duration in frames. **event** = a named local frame
  inside a scene (`probe.pick1`). All of it lives in the timeline in `harness.config.ts` (or a
  `timeline.ts` it imports).
- Address moments as `scene+local` (`probe+14`), `scene.event` (`probe.pick1`), `scene.event+6`,
  film seconds (`21s`), film frames (`f630`), part frames (`product:f310`), or `#index`.
  `mh resolve` turns any of them into all of them.

## Loop for feedback from a human

1. `mh feedback` reads the review player's comments. Each one is already a scene and a local
   frame. If the human spoke in seconds or "picture 2", run `mh resolve 21s` first. Seconds
   drift whenever the film changes length; scene addresses do not.
2. `mh frames --scene <id> --probe text --sheet` renders the scene's check frames (enter,
   settled, every event and event+6, mid, last) and one contact sheet with a border and a label
   per cell. Orange cells are inside a transition and are never a defect by themselves.
   Read the sheet with the Read tool. Do not read forty single frames.
3. `mh probe probe.pick1 --find "Next"` tells you where an element is, its box, color, font,
   and whether it is visible. Use it instead of measuring pixels. Cursor targets come from here.
4. Edit the composition. Keep timing in the timeline; if you add a moment worth addressing, add
   it as an event. Then `mh frames --scene <id> --sheet` again and `mh diff` to see what else
   changed (only changed frames are listed, with a diff image each).
5. For "too fast", "nothing stands still", "it pops": `mh motion --scene <id>`. It renders every
   frame small and reports when the scene settles, how long it holds, and where it jumps, against
   the rules in the timeline.
6. Before handing over: `mh lint --rendered` (painted colors vs design tokens, safe zone,
   expected probes visible), `mh doctor` (composition length vs timeline), `mh render --web`,
   `mh audio` (silence, every cue checked), `mh beats` (cuts vs onsets and the music's beat grid),
   then tell the human to open `mh review`.

## What each command answers

| question | command |
|---|---|
| what is at 20.5 s, or at probe.pick1 | `mh resolve 20.5s probe.pick1` |
| show me the whole cut as a table | `mh timeline` (`--json` for machines) |
| is the code still the timeline | `mh doctor` (reports DRIFT with the frame delta) |
| what does scene X look like | `mh frames --scene X --sheet` then Read the sheet |
| where is the button, what color is that text | `mh probe X.event --find text` |
| did my change move anything else | `mh frames --tag after` then `mh diff before after` |
| is it too fast, does it hold still | `mh motion --scene X` |
| wrong colors anywhere | `mh lint --static` (source) and `mh lint --rendered` (painted) |
| give me the film | `mh render --web` (segments are cached per scene, music is mixed from the timeline) |
| is there sound where there should be | `mh audio` |
| do the cuts land on the beat, which scene lengths to change | `mh beats --suggest --part <id>` |
| what did the human say | `mh feedback` (`--all` includes done items) |
| the edit list as markdown for docs | `mh docs --out path.md` |
| show me exactly frame turn+40 (not the nearest check frame) | `mh frame turn+40 --format all` (any address; `--crop x,y,w,h`) |
| are the thumbnails, cover and OG image right | `mh still all --jpg --width 1280 --sheet` (linted like frames: overflow, wrap, collision) |
| the subtitle file, the chapter list | `mh srt --out film-en.srt`, `mh srt --chapters` (scene `text`, or `caption` for silent scenes) |
| both formats rendered | `mh render --format all --out-dir dir` (size and bitrate per segment and film in the log) |
| is that 150 ms key heard under the bed | `mh audio`: per sfx cue the >2 kHz peak delta in dB, AUDIBLE / FAINT / MASKED |
| where does the music become audible (cold start trim) | `mh audio`: "audible from X s" and the 0-3 s head profile per music file |
| hand everything over | `mh deliver --out dir --stills all --platforms youtube,tiktok --captions [--upload prefix]` |
| a new film from a brief | `mh new <dir> --brief "..." [--assets footage/ --transcribe]` (footage probed and transcribed, script by a model with scene kinds text, clip, image and sound cues, palette and fonts from the brief, project scaffolded, `mh check` runs on it) |
| what is in this footage | `mh ingest <files> --transcribe` (assets.json: streams, loudness, shot changes, silences, transcript), `mh transcribe <file> --spans` |
| thumbnails to A/B test | `mh still <id> --variants --jpg --width 1280` (variants declared in `films.<film>.stills`, one file per variant) |
| a background plate, a start frame | `mh image "<prompt>" --width --height` (no text from the model; typography stays in the still) |
| the editor wants the cut | `mh otio --out film.otio` (Resolve, Premiere, Final Cut) |
| generated clips: cost, rights, colour drift | `mh clips add ... --license`, `mh lint --clips` |
| text readable on its ground | `mh lint --rendered` (rule `contrast`, WCAG AA: 4.5:1 body, 3:1 large) |

`mh lint --rendered` refuses a run rendered from an older bundle than the sources (the frames
would describe the previous edit); it renders fresh ones, or `--allow-stale` reads the old run.
The project is `--project`, else `$MH_PROJECT`, else the cwd, else the last one used, so a shell
whose cwd reset still hits the right film (the log says which one when it was not the flag).

## One hand for the whole film (cursor targets from the probe)

Do not keep a cursor per scene with hand-typed coordinates. Give every click target a
`data-probe` key, put ONE cursor component above all scenes in film px, and let the probe
measure the targets at their event frames:

```bash
mh probe probe.pick1 --key opt-0 --json     # -> {"partFrame":324,"x":960,"y":439,...}
mh probe exam.day --key day7 --json
```

A small project script loops over `scene.event -> key`, writes a generated `cursor-targets.ts`
(part frame, x, y, click), and adds parking spots off frame after each group. The cursor swings
between targets (leave late, arrive on the frame, an arc, a trail), presses on click targets, and
is never in a scene's coordinate space, so it survives every cut and wipe. Re-run the script
after any layout change; `mh doctor` does not catch stale targets, the sheet does.

Contact sheets are too small to judge a 50 px cursor, its trail or a ripple. For those, crop the
full frame (`out/.../frames/<tag>/<part>/f<partFrame>.png`) and read the crop.

A leg whose key ends in `?` is a hover: the hand travels there and rests without a press
(a change of mind before the real click). A third element `{ dwell: 10 }` keeps it there ten
frames past the usual hold before it may leave: `["probe.optD", "opt-d?", { dwell: 10 }]`.

## Reading a contact sheet

Each cell: title `scene+local`, subtitle `film time · film frame · part frame · reason`. Border
colors: orange = in transition, blue = named event (or event+6), gray = settled, mid, last,
purple = a `checkFrames` entry. Judge composition, copy, alignment, state (is the right answer
selected, is the button present), and consistency between cells. Do not judge motion from a
sheet; use `mh motion`. Do not report a wipe edge in an orange cell.

## Things that look like defects and are not

- An orange (transition) cell with a hard edge or a half-faded element.
- A black first frame of a part that opens with a cut from black (check the timeline `why`).
- Text with `opacity 0` at `settled` when its event comes later (check `mh probe` for the event).

## Writing timing

Scene lengths and events belong in the timeline. Components read them (see `examples/basic`).
If a literal like `const tapAt = 26` sits in a component, mirror it as an event in the timeline
first (so `mh` can address it), then move it out when you touch the file. Do not add a second
copy of the numbers in prose; `mh docs` generates the prose.
