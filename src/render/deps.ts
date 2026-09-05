/**
 * What a part's segments really depend on: the source files reachable from the
 * part's own entry (imports walked), plus the public assets those files name in
 * `staticFile("...")`. A part without a declared `source` falls back to the bundle
 * hash, which is every file of the project: an edit in the opening then re-renders
 * the product half as well, thirty scenes for a one-line change.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { LoadedConfig } from "../config.ts";
import type { CompiledPart } from "../timeline/schema.ts";
import { hashString } from "../util.ts";

const EXT = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", "/index.ts", "/index.tsx", "/index.js"];

const resolveImport = (from: string, spec: string): string | null => {
  if (!spec.startsWith(".") && !spec.startsWith("/")) return null; // packages do not change between renders
  const base = spec.startsWith("/") ? spec : resolve(dirname(from), spec);
  for (const e of EXT) {
    const p = base + e;
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  return null;
};

const IMPORT_RE = /(?:from\s*|import\s*\(?\s*|require\s*\(\s*)(["'])([^"']+)\1/g;
const STATIC_RE = /staticFile\(\s*(["'`])([^"'`$]+)\1\s*\)/g;

/** every local source file reachable from `entry`, and the public assets they name */
export const partDeps = (cfg: LoadedConfig, entry: string): { sources: string[]; assets: string[] } => {
  const seen = new Set<string>();
  const assets = new Set<string>();
  const walk = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(STATIC_RE)) assets.add(join(cfg.publicPath, m[2]));
    for (const m of src.matchAll(IMPORT_RE)) {
      const dep = resolveImport(file, m[2]);
      if (dep) walk(dep);
    }
  };
  walk(entry);
  return { sources: [...seen].sort(), assets: [...assets].sort() };
};

const memo = new Map<string, string>();

/**
 * The hash a part's cache keys use. Sources hash by content, assets by size and
 * mtime (a 200 MB clip is not read on every call). Memoised per process.
 */
export const partHash = (cfg: LoadedConfig, part: CompiledPart, bundleHash: string): string => {
  if (!part.source) return bundleHash;
  const entry = resolve(cfg.projectDir, part.source);
  if (!existsSync(entry)) throw new Error(`part "${part.id}": source ${part.source} not found (expected ${entry})`);
  const k = `${part.id}:${entry}`;
  const hit = memo.get(k);
  if (hit) return hit;
  const { sources, assets } = partDeps(cfg, entry);
  const parts: string[] = [];
  for (const f of sources) parts.push(f, readFileSync(f, "utf8"));
  for (const f of assets) {
    if (!existsSync(f)) continue;
    const st = statSync(f);
    parts.push(f, String(st.size), String(Math.round(st.mtimeMs)));
  }
  const h = hashString(parts.join("\n"));
  memo.set(k, h);
  return h;
};

export const resetPartHashes = () => memo.clear();
