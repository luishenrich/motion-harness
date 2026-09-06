/**
 * From a brief to a project. A model turns the brief into a script (scenes with
 * a headline, a body line, a visual note, seconds); the scaffold turns the
 * script into a project the harness can check on the spot: timeline as data,
 * one component per scene, a Root, a config. Nothing timed anywhere else.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chatJson } from "../ai/azure.ts";

export type ScriptScene = { id: string; seconds: number; ground: "dark" | "cream"; headline: string; body?: string; visual?: string; why?: string };
export type Script = { title: string; audience?: string; job?: string; fps?: number; scenes: ScriptScene[] };

const SYSTEM = `You write scripts for short product and launch films that are rendered from React components. A script is a list of scenes. Each scene has: id (short kebab-case, unique), seconds (2 to 8), ground ("dark" or "cream"), headline (the on-screen line, at most 8 words, plain human voice, no em dashes, no exclamation marks, no emojis), body (optional second line, at most 14 words), visual (one sentence: what is on screen besides the words, concrete), why (one sentence: what the scene does for the viewer). Open with the viewer's problem or the most characteristic thing, not with the product name. End with one call to action. Total length matches the requested seconds within 10 percent. Answer with JSON only: {"title": "...", "audience": "...", "job": "...", "scenes": [...]}.`;

export const writeScript = async (brief: string, opts: { seconds?: number; model?: string; language?: string }): Promise<{ script: Script; provider: string; model: string; ms: number }> => {
  const seconds = opts.seconds ?? 30;
  const r = await chatJson<Script>(
    [
      { role: "system", content: SYSTEM },
      { role: "user", content: `Brief: ${brief}\n\nTarget length: ${seconds} seconds. Language of the on-screen lines: ${opts.language ?? "English"}.` },
    ],
    { model: opts.model, maxTokens: 3000 },
  );
  const s = r.data;
  if (!s || !Array.isArray(s.scenes) || !s.scenes.length) throw new Error("the model returned no scenes");
  return { script: normalizeScript(s), provider: r.provider, model: r.model, ms: r.ms };
};

/** ids unique and kebab-case, seconds clamped, grounds valid */
export const normalizeScript = (s: Script): Script => {
  const seen = new Set<string>();
  const scenes = s.scenes.map((sc, i) => {
    let id = String(sc.id ?? `scene-${i + 1}`).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || `scene-${i + 1}`;
    if (/^\d/.test(id)) id = `s${id}`;
    while (seen.has(id)) id = `${id}-${i + 1}`;
    seen.add(id);
    return { id, seconds: Math.max(1.5, Math.min(12, Number(sc.seconds) || 3)), ground: sc.ground === "cream" ? "cream" : "dark", headline: String(sc.headline ?? "").trim(), body: sc.body ? String(sc.body).trim() : undefined, visual: sc.visual ? String(sc.visual).trim() : undefined, why: sc.why ? String(sc.why).trim() : undefined } as ScriptScene;
  });
  return { title: s.title ?? "Untitled", audience: s.audience, job: s.job, fps: s.fps ?? 30, scenes };
};

export const scriptMarkdown = (s: Script): string => {
  const total = s.scenes.reduce((a, b) => a + b.seconds, 0);
  const L = [`# ${s.title}`, ""];
  if (s.audience) L.push(`Audience: ${s.audience}`);
  if (s.job) L.push(`Job: ${s.job}`);
  L.push(`Length: ${total.toFixed(1)} s, ${s.scenes.length} scenes`, "");
  s.scenes.forEach((sc, i) => {
    L.push(`## ${i + 1}. ${sc.id} (${sc.seconds}s, ${sc.ground})`, "", sc.headline);
    if (sc.body) L.push(sc.body);
    if (sc.visual) L.push("", `Visual: ${sc.visual}`);
    if (sc.why) L.push(`Why: ${sc.why}`);
    L.push("");
  });
  return L.join("\n");
};

/** the inverse: a script.md written or edited by hand back into data */
export const parseScriptMarkdown = (md: string): Script => {
  const lines = md.split("\n");
  const title = (lines.find((l) => l.startsWith("# ")) ?? "# Untitled").slice(2).trim();
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
    const h = raw.match(/^## \d+\.\s*([\w-]+)\s*\((\d+(?:\.\d+)?)s,\s*(dark|cream)\)/);
    if (h) {
      flush();
      cur = { id: h[1], seconds: parseFloat(h[2]), ground: h[3] as "dark" | "cream", headline: "" };
      continue;
    }
    if (!cur) continue;
    if (raw.startsWith("Visual:")) cur.visual = raw.slice(7).trim();
    else if (raw.startsWith("Why:")) cur.why = raw.slice(4).trim();
    else if (raw.trim()) textLines.push(raw);
  }
  flush();
  return normalizeScript({ title, scenes });
};

/* ---------- scaffold ---------- */

const ts = (s: string) => JSON.stringify(s);

export const scaffoldFiles = (script: Script, opts: { harnessImport: string; formats: string[]; fps?: number }): Record<string, string> => {
  const fps = opts.fps ?? script.fps ?? 30;
  const formats = opts.formats.length ? opts.formats : ["wide"];
  const sizes: Record<string, { width: number; height: number }> = { wide: { width: 1920, height: 1080 }, vertical: { width: 1080, height: 1920 }, square: { width: 1080, height: 1080 } };
  const film = script.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "film";
  const sceneLines = script.scenes.map((sc) => `  ${ts(sc.id)}: { dur: ${Math.round(sc.seconds * fps)}, ground: ${ts(sc.ground)}, headline: ${ts(sc.headline)}, body: ${ts(sc.body ?? "")}, visual: ${ts(sc.visual ?? "")}, why: ${ts(sc.why ?? "")} },`).join("\n");
  const timeline = `/**
 * ${script.title}: the timeline as data. Generated by mh script from the brief; edit here, never in the components.
 */
import { defineTimeline } from ${ts(opts.harnessImport + "/timeline/schema.ts")};

export const FPS = ${fps};

export type SceneSpec = { dur: number; ground: "dark" | "cream"; headline: string; body: string; visual: string; why: string };

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
        text: SCENES[id].body ? [SCENES[id].headline, SCENES[id].body] : SCENES[id].headline,
        probes: ["headline"],
        why: SCENES[id].why || undefined,
      })),
    },
  ],
  rules: { minSceneDur: 24, maxEnterFrames: 14, safeZone: { vertical: { top: 220, bottom: 320, x: 60 } } },
});
`;
  const filmTsx = `/**
 * ${script.title}. One component per scene, all reading the timeline. The Scene
 * component is the starting point: replace its visual with the real thing scene
 * by scene (the timeline's "visual" note says what belongs there).
 */
import React from "react";
import { AbsoluteFill, Easing, Sequence, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { compile } from ${ts(opts.harnessImport + "/timeline/schema.ts")};
import { timeline, SCENES, FADE, type SceneId } from "./timeline.ts";

const c = compile(timeline);

export const INK = "#1C1A17", CREAM = "#F7F4E3", GOLD = "#FFBC14", MUTED = "#6B6459", MUTED_ON_DARK = "#A39C8F";
const SANS = "-apple-system, 'Helvetica Neue', Helvetica, Arial, sans-serif";

const rise = (frame: number, at: number, dur = 14) => {
  const p = interpolate(frame, [at, at + dur], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  return { opacity: p, transform: \`translateY(\${(1 - p) * 18}px)\` };
};

const Fade: React.FC<{ dur: number; children: React.ReactNode }> = ({ dur, children }) => {
  const f = useCurrentFrame();
  const o = interpolate(f, [0, 10, dur - FADE.dur, dur - 1], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return <AbsoluteFill style={{ opacity: o }}>{children}</AbsoluteFill>;
};

const Scene: React.FC<{ id: SceneId; story: boolean }> = ({ id, story }) => {
  const f = useCurrentFrame();
  const s = SCENES[id];
  const dark = s.ground === "dark";
  return (
    <AbsoluteFill style={{ backgroundColor: dark ? INK : CREAM, color: dark ? CREAM : INK, fontFamily: SANS, justifyContent: "center", alignItems: "center", padding: story ? "0 110px" : "0 200px", boxSizing: "border-box" }}>
      {s.visual ? (
        <div data-probe="visual" data-lines={4} data-lint="no-collision" style={{ ...rise(f, 2), width: story ? 760 : 900, height: story ? 400 : 380, borderRadius: 18, border: \`2px dashed \${dark ? "rgba(247,244,227,0.3)" : "rgba(28,26,23,0.25)"}\`, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 32, fontSize: 26, lineHeight: 1.3, color: dark ? MUTED_ON_DARK : MUTED, marginBottom: 40 }}>
          {s.visual}
        </div>
      ) : null}
      <div data-probe="headline" data-lines={story ? 3 : 2} style={{ ...rise(f, 4), fontSize: story ? 60 : 72, lineHeight: 1.15, textAlign: "center", maxWidth: story ? 860 : 1500, letterSpacing: -1 }}>
        {s.headline}
      </div>
      {s.body ? (
        <div data-probe="body" data-lines={story ? 3 : 2} style={{ ...rise(f, 16), marginTop: 24, fontSize: story ? 34 : 36, lineHeight: 1.35, textAlign: "center", maxWidth: story ? 820 : 1300, color: dark ? MUTED_ON_DARK : MUTED }}>
          {s.body}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

export const Film: React.FC<{ story?: boolean }> = ({ story = false }) => {
  const { width } = useVideoConfig();
  const s = story || width < 1200;
  return (
    <AbsoluteFill style={{ backgroundColor: INK }}>
      {c.scenes.map((sc) => (
        <Sequence key={sc.id} from={sc.start} durationInFrames={sc.dur}>
          <Fade dur={sc.dur}>
            <Scene id={sc.id as SceneId} story={s} />
          </Fade>
        </Sequence>
      ))}
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
  const config = `/** generated by mh script; the native engine needs no Remotion install */
import { defineConfig } from ${ts(opts.harnessImport + "/config.ts")};
import { timeline } from "./src/timeline.ts";

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
  tokens: { colors: ["#1C1A17", "#F7F4E3", "#FFBC14", "#6B6459", "#A39C8F"], sources: ["src/**/*.tsx"] },
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
