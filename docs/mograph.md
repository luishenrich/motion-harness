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
  `design.colors`), a hex, or a gradient (see Colour).
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
| `shape` | `shape` (rect, circle, line, ring, path, polygon, star, arrow), `w`, `h`, `d`, `thickness`, `radius`, `fill`, `stroke`, `progress`, `viewBox`, `sides`, `inner`, `head`, `draw` | a ring draws `progress` of its circle (animate it with a `progress` track); a line grows with the `grow` preset; a path, an arrow and an outlined polygon or star draw themselves (see Shapes) |
| `image` | `src` (under public/), `w` or `h`, `fit`, `radius`, `shadow` | svg, png, jpg, webp |
| `counter` | `from`, `to`, `format` (0, 0,0, 0.0, 0%), `prefix`, `suffix`, `dur`, `size`, `weight`, `color`, `role`, `roll`, `pad` | counts over `dur` frames from its in, eased; a `progress` track takes over when given; `roll: true` makes it an odometer, `pad: 4` gives it leading zeros |
| `bars` | `values` [{label, value, color}], `max`, `direction`, `w`, `h`, `thickness`, `gap`, `color`, `labelSize`, `showValues`, `format` | bars grow one after another (`stagger` by item) |
| `list` | `items`, `marker` (dot, number, check, dash, none), `size`, `weight`, `color`, `markerColor`, `gap`, `maxWidth`, `align` | items arrive one after another; each item is a probe `<id>-<n>` |
| `line` | `points` (numbers or {x, y}), `labels`, `w`, `h`, `stroke`, `thickness`, `area`, `areaColor`, `dots`, `smooth`, `min`, `max`, `axis`, `labelSize`, `labelColor` | a line chart drawn left to right by its progress |
| `rings` | `values` [{label, value, color}], `max`, `d`, `thickness`, `gap`, `trackColor`, `legend`, `showValues`, `format`, `labelSize`, `labelColor` | concentric rings, one per value, one after another (`stagger` by item) |
| `particles` | `count` (400 at most), `color`, `size`, `speed`, `spread`, `seed`, `shape` (dot, line, confetti), `fade`, `w`, `h` | decoration; every particle is placed by the frame number and the seed, so two renders match. Set `probe: false` |

Common to every layer: `at`, `anchor`, `offset`, `opacity`, `scale`, `rotate`, `in`, `out`,
`tracks`, `colorTracks`, `effects`, `span` ([from, to] frames the layer exists), `probe: false`
(decoration, not checked), `formats`, `why`.

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
| `flip` | every character turns over on its own axis (text; `stagger` by char) |
| `track` | the letter spacing tightens from `distance` (30 = 0.3 em) to the layer's own (text) |
| `scramble` | the line resolves out of noise, left to right, the same letters at the same frame every time (text) |
| `fall` | the words drop in with a bounce (text; `stagger` by word) |
| `line-wipe` | one line at a time, revealed by a wipe from `from` (text; `stagger` by line) |

`out: { preset, at, dur, ease }` with `fade`, `sink`, `lift`, `shrink`, `slide`, `wipe`, `blur`, `cut`.
No `out` means the layer stays until the scene ends (the scene's own `exit` fade covers it).

`stagger: { by: word | char | line | item, each: frames, from: start | end | center }` delays each
unit; the scene's `<layer>Settled` event lands when the last unit has arrived.

## Easing as data

Built in: `linear`, `in`, `out`, `inOut`, `expo`, `quart`, `back`, `anticipate`, `smooth`, and the
springs `spring`, `soft`, `bouncy`, `snappy`. A film adds its own under `easings` as
`"cubic-bezier(x1, y1, x2, y2)"`, `"steps(n)"` or `{ "spring": { "damping", "stiffness", "mass" } }`.
Springs ignore `dur`; the timeline measures how long they take to settle.

## Colour

A colour field (`ground`, `fill`, `color`, `stroke`, `accent`, `markerColor`, `labelColor`,
`trackColor`, `areaColor`, `axis`) takes a design name, a hex, or a gradient:

```jsonc
"ground": { "gradient": ["ink", "deep"], "angle": 155 }
"fill":   { "gradient": ["accent", "rose"], "radial": true, "at": { "x": 0.3, "y": 0.4 } }
```

`angle` is css degrees (0 points up, 90 to the right), `at` is the centre of a radial gradient as
fractions of the box. Every stop must be a design colour or a hex; the lint checks each one. A
gradient stands for its first stop wherever one flat colour is needed (the contrast rule, a scene's
light or dark mood, an svg that cannot take a css gradient).

Colours animate with their own tracks, in frames local to the scene:

```jsonc
"colorTracks": { "fill": [{ "at": 40, "v": "accent" }, { "at": 90, "v": "teal", "ease": "inOut" }] }
"groundTracks": [{ "at": 0, "v": { "gradient": ["plum", "ink"] } }, { "at": 70, "v": { "gradient": ["deep", "ink"] }, "ease": "inOut" }]
```

Values in between are mixed in OKLab, so gold to teal stays colourful instead of passing through
grey. Two gradients of the same shape and stop count mix stop by stop; a gradient against a flat
colour turns the colour into a gradient of the same shape first; two gradients of different shapes
crossfade, the second over the first. The painted-colour lint would see the mixes as colours the
design never named, so a layer with a colour track carries `data-lint="color-track"` and the probe
leaves its colours out of the count. The stops themselves are still checked, statically, by
`lintFilm`.

`mh set design.colors.rose "#E86F7A"` adds a name; `mh set end.rule.colorTracks.fill '[{"at":0,"v":"accent"},{"at":40,"v":"teal"}]'` writes a track.

## Effects

```jsonc
"effects": { "shadow": { "y": 24, "blur": 60, "alpha": 0.28 },
             "glow": { "color": "accent", "blur": 40, "alpha": 0.6 },
             "stroke": { "color": "ink", "width": 3 },
             "highlight": { "color": "accent", "in": { "at": 20, "dur": 12 }, "pad": 8, "only": "marks" },
             "gradientText": ["accent", "rose"], "blend": "multiply", "roundCaps": true }
```

| effect | what it does |
|---|---|
| `shadow` | `x`, `y`, `blur`, `alpha`, `color`: a drop shadow that follows the shape of the layer, not its box |
| `glow` | `color`, `blur`, `alpha`: a tight core and a wide halo in the same colour |
| `stroke` | `color`, `width`: an outline around the glyphs of a text, a hugging ring around anything else |
| `highlight` | a marker rectangle that sweeps behind a text layer's words, or with `"only": "marks"` behind its `*marked*` words only; `in` gives it its own timing (default: just after the layer settles), `pad` and `radius` shape it |
| `gradientText` | two or more stops painted through the glyphs |
| `blend` | a css blend mode against what is behind the layer (`screen` lifts particles off a dark ground) |
| `roundCaps` | `false` squares off the ends of a drawn path, an arrow or a chart line |

The transform order is: place the box, move and scale it, apply the effects, then rotate. A shadow
therefore keeps falling the same way however far the layer is turned.

A highlight sweeps in the layer's own colour behind the words, so give the marked words a colour
that reads on the marker (`"accent": "ink"` on a gold marker) instead of leaving them gold on gold.

## Shapes

| shape | fields | notes |
|---|---|---|
| `path` | `d` (the path data), `viewBox` [w, h], `w`, `h`, `thickness`, `stroke`, `draw` | drawn by its progress through a normalised dash; `draw: false` fills it instead |
| `polygon` | `d` (diameter), `sides`, `fill`, `stroke`, `draw` | a regular polygon, first point at the top |
| `star` | `d` (diameter), `sides` (spikes), `inner` (0.44), `fill` | |
| `arrow` | `w`, `head`, `thickness`, `fill` | a shaft and a chevron, drawn like a path |

A drawn shape follows its own `progress` (or a `progress` track) when it has one, and otherwise the
progress of its `in`: `{ "preset": "fade", "at": 6, "dur": 26 }` writes the path over 26 frames.

## Charts

```jsonc
{ "id": "week", "type": "line", "points": [12, 18, 15, 26, 34, 48, 62], "labels": ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"],
  "w": 900, "h": 330, "stroke": { "gradient": ["teal", "accent"], "angle": 90 }, "area": true, "dots": true, "axis": "muted",
  "at": { "x": 0.5, "y": 0.55 }, "in": { "preset": "fade", "at": 10, "dur": 46 } }

{ "id": "dials", "type": "rings", "values": [{ "label": "colour", "value": 82, "color": "accent" }], "max": 100,
  "d": 330, "thickness": 30, "gap": 12, "in": { "at": 14, "dur": 22, "stagger": { "by": "item", "each": 6 } } }
```

The line is drawn left to right by the layer's progress, the area and the dots follow it. Rings are
concentric, the first value outermost, each ring drawn clockwise from the top with a faint track
behind it and a legend beside it (`"legend": false` drops the legend).

## Particles

```jsonc
{ "id": "dust", "type": "particles", "probe": false, "count": 70, "color": "accent", "size": 7,
  "speed": 0.9, "spread": 40, "seed": 7, "shape": "dot", "effects": { "blend": "screen" } }
```

Dots and lines drift up, confetti falls and turns. Every particle is placed from the seed and the
frame number alone, so the same frame always draws the same field and two renders match. 400 is the
cap the lint enforces; `probe: false` keeps the field out of the layout rules it would otherwise
cover.

## Tracks

`tracks: { opacity | x | y | scale | rotate | blur | progress | wipe | w | h: [{ at, v, ease }] }`,
frames local to the scene. An explicit track wins over what the preset would do to that property;
the other properties still follow the preset. `mh key hook.line.y 0 40 --ease out` adds a key.

## Templates

A template is a scene from a handful of parameters: `mh template add stat --param value=40 --param
label="milliseconds a frame"` writes the counter, the label and their timing into the film. After
that the layers are the truth and every one of them has an address, exactly as if they had been
written by hand. The scene keeps `template` and the parameters it was given, so
`mh template apply stat --param label="ms a frame"` builds it again from the same values.

```
mh template list                                  every template and the parameters it takes
mh template show stat --param value=40            what it writes, as the scene JSON
mh template add stat --param value=40 --after hook
mh template apply stat --param label="ms a frame"
```

| template | what it draws | params |
|---|---|---|
| `title` | an opening card: a kicker, a headline word by word, an accent rule | `title`, `kicker`, `size`, `rule` |
| `statement` | one claim and the line that carries it | `headline`, `support`, `size` |
| `stat` | one number that counts up, its label and a note | `value`, `from`, `format`, `prefix`, `suffix`, `label`, `note`, `size` |
| `list` | a kicker and items that arrive one after another, left aligned | `kicker`, `items`, `marker`, `size` |
| `compare` | two columns with their own headline and items, a rule between them | `left`, `leftItems`, `right`, `rightItems`, `marker`, `size` |
| `quote` | a quote line by line, a rule and who said it | `quote`, `attribution`, `size` |
| `lower-third` | a name and a role in the bottom left, behind an accent bar | `name`, `role`, `size` |
| `chart` | a headline and bars that grow one after another | `headline`, `values`, `direction`, `format`, `note` |
| `logo` | a mark, a wordmark and a tagline; the mark is an image when the film has one | `wordmark`, `tagline`, `src`, `size` |
| `cta` | a headline, a button shaped rectangle with its label and a url line | `headline`, `label`, `url`, `width` |
| `steps` | numbered steps across the frame, stacked in vertical | `headline`, `steps`, `size`, `connector` |
| `split` | two grounds: the text on one half, an image or a ring on the other | `headline`, `body`, `src`, `panel` |
| `kinetic` | one line word by word, filling the frame, with a slow camera push | `line`, `size`, `camera` |
| `countdown` | a number counting down inside a ring that fills | `from`, `to`, `label`, `seconds` |
| `end-card` | the closing frame: the name, an accent rule and where to go | `title`, `url`, `size` |

Every template also takes `ground` (ink, paper, accent, a design colour or a hex), `dur` (frames),
`exit` (frames of the closing fade, 0 for none) and `accent`. A `list` param is one string with
` | ` between the items (`--param items="a place | a look | a way in"`), a `pairs` param is
`label=number | label=number`. Leave a param out to take its default.

What a template decides for you:

- Colours come from the ground. A light ground gets ink text, a dark one paper text, support lines
  are muted on both. Accent paints shapes on every ground but text only on a dark one, because an
  accent lighter than the ink fails the contrast lint on paper. `--param accent=accent` overrides
  that when the film's accent is dark enough for both grounds (roughly a luminance between 0.13 and
  0.26).
- Grounds alternate. A scene whose `ground` is not given flips away from the scene before it, so a
  film built from templates breathes without being told to.
- The id is the template's name, made unique (`stat`, `stat-2`); `--id numbers` names it yourself.
- Every template ships the vertical overrides it needs: `compare` stacks its two columns, `steps`
  becomes a column, `split` puts its panel in the bottom half.
- An empty string drops the layer it belongs to: `--param note=""` leaves the note out.

Two templates draw a group (`lower-third`, `cta`) when the group runtime is there. Until it is,
they write the same children as flat layers, which is what `--no-groups` asks for and what
`GROUPS_RENDER` in `src/mograph/templates.ts` says today.

A film the model writes from a brief may answer with template scenes: `{ "id": "numbers",
"template": "stat", "params": { "value": 40 } }` with no layers. `normalizeFilm` expands them before
anything else reads the film, so what lands on disk is layers either way.

## What the harness checks

- After every edit: `lintFilm` (unknown colour, easing, preset, shape or effect; a gradient stop or
  a colour keyframe that is not a colour; an in past the scene; an out before the in has finished; a
  stagger that runs past the scene, or a preset that needs one and has none; text that does not hold
  long enough to read; a missing image; more particles than a frame may cost; ids).
- `mh check --format all`: the frames at every layer's in, settled and out, sheets per scene, the
  DOM probe (overflow, wrap, collision, contrast, safe zone, painted colours vs the design's; a
  layer whose colour is mid-track is left out of that last count, its stops are checked instead).
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
