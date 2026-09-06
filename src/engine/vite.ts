/**
 * A Vite dev server over the project: the film's own React and CSS pipeline,
 * "remotion" aliased to the shim, the host page served at /__mh/. Bundles in
 * under a second and serves modules on demand, so a one-line edit is one
 * module transform, not a rebundle.
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { createServer, type ViteDevServer } from "vite";
import type { LoadedConfig } from "../config.ts";
import { nextPort } from "../util.ts";

export type ViteHost = { server: ViteDevServer; url: string; close: () => Promise<void> };

const HOST_DIR = resolve(import.meta.dir, "host");
const SHIM = resolve(import.meta.dir, "shim/remotion.tsx");
const NO_REACT = resolve(import.meta.dir, "shim/no-react.ts");
const HARNESS_ROOT = resolve(import.meta.dir, "../..");

/** tailwind v3 as a postcss plugin when the project has a tailwind config; content globs made absolute so cwd does not matter */
const tailwindPlugins = async (cfg: LoadedConfig, log: (s: string) => void): Promise<unknown[]> => {
  if (cfg.tailwind === false) return [];
  const twCfg = ["tailwind.config.ts", "tailwind.config.js", "tailwind.config.mjs", "tailwind.config.cjs"].map((n) => join(cfg.projectDir, n)).find(existsSync);
  if (!twCfg && !cfg.tailwind) return [];
  const req = createRequire(join(cfg.projectDir, "package.json"));
  let tailwindcss: (c: unknown) => unknown;
  try {
    tailwindcss = req("tailwindcss");
  } catch {
    log("warning: tailwind config found but tailwindcss is not installed in the project, styles will be missing");
    return [];
  }
  let conf: Record<string, unknown> = {};
  if (twCfg) {
    const mod = await import(twCfg);
    conf = (mod.default ?? mod) as Record<string, unknown>;
  }
  const content = conf.content;
  if (Array.isArray(content)) conf = { ...conf, content: content.map((g) => (typeof g === "string" && !g.startsWith("/") ? join(dirname(twCfg ?? cfg.projectDir), g) : g)) };
  const plugins: unknown[] = [tailwindcss(conf)];
  try {
    plugins.push(req("autoprefixer")());
  } catch {
    /* optional */
  }
  return plugins;
};

type Middleware = (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse, next: () => void) => void | Promise<void>;

export const startVite = async (cfg: LoadedConfig, opts: { log?: (s: string) => void; port?: number; /** handlers that run before the host page (the editor's routes) */ before?: Middleware[] } = {}): Promise<ViteHost> => {
  const log = opts.log ?? (() => {});
  const port = opts.port ?? nextPort();
  const postcssPlugins = await tailwindPlugins(cfg, log);
  const html = readFileSync(join(HOST_DIR, "index.html"), "utf8").replace("__MH_MAIN__", `/@fs${join(HOST_DIR, "main.tsx")}`);
  const server = await createServer({
    root: cfg.projectDir,
    configFile: false,
    envFile: false,
    logLevel: "silent",
    publicDir: cfg.publicPath,
    cacheDir: join(cfg.cachePath, "vite"),
    appType: "custom",
    clearScreen: false,
    server: { port, strictPort: true, host: "127.0.0.1", hmr: false, fs: { allow: [cfg.projectDir, HARNESS_ROOT], strict: false } },
    resolve: {
      dedupe: ["react", "react-dom"],
      alias: [
        { find: /^remotion\/no-react$/, replacement: NO_REACT },
        { find: /^remotion$/, replacement: SHIM },
      ],
    },
    esbuild: { jsx: "automatic", jsxImportSource: "react" },
    css: postcssPlugins.length ? { postcss: { plugins: postcssPlugins as never } } : undefined,
    optimizeDeps: { entries: [join(HOST_DIR, "main.tsx")], include: ["react", "react-dom", "react-dom/client"] },
    plugins: [
      // a project outside the harness repo imports the harness by absolute path (mh new writes such imports): serve those files from disk
      {
        name: "mh-absolute-imports",
        enforce: "pre" as const,
        resolveId(source: string) {
          if (source.startsWith("/") && !source.startsWith("/@") && !source.startsWith(cfg.projectDir + "/") && existsSync(source)) return source;
          return null;
        },
      },
      {
        name: "mh-root",
        resolveId: (id) => (id === "virtual:mh-root" ? "\0mh-root" : null),
        load: (id) => (id === "\0mh-root" ? `export { ${cfg.rootExport ?? "Root"} as Root } from ${JSON.stringify(cfg.rootPath)};` : null),
      },
    ],
  });
  for (const m of opts.before ?? []) server.middlewares.use((req, res, next) => void m(req, res, next));
  server.middlewares.use(async (req, res, next) => {
    if (!req.url || !req.url.startsWith("/__mh")) return next();
    try {
      const out = await server.transformIndexHtml("/__mh/", html);
      res.setHeader("Content-Type", "text/html");
      res.end(out);
    } catch (e) {
      res.statusCode = 500;
      res.end(String((e as Error).stack ?? e));
    }
  });
  await server.listen();
  const url = `http://127.0.0.1:${port}`;
  log(`vite on ${url} (root ${cfg.projectDir})`);
  return { server, url, close: () => server.close() };
};
