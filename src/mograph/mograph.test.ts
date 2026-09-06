import { describe, expect, test } from "bun:test";
import type { MgFilm } from "./schema.ts";
import { layerTiming, colorOf, isDark, layerFor } from "./schema.ts";
import { resolveEase, progressOf, isKnownEase } from "./easing.ts";
import { poseAt, inTracks, trackValue, staggerDelay, settleFrame } from "./pose.ts";
import { mographTimeline, sceneEvents } from "./timeline.ts";
import { compile, probeSpec } from "../timeline/schema.ts";
import { setValue, getValue, unsetValue, setKey, unsetKey, addLayer, addScene, remove, move, duplicate, rename, lintFilm, parseValue, describe as describeFilm } from "./edit.ts";

const film = (): MgFilm => ({
  title: "t",
  fps: 30,
  design: { ink: "#101010", paper: "#F5F1E8", accent: "#F2B441", colors: { teal: "#3FB9A8" } },
  formats: { wide: { width: 1920, height: 1080 }, vertical: { width: 1080, height: 1920 } },
  easings: { settle: "cubic-bezier(0.2,0.9,0.1,1)" },
  scenes: [
    { id: "hook", dur: 90, ground: "ink", exit: { type: "fade", dur: 8 }, layers: [
      { id: "line", type: "text", text: "Three words *here* now", size: 96, color: "paper", in: { preset: "rise", at: 4, dur: 16, stagger: { by: "word", each: 3 } }, formats: { vertical: { size: 80, at: { x: 0.5, y: 0.4 } } } },
      { id: "rule", type: "shape", shape: "line", w: 200, fill: "accent", in: { preset: "grow", at: 30, dur: 10 }, out: { preset: "fade", at: -12, dur: 12 } },
    ] },
    { id: "stat", dur: 60, ground: "paper", layers: [{ id: "n", type: "counter", to: 40, suffix: " ms", in: { preset: "pop", dur: 14, ease: "back" } }] },
  ],
});

describe("mograph schema", () => {
  test("timing, colours, format overrides", () => {
    const f = film();
    const t = layerTiming(f, f.scenes[0], f.scenes[0].layers[1]);
    expect(t).toMatchObject({ inAt: 30, inDur: 10, outAt: 78, outDur: 12 });
    expect(colorOf(f.design, "teal")).toBe("#3FB9A8");
    expect(colorOf(f.design, "#ABCDEF")).toBe("#ABCDEF");
    expect(isDark("#101010")).toBe(true);
    expect(isDark("#F5F1E8")).toBe(false);
    const v = layerFor(f.scenes[0].layers[0], "vertical") as { size: number; at: { x: number; y: number } };
    expect(v.size).toBe(80);
    expect(v.at).toEqual({ x: 0.5, y: 0.4 });
    expect((layerFor(f.scenes[0].layers[0], "wide") as { size: number }).size).toBe(96);
  });
});

describe("easing as data", () => {
  test("names, beziers, steps and springs resolve", () => {
    const f = film();
    const out = resolveEase("out", f.easings);
    expect(out.kind).toBe("curve");
    expect(progressOf(out, 8, 16, 30)).toBeGreaterThan(0.5);
    expect(progressOf(resolveEase("linear"), 4, 16, 30)).toBeCloseTo(0.25, 5);
    expect(progressOf(resolveEase("steps(4)"), 5, 16, 30)).toBeCloseTo(0.25, 5);
    expect(resolveEase("settle", f.easings).kind).toBe("curve");
    const sp = resolveEase("bouncy");
    expect(sp.kind).toBe("spring");
    expect(progressOf(sp, 60, 0, 30)).toBeCloseTo(1, 1);
    expect(isKnownEase("nope")).toBe(false);
    expect(isKnownEase({ spring: { damping: 9 } })).toBe(true);
  });
});

describe("pose", () => {
  test("presets write tracks, explicit tracks win, staggers delay, springs settle", () => {
    const f = film();
    const s = f.scenes[0];
    const line = s.layers[0];
    expect(inTracks({ preset: "rise", dur: 16 })).toEqual({ opacity: [{ at: 0, v: 0 }, { at: 16, v: 1, ease: "out" }], y: [{ at: 0, v: 32 }, { at: 16, v: 0, ease: "out" }] });
    expect(poseAt(f, s, line, 2).visible).toBe(false);
    const mid = poseAt(f, s, line, 12);
    expect(mid.visible).toBe(true);
    expect(mid.opacity).toBeGreaterThan(0.3);
    expect(mid.opacity).toBeLessThan(1);
    expect(mid.y).toBeGreaterThan(0);
    const done = poseAt(f, s, line, 40);
    expect(done).toMatchObject({ opacity: 1, y: 0, scale: 1 });
    // the third word arrives six frames later
    expect(staggerDelay({ by: "word", each: 3 }, 2, 4)).toBe(6);
    expect(poseAt(f, s, line, 12, 6).opacity).toBeLessThan(mid.opacity);
    // the rule grows then fades out from frame 78
    const rule = s.layers[1];
    expect(poseAt(f, s, rule, 35).w).toBeGreaterThan(0);
    expect(poseAt(f, s, rule, 35).w).toBeLessThan(1);
    expect(poseAt(f, s, rule, 60).w).toBe(1);
    expect(poseAt(f, s, rule, 84).opacity).toBeLessThan(0.95);
    expect(poseAt(f, s, rule, 89).opacity).toBeLessThan(0.2);
    // an explicit track beats the preset
    line.tracks = { opacity: [{ at: 0, v: 0.2 }, { at: 30, v: 0.2 }] };
    expect(poseAt(f, s, line, 20).opacity).toBeCloseTo(0.2, 5);
    expect(trackValue([{ at: 10, v: 0 }, { at: 20, v: 10, ease: "linear" }], 15, 30, {})).toBeCloseTo(5, 5);
    expect(settleFrame(f, s, line, 4)).toBe(4 + 9 + 16);
  });
});

describe("timeline from a film", () => {
  test("scenes, events, probes with windows, text, tokens", () => {
    const f = film();
    const tl = mographTimeline(f, { film: "spot" });
    const c = compile(tl);
    expect(c.dur).toBe(150);
    expect(c.parts[0].composition).toEqual({ wide: "spot-wide", vertical: "spot-vertical" });
    expect(sceneEvents(f, f.scenes[0])).toMatchObject({ lineIn: 4, ruleIn: 30, ruleOut: 78 });
    expect(c.scenes[0].ground).toBe("dark");
    expect(c.scenes[1].ground).toBe("light");
    expect(c.scenes[0].text).toEqual(["Three words here now"]);
    expect(c.scenes[1].text).toEqual(["40 ms"]);
    expect(c.scenes[0].exit?.dur).toBe(8);
    expect(c.scenes[0].probes).toEqual(["line@20-89"]);
    expect(probeSpec("line@20-89")).toEqual({ key: "line", from: 20, to: 89 });
    expect(probeSpec("card")).toEqual({ key: "card", from: 0, to: Infinity });
  });
});

describe("edit by address", () => {
  test("get, set, unset, keys, add, remove, move, dup, rename", () => {
    const f = film();
    expect(getValue(f, "hook.line.size")).toBe(96);
    expect(setValue(f, "hook.line.size", 110).before).toBe(96);
    expect(getValue(f, "hook.line.size")).toBe(110);
    setValue(f, "hook.line.at.y", 0.42);
    expect(getValue(f, "hook.line.at")).toEqual({ y: 0.42 });
    setValue(f, "hook.dur", 120);
    expect(f.scenes[0].dur).toBe(120);
    setValue(f, "design.accent", "#FF6B35");
    expect(f.design.accent).toBe("#FF6B35");
    expect(() => setValue(f, "nope.x", 1)).toThrow(/no scene/);
    expect(() => setValue(f, "hook.line", 1)).toThrow(/whole layer/);
    expect(parseValue("0.5")).toBe(0.5);
    expect(parseValue('{"x":0.5,"y":0.4}')).toEqual({ x: 0.5, y: 0.4 });
    expect(parseValue("paper")).toBe("paper");
    setKey(f, "hook.line.opacity", 10, 0.5, "linear");
    setKey(f, "hook.line.opacity", 0, 0);
    setKey(f, "hook.line.opacity", 10, 0.6);
    expect(f.scenes[0].layers[0].tracks?.opacity).toEqual([{ at: 0, v: 0 }, { at: 10, v: 0.6, ease: "linear" }]);
    unsetKey(f, "hook.line.opacity", 0);
    expect(f.scenes[0].layers[0].tracks?.opacity).toEqual([{ at: 10, v: 0.6, ease: "linear" }]);
    expect(() => setKey(f, "hook.line.size", 1, 1)).toThrow(/not a track/);
    addLayer(f, "hook", { id: "dot", type: "shape", shape: "circle", d: 20 }, { before: "rule" });
    expect(f.scenes[0].layers.map((l) => l.id)).toEqual(["line", "dot", "rule"]);
    move(f, "hook.dot", { after: "rule" });
    expect(f.scenes[0].layers.map((l) => l.id)).toEqual(["line", "rule", "dot"]);
    expect(duplicate(f, "hook.line", "line-b")).toBe("hook.line-b");
    expect(f.scenes[0].layers[1].id).toBe("line-b");
    remove(f, "hook.line-b");
    addScene(f, { id: "end", dur: 60, layers: [] }, { after: "hook" });
    expect(f.scenes.map((s) => s.id)).toEqual(["hook", "end", "stat"]);
    move(f, "end", { after: "stat" });
    rename(f, "end", "outro");
    expect(f.scenes[2].id).toBe("outro");
    expect(remove(f, "outro")).toBe("scene");
    expect(unsetValue(f, "hook.line.tracks")).toBeDefined();
    expect(describeFilm(f)[0]).toMatchObject({ scene: "hook", layer: "line", type: "text", in: "rise @4 16f +3/word" });
  });
  test("lint catches the mistakes an edit can make", () => {
    const f = film();
    setValue(f, "hook.line.color", "papper");
    setValue(f, "hook.rule.in.at", 200);
    setValue(f, "hook.rule.in.ease", "swoosh");
    setValue(f, "stat.n.in.preset", "explode");
    f.scenes[1].dur = 30;
    addLayer(f, "stat", { id: "long", type: "text", text: "one two three four five six seven eight nine ten", in: { at: 0, dur: 10 } });
    const rules = lintFilm(f).map((x) => `${x.rule}:${x.where}`);
    expect(rules).toContain("color:hook.line.color");
    expect(rules).toContain("in-late:hook.rule.in.at");
    expect(rules).toContain("ease:hook.rule.in.ease");
    expect(rules).toContain("preset:stat.n.in.preset");
    expect(rules).toContain("reading-time:stat.long");
    expect(lintFilm(film())).toEqual([]);
  });
});
