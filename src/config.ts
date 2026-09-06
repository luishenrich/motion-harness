/**
 * harness.config.ts lives in the Remotion project. It tells the harness where the
 * Root component is, which films exist (timeline + compositions per format) and
 * which colors are allowed.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve as resolvePath, dirname, isAbsolute, join } from "node:path";
import { homedir } from "node:os";
import type { Timeline, Rules } from "./timeline/schema.ts";

export type Film = {
  /** the timeline (parts, scenes, audio, rules) */
  timeline: Timeline;
  /** which formats exist, key is the format name used in `part.composition` */
  formats: Record<string, { width: number; height: number }>;
  /** default format for commands that need one */
  defaultFormat?: string;
  /** the one hand of the film: where it is at which moment, measured by the DOM probe (mh cursor) */
  cursor?: Cursor;
};

export type CursorLegOpts = {
  /** frames the hand rests on this target before it may leave for the next one (a change of mind that pauses first) */
  dwell?: number;
};

export type CursorLeg = [ref: string, key: string] | [ref: string, key: string, opts: CursorLegOpts];

export type Cursor = {
  /** [moment ref, data-probe key] in film order; key "park" leaves the frame after the previous target;
   *  a key ending in "?" is a hover without a press; a third element { dwell } holds the hand there for N frames */
  legs: CursorLeg[];
  /** per format: the TS module to write, relative to the project (exports CURSOR_TARGETS) */
  out: Record<string, string>;
  /** which side the hand parks on, default "right" */
  park?: "right" | "left";
};

export type Tokens = {
  /** allowed hex colors (case-insensitive) */
  colors: string[];
  /** rgba(...) of these hex colors with any alpha are allowed too; default: all of `colors` */
  alphaOf?: string[];
  /** glob patterns (relative to project) of source files the static color lint scans */
  sources?: string[];
  /** substrings; a line containing one is skipped by the static color lint */
  ignoreLines?: string[];
};

export type HarnessConfig = {
  /** path to the module that exports the Remotion Root component, relative to the config file */
  root: string;
  /** named export of that module, default "Root" */
  rootExport?: string;
  /** relative path to the public dir, default "public" */
  publicDir?: string;
  /** same override you pass to Config.overrideWebpackConfig, e.g. enableTailwind */
  webpackOverride?: (config: unknown) => unknown;
  /** where bundles, frames, sheets and segments go, default ".harness" (relative to project) */
  cacheDir?: string;
  films: Record<string, Film>;
  tokens?: Tokens;
  rules?: Rules;
  /** extra chromium flags, rarely needed */
  chromiumOptions?: Record<string, unknown>;
  /** which renderer: "remotion" (the project's Remotion install) or "native" (Vite + shim + Playwright, no Remotion needed). Default remotion. */
  engine?: "remotion" | "native";
  /** native engine: run tailwind as a postcss plugin. Default: when the project has a tailwind.config.* */
  tailwind?: boolean;
};

export const defineConfig = (c: HarnessConfig): HarnessConfig => c;

export type LoadedConfig = HarnessConfig & {
  projectDir: string;
  configPath: string;
  rootPath: string;
  cachePath: string;
  publicPath: string;
};

export type ProjectSource = "flag" | "env" | "cwd" | "last";

const lastFile = () => join(process.env.MH_HOME ?? join(homedir(), ".mh"), "last");

const hasConfig = (dir: string) => ["harness.config.ts", "harness.config.tsx", "harness.config.js", "harness.config.mjs"].some((n) => existsSync(resolvePath(dir, n)));

/**
 * Which project a command means: --project, then MH_PROJECT, then the cwd when it holds a
 * config, then the project used last (~/.mh/last). The cwd resets between an agent's shell
 * calls, so "mh check" from the wrong directory used to fail even with the project one call earlier.
 */
export const resolveProjectDir = (explicit?: string, cwd = process.cwd()): { dir: string; from: ProjectSource } => {
  if (explicit) return { dir: resolvePath(cwd, explicit), from: "flag" };
  const env = process.env.MH_PROJECT;
  if (env) return { dir: resolvePath(cwd, env), from: "env" };
  if (hasConfig(cwd)) return { dir: cwd, from: "cwd" };
  const f = lastFile();
  if (existsSync(f)) {
    const last = readFileSync(f, "utf8").trim();
    if (last && hasConfig(last)) return { dir: last, from: "last" };
  }
  return { dir: cwd, from: "cwd" };
};

/** remember a project that loaded, for the next call without --project */
export const rememberProject = (dir: string) => {
  try {
    const f = lastFile();
    mkdirSync(dirname(f), { recursive: true });
    if (!existsSync(f) || readFileSync(f, "utf8").trim() !== dir) writeFileSync(f, dir);
  } catch {
    /* a read-only home is not an error */
  }
};

export const findConfig = (projectDir: string): string => {
  for (const name of ["harness.config.ts", "harness.config.tsx", "harness.config.js", "harness.config.mjs"]) {
    const p = resolvePath(projectDir, name);
    if (existsSync(p)) return p;
  }
  throw new Error(`no harness.config.ts in ${projectDir} (run "mh init" to create one)`);
};

export const loadConfig = async (projectDir: string): Promise<LoadedConfig> => {
  const configPath = findConfig(projectDir);
  const mod = await import(configPath);
  const cfg: HarnessConfig = mod.default ?? mod.config;
  if (!cfg || !cfg.root || !cfg.films) throw new Error(`${configPath} must default-export defineConfig({ root, films, ... })`);
  const dir = dirname(configPath);
  const abs = (p: string) => (isAbsolute(p) ? p : resolvePath(dir, p));
  const rootPath = abs(cfg.root);
  if (!existsSync(rootPath)) throw new Error(`config.root does not exist: ${rootPath}`);
  rememberProject(dir);
  return {
    ...cfg,
    projectDir: dir,
    configPath,
    rootPath,
    cachePath: abs(cfg.cacheDir ?? ".harness"),
    publicPath: abs(cfg.publicDir ?? "public"),
  };
};

export const pickFilm = (cfg: LoadedConfig, name?: string): { name: string; film: Film } => {
  const names = Object.keys(cfg.films);
  const n = name ?? names[0];
  const film = cfg.films[n];
  if (!film) throw new Error(`no film "${n}" (films: ${names.join(", ")})`);
  return { name: n, film };
};

export const pickFormat = (film: Film, format?: string): string => {
  const f = format ?? film.defaultFormat ?? Object.keys(film.formats)[0];
  if (!film.formats[f]) throw new Error(`no format "${f}" (formats: ${Object.keys(film.formats).join(", ")})`);
  return f;
};
