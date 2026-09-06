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

export type ColorRef = string; // a design token name ("ink", "accent", "brand") or a hex

export type EaseRef =
  | string // "out", "inOut", "back", "expo", "linear", "spring", "soft", "cubic-bezier(x1,y1,x2,y2)", "steps(4)"
  | { spring: { damping?: number; stiffness?: number; mass?: number; overshootClamping?: boolean } };

export type Keyframe = { at: number; v: number; ease?: EaseRef };

/** what a preset animates; explicit tracks win over the preset for the same property */
export type TrackProp = "opacity" | "x" | "y" | "scale" | "rotate" | "blur" | "progress" | "wipe" | "w" | "h";
export type Tracks = Partial<Record<TrackProp, Keyframe[]>>;

export type Stagger = { by: "word" | "char" | "line" | "item"; each: number; from?: "start" | "end" | "center" };

export type InPreset = "cut" | "fade" | "rise" | "drop" | "pop" | "slide" | "wipe" | "grow" | "blur" | "typewriter" | "mask";
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
};

export type TextLayer = LayerBase & {
  type: "text";
  /** lines split on \n; *word* renders in the accent colour */
  text: string;
  role?: "display" | "body" | "mono";
  size?: number;
  weight?: number | string;
  color?: ColorRef;
  accent?: ColorRef;
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
  shape: "rect" | "circle" | "line" | "ring";
  w?: number;
  h?: number;
  /** circle and ring: diameter */
  d?: number;
  /** line and ring */
  thickness?: number;
  radius?: number;
  fill?: ColorRef;
  stroke?: ColorRef;
  /** ring: how much of the circle is drawn, 0..1 (animate with a progress track or the grow preset) */
  progress?: number;
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
  color?: ColorRef;
  ease?: EaseRef;
};

export type BarsLayer = LayerBase & {
  type: "bars";
  values: { label: string; value: number; color?: ColorRef }[];
  max?: number;
  direction?: "horizontal" | "vertical";
  w?: number;
  h?: number;
  gap?: number;
  thickness?: number;
  color?: ColorRef;
  labelColor?: ColorRef;
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
  color?: ColorRef;
  markerColor?: ColorRef;
  gap?: number;
  maxWidth?: number;
  role?: "display" | "body" | "mono";
  align?: "left" | "center";
};

/**
 * A box of `w` x `h` u pixels at its position. The children's `at` are
 * fractions of that box, their sizes stay u pixels. The group's pose (opacity,
 * x, y, scale, rotate, blur, wipe) applies to every child with the group's
 * anchor as the transform origin; a `stagger` by item on the group's `in`
 * delays the children by their index, and a child's own `in.at` counts from
 * the group's in. Groups nest.
 */
export type GroupLayer = LayerBase & {
  type: "group";
  /** the box the children live in, u pixels */
  w?: number;
  h?: number;
  layers: Layer[];
};

export type Layer = TextLayer | ShapeLayer | ImageLayer | CounterLayer | BarsLayer | ListLayer | GroupLayer;
export type LayerType = Layer["type"];

export const LAYER_TYPES: LayerType[] = ["text", "shape", "image", "counter", "bars", "list", "group"];

/** the default box of a group, u pixels */
export const GROUP_BOX = { w: 800, h: 450 };

export const isGroup = (l: Layer): l is GroupLayer => l.type === "group";

/** the layers inside a layer: a group's own, nothing for the rest */
export const childrenOf = (l: Layer): Layer[] => (l.type === "group" ? l.layers ?? [] : []);

/** the group's box in u pixels */
export const groupBox = (l: GroupLayer): { w: number; h: number } => ({ w: l.w ?? GROUP_BOX.w, h: l.h ?? GROUP_BOX.h });

export type SceneTransition = "cut" | "fade" | { type: string; dur?: number };

/** what the camera animates over a scene; a track wins over the preset for its property */
export type CameraProp = "zoom" | "x" | "y" | "rotate";
export type CameraPreset = "push" | "pull" | "pan" | "tilt" | "drift" | "orbit" | "none";

export type Camera = {
  preset?: CameraPreset;
  /** the preset's start and end: a zoom factor for push and pull, u pixels for pan and tilt, degrees for orbit */
  from?: number;
  to?: number;
  /** the point of the frame the zoom and the rotation turn around (fractions), default the centre */
  focus?: { x: number; y: number };
  ease?: EaseRef;
  /** local frames the move runs over; default the whole scene */
  at?: number;
  dur?: number;
  /** zoom is a factor, x and y are u pixels of travel, rotate is degrees */
  tracks?: Partial<Record<CameraProp, Keyframe[]>>;
  /** a seeded, deterministic handheld wobble of `amount` u pixels */
  shake?: { amount?: number; seed?: number };
  /** move the ground with the layers (default: only the layers move) */
  ground?: boolean;
};

export const CAMERA_PRESETS: CameraPreset[] = ["push", "pull", "pan", "tilt", "drift", "orbit", "none"];
export const CAMERA_PROPS: CameraProp[] = ["zoom", "x", "y", "rotate"];

/** how a scene arrives over the one before it; the incoming scene owns it */
export type TransitionType =
  | "cut"
  | "dissolve"
  | "dip"
  | "push-left"
  | "push-right"
  | "push-up"
  | "push-down"
  | "wipe-left"
  | "wipe-right"
  | "wipe-up"
  | "wipe-down"
  | "zoom"
  | "blur";

export const TRANSITION_TYPES: TransitionType[] = ["cut", "dissolve", "dip", "push-left", "push-right", "push-up", "push-down", "wipe-left", "wipe-right", "wipe-up", "wipe-down", "zoom", "blur"];

export type MgTransition = {
  type: TransitionType;
  /** frames the handover takes */
  dur?: number;
  ease?: EaseRef;
  /** the previous scene keeps playing under the transition instead of holding its last frame */
  continue?: boolean;
};

export type MgScene = {
  id: string;
  /** frames */
  dur: number;
  ground?: ColorRef;
  enter?: SceneTransition;
  exit?: SceneTransition;
  /** how this scene arrives over the previous one */
  transition?: MgTransition;
  /** one move over the whole scene, on the layers (and the ground when `ground` is true) */
  camera?: Camera;
  layers: Layer[];
  /** set by the film view while a following scene's transition keeps this one alive; not part of the file */
  hold?: number;
  /** extra named moments beyond the layers' own <layer>In and <layer>Out */
  events?: Record<string, number>;
  /** the template this scene was made from (mh new --mograph); layers are the truth after that */
  template?: string;
  why?: string;
  /** subtitle line when no text layer speaks for the scene */
  caption?: string;
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
export const colorOf = (design: Design, ref: ColorRef | undefined, fallback = design.ink): string => {
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
