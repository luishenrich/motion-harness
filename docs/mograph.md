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

## What the harness checks

- After every edit: `lintFilm` (unknown colour, easing or preset; an in past the scene; an out
  before the in has finished; a stagger that runs past the scene; text that does not hold long
  enough to read; a missing image; ids).
- `mh check --format all`: the frames at every layer's in, settled and out, sheets per scene, the
  DOM probe (overflow, wrap, collision, contrast, safe zone, painted colours vs the design's).
- `mh motion --scene hook`: when the scene settles and how long it holds, as numbers.
- `mh review`: the player; comments come back as `scene+frame`.

## Editor

`mh edit` serves the film at `/__mh/edit`: the stage draws any frame, and every gesture is an op
posted to `/__mh/film`, written into `film.mograph.json` at once, linted, and drawn again without a
reload.

- Stage. Over 1300 px wide the pane shows two formats side by side, both at the same frame and with
  the same selection; narrower, one stage and a format toggle. Click a layer on a stage to select
  it, shift-click to add to the selection. The tag on a pane says which format the inspector edits.
  With "edit this format only" on, writes go to `formats.<format>` instead of the layer.
- Timeline strip. One row per layer of the scene, group children indented, the width of the scene.
  The bar runs from the layer's in to its out (or the scene's end); the lighter parts are the in and
  the out durations; the diamonds are the keyframes of every track; the red line is the playhead.
  Drag a bar to move `in.at` (an `out.at` moves with it), drag its right edge to set `out.at`, drag
  a diamond to move a keyframe. Click a track to seek. Tab to a bar, an edge or a diamond and the
  arrow keys move it, shift for five frames.
- Layers and inspector. The list shows `scene.layer` and, nested under a group, `scene.group.child`.
  The inspector shows the layer's position, its in and its out, then every other field it carries:
  colours as swatches of the design's colours with a hex or token input and a two stop gradient with
  an angle, numbers as number fields, and anything it does not know as a labelled JSON input, so
  nothing in the file is out of reach. The scene section carries `dur`, `ground`, the exit fade,
  `why`, the camera (preset, from, to, focus, ease) and the transition into the scene (type, dur).
- Selection. Align left, centre, right, top, middle or bottom, and distribute across or down, write
  each selected layer's `at` in one batch. The arrow keys, `[` `]`, `{` `}` and `-` `=` act on the
  whole selection.
- Undo and redo with `z` and `shift+z` or the buttons; the history list names the ops of the session.
  The lint runs after every change and lists what it found.
- For an agent: `#mh-state` is the whole state as text (format, scene, frame, selection, the selected
  layer, the address a nudge would write to, the op count, the findings), and `window.mhEdit` has
  `state()`, `select(addr)`, `set(addr, value)`, `op(op)`, `frame(n)`, `play()`, `reload()`,
  `selection()`, `undo()` and `redo()`. Every control has an aria-label, the focus is visible, and
  every gesture has a keyboard path.

Keys: arrows nudge (shift coarse), `[` `]` in earlier or later, `{` `}` out earlier or later,
`-` `=` smaller or larger, `,` `.` one frame, `j` `l` one second, `space` play, `d` duplicate,
`Backspace` remove, `z` undo, `shift+z` redo, `Esc` deselect.

Beyond the ops of `mh set`, `mh key` and friends, the editor posts two of its own: `batch` (many ops
as one save and one undo step, what align and a multi-selection nudge send) and `move-key` (a
keyframe moved to another frame, value and easing kept). An address into a group child
(`scene.group.child.prop`) is resolved to the index path underneath.
