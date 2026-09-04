import { mkdirSync, existsSync, readdirSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

export const ensureDir = (p: string) => {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
  return p;
};

export const writeJson = (p: string, v: unknown) => {
  ensureDir(join(p, ".."));
  writeFileSync(p, JSON.stringify(v, null, 2));
};

export const readJson = <T = unknown>(p: string): T => JSON.parse(readFileSync(p, "utf8")) as T;

/** hash of every file under a dir (content), used to key render caches */
export const hashDir = (dir: string, opts: { ignore?: string[] } = {}): string => {
  const h = createHash("sha1");
  const ignore = new Set(["node_modules", ".harness", "out", ".git", ...(opts.ignore ?? [])]);
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      if (ignore.has(name)) continue;
      const p = join(d, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else {
        h.update(p);
        h.update(String(st.size));
        h.update(String(st.mtimeMs));
      }
    }
  };
  walk(dir);
  return h.digest("hex").slice(0, 12);
};

export const hashString = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 12);

export const stamp = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

export const ms = (t0: number) => `${((performance.now() - t0) / 1000).toFixed(1)}s`;

export const pad = (s: string | number, n: number) => String(s).padEnd(n);

export const table = (rows: (string | number)[][], header?: string[]): string => {
  const all = header ? [header, ...rows] : rows;
  const w = all[0].map((_, i) => Math.max(...all.map((r) => String(r[i] ?? "").length)));
  const line = (r: (string | number)[]) => r.map((c, i) => pad(c ?? "", w[i])).join("  ");
  const out = [line(all[0])];
  if (header) out.push(w.map((x) => "-".repeat(x)).join("  "));
  for (const r of all.slice(header ? 1 : 0)) out.push(line(r));
  return out.join("\n");
};

export const run = async (cmd: string[], opts: { cwd?: string; quiet?: boolean } = {}): Promise<{ code: number; out: string; err: string }> => {
  const proc = Bun.spawn(cmd, { cwd: opts.cwd, stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const code = await proc.exited;
  if (code !== 0 && !opts.quiet) throw new Error(`${cmd[0]} failed (${code}): ${err.slice(-2000)}`);
  return { code, out, err };
};

export const ffprobeDuration = async (file: string): Promise<number> => {
  const r = await run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
  return parseFloat(r.out.trim());
};

/**
 * Ports for remotion's per-call servers, from a high range so they never collide
 * with dev servers on 3000-3999 (remotion's own free-port search starts there).
 */
let portCursor = 41000 + Math.floor(Math.random() * 4000);
export const nextPort = () => {
  portCursor += 1;
  if (portCursor > 49000) portCursor = 41000;
  return portCursor;
};

/** swallow stdout lines that contain `needle` while `fn` runs (remotion echoes browser console lines).
 *  Bun's console.* does not go through process.stdout.write, so the console methods are wrapped too. */
export const muteStdout = async <T,>(needle: string, fn: () => Promise<T>): Promise<T> => {
  const streams = [process.stdout, process.stderr];
  const origs = streams.map((st) => st.write.bind(st));
  const methods = ["log", "info", "debug", "warn", "error"] as const;
  const origConsole = methods.map((m) => console[m]);
  methods.forEach((m, i) => {
    console[m] = (...a: unknown[]) => {
      if (a.some((x) => typeof x === "string" && x.includes(needle))) return;
      origConsole[i](...a);
    };
  });
  streams.forEach((st, i) => {
    (st as any).write = (chunk: any, ...rest: any[]) => {
      const s = typeof chunk === "string" ? chunk : chunk?.toString?.() ?? "";
      if (s.includes(needle)) {
        const cb = rest.find((r) => typeof r === "function");
        if (cb) cb();
        return true;
      }
      return origs[i](chunk, ...rest);
    };
  });
  try {
    return await fn();
  } finally {
    streams.forEach((st, i) => ((st as any).write = origs[i]));
    methods.forEach((m, i) => (console[m] = origConsole[i]));
  }
};

export const pool = async <T, R>(items: T[], n: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> => {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
};
