/**
 * Is a short cue heard under the bed? A 150 ms key under music is invisible to a
 * 250 ms rms window; the number that decides it is the peak of the high-passed
 * mix in a short window at the cue against the same measure just before it.
 * Also: where a music file becomes audible, so a cold-start trim is read off.
 */

export const db = (x: number) => (x <= 0 ? -Infinity : 20 * Math.log10(x));

const onePole = (samples: Float32Array, sr: number, hz: number): Float32Array => {
  const out = new Float32Array(samples.length);
  const rc = 1 / (2 * Math.PI * hz);
  const dt = 1 / sr;
  const a = rc / (rc + dt);
  let prevX = 0, prevY = 0;
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i];
    const y = a * (prevY + x - prevX);
    out[i] = y;
    prevX = x;
    prevY = y;
  }
  return out;
};

/** two cascaded one-pole high-passes (12 dB per octave): keeps the click and the transient, drops the bed's body */
export const highpass = (samples: Float32Array, sr: number, hz: number): Float32Array => onePole(onePole(samples, sr, hz), sr, hz);

/** decode rate for the audibility check: the transient of a key lives above 4 kHz, so 8 kHz would fold it */
export const AUDIBILITY_SR = 16000;

/** absolute peak inside [from, to) seconds */
export const peakIn = (samples: Float32Array, sr: number, from: number, to: number): number => {
  const a = Math.max(0, Math.floor(from * sr)), b = Math.min(samples.length, Math.ceil(to * sr));
  let p = 0;
  for (let i = a; i < b; i++) {
    const v = Math.abs(samples[i]);
    if (v > p) p = v;
  }
  return p;
};

export type Audibility = { at: number; window: number; before: number; peakAtDb: number; peakBeforeDb: number; deltaDb: number; audible: boolean; verdict: "audible" | "faint" | "masked" };

export type AudibilityOpts = { window?: number; before?: number; highpassHz?: number; audibleDb?: number; faintDb?: number };

/**
 * Peak of the high-passed signal in a `window` (60 ms) starting `at`, against the peak of the
 * `before` (200 ms) span in front of it. +6 dB or more reads as audible, +3 as faint, less is masked.
 * Pass an already high-passed signal (highpass()) or raw samples with `highpassHz`.
 */
export const cueAudibility = (samples: Float32Array, sr: number, at: number, opts: AudibilityOpts = {}): Audibility => {
  const window = opts.window ?? 0.06;
  const before = opts.before ?? 0.2;
  const sig = opts.highpassHz ? highpass(samples, sr, opts.highpassHz) : samples;
  // the cue may land a few ms late (encoder delay, adelay rounding): look a little past the mark
  const pAt = peakIn(sig, sr, at, at + window + 0.02);
  const pBefore = peakIn(sig, sr, Math.max(0, at - before), at);
  const peakAtDb = db(pAt), peakBeforeDb = db(pBefore);
  const deltaDb = pBefore <= 0 ? (pAt > 0 ? 60 : 0) : peakAtDb - peakBeforeDb;
  const audibleDb = opts.audibleDb ?? 6, faintDb = opts.faintDb ?? 3;
  const verdict = deltaDb >= audibleDb ? "audible" : deltaDb >= faintDb ? "faint" : "masked";
  return { at, window, before, peakAtDb, peakBeforeDb, deltaDb, audible: verdict === "audible", verdict };
};

/** rms per `step` seconds over the first `seconds` of a file, in dBFS */
export const headProfile = (samples: Float32Array, sr: number, seconds = 3, step = 0.1): number[] => {
  const out: number[] = [];
  const win = Math.round(step * sr);
  const n = Math.min(samples.length, Math.round(seconds * sr));
  for (let i = 0; i < n; i += win) {
    let s = 0;
    const end = Math.min(n, i + win);
    for (let j = i; j < end; j++) s += samples[j] * samples[j];
    out.push(db(Math.sqrt(s / Math.max(1, end - i))));
  }
  return out;
};

/** first second at which a `step` window is louder than `thresholdDb`, null when the whole file stays under it */
export const audibleFrom = (samples: Float32Array, sr: number, thresholdDb = -40, step = 0.1): number | null => {
  const win = Math.round(step * sr);
  for (let i = 0; i < samples.length; i += win) {
    let s = 0;
    const end = Math.min(samples.length, i + win);
    for (let j = i; j < end; j++) s += samples[j] * samples[j];
    if (db(Math.sqrt(s / Math.max(1, end - i))) > thresholdDb) return i / sr;
  }
  return null;
};
