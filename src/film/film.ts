/**
 * Scene segments with a cache, parts by concat, the film by mixing the timeline's
 * audio cues under it. A music change is a mux, not a render. A scene change
 * re-renders one segment.
 */
import { existsSync, writeFileSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { LoadedConfig } from "../config.ts";
import { compositionFor, type Compiled, type CompiledPart, type CompiledScene, type AudioCue } from "../timeline/schema.ts";
import { resolve as resolveRef, resolveUnclamped } from "../timeline/resolve.ts";
import { cuesInSpan, volumeExprFor, type Span } from "./mix.ts";
import { partHash } from "../render/deps.ts";
import { FULL, DRAFT, type Engine, type Quality } from "../render/engine.ts";
import { ensureDir, hashString, run, ffprobeDuration, ms, mediaStats, statsLine } from "../util.ts";
import { cuePlacement, cueSpan, sourceSeconds } from "../audio/coverage.ts";

export type SegmentResult = { scene: CompiledScene; file: string; cached: boolean; ms: number };

export { FULL, DRAFT, type Quality };
export const segmentKey = (sourceHash: string, compositionId: string, s: CompiledScene, q: Quality) =>
  hashString(JSON.stringify([sourceHash, compositionId, s.id, s.start, s.end, s.scene, q]));

export const renderSegments = async (
  cfg: LoadedConfig,
  e: Engine,
  c: Compiled,
  film: string,
  format: string,
  opts: { only?: string[]; subset?: string[]; quality?: Quality; log?: (s: string) => void; concurrency?: number; force?: boolean } = {},
): Promise<Map<string, SegmentResult[]>> => {
  const log = opts.log ?? (() => {});
  const q = opts.quality ?? FULL;
  const out = new Map<string, SegmentResult[]>();
  for (const part of c.parts) {
    // subset: only these scenes exist for this call (a preview); the others are neither rendered nor listed
    const wantedScenes = opts.subset ? part.scenes.filter((s) => opts.subset!.includes(s.id)) : part.scenes;
    if (!wantedScenes.length) continue;
    const compId = compositionFor(part, format);
    const composition = await e.composition(compId);
    if (composition.durationInFrames !== part.dur) {
      throw new Error(`part "${part.id}": composition ${compId} has ${composition.durationInFrames} frames, timeline says ${part.dur}. Fix the timeline (or the composition) before rendering.`);
    }
    const dir = ensureDir(join(cfg.cachePath, "segments", `${film}-${format}${q.scale === 1 ? "" : "-draft"}`, part.id));
    // the key follows the part's own sources when it declares them, else the whole bundle
    // the engine is part of the key: the same sources rendered by the other engine are other pixels
    const sourceHash = `${e.kind}:${partHash(cfg, part, e.hash)}`;
    const results: SegmentResult[] = [];
    for (const s of wantedScenes) {
      const key = segmentKey(sourceHash, compId, s, q);
      const file = join(dir, `${String(s.indexInPart).padStart(2, "0")}-${s.id}-${key}.mp4`);
      const wanted = !opts.only || opts.only.includes(s.id);
      if (existsSync(file) && !(opts.force && wanted)) {
        results.push({ scene: s, file, cached: true, ms: 0 });
        continue;
      }
      // a scene outside --scene with no cached segment is rendered anyway: the film needs every segment
      const t0 = performance.now();
      // video only: an AAC track per segment carries encoder padding, and concat would stretch the film by ~50 ms per scene
      await e.segment(compId, [s.start, s.end - 1], file, q, { concurrency: opts.concurrency ?? 4, log });
      // drop stale segments of the same scene
      for (const f of readdirSync(dir)) if (f.startsWith(`${String(s.indexInPart).padStart(2, "0")}-${s.id}-`) && join(dir, f) !== file) unlinkSync(join(dir, f));
      const t = Math.round(performance.now() - t0);
      const fps = (s.dur / (t / 1000));
      if (fps < 8) log(`  SLOW ${compId}/${s.id}: ${fps.toFixed(1)} f/s (video decode, blur or filters in this scene; see mh bench)`);
      const st = await mediaStats(file);
      log(`  ${part.id}/${s.id} ${s.dur}f rendered in ${(t / 1000).toFixed(1)}s: ${statsLine(st)}`);
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
  e: Engine,
  c: Compiled,
  film: string,
  format: string,
  opts: { log?: (s: string) => void; concurrency?: number; parts?: string[] } = {},
): Promise<Map<string, string>> => {
  const log = opts.log ?? (() => {});
  const out = new Map<string, string>();
  const dir = ensureDir(join(cfg.cachePath, "segments", `${film}-${format}`, `audio-${e.kind}`));
  for (const part of c.parts) {
    if (opts.parts && !opts.parts.includes(part.id)) continue;
    if (!part.audio) continue; // the part says it is silent: the concat pads it with silence
    const compId = compositionFor(part, format);
    const file = join(dir, `${part.id}-${hashString(partHash(cfg, part, e.hash) + compId)}.m4a`);
    if (!existsSync(file)) {
      const t0 = performance.now();
      await e.audio(compId, file, { concurrency: opts.concurrency ?? 4 });
      for (const f of readdirSync(dir)) if (f.startsWith(`${part.id}-`) && join(dir, f) !== file) unlinkSync(join(dir, f));
      log(`  ${part.id} audio rendered in ${ms(t0)}`);
    }
    out.set(part.id, file);
  }
  return out;
};

/** where concatParts leaves the picture (segments + the parts' own sound, no timeline cues yet) */
export const picturePath = (cfg: LoadedConfig, film: string, format: string, engine: "remotion" | "native" = "remotion") => join(cfg.cachePath, "film", `${film}-${format}${engine === "native" ? "-native" : ""}-picture.mp4`);

/**
 * A preview clip: the segments of a contiguous run of scenes, the parts' own sound
 * trimmed to those scenes, a part gap inside the run as black. Returns the picture and
 * the film span it covers, so the mix can place the cues.
 */
export const concatScenes = async (
  cfg: LoadedConfig,
  c: Compiled,
  scenes: CompiledScene[],
  segments: Map<string, SegmentResult[]>,
  partAudio: Map<string, string>,
  film: string,
  format: string,
  size: { width: number; height: number },
  opts: { log?: (s: string) => void; name?: string } = {},
): Promise<{ picture: string; span: Span }> => {
  const log = opts.log ?? (() => {});
  const ordered = [...scenes].sort((a, b) => a.index - b.index);
  if (!ordered.length) throw new Error("preview needs at least one scene");
  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i].index !== ordered[i - 1].index + 1) throw new Error(`preview scenes must be contiguous: ${ordered[i - 1].id} (#${ordered[i - 1].index}) is not followed by ${ordered[i].id} (#${ordered[i].index})`);
  }
  const dir = ensureDir(join(cfg.cachePath, "film"));
  const name = opts.name ?? `${film}-${format}-preview-${ordered.map((s) => s.id).join("+")}`;
  const sec = (f: number) => (f / c.fps).toFixed(3);
  const list: string[] = [];
  const inputs: string[] = [];
  const chains: string[] = [];
  const cat: string[] = [];
  let i = 1;
  for (const [k, s] of ordered.entries()) {
    const part = c.parts.find((p) => p.id === s.part)!;
    if (k > 0 && s.indexInPart === 0 && part.gap > 0) {
      const g = join(dir, `gap-${part.id}-${part.gap}.mp4`);
      if (!existsSync(g)) await blackSegment(g, size.width, size.height, part.gap / c.fps, c.fps);
      list.push(g);
      chains.push(`anullsrc=r=48000:cl=stereo:d=${sec(part.gap)}[g${i}]`);
      cat.push(`[g${i}]`);
    }
    const seg = (segments.get(part.id) ?? []).find((r) => r.scene.id === s.id);
    if (!seg) throw new Error(`no segment for scene ${s.id}`);
    list.push(seg.file);
    const a = partAudio.get(part.id);
    if (a) {
      inputs.push("-i", a);
      chains.push(`[${i}:a]aresample=48000,atrim=${sec(s.start)}:${sec(s.end)},asetpts=N/SR/TB,apad=whole_dur=${sec(s.dur)}[p${i}]`);
    } else chains.push(`anullsrc=r=48000:cl=stereo:d=${sec(s.dur)}[p${i}]`);
    cat.push(`[p${i}]`);
    i++;
  }
  const listFile = join(dir, `${name}.txt`);
  writeFileSync(listFile, list.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n"));
  const video = join(dir, `${name}-video.mp4`);
  const t0 = performance.now();
  await run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", "-an", video]);
  const graph = `${chains.join(";")};${cat.join("")}concat=n=${cat.length}:v=0:a=1[a]`;
  const picture = join(dir, `${name}-picture.mp4`);
  await run(["ffmpeg", "-y", "-v", "error", "-i", video, ...inputs, "-filter_complex", graph, "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "256k", picture]);
  // the clip starts at the first scene's start (a gap before it belongs to the previous run, not to the clip)
  const span: Span = { start: ordered[0].filmStart / c.fps, end: ordered[ordered.length - 1].filmEnd / c.fps };
  log(`preview ${ordered.map((s) => s.id).join("+")}: ${list.length} segment${list.length === 1 ? "" : "s"}, film ${span.start.toFixed(2)}s-${span.end.toFixed(2)}s in ${ms(t0)}`);
  return { picture, span };
};

export const concatParts = async (
  cfg: LoadedConfig,
  c: Compiled,
  segments: Map<string, SegmentResult[]>,
  partAudio: Map<string, string>,
  film: string,
  format: string,
  size: { width: number; height: number },
  opts: { log?: (s: string) => void; engine?: "remotion" | "native" } = {},
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
  const out = picturePath(cfg, film, format, opts.engine ?? "remotion");
  await run(["ffmpeg", "-y", "-v", "error", ...inputs, "-filter_complex", graph, "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "256k", out]);
  log(`concat ${list.length} segments + ${partAudio.size} audio track${partAudio.size === 1 ? "" : "s"} in ${ms(t0)}`);
  return out;
};

export const mixFilm = async (
  cfg: LoadedConfig,
  c: Compiled,
  picture: string,
  film: string,
  format: string,
  opts: { out?: string; web?: boolean; log?: (s: string) => void; audioRoot?: string; span?: Span } = {},
): Promise<{ master: string; web?: string }> => {
  const log = opts.log ?? (() => {});
  const dir = ensureDir(join(cfg.cachePath, "out"));
  const master = opts.out ?? join(dir, `${film}-${format}.mp4`);
  // the film span the picture covers: the whole film, or a preview clip that starts mid-film
  const span: Span = opts.span ?? { start: 0, end: c.seconds };
  const total = span.end - span.start;
  const atFilmEnd = Math.abs(span.end - c.seconds) < 1e-3;
  const cueFile = (cue: AudioCue) => (cue.file.startsWith("/") ? cue.file : join(opts.audioRoot ?? cfg.projectDir, cue.file));
  const fileSeconds: Record<string, number> = {};
  for (const cue of c.timeline.audio ?? []) {
    if (!existsSync(cueFile(cue))) throw new Error(`audio cue "${cue.id}": file not found: ${cueFile(cue)}`);
    if (!cue.loop && !cue.trim) fileSeconds[cue.id] = await ffprobeDuration(cueFile(cue));
  }
  const cues = cuesInSpan(c.timeline.audio ?? [], c, span, fileSeconds);
  if (opts.span) log(`cues sounding in ${span.start.toFixed(2)}s-${span.end.toFixed(2)}s: ${cues.map((q) => q.id).join(", ") || "none"}`);
  if (!cues.length) {
    await run(["ffmpeg", "-y", "-v", "error", "-i", picture, "-c", "copy", master]);
  } else {
    const inputs: string[] = ["-i", picture];
    const chains: string[] = [];
    const mixIn: string[] = ["[0:a]"];
    let nextInput = 1;
    const pre: string[] = [];
    for (const [i, cue] of cues.entries()) {
      const file = cueFile(cue);
      // a cue may start before the clip (before the film, or before a preview's first scene): trim the head instead
      const raw = cuePlacement(c, cue).raw - span.start;
      const start = Math.max(0, raw);
      const headTrim = raw < 0 ? -raw : 0;
      const idx = i + 1;
      let src = `[${nextInput}:a]`;
      if (cue.loop) {
        // a loop is not a restart: the file is chained with itself under a crossfade, so the seam is never heard
        const xf = cue.loopCrossfade ?? 2;
        // a trimmed loop repeats the trimmed segment, so the trim goes on every copy before the crossfades
        const dur = sourceSeconds(cue, cue.trim ? 0 : await ffprobeDuration(file));
        const { copies } = cueSpan({ start, headTrim, sourceDur: dur, total, loop: true, loopCrossfade: xf });
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
      f.push(`volume='${volumeExprFor(cue, c, span, start)}':eval=frame`);
      // the fade-out belongs to the film's end; a preview that stops earlier keeps the bed running
      if (cue.fadeOut && atFilmEnd) f.push(`afade=t=out:st=${(total - start - cue.fadeOut).toFixed(3)}:d=${cue.fadeOut}`);
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

export const partDurationCheck = async (e: Engine, c: Compiled, format: string): Promise<{ part: CompiledPart; composition: string; actual: number; expected: number }[]> => {
  const out = [];
  for (const part of c.parts) {
    const id = compositionFor(part, format);
    const comp = await e.composition(id);
    out.push({ part, composition: id, actual: comp.durationInFrames, expected: part.dur });
  }
  return out;
};
