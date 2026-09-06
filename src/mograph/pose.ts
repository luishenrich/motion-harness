/**
 * Where a layer is at a frame. Presets are keyframe tracks written for you
 * (rise = opacity 0 to 1 plus y from 32 to 0); explicit tracks win per
 * property. Staggered layers evaluate the same pose per unit (word, char,
 * line, item) with the unit's own delay. The result is plain numbers a
 * component turns into a style, and that a test can assert.
 */
import { resolveEase, progressOf, type Resolved } from "./easing.ts";
import type { EaseRef, InPreset, Keyframe, Layer, MgFilm, MgScene, Motion, OutPreset, Side, Stagger, TrackProp, Tracks } from "./schema.ts";
import { layerTiming } from "./schema.ts";

export type Pose = {
  opacity: number;
  /** u pixels */
  x: number;
  y: number;
  scale: number;
  rotate: number;
  blur: number;
  /** 0..1 for counters, rings, bars, typewriter */
  progress: number;
  /** wipe reveal 0..1 and the side it reveals from */
  wipe: number;
  wipeFrom: Side;
  /** growth along one axis (grow preset), 0..1 */
  w: number;
  h: number;
  /** false before the layer's span or after it */
  visible: boolean;
};

const REST: Pose = { opacity: 1, x: 0, y: 0, scale: 1, rotate: 0, blur: 0, progress: 1, wipe: 1, wipeFrom: "left", w: 1, h: 1, visible: true };

const sideVector = (side: Side | undefined, d: number): { x: number; y: number } => (side === "right" ? { x: d, y: 0 } : side === "top" ? { x: 0, y: -d } : side === "bottom" ? { x: 0, y: d } : { x: -d, y: 0 });

/** the tracks an in preset writes, in frames relative to `at` */
export const inTracks = (m: Motion<InPreset>): Tracks => {
  const dur = m.dur ?? 14;
  const ease = m.ease ?? "out";
  const dist = m.distance ?? 32;
  const k = (from: number, to: number): Keyframe[] => [{ at: 0, v: from }, { at: dur, v: to, ease }];
  switch (m.preset ?? "rise") {
    case "cut":
      return {};
    case "fade":
      return { opacity: k(0, 1) };
    case "rise":
      return { opacity: k(0, 1), y: k(dist, 0) };
    case "drop":
      return { opacity: k(0, 1), y: k(-dist, 0) };
    case "pop":
      return { opacity: [{ at: 0, v: 0 }, { at: Math.min(dur, 6), v: 1, ease: "out" }], scale: [{ at: 0, v: 0.7 }, { at: dur, v: 1, ease: m.ease ?? "back" }] };
    case "slide": {
      const v = sideVector(m.from, m.distance ?? 120);
      return { opacity: [{ at: 0, v: 0 }, { at: Math.min(dur, 8), v: 1, ease: "out" }], x: k(v.x, 0), y: k(v.y, 0) };
    }
    case "wipe":
      return { wipe: k(0, 1) };
    case "grow":
      return { w: k(0, 1) };
    case "blur":
      return { opacity: k(0, 1), blur: k(m.distance ?? 14, 0) };
    case "typewriter":
      return { progress: [{ at: 0, v: 0 }, { at: dur, v: 1, ease: "linear" }] };
    case "mask":
      return { y: k(dist * 3, 0), opacity: [{ at: 0, v: 0 }, { at: 1, v: 1 }] };
  }
};

/** the tracks an out preset writes, relative to its `at` */
export const outTracks = (m: Motion<OutPreset>): Tracks => {
  const dur = m.dur ?? 8;
  const ease = m.ease ?? "in";
  const dist = m.distance ?? 24;
  const k = (from: number, to: number): Keyframe[] => [{ at: 0, v: from }, { at: dur, v: to, ease }];
  switch (m.preset ?? "fade") {
    case "cut":
      return { opacity: [{ at: 0, v: 1 }, { at: 1, v: 0 }] };
    case "fade":
      return { opacity: k(1, 0) };
    case "sink":
      return { opacity: k(1, 0), y: k(0, dist) };
    case "lift":
      return { opacity: k(1, 0), y: k(0, -dist) };
    case "shrink":
      return { opacity: k(1, 0), scale: k(1, 0.9) };
    case "slide": {
      const v = sideVector(m.from, m.distance ?? 120);
      return { opacity: k(1, 0), x: k(0, v.x), y: k(0, v.y) };
    }
    case "wipe":
      return { wipe: k(1, 0) };
    case "blur":
      return { opacity: k(1, 0), blur: k(0, m.distance ?? 14) };
  }
};

/** value of one track at a local frame; before the first key the first value holds, after the last the last */
export const trackValue = (keys: Keyframe[], frame: number, fps: number, table: Record<string, EaseRef>, offset = 0): number => {
  if (!keys.length) return 0;
  const ks = [...keys].sort((a, b) => a.at - b.at);
  const f = frame - offset;
  if (f <= ks[0].at) return ks[0].v;
  for (let i = 1; i < ks.length; i++) {
    const a = ks[i - 1], b = ks[i];
    if (f <= b.at || i === ks.length - 1) {
      if (f >= b.at) {
        // past this key: a spring keeps moving after its nominal end, a curve is done
        const r = resolveEase(b.ease, table);
        if (r.kind === "spring") return a.v + (b.v - a.v) * progressOf(r, f - a.at, b.at - a.at, fps);
        return b.v;
      }
      const r: Resolved = resolveEase(b.ease, table);
      return a.v + (b.v - a.v) * progressOf(r, f - a.at, b.at - a.at, fps);
    }
  }
  return ks[ks.length - 1].v;
};

const PROPS: TrackProp[] = ["opacity", "x", "y", "scale", "rotate", "blur", "progress", "wipe", "w", "h"];

/** the pose of a layer (or one staggered unit of it, delayed by `delay` frames) at a local frame */
export const poseAt = (film: MgFilm, scene: MgScene, layer: Layer, frame: number, delay = 0): Pose => {
  const t = layerTiming(film, scene, layer);
  const table = film.easings ?? {};
  const fps = film.fps;
  const pose: Pose = { ...REST, opacity: layer.opacity ?? 1, scale: layer.scale ?? 1, rotate: layer.rotate ?? 0 };
  if (frame < t.from || frame >= t.to) return { ...pose, visible: false, opacity: 0 };
  const inM: Motion<InPreset> = { ...(film.defaults?.layerIn ?? {}), ...(layer.in ?? {}) };
  const outM: Motion<OutPreset> = { ...(film.defaults?.layerOut ?? {}), ...(layer.out ?? {}) };
  const inT = inTracks({ ...inM, dur: t.inDur });
  const outT = t.outAt !== null ? outTracks({ ...outM, dur: t.outDur }) : {};
  if (inM.preset === "wipe" || outM.preset === "wipe") pose.wipeFrom = (inM.preset === "wipe" ? inM.from : outM.from) ?? "left";
  const explicit = layer.tracks ?? {};
  for (const p of PROPS) {
    const base = p === "opacity" ? pose.opacity : p === "scale" ? pose.scale : p === "rotate" ? pose.rotate : p === "x" || p === "y" || p === "blur" ? 0 : 1;
    let v = base;
    if (explicit[p]?.length) {
      v = trackValue(explicit[p]!, frame, fps, table, t.from);
    } else {
      // the in animates from its start; the out takes over from its start; between them the layer rests
      const inKeys = inT[p];
      const outKeys = outT[p];
      // the in is staggered per unit; the out takes every unit at once, so a scene's end stays a hard edge
      const inStart = t.inAt + delay;
      const outStart = t.outAt;
      if (outStart !== null && frame >= outStart && outKeys?.length) v = trackValue(outKeys, frame, fps, table, outStart);
      else if (inKeys?.length) v = trackValue(inKeys, frame, fps, table, inStart);
      // a scale or opacity preset multiplies the layer's own value
      if (p === "opacity" || p === "scale") v = v * base;
      if (p === "rotate") v = v + base;
    }
    (pose as unknown as Record<string, number>)[p] = v;
  }
  // before its in the layer is not there (a cut arrives whole at inAt)
  if (frame < t.inAt + delay) return { ...pose, visible: false, opacity: 0 };
  if (t.outAt !== null && (outM.preset ?? "fade") === "cut" && frame >= t.outAt + 1) return { ...pose, visible: false, opacity: 0 };
  return pose;
};

/** the delay of unit i of n under a stagger */
export const staggerDelay = (st: Stagger | undefined, i: number, n: number): number => {
  if (!st || n <= 1) return 0;
  const order = st.from === "end" ? n - 1 - i : st.from === "center" ? Math.abs(i - (n - 1) / 2) : i;
  return Math.round(order * st.each);
};

/** the last frame anything of the layer is still moving in: its in end plus the last unit's delay */
export const settleFrame = (film: MgFilm, scene: MgScene, layer: Layer, units = 1): number => {
  const t = layerTiming(film, scene, layer);
  const st = layer.in?.stagger ?? film.defaults?.layerIn?.stagger;
  const last = st ? staggerDelay(st, units - 1, units) : 0;
  const r = resolveEase(layer.in?.ease ?? film.defaults?.layerIn?.ease, film.easings ?? {});
  const dur = r.kind === "spring" ? Math.max(t.inDur, 24) : t.inDur;
  return Math.min(t.to - 1, t.inAt + last + dur);
};
