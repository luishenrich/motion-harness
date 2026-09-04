/**
 * harness.config.ts lives in the Remotion project. It tells the harness where the
 * Root component is, which films exist (timeline + compositions per format) and
 * which colors are allowed.
 */
import { existsSync } from "node:fs";
import { resolve as resolvePath, dirname, isAbsolute } from "node:path";
import type { Timeline, Rules } from "./timeline/schema.ts";

export type Film = {
  /** the timeline (parts, scenes, audio, rules) */
  timeline: Timeline;
  /** which formats exist, key is the format name used in `part.composition` */
  formats: Record<string, { width: number; height: number }>;
  /** default format for commands that need one */
  defaultFormat?: string;
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
};

export const defineConfig = (c: HarnessConfig): HarnessConfig => c;

export type LoadedConfig = HarnessConfig & {
  projectDir: string;
  configPath: string;
  rootPath: string;
  cachePath: string;
  publicPath: string;
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
