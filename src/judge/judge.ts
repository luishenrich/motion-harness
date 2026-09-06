/**
 * A second opinion from a model that watches the actual file. Gemini takes the
 * rendered clip (inline, under 20 MB) together with the timeline of that span
 * and a checklist, and returns findings as JSON with the film time they refer
 * to. This is not the harness's judgement; it is the reviewer the harness
 * could not have, and every finding still has to be located with mh resolve.
 */
import { readFileSync, statSync } from "node:fs";
import type { Compiled, CompiledScene } from "../timeline/schema.ts";
import { fmtTime } from "../timeline/schema.ts";

export type JudgeFinding = { at: string; seconds?: number; severity: "error" | "warn" | "note"; what: string };
export type JudgeResult = { model: string; findings: JudgeFinding[]; summary: string; raw?: string };

const DEFAULT_MODEL = "gemini-2.5-flash";

export const judgePrompt = (c: Compiled, scenes: CompiledScene[], span: { start: number; end: number }, checklist: string[]): string => {
  const lines = scenes.map((s) => `- ${s.id}: film ${fmtTime(s.filmStart, c.fps)} to ${fmtTime(s.filmEnd, c.fps)} (clip ${(s.filmStart / c.fps - span.start).toFixed(2)}s to ${(s.filmEnd / c.fps - span.start).toFixed(2)}s), enter ${s.enter.type}${s.enter.dur ? ` ${s.enter.dur}f` : ""}${s.text ? `, text "${s.text.join(" / ")}"` : ""}${s.events.length ? `, events ${s.events.map((e) => `${e.name}@+${(e.local / c.fps).toFixed(2)}s`).join(" ")}` : ""}${s.why ? `, intent: ${s.why}` : ""}`);
  return [
    `You are reviewing a ${(span.end - span.start).toFixed(2)} second clip of a motion film at ${c.fps} fps. The clip starts at film time ${span.start.toFixed(2)}s.`,
    "The scenes in this clip, with what each one intends:",
    ...lines,
    "",
    "Check, in this order:",
    ...checklist.map((k, i) => `${i + 1}. ${k}`),
    "",
    'Answer with JSON only: {"summary": "one paragraph", "findings": [{"seconds": <clip seconds as number>, "severity": "error"|"warn"|"note", "what": "one sentence, concrete, what is wrong and what you saw"}]}.',
    "Report only what you can see or hear in the file. Timing in clip seconds. No praise, no fixes. If nothing is wrong, findings is an empty array.",
  ].join("\n");
};

export const DEFAULT_CHECKLIST = [
  "Motion: any element that pops, jumps, stutters, or arrives late or early against its scene's enter",
  "Legibility: text that is cut off, overlaps another element, wraps oddly, or is on screen too briefly to read",
  "Timing: a scene that holds too long with nothing happening, or cuts before its content has landed",
  "Continuity: colour, brightness or position that changes between consecutive scenes without intent",
  "Sound: music or effects that start, stop, or jump at a moment that reads as a mistake (only if the clip has audio)",
];

/** ask Gemini about the clip; the key is GEMINI_API_KEY (or GOOGLE_API_KEY) */
export const judgeClip = async (file: string, prompt: string, opts: { model?: string; apiKey?: string } = {}): Promise<JudgeResult> => {
  const key = opts.apiKey ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set (mh judge asks Gemini to watch the clip)");
  const bytes = statSync(file).size;
  if (bytes > 19 * 1024 * 1024) throw new Error(`${file} is ${(bytes / 1048576).toFixed(1)} MB; inline video is capped at 20 MB, render a shorter preview (mh render --scene a,b --preview --draft)`);
  const model = opts.model ?? DEFAULT_MODEL;
  const body = {
    contents: [{ role: "user", parts: [{ inline_data: { mime_type: "video/mp4", data: readFileSync(file).toString("base64") } }, { text: prompt }] }],
    generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
  };
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${(await r.text()).slice(0, 400)}`);
  const j = (await r.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  let parsed: { summary?: string; findings?: { seconds?: number; severity?: string; what?: string }[] } = {};
  try {
    parsed = JSON.parse(text.replace(/^```json\s*|```$/g, ""));
  } catch {
    return { model, findings: [], summary: text.slice(0, 800), raw: text };
  }
  const findings: JudgeFinding[] = (parsed.findings ?? []).map((f) => ({ at: "", seconds: typeof f.seconds === "number" ? f.seconds : undefined, severity: f.severity === "error" || f.severity === "warn" ? f.severity : "note", what: String(f.what ?? "") }));
  return { model, findings, summary: parsed.summary ?? "", raw: text };
};
