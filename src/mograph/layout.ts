/**
 * Where things go. Positions are fractions of the frame, sizes are u pixels
 * (a 1080 px short side is 1 u per px), anchors say which point of the box
 * sits at the position. One layer description therefore works in wide and
 * vertical; a format override adjusts what must differ.
 */
import type { Anchor, Layer, MgFilm } from "./schema.ts";

export type Frame = { width: number; height: number; format: string; u: number };

export const frameFor = (film: MgFilm, format: string): Frame => {
  const f = film.formats[format] ?? { width: 1920, height: 1080 };
  return { width: f.width, height: f.height, format, u: Math.min(f.width, f.height) / 1080 };
};

/** css for a box anchored at the layer's position: left/top plus the translate that moves the anchor point there */
export const placement = (layer: Layer, fr: Frame): { left: number; top: number; translate: string; textAlign: "left" | "center" | "right" } => {
  const at = layer.at ?? { x: 0.5, y: 0.5 };
  const anchor: Anchor = layer.anchor ?? "center";
  const ox = (layer.offset?.x ?? 0) * fr.u;
  const oy = (layer.offset?.y ?? 0) * fr.u;
  const left = at.x * fr.width + ox;
  const top = at.y * fr.height + oy;
  const tx = anchor.includes("left") || anchor === "left" ? 0 : anchor.includes("right") || anchor === "right" ? -100 : -50;
  const ty = anchor.includes("top") || anchor === "top" ? 0 : anchor.includes("bottom") || anchor === "bottom" ? -100 : -50;
  const textAlign = tx === 0 ? "left" : tx === -100 ? "right" : "center";
  return { left, top, translate: `translate(${tx}%, ${ty}%)`, textAlign };
};

/** the default width a text block may take, as a fraction of the frame */
export const defaultMaxWidth = (fr: Frame) => (fr.width < fr.height ? 0.86 : 0.78);

/** a safe area: content should stay inside these u pixel insets (platform chrome) */
export const safeInsets = (fr: Frame) => (fr.width < fr.height ? { top: 220 * fr.u, bottom: 320 * fr.u, x: 64 * fr.u } : { top: 48 * fr.u, bottom: 64 * fr.u, x: 96 * fr.u });
