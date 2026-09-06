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

## Templates

A template is a scene from a handful of parameters: `mh template add stat --param value=40 --param
label="milliseconds a frame"` writes the counter, the label and their timing into the film. After
that the layers are the truth and every one of them has an address, exactly as if they had been
written by hand. The scene keeps `template` and the parameters it was given, so
`mh template apply stat --param label="ms a frame"` builds it again from the same values.

```
mh template list                                  every template with its parameters and their defaults
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

- After every edit: `lintFilm` (unknown colour, easing or preset; an in past the scene; an out
  before the in has finished; a stagger that runs past the scene; text that does not hold long
  enough to read; a missing image; ids).
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
