/**
 * One interface, two engines. `remotion` keeps the project's Remotion install
 * (webpack bundle, @remotion/renderer). `native` runs the film through Vite,
 * the shim and Playwright: no license, no version pin, one module transform
 * per edit. Every command talks to this interface only.
 */
import { existsSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { LoadedConfig } from "../config.ts";
import type { FrameJob, FrameOut, ProbeResult } from "./frames.ts";

export type CompositionInfo = { id: string; width: number; height: number; fps: number; durationInFrames: number; defaultProps: Record<string, unknown> };

export type ProbeMode = "probe" | "text" | "all";

export type StillOpts = { probe?: ProbeMode | false; settleMs?: number; concurrency?: number; scale?: number; jpeg?: boolean; inputProps?: Record<string, unknown>; onDone?: (f: FrameOut, i: number) => void };

export type Quality = { crf: number; scale: number; preset: string; hw?: boolean };
export const FULL: Quality = { crf: 18, scale: 1, preset: "medium" };
/** half size, coarse crf: a review render, not a delivery */
export const DRAFT: Quality = { crf: 28, scale: 0.5, preset: "veryfast", hw: true };

export type SegmentOpts = { concurrency?: number; inputProps?: Record<string, unknown>; log?: (s: string) => void };

export interface Engine {
  readonly kind: "remotion" | "native";
  /** the source hash renders are keyed by (changes when any project source changes) */
  readonly hash: string;
  compositions(): Promise<CompositionInfo[]>;
  composition(id: string, inputProps?: Record<string, unknown>): Promise<CompositionInfo>;
  /** single frames, optionally probed */
  stills(compositionId: string, jobs: FrameJob[], opts?: StillOpts): Promise<FrameOut[]>;
  /** a video-only h264 segment of [from, to] inclusive */
  segment(compositionId: string, range: [number, number], file: string, quality: Quality, opts?: SegmentOpts): Promise<void>;
  /** every frame of [from, to] as small jpegs named element-NNNN.jpeg in outDir, in order; returns the files */
  frames(compositionId: string, range: [number, number], outDir: string, opts: { width: number; jpegQuality?: number; concurrency?: number; inputProps?: Record<string, unknown> }): Promise<string[]>;
  /** the composition's own <Audio>/<Video> sound as an aac file */
  audio(compositionId: string, file: string, opts?: { concurrency?: number }): Promise<void>;
  close(): Promise<void>;
}

export type EngineKind = Engine["kind"];

export const engineKindOf = (cfg: LoadedConfig, override?: string): EngineKind => {
  const k = override ?? cfg.engine ?? "remotion";
  if (k !== "remotion" && k !== "native") throw new Error(`unknown engine "${k}" (remotion | native)`);
  return k;
};

/**
 * Open the engine the config (or --engine) names. One engine per project and kind
 * per process: a command that runs several steps (mh check) reuses the browser and
 * the dev server instead of starting them per step, and `close()` on the handle is
 * a release; the real shutdown happens once at process exit (closeEngines).
 */
const open = new Map<string, Promise<Engine>>();
export const openEngine = async (cfg: LoadedConfig, opts: { kind?: EngineKind; force?: boolean; log?: (s: string) => void } = {}): Promise<Engine> => {
  const kind = opts.kind ?? engineKindOf(cfg);
  const key = `${kind}:${cfg.configPath}`;
  if (!open.has(key) || opts.force) {
    const p = (async () => {
      if (kind === "native") {
        const { openNative } = await import("../engine/native.ts");
        return openNative(cfg, { log: opts.log });
      }
      const { openRemotion } = await import("./remotion-engine.ts");
      return openRemotion(cfg, { force: opts.force, log: opts.log });
    })();
    if (open.has(key)) void open.get(key)!.then((e) => e.close()).catch(() => {});
    open.set(key, p);
  }
  const e = await open.get(key)!;
  // a handle, not the engine: methods bound (class engines keep them on the prototype), close is a release
  return {
    kind: e.kind,
    hash: e.hash,
    compositions: () => e.compositions(),
    composition: (id, p) => e.composition(id, p),
    stills: (id, jobs, o) => e.stills(id, jobs, o),
    segment: (id, r, f, q, o) => e.segment(id, r, f, q, o),
    frames: (id, r, d, o) => e.frames(id, r, d, o),
    audio: (id, f, o) => e.audio(id, f, o),
    close: async () => {},
  };
};

/** shut every open engine down; called once when the process ends */
export const closeEngines = async () => {
  const all = [...open.values()];
  open.clear();
  await Promise.all(all.map((p) => p.then((e) => e.close()).catch(() => {})));
};

/** the frame files a `frames()` call wrote, in frame order */
export const listFrameFiles = (outDir: string): string[] =>
  readdirSync(outDir)
    .filter((f) => /^element-\d+\.jpe?g$/.test(f))
    .sort((a, b) => parseInt(a.replace(/\D/g, ""), 10) - parseInt(b.replace(/\D/g, ""), 10))
    .map((f) => join(outDir, f));

export const clearFrameFiles = (outDir: string) => {
  if (!existsSync(outDir)) return;
  for (const f of readdirSync(outDir)) if (/^element-\d+\.jpe?g$/.test(f)) unlinkSync(join(outDir, f));
};

export type { FrameJob, FrameOut, ProbeResult };
