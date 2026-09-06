#!/usr/bin/env bun
/**
 * Full-resolution pixel diff between two same-size images (PNG or JPEG), for the
 * native-vs-remotion parity audit (docs/parity-mograph-2026-09-07.md). Unlike
 * `mh diff` / src/diff/diff.ts (which downscales by 2x for speed across many
 * frames), this reads every pixel at native resolution: exact "are these two
 * renders bit-identical" answers, not a sampled estimate.
 *
 * Usage: bun run scripts/parity/pixel-diff.ts a.png b.png [out-diff.png]
 * Prints: dimensions, max channel delta, mean abs delta over all pixels/channels,
 * count and % of pixels where any channel differs, and (if the images are not
 * identical) the mean delta over just the differing pixels, plus a bounding box.
 */
import sharp from "sharp";

const [a, b, out] = process.argv.slice(2);
if (!a || !b) {
  console.error("usage: bun run scripts/parity/pixel-diff.ts a.png b.png [out-diff.png]");
  process.exit(1);
}

const main = async () => {
  const [ia, ib] = await Promise.all([sharp(a).raw().toBuffer({ resolveWithObject: true }), sharp(b).raw().toBuffer({ resolveWithObject: true })]);
  const { data: da, info: infoA } = ia;
  const { data: db, info: infoB } = ib;
  if (infoA.width !== infoB.width || infoA.height !== infoB.height || infoA.channels !== infoB.channels) {
    console.error(`size mismatch: ${a} is ${infoA.width}x${infoA.height}x${infoA.channels}, ${b} is ${infoB.width}x${infoB.height}x${infoB.channels}`);
    process.exit(1);
  }
  const { width: w, height: h, channels: ch } = infoA;
  let sum = 0;
  let maxDelta = 0;
  let nonzeroPixels = 0;
  let sumOverNonzero = 0;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  const mask = out ? Buffer.alloc(w * h * 3) : null;
  for (let p = 0; p < w * h; p++) {
    const o = p * ch;
    let pixelMax = 0;
    let pixelSum = 0;
    for (let c = 0; c < Math.min(ch, 3); c++) {
      const d = Math.abs(da[o + c] - db[o + c]);
      pixelSum += d;
      if (d > pixelMax) pixelMax = d;
    }
    sum += pixelSum;
    if (pixelMax > maxDelta) maxDelta = pixelMax;
    if (pixelMax > 0) {
      nonzeroPixels++;
      sumOverNonzero += pixelSum;
      const x = p % w, y = (p / w) | 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    if (mask) {
      const mo = p * 3;
      if (pixelMax > 0) {
        mask[mo] = 255;
        mask[mo + 1] = Math.max(0, 255 - pixelMax * 2);
        mask[mo + 2] = 0;
      } else {
        const g = Math.round((da[o] * 0.3 + da[o + 1] * 0.59 + da[o + 2] * 0.11)) >> 1;
        mask[mo] = mask[mo + 1] = mask[mo + 2] = g;
      }
    }
  }
  const total = w * h;
  const meanAll = sum / (total * 3);
  const meanNonzero = nonzeroPixels ? sumOverNonzero / (nonzeroPixels * 3) : 0;
  console.log(`${a}\nvs ${b}`);
  console.log(`${w}x${h}, ${total} px`);
  console.log(`max channel delta: ${maxDelta}/255`);
  console.log(`mean abs delta (all px): ${meanAll.toFixed(4)}/255`);
  console.log(`pixels differing (any channel > 0): ${nonzeroPixels} (${((nonzeroPixels / total) * 100).toFixed(3)}%)`);
  if (nonzeroPixels) {
    console.log(`mean abs delta (differing px only): ${meanNonzero.toFixed(2)}/255`);
    console.log(`bounding box: x${minX}-${maxX} y${minY}-${maxY} (${maxX - minX + 1}x${maxY - minY + 1})`);
  } else {
    console.log("bit-identical");
  }
  if (mask && out) {
    await sharp(mask, { raw: { width: w, height: h, channels: 3 } }).png().toFile(out);
    console.log(`diff image -> ${out}`);
  }
};

main();
