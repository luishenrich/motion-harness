/**
 * Footage in, facts out. Any file a film might use (a recording, a generated
 * clip, a photo, a screen capture, a music track) is probed once and written
 * to assets.json: streams, length, size, loudness, shot changes, silences,
 * mean colour, an optional transcript. The script model reads this list to
 * place footage into scenes; the scaffold reads it to build them.
 */
import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync, rmSync } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";
import sharp from "sharp";
import type { LoadedConfig } from "../config.ts";
import { probeClip } from "../clips/clips.ts";
import { measureLoudness } from "../audio/loudness.ts";
import { detectShots, detectSilences, extractAudio, transcribeFile, saveTranscript, type Transcript } from "../transcribe/transcribe.ts";
import { lookAtFrame, type LookCategory } from "./look.ts";
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
  /** one entry per shot: where it starts, how bright it is and the colour of its outer edge, so a scene that starts mid-clip sits on the ground it blends into */
  segments?: { start: number; luma: number; edge: string }[];
  /** spans without speech or sound */
  silences?: { start: number; end: number }[];
  colour?: { first: { luma: number }; mid: { luma: number; edge?: string }; last: { luma: number } };
  /** pixels of near-black at each edge of the mid frame: a clip that carries its own bars */
  darkEdges?: { left: number; right: number; top: number; bottom: number };
  /** what a model saw in the mid frame: the main subject, its kind, its box (x, y, w, h as fractions), readable text */
  subject?: { label: string; category: LookCategory; box: [number, number, number, number]; text?: string };
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

/** mean luma of a frame at `t` seconds and the colour of its outer ring, from a 160 px downscale */
const lumaAt = async (file: string, t: number, png: string): Promise<{ luma: number; edge: string } | null> => {
  await run(["ffmpeg", "-y", "-v", "error", "-ss", t.toFixed(3), "-i", file, "-frames:v", "1", "-vf", "scale=160:-2", png]).catch(() => null);
  if (!existsSync(png)) return null;
  return frameStats(png);
};

/** luma over the whole frame; the edge colour is the per-channel median of the outer two pixel rows and columns, so a title bar or a border does not tint it */
const frameStats = async (png: string): Promise<{ luma: number; edge: string }> => {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;
  let l = 0;
  const ring: [number[], number[], number[]] = [[], [], []];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      l += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      if (x < 2 || y < 2 || x >= W - 2 || y >= H - 2) {
        ring[0].push(data[i]);
        ring[1].push(data[i + 1]);
        ring[2].push(data[i + 2]);
      }
    }
  const median = (v: number[]) => v.sort((a, b) => a - b)[Math.floor(v.length / 2)] ?? 0;
  const hex = (v: number[]) => median(v).toString(16).padStart(2, "0");
  return { luma: Math.round(l / (W * H)), edge: `#${hex(ring[0])}${hex(ring[1])}${hex(ring[2])}`.toUpperCase() };
};

/** the shot that contains `t`: its luma and edge colour; the mid frame's luma when the clip has no per-shot readings */
export const shotAtTime = (a: Asset, t: number): { luma: number; edge?: string } | null => {
  if (a.segments?.length) {
    const seg = [...a.segments].reverse().find((x) => x.start <= t) ?? a.segments[0];
    return { luma: seg.luma, edge: seg.edge };
  }
  return a.colour ? { luma: a.colour.mid.luma, edge: a.colour.mid.edge } : null;
};

const streams = async (file: string) => {
  const p = await run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,width,height,r_frame_rate,channels,pix_fmt,color_range,color_space:format=duration,size", "-of", "json", file]);
  return JSON.parse(p.out) as { streams: { codec_type: string; width?: number; height?: number; r_frame_rate?: string; channels?: number; pix_fmt?: string; color_range?: string; color_space?: string }[]; format: { duration?: string; size?: string } };
};

/**
 * A full-range clip (yuvj420p, color_range pc: screen recordings and phone exports often are) decodes differently
 * in a browser and in ffmpeg: the browser stretches it and a cream ground turns white while the ground the
 * scaffold measured stays cream. The harness's copy is re-encoded to limited range, bt709 tagged, so every
 * decoder agrees. Only the copy changes, never the original.
 */
const normaliseRange = async (src: string, dst: string, v: { pix_fmt?: string; color_range?: string; color_space?: string }, log: (s: string) => void) => {
  const matrix = v.color_space && v.color_space !== "unknown" ? v.color_space : "";
  const vf = `scale=in_range=pc:out_range=tv${matrix ? `:in_color_matrix=${matrix}:out_color_matrix=bt709` : ""}`;
  const tmp = dst + ".tv.mp4";
  await run(["ffmpeg", "-y", "-v", "error", "-i", src, "-vf", vf, "-pix_fmt", "yuv420p", "-color_range", "tv", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-c:v", "libx264", "-preset", "medium", "-crf", "14", "-c:a", "copy", "-movflags", "+faststart", tmp]);
  copyFileSync(tmp, dst);
  rmSync(tmp);
  log(`${basename(dst)}: full-range ${v.pix_fmt ?? ""}${matrix ? ` ${matrix}` : ""} re-encoded to limited range bt709, so the browser and ffmpeg show the same colours`);
};

/** a 640 px frame from the middle of a clip, or the image itself at that width: what the model looks at */
const lookFrame = async (abs: string, kind: AssetKind, seconds: number, out: string) => {
  if (kind === "image") await sharp(abs).resize({ width: 640, withoutEnlargement: true }).png().toFile(out);
  else await run(["ffmpeg", "-y", "-v", "error", "-ss", (seconds / 2).toFixed(3), "-i", abs, "-frames:v", "1", "-vf", "scale=640:-2", out]);
  return out;
};

const lookAt = async (asset: Asset, abs: string, work: string, log: (s: string) => void) => {
  const png = await lookFrame(abs, asset.kind, asset.seconds ?? 0, join(work, "look.png"));
  const L = await lookAtFrame(png);
  asset.subject = { label: L.label, category: L.category, box: L.box, text: L.text };
  log(`${asset.id}: ${L.category}, ${L.label}, box ${L.box.map((n) => n.toFixed(2)).join(" ")}${L.text ? `, text "${L.text.slice(0, 60)}"` : ""} (${L.model}, ${L.ms} ms)`);
};

export const ingestFile = async (cfg: LoadedConfig, file: string, opts: { id?: string; copyTo?: string; transcribe?: boolean; look?: boolean; shots?: boolean; silence?: boolean; license?: string; language?: string; log?: (s: string) => void }): Promise<Asset> => {
  const log = opts.log ?? (() => {});
  let abs = resolve(file);
  if (!existsSync(abs)) throw new Error(`no such file: ${abs}`);
  const fullRange = (v?: { pix_fmt?: string; color_range?: string }) => !!v && (v.color_range === "pc" || (v.pix_fmt ?? "").startsWith("yuvj"));
  if (opts.copyTo) {
    const dst = join(resolve(cfg.projectDir, opts.copyTo), basename(abs));
    mkdirSync(join(dst, ".."), { recursive: true });
    const src = kindOf(abs) === "video" ? (await streams(abs)).streams.find((x) => x.codec_type === "video") : undefined;
    if (resolve(dst) !== abs) {
      if (fullRange(src)) await normaliseRange(abs, dst, src!, opts.log ?? (() => {}));
      else copyFileSync(abs, dst);
    }
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
    await sharp(abs).resize({ width: 160 }).png().toFile(join(work, "stats.png"));
    const { luma, edge } = await frameStats(join(work, "stats.png"));
    asset.colour = { first: { luma }, mid: { luma, edge }, last: { luma } };
    asset.summary = `${m.width}x${m.height} image, luma ${luma}`;
    log(`${id}: image ${m.width}x${m.height}`);
    if (opts.look) await lookAt(asset, abs, work, log);
    return asset;
  }
  const j = await streams(abs);
  const v = j.streams.find((s) => s.codec_type === "video");
  const a = j.streams.find((s) => s.codec_type === "audio");
  asset.seconds = parseFloat(j.format.duration ?? "0");
  asset.bytes = parseInt(j.format.size ?? "0", 10);
  asset.hasAudio = !!a;
  if (v && kind === "video") {
    if (fullRange(v)) log(`${id}: full-range colour (${v.pix_fmt}); a browser stretches it and ffmpeg does not, ingest with --copy to get a limited-range copy`);
    const p = await probeClip(abs, work);
    asset.width = p.width;
    asset.height = p.height;
    asset.fps = p.fps;
    asset.colour = { first: { luma: p.colour.first.luma }, mid: { luma: p.colour.mid.luma }, last: { luma: p.colour.last.luma } };
    if (opts.shots !== false) {
      asset.shots = await detectShots(abs);
      const starts = [0, ...asset.shots].slice(0, 24);
      const segs: { start: number; luma: number; edge: string }[] = [];
      for (let i = 0; i < starts.length; i++) {
        const end = starts[i + 1] ?? asset.seconds ?? starts[i] + 1;
        const st = await lumaAt(abs, Math.min(starts[i] + 0.15, (starts[i] + end) / 2), join(work, `seg-${i}.png`));
        if (st) segs.push({ start: Math.round(starts[i] * 100) / 100, luma: st.luma, edge: st.edge });
      }
      asset.segments = segs;
    }
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
    if (opts.look) await lookAt(asset, abs, work, log);
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
      if (a.subject) lines.push(`    shows: ${a.subject.label} (${a.subject.category}), subject centre ${(a.subject.box[0] + a.subject.box[2] / 2).toFixed(2)},${(a.subject.box[1] + a.subject.box[3] / 2).toFixed(2)}${a.subject.text ? `; on-screen text: ${a.subject.text}` : ""}`);
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
