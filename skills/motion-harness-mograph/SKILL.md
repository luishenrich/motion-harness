---
name: motion-harness-mograph
description: Build and edit pure motion graphics films (typography, shapes, counters, lists, bars, rings, a logo) as data with the motion-harness CLI. Use when a film has a film.mograph.json, when asked for a title sequence, a stat card, a kinetic typography spot, a lower third, an explainer without footage, or to change one layer's timing, place, size or colour by address.
---

# Motion graphics as data

A motion graphics film is one JSON file, `film.mograph.json`: scenes of layers with a place, a
look, a way in, a way out, optional keyframe tracks. You never write React for it. You write or
edit the data by address, the harness lints every edit, and you look at the frame it names.
Reference: `docs/mograph.md` in the harness repo (`mh help` lists the commands).

## From a brief

```
mh new spot --mograph --brief "20 seconds for ..." --seconds 20        # the model writes the film, the scaffold draws it, mh check runs
mh layers                                                                # every scene and layer: address, timing, content
mh frame hook.lineSettled --format all                                   # look at the frame the film names
mh check --format all                                                    # the whole round
mh render --format all
```

## Editing by address

| want | command |
|---|---|
| move a layer | `mh set hook.line.at '{"x":0.5,"y":0.42}'` |
| size, colour, text | `mh set hook.line.size 110`, `mh set hook.line.color accent`, `mh set hook.line.text "Every *app* forgets"` |
| when it arrives, how | `mh set hook.line.in '{"preset":"rise","at":6,"dur":16,"stagger":{"by":"word","each":3}}'` or `mh set hook.line.in.at 6` |
| when it leaves | `mh set hook.line.out '{"preset":"sink","at":-14,"dur":12}'` (negative at counts from the scene end) |
| a keyframe | `mh key hook.line.y 0 40 --ease out` then `mh key hook.line.y 20 0` (tracks: opacity x y scale rotate blur progress wipe w h) |
| scene length, ground | `mh set hook.dur 96`, `mh set hook.ground paper` |
| the palette, the fonts | `mh set design.accent "#FF6B35"`, `mh set design.fontDisplay "Sora"` |
| add, remove, order | `mh add layer hook '{"id":"rule","type":"shape","shape":"line","w":220,"fill":"accent","at":{"x":0.5,"y":0.6},"in":{"preset":"grow","at":30}}'`, `mh remove hook.rule`, `mh move stat --after hook`, `mh dup hook --as hook-b`, `mh rename hook opening` |
| a whole scene | `mh add scene '{"id":"stat","dur":90,"ground":"paper","exit":{"type":"fade","dur":8},"layers":[...]}' --after hook` |
| stacked blocks touch | `mh layout stat` (pushes them apart per format, keeps them in the safe band) |
| a value | `mh get hook.line` |
| by hand, in a browser | `mh edit` (click a layer, arrows nudge, [ ] in, - = size, z undo; the file changes at once) |

Every edit prints the lint of the whole film (unknown colour, easing or preset; an in past the
scene; an out before the in; a stagger that runs past the scene; text that does not hold long enough
to read; a missing image) and names the frame to look at. Look at it. Then `mh check --scene <id>
--format all` for the rendered lints (overflow, wrap, collision, contrast, safe zone, painted
colours) and the sheets.

## Rules of thumb the lint does not enforce

- One idea per scene, two or three layers, four at most. Alternate grounds.
- A headline of n words holds 1.2 s plus 0.25 s per word over four after its last word arrives.
- The first layer arrives at frame 0 to 6, the next 8 to 16 frames later; nothing arrives in the last 20 frames of a scene.
- Staggers: a headline by word (each 2 to 4), a list by item (each 6 to 10), bars by item (each 5 to 8).
- Vertical needs its own `formats.vertical` for size, `at`, `maxWidth` and `w` when a block sits high or a line wraps; `mh layout` fixes stacking, not taste.
- Units: positions are fractions of the frame, sizes are pixels at a 1080 px short side, times are local frames.
- Keep the film in the JSON. If a look needs code, add a layer type to the harness runtime, not a one-off component.
