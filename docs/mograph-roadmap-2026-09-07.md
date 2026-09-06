# Motion graphics as data: the build-out (night of 2026-09-06 to 07)

The state at the start: `film.mograph.json` with scenes of layers (text, shape, image, counter,
bars, list), in/out presets, staggers, easing as data, keyframe tracks, per format overrides;
`src/mograph/{schema,easing,pose,layout,runtime,timeline,edit,script,serve}.ts`; `mh layers/get/
set/unset/key/unkey/add/remove/move/dup/rename/layout/edit`, `mh new --mograph`; `examples/mograph`;
`docs/mograph.md`. Everything below extends that vocabulary. Several agents build in parallel, so
this file is the contract: same names, same units, same file ownership.

## Units, unchanged

Positions are fractions of the frame (0..1), sizes are u pixels (1 u = 1 px at a 1080 px short
side), times are local frames, colours are design names or hex, addresses are `scene.layer.path`.

## 1. Groups (`type: "group"`)

```jsonc
{ "id": "card", "type": "group", "at": { "x": 0.5, "y": 0.5 }, "anchor": "center", "w": 900, "h": 520,
  "in": { "preset": "pop", "at": 4, "dur": 14, "stagger": { "by": "item", "each": 4 } },
  "layers": [ { "id": "bg", "type": "shape", "shape": "rect", "w": 900, "h": 520, "radius": 28, "fill": "paper", "at": { "x": 0.5, "y": 0.5 } },
              { "id": "title", "type": "text", "text": "Plan", "at": { "x": 0.5, "y": 0.3 }, "size": 64 } ] }
```

- The group is a box of `w` x `h` u at its position; children's `at` are fractions of that box.
- The group's pose (opacity, x, y, scale, rotate, blur, wipe) applies to all children, transform
  origin at the group's anchor point. A stagger `by: "item"` on the group's `in` delays children by
  their index; a child's own `in` is relative to the group's in (child `in.at` counts from the
  group's `inAt`).
- Groups nest. Addresses: `scene.card.title.size`; events: `sceneid.cardIn`, `cardSettled`.
- Probe: the group root carries `data-probe` = group id; children keep their own.

## 2. Camera (`scene.camera`)

```jsonc
"camera": { "preset": "push", "from": 1.0, "to": 1.08, "focus": { "x": 0.5, "y": 0.45 }, "ease": "linear",
            "tracks": { "zoom": [...], "x": [...], "y": [...], "rotate": [...] }, "shake": { "amount": 4, "seed": 1 } }
```

- Presets over the whole scene: `push` (zoom from..to about focus), `pull`, `pan` (x from..to, u
  pixels), `tilt` (y), `drift` (slow diagonal), `orbit` (slight rotate + zoom), `none`.
- Tracks win over the preset per property; `zoom` is a factor, `x`/`y` are u pixels of travel,
  `rotate` degrees. A "Fahrt" (travelling shot) is a `x` or `y` track with several keys and an
  ease.
- Implemented as one transform on the scene's layer container (not the ground), so grounds and
  gradients stay put unless `camera.ground: true`.
- The timeline gets an event `cameraSettled` when the last camera key ends.

## 3. Scene transitions (`scene.transition`)

```jsonc
"transition": { "type": "push-left", "dur": 12, "ease": "inOut" }
```

- Belongs to the incoming scene: during its first `dur` frames the previous scene is still drawn
  and leaves. Types: `cut`, `dissolve`, `dip` (through the film's ink), `push-left/right/up/down`,
  `wipe-left/right/up/down`, `zoom` (the previous scene scales into the new one), `blur`.
- The film view renders the previous scene's last frame frozen (or continuing, `continue: true`)
  under the transition. The compiled timeline marks the frames as the scene's `enter`
  transition (`inTransition` true), so sheets and lints stay quiet there.
- `exit` on a scene stays what it is (a fade of the content over the ground).

## 4. Colour

- Any colour field (`ground`, `fill`, `color`, `stroke`, `accent`, `markerColor`) accepts a
  gradient: `{ "gradient": ["ink", "#0F3D5E"], "angle": 160 }` (linear) or
  `{ "gradient": ["accent", "rose"], "radial": true, "at": { "x": 0.3, "y": 0.4 } }`.
- Colour tracks animate colour fields: `"colorTracks": { "fill": [{ "at": 0, "v": "accent" }, { "at": 30, "v": "rose", "ease": "inOut" }] }` on a layer, `"groundTracks": [...]` on a scene. Interpolation in OKLab (fall back to sRGB when a stop is a gradient: crossfade the gradient).
- The design may name more colours; `mh set design.colors.rose "#E86F7A"`.
- The painted-colour lint keeps its tokens: every stop of a gradient or a track must be a design colour or a hex; the lint tolerates intermediate colours between two keys of a track (mark such elements with `data-lint="color-track"` so the rendered lint skips them).

## 5. Effects (`layer.effects`) and text effects

```jsonc
"effects": { "shadow": { "y": 24, "blur": 60, "alpha": 0.28 }, "glow": { "color": "accent", "blur": 40, "alpha": 0.6 },
             "stroke": { "color": "ink", "width": 3 }, "highlight": { "color": "accent", "in": { "at": 20, "dur": 12 }, "pad": 8 },
             "gradientText": ["accent", "rose"], "blend": "multiply", "roundCaps": true }
```

- `highlight` sweeps a marker rectangle behind a text layer's words (or the `*word*` spans only,
  `"only": "marks"`).
- New text in presets: `flip` (per character 3D flip, needs `stagger.by: "char"`), `track`
  (letter-spacing from wide to the layer's own), `scramble` (characters resolve left to right),
  `fall` (words drop with a bounce), `line-wipe` (each line revealed by a wipe).
- New shape features: `path` shapes (`"shape": "path", "d": "M...", "viewBox": [w, h]`, drawn with
  a `progress` track: stroke-dashoffset), `arrow`, `polygon` (`sides`), `star`.
- A `particles` layer (`type: "particles"`, `count`, `color`, `size`, `speed`, `spread`, `seed`, `shape: dot|line|confetti`): deterministic (seeded) so frames are stable.
- Counter effects: `"roll": true` (odometer digits), `"pad": 3`.
- Bars: `direction: "vertical"` already; add `"line"` charts (`type: "line"`, `points`, `stroke`, `area`) and `"ring"` charts (`type: "rings"`, `values`).

## 6. Templates as data (`src/mograph/templates.ts`, `mh template`)

- A template is a function `(params) => MgScene` plus a manifest `{ name, description, params: { name: { type, default, help } } }`.
  At least these ten: `title` (headline, optional kicker), `statement` (headline + support line),
  `stat` (counter + label + note), `list` (kicker + items), `compare` (two columns, two headlines,
  two lists), `quote` (quote + attribution), `lower-third` (name + role, in a group, left bottom),
  `chart` (headline + bars), `logo` (image + wordmark, end card), `cta` (headline + button-shaped
  rect + url line), plus `steps` (numbered horizontal steps), `split` (two grounds, text left,
  image or shape right), `kinetic` (one line word by word with a camera push), `countdown`, `end-card`.
- Every template writes plain layers into the scene (`scene.template` and `scene.params` record
  where it came from); after that the layers are the truth and editable by address.
- `mh template list`, `mh template show <name>`, `mh template add <name> [--param k=v ...] [--after id] [--id x]`,
  `mh template apply <scene> <name>` (re-expand a scene from its params).
- The script model (`MG_SYSTEM` in `script.ts`) may return `{ "template": "stat", "params": {...} }` scenes; `normalizeFilm` expands them.

## 7. Editor (`src/mograph/serve.ts`)

- A timeline strip under the stage: one bar per layer with its in, settled and out; drag a bar to
  move `in.at`, drag its right end for `out.at`; keyframes as diamonds on the bar; the playhead.
- Camera and group controls in the inspector; colour fields as swatches of the design colours plus
  a hex input; gradient editor for two stops.
- Multi-select (shift-click), align buttons (left/centre/right, top/middle/bottom, distribute),
  arrow nudges on all selected.
- Two formats side by side (wide and vertical) when the pane is wide enough; a format toggle
  otherwise.
- Undo and redo (z, shift+z), history list.
- Everything labelled; `window.mhEdit` grows with `select(addr)`, `set(addr, value)`, `op(...)`,
  `frame(n)`, `state()`; `#mh-state` stays the text read-back.

## 8. Ownership during the night

| stream | owns | must not touch |
|---|---|---|
| core A: groups, camera, transitions | `schema.ts`, `pose.ts`, `runtime.tsx`, `timeline.ts`, `edit.ts` (lint), `layout.ts`, `mograph.test.ts`, `examples/mograph` | `cli.ts`, `serve.ts`, `script.ts`, `templates.ts` |
| core B: colour, effects, text effects, new layer kinds | new files `colour.ts`, `effects.ts`, `shapes.ts`; additive edits to `schema.ts`, `runtime.tsx`, `edit.ts`; `examples/mograph-effects` | `cli.ts`, `serve.ts`, `script.ts`, `templates.ts`; rebases on main after core A merges |
| templates | `templates.ts`, `templates.test.ts`, `cli-templates.ts` (exports `commands` and `HELP`), `script.ts` (template expansion in `normalizeFilm` and the prompt), `examples/mograph-templates` | the core files |
| editor | `serve.ts` only (plus `serve.test.ts` if wanted) | everything else |
| bench | `docs/benchmark-mograph-2026-09-07.md`, `scripts/` | source |
| parity | report only | source |

A stream that needs a CLI command writes `src/mograph/cli-<stream>.ts` exporting
`commands: Record<string, (args) => Promise<void>>` and `HELP: string`; the integrator wires them
into `cli.ts`. Every stream: `bunx tsc --noEmit` and `bun test` green, the example of the stream
passing `mh check --format all`, commits with plain messages, and a final rebase on `main`.
