/**
 * Colour as data. A colour field is a design name, a hex, or a gradient
 * (`{ gradient: ["ink", "#0F3D5E"], angle: 160 }` linear, `radial: true` with
 * an `at` for a radial one). A layer may animate any colour field with
 * `colorTracks`, a scene its ground with `groundTracks`; the values in
 * between are mixed in OKLab, which keeps a mix of two hues from going
 * through grey. Gradients crossfade: same shape and stop count mixes stop by
 * stop, anything else layers the two and fades one over the other.
 *
 * Everything here is plain functions over plain JSON, so a test asserts a
 * colour at a frame without rendering anything.
 */
import type { ColorRef, EaseRef, Keyframe, Layer, MgFilm, MgScene } from "./schema.ts";
import { colorOf, layerTiming } from "./schema.ts";
import { progressOf, resolveEase } from "./easing.ts";

export type Gradient = {
  /** two or more stops, each a design colour or a hex */
  gradient: ColorRef[];
  /** linear: degrees, 0 points up, 90 to the right (css) */
  angle?: number;
  radial?: boolean;
  /** radial: the centre, fractions of the box */
  at?: { x: number; y: number };
};

export type ColorValue = ColorRef | Gradient;

export type ColorKey = { at: number; v: ColorValue; ease?: EaseRef };

/** the colour fields a layer may animate */
export const COLOR_TRACKS = ["fill", "color", "stroke", "accent", "markerColor", "labelColor"] as const;
export type ColorTrackProp = (typeof COLOR_TRACKS)[number];
export type ColorTracks = Partial<Record<ColorTrackProp, ColorKey[]>>;

export const isGradient = (v: unknown): v is Gradient => !!v && typeof v === "object" && Array.isArray((v as Gradient).gradient);

/* ---------- rgb, hex ---------- */

export type Rgb = { r: number; g: number; b: number; a: number };

const clamp255 = (n: number) => Math.max(0, Math.min(255, Math.round(n)));

/** any hex the schema allows, plus rgb()/rgba(); unknown text falls back to black */
export const toRgb = (css: string): Rgb => {
  const s = (css ?? "").trim();
  if (s === "transparent" || s === "none") return { r: 0, g: 0, b: 0, a: 0 };
  const m = s.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?\s*\)$/i);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
  const h = s.replace("#", "");
  const full = h.length === 3 || h.length === 4 ? [...h].map((c) => c + c).join("") : h;
  if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(full)) return { r: 0, g: 0, b: 0, a: 1 };
  const n = parseInt(full.slice(0, 6), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1 };
};

export const toHex = (c: Rgb): string => "#" + [c.r, c.g, c.b].map((n) => clamp255(n).toString(16).padStart(2, "0")).join("").toUpperCase();

export const rgbaCss = (c: Rgb, alpha = c.a): string => (alpha >= 1 ? toHex(c) : `rgba(${clamp255(c.r)}, ${clamp255(c.g)}, ${clamp255(c.b)}, ${Math.max(0, Math.min(1, alpha))})`);

/* ---------- OKLab ---------- */

export type Oklab = { L: number; a: number; b: number };

const toLinear = (v: number) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (v: number) => {
  const c = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(0, v), 1 / 2.4) - 0.055;
  return c * 255;
};
const cbrt = (n: number) => Math.cbrt(n);

/** sRGB (0..255 per channel) to OKLab */
export const rgbToOklab = (c: Rgb): Oklab => {
  const r = toLinear(c.r), g = toLinear(c.g), b = toLinear(c.b);
  const l = cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
};

/** OKLab back to sRGB (0..255 per channel), clipped to the cube */
export const oklabToRgb = (o: Oklab, alpha = 1): Rgb => {
  const l_ = o.L + 0.3963377774 * o.a + 0.2158037573 * o.b;
  const m_ = o.L - 0.1055613458 * o.a - 0.0638541728 * o.b;
  const s_ = o.L - 0.0894841775 * o.a - 1.291485548 * o.b;
  const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
  return {
    r: clamp255(fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)),
    g: clamp255(fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)),
    b: clamp255(fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)),
    a: alpha,
  };
};

/** two colours mixed in OKLab; t 0 is a, t 1 is b */
export const mixHex = (a: string, b: string, t: number): string => {
  const u = Math.max(0, Math.min(1, t));
  const ra = toRgb(a), rb = toRgb(b);
  const la = rgbToOklab(ra), lb = rgbToOklab(rb);
  const mixed = oklabToRgb({ L: la.L + (lb.L - la.L) * u, a: la.a + (lb.a - la.a) * u, b: la.b + (lb.b - la.b) * u }, ra.a + (rb.a - ra.a) * u);
  return rgbaCss(mixed);
};

/* ---------- gradients ---------- */

const stopsOf = (design: MgFilm["design"], g: Gradient, fallback: string): string[] => {
  const stops = g.gradient.length ? g.gradient : [fallback];
  const list = stops.map((s) => colorOf(design, s, fallback));
  return list.length === 1 ? [list[0], list[0]] : list;
};

/** the css a gradient paints, optionally at a lower alpha (for a crossfade) */
export const gradientCss = (design: MgFilm["design"], g: Gradient, fallback: string, alpha = 1): string => {
  const stops = stopsOf(design, g, fallback).map((c) => rgbaCss(toRgb(c), toRgb(c).a * alpha));
  const list = stops.map((c, i) => `${c} ${Math.round((i / (stops.length - 1)) * 100)}%`).join(", ");
  if (g.radial) {
    const at = g.at ?? { x: 0.5, y: 0.5 };
    return `radial-gradient(circle at ${Math.round(at.x * 100)}% ${Math.round(at.y * 100)}%, ${list})`;
  }
  return `linear-gradient(${g.angle ?? 180}deg, ${list})`;
};

/** what a colour field paints: a hex for a flat colour, a css gradient function for a gradient */
export const paintOf = (design: MgFilm["design"], v: ColorValue | undefined, fallback: string): string => (isGradient(v) ? gradientCss(design, v, fallback) : colorOf(design, v, fallback));

/** a flat colour for a value: a gradient answers with its first stop (contrast, `isDark`, a css `color`) */
export const flatOf = (design: MgFilm["design"], v: ColorValue | undefined, fallback: string): string => (isGradient(v) ? colorOf(design, v.gradient[0], fallback) : colorOf(design, v, fallback));

const asGradientLike = (v: ColorValue, like: Gradient, design: MgFilm["design"], fallback: string): Gradient =>
  isGradient(v) ? v : { gradient: new Array(Math.max(2, like.gradient.length)).fill(colorOf(design, v, fallback)), angle: like.angle, radial: like.radial, at: like.at };

/**
 * Two colour values mixed. Flat to flat is an OKLab mix; a gradient against a
 * flat colour or a gradient of the same shape mixes stop by stop; two
 * gradients of different shapes are layered, the second fading in over the
 * first.
 */
export const mixPaint = (design: MgFilm["design"], a: ColorValue, b: ColorValue, t: number, fallback: string): string => {
  const u = Math.max(0, Math.min(1, t));
  if (!isGradient(a) && !isGradient(b)) return mixHex(colorOf(design, a, fallback), colorOf(design, b, fallback), u);
  if (u <= 0) return paintOf(design, a, fallback);
  if (u >= 1) return paintOf(design, b, fallback);
  const like = (isGradient(a) ? a : b) as Gradient;
  const ga = asGradientLike(a, like, design, fallback);
  const gb = asGradientLike(b, like, design, fallback);
  const sameShape = !!ga.radial === !!gb.radial && ga.gradient.length === gb.gradient.length;
  if (sameShape) {
    const sa = stopsOf(design, ga, fallback), sb = stopsOf(design, gb, fallback);
    const at = { x: (ga.at?.x ?? 0.5) + ((gb.at?.x ?? 0.5) - (ga.at?.x ?? 0.5)) * u, y: (ga.at?.y ?? 0.5) + ((gb.at?.y ?? 0.5) - (ga.at?.y ?? 0.5)) * u };
    const angle = (ga.angle ?? 180) + ((gb.angle ?? 180) - (ga.angle ?? 180)) * u;
    return gradientCss(design, { gradient: sa.map((c, i) => mixHex(c, sb[i] ?? c, u)), angle, radial: ga.radial, at }, fallback);
  }
  // different shapes: the incoming gradient fades in on top of the outgoing one
  return `${gradientCss(design, gb, fallback, u)}, ${gradientCss(design, ga, fallback)}`;
};

/* ---------- colour tracks ---------- */

/** the value of a colour track at a local frame, and whether the frame sits between two keys */
export const colorTrackAt = (film: MgFilm, keys: ColorKey[], frame: number, fallback: string, offset = 0): { css: string; between: boolean } => {
  if (!keys.length) return { css: fallback, between: false };
  const ks = [...keys].sort((a, b) => a.at - b.at);
  const f = frame - offset;
  const design = film.design;
  if (f <= ks[0].at) return { css: paintOf(design, ks[0].v, fallback), between: false };
  const last = ks[ks.length - 1];
  if (f >= last.at) return { css: paintOf(design, last.v, fallback), between: false };
  for (let i = 1; i < ks.length; i++) {
    const a = ks[i - 1], b = ks[i];
    if (f > b.at) continue;
    const r = resolveEase(b.ease, film.easings ?? {});
    const t = progressOf(r, f - a.at, b.at - a.at, film.fps);
    return { css: mixPaint(design, a.v, b.v, t, fallback), between: t > 0.001 && t < 0.999 };
  }
  return { css: paintOf(design, last.v, fallback), between: false };
};

export type Paint = { css: string; gradient: boolean; animated: boolean };

const isGradientCss = (css: string) => /gradient\(/.test(css);

/** what a layer's colour field paints at a frame: its track when it has one, else its plain value */
export const layerPaint = (film: MgFilm, scene: MgScene, layer: Layer, prop: ColorTrackProp, frame: number, fallback: string): Paint => {
  const keys = layer.colorTracks?.[prop];
  const own = (layer as unknown as Record<string, ColorValue | undefined>)[prop];
  if (!keys?.length) {
    const css = paintOf(film.design, own, fallback);
    return { css, gradient: isGradientCss(css), animated: false };
  }
  const t = layerTiming(film, scene, layer);
  const { css, between } = colorTrackAt(film, keys, frame, paintOf(film.design, own, fallback), t.from);
  return { css, gradient: isGradientCss(css), animated: between };
};

/** the ground of a scene at a frame: its `groundTracks` when it has them, else `ground` */
export const groundPaint = (film: MgFilm, scene: MgScene, frame: number): Paint => {
  const fallback = film.design.ink;
  const base = paintOf(film.design, scene.ground ?? "ink", fallback);
  if (!scene.groundTracks?.length) return { css: base, gradient: isGradientCss(base), animated: false };
  const { css, between } = colorTrackAt(film, scene.groundTracks, frame, base);
  return { css, gradient: isGradientCss(css), animated: between };
};

/**
 * One flat colour for the ground at a frame: the nearest declared key, never
 * the mix between two. It is what the contrast lint reads the text against and
 * what `isDark` decides the scene's mood from, so it must stay a colour the
 * design names.
 */
export const groundFlat = (film: MgFilm, scene: MgScene, frame: number): string => {
  const base = flatOf(film.design, scene.ground ?? "ink", film.design.ink);
  const keys = scene.groundTracks;
  if (!keys?.length) return base;
  let best = keys[0];
  for (const k of keys) if (Math.abs(k.at - frame) < Math.abs(best.at - frame)) best = k;
  return flatOf(film.design, best.v, base);
};

/** a css paint as a background: a gradient goes in `backgroundImage`, a colour in `backgroundColor` */
export const backgroundStyle = (p: Paint): { backgroundColor?: string; backgroundImage?: string } => (p.gradient ? { backgroundImage: p.css } : { backgroundColor: p.css });

/** a css paint as text: a gradient is clipped to the glyphs, a colour is the colour */
export const textStyle = (p: Paint): { color?: string; backgroundImage?: string; WebkitBackgroundClip?: string; backgroundClip?: string; WebkitTextFillColor?: string } =>
  p.gradient ? { backgroundImage: p.css, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent", WebkitTextFillColor: "transparent" } : { color: p.css };

/** does anything on this layer paint a colour the design does not name (a mid-track mix)? */
export const hasColorTracks = (layer: Layer): boolean => !!layer.colorTracks && Object.values(layer.colorTracks).some((k) => (k?.length ?? 0) > 0);
