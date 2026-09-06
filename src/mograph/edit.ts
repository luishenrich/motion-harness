/**
 * Hands for the film's data. Everything an agent or the editor does to a
 * film goes through here: read a value by address, set one, add or remove
 * a keyframe, add, remove, move or duplicate a scene or a layer, change a
 * duration. Addresses are `scene`, `scene.layer`, `scene.layer.path.to.prop`,
 * `design.accent`, `audio.bed.gain`, `easings.snappy`. Every change is
 * followed by a lint of the whole film, so a wrong colour name or an in
 * that ends after the scene is caught before a frame is rendered.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Camera, EaseRef, GroupLayer, Keyframe, Layer, MgFilm, MgScene, TrackProp } from "./schema.ts";
import { BUILTIN_COLORS, CAMERA_PRESETS, CAMERA_PROPS, TRANSITION_TYPES, childrenOf, groupBox, layerTiming, layerFor } from "./schema.ts";
import { isKnownEase } from "./easing.ts";
import { cameraSpan, staggerDelay, unitsOf, walkLayers } from "./pose.ts";

export type MgFinding = { level: "error" | "warn"; rule: string; where: string; message: string };

export const loadFilm = (path: string): MgFilm => {
  if (!existsSync(path)) throw new Error(`no film at ${path}`);
  return JSON.parse(readFileSync(path, "utf8")) as MgFilm;
};

export const saveFilm = (path: string, film: MgFilm) => writeFileSync(path, JSON.stringify(film, null, 2) + "\n");

/** a value typed the way JSON would type it: numbers, booleans, arrays and objects parse, everything else stays a string */
export const parseValue = (raw: string): unknown => {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return parseFloat(raw);
  if (/^[\[{"]/.test(raw)) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw;
};

export type Target = {
  kind: "film" | "design" | "defaults" | "easings" | "audio" | "scene" | "layer";
  object: Record<string, unknown>;
  path: string[];
  scene?: MgScene;
  layer?: Layer;
  /** the list the layer sits in: a scene's layers, or a group's */
  list?: Layer[];
  /** the group above the layer, when it is inside one */
  group?: GroupLayer;
  /** `card.title`: the address after the scene id */
  address?: string;
  label: string;
};

/** names a group child may not shadow: an address segment that is one of these reads as a property, not as a layer */
const LAYER_PROPS = new Set(["id", "type", "at", "anchor", "offset", "opacity", "scale", "rotate", "in", "out", "tracks", "span", "probe", "formats", "why", "layers", "w", "h", "d", "thickness", "radius", "fill", "stroke", "progress", "text", "role", "size", "weight", "color", "accent", "align", "lineHeight", "letterSpacing", "maxWidth", "uppercase", "lines", "src", "fit", "shadow", "from", "to", "format", "prefix", "suffix", "dur", "ease", "values", "max", "direction", "gap", "labelColor", "labelSize", "showValues", "items", "marker", "markerColor"]);

/** what an address points at: the object that holds the value and the remaining path inside it */
export const resolveAddress = (film: MgFilm, addr: string): Target => {
  const parts = addr.split(".").filter(Boolean);
  if (!parts.length) throw new Error("empty address");
  const head = parts[0];
  if (head === "design" || head === "defaults" || head === "easings" || head === "rules" || head === "formats") {
    (film as unknown as Record<string, unknown>)[head] ??= {};
    return { kind: head === "design" ? "design" : head === "defaults" ? "defaults" : head === "easings" ? "easings" : "film", object: (film as unknown as Record<string, Record<string, unknown>>)[head], path: parts.slice(1), label: addr };
  }
  if (head === "title" || head === "fps") return { kind: "film", object: film as unknown as Record<string, unknown>, path: parts, label: addr };
  if (head === "audio") {
    const cue = (film.audio ?? []).find((a) => a.id === parts[1]);
    if (!cue) throw new Error(`no audio cue "${parts[1]}" (have: ${(film.audio ?? []).map((a) => a.id).join(", ") || "none"})`);
    return { kind: "audio", object: cue as unknown as Record<string, unknown>, path: parts.slice(2), label: addr };
  }
  const scene = film.scenes.find((s) => s.id === head);
  if (!scene) throw new Error(`no scene "${head}" (have: ${film.scenes.map((s) => s.id).join(", ")})`);
  if (parts.length === 1) return { kind: "scene", object: scene as unknown as Record<string, unknown>, path: [], scene, label: addr };
  // walk down the layer tree as far as the address names layers: scene.card.title.size
  let list: Layer[] = scene.layers ?? [];
  let layer: Layer | undefined;
  let group: GroupLayer | undefined;
  let holder: Layer[] = list;
  let i = 1;
  while (i < parts.length) {
    if (i > 1 && LAYER_PROPS.has(parts[i])) break;
    const next = list.find((l) => l.id === parts[i]);
    if (!next) break;
    if (layer?.type === "group") group = layer;
    holder = list;
    layer = next;
    i++;
    list = childrenOf(next);
  }
  if (layer) return { kind: "layer", object: layer as unknown as Record<string, unknown>, path: parts.slice(i), scene, layer, list: holder, group, address: parts.slice(1, i).join("."), label: addr };
  return { kind: "scene", object: scene as unknown as Record<string, unknown>, path: parts.slice(1), scene, label: addr };
};

const dig = (o: Record<string, unknown>, path: string[], create: boolean): { parent: Record<string, unknown>; key: string } | null => {
  let cur: Record<string, unknown> = o;
  for (let i = 0; i < path.length - 1; i++) {
    const k = path[i];
    if (cur[k] === undefined || cur[k] === null) {
      if (!create) return null;
      cur[k] = /^\d+$/.test(path[i + 1]) ? [] : {};
    }
    cur = cur[k] as Record<string, unknown>;
  }
  return { parent: cur, key: path[path.length - 1] };
};

export const getValue = (film: MgFilm, addr: string): unknown => {
  const t = resolveAddress(film, addr);
  if (!t.path.length) return t.object;
  const d = dig(t.object, t.path, false);
  return d ? d.parent[d.key] : undefined;
};

/** set a value by address; returns the previous value */
export const setValue = (film: MgFilm, addr: string, value: unknown): { before: unknown; target: Target } => {
  const t = resolveAddress(film, addr);
  if (!t.path.length) throw new Error(`"${addr}" names a whole ${t.kind}; give it a property (${addr}.dur, ${addr}.size ...)`);
  if (t.kind === "layer" && t.path[0] === "id") throw new Error("rename a layer with mh rename, other addresses point at it");
  if (t.kind === "scene" && t.path[0] === "id") throw new Error("rename a scene with mh rename, events and cues point at it");
  const d = dig(t.object, t.path, true)!;
  const before = d.parent[d.key];
  d.parent[d.key] = value;
  return { before, target: t };
};

export const unsetValue = (film: MgFilm, addr: string): unknown => {
  const t = resolveAddress(film, addr);
  if (!t.path.length) throw new Error(`use mh remove ${addr} to remove a whole ${t.kind}`);
  const d = dig(t.object, t.path, false);
  if (!d) return undefined;
  const before = d.parent[d.key];
  if (Array.isArray(d.parent)) (d.parent as unknown as unknown[]).splice(parseInt(d.key, 10), 1);
  else delete d.parent[d.key];
  return before;
};

const TRACKS: TrackProp[] = ["opacity", "x", "y", "scale", "rotate", "blur", "progress", "wipe", "w", "h"];

/** add or replace the keyframe at `at` on a layer's track */
export const setKey = (film: MgFilm, addr: string, at: number, v: number, ease?: EaseRef): Keyframe[] => {
  const t = resolveAddress(film, addr);
  if (t.kind !== "layer" || t.path.length !== 1) throw new Error(`a keyframe address is scene.layer.prop (${TRACKS.join(", ")})`);
  const prop = t.path[0] as TrackProp;
  if (!TRACKS.includes(prop)) throw new Error(`"${prop}" is not a track; tracks are ${TRACKS.join(", ")}`);
  const layer = t.layer!;
  layer.tracks ??= {};
  const keys = (layer.tracks[prop] ??= []);
  const i = keys.findIndex((k) => k.at === at);
  const key: Keyframe = ease !== undefined ? { at, v, ease } : { at, v };
  if (i >= 0) keys[i] = { ...keys[i], ...key };
  else keys.push(key);
  keys.sort((a, b) => a.at - b.at);
  return keys;
};

export const unsetKey = (film: MgFilm, addr: string, at: number): Keyframe[] => {
  const t = resolveAddress(film, addr);
  if (t.kind !== "layer" || t.path.length !== 1) throw new Error("a keyframe address is scene.layer.prop");
  const prop = t.path[0] as TrackProp;
  const keys = t.layer!.tracks?.[prop] ?? [];
  const out = keys.filter((k) => k.at !== at);
  if (out.length) t.layer!.tracks![prop] = out;
  else if (t.layer!.tracks) delete t.layer!.tracks[prop];
  return out;
};

const place = <T>(list: T[], item: T, idOf: (t: T) => string, opts: { after?: string; before?: string }) => {
  const i = opts.after ? list.findIndex((x) => idOf(x) === opts.after) + 1 : opts.before ? list.findIndex((x) => idOf(x) === opts.before) : list.length;
  if (opts.after && i === 0) throw new Error(`no "${opts.after}" to place after`);
  if (opts.before && i < 0) throw new Error(`no "${opts.before}" to place before`);
  list.splice(i, 0, item);
};

export const addScene = (film: MgFilm, scene: MgScene, opts: { after?: string; before?: string } = {}) => {
  if (!scene.id) throw new Error("a scene needs an id");
  if (film.scenes.some((s) => s.id === scene.id)) throw new Error(`scene "${scene.id}" exists`);
  scene.layers ??= [];
  scene.dur ??= 90;
  place(film.scenes, scene, (s) => s.id, opts);
};

/** add a layer to a scene ("hook") or into a group ("hook.card") */
export const addLayer = (film: MgFilm, where: string, layer: Layer, opts: { after?: string; before?: string } = {}) => {
  if (!layer.id) throw new Error("a layer needs an id");
  if (!layer.type) throw new Error("a layer needs a type: text, shape, image, counter, bars, list, group");
  let list: Layer[];
  if (where.includes(".")) {
    const t = resolveAddress(film, where);
    if (t.kind !== "layer" || t.path.length || t.layer!.type !== "group") throw new Error(`"${where}" is not a group; a layer goes into a scene or a group`);
    const g = t.layer as GroupLayer;
    g.layers ??= [];
    list = g.layers;
  } else {
    const s = film.scenes.find((x) => x.id === where);
    if (!s) throw new Error(`no scene "${where}"`);
    s.layers ??= [];
    list = s.layers;
  }
  if (layer.type === "group") (layer as GroupLayer).layers ??= [];
  if (list.some((l) => l.id === layer.id)) throw new Error(`layer "${layer.id}" exists in ${where}`);
  place(list, layer, (l) => l.id, opts);
};

export const remove = (film: MgFilm, addr: string): "scene" | "layer" => {
  const t = resolveAddress(film, addr);
  if (t.kind === "layer" && !t.path.length) {
    const list = t.list!;
    list.splice(list.indexOf(t.layer!), 1);
    return "layer";
  }
  if (t.kind === "scene" && !t.path.length) {
    film.scenes = film.scenes.filter((s) => s !== t.scene);
    return "scene";
  }
  throw new Error(`"${addr}" is not a scene or a layer; use mh unset for a property`);
};

export const move = (film: MgFilm, addr: string, opts: { after?: string; before?: string }) => {
  const t = resolveAddress(film, addr);
  if (t.kind === "layer" && !t.path.length) {
    const list = t.list!;
    list.splice(list.indexOf(t.layer!), 1);
    place(list, t.layer!, (l) => l.id, opts);
  } else if (t.kind === "scene" && !t.path.length) {
    film.scenes = film.scenes.filter((s) => s !== t.scene);
    place(film.scenes, t.scene!, (s) => s.id, opts);
  } else throw new Error(`"${addr}" is not a scene or a layer`);
};

export const duplicate = (film: MgFilm, addr: string, as?: string): string => {
  const t = resolveAddress(film, addr);
  if (t.kind === "layer" && !t.path.length) {
    const id = as ?? `${t.layer!.id}-2`;
    const list = t.list!;
    if (list.some((l) => l.id === id)) throw new Error(`layer "${id}" exists`);
    const copy = JSON.parse(JSON.stringify(t.layer)) as Layer;
    copy.id = id;
    place(list, copy, (l) => l.id, { after: t.layer!.id });
    const parent = t.address!.split(".").slice(0, -1);
    return [t.scene!.id, ...parent, id].join(".");
  }
  if (t.kind === "scene" && !t.path.length) {
    const id = as ?? `${t.scene!.id}-2`;
    if (film.scenes.some((s) => s.id === id)) throw new Error(`scene "${id}" exists`);
    const copy = JSON.parse(JSON.stringify(t.scene)) as MgScene;
    copy.id = id;
    place(film.scenes, copy, (s) => s.id, { after: t.scene!.id });
    return id;
  }
  throw new Error(`"${addr}" is not a scene or a layer`);
};

export const rename = (film: MgFilm, addr: string, id: string) => {
  const t = resolveAddress(film, addr);
  if (!/^[a-z][a-z0-9-]*$/.test(id)) throw new Error("ids are kebab-case: letters, digits, dashes");
  if (t.kind === "layer" && !t.path.length) {
    if (t.list!.some((l) => l.id === id)) throw new Error(`layer "${id}" exists`);
    t.layer!.id = id;
  } else if (t.kind === "scene" && !t.path.length) {
    if (film.scenes.some((s) => s.id === id)) throw new Error(`scene "${id}" exists`);
    const old = t.scene!.id;
    t.scene!.id = id;
    for (const a of film.audio ?? []) if (typeof a.at === "string" && a.at.startsWith(old + ".")) a.at = id + a.at.slice(old.length);
  } else throw new Error(`"${addr}" is not a scene or a layer`);
};

/** frames a text needs on screen: 1.2 s plus a quarter second per word over four (the timeline's default rule) */
const readSeconds = (words: number) => 1.2 + Math.max(0, words - 4) * 0.25;

const KNOWN_IN = ["cut", "fade", "rise", "drop", "pop", "slide", "wipe", "grow", "blur", "typewriter", "mask"];
const KNOWN_OUT = ["cut", "fade", "sink", "lift", "shrink", "slide", "wipe", "blur"];

/** the camera of one scene: a preset that exists, easings that resolve, tracks on properties that exist and keys inside the scene */
const lintCamera = (film: MgFilm, s: MgScene, out: MgFinding[]) => {
  const c: Camera | undefined = s.camera;
  if (!c) return;
  const w = `${s.id}.camera`;
  if (c.preset && !CAMERA_PRESETS.includes(c.preset)) out.push({ level: "error", rule: "camera-preset", where: `${w}.preset`, message: `"${c.preset}" is not a camera preset (${CAMERA_PRESETS.join(", ")})` });
  if (!isKnownEase(c.ease, film.easings ?? {})) out.push({ level: "error", rule: "ease", where: `${w}.ease`, message: `"${String(c.ease)}" is not an easing` });
  for (const [prop, keys] of Object.entries(c.tracks ?? {})) {
    if (!CAMERA_PROPS.includes(prop as never)) out.push({ level: "error", rule: "camera-track", where: `${w}.tracks.${prop}`, message: `"${prop}" is not a camera track (${CAMERA_PROPS.join(", ")})` });
    for (const k of keys ?? []) {
      if (!isKnownEase(k.ease, film.easings ?? {})) out.push({ level: "error", rule: "ease", where: `${w}.tracks.${prop}@${k.at}`, message: `"${String(k.ease)}" is not an easing` });
      if (k.at > s.dur) out.push({ level: "warn", rule: "key-late", where: `${w}.tracks.${prop}@${k.at}`, message: `keyframe past the scene's ${s.dur} frames` });
    }
  }
  if (c.focus && (c.focus.x < 0 || c.focus.x > 1 || c.focus.y < 0 || c.focus.y > 1)) out.push({ level: "warn", rule: "off-frame", where: `${w}.focus`, message: `focus ${c.focus.x},${c.focus.y} is outside the frame (0..1)` });
  const span = cameraSpan(c, s.dur);
  if (span.at >= s.dur) out.push({ level: "error", rule: "camera-late", where: `${w}.at`, message: `the move starts at ${span.at}, the scene is ${s.dur} frames` });
  if (span.at + span.dur > s.dur && (c.preset ?? "none") !== "none") out.push({ level: "warn", rule: "camera-long", where: `${w}.dur`, message: `the move ends at ${span.at + span.dur}, the scene ends at ${s.dur}` });
};

/** the handover a scene declares: a type that exists, a length the two scenes can carry */
const lintTransition = (film: MgFilm, s: MgScene, out: MgFinding[]) => {
  const t = s.transition;
  if (!t) return;
  const w = `${s.id}.transition`;
  if (!TRANSITION_TYPES.includes(t.type)) out.push({ level: "error", rule: "transition", where: `${w}.type`, message: `"${t.type}" is not a transition (${TRANSITION_TYPES.join(", ")})` });
  if (!isKnownEase(t.ease, film.easings ?? {})) out.push({ level: "error", rule: "ease", where: `${w}.ease`, message: `"${String(t.ease)}" is not an easing` });
  const i = film.scenes.indexOf(s);
  const dur = t.dur ?? 12;
  if (i === 0 && t.type !== "cut") out.push({ level: "warn", rule: "transition", where: w, message: "the first scene has nothing to come over; the transition is ignored" });
  if (dur >= s.dur) out.push({ level: "error", rule: "transition-long", where: `${w}.dur`, message: `${dur} frames of handover in a ${s.dur} frame scene` });
  const prev = i > 0 ? film.scenes[i - 1] : undefined;
  if (prev && dur > prev.dur) out.push({ level: "warn", rule: "transition-long", where: `${w}.dur`, message: `${dur} frames, but "${prev.id}" is only ${prev.dur} frames long` });
};

export const lintFilm = (film: MgFilm, projectDir?: string): MgFinding[] => {
  const out: MgFinding[] = [];
  const colors = new Set<string>([...BUILTIN_COLORS, ...Object.keys(film.design?.colors ?? {})]);
  const colorOk = (c: unknown) => typeof c !== "string" || colors.has(c) || /^#[0-9a-fA-F]{3,8}$/.test(c) || /^rgba?\(/.test(c);
  if (!film.design?.ink || !film.design?.paper || !film.design?.accent) out.push({ level: "error", rule: "design", where: "design", message: "ink, paper and accent are required" });
  if (!film.scenes?.length) out.push({ level: "error", rule: "scenes", where: "film", message: "no scenes" });
  const ids = new Set<string>();
  for (const s of film.scenes ?? []) {
    const w = s.id;
    if (ids.has(s.id)) out.push({ level: "error", rule: "duplicate-id", where: w, message: "scene id used twice" });
    ids.add(s.id);
    if (!/^[a-z][a-z0-9-]*$/.test(s.id)) out.push({ level: "warn", rule: "id", where: w, message: "ids are kebab-case; addresses read better" });
    if (!(s.dur > 0)) out.push({ level: "error", rule: "dur", where: w, message: "a scene needs a duration in frames" });
    if (s.dur < 20) out.push({ level: "warn", rule: "short-scene", where: w, message: `${s.dur} frames is under 20: a viewer cannot read it` });
    if (!colorOk(s.ground)) out.push({ level: "error", rule: "color", where: `${w}.ground`, message: `"${s.ground}" is not a design colour or a hex` });
    if (!s.layers?.length) out.push({ level: "warn", rule: "empty-scene", where: w, message: "no layers: a plain ground" });
    lintCamera(film, s, out);
    lintTransition(film, s, out);
    const lids = new Set<string>();
    for (const node of walkLayers(film, s)) {
      const l = node.layer;
      const lw = `${s.id}.${node.address}`;
      if (lids.has(l.id)) out.push({ level: "error", rule: "duplicate-id", where: lw, message: "layer id used twice in this scene; ids name events and probes, a group's children included" });
      lids.add(l.id);
      if (!l.type) {
        out.push({ level: "error", rule: "type", where: lw, message: "a layer needs a type" });
        continue;
      }
      const t = layerTiming(film, s, l);
      // inside a group the layer's own in counts from the group's in
      const inAt = node.delay + t.inAt;
      const rawAt = l.in?.at ?? 0;
      if (rawAt >= s.dur || inAt >= s.dur) out.push({ level: "error", rule: "in-late", where: `${lw}.in.at`, message: `in at ${rawAt}${node.delay ? ` (frame ${inAt} after the group's ${node.delay})` : ""} is past the scene's ${s.dur} frames` });
      if (inAt + t.inDur > s.dur) out.push({ level: "warn", rule: "in-long", where: `${lw}.in`, message: `in ends at ${inAt + t.inDur}, the scene ends at ${s.dur}` });
      if (t.outAt !== null && t.outAt < inAt + t.inDur) out.push({ level: "error", rule: "out-early", where: `${lw}.out.at`, message: `out at ${t.outAt} starts before the in has finished (${inAt + t.inDur})` });
      if (l.type === "group") {
        const box = groupBox(l);
        if (!(box.w > 0) || !(box.h > 0)) out.push({ level: "error", rule: "group-box", where: lw, message: "a group needs a box: w and h in u pixels" });
        if (!childrenOf(l).length) out.push({ level: "warn", rule: "empty-group", where: lw, message: "no layers inside the group" });
        for (const [fmt, size] of Object.entries(film.formats ?? {})) {
          const u = Math.min(size.width, size.height) / 1080;
          const b = groupBox(layerFor(l, fmt) as typeof l);
          if (b.w * u > size.width + 1 || b.h * u > size.height + 1) out.push({ level: "warn", rule: "group-box", where: `${lw}.w`, message: `the ${b.w}x${b.h} u box does not fit the ${fmt} frame (${Math.round(size.width / u)}x${Math.round(size.height / u)} u)` });
        }
      }
      if (l.in?.preset && !KNOWN_IN.includes(l.in.preset)) out.push({ level: "error", rule: "preset", where: `${lw}.in.preset`, message: `"${l.in.preset}" is not an in preset (${KNOWN_IN.join(", ")})` });
      if (l.out?.preset && !KNOWN_OUT.includes(l.out.preset)) out.push({ level: "error", rule: "preset", where: `${lw}.out.preset`, message: `"${l.out.preset}" is not an out preset (${KNOWN_OUT.join(", ")})` });
      for (const [k, e] of [["in", l.in?.ease], ["out", l.out?.ease]] as const) if (!isKnownEase(e, film.easings ?? {})) out.push({ level: "error", rule: "ease", where: `${lw}.${k}.ease`, message: `"${String(e)}" is not an easing` });
      for (const [prop, keys] of Object.entries(l.tracks ?? {})) {
        if (!TRACKS.includes(prop as TrackProp)) out.push({ level: "error", rule: "track", where: `${lw}.tracks.${prop}`, message: `"${prop}" is not a track (${TRACKS.join(", ")})` });
        for (const k of keys ?? []) {
          if (!isKnownEase(k.ease, film.easings ?? {})) out.push({ level: "error", rule: "ease", where: `${lw}.tracks.${prop}@${k.at}`, message: `"${String(k.ease)}" is not an easing` });
          if (k.at > s.dur) out.push({ level: "warn", rule: "key-late", where: `${lw}.tracks.${prop}@${k.at}`, message: `keyframe past the scene's ${s.dur} frames` });
        }
      }
      const st = l.in?.stagger;
      if (st) {
        const n = unitsOf(l, st);
        const last = inAt + staggerDelay(st, n - 1, n) + t.inDur;
        if (last > s.dur) out.push({ level: "warn", rule: "stagger-long", where: `${lw}.in.stagger`, message: `the last of ${n} units arrives at ${last}, after the scene's ${s.dur} frames` });
      }
      if (l.at && (l.at.x < 0 || l.at.x > 1 || l.at.y < 0 || l.at.y > 1)) out.push({ level: "warn", rule: "off-frame", where: `${lw}.at`, message: `position ${l.at.x},${l.at.y} is outside the frame (0..1)` });
      for (const [k, c] of Object.entries(l)) if (/color|fill|stroke|accent/i.test(k) && !colorOk(c)) out.push({ level: "error", rule: "color", where: `${lw}.${k}`, message: `"${String(c)}" is not a design colour or a hex` });
      if (l.type === "text") {
        if (!l.text) out.push({ level: "warn", rule: "empty-text", where: lw, message: "no text" });
        const words = l.text.replace(/\*/g, "").split(/\s+/).filter(Boolean).length;
        const settledAt = inAt + t.inDur + (st ? staggerDelay(st, unitsOf(l, st) - 1, 99) : 0);
        const gone = t.outAt ?? s.dur;
        const secs = (gone - settledAt) / film.fps;
        if (secs < readSeconds(words)) out.push({ level: "warn", rule: "reading-time", where: lw, message: `${words} words hold ${secs.toFixed(2)} s once settled, ${readSeconds(words).toFixed(2)} s reads comfortably` });
        if (l.maxWidth !== undefined && (l.maxWidth <= 0 || l.maxWidth > 1)) out.push({ level: "warn", rule: "max-width", where: `${lw}.maxWidth`, message: "maxWidth is a fraction of the frame width (0..1)" });
      }
      if (l.type === "image" && projectDir && !existsSync(join(projectDir, "public", l.src))) out.push({ level: "error", rule: "asset", where: `${lw}.src`, message: `public/${l.src} does not exist` });
      if (l.type === "bars" && !l.values?.length) out.push({ level: "error", rule: "values", where: lw, message: "bars need values" });
      if (l.type === "list" && !l.items?.length) out.push({ level: "error", rule: "items", where: lw, message: "a list needs items" });
    }
  }
  for (const a of film.audio ?? []) if (projectDir && !existsSync(join(projectDir, a.file.startsWith("public/") ? a.file : `public/${a.file}`))) out.push({ level: "warn", rule: "asset", where: `audio.${a.id}.file`, message: `${a.file} does not exist under public/ (mh voice writes voice cues)` });
  return out;
};

/** one row per layer, a group's children indented under it: what mh layers prints */
export const describe = (film: MgFilm): { scene: string; dur: number; layer: string; type: string; at: string; in: string; out: string; text: string }[] =>
  film.scenes.flatMap((s) =>
    walkLayers(film, s).map((n) => {
      const l = n.layer;
      const t = layerTiming(film, s, l);
      const inM = { ...(film.defaults?.layerIn ?? {}), ...(l.in ?? {}) };
      const text = l.type === "text" ? l.text : l.type === "list" ? l.items.join(" | ") : l.type === "counter" ? `${l.prefix ?? ""}${l.from ?? 0}->${l.to}${l.suffix ?? ""}` : l.type === "bars" ? l.values.map((v) => `${v.label} ${v.value}`).join(", ") : l.type === "image" ? l.src : l.type === "shape" ? l.shape : l.type === "group" ? `${groupBox(l).w}x${groupBox(l).h} u, ${childrenOf(l).length} inside` : "";
      return { scene: s.id, dur: s.dur, layer: n.address, type: l.type, at: l.at ? `${l.at.x},${l.at.y}` : "0.5,0.5", in: `${inM.preset ?? "rise"} @${n.delay + t.inAt} ${t.inDur}f${inM.stagger ? ` +${inM.stagger.each}/${inM.stagger.by}` : ""}`, out: t.outAt !== null ? `${l.out?.preset ?? "fade"} @${t.outAt} ${t.outDur}f` : "", text: text.replace(/\n/g, " / ").slice(0, 60) };
    }),
  );

/* ---------- layout: keep stacked text blocks apart ---------- */

/** rough height of a layer in u pixels for one format: enough to keep stacked blocks from touching */
export const estimateHeight = (l: Layer, frameW: number, u: number): number => {
  const width = frameW / u;
  if (l.type === "text") {
    const size = l.size ?? 72;
    const lh = l.lineHeight ?? 1.1;
    const maxW = (l.maxWidth ?? (frameW < 1080 * u * 1.2 ? 0.86 : 0.78)) * width;
    const lines = l.text.split("\n").reduce((n, line) => n + Math.max(1, Math.ceil((line.replace(/\*/g, "").length * size * 0.52) / maxW)), 0);
    return lines * size * lh;
  }
  if (l.type === "counter") return (l.size ?? 160) * 1.05;
  if (l.type === "list") return l.items.length * (l.size ?? 48) * 1.2 + (l.items.length - 1) * (l.gap ?? 18);
  if (l.type === "bars") return l.h ?? ((l.direction ?? "horizontal") === "horizontal" ? 60 * l.values.length : 420);
  if (l.type === "image") return l.h ?? (l.w ?? 480) * 0.75;
  if (l.type === "shape") return l.shape === "circle" || l.shape === "ring" ? (l.d ?? 120) : l.shape === "line" ? (l.thickness ?? 4) : (l.h ?? 200);
  // a group is one block: its box, never its children
  if (l.type === "group") return groupBox(l).h;
  return 0;
};

/** vertical span [top, bottom] in frame fractions of a layer anchored at its position */
const spanOf = (l: Layer, h: number, frameH: number, u: number): [number, number] => {
  const y = l.at?.y ?? 0.5;
  const a = l.anchor ?? "center";
  const hf = (h * u) / frameH;
  const top = a.includes("top") || a === "top" ? y : a.includes("bottom") || a === "bottom" ? y - hf : y - hf / 2;
  return [top, top + hf];
};

/**
 * Stacked blocks that overlap are pushed apart, top to bottom, with a gap of 3.5 % of the frame,
 * and the stack is kept inside the safe band (8 % from the top, 10 % from the bottom). Returns the
 * layers that moved with their new y, per format. Only layers on the same column (x within 0.2)
 * are treated as a stack.
 */
export const autoLayout = (film: MgFilm, sceneId?: string): { scene: string; layer: string; format: string; from: number; to: number }[] => {
  // groups move as one block; what sits inside a group is the group's business
  const moved: { scene: string; layer: string; format: string; from: number; to: number }[] = [];
  for (const s of film.scenes) {
    if (sceneId && s.id !== sceneId) continue;
    for (const [format, size] of Object.entries(film.formats)) {
      const u = Math.min(size.width, size.height) / 1080;
      const H = size.height;
      const gap = 0.035;
      const layers = s.layers.filter((l) => l.probe !== false).map((l) => ({ base: l, l: layerFor(l, format) }));
      // stacks: layers sharing a column
      const cols: { x: number; items: typeof layers }[] = [];
      for (const it of layers) {
        const x = it.l.at?.x ?? 0.5;
        const col = cols.find((c) => Math.abs(c.x - x) < 0.2);
        if (col) col.items.push(it);
        else cols.push({ x, items: [it] });
      }
      for (const col of cols) {
        if (col.items.length < 2) continue;
        const items = col.items.map((it) => ({ ...it, h: estimateHeight(it.l, size.width, u) })).sort((a, b) => (a.l.at?.y ?? 0.5) - (b.l.at?.y ?? 0.5));
        const ys = items.map((it) => it.l.at?.y ?? 0.5);
        const spans = items.map((it, i) => spanOf({ ...it.l, at: { x: it.l.at?.x ?? 0.5, y: ys[i] } } as Layer, it.h, H, u));
        // push down
        for (let i = 1; i < items.length; i++) {
          const need = spans[i - 1][1] + gap - spans[i][0];
          if (need > 0) {
            ys[i] += need;
            spans[i] = [spans[i][0] + need, spans[i][1] + need];
          }
        }
        // keep inside the band: shift the whole stack up when the bottom runs out, never above the top
        const over = spans[spans.length - 1][1] - 0.9;
        if (over > 0) {
          const room = spans[0][0] - 0.08;
          const shift = Math.min(over, Math.max(0, room));
          for (let i = 0; i < items.length; i++) {
            ys[i] -= shift;
            spans[i] = [spans[i][0] - shift, spans[i][1] - shift];
          }
        }
        items.forEach((it, i) => {
          const y = Math.round(ys[i] * 1000) / 1000;
          const before = it.l.at?.y ?? 0.5;
          if (Math.abs(y - before) < 0.002) return;
          const isBase = format === Object.keys(film.formats)[0];
          if (isBase) it.base.at = { x: it.base.at?.x ?? 0.5, y };
          else {
            it.base.formats ??= {};
            const o = (it.base.formats[format] ??= {}) as Record<string, unknown>;
            const at = (o.at as { x?: number; y?: number } | undefined) ?? {};
            o.at = { x: at.x ?? it.base.at?.x ?? 0.5, y };
          }
          moved.push({ scene: s.id, layer: it.base.id, format, from: before, to: y });
        });
      }
    }
  }
  return moved;
};
