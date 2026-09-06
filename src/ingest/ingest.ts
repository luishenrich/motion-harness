/**
 * Footage in, facts out. Any file a film might use (a recording, a generated
 * clip, a photo, a screen capture, a music track) is probed once and written
 * to assets.json: streams, length, size, loudness, shot changes, silences,
 * mean colour, an optional transcript. The script model reads this list to
 * place footage into scenes; the scaffold reads it to build them.
 */
import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";
import sharp from "sharp";
import type { LoadedConfig } from "../config.ts";
import { probeClip } from "../clips/clips.ts";
import { measureLoudness } from "../audio/loudness.ts";
import { detectShots, detectSilences, extractAudio, transcribeFile, saveTranscript, type Transcript } from "../transcribe/transcribe.ts";
import { ensureDir, run } from "../util.ts";

export type AssetKind = "video" | "audio" | "image";
export type Asset = {
  id: string;
  file: string;
  kind: AssetKind;
  width?: number;
  height?: number;
  fps?: number;
  seconds?: number;
  bytes: number;
  hasAudio?: boolean;
  loudness?: { lufs: number; truePeak: number };
  /** seconds where the picture cuts (shot changes) */
  shots?: number[];
  /** spans without speech or sound */
  silences?: { start: number; end: number }[];
  colour?: { first: { luma: number }; mid: { luma: number }; last: { luma: number } };
  /** pixels of near-black at each edge of the mid frame: a clip that carries its own bars */
  darkEdges?: { left: number; right: number; top: number; bottom: number };
  transcript?: string;
  /** a one-line summary for the script model: first sentence of the transcript, or the shot count */
  summary?: string;
  license?: string;
  addedAt: string;
};

export const assetsPath = (cfg: LoadedConfig) => join(cfg.projectDir, "assets.json");
export const loadAssets = (cfg: LoadedConfig): Asset[] => (existsSync(assetsPath(cfg)) ? (JSON.parse(readFileSync(assetsPath(cfg), "utf8")) as Asset[]) : []);
export const saveAssets = (cfg: LoadedConfig, list: Asset[]) => writeFileSync(assetsPath(cfg), JSON.stringify(list, null, 2));

const IMAGE = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif"]);
const AUDIO = new Set([".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".aiff"]);

export const kindOf = (file: string): AssetKind => {
  const e = extname(file).toLowerCase();
  return IMAGE.has(e) ? "image" : AUDIO.has(e) ? "audio" : "video";
};

/** how many pixels from each edge are near black (luma under 32) all the way along that edge */
export const darkEdges = async (png: string): Promise<{ left: number; right: number; top: number; bottom: number }> => {
  if (!existsSync(png)) return { left: 0, right: 0, top: 0, bottom: 0 };
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;
  const px = (x: number, y: number) => {
    const i = (y * W + x) * 3;
    return 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  };
  const colDark = (x: number) => {
    let s = 0;
    for (let y = 0; y < H; y++) s += px(x, y);
    return s / H < 26;
  };
  const rowDark = (y: number) => {
    let s = 0;
    for (let x = 0; x < W; x++) s += px(x, y);
    return s / W < 26;
  };
  let left = 0, right = 0, top = 0, bottom = 0;
  while (left < W / 2 && colDark(left)) left++;
  while (right < W / 2 && colDark(W - 1 - right)) right++;
  while (top < H / 2 && rowDark(top)) top++;
  while (bottom < H / 2 && rowDark(H - 1 - bottom)) bottom++;
  return { left, right, top, bottom };
};

const streams = async (file: string) => {
  const p = await run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,width,height,r_frame_rate,channels:format=duration,size", "-of", "json", file]);
  return JSON.parse(p.out) as { streams: { codec_type: string; width?: number; height?: number; r_frame_rate?: string; channels?: number }[]; format: { duration?: string; size?: string } };
};

export const ingestFile = async (cfg: LoadedConfig, file: string, opts: { id?: string; copyTo?: string; transcribe?: boolean; shots?: boolean; silence?: boolean; license?: string; language?: string; log?: (s: string) => void }): Promise<Asset> => {
  const log = opts.log ?? (() => {});
  let abs = resolve(file);
  if (!existsSync(abs)) throw new Error(`no such file: ${abs}`);
  if (opts.copyTo) {
    const dst = join(resolve(cfg.projectDir, opts.copyTo), basename(abs));
    mkdirSync(join(dst, ".."), { recursive: true });
    if (resolve(dst) !== abs) copyFileSync(abs, dst);
    abs = dst;
  }
  const id = opts.id ?? basename(abs).replace(/\.[a-z0-9]+$/i, "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const kind = kindOf(abs);
  const work = ensureDir(join(cfg.cachePath, "ingest", id));
  const rel = relative(cfg.projectDir, abs);
  const asset: Asset = { id, file: rel.startsWith("..") ? abs : rel, kind, bytes: 0, addedAt: new Date().toISOString(), license: opts.license };
  if (kind === "image") {
    const m = await sharp(abs).metadata();
    asset.width = m.width;
    asset.height = m.height;
    asset.bytes = m.size ?? 0;
    const { data, info } = await sharp(abs).resize(32, 18, { fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    let l = 0;
    for (let i = 0; i < info.width * info.height; i++) l += 0.2126 * data[i * 3] + 0.7152 * data[i * 3 + 1] + 0.0722 * data[i * 3 + 2];
    const luma = Math.round(l / (info.width * info.height));
    asset.colour = { first: { luma }, mid: { luma }, last: { luma } };
    asset.summary = `${m.width}x${m.height} image, luma ${luma}`;
    log(`${id}: image ${m.width}x${m.height}`);
    return asset;
  }
  const j = await streams(abs);
  const v = j.streams.find((s) => s.codec_type === "video");
  const a = j.streams.find((s) => s.codec_type === "audio");
  asset.seconds = parseFloat(j.format.duration ?? "0");
  asset.bytes = parseInt(j.format.size ?? "0", 10);
  asset.hasAudio = !!a;
  if (v && kind === "video") {
    const p = await probeClip(abs, work);
    asset.width = p.width;
    asset.height = p.height;
    asset.fps = p.fps;
    asset.colour = { first: { luma: p.colour.first.luma }, mid: { luma: p.colour.mid.luma }, last: { luma: p.colour.last.luma } };
    if (opts.shots !== false) asset.shots = await detectShots(abs);
    // a bar is dark on every sampled frame and narrow; a dark ground with centred content is neither
    const frames = ["first", "mid", "last"].map((n) => join(work, `${basename(abs)}-${n}.png`));
    const es = await Promise.all(frames.map((f) => darkEdges(f)));
    const meta = await sharp(frames[1]).metadata().catch(() => ({ width: 160, height: 90 }));
    const sx = (p.width || 1) / (meta.width || 160), sy = (p.height || 1) / (meta.height || 90);
    const side = (k: "left" | "right" | "top" | "bottom", scale: number, full: number) => {
      const v = Math.min(...es.map((e) => e[k])) * scale;
      return v / full > 0.2 ? 0 : Math.round(v);
    };
    asset.darkEdges = { left: side("left", sx, p.width || 1), right: side("right", sx, p.width || 1), top: side("top", sy, p.height || 1), bottom: side("bottom", sy, p.height || 1) };
  }
  if (a) {
    try {
      const L = await measureLoudness(abs);
      asset.loudness = { lufs: Math.round(L.lufs * 10) / 10, truePeak: Math.round(L.truePeak * 10) / 10 };
    } catch {
      /* silent or odd stream */
    }
    if (opts.silence !== false) asset.silences = await detectSilences(abs);
    if (opts.transcribe) {
      const t: Transcript = await transcribeFile(abs, join(work, "audio.wav"), { language: opts.language, log });
      const tp = join(work, "transcript.json");
      saveTranscript(t, tp);
      asset.transcript = tp;
      asset.summary = t.segments.slice(0, 2).map((s) => s.text).join(" ").slice(0, 160);
      log(`${id}: ${t.segments.length} sentences, ${t.words.length} words (${t.model})`);
    }
  }
  if (!asset.summary) asset.summary = `${kind} ${asset.seconds?.toFixed(1)}s${asset.shots?.length ? `, ${asset.shots.length} shot change${asset.shots.length === 1 ? "" : "s"}` : ""}${asset.silences?.length ? `, ${asset.silences.length} silence${asset.silences.length === 1 ? "" : "s"}` : ""}`;
  log(`${id}: ${asset.summary}`);
  return asset;
};

export const ingestFiles = async (cfg: LoadedConfig, files: string[], opts: Parameters<typeof ingestFile>[2]): Promise<Asset[]> => {
  const list = loadAssets(cfg);
  const out: Asset[] = [];
  for (const f of files) {
    const a = await ingestFile(cfg, f, opts);
    const i = list.findIndex((x) => x.id === a.id);
    if (i >= 0) list[i] = a;
    else list.push(a);
    out.push(a);
  }
  saveAssets(cfg, list);
  return out;
};

/** what the script model gets to see about the footage */
export const assetsForModel = (assets: Asset[]): string =>
  assets
    .map((a) => {
      const t = a.transcript && existsSync(a.transcript) ? (JSON.parse(readFileSync(a.transcript, "utf8")) as Transcript) : null;
      const lines = [`- ${a.id} (${a.kind}${a.seconds ? `, ${a.seconds.toFixed(1)}s` : ""}${a.width ? `, ${a.width}x${a.height}` : ""})${a.shots?.length ? `, shot changes at ${a.shots.slice(0, 12).map((s) => s.toFixed(1)).join(", ")}s` : ""}`];
      if (t) lines.push(...t.segments.slice(0, 40).map((s) => `    ${s.start.toFixed(1)}-${s.end.toFixed(1)}s: ${s.text}`));
      return lines.join("\n");
    })
    .join("\n");

/** silence-cut suggestion: the spoken spans of an asset, each a candidate scene */
export const spokenSpans = (t: Transcript, minGap = 0.5): { start: number; end: number; text: string }[] => {
  const out: { start: number; end: number; text: string }[] = [];
  for (const s of t.segments) {
    const last = out[out.length - 1];
    if (last && s.start - last.end < minGap) {
      last.end = s.end;
      last.text += " " + s.text;
    } else out.push({ ...s });
  }
  return out;
};

export { extractAudio };
