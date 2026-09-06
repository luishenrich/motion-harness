---
name: motion-harness-sound
description: Music, sound effects, voice and loudness for a motion film, as timeline data checked by numbers: where a bed starts and ends, trim for a cold start, cuts on the beat, whether a short effect is heard under the music, voice lines synthesised and measured against their scenes, loudness per platform. Use for any request about the sound of a film built with motion-harness. Triggers: music, bed, sfx, sound effect, click sound, typewriter, voice, voiceover, TTS, ElevenLabs, loudness, LUFS, too quiet, cannot hear, beat, tempo, fade.
---

# Sound as data

Every sound is a cue in the timeline: `{ id, kind: music | sfx | voice, file, at, gain, ramps,
trim, loop, fadeOut }`. The mix is built from the cues (`mh render`, `mh render --remix` when
only sound changed: two seconds). Nothing is placed by ear; every placement has a number.

Music
- `mh audio`: where the bed covers the film, loop seams, the file's loud span and "audible from
  X s" with a 0 to 3 s head profile, so `trim` for a cold open is read off, not searched.
- A bed that ends before the film is a WARNING with the scene it dies in. Fix with `loop: true`,
  a longer file, or less trim.
- `mh beats [--suggest]`: tempo and beat grid from the bed, every cut measured against it;
  `--suggest` proposes scene lengths that land cuts on the grid (timeline rules veto).

Effects
- `mh sfx`: attack, tail and peak of every file; a "hit" with a slow attack is called out.
- `mh audio` per sfx cue: the >2 kHz peak in 60 ms at the cue against the 200 ms before it,
  AUDIBLE / FAINT / MASKED. A 150 ms key under a bed is invisible to an rms window; this number
  is the one that decides. Masked: more gain, a brighter sample, or duck the bed with a ramp.
- A cue whose first ramp starts at its own `at` is a fade-in, not silence. A ramp that
  resolves before the film starts is a lint warning (`ramp-before-start`).

Voice
- `kind: "voice"` with `text` (and `voice`, `lang`): `mh voice` synthesises missing or changed
  lines (ElevenLabs, `ELEVENLABS_API_KEY`), writes a sidecar with what the file was made from,
  and reports each line's length against the scene it starts in. A line that runs past its
  scene is heard over the next one: lengthen the scene or shorten the line.

Loudness
- `mh audio` prints integrated LUFS and true peak against YouTube, TikTok, Instagram, LinkedIn
  (-14 LUFS, -1 dBTP). Platforms turn loud files down and never raise quiet ones.
- `mh deliver --platforms youtube,tiktok` writes normalised copies (two-pass loudnorm, picture
  copied).

Before any sound change: `mh audio --scene <id>` for what sounds in that scene; after: `mh render
--remix` and `mh audio` again. Listen last, measure first.
