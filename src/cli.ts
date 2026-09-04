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
import { openRenderer, renderFrameSet, getComposition, type ProbeResult, type Renderer } from "./render/frames.ts";
import { makeSheet, type SheetCell } from "./sheet/sheet.ts";
import { lintStaticColors, lintTimeline, lintProbe, formatFindings, type Finding } from "./lint/lint.ts";
import { diffSets } from "./diff/diff.ts";
import { measureScene, sparkline } from "./motion/metrics.ts";
import { audioProfile, rmsAt, db } from "./audio/probe.ts";
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

const log = (s: string) => console.log(s);
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

const cmdDoctor = async (args: Args) => {
  const x = await ctx(args);
  const ff = await run(["ffmpeg", "-version"], { quiet: true });
  log(`ffmpeg: ${ff.code === 0 ? ff.out.split("\n")[0] : "MISSING"}`);
  log(`project: ${x.cfg.projectDir}`);
  log(`root: ${x.cfg.rootPath} (${x.cfg.rootExport ?? "Root"})`);
  log(`cache: ${x.cfg.cachePath}`);
  log(`film ${x.filmName} format ${x.format}: ${x.c.parts.length} parts, ${x.c.scenes.length} scenes, ${x.c.dur}f`);
  const tl = lintTimeline(x.cfg, x.c);
  log(tl.length ? formatFindings(tl) : "timeline: ok");
  await withRenderer(x, async (_r, serveUrl) => {
    const checks = await partDurationCheck(serveUrl, x.c, x.format);
    for (const k of checks) {
      const ok = k.actual === k.expected;
      log(`${ok ? "ok  " : "DRIFT"} part ${k.part.id} -> ${k.composition}: composition ${k.actual}f, timeline ${k.expected}f${ok ? "" : ` (off by ${k.actual - k.expected})`}`);
    }
  });
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
          file: join(dir, part.id, `f${String(cf.partFrame).padStart(5, "0")}.png`),
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
  if (!args._.length) die("usage: mh probe <ref> [--mode probe|text|all] [--find text] [--json]");
  const mode = (str(args, "mode", "text") as "probe" | "text" | "all");
  await withRenderer(x, async (r, serveUrl) => {
    for (const ref of args._) {
      const L = resolveRef(x.c, ref);
      const part = x.c.parts.find((p) => p.id === L.part)!;
      const compId = compositionFor(part, x.format);
      const file = join(ensureDir(join(x.cfg.cachePath, "probe")), `${compId}-f${String(L.partFrame).padStart(5, "0")}.png`);
      const [o] = await renderFrameSet(r, serveUrl, compId, [{ frame: L.partFrame, file }], { probe: mode, settleMs: num(args, "settle", 150) });
      if (!o.probe) return log(`${ref}: no probe result (is the harness wrapper in use? run mh bundle --force)`);
      if (flag(args, "json")) log(JSON.stringify({ ref, location: L.label, file, ...o.probe }));
      else {
        log(`${ref} -> ${L.label}${L.inTransition ? " IN TRANSITION" : ""}   still: ${file}`);
        printProbe(o.probe, str(args, "find"));
      }
    }
  });
};

const cmdLint = async (args: Args) => {
  const x = await ctx(args);
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

const help = `mh <command> [--project dir] [--film name] [--format wide]

  timeline [--json]                 the compiled timeline: scenes, frames, film time, events, audio
  resolve <ref...> [--json]         20.5s | f616 | probe | probe.pick1 | probe+12 | product:f120 | #7
  docs [--out file]                 the edit decision list as markdown, generated, never hand-edited
  doctor                            ffmpeg, config, and composition length vs timeline (catches drift)
  bundle [--force]                  bundle the project through the harness wrapper

  frames [--scene a,b] [--dense N] [--probe text] [--tag t] [--sheet]
                                    render the check frames of each scene (enter, settled, events, mid, last)
  sheet [--scene a,b] [--from tag] [--all] [--columns 4]
                                    contact sheets with frame numbers, scene addresses and transition marks
  probe <ref> [--mode text|probe|all] [--find text] [--json]
                                    where is what: element boxes, colors, fonts at a frame, straight from the DOM
  lint [--static] [--timeline] [--rendered] [--no-fail]
                                    colors vs tokens (source and painted), text durations, events, safe zone
  diff [tagA] [tagB] [--min 0.002]  which check frames changed between two runs, with diff images
  motion --scene a[,b] [--width 320]
                                    frame-to-frame motion curve: when it settles, how long it holds, where it jumps
  audio [file] [--window 0.25]      rms profile of the film, silence, and every cue of the timeline checked

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
  frames: cmdFrames,
  sheet: cmdSheet,
  probe: cmdProbe,
  lint: cmdLint,
  diff: cmdDiff,
  motion: cmdMotion,
  audio: cmdAudio,
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
