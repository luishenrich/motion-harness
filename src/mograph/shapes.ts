/**
 * Geometry as data. A polygon, a star, an arrow, a drawn path, a line chart
 * and a set of rings are all numbers before they are svg, so this module
 * turns the layer's fields into path strings and points and the renderer only
 * puts them in an <svg>. A path is drawn by its progress with a normalised
 * dash (`pathLength={1}`), so the same track drives a straight line and a
 * curve.
 *
 * All sizes are u pixels; the caller multiplies by the frame's `u`.
 */

export type Point = { x: number; y: number };

const round = (n: number) => Math.round(n * 100) / 100;

/** a regular polygon inscribed in a circle, first point at the top */
export const polygonPath = (cx: number, cy: number, r: number, sides: number, rotate = 0): string => {
  const n = Math.max(3, Math.round(sides));
  const pts: string[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2 + (rotate * Math.PI) / 180;
    pts.push(`${round(cx + Math.cos(a) * r)},${round(cy + Math.sin(a) * r)}`);
  }
  return `M${pts.join("L")}Z`;
};

/** a star of `points` spikes; `inner` is the inner radius as a fraction of the outer one */
export const starPath = (cx: number, cy: number, r: number, points: number, inner = 0.44, rotate = 0): string => {
  const n = Math.max(3, Math.round(points));
  const pts: string[] = [];
  for (let i = 0; i < n * 2; i++) {
    const rad = i % 2 === 0 ? r : r * inner;
    const a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2 + (rotate * Math.PI) / 180;
    pts.push(`${round(cx + Math.cos(a) * rad)},${round(cy + Math.sin(a) * rad)}`);
  }
  return `M${pts.join("L")}Z`;
};

/** an arrow lying along x: a shaft `w` long and a head `head` wide, drawn as one stroked path */
export const arrowPath = (w: number, head: number, thickness: number): string => {
  const y = thickness / 2 + head / 2;
  const x1 = w - head * 0.6;
  return `M${round(thickness / 2)},${round(y)} L${round(x1)},${round(y)} M${round(x1 - head * 0.5)},${round(y - head * 0.5)} L${round(x1 + head * 0.1)},${round(y)} L${round(x1 - head * 0.5)},${round(y + head * 0.5)}`;
};

export const arrowBox = (w: number, head: number, thickness: number): [number, number] => [w + thickness, head + thickness];

/* ---------- charts ---------- */

export const asPoints = (values: (number | Point)[]): Point[] => values.map((v, i) => (typeof v === "number" ? { x: i, y: v } : v));

export type ChartGeom = { line: string; area: string; points: Point[]; min: number; max: number };

/**
 * A line chart's path inside a `w` x `h` box: x spreads the points evenly (or
 * uses their own x), y maps [min, max] to the box with 0 at the bottom.
 * `smooth` rounds the corners with a Catmull-Rom curve.
 */
export const chartGeometry = (values: (number | Point)[], w: number, h: number, opts: { min?: number; max?: number; smooth?: boolean } = {}): ChartGeom => {
  const pts = asPoints(values);
  if (!pts.length) return { line: "", area: "", points: [], min: 0, max: 1 };
  const ys = pts.map((p) => p.y);
  const xs = pts.map((p) => p.x);
  const min = opts.min ?? Math.min(0, ...ys);
  const max = opts.max ?? Math.max(...ys, min + 1);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const spanX = x1 - x0 || 1;
  const at = (p: Point): Point => ({ x: round(((p.x - x0) / spanX) * w), y: round(h - ((p.y - min) / (max - min || 1)) * h) });
  const mapped = pts.map(at);
  let line = `M${mapped[0].x},${mapped[0].y}`;
  if (opts.smooth && mapped.length > 2) {
    for (let i = 0; i < mapped.length - 1; i++) {
      const p0 = mapped[Math.max(0, i - 1)], p1 = mapped[i], p2 = mapped[i + 1], p3 = mapped[Math.min(mapped.length - 1, i + 2)];
      const c1 = { x: round(p1.x + (p2.x - p0.x) / 6), y: round(p1.y + (p2.y - p0.y) / 6) };
      const c2 = { x: round(p2.x - (p3.x - p1.x) / 6), y: round(p2.y - (p3.y - p1.y) / 6) };
      line += ` C${c1.x},${c1.y} ${c2.x},${c2.y} ${p2.x},${p2.y}`;
    }
  } else {
    for (const p of mapped.slice(1)) line += ` L${p.x},${p.y}`;
  }
  const area = `${line} L${mapped[mapped.length - 1].x},${round(h)} L${mapped[0].x},${round(h)} Z`;
  return { line, area, points: mapped, min, max };
};

/** one ring of a set of concentric rings: its radius and how long its circle is */
export const ringGeometry = (i: number, d: number, thickness: number, gap: number): { r: number; c: number } => {
  const r = Math.max(thickness / 2, (d - thickness) / 2 - i * (thickness + gap));
  return { r, c: 2 * Math.PI * r };
};

/**
 * How much of an outline is drawn at a frame: an explicit `progress` (or a
 * progress track) wins, otherwise the layer's own in draws it. The same number
 * drives a path, an arrow, a ring and a chart line.
 */
export const drawnProgress = (explicit: number | undefined, tracked: boolean, poseProgress: number, inProgress: number): number => {
  const v = explicit !== undefined || tracked ? (explicit ?? 1) * poseProgress : inProgress;
  return Math.max(0, Math.min(1, v));
};

/* ---------- odometer ---------- */

export type OdometerCell = { char: string; digit: boolean; offset: number };

/** the integer part of a formatted number padded with leading zeros to `pad` digits */
export const padDigits = (text: string, pad: number | undefined): string => {
  if (!pad) return text;
  const m = text.match(/\d[\d,]*/);
  if (!m) return text;
  const digits = m[0].replace(/,/g, "");
  if (digits.length >= pad) return text;
  return text.slice(0, m.index!) + "0".repeat(pad - digits.length) + m[0] + text.slice(m.index! + m[0].length);
};

/**
 * The columns of an odometer. The text is the formatted final number, so the
 * column count never changes while it counts; every digit column shows the
 * current value at its place, continuously, so the digits roll.
 */
export const odometerCells = (value: number, text: string): OdometerCell[] => {
  const chars = [...text];
  const places: number[] = [];
  let p = 0;
  for (let i = chars.length - 1; i >= 0; i--) {
    if (/\d/.test(chars[i])) {
      places[i] = p;
      p++;
    } else places[i] = -1;
  }
  const v = Math.max(0, value);
  return chars.map((char, i) => {
    if (places[i] < 0) return { char, digit: false, offset: 0 };
    const scaled = v / Math.pow(10, places[i]);
    // the column above the last one rolls only while the one below it wraps
    const offset = places[i] === 0 ? scaled % 10 : Math.floor(scaled) % 10 + (scaled % 1 > 0.9 ? (scaled % 1 - 0.9) * 10 : 0);
    return { char, digit: true, offset: Math.max(0, offset) };
  });
};
