/**
 * Stills are part of the film: thumbnails, a Shorts cover, the OG image. Every
 * <Still> the project registers (a composition of one frame) is rendered through
 * the same probe as the check frames, so overflow, wrap and collision are linted
 * before anyone opens the picture. Optional jpg copies at a width, and a sheet.
 */
import { join } from "node:path";
import sharp from "sharp";
import type { LoadedConfig } from "../config.ts";
import type { ProbeResult } from "../render/frames.ts";
import type { Engine } from "../render/engine.ts";
import { lintOverflow, lintWrap, lintCollision, lintContrast, type Finding } from "../lint/lint.ts";
import { makeSheet, type SheetCell } from "../sheet/sheet.ts";
import { ensureDir, writeJson } from "../util.ts";

export type StillInfo = { id: string; width: number; height: number };

/** every registered composition of exactly one frame: what <Still> registers */
export const listStills = async (e: Engine): Promise<StillInfo[]> => {
  const all = await e.compositions();
  return all.filter((k) => k.durationInFrames === 1).map((k) => ({ id: k.id, width: k.width, height: k.height }));
};

/** which stills a request means: "all", or ids (unknown ones are an error naming what exists) */
export const pickStills = (available: StillInfo[], wanted: string[]): StillInfo[] => {
  if (!wanted.length || wanted.includes("all")) return available;
  const missing = wanted.filter((id) => !available.some((s) => s.id === id));
  if (missing.length) throw new Error(`no still ${missing.map((m) => `"${m}"`).join(", ")} (stills registered: ${available.map((s) => s.id).join(", ") || "none"})`);
  return available.filter((s) => wanted.includes(s.id));
};

export type StillOut = { id: string; variant?: string; width: number; height: number; png: string; jpg?: string; probeFile?: string; findings: Finding[]; ms: number };

/** lint a still's probe the way a check frame is linted, minus the rules that need a timeline (safe zone, probes, same-top) */
export const lintStill = (id: string, probe: ProbeResult | undefined): Finding[] => {
  if (!probe || probe.error) return [{ level: "warn", rule: "probe-missing", where: id, message: probe?.error ?? "no probe result" }];
  return [...lintOverflow(id, probe), ...lintCollision(id, probe), ...lintWrap(id, probe), ...lintContrast(id, probe)];
};

export const renderStills = async (
  cfg: LoadedConfig,
  e: Engine,
  stills: StillInfo[],
  opts: { outDir?: string; jpg?: boolean; width?: number; quality?: number; settleMs?: number; concurrency?: number; log?: (s: string) => void; variants?: Record<string, Record<string, Record<string, unknown>>> } = {},
): Promise<StillOut[]> => {
  const log = opts.log ?? (() => {});
  const dir = ensureDir(opts.outDir ?? join(cfg.cachePath, "stills"));
  const out: StillOut[] = [];
  // a still with declared variants renders once per variant (A/B thumbnails), else once
  const jobs = stills.flatMap((st) => {
    const v = opts.variants?.[st.id];
    return v && Object.keys(v).length ? Object.entries(v).map(([variant, props]) => ({ st, variant, props })) : [{ st, variant: undefined as string | undefined, props: undefined as Record<string, unknown> | undefined }];
  });
  for (const { st, variant, props } of jobs) {
    const name = variant ? `${st.id}--${variant}` : st.id;
    const png = join(dir, `${name}.png`);
    const [o] = await e.stills(st.id, [{ frame: 0, file: png }], { probe: "text", settleMs: opts.settleMs ?? 150, concurrency: opts.concurrency ?? 2, inputProps: props });
    const res: StillOut = { ...st, variant, png, findings: lintStill(name, o.probe), ms: o.ms };
    if (o.probe) {
      res.probeFile = png.replace(/\.png$/, ".probe.json");
      writeJson(res.probeFile, o.probe);
    }
    if (opts.jpg) {
      res.jpg = join(dir, `${name}${opts.width ? `-${opts.width}` : ""}.jpg`);
      let img = sharp(png).flatten({ background: "#000" });
      if (opts.width && opts.width < st.width) img = img.resize({ width: opts.width, withoutEnlargement: true });
      await img.jpeg({ quality: opts.quality ?? 90, mozjpeg: true }).toFile(res.jpg);
    }
    log(`${name} ${st.width}x${st.height} in ${o.ms}ms${res.findings.length ? `, ${res.findings.length} finding${res.findings.length === 1 ? "" : "s"}` : ""}`);
    out.push(res);
  }
  return out;
};

/** one sheet of every still, each tile at its own aspect fitted into a landscape cell */
export const stillSheet = async (stills: StillOut[], file: string, header: string): Promise<string> => {
  const cells: SheetCell[] = stills.map((s) => ({ file: s.png, title: s.variant ? `${s.id} (${s.variant})` : s.id, sub: `${s.width}x${s.height}${s.findings.length ? ` · ${s.findings.length} finding${s.findings.length === 1 ? "" : "s"}` : ""}`, kind: "plain", ...(s.findings.some((f) => f.level === "error") ? { mark: "lint error" } : {}) }));
  await makeSheet(cells, file, { columns: Math.min(4, Math.max(1, cells.length)), cellWidth: 480, aspect: 16 / 9, header, footer: "every registered <Still>, rendered through the probe; portrait stills sit inside the landscape tile" });
  return file;
};
