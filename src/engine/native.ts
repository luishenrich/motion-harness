/**
 * The native engine: Vite serves the film through the shim, Playwright drives
 * Chrome one frame at a time. A frame is a deterministic screenshot after every
 * delayRender handle is continued, fonts are ready, videos have seeked and two
 * animation frames have passed. Segments go straight into ffmpeg over a pipe.
 */
import { existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from "playwright-core";
import sharp from "sharp";
import type { LoadedConfig } from "../config.ts";
import type { FrameJob, FrameOut, ProbeResult } from "../render/frames.ts";
import { clearFrameFiles, type CompositionInfo, type Engine, type Quality, type SegmentOpts, type StillOpts } from "../render/engine.ts";
import { currentBundleHash } from "../render/bundle.ts";
import { PROBE_MEASURE_SOURCE } from "../probe/inject.ts";
import { ensureDir, pool } from "../util.ts";
import { startVite, type ViteHost } from "./vite.ts";

const HARNESS_ROOT = resolve(import.meta.dir, "../..");

/** a Chrome to drive: the project's or the harness's Remotion headless shell, else Playwright's own, else installed Chrome */
export const findChrome = (cfg: LoadedConfig): { executablePath?: string; channel?: "chrome" } => {
  const explicit = process.env.MH_CHROME;
  if (explicit && existsSync(explicit)) return { executablePath: explicit };
  const shells = (root: string): string[] => {
    const base = join(root, "node_modules", ".remotion", "chrome-headless-shell");
    if (!existsSync(base)) return [];
    const out: string[] = [];
    const walk = (d: string, depth: number) => {
      if (depth > 4) return;
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (n === "chrome-headless-shell" && statSync(p).isFile()) out.push(p);
        else if (statSync(p).isDirectory()) walk(p, depth + 1);
      }
    };
    walk(base, 0);
    return out;
  };
  let dir = cfg.projectDir;
  for (let i = 0; i < 6; i++) {
    const s = shells(dir);
    if (s.length) return { executablePath: s[0] };
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  const own = shells(HARNESS_ROOT);
  if (own.length) return { executablePath: own[0] };
  const cache = join(process.env.HOME ?? "", "Library", "Caches", "ms-playwright");
  if (existsSync(cache)) return {};
  return { channel: "chrome" };
};

type Slot = { page: Page; context: BrowserContext; cdp: CDPSession; comp: string; scale: number; busy: boolean };

class NativeEngine implements Engine {
  readonly kind = "native" as const;
  readonly hash: string;
  private slots: Slot[] = [];
  private compsCache: CompositionInfo[] | null = null;
  private warnedAudio = new Set<string>();
  constructor(private cfg: LoadedConfig, private vite: ViteHost, private browser: Browser, private log: (s: string) => void) {
    this.hash = currentBundleHash(cfg);
  }

  private async newPage(comp: string, size: { width: number; height: number }, scale: number, inputProps: Record<string, unknown>): Promise<Slot> {
    const context = await this.browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: scale, reducedMotion: "no-preference" });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e.message ?? e)));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    await page.goto(`${this.vite.url}/__mh/`, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => Boolean((window as unknown as { __mh?: unknown }).__mh), null, { timeout: 60000 });
    try {
      await page.evaluate(() => window.__mh.ready);
    } catch (e) {
      throw new Error(`the film did not mount in the native engine: ${(e as Error).message}${errors.length ? `\npage errors:\n${errors.slice(0, 5).join("\n")}` : ""}`);
    }
    await page.addScriptTag({ content: `${PROBE_MEASURE_SOURCE}\nwindow.__mh.measure = __measure;` });
    await page.evaluate(([id, props]) => window.__mh.select(id as string, props as Record<string, unknown>), [comp, inputProps] as const);
    if (errors.length) this.log(`warning: ${comp}: ${errors.length} page error${errors.length === 1 ? "" : "s"}, first: ${errors[0].slice(0, 200)}`);
    // screenshots go straight over the devtools protocol: Playwright's screenshot pipeline waits and re-checks per call
    const cdp = await context.newCDPSession(page);
    await cdp.send("Page.enable");
    return { page, context, cdp, comp, scale, busy: false };
  }

  /** up to `n` pages on one composition, reused across calls */
  private async acquire(comp: string, n: number, scale: number, inputProps: Record<string, unknown>): Promise<Slot[]> {
    const info = await this.composition(comp);
    const have = this.slots.filter((s) => s.comp === comp && s.scale === scale && !s.busy);
    while (have.length < n) {
      // keep the browser at a sane size: drop idle pages of other compositions first
      const idle = this.slots.filter((s) => !s.busy && (s.comp !== comp || s.scale !== scale));
      if (this.slots.length >= 12 && idle.length) {
        const drop = idle[0];
        this.slots = this.slots.filter((s) => s !== drop);
        await drop.context.close();
      }
      const slot = await this.newPage(comp, info, scale, inputProps);
      this.slots.push(slot);
      have.push(slot);
    }
    return have.slice(0, n);
  }

  async compositions(): Promise<CompositionInfo[]> {
    if (this.compsCache) return this.compsCache;
    const context = await this.browser.newContext({ viewport: { width: 320, height: 180 } });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e.message ?? e)));
    await page.goto(`${this.vite.url}/__mh/`, { waitUntil: "load" });
    await page.waitForFunction(() => Boolean((window as unknown as { __mh?: unknown }).__mh), null, { timeout: 60000 });
    try {
      await page.evaluate(() => window.__mh.ready);
    } catch (e) {
      throw new Error(`the film did not mount in the native engine: ${(e as Error).message}${errors.length ? `\npage errors:\n${errors.slice(0, 5).join("\n")}` : ""}`);
    }
    const list = (await page.evaluate(() => window.__mh.compositions())) as CompositionInfo[];
    await context.close();
    this.compsCache = list.map((c) => ({ id: c.id, width: c.width, height: c.height, fps: c.fps, durationInFrames: c.durationInFrames, defaultProps: c.defaultProps ?? {} }));
    return this.compsCache;
  }

  async composition(id: string): Promise<CompositionInfo> {
    const c = (await this.compositions()).find((k) => k.id === id);
    if (!c) throw new Error(`no composition "${id}" (registered: ${(await this.compositions()).map((k) => k.id).join(", ")})`);
    return c;
  }

  private async shot(slot: Slot, frame: number, settleMs: number, jpeg: boolean, quality = 90): Promise<{ buf: Buffer; audioTags: number; ms: number }> {
    const r = (await slot.page.evaluate(([n, s]) => window.__mh.frame(n as number, s as number), [frame, settleMs] as const)) as { frame: number; audioTags: number; ms: number };
    const shot = await slot.cdp.send("Page.captureScreenshot", { format: jpeg ? "jpeg" : "png", ...(jpeg ? { quality } : {}), fromSurface: true, captureBeyondViewport: false, optimizeForSpeed: true });
    const buf = Buffer.from(shot.data, "base64");
    if (r.audioTags > 0 && !this.warnedAudio.has(slot.comp)) {
      this.warnedAudio.add(slot.comp);
      this.log(`warning: ${slot.comp} mounts ${r.audioTags} <Audio> tag${r.audioTags === 1 ? "" : "s"}; the native engine renders no composition sound, declare it as timeline cues (part.audio: false)`);
    }
    return { buf, audioTags: r.audioTags, ms: r.ms };
  }

  async stills(comp: string, jobs: FrameJob[], opts: StillOpts = {}): Promise<FrameOut[]> {
    const n = Math.max(1, Math.min(opts.concurrency ?? 4, jobs.length));
    const slots = await this.acquire(comp, n, opts.scale ?? 1, opts.inputProps ?? {});
    const settle = opts.probe ? (opts.settleMs ?? 150) : 0;
    const outs = await pool(jobs, n, async (job, i) => {
      const slot = slots[i % n];
      // one page renders one frame at a time; a worker index maps to a page
      while (slot.busy) await new Promise((r) => setTimeout(r, 2));
      slot.busy = true;
      try {
        const t0 = performance.now();
        const { buf } = await this.shot(slot, job.frame, settle, !!opts.jpeg);
        ensureDir(join(job.file, ".."));
        writeFileSync(job.file, buf);
        let probe: ProbeResult | undefined;
        if (opts.probe) {
          try {
            probe = (await slot.page.evaluate((m) => window.__mh.probe(m as "probe" | "text" | "all", 0), opts.probe)) as ProbeResult;
          } catch (e) {
            probe = { viewport: { w: 0, h: 0 }, items: [], colors: [], error: String((e as Error).message ?? e) };
          }
        }
        const out: FrameOut = { ...job, ms: Math.round(performance.now() - t0), probe };
        opts.onDone?.(out, i);
        return out;
      } finally {
        slot.busy = false;
      }
    });
    return outs;
  }

  /** frames in order into a sink, rendered by up to `concurrency` pages; the sink sees frame k only after k-1 */
  private async stream(comp: string, [from, to]: [number, number], scale: number, jpeg: boolean, quality: number, concurrency: number, inputProps: Record<string, unknown>, sink: (index: number, buf: Buffer) => Promise<void> | void): Promise<void> {
    const total = to - from + 1;
    const n = Math.max(1, Math.min(concurrency, total));
    const slots = await this.acquire(comp, n, scale, inputProps);
    const ready = new Map<number, Buffer>();
    let next = 0;
    let sinkError: Error | null = null;
    let flushing = Promise.resolve();
    const flush = () => {
      flushing = flushing.then(async () => {
        while (ready.has(next) && !sinkError) {
          const buf = ready.get(next)!;
          ready.delete(next);
          try {
            await sink(next, buf);
          } catch (e) {
            sinkError = e as Error;
          }
          next++;
        }
      });
      return flushing;
    };
    // each page walks its own stride so seeks in a video clip stay short and forward
    await Promise.all(
      slots.map(async (slot, k) => {
        slot.busy = true;
        try {
          for (let i = k; i < total; i += n) {
            if (sinkError) break;
            // back-pressure: never more than 3 strides ahead of the writer
            while (i - next > n * 3 && !sinkError) await new Promise((r) => setTimeout(r, 4));
            const { buf } = await this.shot(slot, from + i, 0, jpeg, quality);
            ready.set(i, buf);
            void flush();
          }
        } finally {
          slot.busy = false;
        }
      }),
    );
    await flush();
    if (sinkError) throw sinkError;
  }

  async segment(comp: string, range: [number, number], file: string, q: Quality, opts: SegmentOpts = {}): Promise<void> {
    const info = await this.composition(comp);
    ensureDir(join(file, ".."));
    const jpeg = q.scale < 1; // a draft trades lossless frames for speed; a delivery keeps png into x264
    const args = ["-y", "-v", "error", "-f", "image2pipe", "-framerate", String(info.fps), "-i", "-", "-an"];
    if (q.hw && process.platform === "darwin") args.push("-c:v", "h264_videotoolbox", "-q:v", String(Math.max(1, Math.min(100, Math.round(100 - q.crf * 2)))), "-realtime", "false");
    else args.push("-c:v", "libx264", "-preset", q.preset, "-crf", String(q.crf));
    args.push("-pix_fmt", "yuv420p", "-movflags", "+faststart", file);
    const proc = Bun.spawn(["ffmpeg", ...args], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    const errText = new Response(proc.stderr).text();
    try {
      await this.stream(comp, range, q.scale, jpeg, 92, opts.concurrency ?? 4, opts.inputProps ?? {}, async (_i, buf) => {
        proc.stdin.write(buf);
        await proc.stdin.flush();
      });
    } finally {
      proc.stdin.end();
    }
    const code = await proc.exited;
    if (code !== 0) throw new Error(`ffmpeg failed encoding ${file}: ${(await errText).slice(-800)}`);
  }

  async frames(comp: string, range: [number, number], outDir: string, opts: { width: number; jpegQuality?: number; concurrency?: number; inputProps?: Record<string, unknown> }): Promise<string[]> {
    const info = await this.composition(comp);
    clearFrameFiles(outDir);
    ensureDir(outDir);
    const scale = Math.min(1, opts.width / info.width);
    const files: string[] = [];
    await this.stream(comp, range, scale, true, opts.jpegQuality ?? 70, opts.concurrency ?? 4, opts.inputProps ?? {}, async (i, buf) => {
      const f = join(outDir, `element-${String(i).padStart(4, "0")}.jpeg`);
      // a fractional device scale can land one pixel off the requested width: normalise
      const meta = await sharp(buf).metadata();
      if (meta.width !== opts.width) await sharp(buf).resize({ width: opts.width }).jpeg({ quality: opts.jpegQuality ?? 70 }).toFile(f);
      else writeFileSync(f, buf);
      files.push(f);
    });
    return files;
  }

  async audio(comp: string): Promise<void> {
    throw new Error(`native engine: composition "${comp}" cannot render its own sound. Declare the part with audio: false and put music and sfx in the timeline's audio cues.`);
  }

  async close(): Promise<void> {
    for (const s of this.slots) await s.context.close().catch(() => {});
    this.slots = [];
    await this.browser.close().catch(() => {});
    await this.vite.close().catch(() => {});
  }
}

export const openNative = async (cfg: LoadedConfig, opts: { log?: (s: string) => void } = {}): Promise<Engine> => {
  const log = opts.log ?? (() => {});
  const t0 = performance.now();
  const vite = await startVite(cfg, { log });
  const where = findChrome(cfg);
  // the same rasterisation flags Remotion launches Chrome with, so a frame is the same pixels on both engines
  const defaultArgs = ["--disable-dev-shm-usage", "--font-render-hinting=none", "--force-color-profile=srgb", "--hide-scrollbars", "--autoplay-policy=no-user-gesture-required", "--disable-background-media-suspend", "--force-gpu-mem-available-mb=4096"];
  const args = [...(process.env.MH_CHROME_NO_DEFAULT_ARGS ? [] : defaultArgs), ...(process.env.MH_CHROME_ARGS ? process.env.MH_CHROME_ARGS.split(/\s+/).filter(Boolean) : [])];
  const browser = await chromium.launch({ headless: true, ...where, args }).catch((e) => {
    throw new Error(`could not launch Chrome for the native engine (${where.executablePath ?? where.channel ?? "playwright default"}): ${(e as Error).message}. Set MH_CHROME to a Chrome binary or run: bunx playwright install chromium`);
  });
  log(`native engine up in ${((performance.now() - t0) / 1000).toFixed(1)}s (${where.executablePath ? "remotion headless shell" : where.channel ?? "playwright chromium"})`);
  return new NativeEngine(cfg, vite, browser, log);
};
