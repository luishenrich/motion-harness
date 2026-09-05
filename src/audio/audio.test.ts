import { describe, expect, test } from "bun:test";
import { cueSpan, loopCopies, spanOf } from "./coverage.ts";
import { analyzeSamples, looksLikeHit, hitWarnings } from "./sfx.ts";
import { loudSpan, type AudioProfile } from "./probe.ts";
import { vetDurations, withDurations } from "./suggest.ts";
import { compile, defineTimeline } from "../timeline/schema.ts";
import type { LoadedConfig } from "../config.ts";

describe("cueSpan", () => {
  test("single play that reaches the film end", () => {
    const s = cueSpan({ start: 0, headTrim: 0, sourceDur: 60, total: 40 });
    expect(s.end).toBe(40);
    expect(s.copies).toBe(1);
    expect(s.seams).toEqual([]);
    expect(s.shortBy).toBe(0);
  });
  test("single play that ends before the film", () => {
    const s = cueSpan({ start: 5, headTrim: 0, sourceDur: 20, total: 40 });
    expect(s.end).toBe(25);
    expect(s.shortBy).toBe(15);
  });
  test("trim shortens one play, head trim cuts what lies before the film", () => {
    // a 30 s file trimmed to 10..25 (15 s) placed 3 s before the film: 12 s audible from 0
    const s = cueSpan({ start: 0, headTrim: 3, sourceDur: 15, total: 40 });
    expect(s.end).toBe(12);
    expect(s.shortBy).toBe(28);
  });
  test("loop with crossfade: copies as mixFilm chains them, seams in film time", () => {
    // 8 s file, 2 s crossfade, film 20 s from 0: need 20 / 6 -> 4 + 1 = 5 copies, chain 8 + 4*6 = 32 s
    const s = cueSpan({ start: 0, headTrim: 0, sourceDur: 8, total: 20, loop: true, loopCrossfade: 2 });
    expect(s.copies).toBe(loopCopies(20, 8, 2));
    expect(s.copies).toBe(5);
    expect(s.chainSeconds).toBe(32);
    expect(s.end).toBe(20);
    expect(s.shortBy).toBe(0);
    // seams: the crossfade occupies the last 2 s of every copy: 6-8, 12-14, 18-20 (the rest lies past the film)
    expect(s.seams.map((x) => [x.from, x.to, x.at])).toEqual([
      [6, 8, 7],
      [12, 14, 13],
      [18, 20, 19],
    ]);
  });
  test("loop placed before the film shifts the seams and the start", () => {
    const s = cueSpan({ start: 0, headTrim: 3, sourceDur: 8, total: 20, loop: true, loopCrossfade: 2 });
    expect(s.seams[0]).toEqual({ from: 3, to: 5, at: 4 });
    expect(s.end).toBe(20);
  });
  test("loop starting mid-film", () => {
    const s = cueSpan({ start: 10, headTrim: 0, sourceDur: 8, total: 20, loop: true, loopCrossfade: 2 });
    expect(s.seams[0]).toEqual({ from: 16, to: 18, at: 17 });
    expect(s.end).toBe(20);
  });
  test("fadeOut is anchored to the film end, silent when the audio stopped earlier", () => {
    const ok = cueSpan({ start: 0, headTrim: 0, sourceDur: 60, total: 40, fadeOut: 1.5 });
    expect(ok.fadeStart).toBe(38.5);
    expect(ok.fadeAudible).toBe(true);
    const bad = cueSpan({ start: 0, headTrim: 0, sourceDur: 30, total: 40, fadeOut: 1.5 });
    expect(bad.fadeStart).toBe(38.5);
    expect(bad.fadeAudible).toBe(false);
    expect(bad.shortBy).toBe(10);
  });
  test("spanOf reads at/trim/loop from a compiled cue", () => {
    const c = compile(
      defineTimeline({
        fps: 30,
        parts: [{ id: "a", composition: "a", scenes: [{ id: "one", dur: 300 }, { id: "two", dur: 300 }] }],
        audio: [{ id: "bed", kind: "music", file: "x.mp3", at: "two - 2s", trim: [1, 7], loop: true, loopCrossfade: 1 }],
      }),
    );
    const s = spanOf(c, c.timeline.audio![0], 100);
    expect(s.start).toBe(8);
    expect(s.copies).toBe(loopCopies(12, 6, 1));
    expect(s.seams[0]).toEqual({ from: 13, to: 14, at: 13.5 });
    expect(s.end).toBe(20);
  });
});

describe("sfx analysis", () => {
  const sr = 1000;
  const buf = (n: number) => new Float32Array(n);
  test("attack from the first sample above -40 dBFS to the peak, tail to the last", () => {
    const s = buf(2000);
    // 100 ms of near-silence (below the floor), a linear rise over 50 ms to the peak at 150 ms, decay to below the floor at 600 ms
    for (let i = 100; i < 150; i++) s[i] = 0.02 + (0.8 * (i - 100)) / 50;
    s[150] = 0.9;
    for (let i = 151; i < 600; i++) s[i] = 0.9 * (1 - (i - 150) / 450);
    const a = analyzeSamples(s, sr);
    expect(a.silent).toBe(false);
    expect(a.lead).toBeCloseTo(0.1, 3);
    expect(a.peakAt).toBeCloseTo(0.15, 3);
    expect(a.attack).toBeCloseTo(0.05, 3);
    // last sample above 0.01: 0.9 * (1 - k / 450) > 0.01 holds up to k = 444
    expect(a.tail).toBeCloseTo(0.444, 3);
    expect(a.peak).toBeCloseTo(0.9, 5);
    expect(a.seconds).toBe(2);
  });
  test("a silent buffer", () => {
    const a = analyzeSamples(buf(500), sr);
    expect(a.silent).toBe(true);
    expect(a.lead).toBe(0.5);
  });
  test("hit rules: slow attack or a long file", () => {
    const riser = buf(3000);
    for (let i = 0; i <= 2000; i++) riser[i] = 0.02 + (0.9 * i) / 2000;
    const w = hitWarnings(analyzeSamples(riser, sr));
    expect(w.length).toBe(2);
    expect(w[0]).toContain("attack 2000 ms");
    const click = buf(200);
    click[10] = 0.5;
    click[11] = 0.3;
    expect(hitWarnings(analyzeSamples(click, sr))).toEqual([]);
  });
  test("hit-like names", () => {
    expect(looksLikeHit("whoosh", "sfx/ui-click.mp3")).toBe(true);
    expect(looksLikeHit("impact2", "x.wav")).toBe(true);
    expect(looksLikeHit("bed", "public/music.mp3")).toBe(false);
  });
});

describe("loudSpan", () => {
  test("first and last window within 12 dB of the max", () => {
    const p: AudioProfile = { file: "x", seconds: 3, window: 0.25, rms: [0.001, 0.05, 0.3, 0.4, 0.35, 0.2, 0.09, 0.01, 0.001, 0, 0, 0], peak: 1, silentUntil: null };
    const l = loudSpan(p, 12)!;
    // threshold 0.4 / 3.98 = 0.1005: windows 2..5 qualify
    expect(l.first).toBe(0.5);
    expect(l.last).toBe(1.5);
  });
  test("silent file", () => {
    expect(loudSpan({ file: "x", seconds: 1, window: 0.25, rms: [0, 0, 0, 0], peak: 0, silentUntil: 1 })).toBeNull();
  });
});

describe("suggestion vetting", () => {
  const cfg = { rules: {} } as unknown as LoadedConfig;
  const c = compile(
    defineTimeline({
      fps: 30,
      rules: { minSceneDur: 20, maxEnterFrames: 14 },
      parts: [
        {
          id: "a",
          composition: "a",
          enterFrames: 10,
          scenes: [
            { id: "one", dur: 22, enter: "cut" },
            { id: "two", dur: 50, enter: "fade", text: "eight words that need a bit of time" },
            { id: "three", dur: 30, enter: "fade" },
          ],
        },
      ],
    }),
  );
  test("withDurations replaces only the named scenes", () => {
    const d = withDurations(c.timeline, { two: 44 });
    expect(d.scenes.map((s) => s.dur)).toEqual([22, 44, 30]);
    expect(c.scenes[1].dur).toBe(50);
  });
  test("minSceneDur veto", () => {
    const f = vetDurations(cfg, c, { one: 18 }, "one");
    expect(f.map((x) => x.rule)).toEqual(["scene-min-dur"]);
    expect(vetDurations(cfg, c, { one: 25 }, "one")).toEqual([]);
  });
  test("text-too-short veto", () => {
    // 8 words need 2.2 s = 66 f after a 10 f enter; 50 f already fails: shortening it keeps the finding, lengthening it (still failing) is not the suggestion's fault
    expect(vetDurations(cfg, c, { two: 48 }, "two").map((x) => x.rule)).toEqual(["text-too-short"]);
    expect(vetDurations(cfg, c, { two: 54 }, "two")).toEqual([]);
    const c2 = withDurations(c.timeline, { two: 80 });
    expect(vetDurations(cfg, c2, { two: 70 }, "two").map((x) => x.rule)).toEqual(["text-too-short"]);
    expect(vetDurations(cfg, c2, { two: 78 }, "two")).toEqual([]);
  });
  test("enter longer than the scene veto, only findings of that scene count", () => {
    const f = vetDurations(cfg, c, { three: 10 }, "three");
    expect(f.map((x) => x.rule).sort()).toEqual(["enter-longer-than-scene", "scene-min-dur"]);
    expect(vetDurations(cfg, c, { three: 10 }, "one")).toEqual([]);
  });
});
