/**
 * Do the cuts land on the beat?
 *
 * Onsets: energy rises in the mixed film audio (music + foley), peak-picked.
 * Beat grid: tempo and phase estimated from the music bed alone (autocorrelation
 * of its onset strength), shifted by the cue's start in the film.
 * Then every scene cut and every sfx cue is measured against the nearest onset
 * and the nearest beat tick.
 */

export const decodeMono = async (file: string, sr = 8000): Promise<Float32Array> => {
  const proc = Bun.spawn(["ffmpeg", "-v", "error", "-i", file, "-vn", "-ac", "1", "-ar", String(sr), "-f", "f32le", "-"], { stdout: "pipe", stderr: "pipe" });
  const [buf, err] = await Promise.all([new Response(proc.stdout).arrayBuffer().then((b) => Buffer.from(b)), new Response(proc.stderr).text()]);
  if ((await proc.exited) !== 0) throw new Error(`ffmpeg failed on ${file}: ${err.slice(-400)}`);
  return new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
};

export type OnsetAnalysis = {
  hop: number; // seconds
  strength: number[]; // onset strength per hop
  onsets: { t: number; strength: number }[];
  seconds: number;
};

/** onset strength = positive change of a log-energy envelope, 10 ms hops */
export const onsetStrength = (samples: Float32Array, sr: number, hopSec = 0.01, winSec = 0.03): { hop: number; strength: number[]; seconds: number } => {
  const hop = Math.round(hopSec * sr);
  const win = Math.round(winSec * sr);
  const n = Math.floor((samples.length - win) / hop);
  const env: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    const o = i * hop;
    for (let j = 0; j < win; j++) s += samples[o + j] * samples[o + j];
    env[i] = Math.log10(1e-7 + s / win);
  }
  const strength: number[] = new Array(n).fill(0);
  for (let i = 1; i < n; i++) strength[i] = Math.max(0, env[i] - env[i - 1]);
  return { hop: hopSec, strength, seconds: samples.length / sr };
};

/** adaptive peak picking: a peak must beat the local mean by `k` local deviations and be `minGap` apart */
export const pickOnsets = (a: { hop: number; strength: number[] }, opts: { k?: number; minGapSec?: number; localSec?: number } = {}): { t: number; strength: number }[] => {
  const k = opts.k ?? 2.2;
  const minGap = Math.round((opts.minGapSec ?? 0.1) / a.hop);
  const local = Math.round((opts.localSec ?? 1.0) / a.hop);
  const s = a.strength;
  const out: { t: number; strength: number }[] = [];
  let last = -minGap;
  for (let i = 1; i < s.length - 1; i++) {
    if (s[i] < s[i - 1] || s[i] < s[i + 1]) continue;
    const from = Math.max(0, i - local), to = Math.min(s.length, i + local);
    let mean = 0;
    for (let j = from; j < to; j++) mean += s[j];
    mean /= to - from;
    let dev = 0;
    for (let j = from; j < to; j++) dev += Math.abs(s[j] - mean);
    dev /= to - from;
    if (s[i] > mean + k * dev && s[i] > 0.02 && i - last >= minGap) {
      out.push({ t: i * a.hop, strength: s[i] });
      last = i;
    }
  }
  return out;
};

export type BeatGrid = { bpm: number; period: number; phase: number; confidence: number; ticks: number[] };

/** tempo by autocorrelation of onset strength between 60 and 200 bpm, phase by best alignment of the tick comb */
export const beatGrid = (a: { hop: number; strength: number[]; seconds: number }, opts: { minBpm?: number; maxBpm?: number } = {}): BeatGrid => {
  const s = a.strength;
  const mean = s.reduce((x, y) => x + y, 0) / s.length;
  const c = s.map((x) => x - mean);
  const minLag = Math.round(60 / (opts.maxBpm ?? 200) / a.hop);
  const maxLag = Math.round(60 / (opts.minBpm ?? 60) / a.hop);
  let best = { lag: minLag, r: -Infinity };
  const ac: number[] = [];
  for (let lag = minLag; lag <= maxLag; lag++) {
    let r = 0;
    for (let i = lag; i < c.length; i++) r += c[i] * c[i - lag];
    r /= c.length - lag;
    ac.push(r);
    if (r > best.r) best = { lag, r };
  }
  // prefer the fundamental over its double when both are strong (tempo octave)
  const half = Math.round(best.lag / 2);
  if (half >= minLag) {
    const rHalf = ac[half - minLag];
    if (rHalf > best.r * 0.85) best = { lag: half, r: rHalf };
  }
  const period = best.lag * a.hop;
  const acMean = ac.reduce((x, y) => x + y, 0) / ac.length;
  const acDev = Math.sqrt(ac.reduce((x, y) => x + (y - acMean) ** 2, 0) / ac.length) || 1;
  const confidence = Math.max(0, Math.min(1, (best.r - acMean) / (4 * acDev)));
  // phase: which offset of the comb collects the most onset strength
  let bestPhase = 0, bestSum = -1;
  for (let p = 0; p < best.lag; p++) {
    let sum = 0;
    for (let i = p; i < s.length; i += best.lag) sum += s[i];
    if (sum > bestSum) {
      bestSum = sum;
      bestPhase = p;
    }
  }
  const phase = bestPhase * a.hop;
  const ticks: number[] = [];
  for (let t = phase; t < a.seconds; t += period) ticks.push(t);
  return { bpm: 60 / period, period, phase, confidence, ticks };
};

export const nearest = (t: number, list: number[]): { t: number; delta: number } | null => {
  if (!list.length) return null;
  let b = list[0];
  for (const x of list) if (Math.abs(x - t) < Math.abs(b - t)) b = x;
  return { t: b, delta: t - b };
};
