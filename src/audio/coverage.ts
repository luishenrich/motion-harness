/**
 * What span of the film a cue actually covers, computed the way `mixFilm` builds
 * its ffmpeg graph: head trim for cues that start before the film, `trim` on the
 * source, loop copies chained under a crossfade, the fade-out anchored to the
 * film end. Pure, so the same numbers drive the mix and the coverage report.
 */
import type { Compiled, AudioCue } from "../timeline/schema.ts";
import { resolveUnclamped } from "../timeline/resolve.ts";

export type CueSpanInput = {
  /** film seconds where the cue's audio starts (already clamped to 0) */
  start: number;
  /** seconds cut from the head of the source because the cue was placed before the film */
  headTrim: number;
  /** seconds of source after `trim`, the length of one play */
  sourceDur: number;
  /** film length in seconds */
  total: number;
  loop?: boolean;
  loopCrossfade?: number;
  fadeOut?: number;
};

export type LoopSeam = {
  /** film seconds where the crossfade starts */
  from: number;
  /** film seconds where the crossfade ends (the seam is fully in the next copy) */
  to: number;
  /** middle of the crossfade, the moment to point at */
  at: number;
};

export type CueSpan = {
  start: number;
  /** film seconds where the audio stops, never past the film end */
  end: number;
  /** how many copies of the source the mix chains (1 when not looped) */
  copies: number;
  /** length of the chained audio before head trim and the film-end cut */
  chainSeconds: number;
  seams: LoopSeam[];
  /** film seconds where the fade-out starts, null without fadeOut */
  fadeStart: number | null;
  /** true when the fade-out window lies inside the audible audio (a fade past the end of the audio is silent) */
  fadeAudible: boolean;
  /** seconds of film after the audio stops (0 when the cue reaches the film end) */
  shortBy: number;
};

/** the copy count `mixFilm` chains for a loop: enough to cover `need` seconds with `xf` lost at every seam, plus one for safety */
export const loopCopies = (need: number, sourceDur: number, xf: number): number => Math.max(2, Math.ceil(need / Math.max(1, sourceDur - xf)) + 1);

export const cueSpan = (i: CueSpanInput): CueSpan => {
  const total = i.total;
  const start = i.start;
  const seams: LoopSeam[] = [];
  let copies = 1;
  let chain = i.sourceDur;
  if (i.loop) {
    const xf = i.loopCrossfade ?? 2;
    copies = loopCopies(total - start + i.headTrim, i.sourceDur, xf);
    // acrossfade: out = a + b - xf, the crossfade occupies the last xf seconds of a
    for (let k = 1; k < copies; k++) {
      const lenBefore = i.sourceDur + (k - 1) * (i.sourceDur - xf);
      const from = lenBefore - xf - i.headTrim + start;
      const to = lenBefore - i.headTrim + start;
      if (to > start && from < total) seams.push({ from: Math.max(start, from), to: Math.min(total, to), at: (from + to) / 2 });
    }
    chain = i.sourceDur + (copies - 1) * (i.sourceDur - xf);
  }
  const audible = Math.max(0, chain - i.headTrim);
  const end = Math.min(total, start + audible);
  const fadeStart = i.fadeOut ? total - i.fadeOut : null;
  const fadeAudible = fadeStart === null ? true : fadeStart < end;
  return { start, end, copies, chainSeconds: chain, seams, fadeStart, fadeAudible, shortBy: Math.max(0, total - end) };
};

/** the placement numbers `mixFilm` derives from a cue: clamped start and the head trim for cues placed before the film */
export const cuePlacement = (c: Compiled, cue: AudioCue): { raw: number; start: number; headTrim: number } => {
  const raw = resolveUnclamped(c, cue.at).filmSeconds;
  return { raw, start: Math.max(0, raw), headTrim: raw < 0 ? -raw : 0 };
};

/** seconds of source one play uses, after `trim` */
export const sourceSeconds = (cue: AudioCue, fileSeconds: number): number => (cue.trim ? cue.trim[1] - cue.trim[0] : fileSeconds);

export const spanOf = (c: Compiled, cue: AudioCue, fileSeconds: number): CueSpan => {
  const p = cuePlacement(c, cue);
  return cueSpan({ start: p.start, headTrim: p.headTrim, sourceDur: sourceSeconds(cue, fileSeconds), total: c.seconds, loop: cue.loop, loopCrossfade: cue.loopCrossfade, fadeOut: cue.fadeOut });
};
