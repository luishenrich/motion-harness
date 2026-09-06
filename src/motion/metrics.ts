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
