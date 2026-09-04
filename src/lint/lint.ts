/**
 * Rules that break the loop before a render happens.
 *
 * Static: colors in source files against the token list.
 * Timeline: scene durations, text durations, events inside their scene, overlaps.
 * Rendered (from probe results): colors actually painted, safe zones, expected probes visible.
 */
import { readFileSync } from "node:fs";
import type { LoadedConfig } from "../config.ts";
import type { Compiled } from "../timeline/schema.ts";
import type { ProbeResult } from "../render/frames.ts";

export type Finding = { level: "error" | "warn"; rule: string; where: string; message: string };

const norm = (hex: string) => hex.trim().toUpperCase();
const expand3 = (h: string) => (h.length === 4 ? "#" + [...h.slice(1)].map((c) => c + c).join("") : h);
const hexToRgb = (h: string) => {
  const x = expand3(norm(h)).slice(1);
  return [parseInt(x.slice(0, 2), 16), parseInt(x.slice(2, 4), 16), parseInt(x.slice(4, 6), 16)] as const;
};
const rgbToHex = (r: number, g: number, b: number) => "#" + [r, g, b].map((n) => Math.round(n).toString(16).padStart(2, "0")).join("").toUpperCase();

export const parseCssColor = (v: string): { hex: string; alpha: number } | null => {
  const m = v.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (m) return { hex: rgbToHex(+m[1], +m[2], +m[3]), alpha: m[4] === undefined ? 1 : parseFloat(m[4]) };
  const h = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (h) return { hex: expand3(norm(v)), alpha: 1 };
  return null;
};

const allowedSet = (cfg: LoadedConfig) => {
  const colors = (cfg.tokens?.colors ?? []).map((c) => expand3(norm(c)));
  const alphaOf = (cfg.tokens?.alphaOf ?? cfg.tokens?.colors ?? []).map((c) => expand3(norm(c)));
  return { colors: new Set(colors), alphaOf: new Set(alphaOf) };
};

const NEUTRAL = new Set(["#000000", "#FFFFFF"]);

export const lintStaticColors = async (cfg: LoadedConfig): Promise<Finding[]> => {
  const out: Finding[] = [];
  if (!cfg.tokens?.colors?.length) return out;
  const { colors, alphaOf } = allowedSet(cfg);
  const globs = cfg.tokens.sources ?? ["src/**/*.{ts,tsx,css}"];
  const ignore = cfg.tokens.ignoreLines ?? [];
  const files = new Set<string>();
  for (const g of globs) for await (const f of new Bun.Glob(g).scan({ cwd: cfg.projectDir, absolute: true })) files.add(f);
  for (const f of files) {
    const lines = readFileSync(f, "utf8").split("\n");
    lines.forEach((line, i) => {
      if (ignore.some((s) => line.includes(s))) return;
      if (/^\s*\/\//.test(line)) return;
      for (const m of line.matchAll(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?![0-9a-fA-F])|rgba?\([^)]+\)/g)) {
        const c = parseCssColor(m[0]);
        if (!c) continue;
        if (NEUTRAL.has(c.hex)) continue;
        if (c.alpha < 1 ? alphaOf.has(c.hex) || colors.has(c.hex) : colors.has(c.hex)) continue;
        out.push({ level: "error", rule: "color-token", where: `${f.replace(cfg.projectDir + "/", "")}:${i + 1}`, message: `${m[0]} is not a design token` });
      }
    });
  }
  return out;
};

export const lintTimeline = (cfg: LoadedConfig, c: Compiled): Finding[] => {
  const out: Finding[] = [];
  const rules = { ...(c.timeline.rules ?? {}), ...(cfg.rules ?? {}) };
  const minText = rules.minTextSeconds ?? ((w: number) => 1.2 + Math.max(0, w - 4) * 0.25);
  for (const s of c.scenes) {
    if (rules.minSceneDur && s.dur < rules.minSceneDur) out.push({ level: "warn", rule: "scene-min-dur", where: s.id, message: `${s.dur}f is under the ${rules.minSceneDur}f minimum` });
    for (const e of s.events) if (e.local < 0 || e.local >= s.dur) out.push({ level: "error", rule: "event-in-scene", where: `${s.id}.${e.name}`, message: `event at ${e.local} is outside the scene (0..${s.dur - 1})` });
    for (const st of s.states) if (st.local < 0 || st.local >= s.dur) out.push({ level: "error", rule: "state-in-scene", where: `${s.id}:${st.id}`, message: `state at ${st.local} is outside the scene` });
    if ((s.enter.dur ?? 0) >= s.dur) out.push({ level: "error", rule: "enter-longer-than-scene", where: s.id, message: `enter takes ${s.enter.dur}f, scene is ${s.dur}f` });
    if (rules.maxEnterFrames && (s.enter.dur ?? 0) > rules.maxEnterFrames) out.push({ level: "warn", rule: "enter-too-long", where: s.id, message: `enter ${s.enter.dur}f over the ${rules.maxEnterFrames}f rule` });
    if (s.text) {
      const words = s.text.join(" ").split(/\s+/).filter(Boolean).length;
      const need = minText(words);
      const have = (s.dur - (s.enter.dur ?? 0)) / c.fps;
      if (have < need) out.push({ level: "warn", rule: "text-too-short", where: s.id, message: `${words} words need ${need.toFixed(2)}s, scene holds ${have.toFixed(2)}s after the enter` });
    }
  }
  const ids = new Set<string>();
  for (const s of c.scenes) {
    if (ids.has(s.id)) out.push({ level: "error", rule: "scene-id-unique", where: s.id, message: "duplicate scene id" });
    ids.add(s.id);
  }
  return out;
};

export const lintProbe = (cfg: LoadedConfig, c: Compiled, format: string, frames: { label: string; sceneId: string; probe: ProbeResult }[]): Finding[] => {
  const out: Finding[] = [];
  const { colors, alphaOf } = allowedSet(cfg);
  const rules = { ...(c.timeline.rules ?? {}), ...(cfg.rules ?? {}) };
  const safe = rules.safeZone?.[format];
  const seenColor = new Map<string, string>();
  for (const f of frames) {
    if (!f.probe || f.probe.error) {
      out.push({ level: "warn", rule: "probe-missing", where: f.label, message: f.probe?.error ?? "no probe result" });
      continue;
    }
    if (colors.size) {
      for (const col of f.probe.colors) {
        const p = parseCssColor(col.value);
        if (!p || NEUTRAL.has(p.hex)) continue;
        const ok = p.alpha < 1 ? alphaOf.has(p.hex) || colors.has(p.hex) : colors.has(p.hex);
        if (!ok && !seenColor.has(col.prop + p.hex)) {
          seenColor.set(col.prop + p.hex, f.label);
          out.push({ level: "error", rule: "painted-color-token", where: f.label, message: `${col.prop} ${p.hex}${p.alpha < 1 ? ` @${p.alpha}` : ""} painted (${col.count}x, e.g. "${col.example}") is not a design token` });
        }
      }
    }
    if (safe) {
      const { w: W, h: H } = f.probe.viewport;
      for (const it of f.probe.items) {
        if (!it.visible || it.kind === "media") continue;
        if (it.y < safe.top || it.y + it.h > H - safe.bottom || it.x < safe.x || it.x + it.w > W - safe.x) {
          out.push({ level: "warn", rule: "safe-zone", where: `${f.label} ${it.key}`, message: `at ${it.x},${it.y} ${it.w}x${it.h} leaves the safe zone (top ${safe.top}, bottom ${safe.bottom}, x ${safe.x})` });
        }
      }
    }
    const scene = c.scenes.find((s) => s.id === f.sceneId);
    if (scene?.probes.length) {
      for (const key of scene.probes) {
        const it = f.probe.items.find((i) => i.key === key);
        if (!it) out.push({ level: "error", rule: "probe-present", where: `${f.label} ${key}`, message: "expected data-probe element not in the DOM" });
        else if (!it.visible) out.push({ level: "warn", rule: "probe-visible", where: `${f.label} ${key}`, message: `present but not visible (opacity ${it.opacity}, ${it.w}x${it.h} at ${it.x},${it.y})` });
      }
    }
  }
  return out;
};

export const formatFindings = (fs: Finding[]): string => {
  if (!fs.length) return "no findings";
  return fs.map((f) => `${f.level === "error" ? "ERROR" : "warn "}  ${f.rule.padEnd(24)} ${f.where.padEnd(40)} ${f.message}`).join("\n");
};
