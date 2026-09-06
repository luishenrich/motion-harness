/**
 * Motion as numbers. Render every frame of a scene (small, jpeg), compute the
 * frame-to-frame difference curve, and derive what a reviewer cannot see on a
 * contact sheet: when the scene settles, how long it holds still, where it jumps.
 */
import { rmSync } from "node:fs";
import sharp from "sharp";
import type { Engine } from "../render/engine.ts";
import type { CompiledScene } from "../timeline/schema.ts";
import { ensureDir } from "../util.ts";

export type MotionCurve = {
  scene: string;
  fps: number;
  /** per local frame f>0: mean abs diff to f-1, 0..1 */
  diff: number[];
  /** first local frame after which diff stays under `still` for `stillRun` frames */
  settled: number | null;
  /** runs of near-zero motion, local frames [from, to] */
  holds: [number, number][];
  /** local frames where the diff spikes (cuts, pops) */
  jumps: { frame: number; diff: number }[];
  /** the declared enter duration, for comparison */
  enterDur: number;
  /** mean motion after settling */
  drift: number;
  frames: number;
};

export const measureScene = async (
  e: Engine,
  compositionId: string,
  scene: CompiledScene,
  fps: number,
  outDir: string,
  opts: { width?: number; still?: number; stillRun?: number; jump?: number; extra?: number; inputProps?: Record<string, unknown>; concurrency?: number } = {},
): Promise<MotionCurve> => {
  const composition = await e.composition(compositionId, opts.inputProps ?? {});
  const extra = opts.extra ?? 0;
  const from = scene.start;
  const to = Math.min(composition.durationInFrames - 1, scene.end - 1 + extra);
  rmSync(outDir, { recursive: true, force: true });
  ensureDir(outDir);
  const files = await e.frames(compositionId, [from, to], outDir, { width: opts.width ?? 320, jpegQuality: 70, concurrency: opts.concurrency ?? 4, inputProps: opts.inputProps });
  const n = files.length;
  if (n !== to - from + 1) throw new Error(`expected ${to - from + 1} frames in ${outDir}, found ${n}`);
  const bufs: Buffer[] = [];
  for (const f of files) bufs.push(await sharp(f).removeAlpha().raw().toBuffer());
  const diff: number[] = [0];
  for (let i = 1; i < n; i++) {
    const a = bufs[i - 1], b = bufs[i];
    let s = 0;
    for (let j = 0; j < a.length; j++) s += Math.abs(a[j] - b[j]);
    diff.push(s / (a.length * 255));
  }
  const still = opts.still ?? 0.002;
  const stillRun = opts.stillRun ?? 4;
  const jumpT = opts.jump ?? 0.08;
  let settled: number | null = null;
  for (let i = 1; i < n; i++) {
    if (diff.slice(i, i + stillRun).every((d) => d < still) && i + stillRun <= n) {
      settled = i;
      break;
    }
  }
  const holds: [number, number][] = [];
  let hs = -1;
  for (let i = 1; i <= n; i++) {
    const isStill = i < n && diff[i] < still;
    if (isStill && hs < 0) hs = i - 1;
    if (!isStill && hs >= 0) {
      if (i - 1 - hs >= stillRun) holds.push([hs, i - 1]);
      hs = -1;
    }
  }
  const jumps = diff.map((d, i) => ({ frame: i, diff: d })).filter((x) => x.frame > 0 && x.diff > jumpT);
  const after = settled === null ? [] : diff.slice(settled);
  return {
    scene: scene.id,
    fps,
    diff: diff.map((d) => Math.round(d * 10000) / 10000),
    settled,
    holds,
    jumps: jumps.map((j) => ({ frame: j.frame, diff: Math.round(j.diff * 1000) / 1000 })),
    enterDur: scene.enter.dur ?? 0,
    drift: after.length ? after.reduce((a, b) => a + b, 0) / after.length : 0,
    frames: n,
  };
};

export const sparkline = (v: number[], max?: number): string => {
  const bars = "▁▂▃▄▅▆▇█";
  const m = max ?? Math.max(...v, 1e-9);
  return v.map((x) => bars[Math.min(7, Math.floor((x / m) * 7.999))]).join("");
};

/* ---------- a reference clip's curve, and how a scene compares to it ---------- */

import { readdirSync as _readdirSync } from "node:fs";
import { join as _join } from "node:path";
import { run as _run } from "../util.ts";

export type ReferenceCurve = { file: string; fps: number; frames: number; diff: number[]; settled: number | null; holdShare: number; peak: number };

/** decode a reference clip (optionally a span) to small jpegs at `fps` and measure its frame-to-frame motion the same way */
export const measureReference = async (file: string, fps: number, outDir: string, opts: { width?: number; from?: number; to?: number; still?: number; stillRun?: number } = {}): Promise<ReferenceCurve> => {
  rmSync(outDir, { recursive: true, force: true });
  ensureDir(outDir);
  const args = ["-y", "-v", "error"];
  if (opts.from !== undefined) args.push("-ss", String(opts.from));
  args.push("-i", file);
  if (opts.to !== undefined) args.push("-t", String(opts.to - (opts.from ?? 0)));
  args.push("-vf", `fps=${fps},scale=${opts.width ?? 320}:-2`, "-q:v", "4", _join(outDir, "element-%04d.jpeg"));
  await _run(["ffmpeg", ...args]);
  const files = _readdirSync(outDir).filter((f) => /^element-\d+\.jpe?g$/.test(f)).sort().map((f) => _join(outDir, f));
  const bufs: Buffer[] = [];
  for (const f of files) bufs.push(await sharp(f).removeAlpha().raw().toBuffer());
  const diff: number[] = [0];
  for (let i = 1; i < bufs.length; i++) {
    const a = bufs[i - 1], b = bufs[i];
    let s = 0;
    for (let j = 0; j < a.length; j++) s += Math.abs(a[j] - b[j]);
    diff.push(s / (a.length * 255));
  }
  const still = opts.still ?? 0.002, stillRun = opts.stillRun ?? 4;
  let settled: number | null = null;
  for (let i = 1; i + stillRun <= diff.length; i++) {
    if (diff.slice(i, i + stillRun).every((d) => d < still)) {
      settled = i;
      break;
    }
  }
  const holdShare = diff.filter((d) => d < still).length / Math.max(1, diff.length);
  return { file, fps, frames: files.length, diff, settled, holdShare, peak: Math.max(0, ...diff) };
};

export type CurveComparison = { correlation: number; settleDelta: number | null; holdDelta: number; peakRatio: number; verdict: string[] };

/** two curves side by side: does the scene move like the reference (shape), settle when it settles, hold as much */
export const compareCurves = (scene: { diff: number[]; settled: number | null; holds: [number, number][]; frames: number }, ref: ReferenceCurve): CurveComparison => {
  // resample both to 100 points and correlate the shapes
  const resample = (d: number[], n: number) => Array.from({ length: n }, (_, i) => d[Math.min(d.length - 1, Math.floor((i / n) * d.length))] ?? 0);
  const a = resample(scene.diff, 100), b = resample(ref.diff, 100);
  const mean = (x: number[]) => x.reduce((p, q) => p + q, 0) / x.length;
  const ma = mean(a), mb = mean(b);
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < 100; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  const correlation = da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
  const sceneHold = scene.holds.reduce((s, [x, y]) => s + (y - x), 0) / Math.max(1, scene.frames);
  const settleDelta = scene.settled !== null && ref.settled !== null ? scene.settled - ref.settled : null;
  const holdDelta = sceneHold - ref.holdShare;
  const peakRatio = ref.peak > 0 ? Math.max(0, ...scene.diff) / ref.peak : 0;
  const verdict: string[] = [];
  if (correlation < 0.5) verdict.push(`shape differs (correlation ${correlation.toFixed(2)}): the scene does not move when the reference moves`);
  if (settleDelta !== null && Math.abs(settleDelta) > 6) verdict.push(`settles ${settleDelta > 0 ? `${settleDelta}f later` : `${-settleDelta}f earlier`} than the reference`);
  if (Math.abs(holdDelta) > 0.25) verdict.push(`holds ${holdDelta > 0 ? "more" : "less"} than the reference (${(sceneHold * 100).toFixed(0)}% vs ${(ref.holdShare * 100).toFixed(0)}% of frames still)`);
  if (peakRatio > 2.5 || (peakRatio > 0 && peakRatio < 0.4)) verdict.push(`motion amplitude is ${peakRatio.toFixed(1)}x the reference's`);
  return { correlation, settleDelta, holdDelta, peakRatio, verdict };
};
