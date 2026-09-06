/**
 * From a brief to a project, for any film: a product film from text and
 * plates, a cut from recorded footage, a slideshow from photos, a montage of
 * generated clips. A model writes the script (scenes with a kind, an asset,
 * a headline, seconds, and the design: palette and fonts); the scaffold turns
 * it into a project the harness can check on the spot. Nothing timed anywhere
 * else.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chatJson } from "../ai/azure.ts";
import { lumaAtTime, type Asset } from "../ingest/ingest.ts";

export type SceneKind = "text" | "clip" | "image";
export type ScriptScene = {
  id: string;
  seconds: number;
  /** what fills the frame: a text card, a video asset, a still image */
  kind: SceneKind;
  ground: "dark" | "light";
  headline: string;
  body?: string;
  /** clip and image scenes: the asset id from assets.json */
  asset?: string;
  /** clip scenes: seconds into the asset where the scene starts */
  in?: number;
  /** clip and image scenes: where the subject is, 0..1 from the left and the top, for a crop into another format */
  focus?: [number, number];
  /** clip and image scenes: "cover" fills the frame (default), "contain" letterboxes on the ground (a wide screen recording in a vertical film) */
  fit?: "cover" | "contain";
  /** clip and image scenes: extra scale, 1 = none; hides a source's own bars or tightens on the subject */
  zoom?: number;
  visual?: string;
  why?: string;
};
export type Design = { ink: string; paper: string; accent: string; muted?: string; fontDisplay?: string; fontBody?: string };
/** a sound asset placed under the film: a voice note, a music bed */
export type ScriptAudio = { asset: string; kind: "voice" | "music"; at: string; in?: number; gain?: number; loop?: boolean };
export type Script = { title: string; audience?: string; job?: string; fps?: number; design?: Design; scenes: ScriptScene[]; audio?: ScriptAudio[] };

export const DEFAULT_DESIGN: Required<Design> = { ink: "#151515", paper: "#FFFFFF", accent: "#2F6FDE", muted: "#6B6B6B", fontDisplay: "", fontBody: "" };

const SYSTEM = `You write scripts for short films that are rendered from React components: product and launch films, cuts from recorded footage, slideshows from photos, montages of generated clips, explainers. A script is a list of scenes plus a design.

Each scene has: id (short kebab-case, unique), seconds (1.5 to 10), kind ("text" for a typographic card, "clip" for a video asset, "image" for a still), ground ("dark" or "light" for text scenes; a clip or image scene takes the ground its own footage blends into), headline (the on-screen line, at most 8 words, plain human voice, no em dashes, no exclamation marks, no emojis; may be empty for a clip that speaks for itself), body (optional second line, at most 14 words), asset (the id of a listed asset, only for clip and image scenes), in (seconds into the asset where the scene starts, only for clips; pick the moment the transcript or the shot changes point to), focus ([x, y] between 0 and 1: the point to keep when the frame crops; the asset list names each clip's subject and its centre, so give a focus only to pick something else, and leave it out to keep the listed subject in frame), fit ("cover" fills the frame, "contain" letterboxes; use "contain" for screen recordings and interfaces whose edges matter, "cover" for people and scenery), zoom (1 to 1.5; more than 1 when a clip carries its own bars or the subject is small), visual (one sentence: what is on screen besides the words, only for text scenes that show something besides the words; empty for a plain text card), why (one sentence: what the scene does for the viewer).

Sound: "audio" is a list of sound assets placed under the film: {asset, kind ("voice" for a spoken recording, "music" for a bed), at (the id of the scene where it starts), in (seconds into the asset to start from, optional), gain (0 to 1, voice about 1, music under voice about 0.25), loop (music only)}. Place a recorded voice so its sentences land on the scenes that show what they say; do not put a music bed and a voice at the same gain.

The design has: ink (text colour hex), paper (light ground hex), accent (one accent hex), muted (secondary text hex), fontDisplay and fontBody (Google Fonts family names, or empty for the system sans). Derive the design from the brief's world and audience; if the brief names colours or fonts, use them exactly; do not default to warm cream with a serif, and do not default to Inter.

Open with the viewer's problem or the most characteristic thing, not with the product name. End with one call to action. Use listed assets where they carry the story; a clip scene's seconds must not exceed what the asset has from its "in" point. Total length matches the requested seconds within 10 percent. Answer with JSON only: {"title":"...","audience":"...","job":"...","design":{...},"scenes":[...],"audio":[...]}.`;

export const writeScript = async (brief: string, opts: { seconds?: number; model?: string; language?: string; assets?: Asset[]; assetsText?: string }): Promise<{ script: Script; provider: string; model: string; ms: number }> => {
  const seconds = opts.seconds ?? 30;
  const assetsBlock = opts.assetsText ? `\n\nAssets available (id, kind, length, shot changes, transcript excerpts):\n${opts.assetsText}` : "";
  const r = await chatJson<Script>(
    [
      { role: "system", content: SYSTEM },
      { role: "user", content: `Brief: ${brief}\n\nTarget length: ${seconds} seconds. Language of the on-screen lines: ${opts.language ?? "English"}.${assetsBlock}` },
    ],
    { model: opts.model, maxTokens: 4000 },
  );
  const s = r.data;
  if (!s || !Array.isArray(s.scenes) || !s.scenes.length) throw new Error("the model returned no scenes");
  return { script: normalizeScript(s, opts.assets), provider: r.provider, model: r.model, ms: r.ms };
};

const hex = (v: unknown, fallback: string) => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim().toUpperCase() : fallback);

/** ids unique and kebab-case, seconds clamped, kinds and grounds valid, assets that exist, design filled in */
export const normalizeScript = (s: Script, assets?: Asset[]): Script => {
  const seen = new Set<string>();
  const known = new Set((assets ?? []).map((a) => a.id));
  const scenes = s.scenes.map((sc, i) => {
    let id = String(sc.id ?? `scene-${i + 1}`).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || `scene-${i + 1}`;
    if (/^\d/.test(id)) id = `s${id}`;
    while (seen.has(id)) id = `${id}-${i + 1}`;
    seen.add(id);
    let kind: SceneKind = sc.kind === "clip" || sc.kind === "image" ? sc.kind : "text";
    let asset = sc.asset ? String(sc.asset) : undefined;
    if (asset && assets && !known.has(asset)) {
      const byFile = assets.find((a) => a.file.endsWith(asset!) || a.file.includes(asset!));
      asset = byFile?.id;
    }
    if (kind !== "text" && !asset) kind = "text";
    const a = asset ? assets?.find((k) => k.id === asset) : undefined;
    if (a && a.kind === "image") kind = "image";
    if (a && a.kind === "video") kind = "clip";
    let ground: "dark" | "light" = (sc.ground as string) === "light" || (sc.ground as string) === "cream" ? "light" : "dark";
    // footage sits on the ground its own edges blend into: a dark clip on ink, a bright one on paper
    if (a && kind !== "text") {
      const luma = lumaAtTime(a, Number(sc.in) || 0);
      if (luma !== null) ground = luma < 110 ? "dark" : "light";
    }
    let focus = Array.isArray(sc.focus) && sc.focus.length === 2 ? ([Math.min(1, Math.max(0, Number(sc.focus[0]) || 0.5)), Math.min(1, Math.max(0, Number(sc.focus[1]) || 0.5))] as [number, number]) : undefined;
    // the centre is no opinion: the measured subject frames the crop instead
    if (focus && focus[0] === 0.5 && focus[1] === 0.5) focus = undefined;
    let seconds = Math.max(1.5, Math.min(12, Number(sc.seconds) || 3));
    const inAt = kind === "clip" ? Math.max(0, Number(sc.in) || 0) : undefined;
    if (a?.seconds && kind === "clip" && inAt !== undefined && inAt + seconds > a.seconds) seconds = Math.max(1.5, Math.floor((a.seconds - inAt) * 10) / 10);
    const fit = sc.fit === "contain" ? "contain" : sc.fit === "cover" ? "cover" : undefined;
    const zoom = sc.zoom !== undefined && Number.isFinite(Number(sc.zoom)) ? Math.min(2, Math.max(1, Number(sc.zoom))) : undefined;
    return { id, seconds, kind, ground, headline: String(sc.headline ?? "").trim(), body: sc.body ? String(sc.body).trim() : undefined, asset, in: inAt, focus, fit, zoom, visual: sc.visual ? String(sc.visual).trim() : undefined, why: sc.why ? String(sc.why).trim() : undefined } as ScriptScene;
  });
  const sceneIds = new Set(scenes.map((x) => x.id));
  const audio: ScriptAudio[] = (Array.isArray(s.audio) ? s.audio : [])
    .map((x): ScriptAudio | null => {
      let asset = x.asset ? String(x.asset) : "";
      if (asset && assets && !known.has(asset)) asset = assets.find((a) => a.file.endsWith(asset) || a.file.includes(asset))?.id ?? "";
      const a = asset ? assets?.find((k) => k.id === asset) : undefined;
      if (assets && (!a || (a.kind !== "audio" && !(a.kind === "video" && a.hasAudio)))) return null;
      let at = String(x.at ?? scenes[0]?.id ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      if (!sceneIds.has(at)) at = scenes[0]?.id ?? at;
      const kind: "voice" | "music" = x.kind === "music" ? "music" : "voice";
      return { asset, kind, at, in: x.in !== undefined ? Math.max(0, Number(x.in) || 0) : undefined, gain: x.gain !== undefined ? Math.min(1, Math.max(0, Number(x.gain) || 0)) : kind === "music" ? 0.25 : 1, loop: kind === "music" ? !!x.loop : false };
    })
    .filter((x): x is ScriptAudio => x !== null && !!x.asset);
  const d = s.design ?? ({} as Design);
  const design: Required<Design> = { ink: hex(d.ink, DEFAULT_DESIGN.ink), paper: hex(d.paper, DEFAULT_DESIGN.paper), accent: hex(d.accent, DEFAULT_DESIGN.accent), muted: hex(d.muted, DEFAULT_DESIGN.muted), fontDisplay: typeof d.fontDisplay === "string" ? d.fontDisplay.trim() : "", fontBody: typeof d.fontBody === "string" ? d.fontBody.trim() : "" };
  return { title: s.title ?? "Untitled", audience: s.audience, job: s.job, fps: s.fps ?? 30, design, scenes, audio };
};

export const scriptMarkdown = (s: Script): string => {
  const total = s.scenes.reduce((a, b) => a + b.seconds, 0);
  const L = [`# ${s.title}`, ""];
  if (s.audience) L.push(`Audience: ${s.audience}`);
  if (s.job) L.push(`Job: ${s.job}`);
  if (s.design) L.push(`Design: ink ${s.design.ink}, paper ${s.design.paper}, accent ${s.design.accent}${s.design.muted ? `, muted ${s.design.muted}` : ""}${s.design.fontDisplay ? `, display ${s.design.fontDisplay}` : ""}${s.design.fontBody ? `, body ${s.design.fontBody}` : ""}`);
  L.push(`Length: ${total.toFixed(1)} s, ${s.scenes.length} scenes`, "");
  for (const a of s.audio ?? []) L.push(`Audio: ${a.asset} ${a.kind} at ${a.at}${a.in !== undefined ? ` @ ${a.in}s` : ""} gain ${a.gain ?? 1}${a.loop ? " loop" : ""}`);
  if (s.audio?.length) L.push("");
  s.scenes.forEach((sc, i) => {
    L.push(`## ${i + 1}. ${sc.id} (${sc.seconds}s, ${sc.kind}, ${sc.ground})`, "");
    if (sc.headline) L.push(sc.headline);
    if (sc.body) L.push(sc.body);
    if (sc.asset) L.push("", `Asset: ${sc.asset}${sc.in !== undefined ? ` @ ${sc.in}s` : ""}${sc.focus ? ` focus ${sc.focus[0]},${sc.focus[1]}` : ""}${sc.fit ? ` fit ${sc.fit}` : ""}${sc.zoom ? ` zoom ${sc.zoom}` : ""}`);
    if (sc.visual) L.push(sc.asset ? `Visual: ${sc.visual}` : "", ...(sc.asset ? [] : [`Visual: ${sc.visual}`]));
    if (sc.why) L.push(`Why: ${sc.why}`);
    L.push("");
  });
  return L.join("\n").replace(/\n{3,}/g, "\n\n");
};

/** the inverse: a script.md written or edited by hand back into data */
export const parseScriptMarkdown = (md: string, assets?: Asset[]): Script => {
  const lines = md.split("\n");
  const title = (lines.find((l) => l.startsWith("# ")) ?? "# Untitled").slice(2).trim();
  const designLine = lines.find((l) => l.startsWith("Design:"));
  const design: Design | undefined = designLine
    ? {
        ink: designLine.match(/ink (#[0-9a-fA-F]{6})/)?.[1] ?? DEFAULT_DESIGN.ink,
        paper: designLine.match(/paper (#[0-9a-fA-F]{6})/)?.[1] ?? DEFAULT_DESIGN.paper,
        accent: designLine.match(/accent (#[0-9a-fA-F]{6})/)?.[1] ?? DEFAULT_DESIGN.accent,
        muted: designLine.match(/muted (#[0-9a-fA-F]{6})/)?.[1],
        fontDisplay: designLine.match(/display ([^,]+)/)?.[1]?.trim(),
        fontBody: designLine.match(/body ([^,]+)$/)?.[1]?.trim(),
      }
    : undefined;
  const audio: ScriptAudio[] = [];
  for (const l of lines) {
    const m = l.match(/^Audio:\s*([\w.-]+)\s+(voice|music)\s+at\s+([\w-]+)(?:\s*@\s*([\d.]+)s)?(?:\s+gain\s+([\d.]+))?(\s+loop)?/);
    if (m) audio.push({ asset: m[1], kind: m[2] as "voice" | "music", at: m[3], in: m[4] ? parseFloat(m[4]) : undefined, gain: m[5] ? parseFloat(m[5]) : undefined, loop: !!m[6] });
  }
  const scenes: ScriptScene[] = [];
  let cur: ScriptScene | null = null;
  let textLines: string[] = [];
  const flush = () => {
    if (!cur) return;
    const t = textLines.map((x) => x.trim()).filter(Boolean);
    cur.headline = t[0] ?? cur.headline ?? "";
    if (t[1]) cur.body = t[1];
    scenes.push(cur);
    cur = null;
    textLines = [];
  };
  for (const raw of lines) {
    const h = raw.match(/^## \d+\.\s*([\w-]+)\s*\((\d+(?:\.\d+)?)s(?:,\s*(text|clip|image))?,\s*(dark|light|cream)\)/);
    if (h) {
      flush();
      cur = { id: h[1], seconds: parseFloat(h[2]), kind: (h[3] as SceneKind) ?? "text", ground: h[4] === "dark" ? "dark" : "light", headline: "" };
      continue;
    }
    if (!cur) continue;
    if (raw.startsWith("Asset:")) {
      const m = raw.slice(6).trim().match(/^([\w.-]+)(?:\s*@\s*([\d.]+)s)?(?:\s*focus\s*([\d.]+),([\d.]+))?(?:\s*fit\s*(cover|contain))?(?:\s*zoom\s*([\d.]+))?/);
      if (m) {
        cur.asset = m[1];
        if (m[2]) cur.in = parseFloat(m[2]);
        if (m[3] && m[4]) cur.focus = [parseFloat(m[3]), parseFloat(m[4])];
        if (m[5]) cur.fit = m[5] as "cover" | "contain";
        if (m[6]) cur.zoom = parseFloat(m[6]);
      }
    } else if (raw.startsWith("Visual:")) cur.visual = raw.slice(7).trim();
    else if (raw.startsWith("Why:")) cur.why = raw.slice(4).trim();
    else if (raw.trim()) textLines.push(raw);
  }
  flush();
  return normalizeScript({ title, design, scenes, audio }, assets);
};

/* ---------- scaffold ---------- */

const ts = (s: string) => JSON.stringify(s);

const fontImport = (d: Required<Design>) => {
  const fams = [d.fontDisplay, d.fontBody].filter(Boolean).map((f) => `family=${encodeURIComponent(f).replace(/%20/g, "+")}:wght@400;500;600;700`);
  return fams.length ? `https://fonts.googleapis.com/css2?${[...new Set(fams)].join("&")}&display=swap` : "";
};

export const scaffoldFiles = (script: Script, opts: { harnessImport: string; formats: string[]; fps?: number; assets?: Asset[] }): Record<string, string> => {
  const fps = opts.fps ?? script.fps ?? 30;
  const formats = opts.formats.length ? opts.formats : ["wide"];
  const sizes: Record<string, { width: number; height: number }> = { wide: { width: 1920, height: 1080 }, vertical: { width: 1080, height: 1920 }, square: { width: 1080, height: 1080 } };
  const film = script.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "film";
  const d = { ...DEFAULT_DESIGN, ...(script.design ?? {}) } as Required<Design>;
  const assets = (opts.assets ?? []).filter((a) => script.scenes.some((s) => s.asset === a.id) || (script.audio ?? []).some((x) => x.asset === a.id));
  const cueLines = (script.audio ?? [])
    .map((x) => {
      const a = assets.find((k) => k.id === x.asset);
      if (!a) return null;
      const file = a.file.startsWith("public/") ? a.file : `public/${a.file}`;
      return `    { id: ${ts(x.asset)}, kind: ${ts(x.kind)}, file: ${ts(file)}, at: ${ts(x.at)}, gain: ${x.gain ?? 1}${x.in ? `, trim: [${x.in}, ${a.seconds ?? 600}]` : ""}${x.loop ? ", loop: true" : ""}${x.kind === "music" ? ", fadeOut: 1.5" : ""} },`;
    })
    .filter(Boolean)
    .join("\n");
  const edges = (a: Asset) => a.darkEdges ?? { left: 0, right: 0, top: 0, bottom: 0 };
  const subject = (a: Asset) => (a.subject ? `{ label: ${ts(a.subject.label)}, category: ${ts(a.subject.category)}, box: [${a.subject.box.join(", ")}] }` : "null");
  const assetLines = assets.map((a) => `  ${ts(a.id)}: { file: ${ts(a.file.replace(/^public\//, ""))}, kind: ${ts(a.kind)}, seconds: ${a.seconds ?? 0}, width: ${a.width ?? 0}, height: ${a.height ?? 0}, darkEdges: { left: ${edges(a).left}, right: ${edges(a).right}, top: ${edges(a).top}, bottom: ${edges(a).bottom} }, subject: ${subject(a)} },`).join("\n");
  const sceneLines = script.scenes.map((sc) => `  ${ts(sc.id)}: { dur: ${Math.round(sc.seconds * fps)}, kind: ${ts(sc.kind)}, ground: ${ts(sc.ground)}, headline: ${ts(sc.headline)}, body: ${ts(sc.body ?? "")}, asset: ${ts(sc.asset ?? "")}, inAt: ${sc.in ?? 0}, focus: ${sc.focus ? `[${sc.focus.join(", ")}]` : "null"}, fit: ${ts(sc.fit ?? "auto")}, zoom: ${sc.zoom ?? 0}, visual: ${ts(sc.visual ?? "")}, why: ${ts(sc.why ?? "")} },`).join("\n");
  const timeline = `/**
 * ${script.title}: the timeline as data. Generated by mh new from the brief; edit here, never in the components.
 */
import { defineTimeline } from ${ts(opts.harnessImport + "/timeline/schema.ts")};

export const FPS = ${fps};

/** the design the script chose: change here, every scene follows */
export const DESIGN = { ink: ${ts(d.ink)}, paper: ${ts(d.paper)}, accent: ${ts(d.accent)}, muted: ${ts(d.muted)}, fontDisplay: ${ts(d.fontDisplay)}, fontBody: ${ts(d.fontBody)} };

/** darkEdges: the source's own bars in its pixels (mh ingest); subject: what a model saw in the mid frame, box as x, y, w, h fractions (mh ingest --look) */
export type AssetSpec = { file: string; kind: "video" | "audio" | "image"; seconds: number; width: number; height: number; darkEdges: { left: number; right: number; top: number; bottom: number }; subject: { label: string; category: string; box: [number, number, number, number] } | null };
export const ASSETS: Record<string, AssetSpec> = {
${assetLines}
};

/** focus: the script's own point of interest (null lets the measured subject frame the crop); fit auto: cover, contain for an interface in a frame of the other orientation */
export type SceneSpec = { dur: number; kind: "text" | "clip" | "image"; ground: "dark" | "light"; headline: string; body: string; asset: string; inAt: number; focus: [number, number] | null; fit: "cover" | "contain" | "auto"; zoom: number; visual: string; why: string };

export const SCENES: Record<string, SceneSpec> = {
${sceneLines}
};

export type SceneId = keyof typeof SCENES;

export const FADE = { type: "fade", dur: 8 } as const;

export const timeline = defineTimeline({
  fps: FPS,
  parts: [
    {
      id: "film",
      composition: { ${formats.map((f) => `${f}: ${ts(`${film}-${f}`)}`).join(", ")} },
      enterFrames: 10,
      audio: false,
      source: "src/Film.tsx",
      scenes: (Object.keys(SCENES) as SceneId[]).map((id, i) => ({
        id,
        dur: SCENES[id].dur,
        enter: i === 0 ? "cut" : "fade",
        exit: FADE,
        ground: SCENES[id].ground,
        stage: SCENES[id].kind,
        text: SCENES[id].headline ? (SCENES[id].body ? [SCENES[id].headline, SCENES[id].body] : SCENES[id].headline) : undefined,
        caption: SCENES[id].headline ? undefined : SCENES[id].visual || undefined,
        probes: SCENES[id].headline ? ["headline"] : [],
        clip: SCENES[id].kind === "clip" ? SCENES[id].asset : undefined,
        why: SCENES[id].why || undefined,
      })),
    },
  ],
  audio: [
${cueLines}
  ],
  rules: { minSceneDur: 24, maxEnterFrames: 14, safeZone: { vertical: { top: 220, bottom: 320, x: 60 } } },
});
`;
  const fonts = fontImport(d);
  const filmTsx = `/**
 * ${script.title}. One component per scene kind (text card, clip, image), all
 * reading the timeline. Replace a text scene's dashed visual with the real
 * thing; the timeline's "visual" note says what belongs there.
 */
import React from "react";
import { AbsoluteFill, Easing, Img, OffthreadVideo, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { compile } from ${ts(opts.harnessImport + "/timeline/schema.ts")};
import { timeline, SCENES, ASSETS, DESIGN, FADE, FPS, type SceneId, type SceneSpec, type AssetSpec } from "./timeline.ts";

const c = compile(timeline);

/** set true while blocking: every text scene then shows its visual note in a dashed box, so a missing picture is visible on the sheet; false renders the film as delivered */
export const SHOW_VISUAL_NOTES = false;

const DISPLAY = DESIGN.fontDisplay ? \`'\${DESIGN.fontDisplay}', -apple-system, 'Helvetica Neue', Helvetica, Arial, sans-serif\` : "-apple-system, 'Helvetica Neue', Helvetica, Arial, sans-serif";
const BODY = DESIGN.fontBody ? \`'\${DESIGN.fontBody}', -apple-system, 'Helvetica Neue', Helvetica, Arial, sans-serif\` : DISPLAY;
const FONTS_URL = ${ts(fonts)};

const rise = (frame: number, at: number, dur = 14) => {
  const p = interpolate(frame, [at, at + dur], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  return { opacity: p, transform: \`translateY(\${(1 - p) * 18}px)\` };
};

/** in through the timeline's enter (none on a cut), out through the declared exit fade */
const Fade: React.FC<{ dur: number; enterDur: number; children: React.ReactNode }> = ({ dur, enterDur, children }) => {
  const f = useCurrentFrame();
  const o = interpolate(f, [0, Math.max(1, enterDur), Math.max(enterDur + 1, dur - FADE.dur), dur - 1], [enterDur > 0 ? 0 : 1, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return <AbsoluteFill style={{ opacity: o }}>{children}</AbsoluteFill>;
};

/** the ground a scene sits on: the film's ink or paper */
const groundOf = (s: SceneSpec) => (s.ground === "light" ? DESIGN.paper : DESIGN.ink);

/**
 * how a picture sits in the frame: cover by default, contain when an interface would lose its edges in a
 * frame of the other orientation; a source's own bars are zoomed out; the measured subject stays inside
 * the crop and caps the zoom; the point that stays put is the script's focus, else the subject's centre
 */
const mediaFit = (s: SceneSpec, a: AssetSpec | undefined, width: number, height: number) => {
  const targetAspect = width / height;
  const aw = a && a.width ? a.width : width;
  const ah = a && a.height ? a.height : height;
  const assetAspect = aw / ah;
  const box = a && a.subject ? a.subject.box : null;
  const screen = !a || !a.subject || a.subject.category === "interface" || a.subject.category === "text";
  const crossways = (targetAspect < 1 && assetAspect > 1.4) || (targetAspect > 1 && assetAspect < 0.8);
  const fit: "cover" | "contain" = s.fit === "auto" || !s.fit ? (crossways && screen ? "contain" : "cover") : s.fit;
  if (fit === "contain") return { fit, zoom: 1, cap: 1, pos: [0.5, 0.5] as [number, number] };
  // the fraction of the picture visible on each axis once it covers the frame
  const cover = Math.max(width / aw, height / ah);
  const vis: [number, number] = [Math.min(1, width / (cover * aw)), Math.min(1, height / (cover * ah))];
  const scaledByWidth = assetAspect <= targetAspect;
  const hFrac = a ? (a.darkEdges.left + a.darkEdges.right) / aw : 0;
  const vFrac = a ? (a.darkEdges.top + a.darkEdges.bottom) / ah : 0;
  const edgeZoom = Math.min(1.3, 1 + (scaledByWidth ? hFrac : vFrac) * 1.1);
  // the subject may not leave the frame: the visible span stays a tenth wider than its box on both axes
  const cap = box ? Math.max(1, Math.min(vis[0] / Math.max(0.05, box[2] * 1.1), vis[1] / Math.max(0.05, box[3] * 1.1))) : 1.5;
  const zoom = Math.min(cap, Math.max(s.zoom || 1, edgeZoom));
  // objectPosition and transformOrigin share one point p: the picture's p sits at the frame's p, so p = (c - v/2) / (1 - v) centres c in a visible span v
  const centred = (c: number, v: number) => (v >= 1 ? 0.5 : Math.min(1, Math.max(0, (c - v / 2) / (1 - v))));
  // a subject taller than the visible span keeps its top (heads sit there) with a little headroom; a wider one is centred
  const vy = vis[1] / zoom;
  const cy = box ? (box[3] > vy ? Math.max(0, box[1] - 0.03) + vy / 2 : box[1] + box[3] / 2) : 0.5;
  const pos: [number, number] = s.focus ? s.focus : box ? [centred(box[0] + box[2] / 2, vis[0] / zoom), centred(cy, vy)] : [0.5, 0.5];
  return { fit, zoom, cap, pos };
};

const Lines: React.FC<{ id: SceneId; story: boolean; onMedia?: boolean }> = ({ id, story, onMedia }) => {
  const f = useCurrentFrame();
  const s = SCENES[id];
  const dark = onMedia || s.ground === "dark";
  const color = dark ? DESIGN.paper : DESIGN.ink;
  const muted = dark ? "rgba(255,255,255,0.78)" : DESIGN.muted;
  if (!s.headline) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: onMedia ? "flex-start" : "center", textAlign: onMedia ? "left" : "center", gap: 20, maxWidth: story ? 860 : onMedia ? 1100 : 1500 }}>
      <div data-probe="headline" data-lines={story ? 3 : 2} style={{ ...rise(f, 4), fontFamily: DISPLAY, fontSize: story ? 60 : onMedia ? 64 : 72, lineHeight: 1.15, letterSpacing: -1, color, textShadow: onMedia ? "0 2px 24px rgba(0,0,0,0.45)" : undefined }}>
        {s.headline}
      </div>
      {s.body ? (
        <div data-probe="body" data-lines={story ? 3 : 2} style={{ ...rise(f, 16), fontFamily: BODY, fontSize: story ? 34 : 36, lineHeight: 1.35, color: muted, textShadow: onMedia ? "0 2px 18px rgba(0,0,0,0.5)" : undefined }}>
          {s.body}
        </div>
      ) : null}
    </div>
  );
};

const TextScene: React.FC<{ id: SceneId; story: boolean }> = ({ id, story }) => {
  const f = useCurrentFrame();
  const s = SCENES[id];
  const dark = s.ground === "dark";
  return (
    <AbsoluteFill style={{ backgroundColor: groundOf(s), justifyContent: "center", alignItems: "center", padding: story ? "0 110px" : "0 200px", boxSizing: "border-box", gap: 40 }}>
      {s.visual && SHOW_VISUAL_NOTES ? (
        <div data-probe="visual" data-lines={4} data-lint="no-collision" style={{ ...rise(f, 2), width: story ? 760 : 900, height: story ? 400 : 380, borderRadius: 18, border: \`2px dashed \${dark ? "rgba(255,255,255,0.3)" : "rgba(0,0,0,0.25)"}\`, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 32, fontFamily: BODY, fontSize: 26, lineHeight: 1.3, color: dark ? "rgba(255,255,255,0.7)" : DESIGN.muted }}>
          {s.visual}
        </div>
      ) : null}
      <Lines id={id} story={story} />
    </AbsoluteFill>
  );
};

/** a video asset filling the frame, the subject kept in view through the focus point; a slow push keeps a static shot alive */
const ClipScene: React.FC<{ id: SceneId; story: boolean }> = ({ id, story }) => {
  const f = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const s = SCENES[id];
  const a = ASSETS[s.asset];
  const m = mediaFit(s, a, width, height);
  const push = Math.min(m.cap, m.zoom * (1 + Math.min(0.06, f / (s.dur * 12))));
  const at = m.pos[0] * 100 + "% " + m.pos[1] * 100 + "%";
  return (
    <AbsoluteFill style={{ backgroundColor: groundOf(s) }}>
      {a ? (
        <OffthreadVideo src={staticFile(a.file)} muted startFrom={Math.round(s.inAt * FPS)} style={{ position: "absolute", inset: 0, width, height, objectFit: m.fit, objectPosition: at, transform: "scale(" + push + ")", transformOrigin: at }} />
      ) : null}
      {s.headline ? <AbsoluteFill style={{ background: "linear-gradient(to top, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.0) 55%)" }} /> : null}
      <AbsoluteFill style={{ justifyContent: "flex-end", padding: story ? "0 90px 360px" : "0 140px 110px", boxSizing: "border-box" }}>
        <Lines id={id} story={story} onMedia />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/** a still with a slow scale, the subject kept in view */
const ImageScene: React.FC<{ id: SceneId; story: boolean }> = ({ id, story }) => {
  const f = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const s = SCENES[id];
  const a = ASSETS[s.asset];
  const m = mediaFit(s, a, width, height);
  const zoom = Math.min(m.cap, m.zoom * interpolate(f, [0, s.dur], [1.0, 1.08], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  const at = m.pos[0] * 100 + "% " + m.pos[1] * 100 + "%";
  return (
    <AbsoluteFill style={{ backgroundColor: groundOf(s) }}>
      {a ? <Img src={staticFile(a.file)} style={{ position: "absolute", inset: 0, width, height, objectFit: m.fit, objectPosition: at, transform: "scale(" + zoom + ")", transformOrigin: at }} /> : null}
      {s.headline ? <AbsoluteFill style={{ background: "linear-gradient(to top, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.0) 55%)" }} /> : null}
      <AbsoluteFill style={{ justifyContent: "flex-end", padding: story ? "0 90px 360px" : "0 140px 110px", boxSizing: "border-box" }}>
        <Lines id={id} story={story} onMedia />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const Film: React.FC<{ story?: boolean }> = ({ story = false }) => {
  const { width } = useVideoConfig();
  const s = story || width < 1200;
  return (
    <AbsoluteFill style={{ backgroundColor: DESIGN.ink }}>
      {FONTS_URL ? <style>{\`@import url("\${FONTS_URL}");\`}</style> : null}
      {c.scenes.map((sc) => {
        const kind = SCENES[sc.id as SceneId].kind;
        const C = kind === "clip" ? ClipScene : kind === "image" ? ImageScene : TextScene;
        return (
          <Sequence key={sc.id} from={sc.start} durationInFrames={sc.dur}>
            {/* the ground stays while the content fades: no dip through the film's ink between two scenes */}
            <AbsoluteFill style={{ backgroundColor: groundOf(SCENES[sc.id as SceneId]) }} />
            <Fade dur={sc.dur} enterDur={sc.enter.dur ?? 0}>
              <C id={sc.id as SceneId} story={s} />
            </Fade>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

export const FILM_DURATION = c.dur;
`;
  const root = `import React from "react";
import { Composition } from "remotion";
import { Film, FILM_DURATION } from "./Film.tsx";
import { FPS } from "./timeline.ts";

export const Root: React.FC = () => (
  <>
${formats.map((f) => `    <Composition id=${ts(`${film}-${f}`)} component={Film} width={${sizes[f]?.width ?? 1920}} height={${sizes[f]?.height ?? 1080}} fps={FPS} durationInFrames={FILM_DURATION} defaultProps={{ story: ${f === "vertical"} }} />`).join("\n")}
  </>
);
`;
  const config = `/** generated by mh new; the native engine needs no Remotion install */
import { defineConfig } from ${ts(opts.harnessImport + "/config.ts")};
import { timeline, DESIGN } from "./src/timeline.ts";

export default defineConfig({
  root: "./src/Root.tsx",
  rootExport: "Root",
  publicDir: "public",
  cacheDir: ".harness",
  engine: "native",
  films: {
    ${ts(film)}: {
      timeline,
      formats: { ${formats.map((f) => `${f}: { width: ${sizes[f]?.width ?? 1920}, height: ${sizes[f]?.height ?? 1080} }`).join(", ")} },
      defaultFormat: ${ts(formats[0])},
    },
  },
  tokens: { colors: [DESIGN.ink, DESIGN.paper, DESIGN.accent, DESIGN.muted, "#FFFFFF", "#000000"], sources: ["src/**/*.tsx"] },
  captions: { bottom: { wide: 70, vertical: 340 } },
});
`;
  const shimPath = `${opts.harnessImport}/engine/shim/remotion.tsx`;
  const tsconfig = `{
  "compilerOptions": { "target": "ES2022", "module": "ESNext", "moduleResolution": "bundler", "jsx": "react-jsx", "strict": true, "skipLibCheck": true, "allowImportingTsExtensions": true, "noEmit": true, "types": ["bun"], "baseUrl": ".", "paths": { "remotion": [${ts(shimPath)}] } },
  "include": ["src", "harness.config.ts"]
}
`;
  const pkg = `{
  "name": ${ts(film)},
  "private": true,
  "type": "module",
  "scripts": { "check": "mh check --format all", "render": "mh render --format all" },
  "dependencies": { "react": "^19.1.0", "react-dom": "^19.1.0" },
  "devDependencies": { "@types/bun": "^1.2.0", "@types/react": "^19.0.0", "@types/react-dom": "^19.0.0", "typescript": "^5.9.0" }
}
`;
  const gitignore = `node_modules/\n.harness/\nout/\n`;
  return { "src/timeline.ts": timeline, "src/Film.tsx": filmTsx, "src/Root.tsx": root, "harness.config.ts": config, "tsconfig.json": tsconfig, "package.json": pkg, ".gitignore": gitignore, "script.md": scriptMarkdown(script), "public/.gitkeep": "" };
};

export const writeScaffold = (dir: string, files: Record<string, string>, opts: { force?: boolean } = {}): string[] => {
  const written: string[] = [];
  for (const [rel, content] of Object.entries(files)) {
    const p = join(dir, rel);
    if (existsSync(p) && !opts.force) throw new Error(`${p} exists (pass --force to overwrite)`);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, content);
    written.push(p);
  }
  return written;
};
