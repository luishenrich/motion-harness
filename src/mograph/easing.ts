/**
 * Easing as data. A name from the built-in table or the film's own table, a
 * css cubic-bezier, a step count, or a spring with its physics. Everything
 * resolves to a function of progress, except springs, which need the frame
 * and the fps and are evaluated by the caller with `springProgress`.
 */
import { Easing, spring, measureSpring } from "remotion";
import type { EaseRef } from "./schema.ts";

export type Resolved = { kind: "curve"; fn: (t: number) => number } | { kind: "spring"; config: { damping?: number; stiffness?: number; mass?: number; overshootClamping?: boolean } };

const BUILTIN: Record<string, EaseRef> = {
  linear: "cubic-bezier(0,0,1,1)",
  in: "cubic-bezier(0.11,0,0.5,0)",
  out: "cubic-bezier(0.16,1,0.3,1)",
  inOut: "cubic-bezier(0.65,0,0.35,1)",
  expo: "cubic-bezier(0.16,1,0.3,1)",
  quart: "cubic-bezier(0.25,1,0.5,1)",
  back: "cubic-bezier(0.34,1.56,0.64,1)",
  anticipate: "cubic-bezier(0.36,0,0.66,-0.56)",
  smooth: "cubic-bezier(0.4,0,0.2,1)",
  spring: { spring: { damping: 14, stiffness: 120, mass: 1 } },
  soft: { spring: { damping: 20, stiffness: 90, mass: 1 } },
  bouncy: { spring: { damping: 8, stiffness: 150, mass: 1 } },
  snappy: { spring: { damping: 18, stiffness: 260, mass: 0.8 } },
};

export const EASING_NAMES = Object.keys(BUILTIN);

export const resolveEase = (ref: EaseRef | undefined, table: Record<string, EaseRef> = {}, depth = 0): Resolved => {
  if (ref === undefined || ref === null) return resolveEase("out", table, depth + 1);
  if (depth > 5) return { kind: "curve", fn: (t) => t };
  if (typeof ref === "object") return { kind: "spring", config: ref.spring };
  const named = table[ref] ?? BUILTIN[ref];
  if (named !== undefined && named !== ref) return resolveEase(named, table, depth + 1);
  const cb = ref.match(/^cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)$/);
  if (cb) return { kind: "curve", fn: Easing.bezier(parseFloat(cb[1]), parseFloat(cb[2]), parseFloat(cb[3]), parseFloat(cb[4])) };
  const st = ref.match(/^steps\((\d+)\)$/);
  if (st) {
    const n = Math.max(1, parseInt(st[1], 10));
    return { kind: "curve", fn: (t) => Math.min(1, Math.floor(t * n) / n) };
  }
  return { kind: "curve", fn: (t) => t };
};

export const isKnownEase = (ref: EaseRef | undefined, table: Record<string, EaseRef> = {}): boolean => {
  if (ref === undefined) return true;
  if (typeof ref === "object") return !!ref.spring;
  if (ref in table || ref in BUILTIN) return true;
  return /^cubic-bezier\(|^steps\(/.test(ref);
};

/** progress 0..1 of a segment `dur` frames long that started `elapsed` frames ago */
export const progressOf = (r: Resolved, elapsed: number, dur: number, fps: number): number => {
  if (r.kind === "spring") return elapsed <= 0 ? 0 : spring({ frame: elapsed, fps, config: r.config, from: 0, to: 1 });
  if (dur <= 0) return elapsed >= 0 ? 1 : 0;
  return r.fn(Math.max(0, Math.min(1, elapsed / dur)));
};

/** how many frames a spring takes to settle: what the timeline counts as the layer's in duration */
export const springFrames = (r: Resolved, fps: number, fallback: number): number => (r.kind === "spring" ? measureSpring({ fps, config: r.config }) : fallback);
