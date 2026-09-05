import { describe, expect, test } from "bun:test";
import sharp from "sharp";
import { dhash, hamming, queryViews, hashFrame, bestMatches, refineFit, HASH_SIZE } from "./locate.ts";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

const W = 320, H = 180;

/** a synthetic frame: a gradient with a bright block at (bx, by) */
const picture = (bx: number, by: number, dir: 1 | -1 = 1) => {
  const buf = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 3;
      const g = dir === 1 ? Math.round((x / W) * 200) : Math.round(((W - x) / W) * 200);
      const inBlock = x >= bx && x < bx + 60 && y >= by && y < by + 40;
      buf[o] = inBlock ? 255 : g;
      buf[o + 1] = inBlock ? 220 : g >> 1;
      buf[o + 2] = inBlock ? 40 : 40;
    }
  return sharp(buf, { raw: { width: W, height: H, channels: 3 } }).png();
};

describe("dhash", () => {
  test("256 bits, identical images are 0 apart, different ones far apart", async () => {
    const a = await picture(40, 40).toBuffer();
    const b = await picture(200, 100, -1).toBuffer();
    const ha = await dhash(a), hb = await dhash(b);
    expect(ha.length).toBe((HASH_SIZE * HASH_SIZE) / 8);
    expect(hamming(ha, ha)).toBe(0);
    expect(hamming(ha, hb)).toBeGreaterThan(40);
  });
  test("a resized copy stays close", async () => {
    const a = await picture(40, 40).toBuffer();
    const small = await sharp(a).resize(160, 90).png().toBuffer();
    expect(hamming(await dhash(a), await dhash(small))).toBeLessThan(16);
  });
});

describe("locate against a run", () => {
  test("letterboxed and cropped screenshots find the right frame", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mh-locate-"));
    const frames = [
      { file: join(dir, "f1.png"), id: "one" },
      { file: join(dir, "f2.png"), id: "two" },
      { file: join(dir, "f3.png"), id: "three" },
    ];
    await picture(40, 40).toFile(frames[0].file);
    await picture(200, 100, -1).toFile(frames[1].file);
    await picture(120, 80).toFile(frames[2].file);
    const hashes = new Map(await Promise.all(frames.map(async (f) => [f.file, await hashFrame(f.file)] as const)));

    // letterboxed: black bars above and below frame two
    const letterboxed = await sharp(await picture(200, 100, -1).toBuffer()).extend({ top: 60, bottom: 60, background: "#000" }).png().toBuffer();
    const q1 = await queryViews(letterboxed, W / H);
    const m1 = bestMatches(frames, hashes, q1);
    expect(m1[0].frame.id).toBe("two");
    expect(m1[0].distance).toBeLessThan(20);

    // an off-centre crop (40 % of frame three, holding the whole block)
    const cropped = await sharp(await picture(120, 80).toBuffer()).extract({ left: 100, top: 60, width: 128, height: 72 }).png().toBuffer();
    const q2 = await queryViews(cropped, W / H);
    const m2 = bestMatches(frames, hashes, q2);
    expect(m2[0].frame.id).toBe("three");
    expect(m2[0].against).toMatch(/^window/);

    // the refinement finds where the crop sits: 40 % of the frame at 100/320, 60/180
    const fit = await refineFit(frames[2].file, cropped);
    expect(fit.score).toBeGreaterThan(0.9);
    expect(Math.abs(fit.scale - 0.4)).toBeLessThan(0.06);
    expect(Math.abs(fit.x - 100 / 320)).toBeLessThan(0.06);
    expect(Math.abs(fit.y - 60 / 180)).toBeLessThan(0.06);
    const wrong = await refineFit(frames[1].file, cropped);
    expect(wrong.score).toBeLessThan(fit.score);

  });
});
