/**
 * "Which frame is this?" for a pasted still. A difference hash (dHash, 16x16 on a
 * grayscale downscale) of the given image against every frame of a frames run
 * narrows the field; a normalized cross-correlation of the paste slid over each
 * candidate at 16 scales ranks it and says where in the frame the paste sits.
 * The pasted image is often a crop or a letterboxed screenshot of the frame, so
 * several views of it are hashed (as is, borders trimmed, centre crop at the
 * frame's aspect) and compared against the frame and a grid of its sub-windows.
 * Frames of one hold are alike down to the pixel; the match names the hold, not
 * one frame inside it.
 */
import sharp from "sharp";
import { existsSync, statSync } from "node:fs";
import { readJson, writeJson } from "../util.ts";

export const HASH_SIZE = 16;
export type Hash = Uint8Array; // HASH_SIZE * HASH_SIZE bits

export const dhashBuffer = async (img: sharp.Sharp): Promise<Hash> => {
  const w = HASH_SIZE + 1, h = HASH_SIZE;
  const raw = await img.clone().flatten({ background: "#000" }).grayscale().resize(w, h, { fit: "fill", kernel: "lanczos3" }).raw().toBuffer();
  const out = new Uint8Array((HASH_SIZE * HASH_SIZE) / 8);
  let bit = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < HASH_SIZE; x++) {
      const i = y * w + x;
      if (raw[i] < raw[i + 1]) out[bit >> 3] |= 1 << (7 - (bit & 7));
      bit++;
    }
  }
  return out;
};

export const dhash = (file: string | Buffer) => dhashBuffer(sharp(file));

export const hamming = (a: Hash, b: Hash): number => {
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = a[i] ^ b[i];
    while (x) {
      d += x & 1;
      x >>= 1;
    }
  }
  return d;
};

export const hashToHex = (h: Hash) => Buffer.from(h).toString("hex");
export const hexToHash = (s: string): Hash => new Uint8Array(Buffer.from(s, "hex"));

/** centre region at a given aspect, as an extract box */
const centreBox = (w: number, h: number, aspect: number, share = 1): { left: number; top: number; width: number; height: number } => {
  let cw = w, ch = Math.round(w / aspect);
  if (ch > h) {
    ch = h;
    cw = Math.round(h * aspect);
  }
  cw = Math.max(8, Math.round(cw * share));
  ch = Math.max(8, Math.round(ch * share));
  return { left: Math.round((w - cw) / 2), top: Math.round((h - ch) / 2), width: cw, height: ch };
};

export type FrameHashes = { full: Hash; windows: { name: string; hash: Hash }[] };

/** sub-windows of a frame a crop could be: two scales, 10 % steps, at the frame's aspect */
export const WINDOW_SCALES = [0.6, 0.5, 0.4];
export const windowBoxes = (w: number, h: number): { name: string; left: number; top: number; width: number; height: number }[] => {
  const out: { name: string; left: number; top: number; width: number; height: number }[] = [];
  for (const scale of WINDOW_SCALES) {
    const width = Math.round(w * scale), height = Math.round(h * scale);
    const k = Math.round((1 - scale) / 0.1) + 1;
    for (let i = 0; i < k; i++)
      for (let j = 0; j < k; j++) {
        const fx = (i / (k - 1)) * (1 - scale), fy = (j / (k - 1)) * (1 - scale);
        out.push({ name: `window ${Math.round(scale * 100)}% at ${Math.round(fx * 100)},${Math.round(fy * 100)}`, left: Math.round(w * fx), top: Math.round(h * fy), width, height });
      }
  }
  return out;
};

/** hashes of a frame: the whole picture and every sub-window, from one decode */
export const hashFrame = async (file: string): Promise<FrameHashes> => {
  const { data, info } = await sharp(file).flatten({ background: "#000" }).grayscale().raw().toBuffer({ resolveWithObject: true });
  const raw = () => sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } });
  const full = await dhashBuffer(raw());
  const windows: FrameHashes["windows"] = [];
  for (const b of windowBoxes(info.width, info.height)) windows.push({ name: b.name, hash: await dhashBuffer(raw().extract({ left: b.left, top: b.top, width: b.width, height: b.height })) });
  return { full, windows };
};

/** cached per run: file -> hashes, keyed by mtime so a re-render invalidates */
export const hashFrames = async (files: string[], cacheFile?: string, onProgress?: (done: number, total: number) => void): Promise<Map<string, FrameHashes>> => {
  type Entry = { mtime: number; full: string; windows: [string, string][] };
  const cache: Record<string, Entry> = cacheFile && existsSync(cacheFile) ? readJson(cacheFile) : {};
  const out = new Map<string, FrameHashes>();
  let dirty = false;
  let done = 0;
  for (const f of files) {
    if (!existsSync(f)) continue;
    const mtime = statSync(f).mtimeMs;
    const e = cache[f];
    if (e && e.mtime === mtime && e.windows) {
      out.set(f, { full: hexToHash(e.full), windows: e.windows.map(([name, hash]) => ({ name, hash: hexToHash(hash) })) });
      continue;
    }
    const hs = await hashFrame(f);
    out.set(f, hs);
    cache[f] = { mtime, full: hashToHex(hs.full), windows: hs.windows.map((w) => [w.name, hashToHex(w.hash)]) };
    dirty = true;
    onProgress?.(++done, files.length);
  }
  if (cacheFile && dirty) writeJson(cacheFile, cache);
  return out;
};

export type QueryView = { name: string; hash: Hash };

/** the pasted image in several views: as is, borders trimmed (letterbox), centre crop at the frame aspect */
export const queryViews = async (file: string | Buffer, frameAspect: number): Promise<QueryViews> => {
  const meta = await sharp(file).metadata();
  const w = meta.width ?? 0, h = meta.height ?? 0;
  const views: QueryView[] = [{ name: "as is", hash: await dhash(file) }];
  try {
    const trimmed = sharp(file).flatten({ background: "#000" }).trim({ threshold: 24 });
    const tb = await trimmed.toBuffer({ resolveWithObject: true });
    if (tb.info.width < w - 4 || tb.info.height < h - 4) views.push({ name: "trimmed", hash: await dhash(tb.data) });
  } catch {
    /* a flat image cannot be trimmed */
  }
  const box = centreBox(w, h, frameAspect, 1);
  if (box.width < w - 2 || box.height < h - 2) views.push({ name: "centre at frame aspect", hash: await dhashBuffer(sharp(file).extract(box)) });
  return { width: w, height: h, views };
};
export type QueryViews = { width: number; height: number; views: QueryView[] };

export type Match<T> = { frame: T; distance: number; view: string; against: string };

export const bestMatches = <T extends { file: string }>(frames: T[], hashes: Map<string, FrameHashes>, q: QueryViews, n = 3): Match<T>[] => {
  const out: Match<T>[] = [];
  for (const f of frames) {
    const hs = hashes.get(f.file);
    if (!hs) continue;
    let best: Match<T> | null = null;
    for (const v of q.views) {
      const d = hamming(v.hash, hs.full);
      if (!best || d < best.distance) best = { frame: f, distance: d, view: v.name, against: "full frame" };
      for (const w of hs.windows) {
        const dw = hamming(v.hash, w.hash);
        if (dw < best.distance) best = { frame: f, distance: dw, view: v.name, against: w.name };
      }
    }
    if (best) out.push(best);
  }
  // on equal distance a whole-frame match beats a sub-window (a flat window of anything ties with a flat paste)
  return out.sort((a, b) => a.distance - b.distance || (a.against === "full frame" ? -1 : 0) - (b.against === "full frame" ? -1 : 0)).slice(0, n);
};

/* ---------- refinement: where exactly does the paste sit in the frame ---------- */

type Gray = { data: Buffer; w: number; h: number };
const gray = async (input: string | Buffer, width: number, height?: number): Promise<Gray> => {
  const { data, info } = await sharp(input).flatten({ background: "#000" }).grayscale().resize(width, height ?? null, { ...(height ? { fit: "fill" as const } : {}), kernel: "lanczos3" }).raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
};

export type Fit = { score: number; scale: number; x: number; y: number; /** the paste has no detail at all, nothing can fit it */ flat?: boolean };
export const REFINE_WIDTH = 128;
export const REFINE_SCALES = Array.from({ length: 16 }, (_, i) => 0.25 + i * 0.05);

/**
 * Slide the paste over a small grayscale of the frame at several scales and score
 * each position by normalized cross-correlation (1 = same picture up to brightness
 * and contrast; a flat window scores 0, so a dark ground never "fits" everything).
 */
export const refineFit = async (frameFile: string, query: string | Buffer, opts: { frameGray?: Gray; width?: number } = {}): Promise<Fit> => {
  const F = opts.frameGray ?? (await gray(frameFile, opts.width ?? REFINE_WIDTH));
  const W = F.w, H = F.h;
  // integral images of the frame and its squares, (W+1)x(H+1)
  const S = new Float64Array((W + 1) * (H + 1)), S2 = new Float64Array((W + 1) * (H + 1));
  for (let y = 1; y <= H; y++)
    for (let x = 1; x <= W; x++) {
      const v = F.data[(y - 1) * W + (x - 1)];
      const i = y * (W + 1) + x;
      S[i] = v + S[i - 1] + S[i - (W + 1)] - S[i - (W + 1) - 1];
      S2[i] = v * v + S2[i - 1] + S2[i - (W + 1)] - S2[i - (W + 1) - 1];
    }
  const box = (I: Float64Array, x: number, y: number, w: number, h: number) => I[(y + h) * (W + 1) + x + w] - I[y * (W + 1) + x + w] - I[(y + h) * (W + 1) + x] + I[y * (W + 1) + x];
  const qm = await sharp(query).metadata();
  const qAspect = (qm.width ?? 1) / (qm.height ?? 1);
  let best: Fit = { score: 0, scale: 0, x: 0, y: 0 };
  let anyDetail = false;
  const tried = new Set<number>();
  const scales = [...REFINE_SCALES];
  for (let si = 0; si < scales.length; si++) {
    const scale = scales[si];
    const qw = Math.round(W * scale), qh = Math.round(qw / qAspect);
    if (tried.has(qw * 1000 + qh)) continue;
    tried.add(qw * 1000 + qh);
    // after the coarse pass, look finer around the best scale
    if (si === REFINE_SCALES.length - 1 && best.scale) for (let d = -0.04; d <= 0.04; d += 0.01) if (Math.abs(d) > 1e-9) scales.push(best.scale + d);
    if (qw < 20 || qh < 12 || qw > W || qh > H) continue;
    const Q = await gray(query, qw, qh);
    const N = qw * qh;
    let qs = 0;
    for (let i = 0; i < N; i++) qs += Q.data[i];
    const qMean = qs / N;
    const q = new Float32Array(N);
    let qVar = 0;
    for (let i = 0; i < N; i++) {
      q[i] = Q.data[i] - qMean;
      qVar += q[i] * q[i];
    }
    if (qVar / N < 1) continue; // a flat paste says nothing
    anyDetail = true;
    for (let y = 0; y + qh <= H; y++) {
      for (let x = 0; x + qw <= W; x++) {
        const fs = box(S, x, y, qw, qh), fs2 = box(S2, x, y, qw, qh);
        const fVar = fs2 - (fs * fs) / N;
        if (fVar < 1e-6) continue;
        let dot = 0;
        for (let j = 0; j < qh; j++) {
          const fo = (y + j) * W + x, qo = j * qw;
          for (let i = 0; i < qw; i++) dot += F.data[fo + i] * q[qo + i];
        }
        const score = dot / Math.sqrt(fVar * qVar); // sum(q') = 0, so the frame mean drops out of the numerator
        if (score > best.score) best = { score, scale, x: x / W, y: y / H };
      }
    }
  }
  return anyDetail ? best : { ...best, flat: true };
};

/** distances of the same picture land under ~10 of 256 bits, unrelated frames sit around 100-140 */
export const verdict = (d: number) => (d <= 12 ? "same" : d <= 32 ? "close" : d <= 64 ? "maybe" : "no match");
