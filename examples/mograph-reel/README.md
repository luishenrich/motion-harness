# mograph-reel

A 53 second showcase of motion graphics as data, in 1920x1080 and 1080x1920 from the same
`film.mograph.json`. Its subject is the harness itself: eyes and hands for agents that make
video, films as data, edit by address, check before render.

Every scene, layer and value was written by a command. `BUILD.md` is the log of that loop.

## Design

| | |
|---|---|
| ink | `#171233`, a deep indigo with a violet hue |
| paper | `#F3F1FB`, a cool lilac white |
| accent | `#5BE0B4`, mint, the signal colour |
| muted | `#837EA0`, a violet grey that clears 3:1 on both grounds |
| iris | `#6C5CE7`, the second voice: marked words, the pupil, the drawn check |
| ember | `#FF7A5A`, used once, on the third card of the travelling shot |
| deep | `#0B0819`, the dark end of every gradient |
| display | Bricolage Grotesque |
| body | Manrope |
| mono | JetBrains Mono |

Grounds alternate dark and light, scene by scene, so the film breathes.

## The film, scene by scene

| # | scene | in | what it shows | what it uses |
|---|---|---|---|---|
| 1 | `title` | 0.0s | "Motion graphics, as data" over a violet ground that settles into near black | template `title`, then edited by address; word stagger on a `mask` in; camera `push`; gradient ground with a `groundTracks` travel; the `swell` |
| 2 | `blind` | 3.8s | the problem: an agent cannot see what it renders | `dissolve` handover; a `highlight` marker sweeping behind the marked word |
| 3 | `file` | 8.0s | the whole film is one file | `push-up` handover; a `group` card with a shadow that pops as one, a `counter` inside it counting to 12 scenes |
| 4 | `address` | 12.8s | every value has an address | `wipe-left` handover; a `flip` in, character by character, on a mono command line |
| 5 | `travel` | 17.2s | a film is scenes, layers and tracks | `dip` handover; a travelling shot: a camera `x` track with three keys crossing three groups |
| 6 | `pass` | 22.9s | it checks before it renders | `zoom` handover; a `path` shape drawing itself by the progress of its in |
| 7 | `speed` | 27.1s | one frame, measured: 0.57 s against 0.06 s | `push-left` handover; a `bars` chart growing item by item |
| 8 | `lints` | 31.5s | three lints, every frame | `wipe-up` handover; a `scramble` headline; a `rings` chart filling ring by ring |
| 9 | `count` | 35.9s | 1594 frames in this film, every one with an address | `dissolve` handover; an odometer (`roll`) counter |
| 10 | `loop` | 39.9s | the round an agent runs | `push-down` handover; a numbered `list` arriving item by item; a `colorTracks` fill on the rule, mint to iris |
| 11 | `sting` | 44.7s | the mark: an eye over a field of particles | `zoom` handover; `particles` under the sting, a `glow` on the ring, a `track` in on the wordmark |
| 12 | `end-card` | 48.7s | the wordmark and where to go | template `end-card`, then edited by address; `dip` handover; the closing fade |

Sound: one hit per scene from the synthesised bank (`mh sounds --make`), and the swell under the
title. No music, including under the end card.

## The eight frames

Pulled out of the rendered wide film with ffmpeg, in flow order:

| file | film frame | moment |
|---|---|---|
| `frames/01-title-settled.png` | 40 | the kinetic title settled, the ground half way through its travel |
| `frames/02-card-with-counter.png` | 290 | the group card, its counter at 12 scenes |
| `frames/03-handover-wipe.png` | 391 | the wipe-left handover, the address scene arriving over the file scene |
| `frames/04-travel-mid.png` | 602 | the middle of the travelling shot, the camera between its second and third key |
| `frames/05-drawn-path.png` | 748 | the check mark, drawn |
| `frames/06-bars-chart.png` | 862 | the bars, both grown |
| `frames/07-particles-sting.png` | 1400 | the sting: the eye over the particle field |
| `frames/08-end-card.png` | 1512 | the end card |

## Where things are

| | |
|---|---|
| the film | `film.mograph.json` |
| the seed the project was scaffolded from | `seed.mograph.json` |
| the build log | `BUILD.md` |
| rendered films | `.harness/out/reel-wide.mp4`, `.harness/out/reel-vertical.mp4` |
| contact sheets | `.harness/frames/reel-wide/<run>/sheets/*.png` and the same under `reel-vertical` |
| frames for a report | `frames/*.png`, eight moments out of the wide film |
| sounds | `public/sfx/*.wav` |

## Working on it

From the repo root:

```
bun run src/cli.ts layers --project examples/mograph-reel
bun run src/cli.ts frame title.headlineSettled --format all --project examples/mograph-reel
bun run src/cli.ts check --format all --scene title,blind,file,address,travel,pass,speed,lints,count,loop,sting,end-card --project examples/mograph-reel
bun run src/cli.ts render --format all --project examples/mograph-reel
bun run src/cli.ts edit --project examples/mograph-reel
```
