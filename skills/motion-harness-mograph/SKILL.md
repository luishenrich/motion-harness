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
| a whole scene from a template | `mh template add stat --param value=40 --param label="ms a frame" --after hook` (`mh template list` names all fifteen: title, statement, stat, list, compare, quote, lower-third, chart, logo, cta, steps, split, kinetic, countdown, end-card; the layers are editable by address after that, `mh template apply` builds one again from its params) |
| stacked blocks touch | `mh layout stat` (pushes them apart per format, keeps them in the safe band) |
| a value | `mh get hook.line` |
| by hand, in a browser | `mh edit` (click a layer, arrows nudge, [ ] in, - = size, z undo; the file changes at once) |

Every edit prints the lint of the whole film (unknown colour, easing or preset; an in past the
scene; an out before the in; a stagger that runs past the scene; text that does not hold long enough
to read; a missing image) and names the frame to look at. Look at it. Then `mh check --scene <id>
--format all` for the rendered lints (overflow, wrap, collision, contrast, safe zone, painted
colours) and the sheets.

## Colour, effects and the drawn kinds

| want | write |
|---|---|
| a gradient anywhere a colour goes | `mh set hook.ground '{"gradient":["ink","deep"],"angle":155}'` (radial: `{"gradient":[...],"radial":true,"at":{"x":0.3,"y":0.4}}`) |
| a colour that changes | `mh set end.rule.colorTracks.fill '[{"at":40,"v":"accent"},{"at":90,"v":"teal","ease":"inOut"}]'`, the ground with `groundTracks` (mixed in OKLab) |
| a shadow, a glow, an outline | `mh set count.big.effects '{"shadow":{"y":26,"blur":60,"alpha":0.4}}'`, `{"glow":{"color":"accent","blur":30}}`, `{"stroke":{"color":"ink","width":3}}` |
| a marker behind the words | `mh set sweep.head.effects.highlight '{"color":"accent","only":"marks","pad":12,"in":{"at":26,"dur":16}}'` (give the marked words a colour that reads on the marker) |
| gradient text, a blend mode | `mh set chart.head.effects.gradientText '["accent","rose"]'`, `mh set hook.dust.effects.blend screen` |
| text that flips, tracks, scrambles, falls, wipes line by line | `mh set hook.title.in '{"preset":"flip","at":4,"dur":12,"stagger":{"by":"char","each":2}}'`, also `track`, `scramble`, `fall` (by word), `line-wipe` (by line) |
| a shape that draws itself | `{"type":"shape","shape":"path","d":"M8 54 L44 90 L112 12","viewBox":[120,100],"w":240,"thickness":10,"stroke":"accent"}`, plus `polygon` (sides), `star`, `arrow` |
| an odometer | `mh set count.big.roll true`, `mh set count.big.pad 4` |
| charts | `{"type":"line","points":[12,18,26,48],"labels":["Mo","Tu","We","Th"],"area":true,"dots":true}`, `{"type":"rings","values":[{"label":"colour","value":82,"color":"accent"}],"max":100}` |
| particles | `{"type":"particles","probe":false,"count":70,"color":"accent","shape":"dot","speed":0.9,"seed":7}` (dot, line, confetti; 400 at most, deterministic) |

`examples/mograph-effects` is 24 seconds that show every one of these.

## Rules of thumb the lint does not enforce

- One idea per scene, two or three layers, four at most. Alternate grounds.
- A headline of n words holds 1.2 s plus 0.25 s per word over four after its last word arrives.
- The first layer arrives at frame 0 to 6, the next 8 to 16 frames later; nothing arrives in the last 20 frames of a scene.
- Staggers: a headline by word (each 2 to 4), a list by item (each 6 to 10), bars by item (each 5 to 8).
- Vertical needs its own `formats.vertical` for size, `at`, `maxWidth` and `w` when a block sits high or a line wraps; `mh layout` fixes stacking, not taste.
- Units: positions are fractions of the frame, sizes are pixels at a 1080 px short side, times are local frames.
- Keep the film in the JSON. If a look needs code, add a layer type to the harness runtime, not a one-off component.
