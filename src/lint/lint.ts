/**
 * Rules that break the loop before a render happens.
 *
 * Static: colors in source files against the token list.
 * Timeline: scene durations, text durations, events inside their scene, overlaps.
 * Rendered (from probe results): colors actually painted, safe zones, expected probes visible,
 * boxes leaving the frame, text wrapping past its declared lines, probed elements colliding,
 * demo scenes sharing one stage top, and the same probes visible in every format.
 */
import { readFileSync } from "node:fs";
import type { LoadedConfig } from "../config.ts";
import type { Compiled } from "../timeline/schema.ts";
import { resolve } from "../timeline/resolve.ts";
import type { ProbeItem, ProbeResult } from "../render/frames.ts";

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

/** what the probe adds on top of the box: ids for the ancestor exclusion, line metrics for the wrap rule */
export type LayoutItem = ProbeItem & { id?: number; ancestors?: number[]; lineHeight?: string; lines?: number; brs?: number; lint?: string };

export type ProbeFrame = { label: string; sceneId: string; probe: ProbeResult; local?: number; partFrame?: number };

const OVERFLOW_PX = 2;
const COLLISION_PX = 4;
const WRAP_PX = 4;
const SAME_TOP_PX = 3;

const lineHeightOf = (it: LayoutItem): number => {
  const lh = parseFloat(it.lineHeight ?? "");
  if (Number.isFinite(lh) && lh > 0) return lh;
  const fs = parseFloat(it.fontSize ?? "");
  return Number.isFinite(fs) && fs > 0 ? fs * 1.2 : 0;
};

const isText = (it: LayoutItem) => it.kind === "text" || (it.kind === "probe" && !!it.text);

export const lintOverflow = (label: string, probe: ProbeResult): Finding[] => {
  const out: Finding[] = [];
  const { w: W, h: H } = probe.viewport;
  for (const it of probe.items as LayoutItem[]) {
    if (it.opacity <= 0.05 || it.w <= 0 || it.h <= 0) continue;
    const sides: string[] = [];
    if (it.x < -OVERFLOW_PX) sides.push(`left by ${-it.x}px`);
    if (it.y < -OVERFLOW_PX) sides.push(`top by ${-it.y}px`);
    if (it.x + it.w > W + OVERFLOW_PX) sides.push(`right by ${it.x + it.w - W}px`);
    if (it.y + it.h > H + OVERFLOW_PX) sides.push(`bottom by ${it.y + it.h - H}px`);
    if (sides.length) out.push({ level: "error", rule: "overflow", where: `${label} ${it.key}`, message: `leaves the ${W}x${H} frame ${sides.join(", ")} (box ${it.x},${it.y} ${it.w}x${it.h})` });
  }
  return out;
};

export const lintWrap = (label: string, probe: ProbeResult): Finding[] => {
  const out: Finding[] = [];
  for (const it of probe.items as LayoutItem[]) {
    if (!it.visible || !isText(it)) continue;
    const lh = lineHeightOf(it);
    if (!lh) continue;
    const declared = it.lines !== undefined && it.lines > 0;
    const expected = declared ? it.lines! : (it.brs ?? 0) + 1;
    // padded chips and buttons sit above one line height without wrapping: count lines, do not measure slack
    // a button's line box is taller than its line height without wrapping: only a full extra line counts
    const got = Math.max(1, Math.floor(it.h / lh + 0.15));
    if (got <= expected) continue;
    out.push({ level: declared ? "error" : "warn", rule: "wrap", where: `${label} ${it.key}`, message: `wraps to ${got} lines, ${declared ? "declared" : "expected"} ${expected} (ink ${it.h}px, line ${lh}px)` });
  }
  return out;
};

const related = (a: LayoutItem, b: LayoutItem) =>
  a.id !== undefined && b.id !== undefined && ((a.ancestors ?? []).includes(b.id) || (b.ancestors ?? []).includes(a.id));

/** while two scenes crossfade, both sit in the DOM at half opacity: only elements that are clearly there count */
const COLLISION_OPACITY = 0.6;

export const lintCollision = (label: string, probe: ProbeResult): Finding[] => {
  const out: Finding[] = [];
  const items = (probe.items as LayoutItem[]).filter((it) => it.visible && it.opacity >= COLLISION_OPACITY && it.w > 0 && it.h > 0 && (it.kind === "probe" || it.kind === "text") && it.lint !== "no-collision");
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j];
      if (a.kind !== "probe" && b.kind !== "probe") continue;
      if (related(a, b)) continue;
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ox > COLLISION_PX && oy > COLLISION_PX) out.push({ level: "error", rule: "collision", where: `${label} ${a.key}`, message: `overlaps "${b.key}" by ${ox}x${oy}px` });
    }
  }
  return out;
};

/** the frame a lint should look at for a scene: the settled one, else (unless strict) the first probed frame of the scene */
const settledFrame = (c: Compiled, frames: ProbeFrame[], sceneId: string, strict = false): ProbeFrame | undefined => {
  const s = c.scenes.find((x) => x.id === sceneId);
  const mine = frames.filter((f) => f.sceneId === sceneId && f.probe && !f.probe.error);
  if (!mine.length) return undefined;
  const local = s ? s.settled - s.start : 0;
  return mine.find((f) => f.local === local) ?? mine.find((f) => f.label === `${sceneId}+${local}`) ?? (strict ? undefined : mine[0]);
};

export const lintSameTop = (c: Compiled, frames: ProbeFrame[]): Finding[] => {
  const out: Finding[] = [];
  const tops: { sceneId: string; label: string; top: number }[] = [];
  for (const s of c.scenes) {
    if (s.stage !== "demo") continue;
    const f = settledFrame(c, frames, s.id);
    if (!f) continue;
    const st = f.probe.items.find((i) => i.kind === "probe" && i.key === "stage");
    if (!st) {
      out.push({ level: "warn", rule: "same-top", where: `${f.label} stage`, message: `demo scene has no data-probe="stage" element` });
      continue;
    }
    tops.push({ sceneId: s.id, label: f.label, top: st.y });
  }
  if (tops.length < 2) return out;
  const sorted = tops.map((t) => t.top).sort((a, b) => a - b);
  const median = sorted[Math.floor((sorted.length - 1) / 2)];
  for (const t of tops) if (Math.abs(t.top - median) > SAME_TOP_PX) out.push({ level: "error", rule: "same-top", where: `${t.label} stage`, message: `stage top ${t.top}px, the other demo scenes sit at ${median}px (tops: ${tops.map((x) => `${x.sceneId}=${x.top}`).join(", ")})` });
  return out;
};

export const lintProbe = (cfg: LoadedConfig, c: Compiled, format: string, frames: ProbeFrame[]): Finding[] => {
  const out: Finding[] = [];
  const { colors, alphaOf } = allowedSet(cfg);
  const rules = { ...(c.timeline.rules ?? {}), ...(cfg.rules ?? {}) };
  const safe = rules.safeZone?.[format];
  const seenColor = new Map<string, string>();
  const wrapped = new Set<string>();
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
    // during a part's overlap the previous scene is still rendered under this one: its elements are not this scene's
    const overlap = c.parts.find((p) => p.id === scene?.part)?.overlap ?? 0;
    const local = f.local ?? (Number(f.label.split("+")[1]) || 0);
    out.push(...lintOverflow(f.label, f.probe));
    if (local >= overlap) out.push(...lintCollision(f.label, f.probe));
    // a wrapped line stays wrapped for the whole scene, one finding per scene and element is enough
    for (const w of lintWrap(f.label, f.probe)) {
      const k = `${f.sceneId} ${w.where.slice(f.label.length + 1)}`;
      if (wrapped.has(k)) continue;
      wrapped.add(k);
      out.push(w);
    }
  }
  out.push(...lintSameTop(c, frames));
  return out;
};

/** a cursor leg as the film config may declare it; only the frame refs are read here */
export type CursorLeg = { at?: string | number; from?: string | number; to?: string | number };

export type LegFrame = { ref: string; sceneId: string; partFrame: number };

/** the frames a film's cursor legs land on, resolved against the timeline; refs the timeline does not know are skipped */
export const cursorLegFrames = (c: Compiled, film: unknown): LegFrame[] => {
  const legs = (film as { cursor?: { legs?: unknown } } | undefined)?.cursor?.legs;
  if (!Array.isArray(legs)) return [];
  const out: LegFrame[] = [];
  for (const leg of legs as CursorLeg[]) {
    if (!leg || typeof leg !== "object") continue;
    for (const ref of [leg.at, leg.from, leg.to]) {
      if (ref === undefined || ref === null) continue;
      try {
        const L = resolve(c, ref);
        if (!out.some((o) => o.sceneId === L.scene.id && o.partFrame === L.partFrame)) out.push({ ref: String(ref), sceneId: L.scene.id, partFrame: L.partFrame });
      } catch {
        /* a ref the timeline cannot place is the timeline lint's business */
      }
    }
  }
  return out;
};

/** the same probes visible in every format at the settled frame, and a cursor at every leg in every format */
export const lintFormatParity = (c: Compiled, runs: Record<string, ProbeFrame[]>, legs: LegFrame[] = []): Finding[] => {
  const out: Finding[] = [];
  const formats = Object.keys(runs);
  for (const s of c.scenes) {
    const seen: Record<string, Set<string>> = {};
    for (const fmt of formats) {
      const f = settledFrame(c, runs[fmt], s.id, true);
      if (f) seen[fmt] = new Set(f.probe.items.filter((i) => i.kind === "probe" && i.visible).map((i) => i.key));
    }
    const have = Object.keys(seen);
    if (have.length < 2) continue;
    const union = new Set(have.flatMap((fmt) => [...seen[fmt]]));
    for (const key of union) {
      const missing = have.filter((fmt) => !seen[fmt].has(key));
      if (missing.length) out.push({ level: "error", rule: "format-parity", where: `${s.id} ${key}`, message: `visible in ${have.filter((fmt) => seen[fmt].has(key)).join(", ")} but not in ${missing.join(", ")}` });
    }
  }
  for (const leg of legs) {
    for (const fmt of formats) {
      const f = runs[fmt].find((x) => x.sceneId === leg.sceneId && x.partFrame === leg.partFrame && x.probe && !x.probe.error);
      if (!f) {
        out.push({ level: "warn", rule: "format-parity", where: `${leg.sceneId} cursor@${leg.ref}`, message: `no probe frame at part frame ${leg.partFrame} in ${fmt}` });
        continue;
      }
      const cur = f.probe.items.find((i) => i.kind === "probe" && i.key === "cursor");
      if (!cur) out.push({ level: "error", rule: "format-parity", where: `${leg.sceneId} cursor@${leg.ref}`, message: `no data-probe="cursor" element in ${fmt} at ${f.label}` });
      else if (!cur.visible) out.push({ level: "error", rule: "format-parity", where: `${leg.sceneId} cursor@${leg.ref}`, message: `cursor not visible in ${fmt} at ${f.label} (opacity ${cur.opacity}, ${cur.w}x${cur.h} at ${cur.x},${cur.y})` });
    }
  }
  return out;
};

export const formatFindings = (fs: Finding[]): string => {
  if (!fs.length) return "no findings";
  return fs.map((f) => `${f.level === "error" ? "ERROR" : "warn "}  ${f.rule.padEnd(24)} ${f.where.padEnd(40)} ${f.message}`).join("\n");
};
