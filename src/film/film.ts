/**
 * Scene segments with a cache, parts by concat, the film by mixing the timeline's
 * audio cues under it. A music change is a mux, not a render. A scene change
 * re-renders one segment.
 */
import { existsSync, writeFileSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { renderMedia } from "@remotion/renderer";
import type { LoadedConfig } from "../config.ts";
import { compositionFor, type Compiled, type CompiledPart, type CompiledScene, type AudioCue } from "../timeline/schema.ts";
import { resolve as resolveRef, resolveUnclamped } from "../timeline/resolve.ts";
import { getComposition, type Renderer } from "../render/frames.ts";
import { ensureDir, hashString, run, ffprobeDuration, ms, nextPort } from "../util.ts";

export type SegmentResult = { scene: CompiledScene; file: string; cached: boolean; ms: number };

export const segmentKey = (bundleHash: string, compositionId: string, s: CompiledScene, crf: number) =>
  hashString(JSON.stringify([bundleHash, compositionId, s.id, s.start, s.end, s.scene, crf]));

export const renderSegments = async (
  cfg: LoadedConfig,
  r: Renderer,
  serveUrl: string,
  bundleHash: string,
  c: Compiled,
  film: string,
  format: string,
  opts: { only?: string[]; crf?: number; log?: (s: string) => void; concurrency?: number; force?: boolean } = {},
): Promise<Map<string, SegmentResult[]>> => {
  const log = opts.log ?? (() => {});
  const crf = opts.crf ?? 18;
  const out = new Map<string, SegmentResult[]>();
  for (const part of c.parts) {
    const compId = compositionFor(part, format);
    const composition = await getComposition(serveUrl, compId);
    if (composition.durationInFrames !== part.dur) {
      throw new Error(`part "${part.id}": composition ${compId} has ${composition.durationInFrames} frames, timeline says ${part.dur}. Fix the timeline (or the composition) before rendering.`);
    }
    const dir = ensureDir(join(cfg.cachePath, "segments", `${film}-${format}`, part.id));
    const results: SegmentResult[] = [];
    for (const s of part.scenes) {
      const key = segmentKey(bundleHash, compId, s, crf);
      const file = join(dir, `${String(s.indexInPart).padStart(2, "0")}-${s.id}-${key}.mp4`);
      const wanted = !opts.only || opts.only.includes(s.id);
      if (existsSync(file) && !(opts.force && wanted)) {
        results.push({ scene: s, file, cached: true, ms: 0 });
        continue;
      }
      if (!wanted && !existsSync(file)) {
        // a scene we were told to skip has no cached segment: it must be rendered anyway
      }
      const t0 = performance.now();
      // video only: an AAC track per segment carries encoder padding, and concat would stretch the film by ~50 ms per scene
      await renderMedia({
        composition,
        serveUrl,
        codec: "h264",
        crf,
        outputLocation: file,
        frameRange: [s.start, s.end - 1],
        inputProps: {},
        puppeteerInstance: r.browser,
        concurrency: opts.concurrency ?? 4,
        logLevel: "error",
        overwrite: true,
        pixelFormat: "yuv420p",
        muted: true,
        port: nextPort(),
      });
      // drop stale segments of the same scene
      for (const f of readdirSync(dir)) if (f.startsWith(`${String(s.indexInPart).padStart(2, "0")}-${s.id}-`) && join(dir, f) !== file) unlinkSync(join(dir, f));
      const t = Math.round(performance.now() - t0);
      log(`  ${part.id}/${s.id} ${s.dur}f rendered in ${(t / 1000).toFixed(1)}s`);
      results.push({ scene: s, file, cached: false, ms: t });
    }
    out.set(part.id, results);
  }
  return out;
};

const blackSegment = async (file: string, w: number, h: number, seconds: number, fps: number) => {
  await run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", `color=black:s=${w}x${h}:r=${fps}:d=${seconds}`, "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", String(seconds), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", file]);
};

/** the sound a part carries itself (<Audio> tags in the composition), rendered once per bundle and cached */
export const renderPartAudio = async (
  cfg: LoadedConfig,
  r: Renderer,
  serveUrl: string,
  bundleHash: string,
  c: Compiled,
  film: string,
  format: string,
  opts: { log?: (s: string) => void; concurrency?: number } = {},
): Promise<Map<string, string>> => {
  const log = opts.log ?? (() => {});
  const out = new Map<string, string>();
  const dir = ensureDir(join(cfg.cachePath, "segments", `${film}-${format}`, "audio"));
  for (const part of c.parts) {
    const compId = compositionFor(part, format);
    const file = join(dir, `${part.id}-${hashString(bundleHash + compId)}.m4a`);
    if (!existsSync(file)) {
      const composition = await getComposition(serveUrl, compId);
      const t0 = performance.now();
      await renderMedia({ composition, serveUrl, codec: "aac", outputLocation: file, inputProps: {}, puppeteerInstance: r.browser, concurrency: opts.concurrency ?? 4, logLevel: "error", overwrite: true, port: nextPort() });
      for (const f of readdirSync(dir)) if (f.startsWith(`${part.id}-`) && join(dir, f) !== file) unlinkSync(join(dir, f));
      log(`  ${part.id} audio rendered in ${ms(t0)}`);
    }
    out.set(part.id, file);
  }
  return out;
};

export const concatParts = async (
  cfg: LoadedConfig,
  c: Compiled,
  segments: Map<string, SegmentResult[]>,
  partAudio: Map<string, string>,
  film: string,
  format: string,
  size: { width: number; height: number },
  opts: { log?: (s: string) => void } = {},
): Promise<string> => {
  const log = opts.log ?? (() => {});
  const dir = ensureDir(join(cfg.cachePath, "film"));
  const list: string[] = [];
  for (const part of c.parts) {
    if (part.gap > 0) {
      const g = join(dir, `gap-${part.id}-${part.gap}.mp4`);
      if (!existsSync(g)) await blackSegment(g, size.width, size.height, part.gap / c.fps, c.fps);
      list.push(g);
    }
    for (const s of segments.get(part.id) ?? []) list.push(s.file);
  }
  const listFile = join(dir, `${film}-${format}.txt`);
  writeFileSync(listFile, list.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n"));
  const picture = join(dir, `${film}-${format}-video.mp4`);
  const t0 = performance.now();
  await run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", "-an", picture]);
  // the parts' own sound, each trimmed to exactly its part length, gaps as silence
  const inputs: string[] = ["-i", picture];
  const chains: string[] = [];
  const cat: string[] = [];
  let i = 1;
  for (const part of c.parts) {
    if (part.gap > 0) {
      chains.push(`anullsrc=r=48000:cl=stereo:d=${(part.gap / c.fps).toFixed(3)}[g${i}]`);
      cat.push(`[g${i}]`);
    }
    const a = partAudio.get(part.id);
    if (a) {
      inputs.push("-i", a);
      chains.push(`[${i}:a]aresample=48000,atrim=0:${(part.dur / c.fps).toFixed(3)},apad=whole_dur=${(part.dur / c.fps).toFixed(3)},asetpts=N/SR/TB[p${i}]`);
      cat.push(`[p${i}]`);
      i++;
    } else {
      chains.push(`anullsrc=r=48000:cl=stereo:d=${(part.dur / c.fps).toFixed(3)}[p${i}]`);
      cat.push(`[p${i}]`);
      i++;
    }
  }
  const graph = `${chains.join(";")};${cat.join("")}concat=n=${cat.length}:v=0:a=1[a]`;
  const out = join(dir, `${film}-${format}-picture.mp4`);
  await run(["ffmpeg", "-y", "-v", "error", ...inputs, "-filter_complex", graph, "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "256k", out]);
  log(`concat ${list.length} segments + ${partAudio.size} audio track${partAudio.size === 1 ? "" : "s"} in ${ms(t0)}`);
  return out;
};

const volumeExpr = (cue: AudioCue, c: Compiled, startSec: number): string => {
  const g0 = cue.gain ?? 1;
  const ramps = (cue.ramps ?? []).map((r) => ({ at: resolveRef(c, r.at).filmSeconds - startSec, to: r.to, over: r.over ?? 0 })).sort((a, b) => a.at - b.at);
  let expr = String(g0);
  let prev = g0;
  // build from the last ramp inwards so the nesting reads left to right in time
  const parts: string[] = [];
  for (const r of ramps) {
    const from = prev;
    const seg = r.over > 0 ? `(${from}+(${r.to}-${from})*min(1,max(0,(t-${r.at.toFixed(3)})/${r.over})))` : String(r.to);
    parts.push(`if(lt(t,${r.at.toFixed(3)}),__PREV__,${seg})`);
    prev = r.to;
  }
  // nest: each later ramp wraps the earlier expression as its "__PREV__"
  expr = String(g0);
  for (const p of parts) expr = p.replace("__PREV__", expr);
  return expr;
};

export const mixFilm = async (
  cfg: LoadedConfig,
  c: Compiled,
  picture: string,
  film: string,
  format: string,
  opts: { out?: string; web?: boolean; log?: (s: string) => void; audioRoot?: string } = {},
): Promise<{ master: string; web?: string }> => {
  const log = opts.log ?? (() => {});
  const dir = ensureDir(join(cfg.cachePath, "out"));
  const master = opts.out ?? join(dir, `${film}-${format}.mp4`);
  const cues = c.timeline.audio ?? [];
  const total = c.seconds;
  if (!cues.length) {
    await run(["ffmpeg", "-y", "-v", "error", "-i", picture, "-c", "copy", master]);
  } else {
    const inputs: string[] = ["-i", picture];
    const chains: string[] = [];
    const mixIn: string[] = ["[0:a]"];
    let nextInput = 1;
    const pre: string[] = [];
    for (const [i, cue] of cues.entries()) {
      const file = cue.file.startsWith("/") ? cue.file : join(opts.audioRoot ?? cfg.projectDir, cue.file);
      if (!existsSync(file)) throw new Error(`audio cue "${cue.id}": file not found: ${file}`);
      // a cue may start before the film (e.g. "product - 9s" so the music's build lands on the product half): trim the head instead
      const raw = resolveUnclamped(c, cue.at).filmSeconds;
      const start = Math.max(0, raw);
      const headTrim = raw < 0 ? -raw : 0;
      const idx = i + 1;
      let src = `[${nextInput}:a]`;
      if (cue.loop) {
        // a loop is not a restart: the file is chained with itself under a crossfade, so the seam is never heard
        const xf = cue.loopCrossfade ?? 2;
        // a trimmed loop repeats the trimmed segment, so the trim goes on every copy before the crossfades
        const dur = cue.trim ? cue.trim[1] - cue.trim[0] : await ffprobeDuration(file);
        const need = total - start + headTrim;
        const copies = Math.max(2, Math.ceil(need / Math.max(1, dur - xf)) + 1);
        const labels: string[] = [];
        for (let k = 0; k < copies; k++) {
          inputs.push("-i", file);
          if (cue.trim) {
            pre.push(`[${nextInput + k}:a]atrim=${cue.trim[0]}:${cue.trim[1]},asetpts=N/SR/TB[t${idx}_${k}]`);
            labels.push(`[t${idx}_${k}]`);
          } else labels.push(`[${nextInput + k}:a]`);
        }
        let acc = labels[0];
        for (let k = 1; k < copies; k++) {
          const out = `[l${idx}_${k}]`;
          pre.push(`${acc}${labels[k]}acrossfade=d=${xf}:c1=tri:c2=tri${out}`);
          acc = out;
        }
        src = acc;
        nextInput += copies;
      } else {
        inputs.push("-i", file);
        nextInput += 1;
      }
      const f: string[] = [];
      if (cue.trim && !cue.loop) f.push(`atrim=${cue.trim[0]}:${cue.trim[1]}`, "asetpts=N/SR/TB");
      if (headTrim > 0) f.push(`atrim=start=${headTrim.toFixed(3)}`, "asetpts=N/SR/TB");
      f.push(`atrim=0:${(total - start).toFixed(3)}`, "asetpts=N/SR/TB");
      f.push(`volume='${volumeExpr(cue, c, start)}':eval=frame`);
      if (cue.fadeOut) f.push(`afade=t=out:st=${(total - start - cue.fadeOut).toFixed(3)}:d=${cue.fadeOut}`);
      const delay = Math.round(start * 1000);
      if (delay > 0) f.push(`adelay=${delay}|${delay}`);
      chains.push(`${src}${f.join(",")}[a${idx}]`);
      mixIn.push(`[a${idx}]`);
    }
    const graph = `${[...pre, ...chains].join(";")};${mixIn.join("")}amix=inputs=${mixIn.length}:normalize=0:duration=first[a]`;
    const t0 = performance.now();
    await run(["ffmpeg", "-y", "-v", "error", ...inputs, "-filter_complex", graph, "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "256k", master]);
    log(`mixed ${cues.length} cue${cues.length === 1 ? "" : "s"} in ${ms(t0)}`);
  }
  const res: { master: string; web?: string } = { master };
  if (opts.web) {
    const web = master.replace(/\.mp4$/, "-web.mp4");
    const t0 = performance.now();
    await run(["ffmpeg", "-y", "-v", "error", "-i", master, "-c:v", "libx264", "-preset", "medium", "-crf", "24", "-maxrate", "14M", "-bufsize", "28M", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", web]);
    log(`web copy in ${ms(t0)}`);
    res.web = web;
  }
  const d = await ffprobeDuration(master);
  if (Math.abs(d - total) > 0.2) log(`warning: film is ${d.toFixed(2)}s, timeline says ${total.toFixed(2)}s`);
  return res;
};

export const partDurationCheck = async (serveUrl: string, c: Compiled, format: string): Promise<{ part: CompiledPart; composition: string; actual: number; expected: number }[]> => {
  const out = [];
  for (const part of c.parts) {
    const id = compositionFor(part, format);
    const comp = await getComposition(serveUrl, id);
    out.push({ part, composition: id, actual: comp.durationInFrames, expected: part.dur });
  }
  return out;
};
