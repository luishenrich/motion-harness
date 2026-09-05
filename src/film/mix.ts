/**
 * Pure helpers behind the mix: where a cue sounds in film time, what its gain is at
 * any moment, and the ffmpeg volume expression for a cue placed into a span of the
 * film (the whole film, or a preview clip that starts mid-film).
 */
import type { Compiled, AudioCue } from "../timeline/schema.ts";
import { resolve as resolveRef, resolveUnclamped } from "../timeline/resolve.ts";

export type Span = { start: number; end: number };

/** the cue's ramps in film seconds, sorted */
export const rampsOf = (cue: AudioCue, c: Compiled): { at: number; to: number; over: number }[] =>
  (cue.ramps ?? []).map((r) => ({ at: resolveRef(c, r.at).filmSeconds, to: r.to, over: r.over ?? 0 })).sort((a, b) => a.at - b.at);

/** gain of a cue at film time `t`, with every ramp up to that moment evaluated (mid-ramp values interpolate) */
export const gainAt = (cue: AudioCue, c: Compiled, t: number): number => {
  let g = cue.gain ?? 1;
  for (const r of rampsOf(cue, c)) {
    if (t < r.at) break;
    const p = r.over > 0 ? Math.min(1, (t - r.at) / r.over) : 1;
    g = p >= 1 ? r.to : g + (r.to - g) * p;
  }
  return g;
};

/**
 * Where a cue sounds, in film seconds. `start` may be negative (a cue placed before the
 * film). `end` is the film end for loops and for cues whose file length is unknown,
 * otherwise start + (trimmed) file length.
 */
export const cueSpan = (cue: AudioCue, c: Compiled, fileSeconds?: number): Span => {
  const start = resolveUnclamped(c, cue.at).filmSeconds;
  const len = cue.trim ? cue.trim[1] - cue.trim[0] : fileSeconds;
  const end = cue.loop || len === undefined ? c.seconds : Math.min(c.seconds, start + len);
  return { start, end };
};

/** the cues that are audible somewhere inside [span.start, span.end) */
export const cuesInSpan = (cues: AudioCue[], c: Compiled, span: Span, fileSeconds: Record<string, number> = {}): AudioCue[] =>
  cues.filter((cue) => {
    const s = cueSpan(cue, c, fileSeconds[cue.id]);
    return s.start < span.end && s.end > span.start;
  });

/**
 * ffmpeg `volume` expression for a cue inside a clip that covers film seconds
 * [span.start, span.end). `t` in the expression is the cue's own stream time, which
 * starts when the cue starts sounding inside the clip (`clipStart`, clip seconds).
 * Ramps that already happened before that moment collapse into the initial gain.
 */
export const volumeExprFor = (cue: AudioCue, c: Compiled, span: Span, clipStart: number): string => {
  const t0 = span.start + clipStart; // film time at which the cue's stream starts
  const g0 = gainAt(cue, c, t0);
  const ramps = rampsOf(cue, c)
    .filter((r) => r.at + r.over > t0)
    .map((r) => {
      // a ramp already in progress at t0 continues from g0 over its remaining time
      const at = Math.max(0, r.at - t0);
      const over = r.at < t0 ? r.over - (t0 - r.at) : r.over;
      return { at, to: r.to, over };
    });
  let expr = String(g0);
  let prev = g0;
  for (const r of ramps) {
    const seg = r.over > 0 ? `(${prev}+(${r.to}-${prev})*min(1,max(0,(t-${r.at.toFixed(3)})/${r.over.toFixed(3)})))` : String(r.to);
    // a ramp already running when the stream starts needs no "before" branch
    expr = r.at > 0 ? `if(lt(t,${r.at.toFixed(3)}),${expr},${seg})` : seg;
    prev = r.to;
  }
  return expr;
};
