/**
 * Motion graphics as data. A film is scenes, a scene is layers, a layer is a
 * thing on screen (text, shape, image, counter, bars, list) with a place, a
 * look, a way in, a way out and, when the presets are not enough, keyframe
 * tracks. Every value is plain JSON so an agent edits it by address
 * (`hook.line.size`), a person edits it in the editor, and the harness
 * compiles it into the timeline it already knows how to check.
 *
 * Units: positions are fractions of the frame (0..1); sizes are pixels at a
 * 1080 px short side and scale with the format (`u`); times are local frames,
 * a negative `at` counts from the scene's end.
 */

import type { ColorKey, ColorTracks, ColorValue } from "./colour.ts";
import type { Effects } from "./effects.ts";
import type { ParticleField } from "./particles.ts";

export type ColorRef = string; // a design token name ("ink", "accent", "brand") or a hex

export type EaseRef =
  | string // "out", "inOut", "back", "expo", "linear", "spring", "soft", "cubic-bezier(x1,y1,x2,y2)", "steps(4)"
  | { spring: { damping?: number; stiffness?: number; mass?: number; overshootClamping?: boolean } };

export type Keyframe = { at: number; v: number; ease?: EaseRef };

/** what a preset animates; explicit tracks win over the preset for the same property */
export type TrackProp = "opacity" | "x" | "y" | "scale" | "rotate" | "blur" | "progress" | "wipe" | "w" | "h";
export type Tracks = Partial<Record<TrackProp, Keyframe[]>>;

export type Stagger = { by: "word" | "char" | "line" | "item"; each: number; from?: "start" | "end" | "center" };

export type InPreset = "cut" | "fade" | "rise" | "drop" | "pop" | "slide" | "wipe" | "grow" | "blur" | "typewriter" | "mask" | "flip" | "track" | "scramble" | "fall" | "line-wipe";
export type OutPreset = "cut" | "fade" | "sink" | "lift" | "shrink" | "slide" | "wipe" | "blur";
export type Side = "left" | "right" | "top" | "bottom";

export type Motion<P extends string = string> = {
  preset?: P;
  /** local frame; negative counts from the scene end (out defaults to -dur) */
  at?: number;
  /** frames */
  dur?: number;
  ease?: EaseRef;
  /** slide and wipe: the side the layer comes from or leaves to */
  from?: Side;
  /** slide: pixels (u) of travel; rise/drop: default 32 */
  distance?: number;
  stagger?: Stagger;
};

export type Anchor = "center" | "left" | "right" | "top" | "bottom" | "top-left" | "top-right" | "bottom-left" | "bottom-right";

export type LayerBase = {
  id: string;
  /** fractions of the frame */
  at?: { x: number; y: number };
  anchor?: Anchor;
  /** u pixels added after the fractional position, for fine placement */
  offset?: { x?: number; y?: number };
  opacity?: number;
  scale?: number;
  rotate?: number;
  in?: Motion<InPreset>;
  out?: Motion<OutPreset>;
  tracks?: Tracks;
  /** frames the layer exists: [from, to] local; default the whole scene */
  span?: [number, number];
  /** false: the layer is not a probe target (decoration) */
  probe?: boolean;
  /** per format overrides merged over the layer: { vertical: { at: { y: 0.4 }, size: 80 } } */
  formats?: Record<string, Record<string, unknown>>;
  why?: string;
  /** colour fields animated over local frames, mixed in OKLab: { fill: [{ at: 0, v: "accent" }, { at: 30, v: "rose" }] } */
  colorTracks?: ColorTracks;
  /** shadow, glow, stroke, highlight, gradientText, blend, roundCaps */
  effects?: Effects;
};

export type TextLayer = LayerBase & {
  type: "text";
  /** lines split on \n; *word* renders in the accent colour */
  text: string;
  role?: "display" | "body" | "mono";
  size?: number;
  weight?: number | string;
  color?: ColorValue;
  accent?: ColorValue;
  align?: "left" | "center" | "right";
  lineHeight?: number;
  letterSpacing?: number;
  /** fraction of the frame width the text may take before wrapping */
  maxWidth?: number;
  uppercase?: boolean;
  /** expected line count after wrapping (lint `wrap`) */
  lines?: number;
};

export type ShapeLayer = LayerBase & {
  type: "shape";
  shape: "rect" | "circle" | "line" | "ring" | "path" | "polygon" | "star" | "arrow";
  w?: number;
  h?: number;
  /** circle, ring, polygon and star: diameter; path: the path data ("M12 4 L40 30 ...") */
  d?: number | string;
  /** line, ring, path, polygon, star and arrow */
  thickness?: number;
  radius?: number;
  fill?: ColorValue;
  stroke?: ColorValue;
  /** ring and path: how much of the outline is drawn, 0..1 (animate with a progress track or the grow preset) */
  progress?: number;
  /** path: the coordinate box the path was written in */
  viewBox?: [number, number];
  /** polygon: sides; star: spikes */
  sides?: number;
  /** star: the inner radius as a fraction of the outer one (0.44) */
  inner?: number;
  /** arrow: how wide the head is */
  head?: number;
  /** path, polygon and star: draw the outline instead of filling the shape */
  draw?: boolean;
};

export type ImageLayer = LayerBase & {
  type: "image";
  /** relative to public/ */
  src: string;
  w?: number;
  h?: number;
  fit?: "contain" | "cover";
  radius?: number;
  shadow?: boolean;
};

export type CounterLayer = LayerBase & {
  type: "counter";
  from?: number;
  to: number;
  /** "0,0" grouped, "0.0" one decimal, "0%" percent of a fraction */
  format?: string;
  prefix?: string;
  suffix?: string;
  /** frames the count takes (default: in.dur or 30) */
  dur?: number;
  role?: "display" | "body" | "mono";
  size?: number;
  weight?: number | string;
  color?: ColorValue;
  ease?: EaseRef;
  /** odometer digits: every place rolls to its number instead of being redrawn */
  roll?: boolean;
  /** leading zeros up to this many digits */
  pad?: number;
};

export type BarsLayer = LayerBase & {
  type: "bars";
  values: { label: string; value: number; color?: ColorValue }[];
  max?: number;
  direction?: "horizontal" | "vertical";
  w?: number;
  h?: number;
  gap?: number;
  thickness?: number;
  color?: ColorValue;
  labelColor?: ColorValue;
  labelSize?: number;
  showValues?: boolean;
  format?: string;
};

export type ListLayer = LayerBase & {
  type: "list";
  items: string[];
  marker?: "dot" | "number" | "check" | "dash" | "none";
  size?: number;
  weight?: number | string;
  color?: ColorValue;
  markerColor?: ColorValue;
  gap?: number;
  maxWidth?: number;
  role?: "display" | "body" | "mono";
  align?: "left" | "center";
};

/** a line chart: the values, the box they are drawn in, the line drawn by a progress track */
export type LineChartLayer = LayerBase & {
  type: "line";
  /** y values spread evenly over the box, or explicit points */
  points: (number | { x: number; y: number })[];
  w?: number;
  h?: number;
  stroke?: ColorValue;
  thickness?: number;
  /** fill the area under the line */
  area?: boolean;
  areaColor?: ColorValue;
  /** a dot on every point */
  dots?: boolean;
  smooth?: boolean;
  min?: number;
  max?: number;
  /** a baseline under the chart */
  axis?: ColorValue;
  labels?: string[];
  labelSize?: number;
  labelColor?: ColorValue;
};

/** concentric rings, one per value, each drawn to its share of `max` */
export type RingsLayer = LayerBase & {
  type: "rings";
  values: { label: string; value: number; color?: ColorValue }[];
  /** the outer diameter */
  d?: number;
  thickness?: number;
  gap?: number;
  max?: number;
  /** the unfilled part of every ring */
  trackColor?: ColorValue;
  showValues?: boolean;
  format?: string;
  labelSize?: number;
  labelColor?: ColorValue;
  /** the labels next to the rings */
  legend?: boolean;
};

/** a deterministic field of particles: the same frame draws the same picture */
export type ParticlesLayer = LayerBase & ParticleField & {
  type: "particles";
  color?: ColorValue;
};

export type Layer = TextLayer | ShapeLayer | ImageLayer | CounterLayer | BarsLayer | ListLayer | LineChartLayer | RingsLayer | ParticlesLayer;
export type LayerType = Layer["type"];

export type SceneTransition = "cut" | "fade" | { type: string; dur?: number };

export type MgScene = {
  id: string;
  /** frames */
  dur: number;
  ground?: ColorValue;
  /** the ground animated over the scene's local frames, mixed in OKLab */
  groundTracks?: ColorKey[];
  enter?: SceneTransition;
  exit?: SceneTransition;
  layers: Layer[];
  /** extra named moments beyond the layers' own <layer>In and <layer>Out */
  events?: Record<string, number>;
  /** the template this scene was made from (mh new --mograph); layers are the truth after that */
  template?: string;
  why?: string;
  /** subtitle line when no text layer speaks for the scene */
  caption?: string;
  /** the parameters the template was given (mh template add|apply); the layers stay the truth */
  params?: Record<string, unknown>;
};

export type Design = {
  ink: string;
  paper: string;
  accent: string;
  muted?: string;
  /** more named colours: { brand: "#..", warn: "#.." } */
  colors?: Record<string, string>;
  fontDisplay?: string;
  fontBody?: string;
  fontMono?: string;
  /** Google Fonts families to load; default: the three fonts above */
  fonts?: string[];
};

export type MgAudio = {
  id: string;
  kind: "music" | "sfx" | "voice";
  file: string;
  /** film time: "hook.lineIn", "9s", "f120"; a number is seconds */
  at: string | number;
  gain?: number;
  fadeOut?: number;
  loop?: boolean;
  trim?: [number, number];
  text?: string;
  license?: string;
  ramps?: { at: string | number; to: number; over?: number }[];
};

export type MgFilm = {
  title: string;
  fps: number;
  design: Design;
  formats: Record<string, { width: number; height: number }>;
  /** named easings beyond the built-ins: { snappy: "cubic-bezier(0.2,0.9,0.1,1)", bouncy: { spring: { damping: 10 } } } */
  easings?: Record<string, EaseRef>;
  /** what every scene's enter and layers' in default to */
  defaults?: { enterFrames?: number; layerIn?: Motion<InPreset>; layerOut?: Motion<OutPreset> };
  scenes: MgScene[];
  audio?: MgAudio[];
  rules?: { minSceneDur?: number; maxEnterFrames?: number; holdFrames?: [number, number]; safeZone?: Record<string, { top: number; bottom: number; x: number }> };
};

export const defineFilm = (f: MgFilm): MgFilm => f;

export const BUILTIN_COLORS = ["ink", "paper", "accent", "muted", "white", "black", "transparent"] as const;

/** a colour reference to a hex the browser paints */
export const colorOf = (design: Design, value: ColorValue | undefined, fallback = design.ink): string => {
  // a gradient stands for its first stop wherever one flat colour is needed (contrast, isDark, a css color)
  const ref = value && typeof value === "object" && Array.isArray((value as { gradient?: unknown }).gradient) ? ((value as { gradient: ColorRef[] }).gradient[0] as ColorRef | undefined) : (value as ColorRef | undefined);
  if (!ref) return fallback;
  if (ref === "ink") return design.ink;
  if (ref === "paper") return design.paper;
  if (ref === "accent") return design.accent;
  if (ref === "muted") return design.muted ?? "#6B6B6B";
  if (ref === "white") return "#FFFFFF";
  if (ref === "black") return "#000000";
  if (ref === "transparent") return "transparent";
  if (design.colors && ref in design.colors) return design.colors[ref];
  return ref;
};

/** every colour the design names: the token list for the painted-colour lint */
export const designColors = (design: Design): string[] => [design.ink, design.paper, design.accent, design.muted ?? "#6B6B6B", "#FFFFFF", "#000000", ...Object.values(design.colors ?? {})].map((c) => c.toUpperCase());

const luma = (hex: string) => {
  const m = hex.replace("#", "");
  const n = parseInt(m.length === 3 ? m.split("").map((c) => c + c).join("") : m, 16);
  return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
};
export const isDark = (hex: string) => luma(hex) < 110;

/** a local frame that may count from the end */
export const localFrame = (at: number | undefined, dur: number, fallback: number): number => {
  const v = at ?? fallback;
  return v < 0 ? Math.max(0, dur + v) : Math.min(dur - 1, v);
};

export const DEFAULT_IN: Motion<InPreset> = { preset: "rise", at: 0, dur: 14, ease: "out" };
export const DEFAULT_OUT: Motion<OutPreset> = { preset: "fade", dur: 8, ease: "in" };

/** the layer as it is in one format: format overrides merged over it */
export const layerFor = <L extends Layer>(layer: L, format: string): L => {
  const o = layer.formats?.[format];
  if (!o) return layer;
  const out = { ...layer } as Record<string, unknown>;
  for (const [k, v] of Object.entries(o)) {
    const cur = out[k];
    out[k] = cur && typeof cur === "object" && !Array.isArray(cur) && v && typeof v === "object" && !Array.isArray(v) ? { ...(cur as object), ...(v as object) } : v;
  }
  return out as L;
};

/** the resolved in and out of a layer inside its scene (frames, absolute local) */
export const layerTiming = (film: MgFilm, scene: MgScene, layer: Layer): { inAt: number; inDur: number; outAt: number | null; outDur: number; from: number; to: number } => {
  const dIn = { ...DEFAULT_IN, ...(film.defaults?.layerIn ?? {}), ...(layer.in ?? {}) };
  const from = layer.span?.[0] ?? 0;
  const to = layer.span?.[1] ?? scene.dur;
  const inAt = from + localFrame(dIn.at, to - from, 0);
  const inDur = dIn.preset === "cut" ? 0 : Math.max(0, dIn.dur ?? 14);
  const hasOut = !!layer.out || !!film.defaults?.layerOut;
  const dOut = { ...DEFAULT_OUT, ...(film.defaults?.layerOut ?? {}), ...(layer.out ?? {}) };
  const outDur = dOut.preset === "cut" ? 0 : Math.max(0, dOut.dur ?? 8);
  const outAt = hasOut ? from + localFrame(dOut.at ?? -outDur, to - from, to - from - outDur) : null;
  return { inAt, inDur, outAt, outDur, from, to };
};
