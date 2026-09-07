#!/usr/bin/env bun
/**
 * Full-resolution sweep of every common frame in two check-frame runs
 * (native vs remotion), for the mograph parity audit
 * (docs/parity-mograph-2026-09-07.md). `mh diff` downscales 2x before
 * comparing, which is fine for a quick scan across many frames but can
 * hide a real, small, feature-specific difference (this audit found one:
 * the odometer's sub-pixel translateY). This script reads every PNG/JPEG
 * pair at native resolution in one process (no per-frame `bun` startup
 * cost the way looping pixel-diff.ts in a shell does) and reports any
 * pair with so much as one differing pixel, so nothing below the CLI's
 * threshold goes unseen.
 *
 * Usage: bun run scripts/parity/scan-frames.ts dirA dirB [minPct]
 * dirA/dirB: two "film" frame directories with the same filenames
 * (e.g. .harness/frames/effects-wide/pnative/film and .../premotion/film).
 * minPct (default 0): only print pairs at or above this % of differing
 * pixels; the summary line always covers every common file.
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const [dirA, dirB, minPctArg] = process.argv.slice(2);
if (!dirA || !dirB) {
  console.error("usage: bun run scripts/parity/scan-frames.ts dirA dirB [minPct]");
  process.exit(1);
}
const minPct = minPctArg ? Number(minPctArg) : 0;

const diffOne = async (a: string, b: string) => {
  const [ia, ib] = await Promise.all([sharp(a).raw().toBuffer({ resolveWithObject: true }), sharp(b).raw().toBuffer({ resolveWithObject: true })]);
  const { data: da, info } = ia;
  const { data: db, info: infoB } = ib;
  if (info.width !== infoB.width || info.height !== infoB.height) return { mismatch: true, maxDelta: -1, nonzero: 0, total: 0 };
  const total = info.width * info.height;
  let maxDelta = 0;
  let nonzero = 0;
  for (let p = 0; p < total; p++) {
    const o = p * info.channels;
    let pixelMax = 0;
    for (let c = 0; c < Math.min(info.channels, 3); c++) {
      const d = Math.abs(da[o + c] - db[o + c]);
      if (d > pixelMax) pixelMax = d;
    }
    if (pixelMax > maxDelta) maxDelta = pixelMax;
    if (pixelMax > 0) nonzero++;
  }
  return { mismatch: false, maxDelta, nonzero, total };
};

const main = async () => {
  const filesA = new Set(readdirSync(dirA).filter((f) => /\.(png|jpe?g)$/i.test(f)));
  const filesB = new Set(readdirSync(dirB).filter((f) => /\.(png|jpe?g)$/i.test(f)));
  const common = [...filesA].filter((f) => filesB.has(f)).sort();
  const onlyA = [...filesA].filter((f) => !filesB.has(f));
  const onlyB = [...filesB].filter((f) => !filesA.has(f));
  console.log(`${dirA}\nvs ${dirB}`);
  console.log(`${common.length} common frames${onlyA.length ? `, ${onlyA.length} only in A` : ""}${onlyB.length ? `, ${onlyB.length} only in B` : ""}`);
  let identical = 0;
  let anyDiff = 0;
  const rows: { file: string; pct: number; maxDelta: number }[] = [];
  for (const f of common) {
    const r = await diffOne(join(dirA, f), join(dirB, f));
    if (r.mismatch) {
      console.log(`${f}: SIZE MISMATCH`);
      continue;
    }
    if (r.nonzero === 0) {
      identical++;
      continue;
    }
    anyDiff++;
    const pct = (r.nonzero / r.total) * 100;
    rows.push({ file: f, pct, maxDelta: r.maxDelta });
  }
  console.log(`${identical} bit-identical, ${anyDiff} with at least one differing pixel (any %)`);
  rows.sort((a, b) => b.pct - a.pct);
  const shown = rows.filter((r) => r.pct >= minPct);
  if (shown.length) {
    console.log(`\nframe                pct-differing  max-delta`);
    for (const r of shown) console.log(`${r.file.padEnd(20)} ${r.pct.toFixed(3).padStart(12)}%  ${String(r.maxDelta).padStart(9)}`);
  }
};

main();
