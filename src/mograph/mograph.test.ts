import { describe, expect, test } from "bun:test";
import type { GroupLayer, MgFilm } from "./schema.ts";
import { layerTiming, colorOf, isDark, layerFor } from "./schema.ts";
import { resolveEase, progressOf, isKnownEase } from "./easing.ts";
import { poseAt, inTracks, trackValue, staggerDelay, settleFrame, cameraAt, cameraSettle, childDelays, walkLayers, CAMERA_REST } from "./pose.ts";
import { mographTimeline, sceneEvents, transitionDur } from "./timeline.ts";
import { transitionStyles } from "./runtime.tsx";
import { frameFor } from "./layout.ts";
import { compile, probeSpec } from "../timeline/schema.ts";
import { resolve } from "../timeline/resolve.ts";
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

/* ---------- groups, camera, scene transitions ---------- */

const grouped = (): MgFilm => ({
  title: "g",
  fps: 30,
  design: { ink: "#101010", paper: "#F5F1E8", accent: "#F2B441" },
  formats: { wide: { width: 1920, height: 1080 }, vertical: { width: 1080, height: 1920 } },
  scenes: [
    {
      id: "card",
      dur: 120,
      ground: "ink",
      camera: { preset: "push", from: 1, to: 1.1, focus: { x: 0.5, y: 0.4 }, ease: "linear", at: 0, dur: 60 },
      layers: [
        {
          id: "box",
          type: "group",
          w: 900,
          h: 520,
          at: { x: 0.5, y: 0.5 },
          anchor: "center",
          in: { preset: "pop", at: 10, dur: 12, stagger: { by: "item", each: 4 } },
          layers: [
            { id: "bg", type: "shape", shape: "rect", w: 900, h: 520, radius: 28, fill: "paper", at: { x: 0.5, y: 0.5 }, in: { preset: "fade", at: 0, dur: 8 } },
            { id: "title", type: "text", text: "Plan", size: 64, color: "ink", at: { x: 0.5, y: 0.3 }, in: { preset: "rise", at: 6, dur: 10 } },
            {
              id: "inner",
              type: "group",
              w: 400,
              h: 120,
              at: { x: 0.5, y: 0.7 },
              in: { preset: "fade", at: 2, dur: 6 },
              layers: [{ id: "n", type: "counter", to: 12, size: 80, color: "ink", at: { x: 0.5, y: 0.5 }, in: { preset: "pop", at: 4, dur: 10 } }],
            },
          ],
        },
      ],
    },
    { id: "next", dur: 90, ground: "paper", transition: { type: "push-left", dur: 12, ease: "inOut" }, layers: [{ id: "line", type: "text", text: "over the top", size: 60, color: "ink", in: { preset: "fade", at: 0, dur: 10 } }] },
  ],
});

describe("groups", () => {
  test("a child's in counts from the group's in, staggered by its index", () => {
    const f = grouped();
    const s = f.scenes[0];
    const box = s.layers[0] as GroupLayer;
    // the group itself arrives at 10
    expect(layerTiming(f, s, box).inAt).toBe(10);
    // bg is child 0 (delay 10), title child 1 (10 + 4), inner child 2 (10 + 8)
    expect(childDelays(f, s, box)).toEqual([10, 14, 18]);
    const title = box.layers[1];
    // title's own in.at is 6, so it starts at 14 + 6 = 20 and is done at 30
    expect(poseAt(f, s, title, 19, 14).visible).toBe(false);
    expect(poseAt(f, s, title, 22, 14).opacity).toBeGreaterThan(0);
    expect(poseAt(f, s, title, 22, 14).opacity).toBeLessThan(1);
    expect(poseAt(f, s, title, 40, 14)).toMatchObject({ opacity: 1, y: 0 });
    // the nested group passes its own delay on: inner starts at 18 + 2 = 20, its counter at 20 + 4 = 24
    const inner = box.layers[2] as GroupLayer;
    expect(childDelays(f, s, inner, 18)).toEqual([20]);
    expect(poseAt(f, s, inner.layers[0], 23, 20).visible).toBe(false);
    expect(poseAt(f, s, inner.layers[0], 26, 20).visible).toBe(true);
    // the whole tree, a group before its children, each with the delay it inherits
    expect(walkLayers(f, s).map((n) => `${n.address}@${n.delay}`)).toEqual(["box@0", "box.bg@10", "box.title@14", "box.inner@18", "box.inner.n@20"]);
  });

  test("events, text, probes and rows reach into the group", () => {
    const f = grouped();
    const ev = sceneEvents(f, f.scenes[0]);
    expect(ev.boxIn).toBe(10);
    expect(ev.titleIn).toBe(20);
    expect(ev.nIn).toBe(24);
    // the group settles when the last thing inside it has settled (the counter, 24 + 10)
    expect(ev.boxSettled).toBe(34);
    expect(ev.cameraSettled).toBe(60);
    const c = compile(mographTimeline(f, { film: "g" }));
    expect(c.scenes[0].text).toEqual(["Plan", "12"]);
    expect(c.scenes[0].probes).toEqual(["box@22-119", "title@30-119", "inner@26-119", "n@34-119"]);
    const rows = describeFilm(f);
    expect(rows.map((r) => r.layer)).toEqual(["box", "box.bg", "box.title", "box.inner", "box.inner.n", "line"]);
    expect(rows[2]).toMatchObject({ type: "text", in: "rise @20 10f" });
  });

  test("addresses reach into the group, and so do add, dup, move and remove", () => {
    const f = grouped();
    expect(getValue(f, "card.box.title.size")).toBe(64);
    setValue(f, "card.box.title.size", 72);
    expect((f.scenes[0].layers[0] as GroupLayer).layers[1]).toMatchObject({ size: 72 });
    expect(getValue(f, "card.box.inner.n.to")).toBe(12);
    // a property of the group itself still resolves as a property
    expect(getValue(f, "card.box.w")).toBe(900);
    setKey(f, "card.box.title.y", 0, 20, "out");
    expect((f.scenes[0].layers[0] as GroupLayer).layers[1].tracks?.y).toEqual([{ at: 0, v: 20, ease: "out" }]);
    addLayer(f, "card.box", { id: "rule", type: "shape", shape: "line", w: 200, fill: "accent", at: { x: 0.5, y: 0.55 } }, { after: "title" });
    expect((f.scenes[0].layers[0] as GroupLayer).layers.map((l) => l.id)).toEqual(["bg", "title", "rule", "inner"]);
    expect(duplicate(f, "card.box.title", "title-b")).toBe("card.box.title-b");
    move(f, "card.box.title-b", { before: "bg" });
    expect((f.scenes[0].layers[0] as GroupLayer).layers.map((l) => l.id)).toEqual(["title-b", "bg", "title", "rule", "inner"]);
    remove(f, "card.box.title-b");
    expect((f.scenes[0].layers[0] as GroupLayer).layers.map((l) => l.id)).toEqual(["bg", "title", "rule", "inner"]);
    rename(f, "card.box.rule", "line-2");
    expect((f.scenes[0].layers[0] as GroupLayer).layers[2].id).toBe("line-2");
    expect(() => addLayer(f, "card.box.title", { id: "x", type: "text", text: "x" })).toThrow(/not a group/);
    expect(lintFilm(f)).toEqual([]);
  });

  test("lint sees the layers inside a group", () => {
    const f = grouped();
    const box = f.scenes[0].layers[0] as GroupLayer;
    box.layers.push({ id: "title", type: "text", text: "twice" });
    box.layers.push({ id: "late", type: "text", text: "way past", in: { at: 300, dur: 10 } });
    (f.scenes[1].layers[0] as { in?: { preset?: string } }).in = { preset: "boom" };
    addLayer(f, "card", { id: "empty", type: "group", w: 100, h: 100, layers: [] });
    const rules = lintFilm(f).map((x) => `${x.rule}:${x.where}`);
    expect(rules).toContain("duplicate-id:card.box.title");
    expect(rules).toContain("in-late:card.box.late.in.at");
    expect(rules).toContain("preset:next.line.in.preset");
    expect(rules).toContain("empty-group:card.empty");
  });
});

describe("camera", () => {
  test("presets, tracks that win, a deterministic shake, and the settle event", () => {
    const f = grouped();
    const s = f.scenes[0];
    expect(cameraAt(f, s, 0)).toMatchObject({ zoom: 1, x: 0, y: 0, rotate: 0, focus: { x: 0.5, y: 0.4 } });
    expect(cameraAt(f, s, 30).zoom).toBeCloseTo(1.05, 3);
    expect(cameraAt(f, s, 60).zoom).toBeCloseTo(1.1, 5);
    // past the last key the camera holds
    expect(cameraAt(f, s, 110).zoom).toBeCloseTo(1.1, 5);
    expect(cameraSettle(f, s)).toBe(60);
    // a travelling shot: three x keys win over the preset, the zoom preset still runs
    s.camera!.tracks = { x: [{ at: 0, v: -120 }, { at: 45, v: 0, ease: "inOut" }, { at: 90, v: 120, ease: "inOut" }] };
    expect(cameraAt(f, s, 0).x).toBe(-120);
    expect(cameraAt(f, s, 45).x).toBe(0);
    expect(cameraAt(f, s, 90).x).toBe(120);
    expect(cameraAt(f, s, 30).zoom).toBeCloseTo(1.05, 3);
    expect(cameraSettle(f, s)).toBe(90);
    // the shake is seeded: the same frame always gives the same wobble, a different seed a different one
    s.camera = { preset: "none", shake: { amount: 6, seed: 3 } };
    const a = cameraAt(f, s, 17);
    expect(cameraAt(f, s, 17)).toEqual(a);
    expect(Math.abs(a.x)).toBeLessThanOrEqual(6);
    expect(cameraAt(f, s, 18).x).not.toBe(a.x);
    expect(cameraAt(f, { ...s, camera: { preset: "none", shake: { amount: 6, seed: 4 } } }, 17).x).not.toBe(a.x);
    expect(cameraSettle(f, s)).toBe(null);
    expect(cameraAt(f, f.scenes[1], 10)).toEqual(CAMERA_REST);
  });

  test("the camera is a scene property: addresses and lint", () => {
    const f = grouped();
    expect(getValue(f, "card.camera.to")).toBe(1.1);
    setValue(f, "card.camera.to", 1.2);
    expect(f.scenes[0].camera?.to).toBe(1.2);
    setValue(f, "card.camera.preset", "swoop");
    setValue(f, "card.camera.ease", "wobble");
    setValue(f, "card.camera.tracks.zoomy", [{ at: 0, v: 1 }]);
    const rules = lintFilm(f).map((x) => `${x.rule}:${x.where}`);
    expect(rules).toContain("camera-preset:card.camera.preset");
    expect(rules).toContain("ease:card.camera.ease");
    expect(rules).toContain("camera-track:card.camera.tracks.zoomy");
  });
});

describe("scene transitions", () => {
  test("the incoming scene owns the handover and the timeline calls it the enter", () => {
    const f = grouped();
    expect(transitionDur(f, f.scenes[1], 1)).toBe(12);
    // the first scene has nothing to come over
    expect(transitionDur(f, f.scenes[0], 0)).toBe(0);
    const c = compile(mographTimeline(f, { film: "g" }));
    expect(c.scenes[1].enter).toEqual({ type: "push-left", dur: 12 });
    expect(c.scenes[1].settled).toBe(c.scenes[1].start + 12);
    expect(resolve(c, "next+4").inTransition).toBe(true);
    expect(resolve(c, "next+12").inTransition).toBe(false);
    // a handover can never be longer than either scene
    f.scenes[1].transition = { type: "dissolve", dur: 400 };
    expect(transitionDur(f, f.scenes[1], 1)).toBe(89);
    f.scenes[1].transition = { type: "cut", dur: 12 };
    expect(transitionDur(f, f.scenes[1], 1)).toBe(0);
  });

  test("what the two scenes look like while the handover runs", () => {
    const fr = frameFor(grouped(), "wide");
    expect(transitionStyles("push-left", 0, fr)).toMatchObject({ prev: { transform: "translateX(0%)" }, next: { transform: "translateX(100%)" } });
    expect(transitionStyles("push-left", 1, fr)).toMatchObject({ prev: { transform: "translateX(-100%)" }, next: { transform: "translateX(0%)" } });
    expect(transitionStyles("dissolve", 0.5, fr).next).toEqual({ opacity: 0.5 });
    expect(transitionStyles("dip", 0.25, fr)).toMatchObject({ prev: { opacity: 0.5 }, next: { opacity: 0 }, dip: true });
    expect(transitionStyles("dip", 0.75, fr)).toMatchObject({ prev: { opacity: 0 }, next: { opacity: 0.5 } });
    expect(transitionStyles("wipe-left", 0.25, fr).next).toEqual({ clipPath: "inset(0 0 0 75%)" });
    expect(transitionStyles("wipe-down", 0.25, fr).next).toEqual({ clipPath: "inset(0 0 75% 0)" });
    expect(transitionStyles("zoom", 1, fr).next).toMatchObject({ transform: "scale(1.0000)", opacity: 1 });
    expect(transitionStyles("blur", 0, fr).next).toMatchObject({ opacity: 0 });
    expect(transitionStyles("cut", 0.5, fr)).toEqual({ prev: {}, next: {}, dip: false });
  });

  test("a continuing handover keeps the previous scene's layers alive past its end", () => {
    const f = grouped();
    const s = f.scenes[0];
    const title = (s.layers[0] as GroupLayer).layers[1];
    expect(poseAt(f, s, title, 120, 14).visible).toBe(false);
    expect(poseAt(f, { ...s, hold: 12 }, title, 125, 14).visible).toBe(true);
    expect(poseAt(f, { ...s, hold: 12 }, title, 132, 14).visible).toBe(false);
  });

  test("lint catches a transition that does not fit", () => {
    const f = grouped();
    f.scenes[1].transition = { type: "slam" as never, dur: 200 };
    f.scenes[0].transition = { type: "dissolve", dur: 10 };
    const rules = lintFilm(f).map((x) => `${x.rule}:${x.where}`);
    expect(rules).toContain("transition:next.transition.type");
    expect(rules).toContain("transition-long:next.transition.dur");
    expect(rules).toContain("transition:card.transition");
  });
});
