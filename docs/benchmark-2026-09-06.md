# Native engine against Remotion, measured 2026-09-06

Machine: the development Mac (Apple Silicon, 12 cores). Film: the StudyPDF launch film, wide
format, 1920x1080, 30 fps, 23 scenes, 1760 frames. Both engines drive the same Chrome
headless shell. `mh bench --scene probe --engines remotion,native` and two forced full renders
(`mh render --force --no-audio`, timed with `time`). Numbers are wall clock, one run each.

| step | native | remotion | native / remotion |
|---|---|---|---|
| engine up (vite + browser vs bundle reuse + browser) | 0.5 s | 0.1 s (bundle cached; 1.9 s when it rebuilds) | |
| one still, warm | 0.06 s | 0.57 s | 9.5x faster |
| 70 check frames with the DOM probe, 4 pages | 4.3 s (16.3 f/s) | 6.4 s (10.9 f/s) | 1.5x |
| segment full, 144 f, 4 pages | 2.1 s (69.6 f/s) | 3.5 s (41.4 f/s) | 1.7x |
| segment full, 144 f, 8 pages | 3.0 s (47.6 f/s) | 3.3 s (43.5 f/s) | 1.1x |
| segment draft, 144 f, 4 pages | 3.5 s (40.7 f/s) | 2.1 s (68.9 f/s) | 0.6x |
| segment draft, 144 f, 8 pages | 3.3 s (43.9 f/s) | 1.9 s (76.1 f/s) | 0.6x |
| the whole film, forced, 1760 f | 35.3 s (49.8 f/s) | 50.6 s (34.8 f/s) | 1.4x |
| `mh check --scene turn --format all` (typecheck, lint, doctor, cursor, frames, sheets, rendered lint) | 15 s | about 50 s | 3x |

Where the native engine is faster: everything a single frame costs (the check loop lives on
that), full-quality segments at four pages, and the whole film. Where Remotion is faster: draft
renders, because its draft path uses the hardware encoder and jpeg frames, and eight pages
where the native engine's screenshots serialise in Chrome. The native draft is the next thing to
tune (a smaller viewport instead of a device scale factor, and the hardware encoder).

Pixels: static frames byte-identical; frames with text in motion differ on glyph edges,
under 0.1 % of pixels (`mh compare`); nine frames sampled across both films at most 0.34 %
including encoder noise.

What the native engine does not do: render a composition's own `<Audio>` (sound is timeline
cues, which is how the harness mixes anyway), string output ranges in `interpolate`, and
`lazyComponent` compositions.
