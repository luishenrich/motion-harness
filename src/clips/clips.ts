/**
 * Generated clips as a registry. Every clip a model made carries what it cost
 * and what made it (prompt, model, seed), plus what the file is (size, length,
 * fps, mean colour of first, middle and last frame). The timeline names clips
 * per scene, and a lint compares the colour of consecutive clips: the drift
 * that stops generated shots from cutting together.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import sharp from "sharp";
import type { LoadedConfig } from "../config.ts";
import type { Compiled } from "../timeline/schema.ts";
import type { Finding } from "../lint/lint.ts";
import { ensureDir, run } from "../util.ts";

export type ClipColour = { r: number; g: number; b: number; luma: number };
export type Clip = {
  id: string;
  file: string;
  prompt?: string;
  model?: string;
  seed?: string | number;
  /** what the attempt cost, in the provider's credits and/or money */
  credits?: number;
  cost?: number;
  currency?: string;
  /** attempts it took to get this keeper (the prompt lottery, counted) */
  attempts?: number;
  width: number;
  height: number;
  fps: number;
  seconds: number;
  bytes: number;
  colour: { first: ClipColour; mid: ClipColour; last: ClipColour };
  addedAt: string;
  tags?: string[];
};

export const clipsPath = (cfg: LoadedConfig) => join(cfg.projectDir, "clips.json");

export const loadClips = (cfg: LoadedConfig): Clip[] => (existsSync(clipsPath(cfg)) ? (JSON.parse(readFileSync(clipsPath(cfg), "utf8")) as Clip[]) : []);
export const saveClips = (cfg: LoadedConfig, clips: Clip[]) => writeFileSync(clipsPath(cfg), JSON.stringify(clips, null, 2));

const meanColour = async (png: string): Promise<ClipColour> => {
  const { data, info } = await sharp(png).resize(32, 18, { fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let r = 0, g = 0, b = 0;
  const n = info.width * info.height;
  for (let i = 0; i < n; i++) {
    r += data[i * 3];
    g += data[i * 3 + 1];
    b += data[i * 3 + 2];
  }
  r /= n;
  g /= n;
  b /= n;
  return { r: Math.round(r), g: Math.round(g), b: Math.round(b), luma: Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b) };
};

/** read the file: streams, and the mean colour at three moments */
export const probeClip = async (file: string, workDir: string): Promise<Pick<Clip, "width" | "height" | "fps" | "seconds" | "bytes" | "colour">> => {
  const p = await run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate:format=duration,size", "-of", "json", file]);
  const j = JSON.parse(p.out) as { streams: { width: number; height: number; r_frame_rate: string }[]; format: { duration: string; size: string } };
  const st = j.streams[0];
  const [num, den] = st.r_frame_rate.split("/").map(Number);
  const seconds = parseFloat(j.format.duration);
  ensureDir(workDir);
  const at = async (t: number, name: string) => {
    const png = join(workDir, `${basename(file)}-${name}.png`);
    await run(["ffmpeg", "-y", "-v", "error", "-ss", t.toFixed(3), "-i", file, "-frames:v", "1", "-vf", "scale=160:-2", png]);
    return meanColour(png);
  };
  return { width: st.width, height: st.height, fps: Math.round((num / (den || 1)) * 100) / 100, seconds, bytes: parseInt(j.format.size, 10), colour: { first: await at(0.05, "first"), mid: await at(Math.max(0.05, seconds / 2), "mid"), last: await at(Math.max(0.05, seconds - 0.1), "last") } };
};

export const addClip = async (cfg: LoadedConfig, file: string, meta: Partial<Pick<Clip, "id" | "prompt" | "model" | "seed" | "credits" | "cost" | "currency" | "attempts" | "tags">>, workDir: string): Promise<Clip> => {
  const abs = resolve(cfg.projectDir, file);
  if (!existsSync(abs)) throw new Error(`no such clip: ${abs}`);
  const rel = relative(cfg.projectDir, abs);
  const id = meta.id ?? basename(abs).replace(/\.[a-z0-9]+$/i, "");
  const clips = loadClips(cfg).filter((c) => c.id !== id);
  const probed = await probeClip(abs, workDir);
  const clip: Clip = { id, file: rel, ...meta, ...probed, addedAt: new Date().toISOString() };
  clips.push(clip);
  saveClips(cfg, clips);
  return clip;
};

/** colour drift between consecutive clips in film order (scenes that name a clip), and clips the timeline names but the registry lacks */
export const lintClips = (cfg: LoadedConfig, c: Compiled, opts: { lumaDelta?: number; chromaDelta?: number } = {}): Finding[] => {
  const clips = loadClips(cfg);
  const byId = new Map(clips.map((k) => [k.id, k]));
  const out: Finding[] = [];
  const lumaDelta = opts.lumaDelta ?? 24, chromaDelta = opts.chromaDelta ?? 18;
  let prev: { scene: string; clip: Clip } | null = null;
  for (const s of c.scenes) {
    if (!s.clip) continue;
    const clip = byId.get(s.clip);
    if (!clip) {
      out.push({ level: "error", rule: "clip-registered", where: s.id, message: `names clip "${s.clip}" which clips.json does not have (mh clips add <file> --id ${s.clip})` });
      continue;
    }
    if (!existsSync(resolve(cfg.projectDir, clip.file))) out.push({ level: "error", rule: "clip-file", where: s.id, message: `clip "${clip.id}" file is missing: ${clip.file}` });
    const need = s.dur / c.fps;
    if (clip.seconds + 0.05 < need) out.push({ level: "warn", rule: "clip-too-short", where: s.id, message: `clip "${clip.id}" is ${clip.seconds.toFixed(2)}s, the scene needs ${need.toFixed(2)}s` });
    if (prev) {
      const a = prev.clip.colour.last, b = clip.colour.first;
      const dl = Math.abs(a.luma - b.luma);
      const dc = Math.max(Math.abs(a.r - b.r - (a.luma - b.luma)), Math.abs(a.g - b.g - (a.luma - b.luma)), Math.abs(a.b - b.b - (a.luma - b.luma)));
      if (dl > lumaDelta || dc > chromaDelta) out.push({ level: "warn", rule: "clip-colour-drift", where: `${prev.scene} -> ${s.id}`, message: `mean colour jumps at the cut: luma ${a.luma} -> ${b.luma} (${dl > lumaDelta ? "over" : "within"} ${lumaDelta}), chroma delta ${dc} (${dc > chromaDelta ? "over" : "within"} ${chromaDelta}); match the grade or regenerate with the previous clip's last frame as reference` });
    }
    prev = { scene: s.id, clip };
  }
  return out;
};

export const clipCost = (clips: Clip[]) => ({ credits: clips.reduce((a, c) => a + (c.credits ?? 0), 0), cost: clips.reduce((a, c) => a + (c.cost ?? 0), 0), attempts: clips.reduce((a, c) => a + (c.attempts ?? 1), 0), currency: clips.find((c) => c.currency)?.currency ?? "" });
