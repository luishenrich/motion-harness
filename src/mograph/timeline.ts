/**
 * The film's data compiled into the timeline the harness checks: one part,
 * one scene per scene, the layers' ins and outs as events (`hook.lineIn`),
 * the text layers as the scene's text (reading-time rule, subtitles), the
 * layer ids as probes, the design's colours as tokens.
 */
import type { Scene, Timeline } from "../timeline/schema.ts";
import type { Layer, MgFilm, MgScene } from "./schema.ts";
import { colorOf, isDark, layerTiming } from "./schema.ts";
import { settleFrame } from "./pose.ts";

const unitsOf = (l: Layer): number => {
  const st = l.in?.stagger;
  if (!st) return 1;
  if (l.type === "text") return st.by === "char" ? l.text.length : st.by === "line" ? l.text.split("\n").length : l.text.split(/\s+/).length;
  if (l.type === "list") return l.items.length;
  if (l.type === "bars") return l.values.length;
  return 1;
};

/** the events a scene's layers imply: <layer>In at its start, <layer>Settled when it stops, <layer>Out when it leaves */
export const sceneEvents = (film: MgFilm, scene: MgScene): Record<string, number> => {
  const ev: Record<string, number> = {};
  for (const l of scene.layers) {
    const t = layerTiming(film, scene, l);
    ev[`${l.id}In`] = t.inAt;
    const settled = settleFrame(film, scene, l, unitsOf(l));
    if (settled > t.inAt) ev[`${l.id}Settled`] = settled;
    if (t.outAt !== null) ev[`${l.id}Out`] = t.outAt;
  }
  return { ...ev, ...(scene.events ?? {}) };
};

export const sceneText = (scene: MgScene): string[] => scene.layers.flatMap((l) => (l.type === "text" ? [l.text.replace(/\*/g, "")] : l.type === "list" ? l.items.map((i) => i.replace(/\*/g, "")) : l.type === "counter" ? [`${l.prefix ?? ""}${l.to}${l.suffix ?? ""}`] : []));

export const toScene = (film: MgFilm, s: MgScene): Scene => {
  const ground = colorOf(film.design, s.ground ?? "ink", film.design.ink);
  const enter = s.enter === undefined ? (film.defaults?.enterFrames ? { type: "fade", dur: film.defaults.enterFrames } : "cut") : s.enter === "cut" ? "cut" : s.enter === "fade" ? { type: "fade", dur: film.defaults?.enterFrames ?? 10 } : { type: s.enter.type, dur: s.enter.dur ?? film.defaults?.enterFrames ?? 10 };
  const exit = s.exit === undefined ? undefined : s.exit === "cut" ? undefined : s.exit === "fade" ? { type: "fade", dur: 8 } : { type: s.exit.type, dur: s.exit.dur ?? 8 };
  const text = sceneText(s);
  return {
    id: s.id,
    dur: s.dur,
    enter,
    exit,
    ground: isDark(ground) ? "dark" : "light",
    stage: "mograph",
    text: text.length ? text : undefined,
    caption: s.caption,
    why: s.why,
    events: sceneEvents(film, s),
    // a layer is expected on screen from the end of its in to the start of its out
    probes: s.layers.filter((l) => l.probe !== false && l.type !== "shape").map((l) => {
      const t = layerTiming(film, s, l);
      const from = Math.min(s.dur - 1, t.inAt + t.inDur);
      const to = t.outAt !== null ? Math.max(from, t.outAt - 1) : t.to - 1;
      return `${l.id}@${from}-${to}`;
    }),
  };
};

export const mographTimeline = (film: MgFilm, opts: { film?: string; formats?: string[] } = {}): Timeline => {
  const name = opts.film ?? "film";
  const formats = opts.formats ?? Object.keys(film.formats);
  return {
    fps: film.fps,
    rules: { minSceneDur: 20, maxEnterFrames: 30, holdFrames: [10, 240], ...(film.rules ?? {}) },
    parts: [{ id: "film", composition: Object.fromEntries(formats.map((f) => [f, `${name}-${f}`])), enterFrames: film.defaults?.enterFrames ?? 10, scenes: film.scenes.map((s) => toScene(film, s)) }],
    audio: (film.audio ?? []).map((a) => ({ id: a.id, kind: a.kind, file: a.file.startsWith("public/") ? a.file : `public/${a.file}`, at: a.at, gain: a.gain, fadeOut: a.fadeOut, loop: a.loop, trim: a.trim, text: a.text, license: a.license, ramps: a.ramps })),
  };
};
