/**
 * A field of particles, computed and never simulated. Every particle gets its
 * place from a seeded generator and its motion from the frame number alone, so
 * frame 240 looks the same in every render, in every format, on every machine,
 * and no state is carried between frames. At most 400 of them: a decoration is
 * not allowed to cost a second of render time.
 */

export type ParticleShape = "dot" | "line" | "confetti";

export type ParticleField = {
  count?: number;
  /** u pixels of the box the particles live in; the frame by default */
  w?: number;
  h?: number;
  /** u pixels across */
  size?: number;
  /** u pixels per frame, upwards for dots and lines, downwards for confetti */
  speed?: number;
  /** u pixels of sideways sway */
  spread?: number;
  seed?: number;
  shape?: ParticleShape;
  /** particles fade in and out over their run instead of holding one opacity */
  fade?: boolean;
};

export type Particle = { x: number; y: number; size: number; rotate: number; opacity: number };

export const MAX_PARTICLES = 400;

/** mulberry32: a small deterministic generator, the same numbers everywhere */
export const rng = (seed: number): (() => number) => {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const wrap = (v: number, span: number) => ((v % span) + span) % span;

/** where every particle of a field is at a frame, in u pixels inside its box */
export const particlesAt = (f: ParticleField, frame: number, box: { w: number; h: number }): Particle[] => {
  const count = Math.max(0, Math.min(MAX_PARTICLES, Math.round(f.count ?? 60)));
  const W = f.w ?? box.w;
  const H = f.h ?? box.h;
  const size = f.size ?? 8;
  const speed = f.speed ?? 1.2;
  const spread = f.spread ?? 30;
  const shape = f.shape ?? "dot";
  const down = shape === "confetti" ? 1 : -1;
  const out: Particle[] = [];
  const r = rng((f.seed ?? 1) * 2654435761);
  for (let i = 0; i < count; i++) {
    const x0 = r() * W;
    const y0 = r() * H;
    const phase = r() * Math.PI * 2;
    const rate = 0.5 + r() * 1.1;
    const scale = 0.55 + r() * 0.9;
    const spin = (r() - 0.5) * 8;
    const alpha = 0.35 + r() * 0.65;
    const y = wrap(y0 + down * frame * speed * rate, H);
    const x = wrap(x0 + Math.sin(frame * 0.03 * rate + phase) * spread, W);
    const cycle = y / H;
    const opacity = f.fade === false ? alpha : alpha * Math.min(1, Math.sin(Math.PI * cycle) * 1.8 + 0.15);
    out.push({ x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, size: Math.round(size * scale * 100) / 100, rotate: shape === "confetti" ? Math.round((frame * spin + phase * 40) * 10) / 10 : 0, opacity: Math.round(opacity * 1000) / 1000 });
  }
  return out;
};
