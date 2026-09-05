#!/usr/bin/env bun
/**
 * mh: the agent's hands and eyes around a Remotion project.
 *
 *   mh timeline | resolve | docs | doctor
 *   mh frames | sheet | probe | lint | diff | motion | audio
 *   mh render | review | feedback
 */
import { existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, resolve as resolvePath } from "node:path";
import { loadConfig, pickFilm, pickFormat, type LoadedConfig } from "./config.ts";
import { compile, compositionFor, fmtTime, type Compiled, type CompiledScene } from "./timeline/schema.ts";
import { resolve as resolveRef, checkFramesFor, type CheckFrame } from "./timeline/resolve.ts";
import { timelineMarkdown, timelineJson } from "./timeline/docs.ts";
import { bundleProject } from "./render/bundle.ts";
import { openRenderer, renderFrameSet, getComposition, frameFile, type ProbeResult, type Renderer } from "./render/frames.ts";
import { measureLegs, writeTargets } from "./cursor/cursor.ts";
import { makeSheet, type SheetCell } from "./sheet/sheet.ts";
import { lintStaticColors, lintTimeline, lintProbe, formatFindings, type Finding } from "./lint/lint.ts";
import { diffSets } from "./diff/diff.ts";
import { measureScene, sparkline } from "./motion/metrics.ts";
import { audioProfile, rmsAt, db } from "./audio/probe.ts";
import { decodeMono, onsetStrength, pickOnsets, beatGrid, nearest } from "./audio/beats.ts";
import { resolveUnclamped } from "./timeline/resolve.ts";
import { renderSegments, renderPartAudio, concatParts, mixFilm, partDurationCheck } from "./film/film.ts";
import { startReviewServer, loadComments, feedbackMarkdown, commentsPath } from "./review/server.ts";
import { ensureDir, readJson, writeJson, stamp, table, ms, run } from "./util.ts";

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
  process.exit(1);
};

/* ---------- context ---------- */

type Ctx = { cfg: LoadedConfig; filmName: string; c: Compiled; format: string; size: { width: number; height: number }; args: Args };

const ctx = async (args: Args): Promise<Ctx> => {
  const projectDir = resolvePath(str(args, "project", process.cwd())!);
  const cfg = await loadConfig(projectDir);
  const { name: filmName, film } = pickFilm(cfg, str(args, "film"));
  const format = pickFormat(film, str(args, "format"));
  return { cfg, filmName, c: compile(film.timeline), format, size: film.formats[format], args };
};

/** "--format all" fans a command out over every format of the film; everything else is one format */
const formatsOf = async (args: Args): Promise<string[]> => {
  const cfg = await loadConfig(resolvePath(str(args, "project", process.cwd())!));
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

const loadRun = (x: Ctx, tag?: string): Manifest => {
  const t = tag ?? latestTag(x);
  if (!t) die(`no frames run yet for ${x.filmName}-${x.format}, run "mh frames" first`);
  const m = join(runsDir(x), t!, "manifest.json");
  if (!existsSync(m)) die(`no run "${t}" (have: ${readdirSync(runsDir(x)).filter((d) => d !== "latest").join(", ")})`);
  return readJson<Manifest>(m);
};

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
  for (const ref of args._) {
    try {
      const L = resolveRef(x.c, ref);
      const s = L.scene;
      if (flag(args, "json")) {
        log(JSON.stringify({ ref, part: L.part, scene: s.id, local: L.local, partFrame: L.partFrame, filmFrame: L.filmFrame, filmSeconds: L.filmSeconds, event: L.event, inTransition: L.inTransition, sceneStart: s.start, sceneEnd: s.end, sceneDur: s.dur, composition: compositionFor(x.c.parts.find((p) => p.id === L.part)!, x.format) }));
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

const withRenderer = async <T,>(x: Ctx, fn: (r: Renderer, serveUrl: string, bundleHash: string) => Promise<T>): Promise<T> => {
  const b = await bundleProject(x.cfg, { force: flag(x.args, "rebundle"), log });
  const r = await openRenderer(x.cfg);
  try {
    return await fn(r, b.serveUrl, b.hash);
  } finally {
    await r.close();
  }
};

/** what doctor found wrong, as lines; empty means healthy */
const doctorRun = async (x: Ctx): Promise<string[]> => {
  const bad: string[] = [];
  const ff = await run(["ffmpeg", "-version"], { quiet: true });
  log(`ffmpeg: ${ff.code === 0 ? ff.out.split("\n")[0] : "MISSING"}`);
  if (ff.code !== 0) bad.push("ffmpeg missing");
  log(`project: ${x.cfg.projectDir}`);
  log(`root: ${x.cfg.rootPath} (${x.cfg.rootExport ?? "Root"})`);
  log(`cache: ${x.cfg.cachePath}`);
  log(`film ${x.filmName} format ${x.format}: ${x.c.parts.length} parts, ${x.c.scenes.length} scenes, ${x.c.dur}f`);
  const tl = lintTimeline(x.cfg, x.c);
  log(tl.length ? formatFindings(tl) : "timeline: ok");
  bad.push(...tl.filter((f) => f.level === "error").map((f) => `${f.rule} ${f.where}`));
  await withRenderer(x, async (_r, serveUrl) => {
    const checks = await partDurationCheck(serveUrl, x.c, x.format);
    for (const k of checks) {
      const ok = k.actual === k.expected;
      log(`${ok ? "ok  " : "DRIFT"} part ${k.part.id} -> ${k.composition}: composition ${k.actual}f, timeline ${k.expected}f${ok ? "" : ` (off by ${k.actual - k.expected})`}`);
      if (!ok) bad.push(`part ${k.part.id} drifts by ${k.actual - k.expected}f`);
    }
  });
  return bad;
};

const cmdDoctor = async (args: Args) => {
  await doctorRun(await ctx(args));
};

const cmdFrames = async (args: Args) => {
  const x = await ctx(args);
  const scenes = scenesOf(x.c, args);
  const probe = (str(args, "probe") as "probe" | "text" | "all" | undefined) ?? (flag(args, "probe") ? "probe" : false);
  const tag = str(args, "tag", stamp())!;
  const dense = num(args, "dense", 0) || undefined;
  const t0 = performance.now();
  const manifest = await withRenderer(x, async (r, serveUrl, bundleHash) => {
    const dir = ensureDir(join(runsDir(x), tag));
    const m: Manifest = { film: x.filmName, format: x.format, tag, createdAt: new Date().toISOString(), bundleHash, probe, frames: [] };
    for (const part of x.c.parts) {
      const ps = scenes.filter((s) => s.part === part.id);
      if (!ps.length) continue;
      const compId = compositionFor(part, x.format);
      const jobs = ps.flatMap((s) =>
        checkFramesFor(s, { dense }).map((cf) => ({
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
      const outs = await renderFrameSet(r, serveUrl, compId, jl, {
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
  });
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
  const scenes = scenesOf(x.c, args);
  const dir = ensureDir(join(runsDir(x), m.tag, "sheets"));
  const columns = num(args, "columns", 4);
  const aspect = x.size.width / x.size.height;
  const cellWidth = num(args, "cell", aspect < 1 ? 270 : 480);
  const outFiles: string[] = [];
  if (flag(args, "all")) {
    const cells: SheetCell[] = m.frames.filter((f) => scenes.some((s) => s.id === f.scene)).map((f) => ({ file: f.file, title: `${f.scene}+${f.local}`, sub: `film ${fmtTime(f.filmFrame, x.c.fps)} f${f.filmFrame} · ${f.label}`, kind: f.kind }));
    const chunks = num(args, "per", 20);
    for (let i = 0; i < cells.length; i += chunks) {
      const out = join(dir, `all-${String(i / chunks + 1).padStart(2, "0")}.png`);
      await makeSheet(cells.slice(i, i + chunks), out, { columns, cellWidth, aspect, header: `${x.filmName} ${x.format} · frames ${i + 1}-${Math.min(cells.length, i + chunks)} of ${cells.length} · run ${m.tag}`, footer: "orange = inside a transition (never a defect by itself) · blue = named event · gray = settled" });
      outFiles.push(out);
    }
  } else {
    for (const s of scenes) {
      const fs = m.frames.filter((f) => f.scene === s.id);
      if (!fs.length) continue;
      const cells: SheetCell[] = fs.map((f) => ({ file: f.file, title: `${f.scene}+${f.local}`, sub: `film ${fmtTime(f.filmFrame, x.c.fps)} f${f.filmFrame} · part f${f.partFrame} · ${f.label}`, kind: f.kind }));
      const out = join(dir, `${String(s.index).padStart(2, "0")}-${s.id}.png`);
      await makeSheet(cells, out, { columns, cellWidth, aspect, header: `${x.filmName} ${x.format} · scene ${s.id} (#${s.index}, ${s.part}) · ${s.dur}f = ${(s.dur / x.c.fps).toFixed(2)}s · enter ${s.enter.type}${s.enter.dur ? ` ${s.enter.dur}f` : ""}${s.why ? ` · ${s.why}` : ""}`, footer: `events: ${s.events.map((e) => `${e.name}@${e.local}`).join("  ") || "none"} · orange = in transition · blue = event · gray = settled` });
      outFiles.push(out);
    }
  }
  log(outFiles.join("\n"));
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
  await withRenderer(x, async (r, serveUrl) => {
    for (const ref of args._) {
      const L = resolveRef(x.c, ref);
      const part = x.c.parts.find((p) => p.id === L.part)!;
      const compId = compositionFor(part, x.format);
      const file = join(ensureDir(join(x.cfg.cachePath, "probe")), `${compId}-f${String(L.partFrame).padStart(5, "0")}.png`);
      const [o] = await renderFrameSet(r, serveUrl, compId, [{ frame: L.partFrame, file }], { probe: mode, settleMs: num(args, "settle", 150) });
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

const lintRun = async (x: Ctx, args: Args): Promise<Finding[]> => {
  const findings: Finding[] = [];
  const which = { static: flag(args, "static"), timeline: flag(args, "timeline"), rendered: flag(args, "rendered") };
  const none = !which.static && !which.timeline && !which.rendered;
  if (none || which.timeline) findings.push(...lintTimeline(x.cfg, x.c));
  if (none || which.static) findings.push(...(await lintStaticColors(x.cfg)));
  if (which.rendered) {
    let m: Manifest | null = null;
    const tag = str(args, "from") ?? latestTag(x);
    if (tag) {
      const cand = loadRun(x, tag);
      if (cand.probe) m = cand;
    }
    if (!m) {
      log("no probe run found, rendering settled frames with the probe");
      await cmdFrames({ ...args, probe: "text", quiet: true, tag: `lint-${stamp()}` });
      m = loadRun(x);
    }
    const frames = m.frames.filter((f) => f.probeFile && f.kind !== "transition").map((f) => ({ label: `${f.scene}+${f.local}`, sceneId: f.scene, probe: readJson<ProbeResult>(f.probeFile!) }));
    findings.push(...lintProbe(x.cfg, x.c, x.format, frames));
  }
  return findings;
};

const cmdLint = async (args: Args) => {
  const x = await ctx(args);
  const findings = await lintRun(x, args);
  log(formatFindings(findings));
  const errors = findings.filter((f) => f.level === "error").length;
  log(`${findings.length} finding${findings.length === 1 ? "" : "s"}, ${errors} error${errors === 1 ? "" : "s"}`);
  if (errors && !flag(args, "no-fail")) process.exit(2);
};

const cmdDiff = async (args: Args) => {
  const x = await ctx(args);
  const [a, b] = args._;
  const runs = readdirSync(runsDir(x)).filter((d) => d !== "latest").sort();
  const tagB = b ?? latestTag(x)!;
  const tagA = a ?? runs.filter((t) => t < tagB).pop();
  if (!tagA || !tagB) die(`need two runs to compare (have: ${runs.join(", ")})`);
  const A = loadRun(x, tagA), B = loadRun(x, tagB);
  const byFrame = (m: Manifest) => new Map(m.frames.map((f) => [`${f.part}:${f.partFrame}`, f]));
  const fa = byFrame(A), fb = byFrame(B);
  const keys = [...fb.keys()].filter((k) => fa.has(k));
  const outDir = ensureDir(join(runsDir(x), tagB, "diff-vs-" + tagA));
  const res = await diffSets(keys.map((k) => ({ frame: fb.get(k)!.partFrame, a: fa.get(k)!.file, b: fb.get(k)!.file, label: `${fb.get(k)!.scene}+${fb.get(k)!.local}` })), { threshold: num(args, "threshold", 0.08), outDir });
  const min = num(args, "min", 0.002);
  const changed = res.filter((r) => r.changed >= min);
  log(`${tagA} -> ${tagB}: ${keys.length} common frames, ${changed.length} changed (>= ${(min * 100).toFixed(1)}% pixels), ${fb.size - keys.length} new in ${tagB}`);
  log(table(changed.sort((p, q) => q.changed - p.changed).map((r) => [r.label, `f${r.frame}`, `${(r.changed * 100).toFixed(1)}%`, (r.mean * 100).toFixed(2), r.box ? `${r.box.x},${r.box.y} ${r.box.w}x${r.box.h}` : "", r.diffFile?.replace(x.cfg.cachePath + "/", "") ?? ""]), ["frame", "part f", "changed", "mean%", "box", "diff image"]));
  const touched = new Set(changed.map((r) => r.label.split("+")[0]));
  log(`scenes touched: ${[...touched].join(", ") || "none"}`);
};

const cmdMotion = async (args: Args) => {
  const x = await ctx(args);
  const scenes = scenesOf(x.c, args);
  if (scenes.length > 6 && !flag(args, "yes")) die(`${scenes.length} scenes would be rendered at full frame rate, pass --scene a,b or --yes`);
  const rules = { ...(x.c.timeline.rules ?? {}), ...(x.cfg.rules ?? {}) };
  await withRenderer(x, async (r, serveUrl) => {
    for (const s of scenes) {
      const part = x.c.parts.find((p) => p.id === s.part)!;
      const compId = compositionFor(part, x.format);
      const dir = join(x.cfg.cachePath, "motion", `${x.filmName}-${x.format}`, s.id);
      const t0 = performance.now();
      const m = await measureScene(r, serveUrl, compId, s, x.c.fps, dir, { width: num(args, "width", 320), extra: num(args, "extra", 0), concurrency: num(args, "concurrency", 4), still: num(args, "still", 0.003), jump: num(args, "jump", 0.08) });
      writeJson(join(dir, "curve.json"), m);
      const settledMs = m.settled === null ? null : Math.round((m.settled / x.c.fps) * 1000);
      log(`${s.id} (${m.frames}f, ${ms(t0)})  enter declared ${m.enterDur}f, measured settle ${m.settled === null ? "never" : `${m.settled}f = ${settledMs}ms`}  drift after settle ${(m.drift * 1000).toFixed(2)}‰`);
      log(`  motion  ${sparkline(m.diff, Math.max(0.05, ...m.diff))}`);
      log(`  holds   ${m.holds.map(([a, b]) => `${a}-${b} (${Math.round(((b - a) / x.c.fps) * 1000)}ms)`).join(", ") || "none"}`);
      log(`  jumps   ${m.jumps.map((j) => `+${j.frame} (${(j.diff * 100).toFixed(0)}%)`).join(", ") || "none"}`);
      const verdict: string[] = [];
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

const cmdAudio = async (args: Args) => {
  const x = await ctx(args);
  const file = args._[0] ?? join(x.cfg.cachePath, "out", `${x.filmName}-${x.format}.mp4`);
  if (!existsSync(file)) die(`no such file: ${file}`);
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
  for (const cue of x.c.timeline.audio ?? []) {
    const t = resolveRef(x.c, cue.at).filmSeconds;
    const before = rmsAt(p, Math.max(0, t - 0.3)), after = rmsAt(p, t + 0.3);
    log(`  cue ${cue.id} (${cue.kind}) at ${t.toFixed(2)}s: rms before ${before.toFixed(3)} after ${after.toFixed(3)}${after < 0.002 ? "  NOTHING AUDIBLE" : ""}`);
    for (const rmp of cue.ramps ?? []) {
      const rt = resolveRef(x.c, rmp.at).filmSeconds;
      log(`    ramp -> ${rmp.to} at ${rt.toFixed(2)}s: rms ${rmsAt(p, rt - 0.3).toFixed(3)} -> ${rmsAt(p, rt + (rmp.over ?? 0) + 0.3).toFixed(3)}`);
    }
  }
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
    let drift = 0; // frames already added/removed before this scene
    const minDur = Math.max(1, { ...(x.c.timeline.rules ?? {}), ...(x.cfg.rules ?? {}) }.minSceneDur ?? 1);
    const wanted = new Set(scenesOf(x.c, args).map((s) => s.id));
    for (const s of x.c.scenes) {
      if (s.index === x.c.scenes.length - 1) break;
      if (!wanted.has(s.id)) continue;
      const cut = (s.filmEnd + drift) / x.c.fps;
      const b = nearest(cut, grid.ticks);
      if (!b) continue;
      let delta = Math.round(-b.delta * x.c.fps); // frames to add so the cut lands on the tick
      if (Math.abs(delta) > maxShift || s.dur + delta < minDur) delta = 0;
      if (delta !== 0) sugg.push([s.id, s.dur, s.dur + delta, delta > 0 ? `+${delta}` : String(delta), `${fmtTime(s.filmEnd + drift, x.c.fps)} -> ${fmtTime(s.filmEnd + drift + delta, x.c.fps)}`]);
      drift += delta;
    }
    log(table(sugg, ["scene", "dur", "new dur", "change", "cut moves"]));
    log(`${sugg.length} duration changes would put every following cut on the ${grid.bpm.toFixed(0)} bpm grid (max shift ${maxShift}f); film length changes by ${drift} frames. Apply them in the timeline, then re-render and run beats again.`);
  }
  if (flag(args, "onsets")) {
    log("");
    log(`onsets: ${onsets.map((k) => k.t.toFixed(2)).join(" ")}`);
  }
  if (flag(args, "json")) out(JSON.stringify({ file, onsets, grid, cuts: rows }, null, 2));
};

const cmdRender = async (args: Args) => {
  const x = await ctx(args);
  const t0 = performance.now();
  const res = await withRenderer(x, async (r, serveUrl, bundleHash) => {
    const segs = await renderSegments(x.cfg, r, serveUrl, bundleHash, x.c, x.filmName, x.format, { only: list(args, "scene"), crf: num(args, "crf", 18), log, concurrency: num(args, "concurrency", 4), force: flag(args, "force") });
    const all = [...segs.values()].flat();
    log(`${all.filter((s) => s.cached).length} segments cached, ${all.filter((s) => !s.cached).length} rendered`);
    const audio = flag(args, "no-audio") ? new Map<string, string>() : await renderPartAudio(x.cfg, r, serveUrl, bundleHash, x.c, x.filmName, x.format, { log, concurrency: num(args, "concurrency", 4) });
    const picture = await concatParts(x.cfg, x.c, segs, audio, x.filmName, x.format, x.size, { log });
    if (flag(args, "no-audio")) return { master: picture };
    return mixFilm(x.cfg, x.c, picture, x.filmName, x.format, { out: str(args, "out"), web: flag(args, "web"), log, audioRoot: str(args, "audio-root") });
  });
  log(`film -> ${res.master}${res.web ? `\nweb  -> ${res.web}` : ""}  (${ms(t0)})`);
};

const cmdReview = async (args: Args) => {
  const x = await ctx(args);
  const video = args._[0] ?? str(args, "video") ?? join(x.cfg.cachePath, "out", `${x.filmName}-${x.format}.mp4`);
  if (!existsSync(video)) die(`no film at ${video}, run "mh render" or pass a file`);
  const port = num(args, "port", 4848);
  startReviewServer(x.cfg, x.c, x.filmName, x.format, resolvePath(video), port);
  log(`review player on http://localhost:${port}  (${video})`);
  log(`comments -> ${commentsPath(x.cfg, x.filmName, x.format)}; read them with: mh feedback`);
  await new Promise(() => {});
};

const cmdFeedback = async (args: Args) => {
  const x = await ctx(args);
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
  const targets = await withRenderer(x, (r, serveUrl) => measureLegs(r, serveUrl, x.cfg, x.c, x.format, x.size.width, cursor, { settleMs: num(x.args, "settle", 150), concurrency: num(x.args, "concurrency", 4), log }));
  const w = writeTargets(resolvePath(x.cfg.projectDir, rel), targets);
  log(table(targets.map((t) => [t.id, `f${t.frame}`, t.x, t.y, t.click ? "click" : "park"]), ["leg", "part f", "x", "y", ""]));
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
      const bad = await doctorRun(x);
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
  const b = await bundleProject(x.cfg, { force: flag(args, "force") || true, log });
  log(`bundle: ${b.serveUrl} (${b.hash.slice(0, 12)})`);
};

const cmdInit = async (args: Args) => {
  const projectDir = resolvePath(str(args, "project", process.cwd())!);
  const file = join(projectDir, "harness.config.ts");
  if (existsSync(file) && !flag(args, "force")) die(`${file} exists`);
  writeFileSync(file, readFileSync(join(import.meta.dir, "../templates/harness.config.ts"), "utf8"));
  log(`wrote ${file}. Fill in root, films and tokens, then run: mh doctor`);
};

const help = `mh <command> [--project dir] [--film name] [--format wide|all]

  timeline [--json]                 the compiled timeline: scenes, frames, film time, events, audio
  resolve <ref...> [--json]         20.5s | f616 | probe | probe.pick1 | probe+12 | product:f120 | #7
  docs [--out file]                 the edit decision list as markdown, generated, never hand-edited
  doctor                            ffmpeg, config, and composition length vs timeline (catches drift)
  bundle [--force]                  bundle the project through the harness wrapper
  check [--scene a,b] [--format x|all]
                                    one edit round: typecheck, bundle, lint, doctor, cursor targets, frames + sheets and rendered lint of the touched scenes
  cursor [--format x|all]           measure the film's cursor legs with the DOM probe, write the CURSOR_TARGETS module per format

  frames [--scene a,b] [--dense N] [--probe text] [--tag t] [--sheet]
                                    render the check frames of each scene (enter, settled, events, mid, last)
  sheet [--scene a,b] [--from tag] [--all] [--columns 4]
                                    contact sheets with frame numbers, scene addresses and transition marks
  probe <ref> [--mode text|probe|all] [--find text] [--key k] [--json]   --key prints one element's centre (cursor targets)
                                    where is what: element boxes, colors, fonts at a frame, straight from the DOM
  lint [--static] [--timeline] [--rendered] [--no-fail]
                                    colors vs tokens (source and painted), text durations, events, safe zone
  diff [tagA] [tagB] [--min 0.002]  which check frames changed between two runs, with diff images
  motion --scene a[,b] [--width 320]
                                    frame-to-frame motion curve: when it settles, how long it holds, where it jumps
  audio [file] [--window 0.25]      rms profile of the film, silence, and every cue of the timeline checked
  beats [file] [--tolerance 60] [--suggest]
                                    onsets in the mix, beat grid from the music, every cut measured; --suggest quantizes scene lengths to the grid

  render [--scene a,b] [--force] [--crf 18] [--web] [--no-audio] [--out file]
                                    scene segments (cached), parts by concat, music and sfx mixed from the timeline
  review [file] [--port 4848]       the player with the scene bar, comments land as scene+frame
  feedback [--all] [--json] [--clear]
                                    the comments as an agent-readable list, grouped by scene
  init [--force]                    write a harness.config.ts template into the project
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
  sheet: cmdSheet,
  probe: cmdProbe,
  lint: cmdLint,
  diff: cmdDiff,
  motion: cmdMotion,
  audio: cmdAudio,
  beats: cmdBeats,
  render: cmdRender,
  review: cmdReview,
  feedback: cmdFeedback,
  init: cmdInit,
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._.shift();
  if (!cmd || cmd === "help" || flag(args, "help")) return log(help);
  const fn = commands[cmd];
  if (!fn) die(`unknown command "${cmd}"\n${help}`);
  try {
    await fn(args);
  } catch (e) {
    die((e as Error).stack ?? String(e));
  }
};

main();
