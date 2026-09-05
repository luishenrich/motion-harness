#!/usr/bin/env bun
/**
 * mh: the agent's hands and eyes around a Remotion project.
 *
 *   mh timeline | resolve | docs | doctor
 *   mh frames | sheet | probe | lint | diff | motion | audio
 *   mh render | review | feedback
 */
import { existsSync, readFileSync, writeFileSync, readdirSync, cpSync, rmSync } from "node:fs";
import { join, resolve as resolvePath } from "node:path";
import { loadConfig, pickFilm, pickFormat, type LoadedConfig } from "./config.ts";
import { compile, compositionFor, fmtTime, type Compiled, type CompiledScene } from "./timeline/schema.ts";
import { resolve as resolveRef, checkFramesFor, type CheckFrame } from "./timeline/resolve.ts";
import { timelineMarkdown, timelineJson } from "./timeline/docs.ts";
import { bundleProject } from "./render/bundle.ts";
import { openRenderer, renderFrameSet, getComposition, type ProbeResult, type Renderer } from "./render/frames.ts";
import { makeSheet, zoomWindow, type SheetCell } from "./sheet/sheet.ts";
import { parseFeedback, feedbackReport } from "./review/parse.ts";
import { hashFrames, queryViews, bestMatches, refineFit, type Fit } from "./locate/locate.ts";
import sharp from "sharp";
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
  const zoom = str(args, "zoom");
  // a zoom needs the element boxes, so the probe runs even when nobody asked for it
  const probe = (str(args, "probe") as "probe" | "text" | "all" | undefined) ?? (flag(args, "probe") || zoom ? "probe" : false);
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

  frames [--scene a,b] [--dense N] [--probe text] [--tag t] [--sheet] [--zoom key]
                                    render the check frames of each scene (enter, settled, events with their -6..+18 window, mid, last)
  sheet [--scene a,b] [--from tag] [--all] [--columns 4] [--zoom key]
                                    contact sheets with frame numbers, scene addresses and transition marks; --zoom crops 480x320 at 1:1 around the probed element
  approve [--from tag]              copy a run (default latest) to "approved", the fixed side of every later diff
  locate <image.png> [--from tag]   which frame is this? perceptual hash of a pasted still against a frames run
  probe <ref> [--mode text|probe|all] [--find text] [--key k] [--json]   --key prints one element's centre (cursor targets)
                                    where is what: element boxes, colors, fonts at a frame, straight from the DOM
  lint [--static] [--timeline] [--rendered] [--no-fail]
                                    colors vs tokens (source and painted), text durations, events, safe zone
  diff [tagA] [tagB] [--min 0.002]  which check frames changed between two runs (default approved vs latest), touched scenes first
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
  feedback --from <file|->          free text ("bei 1:09", "Sekunde 19-21", "beim Klicken") turned into scene addresses
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
  approve: cmdApprove,
  locate: cmdLocate,
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
