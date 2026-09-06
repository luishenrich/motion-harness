#!/usr/bin/env bun
/**
 * Extracts matching-timestamp frames from two rendered mp4s with ffmpeg and
 * diffs each pair full-resolution (see pixel-diff.ts). Used to compare a
 * native-engine render against a remotion-engine render of the same film
 * (docs/parity-mograph-2026-09-07.md, step 3: "a handful of frames extracted
 * with ffmpeg at the same times").
 *
 * Usage: bun run scripts/parity/compare-video-frames.ts a.mp4 b.mp4 1.6,8.0,19.5 [outDir]
 */
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";

const [aFile, bFile, times, outDirArg] = process.argv.slice(2);
if (!aFile || !bFile || !times) {
  console.error("usage: bun run scripts/parity/compare-video-frames.ts a.mp4 b.mp4 t1,t2,... [outDir]");
  process.exit(1);
}

const extract = async (file: string, t: string, dest: string) => {
  const proc = Bun.spawn(["ffmpeg", "-y", "-v", "error", "-ss", t, "-i", file, "-frames:v", "1", dest], { stdout: "ignore", stderr: "pipe" });
  const code = await proc.exited;
  if (code !== 0) throw new Error(`ffmpeg failed on ${file} @${t}: ${await new Response(proc.stderr).text()}`);
};

const diffOne = async (a: string, b: string) => {
  const [ia, ib] = await Promise.all([sharp(a).raw().toBuffer({ resolveWithObject: true }), sharp(b).raw().toBuffer({ resolveWithObject: true })]);
  const { data: da, info } = ia;
  const { data: db, info: infoB } = ib;
  if (info.width !== infoB.width || info.height !== infoB.height) return { mean: NaN, max: NaN, note: `size mismatch ${info.width}x${info.height} vs ${infoB.width}x${infoB.height}` };
  let sum = 0, max = 0;
  const n = info.width * info.height * Math.min(info.channels, 3);
  for (let i = 0, c = 0; i < da.length && c < n; i += info.channels) {
    for (let k = 0; k < Math.min(info.channels, 3); k++, c++) {
      const d = Math.abs(da[i + k] - db[i + k]);
      sum += d;
      if (d > max) max = d;
    }
  }
  return { mean: sum / n, max };
};

const main = async () => {
  const outDir = outDirArg ?? mkdtempSync(join(tmpdir(), "mh-parity-"));
  mkdirSync(outDir, { recursive: true });
  const rows: { t: string; mean: number; max: number; note?: string }[] = [];
  for (const t of times.split(",").map((s) => s.trim())) {
    const af = join(outDir, `a-${t}.png`);
    const bf = join(outDir, `b-${t}.png`);
    await Promise.all([extract(aFile, t, af), extract(bFile, t, bf)]);
    const d = await diffOne(af, bf);
    rows.push({ t, ...d });
  }
  console.log(`${aFile}\nvs ${bFile}\nframes saved under ${outDir}\n`);
  console.log("time     mean abs delta   max delta");
  for (const r of rows) console.log(`${r.t.padEnd(8)} ${r.note ?? `${r.mean.toFixed(3).padStart(14)}   ${r.max}`}`);
};

main();
