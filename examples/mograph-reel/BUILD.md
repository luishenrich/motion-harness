# How this film was built

Every scene, every layer and every value in `film.mograph.json` was written by a command.
Nothing in the film was hand edited. The list below is the loop as it actually ran: add,
look, check, fix. Frame paths and lint output are in `.harness/`.

Run everything from the repo root:

```
bun run src/cli.ts <cmd> --project examples/mograph-reel
```

## The round

1. `mh new examples/mograph-reel --mograph --film seed.mograph.json --name reel --no-install --no-check`
   The scaffold from a seed film that carried the design (palette, fonts, formats, easings) and the
   opening claim as its one scene. Everything after this is a command.
2. `mh check --format all`
   The first round with no frames: typecheck, static lint, doctor. It failed on the scaffold's
   import depth, see "One fix by hand" below.
3. `mh check --format all --scene blind`
   The seed scene rendered in both formats: frames, sheets and the rendered lints.
4. `mh frame blind.headSettled+20 --format all`
   The first look: does the palette read, do the Google fonts arrive, does the marker sweep land.
5. `mh template show title --param title="Motion graphics,\nas *data*" --param kicker="motion harness" --json`
   What the template would write, before writing it.
6. `mh template add title --param title="Motion graphics,\nas *data*" --param kicker="motion harness" --param ground=ink --param dur=114 --param exit=0 --before blind`
   Template scene one: the opening card, three layers with addresses like any other.
7. `mh unset title.ground` then `mh set title.ground '{"gradient":["ink","deep"],"angle":160}'`
   A gradient ground. The unset is a workaround, see "Runtime notes".
8. `mh set title.groundTracks '[{"at":0,...},{"at":74,...}]'`
   The ground travels: a violet corner glow that settles into near black.
9. `mh set title.camera '{"preset":"push","from":1,"to":1.05,"focus":{"x":0.5,"y":0.47},"ease":"linear"}'`
   The push that makes the word stagger a kinetic title rather than a static one.
10. `mh set title.headline.in '{"preset":"mask","at":8,"dur":16,"ease":"settle","stagger":{"by":"word","each":4}}'`
    The words rise out of a slot, one every four frames.
11. `mh set title.headline.lines 2` and `mh set title.sound swell`
    The expected line count for the wrap lint, and the swell under the title.
12. `mh frame title.headlineSettled title+110 --format all`
    Look. The ground travel ended too violet, so it was reversed in the next step.
13. `mh set title.groundTracks '[...]'` again, and `mh set title.rule.formats.vertical.at '{"x":0.5,"y":0.575}'`
    Violet first, calm second; the rule pulled up in vertical where the block sat too loose.
14. `mh set blind.transition '{"type":"dissolve","dur":14,"ease":"inOut"}'` and `mh set blind.sound whoosh`
    The first handover and the first hit.
15. `mh add scene '{"id":"file","dur":144,"ground":"ink","transition":{"type":"push-up",...},"layers":[]}' --after blind`
    A scene is added empty and filled layer by layer, so every command stays short and readable.
16. `mh add layer file '{"id":"head",...}'`, `mh add layer file '{"id":"card","type":"group",...}'`,
    `mh add layer file.card '{"id":"card-name",...}'`, `mh add layer file.card '{"id":"card-rule",...}'`,
    `mh add layer file.card '{"id":"card-n","type":"counter",...}'`, `mh add layer file '{"id":"note",...}'`
    The card: a group that pops as one, with a counter inside it. The children are addressed
    through the group (`file.card.card-n`).
17. `mh frame file.cardSettled --format all`
    Look at the card once its last child has settled.
18. `mh add scene address ...` plus three `mh add layer address ...`
    The claim, a mono command line that flips in character by character, a note.
19. `mh set address.note.in.at 82`
    The lint said three words held 0.67 s where 1.20 s reads comfortably. Moved earlier.
20. `mh frame address.cmdSettled --format all`
    Look.
21. `mh add scene travel ...` with `camera.tracks.x` of three keys, then `mh add layer travel ...`
    for the headline, three group cards and their six children, and the note.
    The travelling shot: the camera crosses scene, layer and track.
22. `mh frame travel+20 travel+80 travel+150`
    Look at all three camera positions, not just the settle.
23. `mh add scene pass ...` plus `mh add layer pass ...` for the headline, the drawn check
    mark path and the note; `mh set pass.note.in.at 60` for the same reading time rule.
24. `mh frame pass.tickSettled`
    The path draws itself by the progress of its in.
25. `mh add scene speed ...` plus three layers: the headline, the bars, the note.
    `mh set speed.bars.at '{"x":0.475,"y":0.5}'` to balance the label column against the values.
26. `mh add scene lints ...` plus three layers: a scrambled headline, three rings, a note.
    `mh set lints.note.in.at 66` for the reading time.
27. `mh add scene count ...` plus three layers: the odometer, the mint label, the note.
    `mh set count.note.in.at 48` for the reading time.
28. `mh add scene loop ...` plus three layers: the headline, a rule with a colour track, the
    numbered list.
29. `mh add scene sting ...` plus four layers: particles, the ring, the pupil, the wordmark.
30. `mh template add end-card --param title="motion *harness*" --param url="github.com/motion-harness" --param ground=paper --param accent=iris --param dur=132 --param exit=12 --after sting`
    Template scene two: the closing card.
31. `mh set end-card.transition '{"type":"dip","dur":16,"ease":"inOut"}'` and `mh set end-card.sound ding`
    The template scene edited by address, like every other scene.
32. `mh layers`
    Every scene and layer with the frame it really starts on. This is where the film's total
    of 1578 frames came from, which the odometer then counted to.
33. `mh sounds` then `mh sounds --make`
    Twelve cues, one hit per scene and the swell under the title; the bank written to
    `public/sfx` with ffmpeg.
34. `mh check --format all --scene title,blind,file,address,travel,pass,speed,lints,count,loop,sting,end-card`
    The whole film, both formats. 63 rendered lint errors in wide, 340 in vertical.
35. `mh lint --rendered --format all --no-fail`
    The same findings grouped: the three travel cards overlapped in vertical, the ring and the
    pupil of the sting overlapped by design, the headline box touched the kicker in wide, and
    the kicker sat on the violet start of the ground track at 1.26:1.
36. `mh set title.groundTracks '[...]'` (violet as the second stop, so the flat stand in is dark),
    `mh set title.kicker.at '{"x":0.5,"y":0.31}'`,
    `mh set sting.pupil.probe false` (the pupil is part of the mark, not a layout block),
    `mh set travel.<card>.formats.vertical '{"w":250,"h":260,"at":{...}}'` for all three cards
    and `mh set travel.<card>.<card>-value.formats.vertical '{"size":24}'`.
37. `mh check --format all --scene title,travel,sting`
    Clean, with one warning left: twenty words in travel needed 5.20 s and the scene held 4.67 s.
38. `mh set travel.dur 172`, `mh set travel.camera.tracks.x '[{"at":10,...},{"at":86,...},{"at":162,...}]'`,
    `mh set travel.scene-card.scene-card-value.text "dur 172"`, `mh set travel.note.in.at 108`,
    `mh set count.big.to 1594`
    The scene got longer, so the camera keys moved with it, the card that prints the scene's own
    duration was corrected, and the odometer was corrected to the film's new frame count.
39. `mh check --format all --scene <all twelve>`
    All steps passed, both formats, no errors and no warnings.
40. Visual QA pass one: a sub agent read all twenty four contact sheets.
    It found the vertical cut sparse (blocks in the middle 40 percent with dead bands above and
    below), the odometer showing "0,178" under a thousand, and a stale `why` on the lints scene.
41. `mh set count.big.format 0` (an odometer without a thousands separator does not print a
    leading "0,"), `mh set lints.why "..."`, and about twenty
    `mh set <scene>.<layer>.formats.vertical '{...}'` that give the 9:16 cut bigger type and a
    wider spread instead of a centre crop of the 16:9.
42. `mh check --format all --scene <all twelve>`
    Clean again in both formats.
43. Visual QA pass two: the sub agent read the twenty four new sheets.
44. `mh set` fixes from pass two, then `mh check --format all --scene <all twelve>` again.
45. Visual QA pass three: clean.
46. `mh render --format all`
    The films.
47. `mh audio` and `mh judge --scene <all twelve>`
    The mix measured, and a model watching the clip.
48. `ffmpeg -ss <t> -i reel-wide.mp4 -frames:v 1 frames/<name>.png`
    Eight frames out of the rendered wide film at the moments the README names.

## One fix by hand

`mh new --mograph` writes `src/Root.tsx` and `src/timeline.ts` with the harness import it
computed for the project directory (`../../src`), but those two files sit one level deeper, so
the import has to be `../../../src`. The scaffold was corrected with sed and the project then
checked clean. This is a harness bug, not a film one; it is written up in the report.

## Runtime notes

- `mh set <scene>.ground '{"gradient":[...]}'` on a scene whose ground is still a plain colour
  name is refused: the "a string field keeps a string" guard turns the JSON object back into the
  literal string and the colour lint then rejects it. `mh unset <scene>.ground` first, then set.
- The odometer shows a partial digit mid roll, which is what an odometer does, but the cell is
  taller than the digit ink so the two halves sit far apart and a still can read as a torn glyph.
  The settled number is clean.
