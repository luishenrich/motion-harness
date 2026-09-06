/**
 * Where a layer is at a frame. Presets are keyframe tracks written for you
 * (rise = opacity 0 to 1 plus y from 32 to 0); explicit tracks win per
 * property. Staggered layers evaluate the same pose per unit (word, char,
 * line, item) with the unit's own delay. The result is plain numbers a
 * component turns into a style, and that a test can assert.
 */
import { resolveEase, progressOf, type Resolved } from "./easing.ts";
import type { Camera, CameraProp, EaseRef, GroupLayer, InPreset, Keyframe, Layer, MgFilm, MgScene, Motion, OutPreset, Side, Stagger, TrackProp, Tracks } from "./schema.ts";
import { CAMERA_PROPS, childrenOf, layerTiming } from "./schema.ts";

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
    // the character flip lives per character in the renderer: the layer itself arrives whole
    case "flip":
      return {};
    case "track":
      return { opacity: k(0, 1) };
    case "scramble":
      return { opacity: [{ at: 0, v: 0 }, { at: Math.min(dur, 4), v: 1, ease: "out" }] };
    case "fall":
      return { opacity: [{ at: 0, v: 0 }, { at: Math.min(dur, 5), v: 1, ease: "out" }], y: [{ at: 0, v: -dist * 1.6 }, { at: dur, v: 0, ease: m.ease ?? "bouncy" }] };
    case "line-wipe":
      return { wipe: k(0, 1) };
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
  // a scene the film view keeps alive under a continuing transition holds its layers `hold` frames longer
  if (frame < t.from || frame >= t.to + (scene.hold ?? 0)) return { ...pose, visible: false, opacity: 0 };
  const inM: Motion<InPreset> = { ...(film.defaults?.layerIn ?? {}), ...(layer.in ?? {}) };
  const outM: Motion<OutPreset> = { ...(film.defaults?.layerOut ?? {}), ...(layer.out ?? {}) };
  const inT = inTracks({ ...inM, dur: t.inDur });
  const outT = t.outAt !== null ? outTracks({ ...outM, dur: t.outDur }) : {};
  if (inM.preset === "wipe" || inM.preset === "line-wipe" || outM.preset === "wipe") pose.wipeFrom = (inM.preset === "wipe" || inM.preset === "line-wipe" ? inM.from : outM.from) ?? "left";
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

/* ---------- groups: the layer tree, and the delay a child inherits ---------- */

/** how many units a stagger splits a layer into: words, characters, lines, list items, bars, a group's children */
export const unitsOf = (l: Layer, st: Stagger | undefined = l.in?.stagger): number => {
  if (!st) return 1;
  if (l.type === "text") return st.by === "char" ? l.text.length : st.by === "line" ? l.text.split("\n").length : l.text.split(/\s+/).filter(Boolean).length;
  if (l.type === "list") return l.items.length;
  if (l.type === "bars") return l.values.length;
  if (l.type === "group") return (l.layers ?? []).length;
  return 1;
};

/** the frame each child of a group starts counting from: the group's own in plus its stagger */
export const childDelays = (film: MgFilm, scene: MgScene, group: GroupLayer, base = 0): number[] => {
  const kids = group.layers ?? [];
  const st = group.in?.stagger ?? film.defaults?.layerIn?.stagger;
  const inAt = base + layerTiming(film, scene, group).inAt;
  return kids.map((_, i) => inAt + staggerDelay(st, i, kids.length));
};

export type LayerNode = {
  layer: Layer;
  /** the ids from the scene down to this layer */
  path: string[];
  /** `card.title`: what an address says after the scene id */
  address: string;
  /** frames the layer's own timing is pushed back by the groups above it */
  delay: number;
  depth: number;
  parent?: GroupLayer;
};

/** every layer of a scene, a group before its children, each with the delay its groups give it */
export const walkLayers = (film: MgFilm, scene: MgScene, opts: { layers?: Layer[]; delay?: number; path?: string[]; parent?: GroupLayer } = {}): LayerNode[] => {
  const out: LayerNode[] = [];
  const delay = opts.delay ?? 0;
  const path = opts.path ?? [];
  for (const l of opts.layers ?? scene.layers ?? []) {
    if (!l || !l.id) continue;
    const p = [...path, l.id];
    out.push({ layer: l, path: p, address: p.join("."), delay, depth: path.length, parent: opts.parent });
    if (l.type === "group") {
      const delays = childDelays(film, scene, l, delay);
      childrenOf(l).forEach((c, i) => out.push(...walkLayers(film, scene, { layers: [c], delay: delays[i], path: p, parent: l })));
    }
  }
  return out;
};

/** the frame a layer and everything inside it has stopped moving, in scene frames */
export const settleOf = (film: MgFilm, scene: MgScene, layer: Layer, delay = 0): number => {
  const own = delay + settleFrame(film, scene, layer, unitsOf(layer));
  if (layer.type !== "group") return own;
  const delays = childDelays(film, scene, layer, delay);
  return childrenOf(layer).reduce((a, c, i) => Math.max(a, settleOf(film, scene, c, delays[i])), own);
};

/* ---------- camera: one move over the whole scene ---------- */

export type CameraPose = {
  /** a factor: 1 is the frame as it is */
  zoom: number;
  /** u pixels of travel */
  x: number;
  y: number;
  /** degrees */
  rotate: number;
  /** the point the zoom and the rotation turn around, fractions of the frame */
  focus: { x: number; y: number };
};

export const CAMERA_REST: CameraPose = { zoom: 1, x: 0, y: 0, rotate: 0, focus: { x: 0.5, y: 0.5 } };

/** the frames a camera move runs over: its own at and dur, else the whole scene */
export const cameraSpan = (cam: Camera, sceneDur: number): { at: number; dur: number } => {
  const at = Math.max(0, cam.at ?? 0);
  return { at, dur: Math.max(1, cam.dur ?? Math.max(1, sceneDur - 1 - at)) };
};

/** the tracks a camera preset writes, in frames relative to the move's start */
export const cameraTracks = (cam: Camera, dur: number): Partial<Record<CameraProp, Keyframe[]>> => {
  const ease = cam.ease ?? "linear";
  const k = (from: number, to: number): Keyframe[] => [{ at: 0, v: from }, { at: dur, v: to, ease }];
  switch (cam.preset ?? "none") {
    case "push":
      return { zoom: k(cam.from ?? 1, cam.to ?? 1.08) };
    case "pull":
      return { zoom: k(cam.from ?? 1.08, cam.to ?? 1) };
    case "pan":
      return { x: k(cam.from ?? 0, cam.to ?? 80) };
    case "tilt":
      return { y: k(cam.from ?? 0, cam.to ?? 60) };
    case "drift": {
      const d = cam.to ?? 40;
      return { x: k(cam.from ?? 0, d), y: k(0, -d * 0.6), zoom: k(1, 1.03) };
    }
    case "orbit": {
      const d = cam.to ?? 2;
      return { rotate: k(cam.from ?? 0, d), zoom: k(1, 1.04) };
    }
    default:
      return {};
  }
};

/** a seeded value in 0..1: the same seed and the same frame always give the same wobble */
export const noise = (seed: number, n: number): number => {
  let t = (Math.imul((seed | 0) + 0x9e3779b9, 0x85ebca6b) ^ Math.imul((n | 0) + 0x165667b1, 0xc2b2ae35)) >>> 0;
  t = Math.imul(t ^ (t >>> 15), 0x2545f491) >>> 0;
  return ((t ^ (t >>> 13)) >>> 0) / 4294967295;
};

/** where the camera is at a local frame: the preset, then the tracks that win over it, then the shake */
export const cameraAt = (film: MgFilm, scene: MgScene, frame: number): CameraPose => {
  const cam = scene.camera;
  if (!cam) return { ...CAMERA_REST };
  const { at, dur } = cameraSpan(cam, scene.dur);
  const preset = cameraTracks(cam, dur);
  const table = film.easings ?? {};
  const val = (p: CameraProp, base: number): number => {
    const explicit = cam.tracks?.[p];
    if (explicit?.length) return trackValue(explicit, frame, film.fps, table, 0);
    const keys = preset[p];
    return keys?.length ? trackValue(keys, frame, film.fps, table, at) : base;
  };
  const pose: CameraPose = { zoom: val("zoom", 1), x: val("x", 0), y: val("y", 0), rotate: val("rotate", 0), focus: cam.focus ?? { x: 0.5, y: 0.5 } };
  const amount = cam.shake?.amount ?? 0;
  if (amount) {
    const seed = cam.shake?.seed ?? 1;
    pose.x += (noise(seed, frame * 2) * 2 - 1) * amount;
    pose.y += (noise(seed, frame * 2 + 1) * 2 - 1) * amount;
  }
  return pose;
};

/** the frame the last camera key ends on, or null when the scene has no camera move */
export const cameraSettle = (film: MgFilm, scene: MgScene): number | null => {
  const cam = scene.camera;
  if (!cam) return null;
  const { at, dur } = cameraSpan(cam, scene.dur);
  const preset = cameraTracks(cam, dur);
  let end = -1;
  for (const p of CAMERA_PROPS) {
    const explicit = cam.tracks?.[p];
    if (explicit?.length) end = Math.max(end, ...explicit.map((k) => k.at));
    else if (preset[p]?.length) end = Math.max(end, at + dur);
  }
  return end < 0 ? null : Math.max(0, Math.min(scene.dur - 1, Math.round(end)));
};
