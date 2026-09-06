/**
 * `mh template`: the templates as commands. List them, look at what one writes,
 * add a scene from one, build a scene again from the parameters it recorded.
 * Everything goes through the same hands as every other edit (loadFilm,
 * addScene, saveFilm, lintFilm) and the same addresses, so a scene a template
 * wrote is a scene like any other the moment it is in the file.
 *
 * The integrator wires `commands` into cli.ts and `HELP` into its help text.
 * Until then this file runs itself: `bun run src/mograph/cli-templates.ts add
 * stat --param value=40 --project examples/mograph-templates`.
 */
import { join, resolve as resolvePath } from "node:path";
import { existsSync } from "node:fs";
import { loadConfig, pickFilm, resolveProjectDir } from "../config.ts";
import { formatFindings } from "../lint/lint.ts";
import { produced } from "../receipts/receipts.ts";
import { table } from "../util.ts";
import { addScene, lintFilm, loadFilm, saveFilm } from "./edit.ts";
import type { MgFilm, MgScene } from "./schema.ts";
import { TEMPLATES, buildScene, coerceParams, resolveTemplate, templateNames, type MgParams } from "./templates.ts";

/* ---------- args, the same shape cli.ts parses ---------- */

export type Args = { _: string[]; [k: string]: string | boolean | string[] };

const str = (a: Args, k: string, d?: string) => (typeof a[k] === "string" ? (a[k] as string) : d);
const flag = (a: Args, k: string) => a[k] === true || a[k] === "true";
const JSON_MODE = () => process.argv.includes("--json");
const log = (s: string) => (JSON_MODE() ? console.error(s) : console.log(s));
const out = (s: string) => console.log(s);
const die = (s: string): never => {
  throw new Error(s);
};

/**
 * Every `--param k=v` on the line. cli.ts's parser keeps the last value of a
 * repeated flag, so the raw argv is read as well; an array value (a test, or a
 * parser that collects repeats) is taken as it is.
 */
const paramArgs = (a: Args): string[] => {
  const fromArgs = Array.isArray(a.param) ? (a.param as string[]) : typeof a.param === "string" ? [a.param as string] : [];
  const argv: string[] = [];
  for (let i = 0; i < process.argv.length; i++) {
    const x = process.argv[i];
    if (x === "--param" && process.argv[i + 1] !== undefined) argv.push(process.argv[++i]);
    else if (x.startsWith("--param=")) argv.push(x.slice("--param=".length));
  }
  return argv.length >= fromArgs.length ? argv : fromArgs;
};

/** --param k=v ... plus --params '{"k": v}', as one object of raw values */
export const paramsOf = (a: Args): MgParams => {
  const p: MgParams = {};
  const json = str(a, "params");
  if (json) {
    try {
      Object.assign(p, JSON.parse(json) as MgParams);
    } catch {
      die(`--params is not JSON: ${json}`);
    }
  }
  for (const item of paramArgs(a)) {
    const i = item.indexOf("=");
    if (i < 0) die(`--param wants k=v, got "${item}"`);
    p[item.slice(0, i).trim()] = item.slice(i + 1);
  }
  if (flag(a, "no-groups")) p.groups = false;
  if (flag(a, "groups")) p.groups = true;
  return p;
};

/* ---------- the film the commands edit ---------- */

/** the project's film.mograph.json: --file, else the config's films.<film>.mograph, else the file next to the config */
export const filmFile = async (a: Args): Promise<{ path: string; dir: string; film: MgFilm }> => {
  const direct = str(a, "file");
  if (direct) {
    const path = resolvePath(direct);
    if (!existsSync(path)) die(`no film at ${path}`);
    return { path, dir: join(path, ".."), film: loadFilm(path) };
  }
  const { dir } = resolveProjectDir(str(a, "project"));
  const cfg = await loadConfig(dir);
  const { film } = pickFilm(cfg, str(a, "film"));
  const rel = (film as { mograph?: string }).mograph ?? "film.mograph.json";
  const path = join(cfg.projectDir, rel);
  if (!existsSync(path)) die(`no motion graphics film at ${path}; mh new <dir> --mograph --brief "..." makes one`);
  return { path, dir: cfg.projectDir, film: loadFilm(path) };
};

const report = (film: MgFilm, path: string, dir: string, hint?: string) => {
  produced(path);
  const findings = lintFilm(film, dir);
  if (findings.length) log(formatFindings(findings));
  const errors = findings.filter((f) => f.level === "error").length;
  log(`${errors ? `${errors} error${errors === 1 ? "" : "s"} in ` : "saved "}${path}${hint ? `   verify: ${hint}` : ""}`);
  if (errors) process.exitCode = 2;
};

const groundBefore = (film: MgFilm, index: number): string | undefined => {
  // a ground may be a gradient now; a template alternates on its first stop
  const g = index > 0 ? film.scenes[index - 1]?.ground : undefined;
  if (typeof g === "string") return g;
  return g && Array.isArray((g as { gradient?: unknown[] }).gradient) ? String((g as { gradient: unknown[] }).gradient[0]) : undefined;
};

/** where the new scene lands: after --after, before --before, else the end */
const insertIndex = (film: MgFilm, a: Args): number => {
  const after = str(a, "after");
  const before = str(a, "before");
  if (after) {
    const i = film.scenes.findIndex((s) => s.id === after);
    if (i < 0) die(`no scene "${after}" to place after (have: ${film.scenes.map((s) => s.id).join(", ")})`);
    return i + 1;
  }
  if (before) {
    const i = film.scenes.findIndex((s) => s.id === before);
    if (i < 0) die(`no scene "${before}" to place before (have: ${film.scenes.map((s) => s.id).join(", ")})`);
    return i;
  }
  return film.scenes.length;
};

const groupNote = (scene: MgScene) => {
  if (!scene.layers.some((l) => (l as { type: string }).type === "group")) return;
  log("  the scene holds a group layer: the group runtime draws it, pass --no-groups for the same layers flat until that has landed");
};

const sceneLine = (s: MgScene) => `${s.id} (${s.template}): ${s.dur}f on ${s.ground}, ${s.layers.length} layer${s.layers.length === 1 ? "" : "s"} (${s.layers.map((l) => l.id).join(", ")})`;

/* ---------- the commands ---------- */

const cmdList = (a: Args) => {
  if (flag(a, "json")) return out(JSON.stringify(Object.values(TEMPLATES).map((t) => ({ name: t.name, description: t.description, params: t.params })), null, 2));
  // the defaults are wide copy: the names here, the values and their help in `mh template show`
  log(table(Object.values(TEMPLATES).map((t) => [t.name, t.description, Object.keys(t.params).join(", ")]), ["template", "what it is", "params"]));
  log(`mh template show <name>   mh template add <name> --param k=v ...   mh template apply <scene> [name]`);
};

const cmdShow = async (a: Args) => {
  const name = a._[1];
  if (!name) die(`usage: mh template show <name>   (${templateNames().join(", ")})`);
  const tpl = resolveTemplate(name);
  if (!tpl) die(`no template "${name}" (have: ${templateNames().join(", ")})`);
  const raw = paramsOf(a);
  // inside a project the film's design decides the colours; outside it the tokens are the guess
  const design = await filmFile(a).then((f) => f.film.design).catch(() => undefined);
  const scene = buildScene(tpl!.name, raw, { design });
  if (flag(a, "json")) return out(JSON.stringify(scene, null, 2));
  log(`${tpl!.name}: ${tpl!.description}`);
  log(table(Object.entries(tpl!.params).map(([k, s]) => [k, s.type, JSON.stringify(coerceParams(tpl!, raw)[k]), s.help]), ["param", "type", "value", "what it does"]));
  log(sceneLine(scene));
  log(JSON.stringify(scene, null, 2));
  groupNote(scene);
};

const cmdAdd = async (a: Args) => {
  const name = a._[1];
  if (!name) die(`usage: mh template add <name> [--param k=v ...] [--id x] [--after id|--before id] [--no-groups]   (${templateNames().join(", ")})`);
  const { path, dir, film } = await filmFile(a);
  const at = insertIndex(film, a);
  const scene = buildScene(name, paramsOf(a), { id: str(a, "id"), taken: film.scenes.map((s) => s.id), previousGround: groundBefore(film, at), design: film.design });
  addScene(film, scene, { after: str(a, "after"), before: str(a, "before") });
  saveFilm(path, film);
  log(sceneLine(scene));
  groupNote(scene);
  report(film, path, dir, `mh check --scene ${scene.id} --format all`);
  if (flag(a, "json")) out(JSON.stringify(scene, null, 2));
};

const cmdApply = async (a: Args) => {
  const id = a._[1];
  if (!id) die("usage: mh template apply <scene> [template] [--param k=v ...]   builds the scene again from its recorded params");
  const { path, dir, film } = await filmFile(a);
  const i = film.scenes.findIndex((s) => s.id === id);
  if (i < 0) die(`no scene "${id}" (have: ${film.scenes.map((s) => s.id).join(", ")})`);
  const old = film.scenes[i];
  const name = a._[2] ?? old.template;
  if (!name) die(`scene "${id}" came from no template; name one: mh template apply ${id} statement`);
  const params = { ...(old.template && (!a._[2] || a._[2] === old.template) ? old.params ?? {} : {}), ...paramsOf(a) };
  const scene = buildScene(name, params, { id: old.id, previousGround: groundBefore(film, i), design: film.design });
  film.scenes[i] = scene;
  saveFilm(path, film);
  log(`${old.id}: ${old.layers.length} layer${old.layers.length === 1 ? "" : "s"} -> ${sceneLine(scene)}`);
  groupNote(scene);
  report(film, path, dir, `mh check --scene ${scene.id} --format all`);
  if (flag(a, "json")) out(JSON.stringify(scene, null, 2));
};

const cmdTemplate = async (a: Args) => {
  const sub = a._[0] ?? "list";
  if (sub === "list") return cmdList(a);
  if (sub === "show") return cmdShow(a);
  if (sub === "add") return cmdAdd(a);
  if (sub === "apply") return cmdApply(a);
  die(`unknown "mh template ${sub}"; it is list, show, add or apply`);
};

export const commands: Record<string, (a: Args) => Promise<void>> = {
  template: async (a: Args) => void (await cmdTemplate(a)),
};

export const HELP = `templates (a scene from a handful of parameters, see docs/mograph.md):
  template list [--json]            every template and the parameters it takes (--json adds the defaults and the help)
  template show <name> [--param k=v ...] [--json]
                                    what the template writes: the parameters, then the scene as JSON
  template add <name> [--param k=v ...] [--id x] [--after id|--before id] [--no-groups]
                                    a scene from a template, appended or placed; ids are made unique, grounds alternate, the film is linted
  template apply <scene> [name] [--param k=v ...]
                                    the scene built again from the params it recorded, with the ones given here over them
                                    (${templateNames().join(", ")})`;

/* ---------- until the commands are wired into cli.ts ---------- */

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

if (import.meta.main) {
  const args = parseArgs(process.argv.slice(2));
  if (args._[0] === "help" || flag(args, "help")) log(HELP);
  else
    await cmdTemplate(args).catch((e: Error) => {
      console.error(`mh: ${e.message}`);
      process.exit(1);
    });
}
