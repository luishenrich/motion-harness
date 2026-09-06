/**
 * The Remotion API a film needs, without Remotion. A film keeps its
 * `import { ... } from "remotion"` lines; the native engine aliases that
 * module to this file. Frame, video config and sequences are React
 * contexts driven by the host page; interpolate, spring, Easing and
 * random are ports of Remotion's own math (MIT) so a frame renders the
 * same numbers on both engines.
 */
import React, { createContext, forwardRef, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

/* ---------- host bridge ---------- */

type Pending = Map<number, string>;
type Bridge = {
  pending: Pending;
  nextHandle: number;
  inputProps: Record<string, unknown>;
  registry: CompositionMeta[];
  audioTags: number;
  onChange?: () => void;
};

const bridge = (): Bridge => {
  const w = window as unknown as { __mhBridge?: Bridge };
  if (!w.__mhBridge) w.__mhBridge = { pending: new Map(), nextHandle: 1, inputProps: {}, registry: [], audioTags: 0 };
  return w.__mhBridge;
};

export const delayRender = (label = "delayRender", _opts?: { timeoutInMilliseconds?: number; retries?: number }): number => {
  const b = bridge();
  const h = b.nextHandle++;
  b.pending.set(h, label);
  return h;
};

export const continueRender = (handle: number) => {
  const b = bridge();
  b.pending.delete(handle);
  b.onChange?.();
};

export const cancelRender = (err: unknown): never => {
  throw err instanceof Error ? err : new Error(String(err));
};

export const getInputProps = <T = Record<string, unknown>,>(): T => bridge().inputProps as T;

export const getRemotionEnvironment = () => ({ isStudio: false, isRendering: true, isPlayer: false, isReadOnlyStudio: false, isClientSideRendering: false });
export const useRemotionEnvironment = getRemotionEnvironment;

/* ---------- compositions ---------- */

export type CompositionMeta = {
  id: string;
  component: React.ComponentType<any>;
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  defaultProps: Record<string, unknown>;
  still: boolean;
};

export const registerRoot = (Root: React.ComponentType) => {
  (window as unknown as { __mhRoot?: React.ComponentType }).__mhRoot = Root;
};

type CompositionProps = { id: string; component?: React.ComponentType<any>; lazyComponent?: () => Promise<{ default: React.ComponentType<any> }>; width: number; height: number; fps?: number; durationInFrames?: number; defaultProps?: Record<string, unknown>; calculateMetadata?: unknown; schema?: unknown };

export const Composition: React.FC<CompositionProps> = (p) => {
  useLayoutEffect(() => {
    const b = bridge();
    if (!p.component) throw new Error(`<Composition id="${p.id}">: lazyComponent is not supported by the native engine yet, pass component`);
    if (!b.registry.some((c) => c.id === p.id)) b.registry.push({ id: p.id, component: p.component, width: p.width, height: p.height, fps: p.fps ?? 30, durationInFrames: p.durationInFrames ?? 1, defaultProps: p.defaultProps ?? {}, still: false });
  }, []);
  return null;
};

export const Still: React.FC<Omit<CompositionProps, "fps" | "durationInFrames">> = (p) => {
  useLayoutEffect(() => {
    const b = bridge();
    if (!p.component) throw new Error(`<Still id="${p.id}">: lazyComponent is not supported by the native engine yet, pass component`);
    if (!b.registry.some((c) => c.id === p.id)) b.registry.push({ id: p.id, component: p.component, width: p.width, height: p.height, fps: 1, durationInFrames: 1, defaultProps: p.defaultProps ?? {}, still: true });
  }, []);
  return null;
};

export const Folder: React.FC<{ name: string; children?: React.ReactNode }> = ({ children }) => <>{children}</>;

/* ---------- frame and config contexts ---------- */

export type VideoConfig = { id: string; width: number; height: number; fps: number; durationInFrames: number; defaultProps: Record<string, unknown>; props: Record<string, unknown> };

export const VideoConfigContext = createContext<VideoConfig | null>(null);
export const FrameContext = createContext<number>(0);

type SequenceCtx = { cumulatedFrom: number; relativeFrom: number; durationInFrames: number; width: number | null; height: number | null };
const SequenceContext = createContext<SequenceCtx | null>(null);

export const useCurrentFrame = (): number => {
  const abs = useContext(FrameContext);
  const seq = useContext(SequenceContext);
  return seq ? abs - (seq.cumulatedFrom + seq.relativeFrom) : abs;
};

export const useVideoConfig = (): VideoConfig => {
  const v = useContext(VideoConfigContext);
  const seq = useContext(SequenceContext);
  if (!v) throw new Error("No video config found. useVideoConfig() was called outside a composition.");
  return useMemo(() => ({ ...v, width: seq?.width ?? v.width, height: seq?.height ?? v.height, durationInFrames: seq?.durationInFrames ?? v.durationInFrames }), [v, seq]);
};

export const useCurrentScale = () => 1;

/* ---------- AbsoluteFill (Remotion's tailwind-aware defaults) ---------- */

const hasClass = (className: string | undefined, prefixes: string[], exact: boolean) => {
  if (!className) return false;
  const parts = className.split(" ").map((s) => s.trim());
  return prefixes.some((p) => (exact ? parts.some((x) => x === p || x.endsWith(`:${p}`) || x.endsWith(`!${p}`)) : className.startsWith(p) || className.includes(` ${p}`) || className.includes(`!${p}`) || className.includes(`:${p}`)));
};

export const AbsoluteFill = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ style, ...other }, ref) => {
  const cn = other.className;
  const actual = useMemo<React.CSSProperties>(
    () => ({
      position: "absolute",
      top: hasClass(cn, ["top-", "inset-"], false) ? undefined : 0,
      left: hasClass(cn, ["left-", "inset-"], false) ? undefined : 0,
      right: hasClass(cn, ["right-", "inset-"], false) ? undefined : 0,
      bottom: hasClass(cn, ["bottom-", "inset-"], false) ? undefined : 0,
      width: hasClass(cn, ["w-"], false) ? undefined : "100%",
      height: hasClass(cn, ["h-"], false) ? undefined : "100%",
      display: hasClass(cn, ["block", "inline-block", "inline", "flex", "inline-flex", "flow-root", "grid", "inline-grid", "contents", "list-item", "hidden"], true) ? undefined : "flex",
      flexDirection: hasClass(cn, ["flex-row", "flex-col", "flex-row-reverse", "flex-col-reverse"], true) ? undefined : "column",
      ...style,
    }),
    [cn, style],
  );
  return <div ref={ref} style={actual} {...other} />;
});
AbsoluteFill.displayName = "AbsoluteFill";

/* ---------- Sequence, Series, Loop, Freeze ---------- */

type SequenceProps = { from?: number; durationInFrames?: number; name?: string; layout?: "absolute-fill" | "none"; style?: React.CSSProperties; className?: string; width?: number; height?: number; premountFor?: number; children?: React.ReactNode };

export const Sequence: React.FC<SequenceProps> = ({ from = 0, durationInFrames = Infinity, layout = "absolute-fill", style, className, width, height, children }) => {
  const parent = useContext(SequenceContext);
  const abs = useContext(FrameContext);
  const video = useContext(VideoConfigContext);
  const cumulatedFrom = parent ? parent.cumulatedFrom + parent.relativeFrom : 0;
  const parentDur = parent ? Math.min(parent.durationInFrames - from, durationInFrames) : durationInFrames;
  const actualDur = Math.max(0, Math.min((video?.durationInFrames ?? Infinity) - from, parentDur));
  const ctx = useMemo<SequenceCtx>(() => ({ cumulatedFrom, relativeFrom: from, durationInFrames: actualDur, width: width ?? parent?.width ?? null, height: height ?? parent?.height ?? null }), [cumulatedFrom, from, actualDur, width, height, parent]);
  const local = abs - cumulatedFrom - from;
  if (local < 0 || local >= actualDur) return null;
  const body = layout === "none" ? <>{children}</> : <AbsoluteFill style={style} className={className}>{children}</AbsoluteFill>;
  return <SequenceContext.Provider value={ctx}>{body}</SequenceContext.Provider>;
};

type SeriesSeqProps = { durationInFrames: number; offset?: number; layout?: "absolute-fill" | "none"; style?: React.CSSProperties; className?: string; children?: React.ReactNode };
const SeriesSequence: React.FC<SeriesSeqProps> = ({ children }) => <>{children}</>;
const SeriesRoot: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  let at = 0;
  const out: React.ReactNode[] = [];
  React.Children.forEach(children, (child, i) => {
    if (!React.isValidElement<SeriesSeqProps>(child)) return;
    const { durationInFrames, offset = 0, ...rest } = child.props;
    at += offset;
    out.push(
      <Sequence key={i} from={at} durationInFrames={durationInFrames} {...rest}>
        {child.props.children}
      </Sequence>,
    );
    at += durationInFrames;
  });
  return <>{out}</>;
};
export const Series = Object.assign(SeriesRoot, { Sequence: SeriesSequence });

export const Loop: React.FC<{ durationInFrames: number; times?: number; layout?: "absolute-fill" | "none"; style?: React.CSSProperties; children?: React.ReactNode }> = ({ durationInFrames, times = Infinity, layout, style, children }) => {
  const frame = useCurrentFrame();
  const video = useVideoConfig();
  const max = Math.min(times, Math.ceil(video.durationInFrames / durationInFrames));
  const i = Math.floor(frame / durationInFrames);
  if (i >= max) return null;
  return (
    <Sequence from={i * durationInFrames} durationInFrames={durationInFrames} layout={layout} style={style}>
      {children}
    </Sequence>
  );
};

export const Freeze: React.FC<{ frame: number; active?: boolean; children?: React.ReactNode }> = ({ frame, active = true, children }) => {
  const seq = useContext(SequenceContext);
  const abs = useContext(FrameContext);
  if (!active) return <>{children}</>;
  const base = seq ? seq.cumulatedFrom + seq.relativeFrom : 0;
  return <FrameContext.Provider value={base + frame}>{children}</FrameContext.Provider>;
};

/* ---------- assets ---------- */

export const staticFile = (path: string): string => {
  const p = path.startsWith("/") ? path.slice(1) : path;
  return "/" + p.split("/").map((s) => encodeURIComponent(s)).join("/");
};

/** waits for the image before the frame counts as settled: a frame with a half-loaded logo is not a frame */
export const Img = forwardRef<HTMLImageElement, React.ImgHTMLAttributes<HTMLImageElement> & { pauseWhenLoading?: boolean; maxRetries?: number; onError?: (e: unknown) => void }>(({ pauseWhenLoading, maxRetries, onError, src, ...rest }, ref) => {
  const inner = useRef<HTMLImageElement | null>(null);
  const handle = useRef<number | null>(null);
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el || !src) return;
    if (el.complete && el.naturalWidth > 0) return;
    handle.current = delayRender(`img ${src}`);
    const done = () => {
      if (handle.current !== null) continueRender(handle.current);
      handle.current = null;
    };
    el.addEventListener("load", done, { once: true });
    el.addEventListener("error", done, { once: true });
    return () => {
      el.removeEventListener("load", done);
      el.removeEventListener("error", done);
      done();
    };
  }, [src]);
  return <img ref={(el) => { inner.current = el; if (typeof ref === "function") ref(el); else if (ref) (ref as React.MutableRefObject<HTMLImageElement | null>).current = el; }} src={src} {...rest} onError={(e) => onError?.(e)} />;
});
Img.displayName = "Img";

type VideoProps = React.VideoHTMLAttributes<HTMLVideoElement> & { startFrom?: number; endAt?: number; playbackRate?: number; volume?: number | ((f: number) => number); muted?: boolean; transparent?: boolean; toneMapped?: boolean; pauseWhenBuffering?: boolean; delayRenderTimeoutInMilliseconds?: number; delayRenderRetries?: number; onVideoFrame?: unknown; showInTimeline?: boolean; name?: string; loop?: boolean; acceptableTimeShiftInSeconds?: number; useWebAudioApi?: boolean; crossOrigin?: string };

/** the frame's moment of the clip, seeked and waited for; sound is not rendered here, the mix takes it from the timeline cues */
const SeekedVideo = forwardRef<HTMLVideoElement, VideoProps>(({ startFrom = 0, endAt, playbackRate = 1, volume, muted, transparent, toneMapped, pauseWhenBuffering, delayRenderTimeoutInMilliseconds, delayRenderRetries, onVideoFrame, showInTimeline, name, loop, acceptableTimeShiftInSeconds, useWebAudioApi, src, style, ...rest }, ref) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const inner = useRef<HTMLVideoElement | null>(null);
  const t = Math.max(0, (startFrom + frame * playbackRate) / fps);
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el || !src) return;
    let dead = false;
    const h = delayRender(`video ${src} @${t.toFixed(3)}`);
    const seek = () => {
      if (dead) return;
      const target = loop && el.duration ? t % el.duration : Math.min(t, Number.isFinite(el.duration) ? Math.max(0, el.duration - 1 / 1000) : t);
      if (Math.abs(el.currentTime - target) < 1 / (fps * 4) && el.readyState >= 2) return continueRender(h);
      const onSeeked = () => {
        el.removeEventListener("seeked", onSeeked);
        // the decoded frame lands one paint after seeked
        requestAnimationFrame(() => continueRender(h));
      };
      el.addEventListener("seeked", onSeeked);
      el.currentTime = target;
    };
    if (el.readyState >= 1) seek();
    else el.addEventListener("loadedmetadata", seek, { once: true });
    return () => {
      dead = true;
      el.removeEventListener("loadedmetadata", seek);
      continueRender(h);
    };
  }, [src, t, fps, loop]);
  return <video ref={(el) => { inner.current = el; if (typeof ref === "function") ref(el); else if (ref) (ref as React.MutableRefObject<HTMLVideoElement | null>).current = el; }} src={src} muted playsInline preload="auto" style={style} {...rest} />;
});
SeekedVideo.displayName = "Video";

export const Video = SeekedVideo;
export const OffthreadVideo = SeekedVideo;
export const Html5Video = SeekedVideo;

/** sound is not part of a frame: the native engine mixes audio from the timeline's cues, so an <Audio> tag only counts itself */
export const Audio: React.FC<Record<string, unknown>> = () => {
  useEffect(() => {
    bridge().audioTags++;
    return () => {
      bridge().audioTags--;
    };
  }, []);
  return null;
};
export const Html5Audio = Audio;

export const IFrame = forwardRef<HTMLIFrameElement, React.IframeHTMLAttributes<HTMLIFrameElement>>((p, ref) => <iframe ref={ref} {...p} />);
IFrame.displayName = "IFrame";

/* ---------- math: ports of Remotion (MIT, remotion-dev/remotion) ---------- */

type ExtrapolateType = "extend" | "identity" | "clamp" | "wrap";
export type EasingFunction = (t: number) => number;
export type InterpolateOptions = { easing?: EasingFunction | EasingFunction[]; extrapolateLeft?: ExtrapolateType; extrapolateRight?: ExtrapolateType; posterize?: number };

const interpolateFunction = (input: number, [inputMin, inputMax]: number[], [outputMin, outputMax]: number[], o: { easing: EasingFunction; extrapolateLeft: ExtrapolateType; extrapolateRight: ExtrapolateType }) => {
  let result = input;
  if (result < inputMin) {
    if (o.extrapolateLeft === "identity") return result;
    if (o.extrapolateLeft === "clamp") result = inputMin;
    else if (o.extrapolateLeft === "wrap") {
      const range = inputMax - inputMin;
      result = ((((result - inputMin) % range) + range) % range) + inputMin;
    }
  }
  if (result > inputMax) {
    if (o.extrapolateRight === "identity") return result;
    if (o.extrapolateRight === "clamp") result = inputMax;
    else if (o.extrapolateRight === "wrap") {
      const range = inputMax - inputMin;
      result = ((((result - inputMin) % range) + range) % range) + inputMin;
    }
  }
  if (outputMin === outputMax) return outputMin;
  result = (result - inputMin) / (inputMax - inputMin);
  result = o.easing(result);
  return result * (outputMax - outputMin) + outputMin;
};

const findRange = (input: number, inputRange: number[]) => {
  let i: number;
  for (i = 1; i < inputRange.length - 1; ++i) if (inputRange[i] >= input) break;
  return i - 1;
};

const interpolateNumber = (input: number, inputRange: number[], outputRange: number[], options?: InterpolateOptions): number => {
  if (inputRange.length === 1) return outputRange[0];
  const e = options?.easing;
  const easingFor = (i: number): EasingFunction => (e === undefined ? (n) => n : typeof e === "function" ? e : e[i]);
  const posterized = options?.posterize === undefined ? input : Math.floor(input / options.posterize) * options.posterize;
  const range = findRange(posterized, inputRange);
  return interpolateFunction(posterized, [inputRange[range], inputRange[range + 1]], [outputRange[range], outputRange[range + 1]], { easing: easingFor(range), extrapolateLeft: options?.extrapolateLeft ?? "extend", extrapolateRight: options?.extrapolateRight ?? "extend" });
};

export function interpolate(input: number, inputRange: number[], outputRange: number[], options?: InterpolateOptions): number;
export function interpolate(input: number, inputRange: number[], outputRange: number[][], options?: InterpolateOptions): number[];
export function interpolate(input: number, inputRange: number[], outputRange: number[] | number[][], options?: InterpolateOptions): number | number[] {
  if (typeof input !== "number") throw new TypeError("Cannot interpolate an input which is not a number");
  if (inputRange.length !== outputRange.length) throw new Error(`inputRange (${inputRange.length}) and outputRange (${outputRange.length}) must have the same length`);
  for (let i = 1; i < inputRange.length; i++) if (!(inputRange[i] > inputRange[i - 1])) throw new Error(`inputRange must be strictly monotonically increasing but got [${inputRange.join(",")}]`);
  if (outputRange.every((o) => Array.isArray(o))) {
    const dims = (outputRange[0] as number[]).length;
    return Array.from({ length: dims }, (_, axis) => interpolateNumber(input, inputRange, (outputRange as number[][]).map((o) => o[axis]), options));
  }
  if (!outputRange.every((o) => typeof o === "number")) throw new TypeError("the native engine interpolates numbers and numeric tuples; string output ranges are not supported yet");
  return interpolateNumber(input, inputRange, outputRange as number[], options);
}

/* bezier, from react-native's Easing (MIT) as used by Remotion */
const NEWTON_ITERATIONS = 4, NEWTON_MIN_SLOPE = 0.001, SUBDIVISION_PRECISION = 0.0000001, SUBDIVISION_MAX_ITERATIONS = 10, kSplineTableSize = 11, kSampleStepSize = 1 / (kSplineTableSize - 1);
const A = (a1: number, a2: number) => 1 - 3 * a2 + 3 * a1;
const B = (a1: number, a2: number) => 3 * a2 - 6 * a1;
const C = (a1: number) => 3 * a1;
const calcBezier = (t: number, a1: number, a2: number) => ((A(a1, a2) * t + B(a1, a2)) * t + C(a1)) * t;
const getSlope = (t: number, a1: number, a2: number) => 3 * A(a1, a2) * t * t + 2 * B(a1, a2) * t + C(a1);
export const bezier = (mX1: number, mY1: number, mX2: number, mY2: number): EasingFunction => {
  if (!(mX1 >= 0 && mX1 <= 1 && mX2 >= 0 && mX2 <= 1)) throw new Error("bezier x values must be in [0, 1] range");
  const samples = new Float32Array(kSplineTableSize);
  if (mX1 !== mY1 || mX2 !== mY2) for (let i = 0; i < kSplineTableSize; ++i) samples[i] = calcBezier(i * kSampleStepSize, mX1, mX2);
  const getTForX = (aX: number) => {
    let intervalStart = 0, currentSample = 1;
    const last = kSplineTableSize - 1;
    for (; currentSample !== last && samples[currentSample] <= aX; ++currentSample) intervalStart += kSampleStepSize;
    --currentSample;
    const dist = (aX - samples[currentSample]) / (samples[currentSample + 1] - samples[currentSample]);
    const guess = intervalStart + dist * kSampleStepSize;
    const slope = getSlope(guess, mX1, mX2);
    if (slope >= NEWTON_MIN_SLOPE) {
      let g = guess;
      for (let i = 0; i < NEWTON_ITERATIONS; ++i) {
        const s = getSlope(g, mX1, mX2);
        if (s === 0) return g;
        g -= (calcBezier(g, mX1, mX2) - aX) / s;
      }
      return g;
    }
    if (slope === 0) return guess;
    let a = intervalStart, b = intervalStart + kSampleStepSize, t = 0, x = 0, i = 0;
    do {
      t = a + (b - a) / 2;
      x = calcBezier(t, mX1, mX2) - aX;
      if (x > 0) b = t;
      else a = t;
    } while (Math.abs(x) > SUBDIVISION_PRECISION && ++i < SUBDIVISION_MAX_ITERATIONS);
    return t;
  };
  return (x: number) => {
    const cx = Math.min(1, Math.max(0, x));
    if (mX1 === mY1 && mX2 === mY2) return cx;
    if (cx === 0) return 0;
    if (cx === 1) return 1;
    return calcBezier(getTForX(cx), mY1, mY2);
  };
};

const clampUnit = (t: number) => Math.min(1, Math.max(0, t));
export class Easing {
  static step0(n: number) { return n > 0 ? 1 : 0; }
  static step1(n: number) { return n >= 1 ? 1 : 0; }
  static linear(t: number) { return t; }
  static ease(t: number) { return Easing.bezier(0.42, 0, 1, 1)(t); }
  static quad(t: number) { return t * t; }
  static cubic(t: number) { return t * t * t; }
  static poly(n: number) { return (t: number) => t ** n; }
  static sin(t: number) { return 1 - Math.cos((t * Math.PI) / 2); }
  static circle(t: number) { const u = clampUnit(t); return 1 - Math.sqrt(1 - u * u); }
  static exp(t: number) { return 2 ** (10 * (t - 1)); }
  static elastic(bounciness = 1) { const p = bounciness * Math.PI; return (t: number) => 1 - Math.cos((t * Math.PI) / 2) ** 3 * Math.cos(t * p); }
  static back(s = 1.70158) { return (t: number) => t * t * ((s + 1) * t - s); }
  static bounce(t: number) {
    const u = clampUnit(t);
    if (u < 1 / 2.75) return 7.5625 * u * u;
    if (u < 2 / 2.75) { const x = u - 1.5 / 2.75; return 7.5625 * x * x + 0.75; }
    if (u < 2.5 / 2.75) { const x = u - 2.25 / 2.75; return 7.5625 * x * x + 0.9375; }
    const x = u - 2.625 / 2.75;
    return 7.5625 * x * x + 0.984375;
  }
  static bezier(x1: number, y1: number, x2: number, y2: number) { return bezier(x1, y1, x2, y2); }
  static in(e: EasingFunction) { return e; }
  static out(e: EasingFunction) { return (t: number) => 1 - e(1 - t); }
  static inOut(e: EasingFunction) { return (t: number) => (t < 0.5 ? e(t * 2) / 2 : 1 - e((1 - t) * 2) / 2); }
}

/* spring: the same integration Remotion runs, frame by frame at 1000/fps ms steps */
export type SpringConfig = { damping?: number; mass?: number; stiffness?: number; overshootClamping?: boolean };
const DEFAULT_SPRING = { damping: 10, mass: 1, stiffness: 100, overshootClamping: false };
type Anim = { lastTimestamp: number; current: number; toValue: number; velocity: number; prevPosition: number };
const advance = (animation: Anim, now: number, config: Required<SpringConfig>): Anim => {
  const { toValue, lastTimestamp, current, velocity } = animation;
  const deltaTime = Math.min(now - lastTimestamp, 64);
  if (config.damping <= 0) throw new Error("Spring damping must be greater than 0");
  const c = config.damping, m = config.mass, k = config.stiffness;
  const v0 = -velocity, x0 = toValue - current;
  const zeta = c / (2 * Math.sqrt(k * m));
  const omega0 = Math.sqrt(k / m);
  const omega1 = omega0 * Math.sqrt(1 - zeta ** 2);
  const t = deltaTime / 1000;
  const sin1 = Math.sin(omega1 * t), cos1 = Math.cos(omega1 * t);
  const env = Math.exp(-zeta * omega0 * t);
  const frag = env * (sin1 * ((v0 + zeta * omega0 * x0) / omega1) + x0 * cos1);
  const underPos = toValue - frag;
  const underVel = zeta * omega0 * frag - env * (cos1 * (v0 + zeta * omega0 * x0) - omega1 * x0 * sin1);
  const cenv = Math.exp(-omega0 * t);
  const critPos = toValue - cenv * (x0 + (v0 + omega0 * x0) * t);
  const critVel = cenv * (v0 * (t * omega0 - 1) + t * x0 * omega0 * omega0);
  return { toValue, prevPosition: current, lastTimestamp: now, current: zeta < 1 ? underPos : critPos, velocity: zeta < 1 ? underVel : critVel };
};
const springCache = new Map<string, Anim>();
const springCalculation = (frame: number, fps: number, config: SpringConfig): Anim => {
  const key = [frame, fps, config.damping, config.mass, config.overshootClamping, config.stiffness].join("-");
  const hit = springCache.get(key);
  if (hit) return hit;
  let animation: Anim = { lastTimestamp: 0, current: 0, toValue: 1, velocity: 0, prevPosition: 0 };
  const clamped = Math.max(0, frame);
  const rest = clamped % 1;
  const full = { ...DEFAULT_SPRING, ...config };
  for (let f = 0; f <= Math.floor(clamped); f++) {
    if (f === Math.floor(clamped)) f += rest;
    animation = advance(animation, (f / fps) * 1000, full);
  }
  springCache.set(key, animation);
  return animation;
};
const measureCache = new Map<string, number>();
export const measureSpring = ({ fps, config = {}, threshold = 0.005 }: { fps: number; config?: SpringConfig; threshold?: number }): number => {
  if (threshold === 0) return Infinity;
  if (threshold === 1) return 0;
  const key = [fps, config.damping, config.mass, config.overshootClamping, config.stiffness, threshold].join("-");
  const hit = measureCache.get(key);
  if (hit !== undefined) return hit;
  let frame = 0;
  let a = springCalculation(frame, fps, config);
  let diff = Math.abs(a.current - a.toValue);
  while (diff >= threshold) {
    frame++;
    a = springCalculation(frame, fps, config);
    diff = Math.abs(a.current - a.toValue);
  }
  let finished = frame;
  for (let i = 0; i < 20; i++) {
    frame++;
    a = springCalculation(frame, fps, config);
    diff = Math.abs(a.current - a.toValue);
    if (diff >= threshold) {
      i = 0;
      finished = frame + 1;
    }
  }
  measureCache.set(key, finished);
  return finished;
};
export const spring = ({ frame: passedFrame, fps, config = {}, from = 0, to = 1, durationInFrames, durationRestThreshold, delay = 0, reverse = false }: { frame: number; fps: number; config?: SpringConfig; from?: number; to?: number; durationInFrames?: number; durationRestThreshold?: number; delay?: number; reverse?: boolean }): number => {
  const needsNatural = reverse || durationInFrames !== undefined;
  const natural = needsNatural ? measureSpring({ fps, config, threshold: durationRestThreshold }) : undefined;
  const reversed = reverse ? (durationInFrames ?? natural!) - passedFrame : passedFrame;
  const delayed = reversed + (reverse ? delay : -delay);
  const processed = durationInFrames === undefined ? delayed : delayed / (durationInFrames / natural!);
  if (durationInFrames && delayed > durationInFrames) return to;
  const spr = springCalculation(processed, fps, config);
  const inner = config.overshootClamping ? (to >= from ? Math.min(spr.current, to) : Math.max(spr.current, to)) : spr.current;
  return from === 0 && to === 1 ? inner : interpolate(inner, [0, 1], [from, to]);
};

/* random: Remotion's mulberry32 over a string hash */
const mulberry32 = (a: number) => {
  let t = a + 0x6d2b79f5;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const hashCode = (str: string) => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
};
export const random = (seed: string | number | null): number => {
  if (seed === null) return Math.random();
  if (typeof seed === "string") return mulberry32(hashCode(seed));
  if (typeof seed === "number") return mulberry32(seed * 10000000000);
  throw new Error("random() argument must be a number or a string");
};

export const interpolateColors = (): never => {
  throw new Error("interpolateColors is not part of the native engine shim yet");
};

/* ---------- host helpers (not part of Remotion's API) ---------- */

export const __mh = {
  bridge,
  /** resolves when every delayRender handle is continued and stays so; rejects after `timeoutMs` naming the slow one */
  settled: (timeoutMs = 30000): Promise<void> =>
    new Promise((resolve, reject) => {
      const b = bridge();
      const t0 = Date.now();
      const tick = () => {
        if (b.pending.size === 0) return resolve();
        if (Date.now() - t0 > timeoutMs) return reject(new Error(`delayRender never continued: ${[...b.pending.values()].join(", ")}`));
        setTimeout(tick, 5);
      };
      tick();
    }),
};

// keep React referenced for classic-runtime consumers
void React;
void useState;
