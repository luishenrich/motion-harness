/**
 * One look at a frame. A model that sees (Gemini) names the main subject,
 * says what kind of picture it is (a person, an interface, scenery) and
 * draws the box around the subject. The scaffold keeps that box inside
 * every crop and lets it cap the zoom; the script model reads the label to
 * know what a clip shows without watching it.
 */
import { readFileSync } from "node:fs";

export type LookCategory = "person" | "animal" | "interface" | "product" | "scenery" | "illustration" | "text" | "other";
export type Look = {
  label: string;
  category: LookCategory;
  /** x, y, width, height as fractions of the frame */
  box: [number, number, number, number];
  text?: string;
  model: string;
  ms: number;
};

const CATEGORIES: LookCategory[] = ["person", "animal", "interface", "product", "scenery", "illustration", "text", "other"];

export const lookAtFrame = async (png: string, opts: { model?: string; apiKey?: string } = {}): Promise<Look> => {
  const key = opts.apiKey ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set (mh look asks Gemini to look at a frame)");
  const model = opts.model ?? "gemini-2.5-flash";
  const prompt = `This is one frame of footage for a film. Answer with JSON only: {"label":"<the main subject in three to eight words>","category":"<one of person, animal, interface, product, scenery, illustration, text, other>","box_2d":[ymin,xmin,ymax,xmax],"text":"<readable on-screen text, at most 20 words, empty when none>"}. box_2d is the tight box around the main subject (the person, animal, product or interface the shot is about), integers from 0 to 1000 across the frame; the whole frame when everything in it is the subject. Category "interface" means software on a screen: an app, a website, a screen recording. No commentary.`;
  const body = { contents: [{ role: "user", parts: [{ inline_data: { mime_type: "image/png", data: readFileSync(png).toString("base64") } }, { text: prompt }] }], generationConfig: { temperature: 0, responseMimeType: "application/json" } };
  const t0 = performance.now();
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j = (await r.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  let parsed: { label?: string; category?: string; box_2d?: number[]; text?: string } = {};
  try {
    parsed = JSON.parse(text.replace(/^```json\s*|```$/g, ""));
  } catch {
    throw new Error(`Gemini did not return JSON: ${text.slice(0, 200)}`);
  }
  const b = Array.isArray(parsed.box_2d) && parsed.box_2d.length === 4 ? parsed.box_2d.map((n) => Math.min(1000, Math.max(0, Number(n) || 0)) / 1000) : [0, 0, 1, 1];
  const [ymin, xmin, ymax, xmax] = b;
  const box: [number, number, number, number] = [Math.min(xmin, xmax), Math.min(ymin, ymax), Math.max(0.02, Math.abs(xmax - xmin)), Math.max(0.02, Math.abs(ymax - ymin))];
  const category = CATEGORIES.includes(parsed.category as LookCategory) ? (parsed.category as LookCategory) : "other";
  return { label: String(parsed.label ?? "").trim() || "the frame", category, box: box.map((n) => Math.round(n * 1000) / 1000) as Look["box"], text: parsed.text ? String(parsed.text).trim() : undefined, model, ms: Math.round(performance.now() - t0) };
};
