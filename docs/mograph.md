# Motion graphics as data

A motion graphics film is one JSON file, `film.mograph.json`. Scenes hold layers; a layer is a
thing on screen with a place, a look, a way in, a way out and, when the presets are not
enough, keyframe tracks. The harness compiles the file into the timeline it already checks
(`mh check`, `mh frame`, `mh motion`, `mh review`), the compositions draw it, and every value has
an address an agent or the editor can change: `hook.line.size`, `hook.dur`, `design.accent`.

```
mh new spot --mograph --brief "20 seconds: ..."      a model writes the film from the brief, the project is scaffolded and checked
mh layers                                            every scene and layer, its timing and content
mh set hook.line.size 110                            change a value; the film is linted and the frame to look at is named
mh key hook.line.y 0 40 --ease out                   a keyframe on a track
mh frame hook.lineSettled --format all               look
mh check --format all                                the whole round: typecheck, lint, doctor, frames, sheets, rendered lint
mh edit                                              the editor in the browser: click a layer, nudge it, every change lands in the file
```

## Units and addresses

- Positions `at: { x, y }` are fractions of the frame (0..1). `anchor` says which point of the
  layer's box sits there (`center` by default; `left`, `top-left`, `bottom`...). `offset` adds u
  pixels.
- Sizes (font size, widths, gaps, strokes, distances) are u pixels: 1 u = 1 px when the short side
  of the frame is 1080 px, so the same number reads the same in 1920x1080 and in 1080x1920.
- Times are local frames inside the scene. A negative `at` counts from the scene's end
  (`out: { at: -12 }` starts twelve frames before the end).
- `maxWidth` of a text is a fraction of the frame width.
- Colours are design names (`ink`, `paper`, `accent`, `muted`, `white`, `black`, any key of
  `design.colors`) or a hex.
- Per format overrides: `formats: { vertical: { size: 80, at: { y: 0.4 } } }` on any layer.
- Addresses: `<scene>`, `<scene>.<prop>`, `<scene>.<layer>`, `<scene>.<layer>.<path.to.prop>`,
  `design.<prop>`, `defaults.<prop>`, `easings.<name>`, `audio.<id>.<prop>`.
- Moments: every layer gives the scene the events `<layer>In`, `<layer>Settled` and, when it has
  an out, `<layer>Out`, so `mh frame hook.lineSettled` and `mh resolve hook.ruleIn+6` work.

## The file

```jsonc
{
  "title": "Eyes and hands",
  "fps": 30,
  "design": { "ink": "#12151A", "paper": "#F2EEE6", "accent": "#F2B441", "muted": "#5F6670",
              "colors": { "teal": "#3FB9A8" }, "fontDisplay": "Sora", "fontBody": "Inter Tight", "fontMono": "JetBrains Mono" },
  "formats": { "wide": { "width": 1920, "height": 1080 }, "vertical": { "width": 1080, "height": 1920 } },
  "easings": { "settle": "cubic-bezier(0.2, 0.9, 0.1, 1)" },
  "defaults": { "enterFrames": 0, "layerIn": { "preset": "rise", "dur": 14, "ease": "out" } },
  "scenes": [
    { "id": "hook", "dur": 84, "ground": "ink", "exit": { "type": "fade", "dur": 8 }, "why": "the claim",
      "layers": [
        { "id": "line", "type": "text", "text": "An agent cannot *see* its own video.", "size": 104, "color": "paper",
          "at": { "x": 0.5, "y": 0.47 }, "maxWidth": 0.8,
          "in": { "preset": "rise", "at": 4, "dur": 16, "stagger": { "by": "word", "each": 3 } } },
        { "id": "rule", "type": "shape", "shape": "line", "w": 220, "thickness": 6, "fill": "accent",
          "at": { "x": 0.5, "y": 0.6 }, "in": { "preset": "grow", "at": 30, "dur": 14 } }
      ] }
  ],
  "audio": [{ "id": "bed", "kind": "music", "file": "music/bed.mp3", "at": "0s", "gain": 0.3, "fadeOut": 2 }]
}
```

## Layers

| type | fields | notes |
|---|---|---|
| `text` | `text`, `role` (display, body, mono), `size`, `weight`, `color`, `accent`, `align`, `lineHeight`, `letterSpacing`, `maxWidth`, `uppercase`, `lines` | `\n` breaks lines; `*word*` renders in the accent colour; `lines` is the expected line count for the wrap lint |
| `shape` | `shape` (rect, circle, line, ring), `w`, `h`, `d`, `thickness`, `radius`, `fill`, `stroke`, `progress` | a ring draws `progress` of its circle (animate it with a `progress` track); a line grows with the `grow` preset |
| `image` | `src` (under public/), `w` or `h`, `fit`, `radius`, `shadow` | svg, png, jpg, webp |
| `counter` | `from`, `to`, `format` (0, 0,0, 0.0, 0%), `prefix`, `suffix`, `dur`, `size`, `weight`, `color`, `role` | counts over `dur` frames from its in, eased; a `progress` track takes over when given |
| `bars` | `values` [{label, value, color}], `max`, `direction`, `w`, `h`, `thickness`, `gap`, `color`, `labelSize`, `showValues`, `format` | bars grow one after another (`stagger` by item) |
| `list` | `items`, `marker` (dot, number, check, dash, none), `size`, `weight`, `color`, `markerColor`, `gap`, `maxWidth`, `align` | items arrive one after another; each item is a probe `<id>-<n>` |
| `group` | `w`, `h` (the box, u), `layers`, and `fill`, `radius`, `stroke`, `thickness` to paint the box | a box its children live in; see Groups below |

Common to every layer: `at`, `anchor`, `offset`, `opacity`, `scale`, `rotate`, `in`, `out`,
`tracks`, `span` ([from, to] frames the layer exists), `probe: false` (decoration, not checked),
`formats`, `why`.

## In and out

`in: { preset, at, dur, ease, from, distance, stagger }`

| in preset | what moves |
|---|---|
| `cut` | arrives whole at `at` |
| `fade` | opacity |
| `rise` / `drop` | opacity and y from `distance` (32) below / above |
| `pop` | opacity fast, scale 0.7 to 1 with a back ease |
| `slide` | opacity and x or y from `from` (left, right, top, bottom) by `distance` (120) |
| `wipe` | a clip reveal from `from` |
| `grow` | width 0 to 1 from the left (lines, rects, bars) |
| `blur` | opacity and a blur of `distance` (14) px |
| `typewriter` | characters appear over `dur`, with a cursor (text) |
| `mask` | slides up out of an invisible slot (text; with `stagger` by line or word) |

`out: { preset, at, dur, ease }` with `fade`, `sink`, `lift`, `shrink`, `slide`, `wipe`, `blur`, `cut`.
No `out` means the layer stays until the scene ends (the scene's own `exit` fade covers it).

`stagger: { by: word | char | line | item, each: frames, from: start | end | center }` delays each
unit; the scene's `<layer>Settled` event lands when the last unit has arrived.

## Easing as data

Built in: `linear`, `in`, `out`, `inOut`, `expo`, `quart`, `back`, `anticipate`, `smooth`, and the
springs `spring`, `soft`, `bouncy`, `snappy`. A film adds its own under `easings` as
`"cubic-bezier(x1, y1, x2, y2)"`, `"steps(n)"` or `{ "spring": { "damping", "stiffness", "mass" } }`.
Springs ignore `dur`; the timeline measures how long they take to settle.

## Tracks

`tracks: { opacity | x | y | scale | rotate | blur | progress | wipe | w | h: [{ at, v, ease }] }`,
frames local to the scene. An explicit track wins over what the preset would do to that property;
the other properties still follow the preset. `mh key hook.line.y 0 40 --ease out` adds a key.

## Groups

A layer of type `group` is a box of `w` x `h` u at its position. Its children are layers like any
other, except that their `at` are fractions of that box, not of the frame. Sizes stay u pixels, so
one group reads the same in wide and in vertical.

```jsonc
{ "id": "panel", "type": "group", "w": 880, "h": 440, "fill": "paper", "radius": 32,
  "at": { "x": 0.5, "y": 0.47 }, "anchor": "center",
  "in": { "preset": "pop", "at": 16, "dur": 16, "ease": "back", "stagger": { "by": "item", "each": 5 } },
  "layers": [
    { "id": "card-title", "type": "text", "text": "One card", "size": 62, "color": "ink", "at": { "x": 0.5, "y": 0.26 }, "in": { "preset": "rise", "at": 4, "dur": 12 } },
    { "id": "card-rule", "type": "shape", "shape": "line", "w": 160, "fill": "accent", "at": { "x": 0.5, "y": 0.45 }, "in": { "preset": "grow", "at": 8, "dur": 12 } },
    { "id": "card-n", "type": "counter", "to": 3, "suffix": " layers", "size": 92, "color": "ink", "at": { "x": 0.5, "y": 0.7 }, "in": { "preset": "pop", "at": 12, "dur": 12 } }
  ] }
```

- The group's pose (opacity, x, y, scale, rotate, blur, wipe) applies to everything inside it, with
  the group's `anchor` as the transform origin. Pop the group and the whole card pops.
- A `stagger` by item on the group's `in` delays the children by their index: with `each: 5` the
  second child starts five frames after the first.
- A child's `in.at` counts from the group's in, after that delay. In the card above the group
  arrives at 16, so the title starts at 16 + 0 + 4 = 20, the rule at 16 + 5 + 8 = 29 and the counter
  at 16 + 10 + 12 = 38. `mh layers` prints the frame each layer really starts on.
- Groups nest. A group inside a group passes its own delay down.
- Addresses read down the tree: `card.panel.card-title.size`. `mh add layer card.panel '{...}'` adds
  into the group; `mh move`, `mh dup`, `mh remove` and `mh rename` work on a child the same way.
- Events keep the layer's own id, not the path: the title's moment is `card.card-titleIn`. A group's
  `<id>Settled` is the frame the last thing inside it stops moving, so `mh frame card.panelSettled`
  shows the finished card.
- Probes: the group's box carries `data-probe` with the group id, the children keep their own.
  `mh layout` treats a group as one block and never moves what is inside it.
- Two layers with the same id in one scene is an error, a group's children included: ids name events
  and probes, and those are flat.
- A group that paints itself (`fill`) is what a card is. Text on an unpainted group is read against
  the scene's ground by the contrast lint, which is the truth: a background rectangle next to the
  text is not behind it as far as the browser is concerned.

## Camera

A scene may carry one camera move. It is a single transform on the layer container, so the ground
stays where it is unless `camera.ground` is true.

```jsonc
"camera": { "preset": "push", "from": 1, "to": 1.06, "focus": { "x": 0.5, "y": 0.47 }, "ease": "linear" }
"camera": { "tracks": { "x": [{ "at": 44, "v": 55 }, { "at": 80, "v": 0, "ease": "inOut" }, { "at": 116, "v": -55, "ease": "inOut" }] } }
```

| preset | what moves | `from` and `to` |
|---|---|---|
| `push` | zoom in about `focus` | zoom factors, default 1 to 1.08 |
| `pull` | zoom out | zoom factors, default 1.08 to 1 |
| `pan` | x | u pixels, default 0 to 80 |
| `tilt` | y | u pixels, default 0 to 60 |
| `drift` | x, y and a touch of zoom | u pixels, default 0 to 40 |
| `orbit` | rotate and a touch of zoom | degrees, default 0 to 2 |
| `none` | nothing | |

- `at` and `dur` are the local frames the move runs over; without them it runs the whole scene.
  `ease` is any easing, `linear` by default, because a camera that accelerates reads as a mistake.
- `tracks` win over the preset per property: `zoom` is a factor, `x` and `y` are u pixels of travel,
  `rotate` is degrees, keys are local frames. A travelling shot is an `x` track with three keys.
  Before the first key the first value holds, so a move that starts at frame 44 keeps the frame
  offset from 0 to 44 and only then sets off.
- `shake: { "amount": 4, "seed": 1 }` adds a handheld wobble of up to `amount` u. It is seeded, so
  the same frame always renders the same pixels.
- `focus` is the point the zoom and the rotation turn around, fractions of the frame.
- The scene gets the event `cameraSettled` when the last camera key ends: `mh frame
  hook.cameraSettled --format all`.
- Everything is an address: `mh set hook.camera.to 1.1`, `mh set hook.camera.preset pull`,
  `mh set travel.camera.tracks.x '[{"at":0,"v":60},{"at":90,"v":-60,"ease":"inOut"}]'`.
- A zoom much above 1.2 pushes text towards the edge and the wrap lint starts reading the taller ink
  as an extra line. Keep pushes small; that is what they look like anyway.

## Scene transitions

A handover belongs to the scene that arrives. During its first `dur` frames the film view draws the
scene before it underneath, and the compiled timeline calls those frames the scene's `enter`, so
`mh resolve` says IN TRANSITION and the sheets mark them.

```jsonc
{ "id": "card", "dur": 120, "transition": { "type": "wipe-left", "dur": 14, "ease": "inOut" }, ... }
```

| type | what happens |
|---|---|
| `cut` | nothing, the scene is simply there |
| `dissolve` | the new scene fades up over the old one |
| `dip` | the old one fades to the film's ink, the new one comes out of it |
| `push-left`, `push-right`, `push-up`, `push-down` | both scenes travel that way, the new one arrives from the far side |
| `wipe-left`, `wipe-right`, `wipe-up`, `wipe-down` | the new scene is revealed by an edge travelling that way |
| `zoom` | the old scene grows away and fades, the new one settles in from slightly larger |
| `blur` | the two cross through a blur |

- The name says which way the movement goes: `push-left` and `wipe-left` both bring the new scene in
  from the right.
- The scene underneath holds its last frame. `"continue": true` keeps it playing instead, which only
  helps while something in it is still moving.
- A scene that hands over with a transition should not also carry an `exit` fade: the exit fades its
  content to the ground first, and the transition would then hold that faded frame. Drop the `exit`
  and let the transition do the work. `exit` is still right for a scene that ends on its own.
- The copy underneath carries no `data-probe` and `data-lint="none"`, so probes, collisions,
  contrast and wrapping stay the incoming scene's business and the check never reports the old scene
  twice.
- `dur` is clamped to what the two scenes can carry, and a handover longer than the scene itself is
  a lint error. Twelve to sixteen frames is a handover; thirty is a scene of its own.

## What the harness checks

- After every edit: `lintFilm` (unknown colour, easing, preset, camera preset, camera track or
  transition type; an in past the scene, a group's delay counted in; an out before the in has
  finished; a stagger that runs past the scene; a handover longer than the scene; a group box that
  does not fit a format; an empty group; text that does not hold long enough to read; a missing
  image; ids, a group's children included).
- `mh check --format all`: the frames at every layer's in, settled and out, sheets per scene, the
  DOM probe (overflow, wrap, collision, contrast, safe zone, painted colours vs the design's).
- `mh motion --scene hook`: when the scene settles and how long it holds, as numbers.
- `mh review`: the player; comments come back as `scene+frame`.

## Editing by hand

`mh edit` serves the film with an editor: the stage renders any frame, a layer list with the
addresses, an inspector for the selected layer. Click a layer on the stage or in the list, nudge it
with the arrow keys (shift for coarse), `[` `]` shift its in, `-` `=` its size, type any value in
the inspector; every change is written to `film.mograph.json` at once and the stage reloads.
Everything has a keyboard path and a label, so a computer-use agent operates it too.
