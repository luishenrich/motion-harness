/**
 * The film's data compiled into the timeline the harness checks: one part,
 * one scene per scene, the layers' ins and outs as events (`hook.lineIn`),
 * a group's children among them with the delay their group gives them, the
 * text layers as the scene's text (reading-time rule, subtitles), the layer
 * ids as probes, the design's colours as tokens, and a scene's transition as
 * the scene's `enter` so `inTransition` covers the handover frames.
 */
import type { Scene, Timeline, Transition } from "../timeline/schema.ts";
import type { Layer, MgFilm, MgScene } from "./schema.ts";
import { childrenOf, colorOf, isDark, layerTiming } from "./schema.ts";
import { cameraSettle, settleOf, walkLayers } from "./pose.ts";

const clamp = (v: number, dur: number) => Math.max(0, Math.min(dur - 1, Math.round(v)));

/** how long a scene's handover from the one before it takes; 0 when it cuts or is the first scene */
export const transitionDur = (film: MgFilm, scene: MgScene, index: number): number => {
  const t = scene.transition;
  if (!t || index <= 0 || t.type === "cut") return 0;
  const prev = film.scenes[index - 1];
  return Math.max(0, Math.min(t.dur ?? 12, scene.dur - 1, prev?.dur ?? 0));
};

/** the events a scene's layers imply: <layer>In at its start, <layer>Settled when it stops, <layer>Out when it leaves */
export const sceneEvents = (film: MgFilm, scene: MgScene): Record<string, number> => {
  const ev: Record<string, number> = {};
  for (const n of walkLayers(film, scene)) {
    const t = layerTiming(film, scene, n.layer);
    const inAt = clamp(n.delay + t.inAt, scene.dur);
    ev[`${n.layer.id}In`] = inAt;
    const settled = clamp(settleOf(film, scene, n.layer, n.delay), scene.dur);
    if (settled > inAt) ev[`${n.layer.id}Settled`] = settled;
    if (t.outAt !== null) ev[`${n.layer.id}Out`] = clamp(t.outAt, scene.dur);
  }
  const cam = cameraSettle(film, scene);
  if (cam !== null) ev.cameraSettled = clamp(cam, scene.dur);
  return { ...ev, ...(scene.events ?? {}) };
};

const textOf = (l: Layer): string[] => (l.type === "text" ? [l.text.replace(/\*/g, "")] : l.type === "list" ? l.items.map((i) => i.replace(/\*/g, "")) : l.type === "counter" ? [`${l.prefix ?? ""}${l.to}${l.suffix ?? ""}`] : []);

const layerText = (layers: Layer[]): string[] => layers.flatMap((l) => [...textOf(l), ...layerText(childrenOf(l))]);

/** every word the scene puts on screen, groups included, in the order the layers are written */
export const sceneText = (scene: MgScene): string[] => layerText(scene.layers ?? []);

export const toScene = (film: MgFilm, s: MgScene, index = film.scenes.indexOf(s)): Scene => {
  const ground = colorOf(film.design, s.ground ?? "ink", film.design.ink);
  const tDur = transitionDur(film, s, index);
  const enter: string | Transition | undefined = tDur > 0
    ? { type: s.transition!.type, dur: tDur }
    : s.enter === undefined
      ? film.defaults?.enterFrames
        ? { type: "fade", dur: film.defaults.enterFrames }
        : "cut"
      : s.enter === "cut"
        ? "cut"
        : s.enter === "fade"
          ? { type: "fade", dur: film.defaults?.enterFrames ?? 10 }
          : { type: s.enter.type, dur: s.enter.dur ?? film.defaults?.enterFrames ?? 10 };
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
    probes: walkLayers(film, s)
      .filter((n) => n.layer.probe !== false && n.layer.type !== "shape")
      .map((n) => {
        const t = layerTiming(film, s, n.layer);
        const from = Math.min(s.dur - 1, n.delay + t.inAt + t.inDur);
        const to = t.outAt !== null ? Math.max(from, t.outAt - 1) : t.to - 1;
        return `${n.layer.id}@${from}-${to}`;
      }),
  };
};

export const mographTimeline = (film: MgFilm, opts: { film?: string; formats?: string[] } = {}): Timeline => {
  const name = opts.film ?? "film";
  const formats = opts.formats ?? Object.keys(film.formats);
  return {
    fps: film.fps,
    rules: { minSceneDur: 20, maxEnterFrames: 30, holdFrames: [10, 240], ...(film.rules ?? {}) },
    // the compositions carry no sound of their own: every cue is mixed by the harness from the timeline
    parts: [{ id: "film", composition: Object.fromEntries(formats.map((f) => [f, `${name}-${f}`])), enterFrames: film.defaults?.enterFrames ?? 10, audio: false, scenes: film.scenes.map((s, i) => toScene(film, s, i)) }],
    audio: (film.audio ?? []).map((a) => ({ id: a.id, kind: a.kind, file: a.file.startsWith("public/") ? a.file : `public/${a.file}`, at: a.at, gain: a.gain, fadeOut: a.fadeOut, loop: a.loop, trim: a.trim, text: a.text, license: a.license, ramps: a.ramps })),
  };
};
