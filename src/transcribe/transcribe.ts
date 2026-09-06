/**
 * Words with times from a recording. A model that listens (Gemini) returns
 * sentences and words with seconds; ffmpeg's silence detection sharpens the
 * boundaries, because a model's timestamps are good to a few hundred
 * milliseconds and a cut wants the gap between words. The result feeds
 * captions, the silence cut and the script model when a film is built from
 * footage.
 */
import { readFileSync, statSync, existsSync, writeFileSync } from "node:fs";
import { run } from "../util.ts";

export type Word = { w: string; start: number; end: number };
export type Segment = { start: number; end: number; text: string };
export type Silence = { start: number; end: number };
export type Transcript = { file: string; language?: string; seconds: number; segments: Segment[]; words: Word[]; silences: Silence[]; provider: string; model: string; madeAt: string };

/** mono 16 kHz wav of the file's audio, what the model and the silence detector both want */
export const extractAudio = async (file: string, out: string, opts: { from?: number; to?: number } = {}) => {
  const args = ["-y", "-v", "error"];
  if (opts.from !== undefined) args.push("-ss", String(opts.from));
  args.push("-i", file);
  if (opts.to !== undefined) args.push("-t", String(opts.to - (opts.from ?? 0)));
  args.push("-vn", "-ac", "1", "-ar", "16000", out);
  await run(["ffmpeg", ...args]);
  return out;
};

/** spans quieter than `noiseDb` for at least `minSeconds`: where a cut can land without clipping a word */
export const detectSilences = async (file: string, opts: { noiseDb?: number; minSeconds?: number } = {}): Promise<Silence[]> => {
  const r = await run(["ffmpeg", "-hide_banner", "-nostats", "-i", file, "-vn", "-af", `silencedetect=noise=${opts.noiseDb ?? -35}dB:d=${opts.minSeconds ?? 0.35}`, "-f", "null", "-"], { quiet: true });
  const text = r.err + r.out;
  const out: Silence[] = [];
  let start: number | null = null;
  for (const line of text.split("\n")) {
    const s = line.match(/silence_start:\s*(-?[\d.]+)/);
    const e = line.match(/silence_end:\s*(-?[\d.]+)/);
    if (s) start = parseFloat(s[1]);
    if (e && start !== null) {
      out.push({ start: Math.max(0, start), end: parseFloat(e[1]) });
      start = null;
    }
  }
  return out;
};

/** shot changes: seconds where the picture changes by more than `threshold` (0..1) between frames */
export const detectShots = async (file: string, opts: { threshold?: number } = {}): Promise<number[]> => {
  const r = await run(["ffmpeg", "-hide_banner", "-nostats", "-i", file, "-vf", `select='gt(scene,${opts.threshold ?? 0.35})',showinfo`, "-an", "-f", "null", "-"], { quiet: true });
  const text = r.err + r.out;
  return [...text.matchAll(/pts_time:([\d.]+)/g)].map((m) => parseFloat(m[1]));
};

/** the model listens; up to 20 MB of wav inline (about ten minutes at 16 kHz mono) */
export const transcribeWithGemini = async (wav: string, opts: { model?: string; language?: string; apiKey?: string } = {}): Promise<{ language?: string; segments: Segment[]; words: Word[]; model: string; ms: number }> => {
  const key = opts.apiKey ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set (mh transcribe asks Gemini to listen)");
  const bytes = statSync(wav).size;
  if (bytes > 19 * 1024 * 1024) throw new Error(`${wav} is ${(bytes / 1048576).toFixed(1)} MB; inline audio is capped at 20 MB, transcribe a span (--from --to)`);
  const model = opts.model ?? "gemini-2.5-flash";
  const prompt = `Transcribe this audio${opts.language ? ` (language: ${opts.language})` : ""}. Answer with JSON only: {"language":"<iso code>","segments":[{"start":<seconds>,"end":<seconds>,"text":"..."}],"words":[{"w":"...","start":<seconds>,"end":<seconds>}]}. Segments are sentences as spoken, with punctuation. Every word once, in order, with its own start and end in seconds with two decimals, measured from the start of the file. If the audio contains no speech (music, noise, silence), return {"language":"","segments":[],"words":[]}. Never describe the audio and never write anything that was not said. No commentary.`;
  const body = { contents: [{ role: "user", parts: [{ inline_data: { mime_type: "audio/wav", data: readFileSync(wav).toString("base64") } }, { text: prompt }] }], generationConfig: { temperature: 0, responseMimeType: "application/json" } };
  const t0 = performance.now();
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j = (await r.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  let parsed: { language?: string; segments?: Segment[]; words?: Word[] } = {};
  try {
    parsed = JSON.parse(text.replace(/^```json\s*|```$/g, ""));
  } catch {
    throw new Error(`Gemini did not return JSON: ${text.slice(0, 200)}`);
  }
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : parseFloat(String(v)) || 0);
  let segments = (parsed.segments ?? []).map((s) => ({ start: num(s.start), end: num(s.end), text: String(s.text ?? "").trim() })).filter((s) => s.text);
  let words = (parsed.words ?? []).map((w) => ({ w: String(w.w ?? "").trim(), start: num(w.start), end: num(w.end) })).filter((w) => w.w);
  // a model asked to transcribe music sometimes narrates the request instead: that is not speech in the file
  const meta = /\b(transcrib|this audio|no speech|the audio)\b/i;
  const tiny = segments.length <= 1 && words.length <= 2;
  if ((segments.length <= 2 && words.length < 12 && segments.every((s) => meta.test(s.text))) || (tiny && segments.every((s) => /^(music|noise|silence|applause|laughter)\W*$/i.test(s.text)))) {
    segments = [];
    words = [];
  }
  return { language: parsed.language, segments, words, model, ms: Math.round(performance.now() - t0) };
};

/** move each segment edge into the nearest silence when one lies within `reach` seconds: model times snapped to real gaps */
export const snapToSilences = (segments: Segment[], silences: Silence[], reach = 0.35): Segment[] => {
  if (!silences.length) return segments;
  const mids = silences.map((s) => ({ ...s, mid: (s.start + s.end) / 2 }));
  const nearest = (t: number) => mids.reduce<{ d: number; s: (typeof mids)[number] | null }>((best, s) => (Math.abs(s.mid - t) < best.d ? { d: Math.abs(s.mid - t), s } : best), { d: Infinity, s: null });
  return segments.map((seg) => {
    const a = nearest(seg.start), b = nearest(seg.end);
    return { ...seg, start: a.s && a.d <= reach ? a.s.end : seg.start, end: b.s && b.d <= reach ? b.s.start : seg.end };
  });
};

export const transcriptSrt = (segments: Segment[]): string => {
  const fmt = (t: number) => {
    const ms = Math.round(Math.max(0, t) * 1000);
    const p = (n: number, w = 2) => String(n).padStart(w, "0");
    return `${p(Math.floor(ms / 3600000))}:${p(Math.floor((ms % 3600000) / 60000))}:${p(Math.floor((ms % 60000) / 1000))},${p(ms % 1000, 3)}`;
  };
  return segments.map((s, i) => `${i + 1}\n${fmt(s.start)} --> ${fmt(Math.max(s.start + 0.3, s.end))}\n${s.text}\n`).join("\n") + (segments.length ? "\n" : "");
};

export const transcribeFile = async (file: string, wavPath: string, opts: { model?: string; language?: string; from?: number; to?: number; log?: (s: string) => void } = {}): Promise<Transcript> => {
  const log = opts.log ?? (() => {});
  await extractAudio(file, wavPath, { from: opts.from, to: opts.to });
  const seconds = parseFloat((await run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", wavPath])).out.trim());
  const silences = await detectSilences(wavPath);
  log(`${seconds.toFixed(1)}s of audio, ${silences.length} silence${silences.length === 1 ? "" : "s"} over 0.35 s`);
  const r = await transcribeWithGemini(wavPath, { model: opts.model, language: opts.language });
  const offset = opts.from ?? 0;
  const segments = snapToSilences(r.segments.map((s) => ({ ...s, start: s.start + offset, end: s.end + offset })), silences.map((s) => ({ start: s.start + offset, end: s.end + offset })));
  return { file, language: r.language, seconds, segments, words: r.words.map((w) => ({ ...w, start: w.start + offset, end: w.end + offset })), silences: silences.map((s) => ({ start: s.start + offset, end: s.end + offset })), provider: "gemini", model: r.model, madeAt: new Date().toISOString() };
};

export const saveTranscript = (t: Transcript, path: string) => writeFileSync(path, JSON.stringify(t, null, 2));
export const loadTranscript = (path: string): Transcript | null => (existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Transcript) : null);
