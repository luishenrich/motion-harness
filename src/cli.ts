#!/usr/bin/env bun
/**
 * mh: the agent's hands and eyes around a Remotion project.
 *
 *   mh timeline | resolve | docs | doctor
 *   mh frames | sheet | probe | lint | diff | motion | audio
 *   mh render | review | feedback
 */
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync, rmSync, cpSync } from "node:fs";
import { join, resolve as resolvePath, basename, dirname } from "node:path";
import { loadConfig, pickFilm, pickFormat, resolveProjectDir, type LoadedConfig } from "./config.ts";
import { compile, compositionFor, fmtTime, type Compiled, type CompiledScene } from "./timeline/schema.ts";
import { resolve as resolveRef, checkFramesFor, type CheckFrame } from "./timeline/resolve.ts";
import { timelineMarkdown, timelineJson } from "./timeline/docs.ts";
import { bundleProject, staleBundleWarnings, projectSrcDir, currentBundleHash, isStale } from "./render/bundle.ts";
import { frameFile, type ProbeResult } from "./render/frames.ts";
import { openEngine, engineKindOf, closeEngines, type Engine } from "./render/engine.ts";
import { measureLegs, writeTargets } from "./cursor/cursor.ts";
import { makeSheet, zoomWindow, type SheetCell } from "./sheet/sheet.ts";
import { parseFeedback, feedbackReport } from "./review/parse.ts";
import { hashFrames, queryViews, bestMatches, refineFit, type Fit } from "./locate/locate.ts";
import sharp from "sharp";
import { lintStaticColors, lintTimeline, lintProbe, lintFormatParity, cursorLegFrames, formatFindings, type Finding, type ProbeFrame } from "./lint/lint.ts";
import { diffSets, diffImages } from "./diff/diff.ts";
import { measureScene, sparkline } from "./motion/metrics.ts";
import { audioProfile, rmsAt, db, loudSpan } from "./audio/probe.ts";
import { cueAudibility, highpass, headProfile, audibleFrom, AUDIBILITY_SR } from "./audio/audibility.ts";
import { srtEntries, srtText, chapterLines } from "./srt/srt.ts";
import { listStills, pickStills, renderStills, stillSheet } from "./still/still.ts";
import { deliver, uploadTargetFromEnv } from "./deliver/deliver.ts";
import { startReceipt, endReceipt, receiptDir, produced } from "./receipts/receipts.ts";
import { measureLoudness, PLATFORM_TARGETS, loudnessVerdict } from "./audio/loudness.ts";
import { burnCaptions } from "./srt/burn.ts";
import { runVoice } from "./voice/voice.ts";
import { addClip, loadClips, lintClips, clipCost } from "./clips/clips.ts";
import { judgeClip, judgePrompt, DEFAULT_CHECKLIST } from "./judge/judge.ts";
import { measureReference, compareCurves } from "./motion/metrics.ts";
import { decodeMono, onsetStrength, pickOnsets, beatGrid, nearest } from "./audio/beats.ts";
import { spanOf, cuePlacement } from "./audio/coverage.ts";
import { analyzeFile, looksLikeHit, hitWarnings, type SfxAnalysis } from "./audio/sfx.ts";
import { vetDurations } from "./audio/suggest.ts";
import { resolveUnclamped, locate } from "./timeline/resolve.ts";
import { renderSegments, renderPartAudio, concatParts, concatScenes, mixFilm, partDurationCheck, picturePath, FULL, DRAFT } from "./film/film.ts";
import { cpus } from "node:os";
import { startReviewServer, loadComments, feedbackMarkdown, commentsPath } from "./review/server.ts";
import { reviewPage } from "./review/export.ts";
import { ensureDir, readJson, writeJson, stamp, table, ms, run, dirSize, mb, withLock, ffprobeDuration, mediaStats, statsLine } from "./util.ts";

/* ---------- args ---------- */

type Args = { _: string[]; [k: string]: string | boolean | string[] };
const parseArgs = (argv: string[]): Args => {
  const a: Args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x.startsWith("--")) {
      const [k, v] = x.slice(2).split("=");
      if (v !== undefined) a[k] = v;
      else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) a[k] = argv[++i];
      else a[k] = true;
    } else a._.push(x);
  }
  return a;
};
const str = (a: Args, k: string, d?: string) => (typeof a[k] === "string" ? (a[k] as string) : d);
const num = (a: Args, k: string, d: number) => (typeof a[k] === "string" ? parseFloat(a[k] as string) : d);
const flag = (a: Args, k: string) => a[k] === true || a[k] === "true";
const list = (a: Args, k: string): string[] | undefined => (typeof a[k] === "string" ? (a[k] as string).split(",").map((s) => s.trim()).filter(Boolean) : undefined);

/* with --json every other line goes to stderr, so stdout is one parseable document */
const JSON_MODE = process.argv.includes("--json");
const log = (s: string) => (JSON_MODE ? console.error(s) : console.log(s));
const out = (s: string) => console.log(s);
const die = (s: string): never => {
  console.error(`mh: ${s}`);
  // engines hold a browser and a dev server: let them go before the process does
  void closeEngines().finally(() => process.exit(1));
  throw new Error(s);
};

/* ---------- context ---------- */

type Ctx = { cfg: LoadedConfig; filmName: string; c: Compiled; format: string; size: { width: number; height: number }; args: Args };

/** --project, MH_PROJECT, the cwd, or the last project used; says so once when it was not the flag or the cwd */
let projectNoted = false;
const projectDirOf = (args: Args): string => {
  const { dir, from } = resolveProjectDir(str(args, "project"));
  if (!projectNoted && (from === "env" || from === "last")) {
    projectNoted = true;
    log(`project: ${dir} (from ${from === "env" ? "MH_PROJECT" : "the last project used; pass --project to change"})`);
  }
  return dir;
};

const ctx = async (args: Args): Promise<Ctx> => {
  const cfg = await loadConfig(projectDirOf(args));
  receiptDir(cfg.cachePath, cfg.projectDir, currentBundleHash(cfg), engineKindOf(cfg, str(args, "engine")));
  const { name: filmName, film } = pickFilm(cfg, str(args, "film"));
  const format = pickFormat(film, str(args, "format"));
  return { cfg, filmName, c: compile(film.timeline), format, size: film.formats[format], args };
};

/** "--format all" fans a command out over every format of the film; everything else is one format */
const formatsOf = async (args: Args): Promise<string[]> => {
  const cfg = await loadConfig(projectDirOf(args));
  const { film } = pickFilm(cfg, str(args, "film"));
  const f = str(args, "format");
  return f === "all" ? Object.keys(film.formats) : [pickFormat(film, f)];
};
const eachFormat = async (args: Args, fn: (a: Args) => Promise<void>) => {
  for (const format of await formatsOf(args)) await fn({ ...args, format });
};

const scenesOf = (c: Compiled, args: Args): CompiledScene[] => {
  const only = list(args, "scene");
  const part = str(args, "part");
  let s = c.scenes;
  if (part) s = s.filter((x) => x.part === part);
  if (only) {
    const missing = only.filter((id) => !c.scenes.some((x) => x.id === id));
    if (missing.length) die(`unknown scene(s): ${missing.join(", ")}. Scenes: ${c.scenes.map((x) => x.id).join(", ")}`);
    s = s.filter((x) => only.includes(x.id));
  }
  return s;
};

const runsDir = (x: Ctx) => ensureDir(join(x.cfg.cachePath, "frames", `${x.filmName}-${x.format}`));
const latestTag = (x: Ctx): string | null => {
  const f = join(runsDir(x), "latest");
  return existsSync(f) ? readFileSync(f, "utf8").trim() : null;
};

type Manifest = {
  film: string;
  format: string;
  tag: string;
  createdAt: string;
  bundleHash: string;
  probe: string | false;
  frames: { file: string; part: string; composition: string; scene: string; local: number; partFrame: number; filmFrame: number; kind: CheckFrame["kind"]; label: string; probeFile?: string; ms: number }[];
};

const APPROVED = "approved";
/** timestamped runs, oldest first; "latest" is a pointer file and "approved" a copy, neither is a run in this list */
const runTags = (x: Ctx) => readdirSync(runsDir(x)).filter((d) => d !== "latest" && d !== APPROVED && existsSync(join(runsDir(x), d, "manifest.json"))).sort();
const hasRun = (x: Ctx, tag: string) => existsSync(join(runsDir(x), tag, "manifest.json"));

const loadRun = (x: Ctx, tag?: string): Manifest => {
  const t = tag ?? latestTag(x);
  if (!t) die(`no frames run yet for ${x.filmName}-${x.format}, run "mh frames" first`);
  const m = join(runsDir(x), t!, "manifest.json");
  if (!existsSync(m)) die(`no run "${t}" (have: ${[...runTags(x), ...(hasRun(x, APPROVED) ? [APPROVED] : [])].join(", ")})`);
  return readJson<Manifest>(m);
};

/** a run rendered from other sources than the ones on disk: its frames say nothing about the current film */
const staleNote = (x: Ctx, m: Manifest): string | null => (isStale(m.bundleHash, currentBundleHash(x.cfg)) ? `run "${m.tag}" was rendered from an older bundle (${m.bundleHash.slice(0, 12)} vs now ${currentBundleHash(x.cfg).slice(0, 12)}): the sources changed since` : null);

/* ---------- commands ---------- */

const cmdTimeline = async (args: Args) => {
  const x = await ctx(args);
  if (flag(args, "json")) return log(timelineJson(x.c));
  log(`${x.filmName} (${x.format}): ${x.c.scenes.length} scenes, ${x.c.dur} frames, ${x.c.seconds.toFixed(2)}s at ${x.c.fps} fps`);
  const rows = x.c.scenes.map((s) => [s.index, s.part, s.id, fmtTime(s.filmStart, x.c.fps), `${s.dur}f`, `${s.start}-${s.end - 1}`, `${s.enter.type}${s.enter.dur ? " " + s.enter.dur : ""}`, s.ground ?? "", s.events.map((e) => `${e.name}@${e.local}`).join(" ")]);
  log(table(rows, ["#", "part", "scene", "film in", "dur", "part frames", "enter", "ground", "events"]));
  if (x.c.timeline.audio?.length) {
    log("");
    log(table(x.c.timeline.audio.map((a) => [a.id, a.kind, String(a.at), `${resolveRef(x.c, a.at).filmSeconds.toFixed(2)}s`, a.file]), ["audio", "kind", "at", "film", "file"]));
  }
};

const cmdResolve = async (args: Args) => {
  const x = await ctx(args);
  if (!args._.length) die("usage: mh resolve <ref> [<ref>...]   e.g. 20.5s  f616  probe.pick1  probe+12  product:f120  #7");
  // piped (an agent reading the output): JSON without asking
  const json = flag(args, "json") || !process.stdout.isTTY;
  for (const ref of args._) {
    try {
      const L = resolveRef(x.c, ref);
      const s = L.scene;
      if (json) {
        out(JSON.stringify({ ref, part: L.part, scene: s.id, local: L.local, partFrame: L.partFrame, filmFrame: L.filmFrame, filmSeconds: L.filmSeconds, event: L.event, inTransition: L.inTransition, sceneStart: s.start, sceneEnd: s.end, sceneDur: s.dur, composition: compositionFor(x.c.parts.find((p) => p.id === L.part)!, x.format) }));
      } else {
        log(`${ref.padEnd(16)} -> ${s.id}+${L.local}   part ${L.part} f${L.partFrame}   film f${L.filmFrame} ${fmtTime(L.filmFrame, x.c.fps)}${L.event ? `   after ${L.event.name}+${L.event.distance}` : ""}${L.inTransition ? "   IN TRANSITION" : ""}`);
        log(`${"".padEnd(16)}    scene ${s.id}: part frames ${s.start}-${s.end - 1} (${s.dur}f), enter ${s.enter.type}${s.enter.dur ? ` ${s.enter.dur}f` : ""}, events ${s.events.map((e) => `${e.name}@${e.local}`).join(" ") || "none"}${s.why ? `, why: ${s.why}` : ""}`);
      }
    } catch (e) {
      log(`${ref.padEnd(16)} !! ${(e as Error).message}`);
    }
  }
};

const cmdDocs = async (args: Args) => {
  const x = await ctx(args);
  const md = timelineMarkdown(x.c, `${x.filmName} timeline`);
  const out = str(args, "out");
  if (out) {
    writeFileSync(resolvePath(out), md);
    log(`wrote ${out}`);
  } else log(md);
};

/** the engine the config or --engine names, opened for one command and closed after */
const engineOf = (x: Ctx) => engineKindOf(x.cfg, str(x.args, "engine"));
const withEngine = async <T,>(x: Ctx, fn: (e: Engine) => Promise<T>): Promise<T> => {
  const kind = engineOf(x);
  if (kind === "remotion") for (const w of staleBundleWarnings(x.cfg)) log(w);
  const e = await openEngine(x.cfg, { kind, force: flag(x.args, "rebundle"), log });
  try {
    return await fn(e);
  } finally {
    await e.close();
  }
};

/** the package.json of `pkg` as seen from `from`, walking up through node_modules dirs like a resolver would */
const findPackage = (from: string, pkg: string): { dir: string; version: string } | null => {
  let d = from;
  for (let i = 0; i < 12; i++) {
    const p = join(d, "node_modules", pkg, "package.json");
    if (existsSync(p)) return { dir: dirname(p), version: readJson<{ version: string }>(p).version };
    const up = dirname(d);
    if (up === d) break;
    d = up;
  }
  return null;
};

/** files the timeline points at: the audio cues, plus staticFile("...") literals in the project's source */
const referencedFiles = (x: Ctx): { what: string; file: string }[] => {
  const out: { what: string; file: string }[] = [];
  for (const cue of x.c.timeline.audio ?? []) out.push({ what: `cue ${cue.id}`, file: cue.file.startsWith("/") ? cue.file : join(x.cfg.projectDir, cue.file) });
  const walk = (d: string) => {
    if (!existsSync(d)) return;
    for (const name of readdirSync(d)) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(tsx?|jsx?)$/.test(name)) {
        const src = readFileSync(p, "utf8");
        for (const m of src.matchAll(/staticFile\(\s*(["'`])([^"'`$]+)\1\s*\)/g)) out.push({ what: `staticFile in ${p.replace(x.cfg.projectDir + "/", "")}`, file: join(x.cfg.publicPath, m[2]) });
      }
    }
  };
  walk(projectSrcDir(x.cfg));
  return out;
};

/** what doctor found wrong, as lines; empty means healthy */
const doctorRun = async (x: Ctx, args: Args): Promise<string[]> => {
  const problems: string[] = [];
  const bad = (s: string) => {
    problems.push(s);
    log(s);
  };
  const ff = await run(["ffmpeg", "-version"], { quiet: true });
  log(`ffmpeg: ${ff.code === 0 ? ff.out.split("\n")[0] : "MISSING"}`);
  if (ff.code === 0) {
    const fl = await run(["ffmpeg", "-hide_banner", "-filters"], { quiet: true });
    const have = new Set(fl.out.split("\n").map((l) => l.trim().split(/\s+/)[1]).filter(Boolean));
    // the mix needs these; drawtext is what a project's own ffmpeg scripts (burned-in labels) tend to need
    const need = ["acrossfade", "amix", "volume", "afade", "adelay", "concat"];
    const missing = need.filter((f) => !have.has(f));
    if (missing.length) bad(`ffmpeg filters: MISSING ${missing.join(", ")} (this ffmpeg build cannot mix the film)`);
    else log(`ffmpeg filters: ok (${need.join(", ")})`);
    if (!have.has("drawtext")) log("warning: ffmpeg has no drawtext filter (a build without libfreetype); the harness does not need it, scripts that burn in labels do");
  } else bad("ffmpeg: not on PATH, nothing renders");
  const fp = await run(["ffprobe", "-version"], { quiet: true });
  if (fp.code !== 0) bad("ffprobe: MISSING");

  const pkgs = ["remotion", "@remotion/bundler", "@remotion/renderer"].map((p) => ({ p, found: findPackage(x.cfg.projectDir, p) }));
  const versions = new Set(pkgs.map((k) => k.found?.version ?? "missing"));
  const line = pkgs.map((k) => `${k.p}@${k.found?.version ?? "MISSING"}`).join(", ");
  if (versions.size === 1 && !versions.has("missing")) log(`remotion: ${line} (from ${pkgs[0].found!.dir.replace(/\/node_modules\/.*$/, "/node_modules")})`);
  else bad(`remotion: VERSION MISMATCH ${line}. Remotion needs the three at one version, pin them together.`);

  log(`project: ${x.cfg.projectDir}`);
  log(`root: ${x.cfg.rootPath} (${x.cfg.rootExport ?? "Root"})`);
  log(`cache: ${x.cfg.cachePath} (${mb(dirSize(x.cfg.cachePath))}, "mh clean" frees it)`);
  log(`film ${x.filmName} format ${x.format}: ${x.c.parts.length} parts, ${x.c.scenes.length} scenes, ${x.c.dur}f`);
  const tl = lintTimeline(x.cfg, x.c);
  log(tl.length ? formatFindings(tl) : "timeline: ok");
  problems.push(...tl.filter((f) => f.level === "error").map((f) => `${f.rule} ${f.where}`));

  for (const cue of x.c.timeline.audio ?? []) {
    const file = cue.file.startsWith("/") ? cue.file : join(x.cfg.projectDir, cue.file);
    if (!existsSync(file)) {
      bad(`cue ${cue.id}: MISSING ${file}`);
      continue;
    }
    const d = await ffprobeDuration(file).catch(() => NaN);
    if (!Number.isFinite(d)) bad(`cue ${cue.id}: ${file} does not decode (ffprobe found no duration)`);
    else log(`cue ${cue.id}: ok ${d.toFixed(2)}s ${cue.file}`);
  }

  // an asset the film depends on that git ignores is a file the next checkout will not have
  const seen = new Set<string>();
  for (const r of referencedFiles(x)) {
    if (seen.has(r.file) || !existsSync(r.file)) continue;
    seen.add(r.file);
    const g = await run(["git", "check-ignore", "-q", "--", r.file], { cwd: x.cfg.projectDir, quiet: true });
    if (g.code === 0) log(`warning: ${r.file.replace(x.cfg.projectDir + "/", "")} is gitignored but the film needs it (${r.what})`);
    else if (g.code !== 1) break; // not a git repo: nothing to say
  }

  const { film } = pickFilm(x.cfg, str(args, "film"));
  await withEngine(x, async (e) => {
    const registered = new Set((await e.compositions()).map((k) => k.id));
    let missingHere = 0;
    for (const fmt of Object.keys(film.formats)) {
      for (const part of x.c.parts) {
        const id = compositionFor(part, fmt);
        if (registered.has(id)) continue;
        if (fmt === x.format) missingHere++;
        bad(`MISSING composition "${id}" (part ${part.id}, format ${fmt}) is not registered in the Root; registered: ${[...registered].join(", ") || "none"}`);
      }
    }
    if (missingHere) return log(`drift check skipped: ${missingHere} composition${missingHere === 1 ? "" : "s"} of format ${x.format} missing`);
    const checks = await partDurationCheck(e, x.c, x.format);
    for (const k of checks) {
      const ok = k.actual === k.expected;
      log(`${ok ? "ok  " : "DRIFT"} part ${k.part.id} -> ${k.composition}: composition ${k.actual}f, timeline ${k.expected}f${ok ? "" : ` (off by ${k.actual - k.expected})`}`);
      if (!ok) problems.push(`part ${k.part.id} drifts by ${k.actual - k.expected}f`);
    }
  });
  log(problems.length ? `${problems.length} problem${problems.length === 1 ? "" : "s"}` : "doctor: all clear");
  return problems;
};

const cmdDoctor = async (args: Args) => {
  const problems = await doctorRun(await ctx(args), args);
  if (problems.length) process.exit(2);
};

const cmdFrames = async (args: Args) => {
  const x = await ctx(args);
  const scenes = scenesOf(x.c, args);
  const zoom = str(args, "zoom");
  // a zoom needs the element boxes, so the probe runs even when nobody asked for it
  const probe = (str(args, "probe") as "probe" | "text" | "all" | undefined) ?? (flag(args, "probe") || zoom ? "probe" : false);
  const tag = str(args, "tag", stamp())!;
  const dense = num(args, "dense", 0) || undefined;
  const extra = (list(args, "at") ?? []).map((ref) => {
    const L = resolveRef(x.c, ref);
    return { ref, sceneId: L.scene.id, partFrame: L.partFrame };
  });
  const t0 = performance.now();
  const manifest = await withLock(x.cfg.cachePath, `frames ${x.filmName} ${x.format} ${tag}`, () => withEngine(x, async (e) => {
    const dir = ensureDir(join(runsDir(x), tag));
    const m: Manifest = { film: x.filmName, format: x.format, tag, createdAt: new Date().toISOString(), bundleHash: e.hash, probe, frames: [] };
    for (const part of x.c.parts) {
      const ps = scenes.filter((s) => s.part === part.id);
      if (!ps.length) continue;
      const compId = compositionFor(part, x.format);
      const jobs = ps.flatMap((s) =>
        [...checkFramesFor(s, { dense }), ...extra.filter((e) => e.sceneId === s.id).map((e) => ({ local: e.partFrame - s.start, partFrame: e.partFrame, filmFrame: s.filmStart + e.partFrame - s.start, kind: "check" as const, label: `at ${e.ref}` }))].map((cf) => ({
          frame: cf.partFrame,
          file: frameFile(dir, part.id, s.id, cf.local),
          scene: s,
          cf,
        })),
      );
      const uniq = new Map<number, (typeof jobs)[number]>();
      for (const j of jobs) if (!uniq.has(j.frame)) uniq.set(j.frame, j);
      const jl = [...uniq.values()];
      log(`${part.id} (${compId}): ${jl.length} frames${probe ? `, probe=${probe}` : ""}`);
      const outs = await e.stills(compId, jl, {
        probe,
        settleMs: num(args, "settle", 150),
        concurrency: num(args, "concurrency", 4),
        scale: num(args, "scale", 1),
        onDone: (o, i) => {
          if (i % 10 === 9) log(`  ${i + 1}/${jl.length}`);
        },
      });
      outs.forEach((o, i) => {
        const j = jl[i];
        let probeFile: string | undefined;
        if (o.probe) {
          probeFile = o.file.replace(/\.png$/, ".probe.json");
          writeJson(probeFile, o.probe);
        }
        m.frames.push({ file: o.file, part: part.id, composition: compId, scene: j.scene.id, local: j.cf.local, partFrame: j.cf.partFrame, filmFrame: j.cf.filmFrame, kind: j.cf.kind, label: j.cf.label, probeFile, ms: o.ms });
      });
    }
    m.frames.sort((a, b) => a.filmFrame - b.filmFrame);
    writeJson(join(dir, "manifest.json"), m);
    writeFileSync(join(runsDir(x), "latest"), tag);
    return m;
  }), log);
  log(`${manifest.frames.length} frames in ${ms(t0)} -> ${join(runsDir(x), tag)}`);
  if (!flag(args, "quiet")) log(table(manifest.frames.map((f) => [f.scene, `+${f.local}`, `f${f.partFrame}`, fmtTime(f.filmFrame, x.c.fps), f.kind, f.label, `${f.ms}ms`, f.file.replace(x.cfg.cachePath + "/", "")]), ["scene", "local", "part", "film", "kind", "label", "took", "file"]));
  if (flag(args, "sheet")) await cmdSheet({ ...args, from: tag });
};

const cmdSheet = async (args: Args) => {
  const x = await ctx(args);
  let m: Manifest;
  const from = str(args, "from");
  if (!from && !latestTag(x)) {
    log("no frames yet, rendering check frames first");
    await cmdFrames({ ...args, quiet: true });
  }
  m = loadRun(x, from);
  const stale = staleNote(x, m);
  if (stale) log(`warning: ${stale}; the sheet shows the old frames`);
  const scenes = scenesOf(x.c, args);
  const zoomKey = str(args, "zoom");
  if (zoomKey && !m.probe) die(`run "${m.tag}" has no probe data, --zoom needs element boxes: mh frames --zoom ${zoomKey}`);
  const zoom = zoomKey ? { width: Math.min(480, x.size.width), height: Math.min(320, x.size.height) } : undefined;
  const dir = ensureDir(join(runsDir(x), m.tag, zoomKey ? `sheets-zoom-${zoomKey}` : "sheets"));
  const columns = num(args, "columns", 4);
  const aspect = x.size.width / x.size.height;
  const cellWidth = num(args, "cell", aspect < 1 ? 270 : 480);
  const outFiles: string[] = [];
  let noBox = 0;
  const cell = (f: Manifest["frames"][number], sub: string): SheetCell => {
    const c: SheetCell = { file: f.file, title: `${f.scene}+${f.local}`, sub, kind: f.kind };
    if (!zoomKey) return c;
    const p = f.probeFile && existsSync(f.probeFile) ? readJson<ProbeResult>(f.probeFile) : null;
    const it = p?.items.find((i) => i.key === zoomKey && i.visible);
    if (it) c.crop = zoomWindow(it, x.size, zoom);
    else {
      c.mark = `no box for ${zoomKey}`;
      noBox++;
    }
    return c;
  };
  const legend = "orange = inside a transition (never a defect by itself) · blue = named event · gray = settled · light gray = event window";
  const zoomNote = zoomKey ? ` · zoom ${zoom!.width}x${zoom!.height} at 1:1 on "${zoomKey}"` : "";
  if (flag(args, "all")) {
    const cells = m.frames.filter((f) => scenes.some((s) => s.id === f.scene)).map((f) => cell(f, `film ${fmtTime(f.filmFrame, x.c.fps)} f${f.filmFrame} · ${f.label}`));
    const chunks = num(args, "per", 20);
    for (let i = 0; i < cells.length; i += chunks) {
      const out = join(dir, `all-${String(i / chunks + 1).padStart(2, "0")}.png`);
      await makeSheet(cells.slice(i, i + chunks), out, { columns, cellWidth, aspect, zoom, header: `${x.filmName} ${x.format} · frames ${i + 1}-${Math.min(cells.length, i + chunks)} of ${cells.length} · run ${m.tag}${zoomNote}`, footer: legend });
      outFiles.push(out);
    }
  } else {
    for (const s of scenes) {
      const fs = m.frames.filter((f) => f.scene === s.id);
      if (!fs.length) continue;
      const cells = fs.map((f) => cell(f, `film ${fmtTime(f.filmFrame, x.c.fps)} f${f.filmFrame} · part f${f.partFrame} · ${f.label}`));
      const out = join(dir, `${String(s.index).padStart(2, "0")}-${s.id}.png`);
      await makeSheet(cells, out, { columns, cellWidth, aspect, zoom, header: `${x.filmName} ${x.format} · scene ${s.id} (#${s.index}, ${s.part}) · ${s.dur}f = ${(s.dur / x.c.fps).toFixed(2)}s · enter ${s.enter.type}${s.enter.dur ? ` ${s.enter.dur}f` : ""}${s.why ? ` · ${s.why}` : ""}${zoomNote}`, footer: `events: ${s.events.map((e) => `${e.name}@${e.local}`).join("  ") || "none"} · ${legend}` });
      outFiles.push(out);
    }
  }
  log(outFiles.join("\n"));
  if (noBox) log(`${noBox} tile${noBox === 1 ? "" : "s"} without a visible "${zoomKey}" box show the full frame and are marked in the footer`);
};

const cmdApprove = async (args: Args) => {
  const x = await ctx(args);
  const from = str(args, "from") ?? latestTag(x);
  if (!from) die(`no frames run to approve, run "mh frames" first`);
  if (from === APPROVED) die(`"${APPROVED}" is the approved copy itself, pass a timestamped run`);
  const src = loadRun(x, from!);
  const dst = join(runsDir(x), APPROVED);
  if (existsSync(dst)) rmSync(dst, { recursive: true, force: true });
  cpSync(join(runsDir(x), from!), dst, { recursive: true, filter: (p) => !/\/(sheets(-zoom-[^/]+)?|diff-vs-[^/]+)$/.test(p) && !/\/(sheets(-zoom-[^/]+)?|diff-vs-[^/]+)\//.test(p) });
  const re = (p: string | undefined) => p?.replace(join(runsDir(x), from!), dst);
  const m: Manifest & { approvedFrom: string; approvedAt: string } = { ...src, tag: APPROVED, approvedFrom: from!, approvedAt: new Date().toISOString(), frames: src.frames.map((f) => ({ ...f, file: re(f.file)!, probeFile: re(f.probeFile) })) };
  writeJson(join(dst, "manifest.json"), m);
  log(`approved: ${from} (${m.frames.length} frames) -> ${dst}\nmh diff now compares ${APPROVED} vs latest by default`);
};

const cmdLocate = async (args: Args) => {
  const x = await ctx(args);
  const img = args._[0];
  if (!img) die("usage: mh locate <image.png> [--from tag] [--n 3]");
  if (!existsSync(img)) die(`no such image: ${img}`);
  const m = loadRun(x, str(args, "from"));
  const t0 = performance.now();
  const hashes = await hashFrames(m.frames.map((f) => f.file), join(runsDir(x), m.tag, "hashes.json"), (d, t) => {
    if (d % 20 === 0) log(`  hashing ${d}/${t} frames (cached for this run)`);
  });
  const q = await queryViews(resolvePath(img), x.size.width / x.size.height);
  const n = num(args, "n", 3);
  const all = bestMatches(m.frames, hashes, q, m.frames.length);
  if (!all.length) die(`run "${m.tag}" has no frame files on disk`);
  // the hash narrows the field, the refinement (paste slid over the frame at 16 scales) ranks the candidates
  const maxCand = num(args, "candidates", 48);
  const candidates = all.filter((b, i) => i < maxCand || b.distance <= all[0].distance + 2).slice(0, Math.max(maxCand, 12));
  // a trim strips letterbox bars, but also the dark ground around a headline: try the paste both ways, keep the better fit
  const queries: (string | Buffer)[] = [resolvePath(img)];
  if (q.views.some((v) => v.name === "trimmed")) queries.push(await sharp(resolvePath(img)).flatten({ background: "#000" }).trim({ threshold: 24 }).png().toBuffer());
  const bestOf = async (file: string, fn: (qq: string | Buffer) => Promise<Fit>) => {
    let best: Fit & { query: string | Buffer } | null = null;
    for (const qq of queries) {
      const f = await fn(qq);
      if (!best || (f.score > best.score && !f.flat) || (best.flat && !f.flat)) best = { ...f, query: qq };
    }
    return best!;
  };
  const coarse = await Promise.all(candidates.map(async (b) => ({ ...b, fit: await bestOf(b.frame.file, (qq) => refineFit(b.frame.file, qq)) })));
  const fits = coarse.sort((p, r) => r.fit.score - p.fit.score || p.distance - r.distance);
  const best = fits.slice(0, n);
  const top = best[0];
  const pct = (v: number) => `${(v * 100).toFixed(0)}%`;
  log(`${img} (${q.width}x${q.height}) vs ${hashes.size} frames of run ${m.tag}, ${candidates.length} candidates refined (${ms(t0)})`);
  log(table(best.map((b) => [`${b.frame.scene}+${b.frame.local}`, fmtTime(b.frame.filmFrame, x.c.fps), `f${b.frame.filmFrame}`, `${b.frame.part} f${b.frame.partFrame}`, b.frame.label, pct(b.fit.score), `${pct(b.fit.scale)} at ${pct(b.fit.x)},${pct(b.fit.y)}`, b.distance, b.frame.file.replace(x.cfg.cachePath + "/", "")]), ["scene", "film", "frame", "part", "label", "fit", "paste = frame region", "hash", "file"]));
  const fitVerdict = top.fit.score >= 0.95 ? "same" : top.fit.score >= 0.85 ? "close" : "no match";
  if (top.fit.flat) {
    // a flat paste (black, a plain ground) can only be placed by its hash, and that ties with every flat frame
    const flat = all.filter((b) => b.distance <= all[0].distance + 2 && b.against === "full frame").sort((p, r) => p.frame.filmFrame - r.frame.filmFrame);
    const first = flat[0]?.frame, last = flat[flat.length - 1]?.frame;
    log(`flat picture, no detail to fit: ${flat.length} flat frame${flat.length === 1 ? "" : "s"} share its hash${first ? `: ${first.scene}+${first.local} (${fmtTime(first.filmFrame, x.c.fps)}) .. ${last.scene}+${last.local} (${fmtTime(last.filmFrame, x.c.fps)})` : ""}; ask which moment was meant`);
  } else if (fitVerdict === "no match") log(`nothing in this run fits the image (best fit ${pct(top.fit.score)}, hash distance ${top.distance} of 256). A different scene, format, or a frame between the check frames: try mh frames --dense 2 --scene <id>, then locate --from that tag.`);
  else {
    // a hold makes many frames tie: say which span it is instead of pretending three winners
    // frames of one hold are alike down to the pixel, their fits differ by resampling noise only
    const ties = fits.filter((b) => b.fit.score >= top.fit.score - 0.04).sort((p, r) => p.frame.filmFrame - r.frame.filmFrame);
    if (ties.length > 1) {
      const first = ties[0].frame, last = ties[ties.length - 1].frame;
      const scenes = [...new Set(ties.map((t) => t.frame.scene))];
      log(`${fitVerdict}: ${ties.length} frames fit within 4%: ${first.scene}+${first.local} (${fmtTime(first.filmFrame, x.c.fps)}) .. ${last.scene}+${last.local} (${fmtTime(last.filmFrame, x.c.fps)})${scenes.length > 1 ? ` across ${scenes.join(", ")}` : ", one hold"}; the image can be any of them`);
    } else log(`${fitVerdict}: ${top.frame.scene}+${top.frame.local}`);
  }
  if (flag(args, "json")) out(JSON.stringify(best.map((b) => ({ scene: b.frame.scene, local: b.frame.local, filmFrame: b.frame.filmFrame, partFrame: b.frame.partFrame, part: b.frame.part, fit: b.fit, distance: b.distance, view: b.view, against: b.against, file: b.frame.file }))));
};

const printProbe = (p: ProbeResult, find?: string) => {
  const items = p.items.filter((i) => !find || i.key.toLowerCase().includes(find.toLowerCase()) || i.text.toLowerCase().includes(find.toLowerCase()));
  log(table(items.map((i) => [i.key.slice(0, 40), i.visible ? "vis" : "hidden", i.x, i.y, i.w, i.h, i.opacity, i.color, i.bg === "rgba(0, 0, 0, 0)" ? "" : i.bg, `${i.fontSize} ${i.fontWeight} ${i.fontFamily}`]), ["key", "", "x", "y", "w", "h", "op", "color", "bg", "font"]));
  if (!find) {
    log("");
    log(table(p.colors.sort((a, b) => b.count - a.count).slice(0, 25).map((c) => [c.prop, c.value, c.count, c.example]), ["painted", "value", "n", "example"]));
  }
};

const cmdProbe = async (args: Args) => {
  const x = await ctx(args);
  if (!args._.length) die("usage: mh probe <ref> [--mode probe|text|all] [--find text] [--key data-probe] [--json]");
  const key = str(args, "key");
  const mode = (str(args, "mode", key ? "probe" : "text") as "probe" | "text" | "all");
  await withEngine(x, async (e) => {
    for (const ref of args._) {
      const L = resolveRef(x.c, ref);
      const part = x.c.parts.find((p) => p.id === L.part)!;
      const compId = compositionFor(part, x.format);
      const file = join(ensureDir(join(x.cfg.cachePath, "probe")), `${compId}-f${String(L.partFrame).padStart(5, "0")}.png`);
      const [o] = await e.stills(compId, [{ frame: L.partFrame, file }], { probe: mode, settleMs: num(args, "settle", 150) });
      if (!o.probe) return log(`${ref}: no probe result (is the harness wrapper in use? run mh bundle --force)`);
      if (key) {
        // one element, its centre: what a cursor needs
        const it = o.probe.items.find((i) => i.key === key);
        if (!it) throw new Error(`${ref}: no element with data-probe="${key}" at that frame (visible keys: ${o.probe.items.filter((i) => i.kind === "probe").map((i) => i.key).join(", ") || "none"})`);
        const centre = { ref, location: L.label, partFrame: L.partFrame, filmFrame: L.filmFrame, key, x: Math.round(it.x + it.w / 2), y: Math.round(it.y + it.h / 2), box: { x: it.x, y: it.y, w: it.w, h: it.h }, visible: it.visible };
        if (flag(args, "json")) out(JSON.stringify(centre));
        else log(`${ref} -> ${L.label}   ${key}: centre ${centre.x},${centre.y}   box ${it.x},${it.y} ${it.w}x${it.h}${it.visible ? "" : "   NOT VISIBLE"}`);
        continue;
      }
      if (flag(args, "json")) out(JSON.stringify({ ref, location: L.label, file, ...o.probe }));
      else {
        log(`${ref} -> ${L.label}${L.inTransition ? " IN TRANSITION" : ""}   still: ${file}`);
        printProbe(o.probe, str(args, "find"));
      }
    }
  });
};

/** exactly these frames, by any address resolve accepts, rendered now: no guessing which check frame is nearest */
const frameRun = async (x: Ctx, refs: string[]): Promise<{ ref: string; file: string; L: ReturnType<typeof resolveRef>; ms: number; probeFile?: string }[]> => {
  const args = x.args;
  const crop = list(args, "crop")?.map(Number);
  if (crop && (crop.length !== 4 || crop.some((n) => !Number.isFinite(n)))) die("--crop wants x,y,w,h in frame pixels");
  const dir = ensureDir(join(x.cfg.cachePath, "frame", `${x.filmName}-${x.format}`));
  const probe = (str(args, "probe") as "probe" | "text" | "all" | undefined) ?? (flag(args, "probe") ? "text" : false);
  const jobs = refs.map((ref) => {
    const L = resolveRef(x.c, ref);
    const part = x.c.parts.find((p) => p.id === L.part)!;
    return { ref, L, compId: compositionFor(part, x.format), file: join(dir, `${L.scene.id}+${L.local}${crop ? `-crop${crop.join("x")}` : ""}.png`) };
  });
  const out: { ref: string; file: string; L: ReturnType<typeof resolveRef>; ms: number; probeFile?: string }[] = [];
  await withEngine(x, async (e) => {
    const byComp = new Map<string, typeof jobs>();
    for (const j of jobs) byComp.set(j.compId, [...(byComp.get(j.compId) ?? []), j]);
    for (const [compId, js] of byComp) {
      const uniq = [...new Map(js.map((j) => [j.L.partFrame, j])).values()];
      const outs = await e.stills(compId, uniq.map((j) => ({ frame: j.L.partFrame, file: j.file })), { probe, settleMs: num(args, "settle", 150), concurrency: num(args, "concurrency", 4), scale: num(args, "scale", 1) });
      for (const [i, o] of outs.entries()) {
        const j = uniq[i];
        if (crop) {
          const [cx, cy, cw, ch] = crop;
          const buf = await sharp(o.file).extract({ left: Math.max(0, cx), top: Math.max(0, cy), width: Math.min(cw, x.size.width - cx), height: Math.min(ch, x.size.height - cy) }).png().toBuffer();
          await sharp(buf).toFile(o.file);
        }
        let probeFile: string | undefined;
        if (o.probe) {
          probeFile = o.file.replace(/\.png$/, ".probe.json");
          writeJson(probeFile, o.probe);
        }
        for (const jj of js.filter((k) => k.L.partFrame === j.L.partFrame)) out.push({ ref: jj.ref, file: o.file, L: jj.L, ms: o.ms, probeFile });
      }
    }
  });
  return out;
};

const cmdFrame = async (args: Args) => {
  if (!args._.length) die("usage: mh frame <ref> [<ref>...] [--format all] [--crop x,y,w,h] [--probe] [--json]   e.g. turn+40  20.5s  probe.pick1+3  f616");
  const rows: (string | number)[][] = [];
  const all: Record<string, unknown>[] = [];
  await eachFormat(args, async (a) => {
    const x = await ctx(a);
    for (const f of await frameRun(x, args._)) {
      produced(f.file);
      rows.push([x.format, f.ref, `${f.L.scene.id}+${f.L.local}`, `f${f.L.partFrame}`, fmtTime(f.L.filmFrame, x.c.fps), f.L.inTransition ? "in transition" : "", `${f.ms}ms`, f.file]);
      all.push({ format: x.format, ref: f.ref, scene: f.L.scene.id, local: f.L.local, partFrame: f.L.partFrame, filmFrame: f.L.filmFrame, filmSeconds: f.L.filmSeconds, inTransition: f.L.inTransition, file: f.file, probeFile: f.probeFile });
    }
  });
  log(table(rows, ["format", "ref", "scene", "part", "film", "", "took", "file"]));
  if (flag(args, "json")) out(JSON.stringify(all));
};

/** every <Still> the project registers, rendered through the probe and linted; jpg copies and a sheet on request */
const cmdStill = async (args: Args) => {
  const x = await ctx(args);
  const jpg = flag(args, "jpg") || str(args, "width") !== undefined;
  const outDir = str(args, "out") ? resolvePath(str(args, "out")!) : undefined;
  const t0 = performance.now();
  const results = await withEngine(x, async (e) => {
    const available = await listStills(e);
    if (!available.length) die("the Root registers no <Still> (a composition of one frame)");
    if (!args._.length) {
      log(table(available.map((s) => [s.id, `${s.width}x${s.height}`]), ["still", "size"]));
      return null;
    }
    const wanted = pickStills(available, args._.flatMap((k) => k.split(",")).map((k) => k.trim()).filter(Boolean));
    return renderStills(x.cfg, e, wanted, { outDir, jpg, width: num(args, "width", 0) || undefined, quality: num(args, "quality", 90), settleMs: num(args, "settle", 150), concurrency: num(args, "concurrency", 2), log });
  });
  if (!results) return log(`mh still <id,...|all> renders them`);
  for (const r of results) {
    produced(r.png);
    if (r.jpg) produced(r.jpg);
  }
  const findings = results.flatMap((s) => s.findings);
  log("");
  log(table(results.map((s) => [s.id, `${s.width}x${s.height}`, s.findings.filter((f) => f.level === "error").length || "", s.findings.filter((f) => f.level === "warn").length || "", s.jpg ?? s.png]), ["still", "size", "errors", "warns", "file"]));
  if (findings.length) {
    log("");
    log(formatFindings(findings));
  }
  if (flag(args, "sheet")) {
    const sheet = await stillSheet(results, join(outDir ?? join(x.cfg.cachePath, "stills"), "sheet.png"), `${x.filmName} stills (${results.length}) · ${new Date().toISOString().slice(0, 16)}`);
    log(`sheet -> ${sheet}`);
  }
  if (flag(args, "json")) out(JSON.stringify(results.map((s) => ({ id: s.id, width: s.width, height: s.height, png: s.png, jpg: s.jpg, findings: s.findings }))));
  const errors = findings.filter((f) => f.level === "error").length;
  log(`${results.length} still${results.length === 1 ? "" : "s"} in ${ms(t0)}, ${errors} lint error${errors === 1 ? "" : "s"}`);
  if (errors && !flag(args, "no-fail")) process.exit(2);
};

/** subtitles from the timeline: scenes with text, or a caption for the ones without; chapter lines for the description */
const cmdSrt = async (args: Args) => {
  const x = await ctx(args);
  const entries = srtEntries(x.c, { useCaption: args["captions"] !== "false", lang: str(args, "lang") });
  if (!entries.length) die("no scene carries text or caption, nothing to subtitle");
  const text = srtText(entries);
  const outFile = str(args, "out");
  if (flag(args, "chapters")) return log(chapterLines(entries).join("\n"));
  if (outFile) {
    writeFileSync(resolvePath(outFile), text);
    produced(resolvePath(outFile));
    log(`${entries.length} entries -> ${outFile}`);
    log(table(entries.map((e) => [e.index, e.scene, `${e.start.toFixed(2)}s`, `${e.end.toFixed(2)}s`, e.text.replace(/\n/g, " / ")]), ["#", "scene", "from", "to", "text"]));
  } else out(text);
};

/** films, stills, srt and a manifest into one folder, mp4 kept out of git */
const cmdDeliver = async (args: Args) => {
  const dir = str(args, "out");
  if (!dir) die("usage: mh deliver --out <dir> [--format all] [--stills a,b|all] [--lang en]");
  const formats = await formatsOf({ ...args, format: str(args, "format") ?? "all" });
  const first = await ctx({ ...args, format: formats[0] });
  const films = [];
  for (const format of formats) {
    const x = await ctx({ ...args, format });
    // masters from the cache, or from the folder mh render --out-dir wrote them to
    const dirs = [str(args, "films") ? resolvePath(str(args, "films")!) : null, join(x.cfg.cachePath, "out")].filter((d): d is string => !!d);
    const master = dirs.map((d) => join(d, `${x.filmName}-${x.format}.mp4`)).find(existsSync) ?? join(dirs[dirs.length - 1], `${x.filmName}-${x.format}.mp4`);
    films.push({ format, master, web: master.replace(/\.mp4$/, "-web.mp4"), size: x.size });
  }
  const wantStills = list(args, "stills");
  let stills: { id: string; file: string; width: number; height: number }[] = [];
  if (wantStills) {
    const res = await withEngine(first, async (e) => renderStills(first.cfg, e, pickStills(await listStills(e), wantStills), { jpg: true, width: num(args, "width", 0) || undefined, log }));
    stills = res.map((s) => ({ id: s.id, file: s.jpg ?? s.png, width: s.width, height: s.height }));
    const errors = res.flatMap((s) => s.findings).filter((f) => f.level === "error");
    if (errors.length) {
      log(formatFindings(errors));
      if (!flag(args, "no-fail")) die(`${errors.length} still lint error${errors.length === 1 ? "" : "s"}, not delivering (--no-fail overrides)`);
    }
  }
  log(`delivering ${first.filmName} to ${dir}`);
  const platforms = list(args, "platforms");
  const captions = flag(args, "captions") ? { ...(first.cfg.captions ?? {}) } : undefined;
  const uploadPrefix = str(args, "upload");
  const upload = uploadPrefix ? uploadTargetFromEnv(uploadPrefix) : undefined;
  if (upload) log(`upload -> ${upload.endpoint} ${upload.bucket}/${upload.prefix}${upload.publicUrl ? ` (public ${upload.publicUrl})` : " (set MH_S3_PUBLIC_URL for public links)"}`);
  const d = await deliver({ film: first.filmName, c: first.c, films, stills, lang: str(args, "lang", "en"), platforms, captions, upload }, resolvePath(dir!), { log });
  for (const f of d.files) produced(f.file);
  produced(d.manifest);
  const delivered = d.files.filter((f) => f.kind === "film").length;
  if (!delivered) log(`warning: no rendered film found in the cache (mh render --format all first)`);
  log(`manifest -> ${d.manifest}${d.manifest.endsWith("MANIFEST.md") ? " (README.md in that folder is hand-written and was left alone)" : ""}`);
};

/** the subtitles burned into the rendered film (or any file): a copy next to it */
const cmdCaptions = async (args: Args) => {
  const x = await ctx(args);
  const input = args._[0] ?? join(x.cfg.cachePath, "out", `${x.filmName}-${x.format}.mp4`);
  if (!existsSync(input)) die(`no film at ${input} (mh render first, or pass a file)`);
  const lang = str(args, "lang");
  const entries = srtEntries(x.c, { lang });
  if (!entries.length) die("no scene carries text or caption");
  const { bottom, ...style } = x.cfg.captions ?? {};
  const safe = ({ ...(x.c.timeline.rules ?? {}), ...(x.cfg.rules ?? {}) }).safeZone?.[x.format];
  const out = str(args, "out") ?? input.replace(/\.mp4$/, `-captions${lang ? `-${lang}` : ""}.mp4`);
  const t0 = performance.now();
  await burnCaptions(input, entries, x.size, { ...style, bottom: bottom?.[x.format] ?? (safe ? safe.bottom + 24 : undefined) }, out, join(x.cfg.cachePath, "captions"));
  produced(out);
  log(`${entries.length} captions burned -> ${out} (${ms(t0)})`);
};

/** voice cues: synthesise what is missing or changed, measure every line against its scene */
const cmdVoice = async (args: Args) => {
  const x = await ctx(args);
  const res = await runVoice(x.cfg, x.c, { force: flag(args, "force"), dryRun: flag(args, "dry-run"), log });
  if (!res.length) return log('no voice cues in the timeline (audio: [{ id, kind: "voice", text, file, at }])');
  for (const r of res) if (r.reason !== "current" && !r.reason.startsWith("would")) produced(r.file);
  log(table(res.map((r) => [r.id, r.reason, Number.isFinite(r.seconds) ? `${r.seconds.toFixed(2)}s` : "no file", r.sceneId, `${r.sceneLeft.toFixed(2)}s`, r.fits ? "fits" : "RUNS PAST THE SCENE"]), ["cue", "state", "length", "starts in", "scene left", ""]));
  if (res.some((r) => !r.fits)) log("a line longer than the scene it starts in is heard over the next scene; lengthen the scene or shorten the line");
};

/** generated clips: what they cost and what they look like; the colour lint reads this */
const cmdClips = async (args: Args) => {
  const x = await ctx(args);
  const sub = args._[0];
  if (sub === "add") {
    const file = args._[1];
    if (!file) die("usage: mh clips add <file> [--id x] [--prompt ...] [--model ...] [--seed ...] [--credits N] [--cost N --currency USD] [--attempts N] [--tags a,b]");
    const clip = await addClip(x.cfg, resolvePath(file), { id: str(args, "id"), prompt: str(args, "prompt"), model: str(args, "model"), seed: str(args, "seed"), credits: str(args, "credits") ? num(args, "credits", 0) : undefined, cost: str(args, "cost") ? num(args, "cost", 0) : undefined, currency: str(args, "currency"), attempts: str(args, "attempts") ? num(args, "attempts", 1) : undefined, tags: list(args, "tags") }, join(x.cfg.cachePath, "clips"));
    log(`added ${clip.id}: ${clip.width}x${clip.height} ${clip.fps} fps ${clip.seconds.toFixed(2)}s, luma first ${clip.colour.first.luma} mid ${clip.colour.mid.luma} last ${clip.colour.last.luma}`);
    return;
  }
  const clips = loadClips(x.cfg);
  if (!clips.length) return log("no clips registered (mh clips add <file> ...)");
  log(table(clips.map((c) => [c.id, c.file, `${c.width}x${c.height}`, `${c.seconds.toFixed(2)}s`, c.model ?? "", c.attempts ?? "", c.credits ?? "", c.cost !== undefined ? `${c.cost}${c.currency ? " " + c.currency : ""}` : "", `${c.colour.first.luma}/${c.colour.mid.luma}/${c.colour.last.luma}`, x.c.scenes.filter((s) => s.clip === c.id).map((s) => s.id).join(",")]), ["clip", "file", "size", "length", "model", "tries", "credits", "cost", "luma f/m/l", "scenes"]));
  const cost = clipCost(clips);
  log(`${clips.length} clips, ${cost.attempts} attempts, ${cost.credits} credits${cost.cost ? `, ${cost.cost} ${cost.currency}` : ""}`);
  const f = lintClips(x.cfg, x.c);
  if (f.length) log(formatFindings(f));
};

/** a model watches the clip: findings with film times, to be located with mh resolve before anyone acts on them */
const cmdJudge = async (args: Args) => {
  const x = await ctx(args);
  const scenes = scenesOf(x.c, args);
  if (!list(args, "scene") && !str(args, "part")) die("usage: mh judge --scene a[,b] [--model gemini-2.5-flash] [--checklist \"...;...\"] [--file clip.mp4]");
  const ids = scenes.map((s) => s.id);
  const span = { start: scenes[0].filmStart / x.c.fps, end: scenes[scenes.length - 1].filmEnd / x.c.fps };
  let file = str(args, "file");
  if (!file) {
    file = await withEngine(x, async (e) => {
      const q = flag(args, "full") ? FULL : DRAFT;
      const segs = await renderSegments(x.cfg, e, x.c, x.filmName, x.format, { subset: ids, quality: q, log, concurrency: num(args, "concurrency", 4) });
      const parts = [...new Set(scenes.map((s) => s.part))];
      const audio = await renderPartAudio(x.cfg, e, x.c, x.filmName, x.format, { log, parts });
      const { picture } = await concatScenes(x.cfg, x.c, scenes, segs, audio, x.filmName, x.format, x.size, { log, name: `${x.filmName}-${x.format}-judge-${ids.join("+")}` });
      const out = join(ensureDir(join(x.cfg.cachePath, "judge")), `${x.filmName}-${x.format}-${ids.join("+")}.mp4`);
      const res = await mixFilm(x.cfg, x.c, picture, x.filmName, x.format, { out, span, log, audioRoot: str(args, "audio-root") });
      return res.master;
    });
  }
  const checklist = str(args, "checklist") ? str(args, "checklist")!.split(";").map((k) => k.trim()).filter(Boolean) : DEFAULT_CHECKLIST;
  const prompt = judgePrompt(x.c, scenes, span, checklist);
  log(`asking ${str(args, "model", "gemini-2.5-flash")} to watch ${file} (${(span.end - span.start).toFixed(2)}s, ${scenes.length} scene${scenes.length === 1 ? "" : "s"})`);
  const t0 = performance.now();
  const r = await judgeClip(file!, prompt, { model: str(args, "model") });
  log(`${r.model} in ${ms(t0)}: ${r.summary}`);
  const rows = r.findings.map((f) => {
    const filmSec = f.seconds !== undefined ? span.start + f.seconds : undefined;
    const L = filmSec !== undefined ? locate(x.c, Math.round(filmSec * x.c.fps)) : null;
    return [f.severity, L ? `${L.scene.id}+${L.local}` : "", filmSec !== undefined ? fmtTime(Math.round(filmSec * x.c.fps), x.c.fps) : "", f.what];
  });
  log(rows.length ? table(rows, ["", "scene", "film", "finding"]) : "no findings");
  log("a model's findings are leads: confirm each with mh frame <scene+N> before changing anything");
  if (flag(args, "json")) out(JSON.stringify({ file, span, ...r, findings: r.findings.map((f, i) => ({ ...f, at: rows[i][1] })) }));
};

const lintRun = async (x: Ctx, args: Args): Promise<Finding[]> => {
  // --format all (the default when the film has more than one format) lints every format and compares them
  const wantAll = str(args, "format") === "all";
  const film = x.cfg.films[x.filmName];
  const formats = wantAll || (str(args, "format") === undefined && Object.keys(film.formats).length > 1) ? Object.keys(film.formats) : [x.format];
  const findings: Finding[] = [];
  const which = { static: flag(args, "static"), timeline: flag(args, "timeline"), rendered: flag(args, "rendered") };
  const none = !which.static && !which.timeline && !which.rendered;
  if (none || which.timeline) findings.push(...lintTimeline(x.cfg, x.c));
  if (none || which.timeline || flag(args, "clips")) findings.push(...lintClips(x.cfg, x.c));
  if (none || which.static) findings.push(...(await lintStaticColors(x.cfg)));
  if (which.rendered) {
    const legs = cursorLegFrames(x.c, film);
    const runs: Record<string, ProbeFrame[]> = {};
    for (const format of formats) {
      const xf = formats.length > 1 ? await ctx({ ...args, format }) : x;
      let m: Manifest | null = null;
      const tag = str(args, "from") ?? latestTag(xf);
      if (tag) {
        const cand = loadRun(xf, tag);
        const stale = staleNote(xf, cand);
        if (stale && !flag(args, "allow-stale")) {
          if (str(args, "from")) throw new Error(`${stale}. Re-render (mh frames --probe text) or pass --allow-stale to lint the old frames anyway.`);
          log(`${format}: ${stale}; rendering fresh frames`);
        } else if (cand.probe) m = cand;
      }
      if (!m) {
        log(`${format}: no probe run found, rendering settled frames with the probe`);
        await cmdFrames({ ...args, format, probe: "text", quiet: true, tag: `lint-${stamp()}`, ...(legs.length ? { at: legs.map((l) => l.ref).join(",") } : {}) });
        m = loadRun(xf);
      }
      const frames: ProbeFrame[] = m.frames.filter((f) => f.probeFile && f.kind !== "transition").map((f) => ({ label: `${f.scene}+${f.local}`, sceneId: f.scene, local: f.local, partFrame: f.partFrame, probe: readJson<ProbeResult>(f.probeFile!) }));
      runs[format] = frames;
      findings.push(...lintProbe(xf.cfg, xf.c, format, frames).map((f) => (formats.length > 1 ? { ...f, where: `${format} ${f.where}` } : f)));
    }
    findings.push(...lintFormatParity(x.c, runs, legs));
  }
  return findings;
};

const cmdLint = async (args: Args) => {
  const x = await ctx(str(args, "format") === "all" ? { ...args, format: false } : args);
  const findings = await lintRun(x, args);
  log(formatFindings(findings));
  const errors = findings.filter((f) => f.level === "error").length;
  log(`${findings.length} finding${findings.length === 1 ? "" : "s"}, ${errors} error${errors === 1 ? "" : "s"}`);
  if (errors && !flag(args, "no-fail")) process.exit(2);
};

const cmdDiff = async (args: Args) => {
  const x = await ctx(args);
  const [a, b] = args._;
  const runs = runTags(x);
  const tagB = b ?? latestTag(x)!;
  // without tags: the approved run against the latest one; before any approval, the previous run
  const tagA = a ?? (hasRun(x, APPROVED) ? APPROVED : runs.filter((t) => t < tagB).pop());
  if (!tagA || !tagB) die(`need two runs to compare (have: ${runs.join(", ")}); "mh approve" fixes one side for good`);
  if (tagA === tagB) die(`both sides are "${tagA}", render a new run first`);
  const A = loadRun(x, tagA), B = loadRun(x, tagB);
  const byFrame = (m: Manifest) => new Map(m.frames.map((f) => [`${f.part}:${f.partFrame}`, f]));
  const fa = byFrame(A), fb = byFrame(B);
  const keys = [...fb.keys()].filter((k) => fa.has(k));
  const outDir = ensureDir(join(runsDir(x), tagB, "diff-vs-" + tagA));
  const res = await diffSets(keys.map((k) => ({ frame: fb.get(k)!.partFrame, a: fa.get(k)!.file, b: fb.get(k)!.file, label: `${fb.get(k)!.scene}+${fb.get(k)!.local}` })), { threshold: num(args, "threshold", 0.08), outDir });
  const min = num(args, "min", 0.002);
  const changed = res.filter((r) => r.changed >= min).sort((p, q) => q.changed - p.changed);
  const approvedNote = tagA === APPROVED ? ` (approved = ${(A as Manifest & { approvedFrom?: string }).approvedFrom ?? "?"})` : "";
  log(`${tagA}${approvedNote} -> ${tagB}: ${keys.length} common frames, ${changed.length} changed (>= ${(min * 100).toFixed(1)}% pixels), ${fb.size - keys.length} only in ${tagB}, ${fa.size - keys.length} only in ${tagA}`);
  // touched scenes first, worst first, so the reviewer opens the right sheet
  const perScene = new Map<string, { frames: number; max: number; sum: number }>();
  for (const r of changed) {
    const id = r.label.split("+")[0];
    const e = perScene.get(id) ?? { frames: 0, max: 0, sum: 0 };
    e.frames++;
    e.max = Math.max(e.max, r.changed);
    e.sum += r.changed;
    perScene.set(id, e);
  }
  const compared = new Map<string, number>();
  for (const k of keys) compared.set(fb.get(k)!.scene, (compared.get(fb.get(k)!.scene) ?? 0) + 1);
  const touched = [...perScene.entries()].sort((p, q) => q[1].max - p[1].max);
  log("");
  log(touched.length ? table(touched.map(([id, e]) => [id, `${e.frames}/${compared.get(id) ?? 0}`, `${(e.max * 100).toFixed(1)}%`, `${((e.sum / e.frames) * 100).toFixed(1)}%`]), ["scene touched", "frames changed", "worst frame", "mean of changed"]) : "no scene touched");
  log("");
  log(table(changed.map((r) => [r.label, `f${r.frame}`, `${(r.changed * 100).toFixed(1)}%`, (r.mean * 100).toFixed(2), r.box ? `${r.box.x},${r.box.y} ${r.box.w}x${r.box.h}` : "", r.diffFile?.replace(x.cfg.cachePath + "/", "") ?? ""]), ["frame", "part f", "changed", "mean%", "box", "diff image"]));
  const untouched = x.c.scenes.map((s) => s.id).filter((id) => compared.has(id) && !perScene.has(id));
  log(`scenes touched: ${touched.map(([id]) => id).join(", ") || "none"}${untouched.length ? `   unchanged: ${untouched.join(", ")}` : ""}`);
};

/** two pictures, one number: how much differs, where, and a diff image; the check behind "same frame on both engines" */
const cmdCompare = async (args: Args) => {
  const [a, b] = args._;
  if (!a || !b) die("usage: mh compare <a.png> <b.png> [--out diff.png] [--threshold 0.08]");
  for (const f of [a, b]) if (!existsSync(f)) die(`no such file: ${f}`);
  const out = str(args, "out");
  const d = await diffImages(resolvePath(a), resolvePath(b), { threshold: num(args, "threshold", 0.08), out: out ? resolvePath(out) : undefined });
  const verdict = d.changed < 0.001 ? "same" : d.changed < 0.01 ? "close" : d.changed < 0.05 ? "differs" : "different";
  log(`${basename(a)} vs ${basename(b)}: ${(d.changed * 100).toFixed(3)}% of pixels changed (>${Math.round(num(args, "threshold", 0.08) * 255)}/255), mean ${(d.mean * 100).toFixed(2)}%${d.box ? `, box ${d.box.x},${d.box.y} ${d.box.w}x${d.box.h}` : ""}: ${verdict}${out ? `  diff -> ${out}` : ""}`);
  if (flag(args, "json")) out2(JSON.stringify({ a, b, ...d, verdict }));
};
const out2 = out;

/** one scene rendered at several concurrencies, full and draft: the numbers to pick the render defaults from on this machine */
const cmdBench = async (args: Args) => {
  const x = await ctx(args);
  const ids = list(args, "scene") ?? [];
  if (!ids.length) return die("usage: mh bench --scene <id> [--concurrencies 4,6,8,10]");
  const s = x.c.scenes.find((k) => k.id === ids[0]);
  if (!s) return die(`no scene "${ids[0]}"`);
  const dur = s.dur;
  const concs = (str(args, "concurrencies") ?? "4,6,8,10").split(",").map(Number);
  const rows: (string | number)[][] = [];
  await withEngine(x, async (e) => {
    for (const q of [FULL, DRAFT]) {
      for (const conc of concs) {
        const t0 = performance.now();
        await renderSegments(x.cfg, e, x.c, x.filmName, x.format, { subset: [s.id], only: [s.id], quality: q, concurrency: conc, force: true });
        const sec = (performance.now() - t0) / 1000;
        rows.push([q === FULL ? "full" : "draft", conc, `${sec.toFixed(1)}s`, `${(dur / sec).toFixed(1)} f/s`]);
        log(`${q === FULL ? "full " : "draft"} concurrency ${conc}: ${sec.toFixed(1)}s for ${dur}f`);
      }
    }
  });
  log(table(rows, ["quality", "concurrency", "time", "speed"]));
};

const cmdMotion = async (args: Args) => {
  const x = await ctx(args);
  const scenes = scenesOf(x.c, args);
  if (scenes.length > 6 && !flag(args, "yes")) die(`${scenes.length} scenes would be rendered at full frame rate, pass --scene a,b or --yes`);
  const rules = { ...(x.c.timeline.rules ?? {}), ...(x.cfg.rules ?? {}) };
  await withEngine(x, async (e) => {
    for (const s of scenes) {
      const part = x.c.parts.find((p) => p.id === s.part)!;
      const compId = compositionFor(part, x.format);
      const dir = join(x.cfg.cachePath, "motion", `${x.filmName}-${x.format}`, s.id);
      const t0 = performance.now();
      const m = await measureScene(e, compId, s, x.c.fps, dir, { width: num(args, "width", 320), extra: num(args, "extra", 0), concurrency: num(args, "concurrency", 4), still: num(args, "still", 0.003), jump: num(args, "jump", 0.08) });
      writeJson(join(dir, "curve.json"), m);
      const settledMs = m.settled === null ? null : Math.round((m.settled / x.c.fps) * 1000);
      log(`${s.id} (${m.frames}f, ${ms(t0)})  enter declared ${m.enterDur}f, measured settle ${m.settled === null ? "never" : `${m.settled}f = ${settledMs}ms`}  drift after settle ${(m.drift * 1000).toFixed(2)}‰`);
      log(`  motion  ${sparkline(m.diff, Math.max(0.05, ...m.diff))}`);
      log(`  holds   ${m.holds.map(([a, b]) => `${a}-${b} (${Math.round(((b - a) / x.c.fps) * 1000)}ms)`).join(", ") || "none"}`);
      log(`  jumps   ${m.jumps.map((j) => `+${j.frame} (${(j.diff * 100).toFixed(0)}%)`).join(", ") || "none"}`);
      const verdict: string[] = [];
      const refSpec = str(args, "reference");
      if (refSpec) {
        // file[:from-to] in seconds of the reference clip
        const mm = refSpec.match(/^(.+?)(?::([\d.]+)-([\d.]+))?$/)!;
        const ref = await measureReference(resolvePath(mm[1]), x.c.fps, join(dir, "reference"), { width: num(args, "width", 320), from: mm[2] ? parseFloat(mm[2]) : undefined, to: mm[3] ? parseFloat(mm[3]) : undefined });
        const cmp = compareCurves(m, ref);
        log(`  reference ${basename(ref.file)}${mm[2] ? ` ${mm[2]}-${mm[3]}s` : ""}: ${ref.frames}f, settles ${ref.settled === null ? "never" : `${ref.settled}f`}, ${(ref.holdShare * 100).toFixed(0)}% still, peak ${(ref.peak * 100).toFixed(1)}%`);
        log(`  ref     ${sparkline(ref.diff, Math.max(0.05, ...ref.diff))}`);
        log(`  vs ref  correlation ${cmp.correlation.toFixed(2)}${cmp.settleDelta !== null ? `, settle ${cmp.settleDelta > 0 ? "+" : ""}${cmp.settleDelta}f` : ""}, hold ${cmp.holdDelta > 0 ? "+" : ""}${(cmp.holdDelta * 100).toFixed(0)}pp, amplitude ${cmp.peakRatio.toFixed(2)}x`);
        verdict.push(...cmp.verdict);
      }
      if (rules.maxEnterFrames && m.settled !== null && m.settled > rules.maxEnterFrames) verdict.push(`settles after ${m.settled}f, rule says ${rules.maxEnterFrames}f`);
      if (m.settled !== null && m.enterDur && Math.abs(m.settled - m.enterDur) > 6) verdict.push(`declared enter ${m.enterDur}f but settles at ${m.settled}f`);
      if (rules.holdFrames) {
        const longest = Math.max(0, ...m.holds.map(([a, b]) => b - a));
        if (longest < rules.holdFrames[0]) verdict.push(`longest hold ${longest}f under the ${rules.holdFrames[0]}f minimum (nothing ever stands still)`);
        if (longest > rules.holdFrames[1]) verdict.push(`longest hold ${longest}f over the ${rules.holdFrames[1]}f maximum`);
      }
      const innerJumps = m.jumps.filter((j) => j.frame > (m.enterDur || 0) + 1);
      if (innerJumps.length) verdict.push(`${innerJumps.length} jump${innerJumps.length === 1 ? "" : "s"} after the enter (pop, cut or missing frame?)`);
      log(`  verdict ${verdict.length ? verdict.join("; ") : "ok"}`);
    }
  });
};

const cueFile = (x: Ctx, cue: { file: string }) => (cue.file.startsWith("/") ? cue.file : join(str(x.args, "audio-root") ?? x.cfg.projectDir, cue.file));
const sceneAtSeconds = (c: Compiled, t: number): CompiledScene => locate(c, Math.round(t * c.fps)).scene;
const sec = (t: number) => `${t.toFixed(2)}s`;

/** music coverage from the timeline and the cue files alone, no rendered film needed */
const audioCoverage = async (x: Ctx) => {
  const cues = x.c.timeline.audio ?? [];
  const total = x.c.seconds;
  const music = cues.filter((a) => a.kind === "music");
  if (!music.length) return log("no music cue in the timeline");
  log(`music coverage (film ${sec(total)}, ${x.c.scenes.length} scenes)`);
  let latestEnd = 0;
  for (const cue of music) {
    const file = cueFile(x, cue);
    if (!existsSync(file)) {
      log(`  ${cue.id}: file not found: ${file}`);
      continue;
    }
    const fileSeconds = await ffprobeDuration(file);
    const span = spanOf(x.c, cue, fileSeconds);
    const p = cuePlacement(x.c, cue);
    latestEnd = Math.max(latestEnd, span.end);
    const how = cue.loop ? `loop x${span.copies}, crossfade ${cue.loopCrossfade ?? 2}s` : "plays once";
    const trim = cue.trim ? `, trim ${cue.trim[0]}-${cue.trim[1]}s` : "";
    const head = p.headTrim > 0 ? `, placed ${sec(p.headTrim)} before the film so the head is cut` : "";
    log(`  ${cue.id}: ${basename(file)} ${sec(fileSeconds)}${trim}, ${how}${head}`);
    log(`    covers ${sec(span.start)} -> ${sec(span.end)} (${sceneAtSeconds(x.c, span.start).id} -> ${sceneAtSeconds(x.c, Math.max(0, span.end - 0.001)).id})`);
    if (span.shortBy > 0.05) {
      const s = sceneAtSeconds(x.c, span.end);
      const local = span.end - s.filmStart / x.c.fps;
      log(`    WARNING bed ends ${sec(span.shortBy)} before the film, in scene ${s.id} at ${sec(local)} of ${sec(s.dur / x.c.fps)}${cue.loop ? "" : " (loop: true, or a longer file, or trim less)"}`);
    }
    for (const seam of span.seams) {
      const s = sceneAtSeconds(x.c, seam.at);
      const local = seam.at - s.filmStart / x.c.fps;
      log(`    loop seam at ${sec(seam.at)} (crossfade ${sec(seam.from)} -> ${sec(seam.to)}) falls in scene ${s.id} at ${sec(local)}`);
    }
    if (span.fadeStart !== null && !span.fadeAudible) log(`    WARNING fadeOut ${cue.fadeOut}s starts at ${sec(span.fadeStart)}, after the audio already stopped at ${sec(span.end)}: the fade is silent`);
    // the file's own loud span, so trim comes from numbers
    const prof = await audioProfile(file, 0.25);
    const loud = loudSpan(prof, 12);
    if (loud) log(`    loud span ${sec(loud.first)} -> ${sec(loud.last)} of ${sec(prof.seconds)} (250 ms rms within 12 dB of the max ${db(loud.maxRms).toFixed(1)} dBFS)${cue.trim && (cue.trim[1] < loud.last - 0.5 || cue.trim[0] > loud.first + 0.5) ? "  note: the trim cuts inside the loud span" : ""}`);
    else log(`    loud span: the file is silent`);
    // the head of the file in 100 ms steps: a cold start reads its trim off this line
    const mono = await decodeMono(file, 8000);
    const from = audibleFrom(mono, 8000, -40);
    const headDb = headProfile(mono, 8000, 3, 0.1);
    log(`    audible from ${from === null ? "never (under -40 dBFS throughout)" : sec(from)}${cue.trim ? `, trim starts at ${sec(cue.trim[0])}${from !== null && cue.trim[0] < from ? " (before the sound: the film opens on silence)" : ""}` : ""}`);
    log(`    head 0-3s ${sparkline(headDb.map((d) => Math.max(0, d + 60)))}  (100 ms rms, ${headDb.filter((d) => d > -40).length}/${headDb.length} windows above -40 dBFS)`);
  }
  if (total - latestEnd > 1) log(`  WARNING film is ${sec(total - latestEnd)} longer than all music (music ends at ${sec(latestEnd)}, film at ${sec(total)})`);
};

/** every cue that starts inside or is still sounding during the scene, with scene-local times */
const audioInScene = async (x: Ctx, ids: string[]) => {
  const cues = x.c.timeline.audio ?? [];
  const durations = new Map<string, number>();
  for (const id of ids) {
    const s = x.c.scenes.find((k) => k.id === id);
    if (!s) throw new Error(`unknown scene "${id}". Scenes: ${x.c.scenes.map((k) => k.id).join(", ")}`);
    const s0 = s.filmStart / x.c.fps, s1 = s.filmEnd / x.c.fps;
    log(`scene ${s.id} (${sec(s0)} -> ${sec(s1)}, ${s.dur}f)`);
    let n = 0;
    for (const cue of cues) {
      const file = cueFile(x, cue);
      if (!existsSync(file)) {
        log(`  ${cue.id}: file not found: ${file}`);
        continue;
      }
      if (!durations.has(file)) durations.set(file, await ffprobeDuration(file));
      const span = spanOf(x.c, cue, durations.get(file)!);
      if (span.end <= s0 || span.start >= s1) continue;
      n++;
      const startsInside = span.start >= s0;
      const endsInside = span.end < s1;
      const where = startsInside ? `starts at +${sec(span.start - s0)}` : `sounding since ${sec(s0 - span.start)} before the scene`;
      const until = endsInside ? `, stops at +${sec(span.end - s0)}` : `, still sounding at the cut`;
      const gain = cue.gain !== undefined ? `, gain ${cue.gain}` : "";
      log(`  ${cue.id} (${cue.kind}) ${basename(file)}: ${where}${until}${gain}`);
      for (const rmp of cue.ramps ?? []) {
        const rt = resolveRef(x.c, rmp.at).filmSeconds;
        if (rt >= s0 && rt < s1) log(`    ramp -> ${rmp.to} at +${sec(rt - s0)}${rmp.over ? ` over ${rmp.over}s` : ""}`);
      }
      for (const seam of span.seams) if (seam.at >= s0 && seam.at < s1) log(`    loop seam at +${sec(seam.at - s0)}`);
      if (span.fadeStart !== null && span.fadeStart >= s0 && span.fadeStart < s1) log(`    fade out from +${sec(span.fadeStart - s0)}`);
    }
    if (!n) log("  nothing sounds in this scene");
  }
};

const cmdAudio = async (args: Args) => {
  const x = await ctx(args);
  const only = list(args, "scene");
  if (only) return audioInScene(x, only);
  await audioCoverage(x);
  log("");
  const explicit = args._[0];
  const file = explicit ?? join(x.cfg.cachePath, "out", `${x.filmName}-${x.format}.mp4`);
  if (!existsSync(file)) {
    if (explicit) die(`no such file: ${file}`);
    return log(`no rendered film at ${file} (run mh render for the mix profile)`);
  }
  const p = await audioProfile(file, num(args, "window", 0.25));
  log(`${file}: ${p.seconds.toFixed(2)}s, peak ${p.peak.toFixed(2)} (${db(p.peak).toFixed(1)} dBFS), first sound at ${p.silentUntil === null ? "0.00" : p.silentUntil.toFixed(2)}s`);
  log(`  rms   ${sparkline(p.rms)}`);
  const secs = Math.ceil(p.seconds);
  const marks = Array.from({ length: Math.ceil(secs / 5) + 1 }, (_, i) => String(i * 5).padEnd(Math.round(5 / p.window)));
  log(`  sec   ${marks.join("")}`);
  for (const s of x.c.scenes) {
    const t = s.filmStart / x.c.fps;
    const v = rmsAt(p, t + 0.1);
    if (v < 0.002) log(`  silent at scene ${s.id} (${t.toFixed(2)}s): rms ${v.toFixed(4)}`);
  }
  // what the platforms measure: integrated loudness and true peak against each target
  try {
    const L = await measureLoudness(file);
    log(`  loudness ${L.lufs.toFixed(1)} LUFS integrated, true peak ${L.truePeak.toFixed(1)} dBTP, range ${L.lra.toFixed(1)} LU`);
    for (const [name, t] of Object.entries(PLATFORM_TARGETS)) if (["youtube", "tiktok", "instagram", "linkedin"].includes(name)) log(`    ${name.padEnd(9)} target ${t.lufs} LUFS / ${t.truePeak} dBTP: ${loudnessVerdict(L, t)}`);
    log(`    mh deliver --platforms youtube,tiktok writes copies normalised to each target`);
  } catch (e) {
    log(`  loudness: ${(e as Error).message.split("\n")[0]}`);
  }
  // short cues under a bed: the rms window is too wide to see a 150 ms key, the high-passed peak is not
  const mixHp = highpass(await decodeMono(file, AUDIBILITY_SR), AUDIBILITY_SR, 2000);
  for (const cue of x.c.timeline.audio ?? []) {
    const raw = resolveUnclamped(x.c, cue.at).filmSeconds;
    const t = Math.max(0, raw);
    const before = rmsAt(p, Math.max(0, t - 0.3)), after = rmsAt(p, t + 0.3);
    // a cue whose first ramp starts where it starts is a fade-in, not silence: judge it after the ramp
    const fadeIn = (cue.ramps ?? []).map((r) => ({ at: resolveUnclamped(x.c, r.at).filmSeconds, over: r.over ?? 0, to: r.to })).find((r) => Math.abs(r.at - raw) < 0.05 && r.over > 0 && (cue.gain ?? 1) < r.to);
    const afterFade = fadeIn ? rmsAt(p, t + fadeIn.over + 0.3) : after;
    const silent = afterFade < 0.002;
    let verdict = silent ? "  NOTHING AUDIBLE" : "";
    if (fadeIn) verdict = `  fade-in over ${fadeIn.over}s (gain ${cue.gain ?? 1} -> ${fadeIn.to}), rms after it ${afterFade.toFixed(3)}${silent ? "  NOTHING AUDIBLE" : ""}`;
    log(`  cue ${cue.id} (${cue.kind}) at ${t.toFixed(2)}s${raw < 0 ? ` (placed ${(-raw).toFixed(2)}s before the film, head cut)` : ""}: rms before ${before.toFixed(3)} after ${after.toFixed(3)}${verdict}`);
    if (cue.kind === "sfx") {
      const a = cueAudibility(mixHp, AUDIBILITY_SR, t, { window: num(args, "cue-window", 0.06), before: num(args, "cue-before", 0.2) });
      log(`    >2 kHz peak in ${Math.round(a.window * 1000)}ms at the cue ${a.peakAtDb.toFixed(1)} dBFS vs ${Math.round(a.before * 1000)}ms before ${a.peakBeforeDb.toFixed(1)} dBFS: ${a.deltaDb >= 0 ? "+" : ""}${a.deltaDb.toFixed(1)} dB  ${a.verdict.toUpperCase()}${a.verdict === "masked" ? " (the bed covers it: more gain, a brighter sample, or duck the bed)" : ""}`);
    }
    for (const rmp of cue.ramps ?? []) {
      const rr = resolveUnclamped(x.c, rmp.at).filmSeconds;
      const rt = Math.max(0, rr);
      log(`    ramp -> ${rmp.to} at ${rt.toFixed(2)}s${rr < 0 ? ` (WARNING resolves to ${rr.toFixed(2)}s, before the film: clamped to 0)` : ""}: rms ${rmsAt(p, Math.max(0, rt - 0.3)).toFixed(3)} -> ${rmsAt(p, rt + (rmp.over ?? 0) + 0.3).toFixed(3)}`);
    }
  }
};


const cmdSfx = async (args: Args) => {
  const x = await ctx(args);
  const cues = x.c.timeline.audio ?? [];
  const wanted = flag(args, "all") ? cues : cues.filter((a) => a.kind === "sfx");
  if (!wanted.length) return log(flag(args, "all") ? "no audio cues in the timeline" : "no sfx cues in the timeline (--all includes music)");
  const byFile = new Map<string, { cues: typeof cues; a?: SfxAnalysis; seconds?: number }>();
  for (const cue of wanted) {
    const file = cueFile(x, cue);
    const e = byFile.get(file) ?? { cues: [] };
    e.cues.push(cue);
    byFile.set(file, e);
  }
  const rows: (string | number)[][] = [];
  const warnings: string[] = [];
  const msOf = (t: number) => `${Math.round(t * 1000)}ms`;
  for (const [file, e] of byFile) {
    const ids = e.cues.map((c) => c.id).join(",");
    if (!existsSync(file)) {
      rows.push([basename(file), ids, "missing", "", "", ""]);
      warnings.push(`${ids}: file not found: ${file}`);
      continue;
    }
    const a = await analyzeFile(file);
    e.a = a;
    rows.push([basename(file), ids, a.seconds.toFixed(2) + "s", a.silent ? "-" : msOf(a.attack), a.silent ? "-" : msOf(a.tail), a.silent ? "silent" : `${a.peakDb.toFixed(1)} dBFS`]);
    for (const cue of e.cues) {
      if (cue.kind === "sfx" && looksLikeHit(cue.id, file)) for (const w of hitWarnings(a)) warnings.push(`${cue.id}: named like a hit but ${w}`);
      if (cue.kind === "music") {
        const span = spanOf(x.c, cue, a.seconds);
        if (span.shortBy > 0.05 && !cue.loop) warnings.push(`${cue.id}: ${a.seconds.toFixed(2)}s of music${cue.trim ? ` (trim ${cue.trim[0]}-${cue.trim[1]}s)` : ""} must cover ${sec(x.c.seconds - span.start)} from ${sec(span.start)}, ends ${sec(span.shortBy)} early in scene ${sceneAtSeconds(x.c, span.end).id}`);
      }
    }
  }
  log(table(rows, ["file", "cues", "length", "attack", "tail", "peak"]));
  log(`attack = first sample above -40 dBFS to the peak, tail = peak to the last sample above -40 dBFS`);
  if (warnings.length) {
    log("");
    for (const w of warnings) log(`WARNING ${w}`);
  }
  if (flag(args, "json")) out(JSON.stringify([...byFile].map(([file, e]) => ({ file, cues: e.cues.map((c) => c.id), ...(e.a ?? {}) })), null, 2));
};

const cmdBeats = async (args: Args) => {
  const x = await ctx(args);
  const file = args._[0] ?? join(x.cfg.cachePath, "out", `${x.filmName}-${x.format}.mp4`);
  if (!existsSync(file)) die(`no such film: ${file} (run mh render first)`);
  const sr = 8000;
  const tol = num(args, "tolerance", 60) / 1000;
  const mix = await decodeMono(file, sr);
  const mixA = onsetStrength(mix, sr);
  const onsets = pickOnsets(mixA, { k: num(args, "k", 2.2) });
  log(`${file}: ${mixA.seconds.toFixed(2)}s, ${onsets.length} onsets in the mix (energy rises)`);

  // beat grid from the music bed, shifted to film time
  let grid: { bpm: number; ticks: number[]; confidence: number; cueId: string } | null = null;
  const music = (x.c.timeline.audio ?? []).find((a) => a.kind === "music");
  if (music && !flag(args, "no-music")) {
    const mf = music.file.startsWith("/") ? music.file : join(x.cfg.projectDir, music.file);
    if (existsSync(mf)) {
      const m = await decodeMono(mf, sr);
      const mA = onsetStrength(m, sr);
      const g = beatGrid(mA, { minBpm: num(args, "min-bpm", 60), maxBpm: num(args, "max-bpm", 200) });
      const raw = resolveUnclamped(x.c, music.at).filmSeconds;
      const trimHead = (music.trim?.[0] ?? 0) + (raw < 0 ? -raw : 0);
      const start = Math.max(0, raw);
      let ticks = g.ticks.map((t) => t - trimHead + start).filter((t) => t >= 0 && t <= x.c.seconds);
      if (music.loop && ticks.length) {
        // a looped bed keeps its pulse: extend the grid to the end of the film
        for (let t = ticks[ticks.length - 1] + g.period; t <= x.c.seconds; t += g.period) ticks.push(t);
      }
      grid = { bpm: g.bpm, ticks, confidence: g.confidence, cueId: music.id };
      log(`music "${music.id}": ${g.bpm.toFixed(1)} bpm (confidence ${(g.confidence * 100).toFixed(0)}%), ${ticks.length} beat ticks in the film, first tick at ${ticks[0]?.toFixed(2)}s`);
    } else log(`music file not found, no beat grid: ${mf}`);
  }

  const rows: (string | number)[][] = [];
  let onBeat = 0, near = 0, off = 0;
  const cuts = x.c.scenes.filter((s) => s.index > 0);
  for (const s of cuts) {
    const t = s.filmStart / x.c.fps;
    const o = nearest(t, onsets.map((k) => k.t));
    const b = grid ? nearest(t, grid.ticks) : null;
    const dOn = o ? Math.round(o.delta * 1000) : null;
    const dBeat = b ? Math.round(b.delta * 1000) : null;
    const best = Math.min(Math.abs(dOn ?? 1e9), Math.abs(dBeat ?? 1e9)) / 1000;
    const verdict = best <= tol ? "on" : best <= tol * 2 ? "near" : "off";
    if (verdict === "on") onBeat++; else if (verdict === "near") near++; else off++;
    rows.push([s.id, fmtTime(s.filmStart, x.c.fps), s.enter.type, dOn === null ? "" : `${dOn > 0 ? "+" : ""}${dOn}ms`, dBeat === null ? "" : `${dBeat > 0 ? "+" : ""}${dBeat}ms`, verdict]);
  }
  log("");
  log(table(rows, ["cut into", "film", "enter", "vs onset", "vs beat", "verdict"]));
  log(`${cuts.length} cuts: ${onBeat} on (<= ${Math.round(tol * 1000)}ms), ${near} near, ${off} off. Positive = cut after the sound, negative = cut before it.`);

  const sfx = (x.c.timeline.audio ?? []).filter((a) => a.kind === "sfx");
  if (sfx.length) {
    log("");
    for (const cue of sfx) {
      const t = resolveUnclamped(x.c, cue.at).filmSeconds;
      const o = nearest(t, onsets.map((k) => k.t));
      log(`sfx ${cue.id} at ${t.toFixed(2)}s: nearest onset ${o ? `${Math.round(o.delta * 1000)}ms` : "none"}${o && Math.abs(o.delta) > tol ? "  NOT HEARD WHERE PLACED" : ""}`);
    }
  }
  if (flag(args, "suggest") && grid) {
    // quantize: walk the scenes, and for each cut propose the duration change that lands it on the nearest tick
    log("");
    const maxShift = num(args, "max-shift", 10);
    const sugg: (string | number)[][] = [];
    const dropped: string[] = [];
    const accepted: Record<string, number> = {}; // scene id -> new duration, so every later check sees the earlier changes
    let drift = 0; // frames already added/removed before this scene
    const wanted = new Set(scenesOf(x.c, args).map((s) => s.id));
    for (const s of x.c.scenes) {
      if (s.index === x.c.scenes.length - 1) break;
      if (!wanted.has(s.id)) continue;
      const cut = (s.filmEnd + drift) / x.c.fps;
      const b = nearest(cut, grid.ticks);
      if (!b) continue;
      let delta = Math.round(-b.delta * x.c.fps); // frames to add so the cut lands on the tick
      if (Math.abs(delta) > maxShift || s.dur + delta < 1) delta = 0;
      if (delta !== 0) {
        // the timeline rules get the last word: a shorter scene may break minSceneDur, the enter length or the text time
        const findings = vetDurations(x.cfg, x.c, { ...accepted, [s.id]: s.dur + delta }, s.id);
        if (findings.length) {
          dropped.push(`${s.id} ${s.dur}f -> ${s.dur + delta}f: ${findings.map((f) => `${f.rule} (${f.message})`).join("; ")}`);
          delta = 0;
        }
      }
      if (delta !== 0) {
        accepted[s.id] = s.dur + delta;
        sugg.push([s.id, s.dur, s.dur + delta, delta > 0 ? `+${delta}` : String(delta), `${fmtTime(s.filmEnd + drift, x.c.fps)} -> ${fmtTime(s.filmEnd + drift + delta, x.c.fps)}`]);
      }
      drift += delta;
    }
    log(table(sugg, ["scene", "dur", "new dur", "change", "cut moves"]));
    log(`${sugg.length} duration changes would put every following cut on the ${grid.bpm.toFixed(0)} bpm grid (max shift ${maxShift}f); film length changes by ${drift} frames. Apply them in the timeline, then re-render and run beats again.`);
    if (dropped.length) {
      log(`${dropped.length} suggestion${dropped.length === 1 ? "" : "s"} dropped, the timeline rules would fail:`);
      for (const d of dropped) log(`  ${d}`);
    }
  }
  if (flag(args, "onsets")) {
    log("");
    log(`onsets: ${onsets.map((k) => k.t.toFixed(2)).join(" ")}`);
  }
  if (flag(args, "json")) out(JSON.stringify({ file, onsets, grid, cuts: rows }, null, 2));
};

const cmdRender = async (args: Args) => {
  const formats = await formatsOf(args);
  const outDir = str(args, "out-dir");
  if (formats.length > 1 && str(args, "out")) die("--out names one file; with --format all use --out-dir <dir> (files are named <film>-<format>.mp4)");
  for (const format of formats) {
    if (formats.length > 1) log(`\n== render ${format}`);
    await renderOne({ ...args, format, ...(outDir ? { out: join(ensureDir(resolvePath(outDir)), `${(await ctx({ ...args, format })).filmName}-${format}.mp4`) } : {}) });
  }
};

const renderOne = async (args: Args) => {
  const x = await ctx(args);
  const t0 = performance.now();
  const mixOpts = { out: str(args, "out"), web: flag(args, "web") && !flag(args, "draft"), log, audioRoot: str(args, "audio-root") };
  const res = await withLock(x.cfg.cachePath, `render ${x.filmName} ${x.format}`, async () => {
    if (flag(args, "remix")) {
      // no picture step at all: the concatenated picture from the cache, mixed again
      const picture = picturePath(x.cfg, x.filmName, x.format, engineOf(x));
      if (!existsSync(picture)) die(`--remix needs a rendered picture, none in the cache for ${x.filmName} ${x.format} (expected ${picture}). Run "mh render" once without --remix.`);
      log(`remix from ${picture} (${new Date(statSync(picture).mtimeMs).toISOString()})`);
      return mixFilm(x.cfg, x.c, picture, x.filmName, x.format, mixOpts);
    }
    return withEngine(x, async (e) => {
      // a 12-core machine renders four tabs at a time by default: use most of the cores, leave two for the encoder
      const conc = num(args, "concurrency", Math.max(2, Math.min(10, cpus().length - 2)));
      const quality = flag(args, "draft") ? DRAFT : { ...FULL, crf: num(args, "crf", 18) };
      if (flag(args, "draft") && flag(args, "web")) log("--draft skips the web copy");
      if (flag(args, "preview")) {
        // only these scenes: their segments, the parts' own sound trimmed to them, the cues that sound in that span
        const scenes = scenesOf(x.c, args);
        if (!list(args, "scene") && !str(args, "part")) die("--preview needs --scene a[,b] (or --part)");
        const ids = scenes.map((s) => s.id);
        const segs = await renderSegments(x.cfg, e, x.c, x.filmName, x.format, { subset: ids, quality, log, concurrency: conc, force: flag(args, "force") });
        const all = [...segs.values()].flat();
        log(`${all.filter((s) => s.cached).length} segments cached, ${all.filter((s) => !s.cached).length} rendered`);
        const parts = [...new Set(scenes.map((s) => s.part))];
        const audio = flag(args, "no-audio") ? new Map<string, string>() : await renderPartAudio(x.cfg, e, x.c, x.filmName, x.format, { log, concurrency: conc, parts });
        const { picture, span } = await concatScenes(x.cfg, x.c, scenes, segs, audio, x.filmName, x.format, x.size, { log });
        const name = `${x.filmName}-${x.format}-preview-${scenes.map((s) => s.id).join("+")}`;
        if (flag(args, "no-audio")) return { master: picture };
        return mixFilm(x.cfg, x.c, picture, x.filmName, x.format, { ...mixOpts, out: str(args, "out") ?? join(ensureDir(join(x.cfg.cachePath, "out")), `${name}.mp4`), span });
      }
      const segs = await renderSegments(x.cfg, e, x.c, x.filmName, x.format, { only: list(args, "scene"), quality, log, concurrency: conc, force: flag(args, "force") });
      const all = [...segs.values()].flat();
      log(`${all.filter((s) => s.cached).length} segments cached, ${all.filter((s) => !s.cached).length} rendered`);
      const audio = flag(args, "no-audio") ? new Map<string, string>() : await renderPartAudio(x.cfg, e, x.c, x.filmName, x.format, { log, concurrency: conc });
      const picture = await concatParts(x.cfg, x.c, segs, audio, x.filmName, x.format, x.size, { log, engine: e.kind });
      if (flag(args, "no-audio")) return { master: picture };
      return mixFilm(x.cfg, x.c, picture, x.filmName, x.format, mixOpts);
    });
  }, log);
  produced(res.master);
  if (res.web) produced(res.web);
  const st = await mediaStats(res.master);
  log(`film -> ${res.master}  ${statsLine(st, Math.round(st.seconds * x.c.fps))}${res.web ? `\nweb  -> ${res.web}  ${statsLine(await mediaStats(res.web))}` : ""}  (${ms(t0)})`);
};

/**
 * Empty the cache: frames, motion curves, segments, film pictures and outputs.
 * Approved frame runs and review comments stay unless --all. --older-than N keeps
 * anything touched in the last N days.
 */
const cmdClean = async (args: Args) => {
  const cfg = await loadConfig(projectDirOf(args));
  const cache = cfg.cachePath;
  if (!existsSync(cache)) return log(`nothing to clean, no cache at ${cache}`);
  const keepApproved = !flag(args, "all") && args["keep-approved"] !== "false";
  const keepReview = !flag(args, "all");
  const days = num(args, "older-than", 0);
  const cutoff = Date.now() - days * 86400_000;
  const isApproved = (dir: string) => /(^|\/)approved(\/|$)/.test(dir) || existsSync(join(dir, "approved.json")) || existsSync(join(dir, "approved"));
  const newest = (p: string): number => {
    const st = statSync(p);
    if (!st.isDirectory()) return st.mtimeMs;
    return Math.max(st.mtimeMs, ...readdirSync(p).map((n) => newest(join(p, n))));
  };
  let freed = 0;
  let kept = 0;
  const removed: string[] = [];
  const drop = (p: string) => {
    if (!existsSync(p)) return;
    if (days > 0 && newest(p) > cutoff) {
      kept++;
      return;
    }
    freed += dirSize(p) || statSync(p).size;
    rmSync(p, { recursive: true, force: true });
    removed.push(p.replace(cache + "/", ""));
  };
  await withLock(cache, "clean", async () => {
    // frames: per film-format, per run tag; "latest" pointers go when their run goes
    const frames = join(cache, "frames");
    if (existsSync(frames)) {
      for (const ff of readdirSync(frames)) {
        const fdir = join(frames, ff);
        if (!statSync(fdir).isDirectory()) continue;
        for (const tag of readdirSync(fdir)) {
          const run = join(fdir, tag);
          if (tag === "latest") continue;
          if (keepApproved && isApproved(run)) {
            kept++;
            continue;
          }
          drop(run);
        }
        const latest = join(fdir, "latest");
        if (existsSync(latest) && !existsSync(join(fdir, readFileSync(latest, "utf8").trim()))) rmSync(latest);
        if (!readdirSync(fdir).length) rmSync(fdir, { recursive: true });
      }
      if (!readdirSync(frames).length) rmSync(frames, { recursive: true });
    }
    for (const top of ["motion", "segments", "film", "out", "probe"]) {
      const d = join(cache, top);
      if (!existsSync(d)) continue;
      for (const n of readdirSync(d)) drop(join(d, n));
      if (!readdirSync(d).length) rmSync(d, { recursive: true });
    }
    if (!keepReview) drop(join(cache, "review"));
  }, log);
  if (flag(args, "verbose")) for (const r of removed) log(`  removed ${r}`);
  log(`freed ${mb(freed)}: ${removed.length} item${removed.length === 1 ? "" : "s"} removed${kept ? `, ${kept} kept (${keepApproved ? "approved, " : ""}${days > 0 ? `newer than ${days}d` : ""})`.replace(/, \)$/, ")") : ""}${keepReview ? "; review comments kept" : ""}. Bundle and entry stay (rebuilt when the source changes).`);
};

const cmdReview = async (args: Args) => {
  const x = await ctx(args);
  const video = args._[0] ?? str(args, "video") ?? join(x.cfg.cachePath, "out", `${x.filmName}-${x.format}.mp4`);
  const exportTo = str(args, "export");
  if (exportTo) {
    // one standalone page: the film by url, or embedded (a 960 px copy when the master is heavy)
    const url = str(args, "url");
    let src = url ?? video;
    if (!url) {
      if (!existsSync(video)) die(`no film at ${video}, run "mh render" or pass a file`);
      const bytes = statSync(video).size;
      if (flag(args, "embed") && bytes > 6 * 1024 * 1024 && !flag(args, "full")) {
        const small = join(ensureDir(join(x.cfg.cachePath, "review")), `${x.filmName}-${x.format}-960.mp4`);
        if (!existsSync(small) || statSync(small).mtimeMs < statSync(video).mtimeMs) {
          log(`embedding a 960 px copy (${mb(bytes)} master), --full embeds the master`);
          await run(["ffmpeg", "-y", "-v", "error", "-i", video, "-vf", "scale=960:-2", "-c:v", "libx264", "-preset", "medium", "-crf", "26", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", small]);
        }
        src = small;
      }
    }
    const html = reviewPage({ film: x.filmName, format: x.format, c: x.c, video: src, embed: flag(args, "embed") && !url, title: str(args, "title"), fragment: flag(args, "artifact") });
    writeFileSync(resolvePath(exportTo), html);
    produced(resolvePath(exportTo));
    return log(`review page -> ${exportTo} (${mb(Buffer.byteLength(html))}${url ? `, film from ${url}` : flag(args, "embed") ? ", film embedded" : `, film by path ${src}`})`);
  }
  if (!existsSync(video)) die(`no film at ${video}, run "mh render" or pass a file`);
  const port = num(args, "port", 4848);
  startReviewServer(x.cfg, x.c, x.filmName, x.format, resolvePath(video), port);
  log(`review player on http://localhost:${port}  (${video})`);
  log(`comments -> ${commentsPath(x.cfg, x.filmName, x.format)}; read them with: mh feedback`);
  await new Promise(() => {});
};

const cmdFeedback = async (args: Args) => {
  const x = await ctx(args);
  const from = str(args, "from");
  if (from) {
    // free text from a file or stdin, every timestamp / scene / event / copy fragment turned into an address
    const text = from === "-" ? await Bun.stdin.text() : existsSync(from) ? readFileSync(from, "utf8") : die(`no such file: ${from}`);
    const parsed = parseFeedback(x.c, text as string);
    if (flag(args, "json")) return out(JSON.stringify(parsed.map((p) => ({ text: p.text, hits: p.hits.map((h) => ({ phrase: h.phrase, kind: h.kind, via: h.via, ref: h.ref, scene: h.location.scene.id, local: h.location.local, filmFrame: h.location.filmFrame, filmSeconds: h.location.filmSeconds, until: h.until ? { scene: h.until.scene.id, local: h.until.local, filmFrame: h.until.filmFrame } : undefined })), unresolved: p.unresolved })), null, 2));
    return log(feedbackReport(x.c, parsed, fmtTime));
  }
  const ks = loadComments(x.cfg, x.filmName, x.format);
  if (flag(args, "clear")) {
    writeJson(commentsPath(x.cfg, x.filmName, x.format), []);
    return log(`cleared ${ks.length} comments`);
  }
  if (flag(args, "json")) return log(JSON.stringify(ks, null, 2));
  log(feedbackMarkdown(x.c, flag(args, "all") ? ks : ks.filter((k) => !k.done)));
};

/** measure the declared cursor legs for one format and write the targets module; returns the file */
const cursorRun = async (x: Ctx): Promise<string> => {
  const cursor = x.cfg.films[x.filmName].cursor;
  if (!cursor?.legs?.length) throw new Error(`film "${x.filmName}" declares no cursor legs (films.${x.filmName}.cursor.legs)`);
  const rel = cursor.out?.[x.format];
  if (!rel) throw new Error(`films.${x.filmName}.cursor.out has no file for format "${x.format}" (has: ${Object.keys(cursor.out ?? {}).join(", ") || "none"})`);
  const targets = await withEngine(x, (e) => measureLegs(e, x.cfg, x.c, x.format, x.size.width, cursor, { settleMs: num(x.args, "settle", 150), concurrency: num(x.args, "concurrency", 4), log }));
  const w = writeTargets(resolvePath(x.cfg.projectDir, rel), targets);
  log(table(targets.map((t) => [t.id, `f${t.frame}`, t.x, t.y, `${t.click ? "click" : t.id.endsWith("(hover)") ? "hover" : "park"}${t.dwell ? ` dwell ${t.dwell}f` : ""}`]), ["leg", "part f", "x", "y", ""]));
  log(`${x.format}: ${targets.length} targets -> ${rel}${w.changed ? "" : " (unchanged)"}`);
  return `${rel}${w.changed ? " updated" : " unchanged"}`;
};

const cmdCursor = (args: Args) => eachFormat(args, async (a) => void (await cursorRun(await ctx(a))));

/** one bundle, then every gate of an edit round; a summary table, exit 2 when a step fails */
const cmdCheck = async (args: Args) => {
  const rows: (string | number)[][] = [];
  let failed = 0;
  const step = async (name: string, fn: () => Promise<string | void>) => {
    const t0 = performance.now();
    log(`\n== ${name}`);
    try {
      rows.push([name, "pass", (await fn()) ?? "", ms(t0)]);
    } catch (e) {
      failed++;
      const msg = (e as Error).message ?? String(e);
      log(`FAIL ${msg}`);
      rows.push([name, "FAIL", msg.split("\n")[0].slice(0, 100), ms(t0)]);
    }
  };
  const gate = (findings: Finding[]) => {
    log(formatFindings(findings));
    const errors = findings.filter((f) => f.level === "error").length;
    if (errors) throw new Error(`${errors} lint error${errors === 1 ? "" : "s"}`);
    return `${findings.length} warning${findings.length === 1 ? "" : "s"}`;
  };
  const formats = await formatsOf(args);
  const first = await ctx({ ...args, format: formats[0] });
  const scenes = list(args, "scene");
  if (scenes) scenesOf(first.c, args);
  const tsconfig = join(first.cfg.projectDir, "tsconfig.json");
  if (existsSync(tsconfig)) {
    await step("typecheck", async () => {
      const r = await run(["bunx", "tsc", "--noEmit", "-p", first.cfg.projectDir], { quiet: true });
      if (r.code !== 0) throw new Error(`tsc: ${r.out.trim().split("\n").slice(0, 8).join("\n")}`);
    });
  } else rows.push(["typecheck", "skip", "no tsconfig.json in the project", ""]);
  await step("bundle", async () => {
    if (engineOf(first) === "native") return "native engine: vite serves the source, nothing to bundle";
    const b = await bundleProject(first.cfg, { force: flag(args, "rebundle"), log });
    return `${b.fresh ? "built" : "reused"} ${b.hash.slice(0, 12)}`;
  });
  await step("lint static+timeline", async () => gate(await lintRun(first, { ...args, static: true, timeline: true })));
  const xs = await Promise.all(formats.map((format) => ctx({ ...args, format })));
  // cursor targets first: they are source the film reads, so a changed layout re-bundles once here, not per format later
  if (first.cfg.films[first.filmName].cursor?.legs?.length) for (const x of xs) await step(`cursor ${x.format}`, () => cursorRun(x));
  for (const x of xs) {
    const { format } = x;
    await step(`doctor ${format}`, async () => {
      const bad = await doctorRun(x, args);
      if (bad.length) throw new Error(bad.join("; "));
    });
    if (scenes) {
      const tag = `check-${stamp()}-${format}`;
      await step(`frames+sheets ${format}`, async () => {
        await cmdFrames({ ...args, format, probe: "text", quiet: true, sheet: true, tag });
        return `${scenes.join(",")} -> run ${tag}`;
      });
      await step(`lint rendered ${format}`, async () => gate(await lintRun(x, { ...args, format, rendered: true, from: tag })));
    }
  }
  log("");
  log(table(rows, ["step", "", "detail", "took"]));
  log(failed ? `${failed} step${failed === 1 ? "" : "s"} failed` : "all steps passed");
  if (failed) process.exit(2);
};

const cmdBundle = async (args: Args) => {
  const x = await ctx(args);
  if (engineOf(x) === "native") return log("native engine: there is no bundle, vite serves the source on demand");
  const b = await bundleProject(x.cfg, { force: flag(args, "force") || true, log });
  log(`bundle: ${b.serveUrl} (${b.hash.slice(0, 12)})`);
};

/** the outer loop: mh as an MCP server on stdio (claude mcp add motion-harness -- mh mcp) */
const cmdMcp = async () => {
  await import("./mcp/server.ts");
  await new Promise(() => {});
};

const cmdInit = async (args: Args) => {
  const projectDir = resolvePath(str(args, "project") ?? process.env.MH_PROJECT ?? process.cwd());
  const file = join(projectDir, "harness.config.ts");
  if (existsSync(file) && !flag(args, "force")) die(`${file} exists`);
  writeFileSync(file, readFileSync(join(import.meta.dir, "../templates/harness.config.ts"), "utf8"));
  log(`wrote ${file}. Fill in root, films and tokens, then run: mh doctor`);
};

const help = `mh <command> [--project dir] [--film name] [--format wide|all]

  timeline [--json]                 the compiled timeline: scenes, frames, film time, events, audio
  resolve <ref...> [--json]         20.5s | f616 | probe | probe.pick1 | probe+12 | product:f120 | #7
  docs [--out file]                 the edit decision list as markdown, generated, never hand-edited
  doctor                            ffmpeg + filters, remotion versions, cues decode, gitignored assets, compositions registered, drift, cache size
  bundle [--force]                  bundle the project through the harness wrapper
  check [--scene a,b] [--format x|all]
                                    one edit round: typecheck, bundle, lint, doctor, cursor targets, frames + sheets and rendered lint of the touched scenes
  cursor [--format x|all]           measure the film's cursor legs with the DOM probe, write the CURSOR_TARGETS module per format

  frames [--scene a,b] [--dense N] [--probe text] [--tag t] [--sheet] [--at ref,ref] [--zoom key]
                                    render the check frames of each scene (enter, settled, events with their -6..+18 window, mid, last), plus any --at refs
  frame <ref...> [--format all] [--crop x,y,w,h] [--probe] [--json]
                                    exactly these frames, now, by any address resolve accepts (turn+40, 20.5s, probe.pick1+3, f616); prints the paths
  still [<id,...>|all] [--jpg] [--width 1280] [--sheet] [--out dir] [--no-fail]
                                    every <Still> the Root registers (no args lists them): rendered through the probe, linted (overflow, wrap, collision), jpg copies, one sheet
  sheet [--scene a,b] [--from tag] [--all] [--columns 4] [--zoom key]
                                    contact sheets with frame numbers, scene addresses and transition marks; --zoom crops 480x320 at 1:1 around the probed element
  approve [--from tag]              copy a run (default latest) to "approved", the fixed side of every later diff
  locate <image.png> [--from tag]   which frame is this? perceptual hash of a pasted still against a frames run
  probe <ref> [--mode text|probe|all] [--find text] [--key k] [--json]   --key prints one element's centre (cursor targets)
                                    where is what: element boxes, colors, fonts at a frame, straight from the DOM
  lint [--static] [--timeline] [--rendered] [--clips] [--format all] [--no-fail]
                                    colors vs tokens (source and painted), text durations, events, safe zone,
                                    overflow, wrap, collision, same-top, format-parity (--rendered runs every format by default)
  diff [tagA] [tagB] [--min 0.002]  which check frames changed between two runs (default approved vs latest), touched scenes first
  compare <a.png> <b.png> [--out diff.png]   two pictures: changed pixels, mean, box, diff image (same frame on both engines?)
  motion --scene a[,b] [--width 320] [--reference clip.mp4[:from-to]]
                                    frame-to-frame motion curve: when it settles, how long it holds, where it jumps; --reference compares shape, settle and hold with a clip
  audio [file] [--window 0.25] [--scene id]
                                    music coverage (bed end, loop seams, loud span for trim), loudness vs platform targets, then the rms profile of the film and every cue checked
                                    --scene id: every cue that starts in or sounds during that scene, in scene-local time
  sfx [--all] [--json]              every cue file once: length, attack, tail, peak; warns when a "hit" is a riser or a bed is too short
  beats [file] [--tolerance 60] [--suggest]
                                    onsets in the mix, beat grid from the music, every cut measured; --suggest quantizes scene lengths to the grid (timeline rules veto)

  bench --scene id [--concurrencies 4,6,8,10]   one scene at each concurrency, full and draft: pick the defaults from numbers
  render [--scene a,b] [--force] [--draft] [--crf 18] [--web] [--no-audio] [--out file] [--format all --out-dir dir]
                                    scene segments (cached), parts by concat, music and sfx mixed from the timeline; every segment and film logs size and bitrate
  render --scene a[,b] --preview    only those scenes as a clip, with the cues that sound in them (contiguous scenes)
  render --remix                    no picture work: the cached picture mixed again (music/sfx/gain changes)
  clean [--older-than days] [--keep-approved=false] [--all] [--verbose]
                                    empty the cache (frames, motion, segments, film, out); keeps approved runs and review comments
  review [file] [--port 4848]       the player with the scene bar, comments land as scene+frame
  review --export page.html [--embed | --url https://...] [--title t] [--artifact]
                                    the player as one standalone page: accessibility tree, keyboard for every gesture, state read-back (#mh-state, window.mhState()),
                                    comments in a shared db when published as a claude.ai artifact, else in the browser; --embed inlines the film
  feedback [--all] [--json] [--clear]
                                    the comments as an agent-readable list, grouped by scene
  feedback --from <file|->          free text ("bei 1:09", "Sekunde 19-21", "beim Klicken") turned into scene addresses
  srt [--out file] [--chapters] [--captions=false] [--lang de]
                                    subtitles from the timeline: one entry per scene with text (or caption), times from the compile; --chapters prints the YouTube list; --lang reads timeline.i18n
  captions [file] [--lang de] [--out file]
                                    the subtitles burned into the rendered film (config.captions for the style, bottom inset from the safe zone)
  voice [--force] [--dry-run]       voice cues (kind "voice" with text): synthesise missing or changed lines (ElevenLabs, ELEVENLABS_API_KEY), measure each against its scene
  clips [add <file> --id --prompt --model --seed --credits --cost --attempts]
                                    generated clips registry (clips.json): what each cost and looks like; lint clip-colour-drift between consecutive clips
  judge --scene a[,b] [--model m] [--checklist "a;b"] [--file clip.mp4]
                                    a model watches the clip (Gemini, GEMINI_API_KEY): findings with film times, leads to confirm with mh frame
  deliver --out dir [--format all] [--films dir] [--stills a,b|all] [--lang en] [--platforms youtube,tiktok] [--captions] [--upload prefix]
                                    films per format, stills as jpg, the srt, per-platform loudness copies, burned captions, a manifest (sizes, sha1, loudness, chapters, urls) and a .gitignore for the mp4;
                                    --upload puts every file on S3/R2 (MH_S3_* or CLOUDFLARE_* env) and records the urls
  init [--force]                    write a harness.config.ts template into the project
  mcp                               serve mh as an MCP server on stdio (typed tools mh_timeline, mh_frame, mh_check, mh_render, mh_deliver, ... plus a raw "mh" tool)

  engine: --engine remotion|native (or config.engine): remotion uses the project's Remotion install, native runs Vite + shim + Playwright without it
  project: --project dir, else $MH_PROJECT, else the cwd when it holds harness.config.ts, else the project used last (~/.mh/last)
  --format all fans check, frames, frame, lint, cursor, render and deliver out over every format of the film
  lint --rendered refuses a run whose bundle is older than the sources (--allow-stale reads it anyway); sheet warns
  every command writes a receipt (<cache>/receipts/<stamp>-<cmd>.json: args, source hash, engine, outputs with sha1, status); --receipt prints its path
`;

const commands: Record<string, (a: Args) => Promise<void>> = {
  timeline: cmdTimeline,
  resolve: cmdResolve,
  docs: cmdDocs,
  doctor: cmdDoctor,
  bundle: cmdBundle,
  check: cmdCheck,
  cursor: cmdCursor,
  frames: cmdFrames,
  frame: cmdFrame,
  still: cmdStill,
  srt: cmdSrt,
  captions: cmdCaptions,
  voice: cmdVoice,
  clips: cmdClips,
  judge: cmdJudge,
  deliver: cmdDeliver,
  sheet: cmdSheet,
  approve: cmdApprove,
  locate: cmdLocate,
  probe: cmdProbe,
  lint: cmdLint,
  diff: cmdDiff,
  compare: cmdCompare,
  motion: cmdMotion,
  bench: cmdBench,
  audio: cmdAudio,
  sfx: cmdSfx,
  beats: cmdBeats,
  render: cmdRender,
  clean: cmdClean,
  review: cmdReview,
  feedback: cmdFeedback,
  init: cmdInit,
  mcp: cmdMcp,
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._.shift();
  if (!cmd || cmd === "help" || flag(args, "help")) return log(help);
  const fn = commands[cmd];
  if (!fn) die(`unknown command "${cmd}"\n${help}`);
  const { _: positional, ...rest } = args;
  startReceipt(cmd, positional, rest);
  try {
    await fn(args);
  } catch (e) {
    endReceipt("failed", (e as Error).message ?? String(e));
    await closeEngines();
    die((e as Error).stack ?? String(e));
  }
  const receipt = endReceipt("ok");
  if (receipt && flag(args, "receipt")) log(`receipt -> ${receipt}`);
  await closeEngines();
};

main();
