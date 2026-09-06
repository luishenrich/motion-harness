/**
 * Timeline as data.
 *
 * A film is a list of parts (each part is one Remotion composition, per format),
 * a part is a list of scenes, a scene has a duration in frames, a transition in,
 * named events (local frames) and optional state markers. Everything else the
 * harness needs (absolute frames, film seconds, settled frames, transition
 * windows) is computed from this in `compile()`.
 *
 * Nothing here imports React or Remotion, so the same file can be imported by
 * compositions (to read event frames) and by the CLI (to resolve feedback).
 */

export type Transition = {
  /** free vocabulary, the harness only needs `dur` to know when a frame is settled */
  type: string;
  /** frames the transition takes, default: part.enterFrames */
  dur?: number;
  why?: string;
};

export type Scene = {
  id: string;
  /** duration in frames */
  dur: number;
  enter?: string | Transition;
  exit?: string | Transition;
  /** free label for the background, used in sheets and the review player (e.g. "dark", "light"; "cream" reads as light) */
  ground?: string;
  /** free label for the kind of scene; "demo" scenes share the stage top per format (lint `same-top`) */
  stage?: string;
  /** on-screen copy, used by the text-duration rule and as the subtitle line (mh srt) */
  text?: string | string[];
  /** subtitle line for a scene without on-screen copy ("Bo is mapping your course: 12 files, 5 topics"), mh srt only */
  caption?: string;
  why?: string;
  /** named moments inside the scene, in local frames. Address them as `scene.event`. */
  events?: Record<string, number>;
  /** state markers, in local frames (a demo that changes state at `at`) */
  states?: { id: string; at: number }[];
  /** data-probe keys that must be visible in this scene (lint + probe); "key@12-80" only between those local frames */
  probes?: string[];
  /** extra local frames worth a look */
  checkFrames?: number[];
  /** generated clip this scene plays (id in clips.json, mh clips): colour drift and cost are tracked per clip */
  clip?: string;
};

export type Part = {
  id: string;
  /** Remotion composition id, one per format ("wide", "vertical", ...) or a single id */
  composition: string | Record<string, string>;
  scenes: Scene[];
  /** frames the previous scene keeps rendering under the next (Remotion `Sequence` overlap) */
  overlap?: number;
  /** default transition length in frames */
  enterFrames?: number;
  /** frames of black/gap between the previous part and this one in the assembled film */
  gap?: number;
  /** the part's own entry file (project-relative): segment caches then depend only on what it imports, not on the whole bundle */
  source?: string;
  /** false when the composition carries no <Audio>/<Video> sound of its own: skips a whole second render of the part just to get silence */
  audio?: boolean;
};

export type AudioRef = string | number;

export type GainPoint = { at: AudioRef; to: number; over?: number };

export type AudioCue = {
  id: string;
  /** voice: a spoken line; `text` is synthesised into `file` by `mh voice` when the file is missing or the text changed */
  kind: "music" | "sfx" | "voice";
  file: string;
  /** voice cues: the line to speak */
  text?: string;
  /** voice cues: provider voice id or name (ElevenLabs voice id), default from config.voice */
  voice?: string;
  /** voice cues: which language the line is in, for the synthesis model */
  lang?: string;
  /** where it starts in film time: "9s", "product:0", "probe.pick1", a frame "f120" or a number (seconds) */
  at: AudioRef;
  gain?: number;
  /** gain ramps in film time */
  ramps?: GainPoint[];
  /** seconds */
  fadeOut?: number;
  /** repeat the file until the film ends */
  loop?: boolean;
  /** seconds of crossfade at every loop seam (default 2) */
  loopCrossfade?: number;
  /** trim the source before use, seconds */
  trim?: [number, number];
  /** where the file's rights come from ("Artlist subscription 2026", "own recording", "CC-BY 4.0 Kevin MacLeod"): printed in the delivery manifest */
  license?: string;
  /** credit line a license asks for, printed with the manifest */
  credit?: string;
};

export type Rules = {
  /** frames */
  minSceneDur?: number;
  /** seconds a line must stay for a given word count; default 1.2 + 0.25 per word over four */
  minTextSeconds?: (words: number) => number;
  /** max frames an enter may take before the frame counts as settled */
  maxEnterFrames?: number;
  /** [min, max] frames a scene should hold still after settling */
  holdFrames?: [number, number];
  /** content must stay inside these insets per format */
  safeZone?: Record<string, { top: number; bottom: number; x: number }>;
};

export type Timeline = {
  fps: number;
  parts: Part[];
  audio?: AudioCue[];
  rules?: Rules;
  /** per language: scene id -> text (or caption) that replaces the scene's own for subtitles and deliveries in that language */
  i18n?: Record<string, Record<string, string | string[]>>;
};

export const defineTimeline = (t: Timeline): Timeline => t;

/* ---------- compiled view ---------- */

export type CompiledEvent = { name: string; local: number; partFrame: number; filmFrame: number };

export type CompiledScene = {
  part: string;
  index: number; // index in the film
  indexInPart: number;
  id: string;
  dur: number;
  enter: Transition;
  exit?: Transition;
  ground?: string;
  stage?: string;
  text?: string[];
  caption?: string;
  why?: string;
  /** first frame inside the part composition */
  start: number;
  /** last frame + 1 inside the part composition */
  end: number;
  /** first frame in the assembled film */
  filmStart: number;
  filmEnd: number;
  /** first frame that is no longer inside the enter transition */
  settled: number;
  overlap: number;
  events: CompiledEvent[];
  states: { id: string; local: number; partFrame: number; filmFrame: number }[];
  probes: string[];
  checkFrames: number[];
  clip?: string;
  scene: Scene;
};

export type CompiledPart = {
  id: string;
  composition: string | Record<string, string>;
  /** frames */
  dur: number;
  /** first film frame */
  filmStart: number;
  filmEnd: number;
  gap: number;
  overlap: number;
  enterFrames: number;
  scenes: CompiledScene[];
  source?: string;
  audio: boolean;
};

export type Compiled = {
  fps: number;
  parts: CompiledPart[];
  scenes: CompiledScene[];
  /** frames */
  dur: number;
  seconds: number;
  timeline: Timeline;
};

const asTransition = (t: string | Transition | undefined, dur: number): Transition => {
  if (!t) return { type: "cut", dur: 0 };
  if (typeof t === "string") return { type: t, dur: t === "cut" ? 0 : dur };
  return { type: t.type, dur: t.dur ?? (t.type === "cut" ? 0 : dur), why: t.why };
};

export const compile = (t: Timeline): Compiled => {
  const parts: CompiledPart[] = [];
  const scenes: CompiledScene[] = [];
  let filmAt = 0;
  let index = 0;
  for (const p of t.parts) {
    const enterFrames = p.enterFrames ?? 12;
    const overlap = p.overlap ?? 0;
    const gap = p.gap ?? 0;
    filmAt += gap;
    const partStart = filmAt;
    let at = 0;
    const cs: CompiledScene[] = [];
    p.scenes.forEach((s, i) => {
      const enter = asTransition(s.enter, enterFrames);
      const exit = s.exit ? asTransition(s.exit, enterFrames) : undefined;
      const events = Object.entries(s.events ?? {}).map(([name, local]) => ({
        name,
        local,
        partFrame: at + local,
        filmFrame: partStart + at + local,
      }));
      const states = (s.states ?? []).map((st) => ({
        id: st.id,
        local: st.at,
        partFrame: at + st.at,
        filmFrame: partStart + at + st.at,
      }));
      const c: CompiledScene = {
        part: p.id,
        index: index++,
        indexInPart: i,
        id: s.id,
        dur: s.dur,
        enter,
        exit,
        ground: s.ground,
        stage: s.stage,
        text: s.text === undefined ? undefined : Array.isArray(s.text) ? s.text : [s.text],
        caption: s.caption,
        why: s.why,
        start: at,
        end: at + s.dur,
        filmStart: partStart + at,
        filmEnd: partStart + at + s.dur,
        settled: at + Math.min(enter.dur ?? 0, s.dur - 1),
        overlap,
        events,
        states,
        probes: s.probes ?? [],
        checkFrames: s.checkFrames ?? [],
        clip: s.clip,
        scene: s,
      };
      cs.push(c);
      scenes.push(c);
      at += s.dur;
    });
    parts.push({
      id: p.id,
      composition: p.composition,
      dur: at,
      filmStart: partStart,
      filmEnd: partStart + at,
      gap,
      overlap,
      enterFrames,
      scenes: cs,
      source: p.source,
      audio: p.audio ?? true,
    });
    filmAt = partStart + at;
  }
  return { fps: t.fps, parts, scenes, dur: filmAt, seconds: filmAt / t.fps, timeline: t };
};

export const compositionFor = (part: CompiledPart | Part, format: string): string => {
  if (typeof part.composition === "string") return part.composition;
  const id = part.composition[format];
  if (!id) throw new Error(`part "${part.id}" has no composition for format "${format}" (has: ${Object.keys(part.composition).join(", ")})`);
  return id;
};

/** a probe spec "key@from-to" split into its key and its window (local frames, inclusive); no window means the whole scene */
export const probeSpec = (spec: string): { key: string; from: number; to: number } => {
  const m = spec.match(/^(.*)@(-?\d+)-(-?\d+)$/);
  return m ? { key: m[1], from: parseInt(m[2], 10), to: parseInt(m[3], 10) } : { key: spec, from: 0, to: Infinity };
};

export const fmtTime = (frame: number, fps: number): string => {
  const s = frame / fps;
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return m > 0 ? `${m}:${r.toFixed(2).padStart(5, "0")}` : `${r.toFixed(2)}s`;
};
