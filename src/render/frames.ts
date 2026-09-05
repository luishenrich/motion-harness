/**
 * Render single frames (stills) of a composition, many at once through one
 * browser, optionally with the DOM probe switched on.
 */
import { join } from "node:path";
import { openBrowser, renderStill, selectComposition, type HeadlessBrowser } from "@remotion/renderer";
import type { LoadedConfig } from "../config.ts";
import { ensureDir, pool, muteStdout, nextPort } from "../util.ts";
import { PROBE_MARK } from "../probe/inject.ts";

export type ProbeItem = {
  key: string;
  kind: "probe" | "text" | "media";
  tag: string;
  x: number;
  y: number;
  w: number;
  h: number;
  visible: boolean;
  opacity: number;
  color: string;
  bg: string;
  fontSize: string;
  fontWeight: string;
  fontFamily: string;
  text: string;
};
export type ProbeColor = { prop: "color" | "bg" | "border"; value: string; count: number; example: string };
export type ProbeResult = { viewport: { w: number; h: number }; items: ProbeItem[]; colors: ProbeColor[]; error?: string };

export type FrameJob = { frame: number; file: string };

/** check frames are named by scene address: <runDir>/<part>/<scene>+<local>.png (the part frame stays in the manifest) */
export const frameFile = (runDir: string, part: string, scene: string, local: number) => join(runDir, part, `${scene}+${local}.png`);
export type FrameOut = FrameJob & { ms: number; probe?: ProbeResult };

export type Renderer = {
  browser: HeadlessBrowser;
  close: () => Promise<void>;
};

export const openRenderer = async (cfg: LoadedConfig): Promise<Renderer> => {
  const browser = await openBrowser("chrome", { chromiumOptions: cfg.chromiumOptions as any });
  return { browser, close: () => browser.close({ silent: true }) };
};

export const getComposition = async (serveUrl: string, id: string, inputProps: Record<string, unknown> = {}) =>
  selectComposition({ serveUrl, id, inputProps, logLevel: "error", port: nextPort() });

export const renderFrameSet = async (
  r: Renderer,
  serveUrl: string,
  compositionId: string,
  jobs: FrameJob[],
  opts: { probe?: "probe" | "text" | "all" | false; settleMs?: number; concurrency?: number; scale?: number; jpeg?: boolean; inputProps?: Record<string, unknown>; onDone?: (f: FrameOut, i: number) => void } = {},
): Promise<FrameOut[]> => {
  const inputProps: Record<string, unknown> = { ...(opts.inputProps ?? {}) };
  if (opts.probe) {
    inputProps.__harnessProbe = opts.probe;
    inputProps.__harnessSettleMs = opts.settleMs ?? 150;
  }
  // the probe flag stays out of composition selection, so the probe only runs for the frame render
  const composition = await getComposition(serveUrl, compositionId, opts.inputProps ?? {});
  return muteStdout(PROBE_MARK, () => pool(jobs, opts.concurrency ?? 4, async (job, i) => {
    ensureDir(join(job.file, ".."));
    const t0 = performance.now();
    let probe: ProbeResult | undefined;
    await renderStill({
      composition,
      serveUrl,
      frame: job.frame,
      output: job.file,
      inputProps,
      imageFormat: opts.jpeg ? "jpeg" : "png",
      ...(opts.jpeg ? { jpegQuality: 90 } : {}),
      scale: opts.scale ?? 1,
      puppeteerInstance: r.browser,
      overwrite: true,
      logLevel: "error",
      port: nextPort(),
      chromiumOptions: {},
      onBrowserLog: (log) => {
        const t = log.text;
        const i = t.indexOf(PROBE_MARK);
        if (i >= 0) {
          try {
            probe = JSON.parse(t.slice(i + PROBE_MARK.length));
          } catch {
            probe = { viewport: { w: 0, h: 0 }, items: [], colors: [], error: "unparseable probe log" };
          }
        }
      },
    });
    const out: FrameOut = { ...job, ms: Math.round(performance.now() - t0), probe };
    opts.onDone?.(out, i);
    return out;
  }));
};
