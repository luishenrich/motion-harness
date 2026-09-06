/**
 * The components that draw a motion graphics film from its data. One
 * component per layer type, one scene component that paints the ground and
 * places the layers, one film component that sequences the scenes. Imports
 * the Remotion API, so it renders under the native engine (the shim) and
 * under Remotion alike. Every layer root carries data-probe (its id) and
 * data-mg ("scene.layer") so the probe, the lints and the editor find it.
 */
import React from "react";
import { AbsoluteFill, Img, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { BarsLayer, CounterLayer, ImageLayer, Layer, LineChartLayer, ListLayer, MgFilm, MgScene, ParticlesLayer, RingsLayer, ShapeLayer, TextLayer } from "./schema.ts";
import { colorOf, layerFor, layerTiming } from "./schema.ts";
import { poseAt, staggerDelay, type Pose } from "./pose.ts";
import { defaultMaxWidth, frameFor, placement, type Frame } from "./layout.ts";
import { backgroundStyle, groundFlat, groundPaint, layerPaint, paintOf, textStyle } from "./colour.ts";
import { highlightAt, lintFlags } from "./effects.ts";
import { Fx, LineChartView, Odometer, ParticlesView, RingsView, ShapeSvg, TextFx, isDrawnShape, isTextFx } from "./views.tsx";

const fontStack = (family: string | undefined, fallback: string) => (family ? `'${family}', ${fallback}` : fallback);
const SANS = "-apple-system, 'Helvetica Neue', Helvetica, Arial, sans-serif";
const MONO = "ui-monospace, Menlo, Consolas, monospace";

const fontFor = (film: MgFilm, role: "display" | "body" | "mono" | undefined) => (role === "mono" ? fontStack(film.design.fontMono, MONO) : role === "body" ? fontStack(film.design.fontBody ?? film.design.fontDisplay, SANS) : fontStack(film.design.fontDisplay, SANS));

export const fontsUrl = (film: MgFilm): string => {
  const fams = film.design.fonts ?? [film.design.fontDisplay, film.design.fontBody, film.design.fontMono].filter((f): f is string => !!f);
  if (!fams.length) return "";
  return `https://fonts.googleapis.com/css2?${[...new Set(fams)].map((f) => `family=${encodeURIComponent(f).replace(/%20/g, "+")}:wght@400;500;600;700;800`).join("&")}&display=swap`;
};

/**
 * css transform and filter for a pose. The order is place, move, scale, then
 * (in Box) the effects, then rotate: a shadow or a glow is drawn in the
 * layer's upright frame, so turning a layer does not turn its light.
 */
const poseStyle = (p: Pose, fr: Frame): React.CSSProperties => {
  const parts: string[] = [];
  if (p.x || p.y) parts.push(`translate(${p.x * fr.u}px, ${p.y * fr.u}px)`);
  if (p.scale !== 1) parts.push(`scale(${p.scale})`);
  if (p.rotate) parts.push(`rotate(${p.rotate}deg)`);
  const s: React.CSSProperties = { opacity: Math.max(0, Math.min(1, p.opacity)) };
  if (parts.length) s.transform = parts.join(" ");
  if (p.blur > 0.05) s.filter = `blur(${p.blur * fr.u}px)`;
  if (p.wipe < 1) {
    const r = (1 - p.wipe) * 100;
    s.clipPath = p.wipeFrom === "right" ? `inset(0 0 0 ${r}%)` : p.wipeFrom === "top" ? `inset(0 0 ${r}% 0)` : p.wipeFrom === "bottom" ? `inset(${r}% 0 0 0)` : `inset(0 ${r}% 0 0)`;
  }
  return s;
};

type Ctx = { film: MgFilm; scene: MgScene; fr: Frame; frame: number };

/** the outer box of every layer: position, anchor, pose; children draw the content */
const Box: React.FC<{ ctx: Ctx; layer: Layer; pose: Pose; children: React.ReactNode; extra?: React.CSSProperties; lines?: number }> = ({ ctx, layer, pose, children, extra, lines }) => {
  const pl = placement(layer, ctx.fr);
  const base: React.CSSProperties = { position: "absolute", left: pl.left, top: pl.top, transform: pl.translate, textAlign: pl.textAlign, ...extra };
  return (
    <div data-probe={layer.probe === false ? undefined : layer.id} data-mg={`${ctx.scene.id}.${layer.id}`} data-lines={lines} data-lint={lintFlags(layer)} style={{ ...base, visibility: pose.visible ? "visible" : "hidden" }}>
      <div style={{ ...poseStyle({ ...pose, rotate: 0 }, ctx.fr), transformOrigin: "50% 50%" }}>
        <Fx ctx={ctx} layer={layer}>
          {pose.rotate ? <div style={{ transform: `rotate(${pose.rotate}deg)`, transformOrigin: "50% 50%" }}>{children}</div> : children}
        </Fx>
      </div>
    </div>
  );
};

const splitUnits = (text: string, by: "word" | "char" | "line" | "item" | undefined): { units: string[]; joiner: string; lines: boolean } => {
  if (by === "line") return { units: text.split("\n"), joiner: "\n", lines: true };
  if (by === "char") return { units: [...text.replace(/\*/g, "")], joiner: "", lines: false };
  if (by === "word") return { units: text.split(/(\s+)/).filter((w) => w.length), joiner: "", lines: false };
  return { units: [text], joiner: "", lines: false };
};

/** *word* spans in the accent colour */
const marked = (text: string, accent: string, key: string, markStyle?: React.CSSProperties): React.ReactNode[] =>
  text.split(/(\*[^*]+\*)/).filter((s) => s.length).map((s, i) => (s.startsWith("*") && s.endsWith("*") ? <span key={`${key}-${i}`} style={{ color: accent, ...markStyle }}>{s.slice(1, -1)}</span> : <React.Fragment key={`${key}-${i}`}>{s}</React.Fragment>));

const TextView: React.FC<{ ctx: Ctx; layer: TextLayer }> = ({ ctx, layer }) => {
  const { film, fr, frame } = ctx;
  const size = (layer.size ?? 72) * fr.u;
  const paint = layerPaint(film, ctx.scene, layer, "color", frame, film.design.ink);
  const accentPaint = layerPaint(film, ctx.scene, layer, "accent", frame, film.design.accent);
  const accent = accentPaint.gradient ? colorOf(film.design, layer.accent ?? "accent", film.design.accent) : accentPaint.css;
  const st = layer.in?.stagger ?? film.defaults?.layerIn?.stagger;
  const whole = poseAt(film, ctx.scene, layer, frame);
  const width = (layer.maxWidth ?? defaultMaxWidth(fr)) * fr.width;
  const style: React.CSSProperties = { fontFamily: fontFor(film, layer.role), fontSize: size, fontWeight: layer.weight ?? (layer.role === "body" ? 400 : 700), lineHeight: layer.lineHeight ?? 1.1, letterSpacing: layer.letterSpacing !== undefined ? `${layer.letterSpacing}em` : layer.role === "display" || !layer.role ? "-0.01em" : undefined, ...textStyle(paint), width, whiteSpace: "pre-wrap", textTransform: layer.uppercase ? "uppercase" : undefined, textAlign: layer.align ?? placement(layer, fr).textAlign, margin: 0 };
  const preset = layer.in?.preset ?? film.defaults?.layerIn?.preset;
  const typewriter = preset === "typewriter";
  // the wrap lint expects this many lines: the layer's own count, else the explicit line breaks
  const expectLines = layer.lines ?? layer.text.split("\n").length;
  // a marker sweeps behind the words (or only behind the *marked* ones)
  const hl = highlightAt(film, ctx.scene, layer, frame, fr.u);
  const markStyle = hl && hl.only === "marks" ? (hl.style as React.CSSProperties) : undefined;
  const lineStyle = hl && hl.only === "all" ? (hl.style as React.CSSProperties) : undefined;
  if (isTextFx(preset)) {
    return (
      <Box ctx={ctx} layer={layer} pose={whole} lines={expectLines}>
        <TextFx ctx={ctx} layer={layer} style={style} accent={accent} preset={preset!} markStyle={markStyle} />
      </Box>
    );
  }
  if (typewriter) {
    const chars = [...layer.text.replace(/\*/g, "")];
    const n = Math.round(whole.progress * chars.length);
    return (
      <Box ctx={ctx} layer={layer} pose={{ ...whole, progress: 1 }} lines={expectLines}>
        <div style={style}>{chars.slice(0, n).join("")}<span style={{ opacity: whole.progress < 1 && Math.floor(frame / 8) % 2 === 0 ? 1 : 0 }}>|</span></div>
      </Box>
    );
  }
  if (!st) {
    return (
      <Box ctx={ctx} layer={layer} pose={whole} lines={expectLines}>
        <div style={style}>{layer.text.split("\n").map((line, i) => <React.Fragment key={i}>{i > 0 ? <br /> : null}{lineStyle ? <span style={lineStyle}>{marked(line, accent, `l${i}`, markStyle)}</span> : marked(line, accent, `l${i}`, markStyle)}</React.Fragment>)}</div>
      </Box>
    );
  }
  const { units, lines } = splitUnits(layer.text, st.by);
  const mask = (layer.in?.preset ?? film.defaults?.layerIn?.preset) === "mask";
  return (
    <Box ctx={ctx} layer={layer} pose={{ ...whole, opacity: whole.visible ? 1 : 0, x: 0, y: 0, scale: 1, blur: 0, wipe: 1 }} lines={expectLines}>
      <div style={style}>
        {units.map((u, i) => {
          const p = poseAt(film, ctx.scene, layer, frame, staggerDelay(st, i, units.length));
          // a line unit wraps inside its own row; a word or a character never wraps
          const body = lineStyle ? <span style={lineStyle}>{marked(u, accent, `u${i}`, markStyle)}</span> : marked(u, accent, `u${i}`, markStyle);
          const inner = <span style={{ display: lines ? "block" : "inline-block", ...poseStyle(p, fr), whiteSpace: lines ? "pre-wrap" : "pre" }}>{body}</span>;
          if (lines) return <div key={i} style={{ overflow: mask ? "hidden" : undefined }}>{inner}</div>;
          if (/^\s+$/.test(u)) return <span key={i}>{u}</span>;
          return mask ? <span key={i} style={{ display: "inline-block", overflow: "hidden", verticalAlign: "bottom" }}>{inner}</span> : <React.Fragment key={i}>{inner}</React.Fragment>;
        })}
      </div>
    </Box>
  );
};

const ShapeView: React.FC<{ ctx: Ctx; layer: ShapeLayer }> = ({ ctx, layer }) => {
  const { film, fr, frame } = ctx;
  const p = poseAt(film, ctx.scene, layer, frame);
  const fill = layerPaint(film, ctx.scene, layer, "fill", frame, film.design.accent).css;
  const strokePaint = layer.stroke ? layerPaint(film, ctx.scene, layer, "stroke", frame, film.design.ink).css : fill;
  const u = fr.u;
  if (isDrawnShape(layer.shape)) {
    return (
      <Box ctx={ctx} layer={layer} pose={p}>
        <ShapeSvg ctx={ctx} layer={layer} pose={p} fill={fill} stroke={strokePaint} />
      </Box>
    );
  }
  if (layer.shape === "circle") {
    const d = (typeof layer.d === "number" ? layer.d : 120) * u;
    return <Box ctx={ctx} layer={layer} pose={p}><div style={{ width: d, height: d, borderRadius: "50%", background: fill, transform: `scale(${p.w}, ${p.h})` }} /></Box>;
  }
  if (layer.shape === "ring") {
    const d = (typeof layer.d === "number" ? layer.d : 160) * u, th = (layer.thickness ?? 12) * u;
    const prog = Math.max(0, Math.min(1, (layer.progress ?? 1) * p.progress));
    const r = (d - th) / 2, c = 2 * Math.PI * r;
    return (
      <Box ctx={ctx} layer={layer} pose={p}>
        <svg width={d} height={d} viewBox={`0 0 ${d} ${d}`} style={{ display: "block", transform: "rotate(-90deg)" }}>
          {layer.stroke ? <circle cx={d / 2} cy={d / 2} r={r} fill="none" stroke={colorOf(film.design, layer.stroke)} strokeWidth={th} opacity={0.25} /> : null}
          <circle cx={d / 2} cy={d / 2} r={r} fill="none" stroke={fill} strokeWidth={th} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - prog)} />
        </svg>
      </Box>
    );
  }
  if (layer.shape === "line") {
    const w = (layer.w ?? 240) * u, th = (layer.thickness ?? 4) * u;
    return <Box ctx={ctx} layer={layer} pose={p}><div style={{ width: w, height: th, background: fill, borderRadius: th / 2, transform: `scaleX(${p.w})`, transformOrigin: "left center" }} /></Box>;
  }
  const w = (layer.w ?? 320) * u, h = (layer.h ?? 200) * u;
  return <Box ctx={ctx} layer={layer} pose={p}><div style={{ width: w, height: h, background: fill, borderRadius: (layer.radius ?? 0) * u, border: layer.stroke ? `${(layer.thickness ?? 2) * u}px solid ${colorOf(film.design, layer.stroke)}` : undefined, transform: `scale(${p.w}, ${p.h})`, transformOrigin: "left center", boxSizing: "border-box" }} /></Box>;
};

const ImageView: React.FC<{ ctx: Ctx; layer: ImageLayer }> = ({ ctx, layer }) => {
  const { film, fr, frame } = ctx;
  const p = poseAt(film, ctx.scene, layer, frame);
  const w = layer.w ? layer.w * fr.u : undefined, h = layer.h ? layer.h * fr.u : undefined;
  return (
    <Box ctx={ctx} layer={layer} pose={p}>
      <Img src={staticFile(layer.src)} style={{ width: w ?? (h ? "auto" : 480 * fr.u), height: h ?? "auto", objectFit: layer.fit ?? "contain", borderRadius: (layer.radius ?? 0) * fr.u, boxShadow: layer.shadow ? `0 ${24 * fr.u}px ${64 * fr.u}px rgba(0,0,0,0.28)` : undefined, display: "block" }} />
    </Box>
  );
};

const formatNumber = (v: number, format: string | undefined): string => {
  if (!format || format === "0") return Math.round(v).toString();
  if (format === "0,0") return Math.round(v).toLocaleString("en-US");
  if (format === "0%") return `${Math.round(v * 100)}%`;
  const dec = format.match(/^0\.(0+)$/);
  if (dec) return v.toFixed(dec[1].length);
  const grp = format.match(/^0,0\.(0+)$/);
  if (grp) return v.toLocaleString("en-US", { minimumFractionDigits: grp[1].length, maximumFractionDigits: grp[1].length });
  return Math.round(v).toString();
};

const CounterView: React.FC<{ ctx: Ctx; layer: CounterLayer }> = ({ ctx, layer }) => {
  const { film, fr, frame } = ctx;
  const p = poseAt(film, ctx.scene, layer, frame);
  const t = layerTiming(film, ctx.scene, layer);
  const dur = layer.dur ?? Math.max(t.inDur, 30);
  const raw = interpolate(frame, [t.inAt, t.inAt + dur], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  // an explicit progress track wins; otherwise the count eases out over `dur`
  const prog = layer.tracks?.progress ? p.progress : 1 - Math.pow(1 - raw, 3);
  const v = (layer.from ?? 0) + ((layer.to ?? 0) - (layer.from ?? 0)) * prog;
  const paint = layerPaint(film, ctx.scene, layer, "color", frame, film.design.ink);
  const size = (layer.size ?? 160) * fr.u;
  const box: React.CSSProperties = { fontFamily: fontFor(film, layer.role), fontSize: size, fontWeight: layer.weight ?? 800, lineHeight: 1, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em", whiteSpace: "nowrap" };
  // an odometer rolls its digits: only whole numbers, the decimals stay with the plain counter
  if (layer.roll && !/\./.test(layer.format ?? "")) {
    const scale = layer.format === "0%" ? 100 : 1;
    return (
      <Box ctx={ctx} layer={layer} pose={p}>
        <div style={box}>
          <Odometer ctx={ctx} layer={layer} value={v * scale} text={`${layer.prefix ?? ""}${formatNumber(layer.to ?? 0, layer.format)}${layer.suffix ?? ""}`} size={size} paint={paint} />
        </div>
      </Box>
    );
  }
  return (
    <Box ctx={ctx} layer={layer} pose={p}>
      <div style={{ ...box, ...textStyle(paint) }}>
        {layer.prefix ?? ""}{formatNumber(v, layer.format)}{layer.suffix ?? ""}
      </div>
    </Box>
  );
};

const BarsView: React.FC<{ ctx: Ctx; layer: BarsLayer }> = ({ ctx, layer }) => {
  const { film, fr, frame } = ctx;
  const u = fr.u;
  const horizontal = (layer.direction ?? "horizontal") === "horizontal";
  const max = layer.max ?? Math.max(...layer.values.map((v) => v.value), 1);
  const w = (layer.w ?? (horizontal ? 900 : 700)) * u, h = (layer.h ?? (horizontal ? 60 * layer.values.length : 420)) * u;
  const th = (layer.thickness ?? (horizontal ? 36 : 72)) * u;
  const gap = (layer.gap ?? 22) * u;
  const st = layer.in?.stagger ?? { by: "item" as const, each: 4 };
  const whole = poseAt(film, ctx.scene, layer, frame);
  const labelSize = (layer.labelSize ?? 28) * u;
  const labelColor = colorOf(film.design, layer.labelColor ?? layer.color ?? "ink", film.design.ink);
  return (
    <Box ctx={ctx} layer={layer} pose={{ ...whole, w: 1, h: 1 }}>
      <div style={{ width: w, height: h, display: "flex", flexDirection: horizontal ? "column" : "row", justifyContent: "space-between", alignItems: horizontal ? "stretch" : "flex-end", gap, fontFamily: fontFor(film, "body"), color: labelColor, fontSize: labelSize }}>
        {layer.values.map((v, i) => {
          const p = poseAt(film, ctx.scene, layer, frame, staggerDelay(st, i, layer.values.length));
          const frac = Math.max(0, Math.min(1, v.value / max)) * (layer.tracks?.progress ? p.progress : p.w);
          const fill = paintOf(film.design, v.color ?? layer.color ?? "accent", film.design.accent);
          const label = layer.showValues === false ? v.label : `${v.label}  ${formatNumber(v.value, layer.format)}`;
          return horizontal ? (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 18 * u, opacity: p.opacity }}>
              <div style={{ width: Math.round(w * 0.28), textAlign: "right", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{v.label}</div>
              <div style={{ flex: 1, height: th, position: "relative" }}>
                <div style={{ position: "absolute", left: 0, top: 0, height: th, width: `${frac * 100}%`, background: fill, borderRadius: th / 2 }} />
                {layer.showValues !== false ? <div style={{ position: "absolute", left: `calc(${frac * 100}% + ${14 * u}px)`, top: 0, height: th, display: "flex", alignItems: "center", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{formatNumber(v.value, layer.format)}</div> : null}
              </div>
            </div>
          ) : (
            <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 * u, height: "100%", justifyContent: "flex-end", opacity: p.opacity, flex: 1 }}>
              {layer.showValues !== false ? <div style={{ fontVariantNumeric: "tabular-nums" }}>{formatNumber(v.value, layer.format)}</div> : null}
              <div style={{ width: th, height: `${frac * 100}%`, background: fill, borderRadius: th / 4, minHeight: 2 }} />
              <div style={{ whiteSpace: "nowrap" }}>{label === v.label ? v.label : v.label}</div>
            </div>
          );
        })}
      </div>
    </Box>
  );
};

const ListView: React.FC<{ ctx: Ctx; layer: ListLayer }> = ({ ctx, layer }) => {
  const { film, fr, frame } = ctx;
  const u = fr.u;
  const size = (layer.size ?? 48) * u;
  const st = layer.in?.stagger ?? { by: "item" as const, each: 5 };
  const whole = poseAt(film, ctx.scene, layer, frame);
  const color = colorOf(film.design, layer.color, film.design.ink);
  const mc = colorOf(film.design, layer.markerColor ?? "accent", film.design.accent);
  const width = (layer.maxWidth ?? defaultMaxWidth(fr)) * fr.width;
  const marker = (i: number) => (layer.marker === "number" ? `${i + 1}.` : layer.marker === "check" ? "✓" : layer.marker === "dash" ? "–" : layer.marker === "none" ? "" : "•");
  return (
    <Box ctx={ctx} layer={layer} pose={{ ...whole, opacity: whole.visible ? 1 : 0, x: 0, y: 0, scale: 1, blur: 0 }}>
      <div style={{ width, display: "flex", flexDirection: "column", gap: (layer.gap ?? 18) * u, fontFamily: fontFor(film, layer.role ?? "body"), fontSize: size, fontWeight: layer.weight ?? 500, color, lineHeight: 1.2, textAlign: layer.align ?? "left", alignItems: layer.align === "center" ? "center" : "flex-start" }}>
        {layer.items.map((it, i) => {
          const p = poseAt(film, ctx.scene, layer, frame, staggerDelay(st, i, layer.items.length));
          return (
            <div key={i} data-probe={layer.probe === false ? undefined : `${layer.id}-${i + 1}`} style={{ display: "flex", gap: 0.55 * size, alignItems: "baseline", ...poseStyle(p, fr) }}>
              {marker(i) ? <span style={{ color: mc, minWidth: 0.9 * size, fontWeight: 700 }}>{marker(i)}</span> : null}
              <span>{marked(it, mc, `i${i}`)}</span>
            </div>
          );
        })}
      </div>
    </Box>
  );
};

const ChartLineView: React.FC<{ ctx: Ctx; layer: LineChartLayer }> = ({ ctx, layer }) => {
  const p = poseAt(ctx.film, ctx.scene, layer, ctx.frame);
  return <Box ctx={ctx} layer={layer} pose={{ ...p, w: 1, h: 1 }}><LineChartView ctx={ctx} layer={layer} pose={p} /></Box>;
};

const ChartRingsView: React.FC<{ ctx: Ctx; layer: RingsLayer }> = ({ ctx, layer }) => {
  const p = poseAt(ctx.film, ctx.scene, layer, ctx.frame);
  return <Box ctx={ctx} layer={layer} pose={{ ...p, opacity: p.visible ? 1 : 0, w: 1, h: 1 }}><RingsView ctx={ctx} layer={layer} pose={p} /></Box>;
};

const ParticleLayerView: React.FC<{ ctx: Ctx; layer: ParticlesLayer }> = ({ ctx, layer }) => {
  const p = poseAt(ctx.film, ctx.scene, layer, ctx.frame);
  return <Box ctx={ctx} layer={layer} pose={{ ...p, w: 1, h: 1 }}><ParticlesView ctx={ctx} layer={layer} /></Box>;
};

const LayerView: React.FC<{ ctx: Ctx; layer: Layer }> = ({ ctx, layer }) => {
  switch (layer.type) {
    case "text":
      return <TextView ctx={ctx} layer={layer} />;
    case "shape":
      return <ShapeView ctx={ctx} layer={layer} />;
    case "image":
      return <ImageView ctx={ctx} layer={layer} />;
    case "counter":
      return <CounterView ctx={ctx} layer={layer} />;
    case "bars":
      return <BarsView ctx={ctx} layer={layer} />;
    case "list":
      return <ListView ctx={ctx} layer={layer} />;
    case "line":
      return <ChartLineView ctx={ctx} layer={layer} />;
    case "rings":
      return <ChartRingsView ctx={ctx} layer={layer} />;
    case "particles":
      return <ParticleLayerView ctx={ctx} layer={layer} />;
  }
};

/** 1 while the scene is on, 0 at its edges when it fades in or out; the ranges stay strictly increasing whatever the durations */
export const fadeOpacity = (frame: number, dur: number, enter: number, exit: number): number => {
  const a = enter > 0 ? interpolate(frame, [0, Math.max(1, enter)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 1;
  const b = exit > 0 ? interpolate(frame, [Math.max(0, dur - 1 - exit), Math.max(1, dur - 1)], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 1;
  return Math.min(a, b);
};

const transitionDur = (t: MgScene["enter"] | undefined, fallback: number) => (t === undefined ? fallback : t === "cut" ? 0 : t === "fade" ? fallback : t.dur ?? fallback);

/** one scene: the ground, then the layers; content fades in and out over the ground when the scene says so */
export const MgSceneView: React.FC<{ film: MgFilm; scene: MgScene; format: string }> = ({ film, scene, format }) => {
  const frame = useCurrentFrame();
  const fr = frameFor(film, format);
  const ground = groundPaint(film, scene, frame);
  const enter = transitionDur(scene.enter, film.defaults?.enterFrames ?? 0);
  const exit = transitionDur(scene.exit, 0);
  const o = fadeOpacity(frame, scene.dur, enter, exit);
  const ctx: Ctx = { film, scene, fr, frame };
  return (
    <AbsoluteFill style={{ backgroundColor: groundFlat(film, scene, frame), overflow: "hidden" }} data-mg-scene={scene.id}>
      {ground.gradient || ground.animated ? <AbsoluteFill style={backgroundStyle(ground)} data-lint={ground.animated ? "color-track" : undefined} /> : null}
      <AbsoluteFill style={{ opacity: o }}>
        {scene.layers.map((l) => <LayerView key={l.id} ctx={ctx} layer={layerFor(l, format)} />)}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const filmDuration = (film: MgFilm) => film.scenes.reduce((a, s) => a + s.dur, 0);

/** the whole film: scenes in sequence over the design's ink */
export const MgFilmView: React.FC<{ film: MgFilm; format?: string }> = ({ film, format }) => {
  const { width, height } = useVideoConfig();
  const fmt = format ?? Object.entries(film.formats).find(([, f]) => f.width === width && f.height === height)?.[0] ?? Object.keys(film.formats)[0] ?? "wide";
  const url = fontsUrl(film);
  let at = 0;
  return (
    <AbsoluteFill style={{ backgroundColor: film.design.ink }}>
      {url ? <style>{`@import url("${url}");`}</style> : null}
      {film.scenes.map((s) => {
        const from = at;
        at += s.dur;
        return (
          <Sequence key={s.id} from={from} durationInFrames={s.dur}>
            <MgSceneView film={film} scene={s} format={fmt} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
