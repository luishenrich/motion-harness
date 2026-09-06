/** the Remotion engine: the existing bundle + @remotion/renderer path behind the Engine interface */
import { getCompositions, renderFrames, renderMedia } from "@remotion/renderer";
import type { LoadedConfig } from "../config.ts";
import { bundleProject } from "./bundle.ts";
import { openRenderer, renderFrameSet, getComposition, type Renderer } from "./frames.ts";
import { ensureDir, nextPort } from "../util.ts";
import { clearFrameFiles, listFrameFiles, type Engine, type CompositionInfo } from "./engine.ts";

export const openRemotion = async (cfg: LoadedConfig, opts: { force?: boolean; log?: (s: string) => void } = {}): Promise<Engine> => {
  const b = await bundleProject(cfg, { force: opts.force, log: opts.log });
  const r: Renderer = await openRenderer(cfg);
  const serveUrl = b.serveUrl;
  const info = (k: { id: string; width: number; height: number; fps: number; durationInFrames: number; defaultProps?: Record<string, unknown> }): CompositionInfo => ({ id: k.id, width: k.width, height: k.height, fps: k.fps, durationInFrames: k.durationInFrames, defaultProps: k.defaultProps ?? {} });
  return {
    kind: "remotion",
    hash: b.hash,
    compositions: async () => (await getCompositions(serveUrl, { logLevel: "error" })).map(info),
    composition: async (id, inputProps) => info(await getComposition(serveUrl, id, inputProps ?? {})),
    stills: (id, jobs, o = {}) => renderFrameSet(r, serveUrl, id, jobs, o),
    segment: async (id, [from, to], file, q, o = {}) => {
      const composition = await getComposition(serveUrl, id, o.inputProps ?? {});
      await renderMedia({
        composition,
        serveUrl,
        codec: "h264",
        crf: q.crf,
        scale: q.scale,
        x264Preset: q.preset as "medium",
        hardwareAcceleration: q.hw ? "if-possible" : "disable",
        outputLocation: file,
        frameRange: [from, to],
        inputProps: o.inputProps ?? {},
        puppeteerInstance: r.browser,
        concurrency: o.concurrency ?? 4,
        logLevel: "error",
        overwrite: true,
        pixelFormat: "yuv420p",
        // limited range, bt709 tagged, like the native engine; without it Remotion writes yuvj420p (full range) and players disagree on the greys
        colorSpace: "bt709",
        muted: true,
        port: nextPort(),
      });
    },
    frames: async (id, [from, to], outDir, o) => {
      const composition = await getComposition(serveUrl, id, o.inputProps ?? {});
      clearFrameFiles(outDir);
      ensureDir(outDir);
      await renderFrames({
        composition,
        serveUrl,
        outputDir: outDir,
        imageFormat: "jpeg",
        jpegQuality: o.jpegQuality ?? 70,
        scale: o.width / composition.width,
        frameRange: [from, to],
        inputProps: o.inputProps ?? {},
        puppeteerInstance: r.browser,
        concurrency: o.concurrency ?? 4,
        logLevel: "error",
        port: nextPort(),
        onStart: () => {},
        onFrameUpdate: () => {},
      });
      return listFrameFiles(outDir);
    },
    audio: async (id, file, o = {}) => {
      const composition = await getComposition(serveUrl, id);
      await renderMedia({ composition, serveUrl, codec: "aac", outputLocation: file, inputProps: {}, puppeteerInstance: r.browser, concurrency: o.concurrency ?? 4, logLevel: "error", overwrite: true, port: nextPort() });
    },
    close: () => r.close(),
  };
};
