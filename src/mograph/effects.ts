/**
 * Effects as data. `layer.effects` is a small dictionary of looks a layer may
 * wear: a shadow, a glow, an outline, a marker highlight behind the words,
 * gradient text, a blend mode, round caps. Each one is plain JSON, each one
 * turns into css here, so the renderer only spreads styles and a test can
 * assert the css string.
 *
 * Sizes are u pixels like everywhere else; the caller multiplies by the
 * frame's `u`.
 */
import type { ColorRef, Layer, MgFilm, MgScene, Motion } from "./schema.ts";
import { colorOf, layerTiming, localFrame } from "./schema.ts";
import { progressOf, resolveEase } from "./easing.ts";
import { isGradient, paintOf, toRgb, rgbaCss, type ColorValue, type Gradient } from "./colour.ts";

export type ShadowFx = { x?: number; y?: number; blur?: number; alpha?: number; color?: ColorRef };
export type GlowFx = { color?: ColorRef; blur?: number; alpha?: number };
export type StrokeFx = { color?: ColorRef; width?: number };
export type HighlightFx = {
  color?: ColorValue;
  /** when the marker sweeps; local frames, default just after the layer has settled */
  in?: Motion;
  /** u pixels of marker around the words */
  pad?: number;
  /** the whole text, or only the *marked* words */
  only?: "marks" | "all";
  radius?: number;
};

export type Effects = {
  shadow?: ShadowFx;
  glow?: GlowFx;
  stroke?: StrokeFx;
  highlight?: HighlightFx;
  /** two or more stops painted through the glyphs */
  gradientText?: ColorRef[] | Gradient;
  blend?: string;
  roundCaps?: boolean;
};

export const EFFECT_KEYS = ["shadow", "glow", "stroke", "highlight", "gradientText", "blend", "roundCaps"] as const;
export const BLEND_MODES = ["normal", "multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn", "hard-light", "soft-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity"] as const;

export const effectsOf = (layer: Layer): Effects | undefined => layer.effects;

const alphaColor = (design: MgFilm["design"], ref: ColorRef | undefined, alpha: number, fallback: string): string => rgbaCss(toRgb(colorOf(design, ref, fallback)), alpha);

/** the drop-shadow filter functions a layer's shadow and glow add, in order */
export const filterOf = (film: MgFilm, fx: Effects | undefined, u: number): string => {
  if (!fx) return "";
  const parts: string[] = [];
  if (fx.shadow) {
    const s = fx.shadow;
    parts.push(`drop-shadow(${(s.x ?? 0) * u}px ${(s.y ?? 18) * u}px ${(s.blur ?? 44) * u}px ${alphaColor(film.design, s.color ?? "black", s.alpha ?? 0.3, "#000000")})`);
  }
  if (fx.glow) {
    const g = fx.glow;
    const c = alphaColor(film.design, g.color ?? "accent", g.alpha ?? 0.6, film.design.accent);
    // two passes: a tight core and a wide halo, the way a light actually falls off
    parts.push(`drop-shadow(0 0 ${((g.blur ?? 36) / 3) * u}px ${c})`, `drop-shadow(0 0 ${(g.blur ?? 36) * u}px ${c})`);
  }
  return parts.join(" ");
};

/** the outline of a layer: a text stroke on text, a hugging ring on everything else */
export const strokeStyle = (film: MgFilm, fx: Effects | undefined, u: number, isText: boolean): Record<string, string | number> => {
  if (!fx?.stroke) return {};
  const w = (fx.stroke.width ?? 2) * u;
  const c = colorOf(film.design, fx.stroke.color ?? "ink", film.design.ink);
  return isText ? { WebkitTextStrokeWidth: `${w}px`, WebkitTextStrokeColor: c, paintOrder: "stroke fill" } : { boxShadow: `0 0 0 ${w}px ${c}` };
};

/** everything a layer's effects add to the box that holds its content */
export const effectStyle = (film: MgFilm, layer: Layer, u: number): Record<string, string | number> => {
  const fx = layer.effects;
  if (!fx) return {};
  const out: Record<string, string | number> = { ...strokeStyle(film, fx, u, layer.type === "text" || layer.type === "counter" || layer.type === "list") };
  const filter = filterOf(film, fx, u);
  if (filter) out.filter = filter;
  if (fx.blend && fx.blend !== "normal") out.mixBlendMode = fx.blend;
  return out;
};

/** the gradient `gradientText` paints through the glyphs */
export const gradientTextOf = (fx: Effects | undefined): Gradient | undefined => {
  if (!fx?.gradientText) return undefined;
  const g = fx.gradientText;
  return isGradient(g) ? g : { gradient: g as ColorRef[], angle: 90 };
};

/* ---------- the marker highlight ---------- */

/** progress 0..1 of a layer's own in at a frame (a preset that the pose does not carry, per staggered unit) */
export const inProgress = (film: MgFilm, scene: MgScene, layer: Layer, frame: number, delay = 0): number => {
  const t = layerTiming(film, scene, layer);
  const ease = layer.in?.ease ?? film.defaults?.layerIn?.ease ?? "out";
  const r = resolveEase(ease, film.easings ?? {});
  return Math.max(0, Math.min(1, progressOf(r, frame - (t.inAt + delay), t.inDur, film.fps)));
};

export type HighlightState = { progress: number; only: "marks" | "all"; style: Record<string, string | number> };

/**
 * A marker sweep behind the words: a background image the width of the
 * progress, painted behind the glyphs of the spans it is put on. It starts
 * after the layer has settled unless the effect names its own `in`.
 */
export const highlightAt = (film: MgFilm, scene: MgScene, layer: Layer, frame: number, u: number, delay = 0): HighlightState | null => {
  const hl = layer.effects?.highlight;
  if (!hl) return null;
  const t = layerTiming(film, scene, layer);
  const dur = Math.max(1, hl.in?.dur ?? 12);
  const settled = t.inAt + t.inDur;
  const at = hl.in?.at !== undefined ? t.from + localFrame(hl.in.at, t.to - t.from, 0) : Math.max(settled, Math.min(t.to - dur, settled + 4));
  const r = resolveEase(hl.in?.ease ?? "out", film.easings ?? {});
  const progress = Math.max(0, Math.min(1, progressOf(r, frame - at - delay, dur, film.fps)));
  const paint = paintOf(film.design, hl.color ?? "accent", film.design.accent);
  const pad = (hl.pad ?? 8) * u;
  const style: Record<string, string | number> = {
    backgroundImage: /gradient\(/.test(paint) ? paint : `linear-gradient(${paint}, ${paint})`,
    backgroundRepeat: "no-repeat",
    backgroundPosition: "left center",
    backgroundSize: `${progress * 100}% 100%`,
    borderRadius: (hl.radius ?? 4) * u,
    padding: `${pad * 0.25}px ${pad}px`,
    margin: `0 ${-pad}px`,
    WebkitBoxDecorationBreak: "clone",
    boxDecorationBreak: "clone",
  };
  return { progress, only: hl.only ?? "all", style };
};

/* ---------- scramble ---------- */

export const SCRAMBLE_GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&$@?/<>";

/**
 * The text mid-scramble: every character left of the progress is itself, the
 * rest are noise. The noise comes from the character's place, the frame and a
 * salt, never from a random number, so the same frame always draws the same
 * letters and two renders of a film match.
 */
export const scrambleText = (text: string, progress: number, frame: number, salt = 0): string => {
  const chars = [...text];
  const tick = Math.floor(frame / 2);
  return chars
    .map((c, i) => {
      if (!c.trim()) return c;
      if ((i + 1) / chars.length <= progress) return c;
      const n = (i * 2654435761 + tick * 40503 + (salt + 7) * 97) >>> 0;
      return SCRAMBLE_GLYPHS[n % SCRAMBLE_GLYPHS.length];
    })
    .join("");
};

/* ---------- what the lints read off an element ---------- */

/**
 * The `data-lint` value of a layer's root. `none` keeps a decoration out of
 * the layout lints, `color-track` tells the painted-colour lint that the
 * colours here are mixed between two declared stops, `no-collision` lets a
 * field of particles sit over the text it decorates.
 */
export const lintFlags = (layer: Layer): string | undefined => {
  const flags: string[] = [];
  if (layer.probe === false) flags.push("none");
  if (layer.colorTracks && Object.values(layer.colorTracks).some((k) => (k?.length ?? 0) > 0)) flags.push("color-track");
  if ((layer as { groundTracks?: unknown }).groundTracks) flags.push("color-track");
  if (layer.type === "particles") flags.push("no-collision");
  return flags.length ? flags.join(" ") : undefined;
};
