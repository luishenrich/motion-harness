/**
 * A brief becomes a motion graphics film: a model writes film.mograph.json
 * against a compact description of the schema, the result is normalised
 * (ids, clamps, colours, fonts), linted, and the model gets one round to fix
 * what the lint found. The scaffold then writes a project the harness checks.
 */
import { chatJson } from "../ai/azure.ts";
import type { Design, Layer, MgFilm, MgScene } from "./schema.ts";
import { designColors } from "./schema.ts";
import { lintFilm, type MgFinding } from "./edit.ts";

export const MG_SYSTEM = `You write motion graphics films as data for a renderer. Pure motion graphics: typography, shapes, counters, lists, bar charts, rings, a logo image at most. No footage, no stock, no faces. Answer with one JSON object and nothing else.

Film: { "title", "fps": 30, "design", "formats", "easings"?, "defaults"?, "scenes": [...], "audio": [] }.
design: { "ink": hex (the dark), "paper": hex (the light), "accent": hex, "muted": hex, "colors": { name: hex } (0 to 3 more), "fontDisplay": a Google Fonts family, "fontBody": a Google Fonts family, "fontMono"?: a Google Fonts family }. Pick a palette and fonts that fit the brief and the audience; never default to cream with a serif and terracotta, never Inter or Space Grotesk as the display face; give the ink a hue, not pure black.
formats: { "wide": { "width": 1920, "height": 1080 }, "vertical": { "width": 1080, "height": 1920 } }.
defaults: { "enterFrames": 0, "layerIn": { "preset": "rise", "dur": 14, "ease": "out" } }.

Scene: { "id": kebab-case, "dur": frames (45 to 180; the film adds up to the target length), "ground": "ink" | "paper" | "accent" | a colors name, "exit": { "type": "fade", "dur": 8 } on every scene but the last, "why": one sentence, "layers": [...] }.
Alternate grounds so the film breathes; two or three layers per scene, four at most; one idea per scene.

Layer (every kind): { "id": kebab-case unique in the scene, "type", "at": { "x": 0..1, "y": 0..1 } (fractions of the frame; y 0.45 is the eye line), "anchor"?: "center" (default) | "left" | "right" | "top" | "bottom", "in": { "preset", "at": local frame, "dur": frames, "ease"?, "stagger"?: { "by": "word" | "char" | "line" | "item", "each": frames } }, "out"?: { "preset", "at": negative frames from the scene end, "dur" }, "formats"?: { "vertical": { any fields that must differ in 9:16, usually "size", "at", "maxWidth", "w" } }, "why"?: one sentence }.
Kinds:
- "text": { "text": the line (\\n breaks lines, *word* renders in the accent colour), "size": u px (headline 88 to 120, body 36 to 52, small label 28 to 34), "weight": 400..800, "color": "paper" on ink, "ink" on paper, "role": "display" | "body" | "mono", "maxWidth": 0.6 to 0.85 (fraction of the frame width), "align"?, "uppercase"?, "letterSpacing"?: em }.
- "shape": { "shape": "rect" | "circle" | "line" | "ring", "w", "h", "d", "thickness", "radius", "fill", "stroke"?, "progress"? }.
- "counter": { "from": 0, "to": number, "format": "0" | "0,0" | "0.0" | "0%", "prefix"?, "suffix"?, "dur": frames the count takes, "size": 160 to 260, "color" }.
- "bars": { "values": [{ "label", "value", "color"? }], "max"?, "direction": "horizontal" | "vertical", "w", "thickness", "gap", "color", "labelSize", "format"? }.
- "list": { "items": [3 to 5 short lines], "marker": "dot" | "number" | "check" | "dash", "size": 44 to 60, "color", "markerColor", "maxWidth" }.
- "image": only when the brief names a file under public/: { "src", "w" }.
Units: sizes are pixels at a 1080 px short side and scale with the format. Times are local frames at 30 fps.
In presets: cut, fade, rise, drop, pop, slide (with "from": left|right|top|bottom), wipe (with "from"), grow (lines, rects, bars), blur, typewriter (mono text), mask (text with a line or word stagger). Out presets: fade, sink, lift, shrink, slide, wipe, blur. Easings: linear, in, out, inOut, expo, quart, back, anticipate, smooth, spring, soft, bouncy, snappy, or "cubic-bezier(x1,y1,x2,y2)".
Timing rules: the first layer of a scene arrives at frame 0 to 6, the next 8 to 16 frames later; a headline of n words needs 1.2 s plus 0.25 s per word over four on screen after its last word has arrived; nothing arrives in the scene's last 20 frames; an "out" only when the layer should leave before the scene ends. Staggers: a headline by word (each 2 to 4), a list by item (each 6 to 10), bars by item (each 5 to 8).
Copy rules: plain human voice, short lines, at most 8 words per line, no exclamation marks, no emojis, no em dashes, one accent word per headline at most (*like this*), numbers as counters when a number is the point.
Composition: text at x 0.5 centred unless the scene is a left-aligned list (then anchor "left", x 0.12); keep a headline and its support line 0.12 to 0.16 apart in y; in vertical move blocks toward y 0.45 and shrink sizes by a tenth through "formats".`;

const hex = (v: unknown, fallback: string) => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim().toUpperCase() : fallback);
const kebab = (v: unknown, fallback: string) => (String(v ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || fallback);
const clamp = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

/** ids kebab and unique, numbers clamped, design filled, formats present, unknown layers dropped */
export const normalizeFilm = (raw: Partial<MgFilm>, opts: { fps?: number; formats?: string[] } = {}): MgFilm => {
  const fps = opts.fps ?? (typeof raw.fps === "number" ? raw.fps : 30);
  const d = (raw.design ?? {}) as Partial<Design>;
  const design: Design = {
    ink: hex(d.ink, "#14161C"),
    paper: hex(d.paper, "#F4F1EA"),
    accent: hex(d.accent, "#F2B441"),
    muted: hex(d.muted, "#6A707A"),
    colors: Object.fromEntries(Object.entries(d.colors ?? {}).filter(([k, v]) => /^[a-z][a-z0-9-]*$/.test(k) && /^#[0-9a-f]{6}$/i.test(String(v))).map(([k, v]) => [k, String(v).toUpperCase()])),
    fontDisplay: typeof d.fontDisplay === "string" && d.fontDisplay.trim() ? d.fontDisplay.trim() : undefined,
    fontBody: typeof d.fontBody === "string" && d.fontBody.trim() ? d.fontBody.trim() : undefined,
    fontMono: typeof d.fontMono === "string" && d.fontMono.trim() ? d.fontMono.trim() : undefined,
  };
  const wanted = opts.formats ?? ["wide", "vertical"];
  const sizes: Record<string, { width: number; height: number }> = { wide: { width: 1920, height: 1080 }, vertical: { width: 1080, height: 1920 }, square: { width: 1080, height: 1080 } };
  const formats = Object.fromEntries(wanted.map((f) => [f, raw.formats?.[f] ?? sizes[f] ?? sizes.wide]));
  const seenScene = new Set<string>();
  const scenes: MgScene[] = (Array.isArray(raw.scenes) ? raw.scenes : []).map((s, i) => {
    let id = kebab(s.id, `scene-${i + 1}`);
    while (seenScene.has(id)) id = `${id}-2`;
    seenScene.add(id);
    const seen = new Set<string>();
    const layers: Layer[] = (Array.isArray(s.layers) ? s.layers : [])
      .filter((l) => l && typeof l === "object" && ["text", "shape", "image", "counter", "bars", "list"].includes((l as Layer).type))
      .map((l, j) => {
        const L = { ...(l as Layer) } as Layer & Record<string, unknown>;
        let lid = kebab(L.id, `${L.type}-${j + 1}`);
        while (seen.has(lid)) lid = `${lid}-2`;
        seen.add(lid);
        L.id = lid;
        if (L.at) L.at = { x: clamp(L.at.x, 0, 1, 0.5), y: clamp(L.at.y, 0, 1, 0.5) };
        if (L.in) {
          L.in = { ...L.in, at: L.in.at === undefined ? undefined : clamp(L.in.at, -600, 600, 0), dur: L.in.dur === undefined ? undefined : clamp(L.in.dur, 0, 90, 14) };
          if (L.in.stagger) L.in.stagger = { by: (["word", "char", "line", "item"] as const).includes(L.in.stagger.by) ? L.in.stagger.by : "word", each: clamp(L.in.stagger.each, 1, 30, 3), from: L.in.stagger.from };
        }
        if (L.out) L.out = { ...L.out, dur: L.out.dur === undefined ? undefined : clamp(L.out.dur, 0, 60, 8) };
        if (L.type === "text") {
          L.text = String(L.text ?? "").replace(/[—–]/g, ",").replace(/!/g, ".").trim();
          if (L.size !== undefined) L.size = clamp(L.size, 12, 320, 72);
          if (L.maxWidth !== undefined) L.maxWidth = clamp(L.maxWidth, 0.2, 1, 0.8);
        }
        if (L.type === "list") {
          L.items = (Array.isArray(L.items) ? L.items : []).map((x) => String(x).replace(/[—–]/g, ",").trim()).filter(Boolean).slice(0, 7);
          if (L.size !== undefined) L.size = clamp(L.size, 12, 160, 48);
        }
        if (L.type === "counter") {
          L.to = clamp(L.to, -1e12, 1e12, 100);
          if (L.from !== undefined) L.from = clamp(L.from, -1e12, 1e12, 0);
          if (L.size !== undefined) L.size = clamp(L.size, 24, 400, 160);
          if (L.dur !== undefined) L.dur = clamp(L.dur, 6, 150, 30);
        }
        if (L.type === "bars") L.values = (Array.isArray(L.values) ? L.values : []).filter((v) => v && typeof v === "object").map((v) => ({ label: String(v.label ?? ""), value: clamp(v.value, -1e12, 1e12, 0), color: v.color })).slice(0, 8);
        return L as Layer;
      });
    const dur = clamp(s.dur, 20, 900, 90);
    return { id, dur: Math.round(dur), ground: typeof s.ground === "string" ? s.ground : i % 2 ? "paper" : "ink", enter: s.enter, exit: s.exit, layers, events: s.events, why: typeof s.why === "string" ? s.why : undefined, caption: s.caption };
  });
  return {
    title: String(raw.title ?? "Untitled").trim() || "Untitled",
    fps,
    design,
    formats,
    easings: raw.easings,
    defaults: raw.defaults ?? { enterFrames: 0, layerIn: { preset: "rise", dur: 14, ease: "out" } },
    scenes,
    audio: Array.isArray(raw.audio) ? raw.audio : [],
    rules: raw.rules,
  };
};

const findingsText = (f: MgFinding[]) => f.map((x) => `- ${x.level} ${x.rule} at ${x.where}: ${x.message}`).join("\n");

export const writeFilm = async (brief: string, opts: { seconds?: number; model?: string; language?: string; formats?: string[]; log?: (s: string) => void } = {}): Promise<{ film: MgFilm; provider: string; model: string; ms: number; findings: MgFinding[] }> => {
  const seconds = opts.seconds ?? 20;
  const log = opts.log ?? (() => {});
  const user = `Brief: ${brief}\n\nTarget length: ${seconds} seconds (${seconds * 30} frames at 30 fps, the scene durations add up to it). Language of the on-screen lines: ${opts.language ?? "English"}. Formats: ${(opts.formats ?? ["wide", "vertical"]).join(", ")}.`;
  const r = await chatJson<Partial<MgFilm>>([{ role: "system", content: MG_SYSTEM }, { role: "user", content: user }], { model: opts.model, maxTokens: 6000 });
  let film = normalizeFilm(r.data, { formats: opts.formats });
  if (!film.scenes.length) throw new Error("the model returned no scenes");
  let findings = lintFilm(film);
  let ms = r.ms;
  const errors = findings.filter((f) => f.level === "error");
  if (errors.length) {
    log(`${errors.length} error${errors.length === 1 ? "" : "s"} in the first draft, asking the model to fix them`);
    const fix = await chatJson<Partial<MgFilm>>(
      [
        { role: "system", content: MG_SYSTEM },
        { role: "user", content: user },
        { role: "assistant", content: JSON.stringify(film) },
        { role: "user", content: `The film has these problems. Return the whole corrected film as JSON, nothing else:\n${findingsText(findings)}` },
      ],
      { model: opts.model, maxTokens: 6000 },
    );
    const fixed = normalizeFilm(fix.data, { formats: opts.formats });
    ms += fix.ms;
    if (fixed.scenes.length && lintFilm(fixed).filter((f) => f.level === "error").length <= errors.length) {
      film = fixed;
      findings = lintFilm(film);
    }
  }
  // the design's colours become tokens; anything else painted is a mistake the rendered lint reports
  void designColors;
  return { film, provider: r.provider, model: r.model, ms, findings };
};

/** the files of a motion graphics project around a film.mograph.json */
export const scaffoldMgFiles = (film: MgFilm, opts: { harnessImport: string; name?: string }): Record<string, string> => {
  const name = opts.name ?? kebab(film.title, "film");
  const h = (p: string) => JSON.stringify(`${opts.harnessImport}/${p}`);
  const timeline = `/**
 * ${film.title}: the film is data (film.mograph.json). This module types it and
 * compiles it into the timeline the harness checks; the compositions draw the same data.
 * Edit the JSON (mh set, mh key, mh add, or the editor: mh edit), never this file.
 */
import raw from "../film.mograph.json";
import type { MgFilm } from ${h("mograph/schema.ts")};
import { mographTimeline } from ${h("mograph/timeline.ts")};

export const film = raw as MgFilm;
export const timeline = mographTimeline(film, { film: ${JSON.stringify(name)} });
`;
  const root = `import React from "react";
import { Composition } from "remotion";
import { MgFilmView, filmDuration } from ${h("mograph/runtime.tsx")};
import { film } from "./timeline.ts";

export const Root: React.FC = () => (
  <>
    {Object.entries(film.formats).map(([format, size]) => (
      <Composition key={format} id={\`${name}-\${format}\`} component={MgFilmView} width={size.width} height={size.height} fps={film.fps} durationInFrames={filmDuration(film)} defaultProps={{ film, format }} />
    ))}
  </>
);
`;
  const config = `/** generated by mh new --mograph; the native engine needs no Remotion install */
import { defineConfig } from ${h("config.ts")};
import { designColors } from ${h("mograph/schema.ts")};
import { film, timeline } from "./src/timeline.ts";

export default defineConfig({
  root: "./src/Root.tsx",
  rootExport: "Root",
  publicDir: "public",
  cacheDir: ".harness",
  engine: "native",
  films: {
    ${JSON.stringify(name)}: {
      timeline,
      formats: film.formats,
      defaultFormat: ${JSON.stringify(Object.keys(film.formats)[0] ?? "wide")},
      mograph: "film.mograph.json",
    },
  },
  tokens: { colors: designColors(film.design), sources: ["src/**/*.tsx"] },
  captions: { bottom: { wide: 70, vertical: 340 } },
});
`;
  const tsconfig = `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "types": ["bun"],
    "paths": { "remotion": [${JSON.stringify(`${opts.harnessImport}/engine/shim/remotion.tsx`)}] }
  },
  "include": ["src", "harness.config.ts", "film.mograph.json"]
}
`;
  const pkg = `{
  "name": ${JSON.stringify(name)},
  "private": true,
  "type": "module",
  "scripts": { "check": "mh check --format all", "render": "mh render --format all", "edit": "mh edit" },
  "dependencies": { "react": "^19.0.0", "react-dom": "^19.0.0" },
  "devDependencies": { "@types/bun": "^1.2.0", "@types/react": "^19.0.0", "@types/react-dom": "^19.0.0", "typescript": "^5.6.0" }
}
`;
  return {
    "film.mograph.json": JSON.stringify(film, null, 2) + "\n",
    "src/timeline.ts": timeline,
    "src/Root.tsx": root,
    "harness.config.ts": config,
    "tsconfig.json": tsconfig,
    "package.json": pkg,
    ".gitignore": ".harness/\nnode_modules/\n",
    "public/.gitkeep": "",
  };
};
