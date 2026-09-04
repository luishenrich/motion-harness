/**
 * Compare two frame sets by frame number. Answers "what moved outside the scene I
 * changed" for cents, so only changed frames go to a reviewer.
 */
import sharp from "sharp";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ensureDir } from "../util.ts";

export type FrameDiff = {
  frame: number;
  /** 0..1, mean absolute difference over all channels */
  mean: number;
  /** share of pixels whose max channel difference exceeds the threshold */
  changed: number;
  /** bounding box of the change, in pixels */
  box?: { x: number; y: number; w: number; h: number };
  diffFile?: string;
};

export const diffImages = async (a: string, b: string, opts: { threshold?: number; out?: string; downscale?: number } = {}): Promise<FrameDiff> => {
  const scale = opts.downscale ?? 2;
  const A = sharp(a);
  const meta = await A.metadata();
  const w = Math.floor((meta.width ?? 0) / scale);
  const h = Math.floor((meta.height ?? 0) / scale);
  const [ra, rb] = await Promise.all([
    sharp(a).resize(w, h, { kernel: "nearest" }).removeAlpha().raw().toBuffer(),
    sharp(b).resize(w, h, { kernel: "nearest" }).removeAlpha().raw().toBuffer(),
  ]);
  const thr = Math.round((opts.threshold ?? 0.08) * 255);
  let sum = 0;
  let changed = 0;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  const mask = opts.out ? Buffer.alloc(w * h * 3) : null;
  for (let i = 0; i < w * h; i++) {
    const o = i * 3;
    const d0 = Math.abs(ra[o] - rb[o]);
    const d1 = Math.abs(ra[o + 1] - rb[o + 1]);
    const d2 = Math.abs(ra[o + 2] - rb[o + 2]);
    sum += d0 + d1 + d2;
    const m = Math.max(d0, d1, d2);
    if (m > thr) {
      changed++;
      const x = i % w, y = (i / w) | 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (mask) {
        mask[o] = 255;
        mask[o + 1] = Math.max(0, 255 - m * 2);
        mask[o + 2] = 0;
      }
    } else if (mask) {
      const g = Math.round(rb[o] * 0.3 + rb[o + 1] * 0.59 + rb[o + 2] * 0.11) >> 1;
      mask[o] = g;
      mask[o + 1] = g;
      mask[o + 2] = g;
    }
  }
  const res: FrameDiff = { frame: -1, mean: sum / (w * h * 3 * 255), changed: changed / (w * h) };
  if (maxX >= 0) res.box = { x: minX * scale, y: minY * scale, w: (maxX - minX + 1) * scale, h: (maxY - minY + 1) * scale };
  if (mask && opts.out && changed > 0) {
    ensureDir(join(opts.out, ".."));
    await sharp(mask, { raw: { width: w, height: h, channels: 3 } }).png().toFile(opts.out);
    res.diffFile = opts.out;
  }
  return res;
};

export const diffSets = async (
  pairs: { frame: number; a: string; b: string; label: string }[],
  opts: { threshold?: number; outDir?: string; minChanged?: number } = {},
): Promise<(FrameDiff & { label: string; missing?: boolean })[]> => {
  const out: (FrameDiff & { label: string; missing?: boolean })[] = [];
  for (const p of pairs) {
    if (!existsSync(p.a) || !existsSync(p.b)) {
      out.push({ frame: p.frame, mean: 1, changed: 1, label: p.label, missing: true });
      continue;
    }
    const d = await diffImages(p.a, p.b, { threshold: opts.threshold, out: opts.outDir ? join(opts.outDir, `diff-f${String(p.frame).padStart(5, "0")}.png`) : undefined });
    out.push({ ...d, frame: p.frame, label: p.label });
  }
  return out;
};
