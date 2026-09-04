import { describe, expect, test } from "bun:test";
import { compile, defineTimeline } from "./schema.ts";
import { resolve, resolveUnclamped, checkFramesFor } from "./resolve.ts";
import { timelineMarkdown } from "./docs.ts";

const tl = defineTimeline({
  fps: 30,
  parts: [
    { id: "a", composition: "a", enterFrames: 10, scenes: [{ id: "one", dur: 30, enter: "cut" }, { id: "two", dur: 60, enter: "fade", events: { hit: 20 } }] },
    { id: "b", composition: { wide: "b-wide" }, gap: 15, overlap: 8, scenes: [{ id: "three", dur: 45, enter: "wipe", text: "Six words that need some time" }] },
  ],
  audio: [{ id: "bed", kind: "music", file: "x.mp3", at: "b - 1s" }],
});
const c = compile(tl);

describe("compile", () => {
  test("absolute frames and film offsets", () => {
    expect(c.dur).toBe(30 + 60 + 15 + 45);
    expect(c.parts[1].filmStart).toBe(105);
    const three = c.scenes.find((s) => s.id === "three")!;
    expect(three.start).toBe(0);
    expect(three.filmStart).toBe(105);
    expect(three.settled).toBe(12);
    expect(three.enter.dur).toBe(12);
  });
  test("cut has no transition, events carry film frames", () => {
    const one = c.scenes[0];
    expect(one.enter.dur).toBe(0);
    const two = c.scenes[1];
    expect(two.events[0]).toEqual({ name: "hit", local: 20, partFrame: 50, filmFrame: 50 });
  });
});

describe("resolve", () => {
  test("seconds, frames, scene, event, offsets, part-local, index", () => {
    expect(resolve(c, "0.5s").scene.id).toBe("one");
    expect(resolve(c, "f50").local).toBe(20);
    expect(resolve(c, "two").local).toBe(0);
    expect(resolve(c, "two.hit").filmFrame).toBe(50);
    expect(resolve(c, "two.hit+5").local).toBe(25);
    expect(resolve(c, "two-1").local).toBe(59);
    expect(resolve(c, "two.mid").local).toBe(30);
    expect(resolve(c, "b:f10").scene.id).toBe("three");
    expect(resolve(c, "b:f10").local).toBe(10);
    expect(resolve(c, "#2").scene.id).toBe("three");
    expect(resolve(c, "0:03.5").filmFrame).toBe(105);
  });
  test("nearest event and transition flag", () => {
    const L = resolve(c, "two+22");
    expect(L.event).toEqual({ name: "hit", local: 20, distance: 2 });
    expect(resolve(c, "three+3").inTransition).toBe(true);
    expect(resolve(c, "three+12").inTransition).toBe(false);
  });
  test("seconds arithmetic, also before the film starts", () => {
    expect(resolve(c, "three - 1s").filmFrame).toBe(75);
    expect(resolveUnclamped(c, "one - 2s").filmFrame).toBe(-60);
  });
  test("errors name the neighbours", () => {
    expect(() => resolve(c, "tw")).toThrow(/did you mean two/);
    expect(() => resolve(c, "two.nope")).toThrow(/has no event/);
  });
});

describe("check frames", () => {
  test("transition, settled, events, mid, last, no duplicates", () => {
    const f = checkFramesFor(c.scenes[1]);
    const kinds = f.map((x) => `${x.kind}:${x.local}`);
    expect(kinds).toContain("transition:0");
    expect(kinds).toContain("settled:10");
    expect(kinds).toContain("event:20");
    expect(kinds).toContain("event:26");
    expect(kinds).toContain("end:59");
    expect(new Set(f.map((x) => x.local)).size).toBe(f.length);
  });
});

describe("docs", () => {
  test("markdown carries every scene", () => {
    const md = timelineMarkdown(c);
    for (const s of c.scenes) expect(md).toContain(`| ${s.id} |`);
    expect(md).toContain("b - 1s");
  });
});
