/**
 * The components that draw a motion graphics film from its data. One
 * component per layer type, one scene component that paints the ground and
 * places the layers, one film component that sequences the scenes. Imports
 * the Remotion API, so it renders under the native engine (the shim) and
 * under Remotion alike. Every layer root carries data-probe (its id) and
 * data-mg ("scene.layer", "scene.group.layer") so the probe, the lints and the
 * editor find it. A group draws its children inside its own box, the scene's
 * camera is one transform on the layer container, and a scene's transition
 * draws the scene before it underneath while the handover runs.
 */
import React from "react";
import { AbsoluteFill, Img, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { BarsLayer, CounterLayer, GroupLayer, ImageLayer, Layer, ListLayer, MgFilm, MgScene, MgTransition, ShapeLayer, TextLayer, TransitionType } from "./schema.ts";
import { colorOf, groupBox, layerFor, layerTiming } from "./schema.ts";
import { cameraAt, childDelays, poseAt, staggerDelay, type Pose } from "./pose.ts";
import { progressOf, resolveEase } from "./easing.ts";
import { transitionDur as handoverDur } from "./timeline.ts";
import { anchorOrigin, boxFrame, defaultMaxWidth, frameFor, placement, type Frame } from "./layout.ts";

const fontStack = (family: string | undefined, fallback: string) => (family ? `'${family}', ${fallback}` : fallback);
const SANS = "-apple-system, 'Helvetica Neue', Helvetica, Arial, sans-serif";
const MONO = "ui-monospace, Menlo, Consolas, monospace";

const fontFor = (film: MgFilm, role: "display" | "body" | "mono" | undefined) => (role === "mono" ? fontStack(film.design.fontMono, MONO) : role === "body" ? fontStack(film.design.fontBody ?? film.design.fontDisplay, SANS) : fontStack(film.design.fontDisplay, SANS));

export const fontsUrl = (film: MgFilm): string => {
  const fams = film.design.fonts ?? [film.design.fontDisplay, film.design.fontBody, film.design.fontMono].filter((f): f is string => !!f);
  if (!fams.length) return "";
  return `https://fonts.googleapis.com/css2?${[...new Set(fams)].map((f) => `family=${encodeURIComponent(f).replace(/%20/g, "+")}:wght@400;500;600;700;800`).join("&")}&display=swap`;
};

/** css transform and filter for a pose */
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

type Ctx = {
  film: MgFilm;
  scene: MgScene;
  /** the frame a layer's box lives in: the whole frame, or the box of the group above it */
  fr: Frame;
  frame: number;
  format: string;
  /** frames the groups above this layer push its in back by */
  delay: number;
  /** "card." while drawing what is inside the group "card" */
  path: string;
  /** this copy of the scene only sits under a transition: no probe, no lint */
  under?: boolean;
};

const rootCtx = (film: MgFilm, scene: MgScene, fr: Frame, frame: number, format: string, under?: boolean): Ctx => ({ film, scene, fr, frame, format, delay: 0, path: "", under });

/** what a text carrier says to the rendered lints: nothing, when it is only the scene under a transition */
const quiet = (ctx: Ctx) => (ctx.under ? "none" : undefined);

/** the outer box of every layer: position, anchor, pose; children draw the content */
const Box: React.FC<{ ctx: Ctx; layer: Layer; pose: Pose; children: React.ReactNode; extra?: React.CSSProperties; lines?: number; origin?: string }> = ({ ctx, layer, pose, children, extra, lines, origin }) => {
  const pl = placement(layer, ctx.fr);
  const base: React.CSSProperties = { position: "absolute", left: pl.left, top: pl.top, transform: pl.translate, textAlign: pl.textAlign, ...extra };
  const off = ctx.under || layer.probe === false;
  return (
    <div data-probe={off ? undefined : layer.id} data-mg={ctx.under ? undefined : `${ctx.scene.id}.${ctx.path}${layer.id}`} data-lines={lines} data-lint={off ? "none" : undefined} style={{ ...base, visibility: pose.visible ? "visible" : "hidden" }}>
      <div style={{ ...poseStyle(pose, ctx.fr), transformOrigin: origin ?? "50% 50%" }}>{children}</div>
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
const marked = (text: string, accent: string, key: string): React.ReactNode[] =>
  text.split(/(\*[^*]+\*)/).filter((s) => s.length).map((s, i) => (s.startsWith("*") && s.endsWith("*") ? <span key={`${key}-${i}`} style={{ color: accent }}>{s.slice(1, -1)}</span> : <React.Fragment key={`${key}-${i}`}>{s}</React.Fragment>));

const TextView: React.FC<{ ctx: Ctx; layer: TextLayer }> = ({ ctx, layer }) => {
  const { film, fr, frame } = ctx;
  const size = (layer.size ?? 72) * fr.u;
  const color = colorOf(film.design, layer.color, film.design.ink);
  const accent = colorOf(film.design, layer.accent ?? "accent", film.design.accent);
  const st = layer.in?.stagger ?? film.defaults?.layerIn?.stagger;
  const whole = poseAt(film, ctx.scene, layer, frame, ctx.delay);
  const width = (layer.maxWidth ?? defaultMaxWidth(fr)) * fr.width;
  const style: React.CSSProperties = { fontFamily: fontFor(film, layer.role), fontSize: size, fontWeight: layer.weight ?? (layer.role === "body" ? 400 : 700), lineHeight: layer.lineHeight ?? 1.1, letterSpacing: layer.letterSpacing !== undefined ? `${layer.letterSpacing}em` : layer.role === "display" || !layer.role ? "-0.01em" : undefined, color, width, whiteSpace: "pre-wrap", textTransform: layer.uppercase ? "uppercase" : undefined, textAlign: layer.align ?? placement(layer, fr).textAlign, margin: 0 };
  const typewriter = (layer.in?.preset ?? film.defaults?.layerIn?.preset) === "typewriter";
  // the wrap lint expects this many lines: the layer's own count, else the explicit line breaks
  const expectLines = layer.lines ?? layer.text.split("\n").length;
  if (typewriter) {
    const chars = [...layer.text.replace(/\*/g, "")];
    const n = Math.round(whole.progress * chars.length);
    return (
      <Box ctx={ctx} layer={layer} pose={{ ...whole, progress: 1 }} lines={expectLines}>
        <div style={style} data-lint={quiet(ctx)}>{chars.slice(0, n).join("")}<span style={{ opacity: whole.progress < 1 && Math.floor(frame / 8) % 2 === 0 ? 1 : 0 }}>|</span></div>
      </Box>
    );
  }
  if (!st) {
    return (
      <Box ctx={ctx} layer={layer} pose={whole} lines={expectLines}>
        <div style={style} data-lint={quiet(ctx)}>{layer.text.split("\n").map((line, i) => <React.Fragment key={i}>{i > 0 ? <br /> : null}{marked(line, accent, `l${i}`)}</React.Fragment>)}</div>
      </Box>
    );
  }
  const { units, lines } = splitUnits(layer.text, st.by);
  const mask = (layer.in?.preset ?? film.defaults?.layerIn?.preset) === "mask";
  return (
    <Box ctx={ctx} layer={layer} pose={{ ...whole, opacity: whole.visible ? 1 : 0, x: 0, y: 0, scale: 1, blur: 0 }} lines={expectLines}>
      <div style={style}>
        {units.map((u, i) => {
          const p = poseAt(film, ctx.scene, layer, frame, ctx.delay + staggerDelay(st, i, units.length));
          // a line unit wraps inside its own row; a word or a character never wraps
          const inner = <span data-lint={quiet(ctx)} style={{ display: lines ? "block" : "inline-block", ...poseStyle(p, fr), whiteSpace: lines ? "pre-wrap" : "pre" }}>{marked(u, accent, `u${i}`)}</span>;
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
  const p = poseAt(film, ctx.scene, layer, frame, ctx.delay);
  const fill = colorOf(film.design, layer.fill, film.design.accent);
  const u = fr.u;
  if (layer.shape === "circle") {
    const d = (layer.d ?? 120) * u;
    return <Box ctx={ctx} layer={layer} pose={p}><div style={{ width: d, height: d, borderRadius: "50%", background: fill, transform: `scale(${p.w}, ${p.h})` }} /></Box>;
  }
  if (layer.shape === "ring") {
    const d = (layer.d ?? 160) * u, th = (layer.thickness ?? 12) * u;
    const prog = Math.max(0, Math.min(1, (layer.progress ?? 1) * p.progress));
    const r = (d - th) / 2, c = 2 * Math.PI * r;
    return (
      <Box ctx={ctx} layer={layer} pose={p}>
        <svg width={d} height={d} viewBox={`0 0 ${d} ${d}`} style={{ display: "block", transform: "rotate(-90deg)" }}>
          {layer.stroke ? <circle cx={d / 2} cy={d / 2} r={r} fill="none" stroke={colorOf(film.design, layer.stroke)} strokeWidth={th} /> : null}
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
  const p = poseAt(film, ctx.scene, layer, frame, ctx.delay);
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
  const p = poseAt(film, ctx.scene, layer, frame, ctx.delay);
  const t = layerTiming(film, ctx.scene, layer);
  const dur = layer.dur ?? Math.max(t.inDur, 30);
  const start = ctx.delay + t.inAt;
  const raw = interpolate(frame, [start, start + dur], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  // an explicit progress track wins; otherwise the count eases out over `dur`
  const prog = layer.tracks?.progress ? p.progress : 1 - Math.pow(1 - raw, 3);
  const v = (layer.from ?? 0) + ((layer.to ?? 0) - (layer.from ?? 0)) * prog;
  return (
    <Box ctx={ctx} layer={layer} pose={p}>
      <div data-lint={quiet(ctx)} style={{ fontFamily: fontFor(film, layer.role), fontSize: (layer.size ?? 160) * fr.u, fontWeight: layer.weight ?? 800, color: colorOf(film.design, layer.color, film.design.ink), lineHeight: 1, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em", whiteSpace: "nowrap" }}>
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
  const whole = poseAt(film, ctx.scene, layer, frame, ctx.delay);
  const labelSize = (layer.labelSize ?? 28) * u;
  const labelColor = colorOf(film.design, layer.labelColor ?? layer.color ?? "ink", film.design.ink);
  return (
    <Box ctx={ctx} layer={layer} pose={{ ...whole, w: 1, h: 1 }}>
      <div style={{ width: w, height: h, display: "flex", flexDirection: horizontal ? "column" : "row", justifyContent: "space-between", alignItems: horizontal ? "stretch" : "flex-end", gap, fontFamily: fontFor(film, "body"), color: labelColor, fontSize: labelSize }}>
        {layer.values.map((v, i) => {
          const p = poseAt(film, ctx.scene, layer, frame, ctx.delay + staggerDelay(st, i, layer.values.length));
          const frac = Math.max(0, Math.min(1, v.value / max)) * (layer.tracks?.progress ? p.progress : p.w);
          const fill = colorOf(film.design, v.color ?? layer.color ?? "accent", film.design.accent);
          const label = layer.showValues === false ? v.label : `${v.label}  ${formatNumber(v.value, layer.format)}`;
          return horizontal ? (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 18 * u, opacity: p.opacity }}>
              <div data-lint={quiet(ctx)} style={{ width: Math.round(w * 0.28), textAlign: "right", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{v.label}</div>
              <div style={{ flex: 1, height: th, position: "relative" }}>
                <div style={{ position: "absolute", left: 0, top: 0, height: th, width: `${frac * 100}%`, background: fill, borderRadius: th / 2 }} />
                {layer.showValues !== false ? <div data-lint={quiet(ctx)} style={{ position: "absolute", left: `calc(${frac * 100}% + ${14 * u}px)`, top: 0, height: th, display: "flex", alignItems: "center", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{formatNumber(v.value, layer.format)}</div> : null}
              </div>
            </div>
          ) : (
            <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 * u, height: "100%", justifyContent: "flex-end", opacity: p.opacity, flex: 1 }}>
              {layer.showValues !== false ? <div data-lint={quiet(ctx)} style={{ fontVariantNumeric: "tabular-nums" }}>{formatNumber(v.value, layer.format)}</div> : null}
              <div style={{ width: th, height: `${frac * 100}%`, background: fill, borderRadius: th / 4, minHeight: 2 }} />
              <div data-lint={quiet(ctx)} style={{ whiteSpace: "nowrap" }}>{label === v.label ? v.label : v.label}</div>
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
  const whole = poseAt(film, ctx.scene, layer, frame, ctx.delay);
  const color = colorOf(film.design, layer.color, film.design.ink);
  const mc = colorOf(film.design, layer.markerColor ?? "accent", film.design.accent);
  const width = (layer.maxWidth ?? defaultMaxWidth(fr)) * fr.width;
  const marker = (i: number) => (layer.marker === "number" ? `${i + 1}.` : layer.marker === "check" ? "✓" : layer.marker === "dash" ? "–" : layer.marker === "none" ? "" : "•");
  return (
    <Box ctx={ctx} layer={layer} pose={{ ...whole, opacity: whole.visible ? 1 : 0, x: 0, y: 0, scale: 1, blur: 0 }}>
      <div style={{ width, display: "flex", flexDirection: "column", gap: (layer.gap ?? 18) * u, fontFamily: fontFor(film, layer.role ?? "body"), fontSize: size, fontWeight: layer.weight ?? 500, color, lineHeight: 1.2, textAlign: layer.align ?? "left", alignItems: layer.align === "center" ? "center" : "flex-start" }}>
        {layer.items.map((it, i) => {
          const p = poseAt(film, ctx.scene, layer, frame, ctx.delay + staggerDelay(st, i, layer.items.length));
          return (
            <div key={i} data-probe={ctx.under || layer.probe === false ? undefined : `${layer.id}-${i + 1}`} data-lint={quiet(ctx)} style={{ display: "flex", gap: 0.55 * size, alignItems: "baseline", ...poseStyle(p, fr) }}>
              {marker(i) ? <span style={{ color: mc, minWidth: 0.9 * size, fontWeight: 700 }}>{marker(i)}</span> : null}
              <span>{marked(it, mc, `i${i}`)}</span>
            </div>
          );
        })}
      </div>
    </Box>
  );
};

/**
 * A group: a box of w x h u at its position, the children placed inside it by
 * fractions of that box. The group's pose is one transform around its anchor
 * point, so everything inside moves with it; the children's own ins count from
 * the group's in, delayed by the group's stagger.
 */
const GroupView: React.FC<{ ctx: Ctx; layer: GroupLayer }> = ({ ctx, layer }) => {
  const { film, fr, frame } = ctx;
  const box = groupBox(layer);
  const p = poseAt(film, ctx.scene, layer, frame, ctx.delay);
  const inner = boxFrame(fr, box.w, box.h);
  const kids = layer.layers ?? [];
  const delays = childDelays(film, ctx.scene, layer, ctx.delay);
  const child: Ctx = { ...ctx, fr: inner, path: `${ctx.path}${layer.id}.` };
  const paint: React.CSSProperties = {
    background: layer.fill ? colorOf(film.design, layer.fill) : undefined,
    borderRadius: layer.radius ? layer.radius * fr.u : undefined,
    border: layer.stroke ? `${(layer.thickness ?? 2) * fr.u}px solid ${colorOf(film.design, layer.stroke)}` : undefined,
    boxSizing: "border-box",
  };
  return (
    <Box ctx={ctx} layer={layer} pose={p} origin={anchorOrigin(layer.anchor)} extra={{ width: inner.width, height: inner.height }}>
      <div style={{ position: "relative", width: inner.width, height: inner.height, ...paint }}>
        {kids.map((c, i) => <LayerView key={c.id} ctx={{ ...child, delay: delays[i] }} layer={layerFor(c, ctx.format)} />)}
      </div>
    </Box>
  );
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
    case "group":
      return <GroupView ctx={ctx} layer={layer} />;
  }
};

/** 1 while the scene is on, 0 at its edges when it fades in or out; the ranges stay strictly increasing whatever the durations */
export const fadeOpacity = (frame: number, dur: number, enter: number, exit: number): number => {
  const a = enter > 0 ? interpolate(frame, [0, Math.max(1, enter)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 1;
  const b = exit > 0 ? interpolate(frame, [Math.max(0, dur - 1 - exit), Math.max(1, dur - 1)], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 1;
  return Math.min(a, b);
};

const fadeFrames = (t: MgScene["enter"] | undefined, fallback: number) => (t === undefined ? fallback : t === "cut" ? 0 : t === "fade" ? fallback : t.dur ?? fallback);

/** the camera as one css transform on the layer container: zoom and rotation turn around the focus point */
export const cameraStyle = (film: MgFilm, scene: MgScene, frame: number, fr: Frame): React.CSSProperties => {
  if (!scene.camera) return {};
  const cam = cameraAt(film, scene, frame);
  const parts: string[] = [];
  if (cam.x || cam.y) parts.push(`translate(${(cam.x * fr.u).toFixed(3)}px, ${(cam.y * fr.u).toFixed(3)}px)`);
  if (cam.rotate) parts.push(`rotate(${cam.rotate.toFixed(4)}deg)`);
  if (cam.zoom !== 1) parts.push(`scale(${cam.zoom.toFixed(5)})`);
  if (!parts.length) return {};
  return { transform: parts.join(" "), transformOrigin: `${cam.focus.x * 100}% ${cam.focus.y * 100}%` };
};

/**
 * One scene: the ground, then the layers under the camera. Content fades in
 * and out over the ground when the scene says so. `at` draws a frame other
 * than the sequence's own (the copy that sits under a transition), `under`
 * makes that copy invisible to the probe and to the rendered lints.
 */
export const MgSceneView: React.FC<{ film: MgFilm; scene: MgScene; format: string; at?: number; under?: boolean; enterFrames?: number }> = ({ film, scene, format, at, under, enterFrames }) => {
  const live = useCurrentFrame();
  const frame = at ?? live;
  const fr = frameFor(film, format);
  const ground = colorOf(film.design, scene.ground ?? "ink", film.design.ink);
  const enter = enterFrames ?? fadeFrames(scene.enter, film.defaults?.enterFrames ?? 0);
  const exit = fadeFrames(scene.exit, 0);
  const o = fadeOpacity(frame, scene.dur, enter, exit);
  const ctx = rootCtx(film, scene, fr, frame, format, under);
  const cam = cameraStyle(film, scene, frame, fr);
  const layers = scene.layers.map((l) => <LayerView key={l.id} ctx={ctx} layer={layerFor(l, format)} />);
  return (
    <AbsoluteFill style={{ backgroundColor: ground, overflow: "hidden" }} data-mg-scene={under ? undefined : scene.id} data-mg-under={under ? scene.id : undefined} data-probe={under ? `under:${scene.id}` : undefined} data-lint={under ? "none" : undefined}>
      {scene.camera?.ground ? (
        <AbsoluteFill style={cam}>
          <AbsoluteFill style={{ backgroundColor: ground }} />
          <AbsoluteFill style={{ opacity: o }}>{layers}</AbsoluteFill>
        </AbsoluteFill>
      ) : (
        <AbsoluteFill style={{ ...cam, opacity: o }}>{layers}</AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};

/* ---------- scene transitions: the incoming scene owns the handover ---------- */

/** what the two scenes look like at progress p of a handover */
export const transitionStyles = (type: TransitionType, p: number, fr: Frame): { prev: React.CSSProperties; next: React.CSSProperties; dip: boolean } => {
  const q = Math.max(0, Math.min(1, p));
  const rest: React.CSSProperties = {};
  switch (type) {
    case "dissolve":
      return { prev: rest, next: { opacity: q }, dip: false };
    case "dip":
      return { prev: { opacity: 1 - Math.min(1, q * 2) }, next: { opacity: Math.max(0, q * 2 - 1) }, dip: true };
    case "push-left":
      return { prev: { transform: `translateX(${-q * 100}%)` }, next: { transform: `translateX(${(1 - q) * 100}%)` }, dip: false };
    case "push-right":
      return { prev: { transform: `translateX(${q * 100}%)` }, next: { transform: `translateX(${-(1 - q) * 100}%)` }, dip: false };
    case "push-up":
      return { prev: { transform: `translateY(${-q * 100}%)` }, next: { transform: `translateY(${(1 - q) * 100}%)` }, dip: false };
    case "push-down":
      return { prev: { transform: `translateY(${q * 100}%)` }, next: { transform: `translateY(${-(1 - q) * 100}%)` }, dip: false };
    case "wipe-left":
      return { prev: rest, next: { clipPath: `inset(0 0 0 ${(1 - q) * 100}%)` }, dip: false };
    case "wipe-right":
      return { prev: rest, next: { clipPath: `inset(0 ${(1 - q) * 100}% 0 0)` }, dip: false };
    case "wipe-up":
      return { prev: rest, next: { clipPath: `inset(${(1 - q) * 100}% 0 0 0)` }, dip: false };
    case "wipe-down":
      return { prev: rest, next: { clipPath: `inset(0 0 ${(1 - q) * 100}% 0)` }, dip: false };
    // both scenes stay at or above scale 1, so neither ever uncovers the frame's edge
    case "zoom":
      return { prev: { transform: `scale(${(1 + 0.35 * q).toFixed(4)})`, opacity: 1 - q }, next: { transform: `scale(${(1.08 - 0.08 * q).toFixed(4)})`, opacity: q }, dip: false };
    case "blur":
      return { prev: { filter: `blur(${(q * 18 * fr.u).toFixed(2)}px)`, transform: `scale(${(1 + 0.04 * q).toFixed(4)})`, opacity: 1 - q }, next: { filter: `blur(${((1 - q) * 18 * fr.u).toFixed(2)}px)`, transform: `scale(${(1 + 0.04 * (1 - q)).toFixed(4)})`, opacity: q }, dip: false };
    default:
      return { prev: rest, next: rest, dip: false };
  }
};

const handoverProgress = (film: MgFilm, spec: MgTransition, frame: number, dur: number) => progressOf(resolveEase(spec.ease ?? "inOut", film.easings ?? {}), frame, dur, film.fps);

/** the scene before, kept alive under the handover: frozen on its last frame, or still playing */
const MgSceneUnder: React.FC<{ film: MgFilm; prev: MgScene; spec: MgTransition; dur: number; format: string }> = ({ film, prev, spec, dur, format }) => {
  const frame = useCurrentFrame();
  const fr = frameFor(film, format);
  const st = transitionStyles(spec.type, handoverProgress(film, spec, frame, dur), fr);
  const scene = spec.continue ? { ...prev, hold: dur } : prev;
  const at = spec.continue ? prev.dur + frame : prev.dur - 1;
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      {st.dip ? <AbsoluteFill style={{ backgroundColor: colorOf(film.design, "ink", film.design.ink) }} /> : null}
      <AbsoluteFill style={st.prev}>
        <MgSceneView film={film} scene={scene} format={format} at={at} under />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/** the incoming scene while its handover runs, and plain once it is over */
const MgSceneArriving: React.FC<{ film: MgFilm; scene: MgScene; spec: MgTransition; dur: number; format: string }> = ({ film, scene, spec, dur, format }) => {
  const frame = useCurrentFrame();
  const fr = frameFor(film, format);
  const inner = <MgSceneView film={film} scene={scene} format={format} enterFrames={0} />;
  if (frame >= dur) return inner;
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <AbsoluteFill style={transitionStyles(spec.type, handoverProgress(film, spec, frame, dur), fr).next}>{inner}</AbsoluteFill>
    </AbsoluteFill>
  );
};

export const filmDuration = (film: MgFilm) => film.scenes.reduce((a, s) => a + s.dur, 0);

/** the whole film: scenes in sequence over the design's ink, each handover drawn over the scene before it */
export const MgFilmView: React.FC<{ film: MgFilm; format?: string }> = ({ film, format }) => {
  const { width, height } = useVideoConfig();
  const fmt = format ?? Object.entries(film.formats).find(([, f]) => f.width === width && f.height === height)?.[0] ?? Object.keys(film.formats)[0] ?? "wide";
  const url = fontsUrl(film);
  let at = 0;
  const parts: React.ReactNode[] = [];
  film.scenes.forEach((s, i) => {
    const from = at;
    at += s.dur;
    const dur = handoverDur(film, s, i);
    if (dur > 0) {
      parts.push(
        <Sequence key={`${s.id}-under`} from={from} durationInFrames={dur} name={`${s.id} over ${film.scenes[i - 1].id}`}>
          <MgSceneUnder film={film} prev={film.scenes[i - 1]} spec={s.transition!} dur={dur} format={fmt} />
        </Sequence>,
      );
    }
    parts.push(
      <Sequence key={s.id} from={from} durationInFrames={s.dur}>
        {dur > 0 ? <MgSceneArriving film={film} scene={s} spec={s.transition!} dur={dur} format={fmt} /> : <MgSceneView film={film} scene={s} format={fmt} />}
      </Sequence>,
    );
  });
  return (
    <AbsoluteFill style={{ backgroundColor: film.design.ink }}>
      {url ? <style>{`@import url("${url}");`}</style> : null}
      {parts}
    </AbsoluteFill>
  );
};
