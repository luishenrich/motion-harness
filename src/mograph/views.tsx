/**
 * The parts of the picture the new vocabulary needs: the effects wrapper, the
 * text presets that need more than a pose (flip, track, scramble), drawn
 * shapes (path, polygon, star, arrow), a line chart, a set of rings, an
 * odometer counter and a field of particles.
 *
 * Every component here draws the inside of a layer only. The layer's box, its
 * pose and its probe attributes stay in runtime.tsx, which wraps these in its
 * own Box, so the two files can be edited without stepping on each other.
 */
import React from "react";
import type { CounterLayer, LineChartLayer, MgFilm, MgScene, ParticlesLayer, ShapeLayer, TextLayer, Layer, RingsLayer } from "./schema.ts";
import { colorOf, layerTiming } from "./schema.ts";
import { flatOf, isGradient, layerPaint, paintOf, textStyle, type ColorValue, type Gradient, type Paint } from "./colour.ts";
import { effectStyle, gradientTextOf, inProgress, scrambleText } from "./effects.ts";
import { arrowBox, arrowPath, chartGeometry, drawnProgress, odometerCells, padDigits, polygonPath, ringGeometry, starPath } from "./shapes.ts";
import { particlesAt, MAX_PARTICLES } from "./particles.ts";
import { poseAt, staggerDelay, type Pose } from "./pose.ts";
import type { Frame } from "./layout.ts";

export type VCtx = { film: MgFilm; scene: MgScene; fr: Frame; frame: number };

/** *word* spans in the accent colour, with the marker style when the layer highlights its marks */
const mark = (text: string, accent: string, key: string, markStyle?: React.CSSProperties): React.ReactNode[] =>
  text.split(/(\*[^*]+\*)/).filter((s) => s.length).map((s, i) =>
    s.startsWith("*") && s.endsWith("*") ? (
      <span key={`${key}-${i}`} style={{ color: accent, ...markStyle }}>{s.slice(1, -1)}</span>
    ) : (
      <React.Fragment key={`${key}-${i}`}>{s}</React.Fragment>
    ),
  );

/** everything a layer's effects add around its content; no effects means no extra element */
export const Fx: React.FC<{ ctx: VCtx; layer: Layer; children: React.ReactNode }> = ({ ctx, layer, children }) => {
  if (!layer.effects) return <>{children}</>;
  const g = gradientTextOf(layer.effects);
  const style: React.CSSProperties = { ...effectStyle(ctx.film, layer, ctx.fr.u) } as React.CSSProperties;
  if (g) Object.assign(style, textStyle({ css: paintOf(ctx.film.design, g, ctx.film.design.accent), gradient: true, animated: false }));
  return <div style={style}>{children}</div>;
};

/**
 * svg paints no gradient by name: a declared gradient becomes a <defs> entry
 * and the shape refers to it. A colour a track mixed is already one colour, so
 * it is used as it is; a gradient a track mixed falls back to its first stop.
 */
export const svgPaint = (film: MgFilm, value: ColorValue | undefined, css: string, fallback: string, id: string): { paint: string; def: React.ReactNode } => {
  if (!css.includes("gradient(")) return { paint: css, def: null };
  if (!isGradient(value)) return { paint: flatOf(film.design, value, fallback), def: null };
  const g = value as Gradient;
  const stops = (g.gradient.length > 1 ? g.gradient : [g.gradient[0], g.gradient[0]]).map((c, i, all) => (
    <stop key={i} offset={`${(i / (all.length - 1)) * 100}%`} stopColor={colorOf(film.design, c, fallback)} />
  ));
  if (g.radial) {
    const at = g.at ?? { x: 0.5, y: 0.5 };
    return { paint: `url(#${id})`, def: <radialGradient id={id} cx={at.x} cy={at.y} r={0.7}>{stops}</radialGradient> };
  }
  const a = ((g.angle ?? 180) * Math.PI) / 180;
  const dx = Math.sin(a), dy = -Math.cos(a);
  return { paint: `url(#${id})`, def: <linearGradient id={id} x1={0.5 - dx / 2} y1={0.5 - dy / 2} x2={0.5 + dx / 2} y2={0.5 + dy / 2}>{stops}</linearGradient> };
};

/* ---------- text presets that a pose cannot carry ---------- */

export const TEXT_FX = ["flip", "track", "scramble"] as const;
export const isTextFx = (preset: string | undefined): boolean => (TEXT_FX as readonly string[]).includes(preset ?? "");

/** flip, track and scramble: the same text, drawn from the layer's own progress */
export const TextFx: React.FC<{ ctx: VCtx; layer: TextLayer; style: React.CSSProperties; accent: string; preset: string; markStyle?: React.CSSProperties }> = ({ ctx, layer, style, accent, preset, markStyle }) => {
  const { film, scene, frame } = ctx;
  const st = layer.in?.stagger ?? film.defaults?.layerIn?.stagger;
  const plain = layer.text.replace(/\*/g, "");
  if (preset === "scramble") {
    const p = inProgress(film, scene, layer, frame);
    return <div style={style}>{scrambleText(plain, p, frame, layer.id.length)}</div>;
  }
  if (preset === "track") {
    const p = inProgress(film, scene, layer, frame);
    const extra = ((layer.in?.distance ?? 30) / 100) * (1 - p);
    const base = layer.letterSpacing ?? (layer.role === "body" ? 0 : -0.01);
    return (
      <div style={{ ...style, letterSpacing: `${base + extra}em` }}>
        {layer.text.split("\n").map((line, i) => (
          <React.Fragment key={i}>
            {i > 0 ? <br /> : null}
            {mark(line, accent, `t${i}`, markStyle)}
          </React.Fragment>
        ))}
      </div>
    );
  }
  // flip: every character turns over on its own axis
  const chars = [...plain];
  const stagger = st ?? { by: "char" as const, each: 2 };
  return (
    <div style={{ ...style, perspective: `${600 * ctx.fr.u}px` }}>
      {chars.map((c, i) => {
        const delay = staggerDelay(stagger, i, chars.length);
        const p = inProgress(film, scene, layer, frame, delay);
        if (!c.trim()) return <span key={i}>{c}</span>;
        return (
          <span key={i} style={{ display: "inline-block", transformOrigin: "50% 50%", transform: `perspective(${600 * ctx.fr.u}px) rotateX(${(1 - p) * -90}deg)`, opacity: Math.min(1, p * 2.2) }}>
            {c}
          </span>
        );
      })}
    </div>
  );
};

/* ---------- drawn shapes ---------- */

export const DRAWN_SHAPES = ["path", "polygon", "star", "arrow"] as const;
export const isDrawnShape = (shape: string | undefined): boolean => (DRAWN_SHAPES as readonly string[]).includes(shape ?? "");

/** path, polygon, star and arrow: one svg, drawn by the layer's progress with a normalised dash */
export const ShapeSvg: React.FC<{ ctx: VCtx; layer: ShapeLayer; pose: Pose; fill: string; stroke: string }> = ({ ctx, layer, pose, fill: fillCss, stroke: strokeCss }) => {
  const { film, scene, frame, fr } = ctx;
  const u = fr.u;
  const id = `${scene.id}-${layer.id}`;
  const f = svgPaint(film, layer.fill, fillCss, film.design.accent, `${id}-fill`);
  const st = svgPaint(film, layer.stroke ?? layer.fill, strokeCss, film.design.accent, `${id}-stroke`);
  const fill = f.paint;
  const stroke = st.paint;
  const defs = f.def || st.def ? <defs>{f.def}{st.def}</defs> : null;
  const drawn = drawnProgress(layer.progress, !!layer.tracks?.progress, pose.progress, inProgress(film, scene, layer, frame));
  const caps = layer.effects?.roundCaps === false ? "butt" : "round";
  let d = "";
  let w = 0;
  let h = 0;
  if (layer.shape === "path") {
    const box = layer.viewBox ?? [100, 100];
    w = (layer.w ?? box[0]) * u;
    h = (layer.h ?? box[1]) * u;
    d = typeof layer.d === "string" ? layer.d : "";
    return (
      <svg width={w} height={h} viewBox={`0 0 ${box[0]} ${box[1]}`} style={{ display: "block", overflow: "visible" }}>
        {defs}
        <path d={d} fill={layer.draw === false ? fill : "none"} stroke={stroke} strokeWidth={(layer.thickness ?? 6) * (box[0] / (layer.w ?? box[0]))} strokeLinecap={caps} strokeLinejoin="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - drawn} />
      </svg>
    );
  }
  if (layer.shape === "arrow") {
    const wu = layer.w ?? 220;
    const head = layer.head ?? 34;
    const [bw, bh] = arrowBox(wu, head, layer.thickness ?? 6);
    w = bw * u;
    h = bh * u;
    d = arrowPath(wu, head, layer.thickness ?? 6);
    return (
      <svg width={w} height={h} viewBox={`0 0 ${bw} ${bh}`} style={{ display: "block", overflow: "visible" }}>
        {defs}
        <path d={d} fill="none" stroke={stroke} strokeWidth={layer.thickness ?? 6} strokeLinecap={caps} strokeLinejoin="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - drawn} />
      </svg>
    );
  }
  const dia = typeof layer.d === "number" ? layer.d : 160;
  const size = dia + (layer.thickness ?? 6);
  w = size * u;
  h = size * u;
  d = layer.shape === "star" ? starPath(size / 2, size / 2, dia / 2, layer.sides ?? 5, layer.inner ?? 0.44) : polygonPath(size / 2, size / 2, dia / 2, layer.sides ?? 6);
  const outline = layer.draw === true;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${size} ${size}`} style={{ display: "block", overflow: "visible" }}>
      {defs}
      <path d={d} fill={outline ? "none" : fill} stroke={outline || layer.stroke ? stroke : "none"} strokeWidth={layer.thickness ?? 6} strokeLinecap={caps} strokeLinejoin="round" pathLength={1} strokeDasharray={outline ? 1 : undefined} strokeDashoffset={outline ? 1 - drawn : undefined} />
    </svg>
  );
};

/* ---------- charts ---------- */

const numberText = (v: number, format: string | undefined): string => {
  if (!format || format === "0") return Math.round(v).toString();
  if (format === "0,0") return Math.round(v).toLocaleString("en-US");
  if (format === "0%") return `${Math.round(v * 100)}%`;
  const dec = format.match(/^0\.(0+)$/);
  if (dec) return v.toFixed(dec[1].length);
  return Math.round(v).toString();
};

/** a line chart: the line drawn by the layer's progress, an optional area under it and dots on the points */
export const LineChartView: React.FC<{ ctx: VCtx; layer: LineChartLayer; pose: Pose }> = ({ ctx, layer, pose }) => {
  const { film, scene, frame, fr } = ctx;
  const u = fr.u;
  const w = (layer.w ?? 860) * u;
  const h = (layer.h ?? 380) * u;
  const geom = chartGeometry(layer.points, w, h, { min: layer.min, max: layer.max, smooth: layer.smooth });
  const drawn = drawnProgress(undefined, !!layer.tracks?.progress, pose.progress, inProgress(film, scene, layer, frame));
  const stroke = layerPaint(film, scene, layer, "stroke", frame, film.design.accent);
  const line = svgPaint(film, layer.stroke, stroke.css, film.design.accent, `${scene.id}-${layer.id}-line`);
  const fillUnder = svgPaint(film, layer.areaColor ?? layer.stroke, paintOf(film.design, layer.areaColor ?? layer.stroke ?? "accent", film.design.accent), film.design.accent, `${scene.id}-${layer.id}-area`);
  const axis = layer.axis ? colorOf(film.design, layer.axis, film.design.muted ?? "#6B6B6B") : null;
  const th = (layer.thickness ?? 8) * u;
  const labelSize = (layer.labelSize ?? 26) * u;
  const shown = drawn <= 0 ? 0 : Math.min(geom.points.length, Math.floor(drawn * (geom.points.length - 1) + 0.000001) + 1);
  return (
    <div style={{ width: w }}>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: "block", overflow: "visible" }}>
        {line.def || fillUnder.def ? <defs>{line.def}{fillUnder.def}</defs> : null}
        {layer.area ? <path d={geom.area} fill={fillUnder.paint} opacity={0.16 * drawn} /> : null}
        {axis ? <line x1={0} y1={h} x2={w} y2={h} stroke={axis} strokeWidth={2 * u} /> : null}
        <path d={geom.line} fill="none" stroke={line.paint} strokeWidth={th} strokeLinecap={layer.effects?.roundCaps === false ? "butt" : "round"} strokeLinejoin="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - drawn} />
        {layer.dots
          ? geom.points.slice(0, shown).map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={th * 0.85} fill={line.paint} />)
          : null}
      </svg>
      {layer.labels?.length ? (
        <div style={{ display: "flex", justifyContent: "space-between", width: w, marginTop: 14 * u, fontSize: labelSize, color: colorOf(film.design, layer.labelColor ?? "muted", film.design.muted ?? "#6B6B6B") }}>
          {layer.labels.map((l, i) => <span key={i}>{l}</span>)}
        </div>
      ) : null}
    </div>
  );
};

/** concentric rings, one per value, each arriving after the one outside it */
export const RingsView: React.FC<{ ctx: VCtx; layer: RingsLayer; pose: Pose }> = ({ ctx, layer, pose }) => {
  const { film, scene, frame, fr } = ctx;
  const u = fr.u;
  const dia = (layer.d ?? 360) * u;
  const th = (layer.thickness ?? 34) * u;
  const gap = (layer.gap ?? 14) * u;
  const max = layer.max ?? Math.max(...layer.values.map((v) => v.value), 1);
  const track = colorOf(film.design, layer.trackColor ?? "muted", film.design.muted ?? "#6B6B6B");
  const st = layer.in?.stagger ?? { by: "item" as const, each: 5 };
  const labelSize = (layer.labelSize ?? 30) * u;
  const labelColor = colorOf(film.design, layer.labelColor ?? "ink", film.design.ink);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 40 * u }}>
      <svg width={dia} height={dia} viewBox={`0 0 ${dia} ${dia}`} style={{ display: "block", transform: "rotate(-90deg)" }}>
        <defs>{layer.values.map((v, i) => svgPaint(film, v.color, paintOf(film.design, v.color ?? "accent", film.design.accent), film.design.accent, `${scene.id}-${layer.id}-${i}`).def)}</defs>
        {layer.values.map((v, i) => {
          const { r, c } = ringGeometry(i, dia, th, gap);
          const delay = staggerDelay(st, i, layer.values.length);
          const drawn = drawnProgress(undefined, !!layer.tracks?.progress, pose.progress, inProgress(film, scene, layer, frame, delay));
          const frac = Math.max(0, Math.min(1, v.value / max)) * drawn;
          return (
            <g key={i}>
              <circle cx={dia / 2} cy={dia / 2} r={r} fill="none" stroke={track} strokeWidth={th} opacity={0.22} />
              <circle cx={dia / 2} cy={dia / 2} r={r} fill="none" stroke={svgPaint(film, v.color, paintOf(film.design, v.color ?? "accent", film.design.accent), film.design.accent, `${scene.id}-${layer.id}-${i}`).paint} strokeWidth={th} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - frac)} />
            </g>
          );
        })}
      </svg>
      {layer.legend === false ? null : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 * u, fontSize: labelSize, color: labelColor }}>
          {layer.values.map((v, i) => {
            const p = poseAt(film, scene, layer, frame, staggerDelay(st, i, layer.values.length));
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 14 * u, opacity: p.opacity, whiteSpace: "nowrap" }}>
                <span style={{ width: labelSize * 0.55, height: labelSize * 0.55, borderRadius: "50%", background: paintOf(film.design, v.color ?? "accent", film.design.accent), display: "inline-block" }} />
                <span>{v.label}</span>
                {layer.showValues === false ? null : <span style={{ fontVariantNumeric: "tabular-nums", opacity: 0.75 }}>{numberText(v.value, layer.format)}</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

/* ---------- odometer ---------- */

/** a counter whose digits roll: one column per place, each showing its own place continuously */
export const Odometer: React.FC<{ ctx: VCtx; layer: CounterLayer; value: number; text: string; size: number; paint: Paint }> = ({ ctx, layer, value, text, size, paint }) => {
  const cells = odometerCells(value, padDigits(text, layer.pad));
  const h = size * 1.06;
  return (
    <div style={{ display: "flex", alignItems: "baseline", ...textStyle(paint) }}>
      {cells.map((c, i) =>
        c.digit ? (
          <span key={i} style={{ display: "inline-block", height: h, overflow: "hidden", lineHeight: `${h}px`, width: size * 0.62, textAlign: "center" }}>
            <span style={{ display: "block", transform: `translateY(${-(c.offset % 10) * h}px)`, willChange: "transform" }}>
              {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map((d, j) => (
                <span key={j} style={{ display: "block", height: h, lineHeight: `${h}px` }}>{d}</span>
              ))}
            </span>
          </span>
        ) : (
          <span key={i} style={{ display: "inline-block", lineHeight: `${h}px` }}>{c.char}</span>
        ),
      )}
    </div>
  );
};

/* ---------- particles ---------- */

/** a field of particles: plain divs, at most 400, placed by the frame number alone */
export const ParticlesView: React.FC<{ ctx: VCtx; layer: ParticlesLayer }> = ({ ctx, layer }) => {
  const { film, scene, frame, fr } = ctx;
  const u = fr.u;
  const boxW = layer.w ?? fr.width / u;
  const boxH = layer.h ?? fr.height / u;
  const t = layerTiming(film, scene, layer);
  const paint = paintOf(film.design, layer.color ?? "accent", film.design.accent);
  const shape = layer.shape ?? "dot";
  const parts = particlesAt({ ...layer, count: Math.min(layer.count ?? 60, MAX_PARTICLES), w: boxW, h: boxH }, Math.max(0, frame - t.inAt), { w: boxW, h: boxH });
  return (
    <div style={{ position: "relative", width: boxW * u, height: boxH * u, pointerEvents: "none" }}>
      {parts.map((p, i) => {
        const w = shape === "line" ? p.size * 0.34 : p.size;
        const h = shape === "line" ? p.size * 2.6 : shape === "confetti" ? p.size * 0.62 : p.size;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: p.x * u,
              top: p.y * u,
              width: w * u,
              height: h * u,
              borderRadius: shape === "dot" ? "50%" : shape === "line" ? w * u : 2 * u,
              background: paint,
              opacity: p.opacity,
              transform: p.rotate ? `rotate(${p.rotate}deg)` : undefined,
            }}
          />
        );
      })}
    </div>
  );
};

