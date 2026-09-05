import { describe, expect, test } from "bun:test";
import { compile, defineTimeline, type AudioCue } from "../timeline/schema.ts";
import { gainAt, cueSpan, cuesInSpan, volumeExprFor } from "./mix.ts";

// 30 fps: a = 0-3s (one 0-1s, two 1-3s), gap 1s, b = 4-6s (three)
const c = compile(
  defineTimeline({
    fps: 30,
    parts: [
      { id: "a", composition: "a", scenes: [{ id: "one", dur: 30 }, { id: "two", dur: 60, events: { hit: 15 } }] },
      { id: "b", composition: "b", gap: 30, scenes: [{ id: "three", dur: 60 }] },
    ],
  }),
);

const bed: AudioCue = { id: "bed", kind: "music", file: "bed.mp3", at: "0s", gain: 0.25, loop: true, ramps: [{ at: "b", to: 0.6, over: 1 }, { at: "5s", to: 0.1 }] };
const early: AudioCue = { id: "early", kind: "music", file: "bed.mp3", at: "b - 1s", gain: 1, trim: [0, 3] };
const click: AudioCue = { id: "click", kind: "sfx", file: "click.mp3", at: "two.hit", gain: 0.9 };

describe("gainAt", () => {
  test("base gain before any ramp", () => {
    expect(gainAt(bed, c, 0)).toBe(0.25);
    expect(gainAt(bed, c, 3.99)).toBe(0.25);
  });
  test("mid-ramp interpolates, after it the target holds", () => {
    expect(gainAt(bed, c, 4)).toBe(0.25);
    expect(gainAt(bed, c, 4.5)).toBeCloseTo(0.425, 6);
    expect(gainAt(bed, c, 4.99)).toBeCloseTo(0.25 + 0.35 * 0.99, 6);
  });
  test("a hard ramp (over 0) switches at once, every earlier ramp counted", () => {
    expect(gainAt(bed, c, 5)).toBe(0.1);
    expect(gainAt(bed, c, 100)).toBe(0.1);
  });
  test("no ramps, no gain: unity", () => {
    expect(gainAt({ id: "x", kind: "sfx", file: "x", at: 0 }, c, 2)).toBe(1);
  });
});

describe("cueSpan", () => {
  test("a loop runs to the film end", () => {
    expect(cueSpan(bed, c)).toEqual({ start: 0, end: 6 });
  });
  test("a cue before the film has a negative start, its trim sets the length", () => {
    expect(cueSpan(early, c)).toEqual({ start: 3, end: 6 });
    expect(cueSpan({ ...early, at: "one - 2s" }, c)).toEqual({ start: -2, end: 1 });
  });
  test("file length known: start + length, clamped to the film", () => {
    expect(cueSpan(click, c, 0.08)).toEqual({ start: 1.5, end: 1.58 });
    expect(cueSpan(click, c, 100)).toEqual({ start: 1.5, end: 6 });
  });
  test("file length unknown: assume it sounds to the end", () => {
    expect(cueSpan(click, c)).toEqual({ start: 1.5, end: 6 });
  });
});

describe("cuesInSpan", () => {
  const all = [bed, early, click];
  const lens = { click: 0.08 };
  test("scene one (0-1s): only the bed", () => {
    expect(cuesInSpan(all, c, { start: 0, end: 1 }, lens).map((q) => q.id)).toEqual(["bed"]);
  });
  test("scene two (1-3s): bed and the click at 1.5s", () => {
    expect(cuesInSpan(all, c, { start: 1, end: 3 }, lens).map((q) => q.id)).toEqual(["bed", "click"]);
  });
  test("scene three (4-6s): bed and the early cue that started at 3s", () => {
    expect(cuesInSpan(all, c, { start: 4, end: 6 }, lens).map((q) => q.id)).toEqual(["bed", "early"]);
  });
  test("a cue that ends exactly where the span starts is not in it", () => {
    expect(cuesInSpan([click], c, { start: 1.58, end: 3 }, lens)).toEqual([]);
  });
});

describe("volumeExprFor", () => {
  test("whole film: base gain, ramps in film time", () => {
    expect(volumeExprFor(bed, c, { start: 0, end: 6 }, 0)).toBe("if(lt(t,5.000),if(lt(t,4.000),0.25,(0.25+(0.6-0.25)*min(1,max(0,(t-4.000)/1.000)))),0.1)");
  });
  test("a preview from 4.5s starts mid-ramp: gain of that moment, ramp finishes over the remaining half second", () => {
    expect(volumeExprFor(bed, c, { start: 4.5, end: 6 }, 0)).toBe("if(lt(t,0.500),(0.425+(0.6-0.425)*min(1,max(0,(t-0.000)/0.500))),0.1)");
  });
  test("a preview from 5.5s: every ramp already happened, a constant", () => {
    expect(volumeExprFor(bed, c, { start: 5.5, end: 6 }, 0)).toBe("0.1");
  });
  test("a cue starting inside the clip: ramps relative to the cue's own start", () => {
    // clip 1-3s, cue starts 0.5s into the clip (at 1.5s film), ramp at 2s film => 0.5s into the cue
    const q: AudioCue = { ...click, ramps: [{ at: "2s", to: 0.2 }] };
    expect(volumeExprFor(q, c, { start: 1, end: 3 }, 0.5)).toBe("if(lt(t,0.500),0.9,0.2)");
  });
});
