import { describe, expect, test } from "bun:test";
import type { MgFilm, TextLayer } from "./schema.ts";
import { colorOf } from "./schema.ts";
import { colorTrackAt, flatOf, gradientCss, groundFlat, groundPaint, layerPaint, mixHex, oklabToRgb, paintOf, rgbToOklab, toHex, toRgb } from "./colour.ts";
import { effectStyle, filterOf, gradientTextOf, highlightAt, inProgress, lintFlags, scrambleText, strokeStyle } from "./effects.ts";
import { inTracks, poseAt, staggerDelay } from "./pose.ts";
import { arrowBox, arrowPath, chartGeometry, drawnProgress, odometerCells, padDigits, polygonPath, ringGeometry, starPath } from "./shapes.ts";
import { MAX_PARTICLES, particlesAt, rng } from "./particles.ts";
import { lintFilm } from "./edit.ts";

const film = (): MgFilm => ({
  title: "t",
  fps: 30,
  design: { ink: "#12151A", paper: "#F2EEE6", accent: "#F2B441", muted: "#5F6670", colors: { teal: "#3FB9A8", rose: "#E86F7A" } },
  formats: { wide: { width: 1920, height: 1080 } },
  scenes: [
    {
      id: "one",
      dur: 90,
      ground: { gradient: ["ink", "teal"], angle: 160 },
      groundTracks: [{ at: 0, v: "ink" }, { at: 60, v: "teal", ease: "linear" }],
      layers: [
        { id: "line", type: "text", text: "colour", color: "paper", colorTracks: { color: [{ at: 0, v: "paper" }, { at: 40, v: "accent", ease: "linear" }] }, in: { preset: "fade", at: 0, dur: 10 } },
        { id: "box", type: "shape", shape: "rect", w: 200, h: 100, fill: { gradient: ["accent", "rose"], angle: 90 }, in: { preset: "fade", at: 0, dur: 10 } },
      ],
    },
  ],
});

describe("OKLab", () => {
  test("a colour survives the round trip", () => {
    for (const hex of ["#12151A", "#F2B441", "#3FB9A8", "#FFFFFF", "#000000", "#E86F7A", "#123456"]) {
      const back = toHex(oklabToRgb(rgbToOklab(toRgb(hex))));
      expect(back).toBe(hex.toUpperCase());
    }
  });
  test("a mix stays between its ends and keeps the hue", () => {
    expect(mixHex("#000000", "#FFFFFF", 0)).toBe("#000000");
    expect(mixHex("#000000", "#FFFFFF", 1)).toBe("#FFFFFF");
    const mid = mixHex("#F2B441", "#3FB9A8", 0.5);
    const c = toRgb(mid);
    // yellow to teal through OKLab keeps some chroma; sRGB averaging would land near the grey #98B6 75
    expect(Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b)).toBeGreaterThan(40);
    const grey = mixHex("#FFFFFF", "#000000", 0.5);
    // OKLab's middle lightness is not the arithmetic middle of the channels (#808080): it sits near #636363
    expect(toRgb(grey).r).toBeLessThan(110);
    expect(toRgb(grey).r).toBeGreaterThan(88);
  });
});

describe("gradients", () => {
  test("linear, radial and a flat colour paint what they say", () => {
    const f = film();
    expect(gradientCss(f.design, { gradient: ["ink", "teal"], angle: 160 }, f.design.ink)).toBe("linear-gradient(160deg, #12151A 0%, #3FB9A8 100%)");
    expect(gradientCss(f.design, { gradient: ["accent", "rose"], radial: true, at: { x: 0.3, y: 0.4 } }, f.design.ink)).toBe("radial-gradient(circle at 30% 40%, #F2B441 0%, #E86F7A 100%)");
    expect(paintOf(f.design, "accent", "#000")).toBe("#F2B441");
    // one flat colour for everything that cannot paint a gradient
    expect(flatOf(f.design, { gradient: ["teal", "rose"] }, "#000")).toBe("#3FB9A8");
    expect(colorOf(f.design, { gradient: ["rose", "ink"] } as never)).toBe("#E86F7A");
  });
  test("two gradients of the same shape mix stop by stop, different shapes crossfade", () => {
    const f = film();
    const same = colorTrackAt(f, [{ at: 0, v: { gradient: ["ink", "teal"] } }, { at: 10, v: { gradient: ["ink", "rose"] }, ease: "linear" }], 5, "#000");
    expect(same.css.startsWith("linear-gradient(")).toBe(true);
    expect(same.css.split(",").length).toBe(3);
    expect(same.between).toBe(true);
    const cross = colorTrackAt(f, [{ at: 0, v: { gradient: ["ink", "teal"] } }, { at: 10, v: { gradient: ["accent", "rose"], radial: true }, ease: "linear" }], 5, "#000");
    expect(cross.css).toContain("radial-gradient(");
    expect(cross.css).toContain("linear-gradient(");
    expect(cross.css).toContain("rgba(");
  });
});

describe("colour tracks", () => {
  test("a layer's colour at a frame, and the frames that are a mix", () => {
    const f = film();
    const s = f.scenes[0];
    const l = s.layers[0];
    expect(layerPaint(f, s, l, "color", 0, f.design.ink)).toMatchObject({ css: "#F2EEE6", animated: false });
    expect(layerPaint(f, s, l, "color", 40, f.design.ink)).toMatchObject({ css: "#F2B441", animated: false });
    const mid = layerPaint(f, s, l, "color", 20, f.design.ink);
    expect(mid.animated).toBe(true);
    expect(mid.css).not.toBe("#F2EEE6");
    expect(mid.css).not.toBe("#F2B441");
    // a layer without a track answers with its own value
    expect(layerPaint(f, s, s.layers[1], "fill", 20, f.design.accent)).toMatchObject({ gradient: true, animated: false });
  });
  test("the ground follows its track and still names one flat colour", () => {
    const f = film();
    const s = f.scenes[0];
    expect(groundPaint(f, s, 0).css).toBe("#12151A");
    expect(groundPaint(f, s, 60).css).toBe("#3FB9A8");
    expect(groundPaint(f, s, 30).animated).toBe(true);
    // the flat colour the contrast lint reads is always a declared one, never the mix
    expect(groundFlat(f, s, 0)).toBe("#12151A");
    expect(groundFlat(f, s, 20)).toBe("#12151A");
    expect(groundFlat(f, s, 45)).toBe("#3FB9A8");
  });
  test("the lint checks every stop and every key", () => {
    const f = film();
    expect(lintFilm(f)).toEqual([]);
    const bad = film();
    (bad.scenes[0].layers[1] as { fill: unknown }).fill = { gradient: ["accent", "mauve"] };
    bad.scenes[0].layers[0].colorTracks = { color: [{ at: 0, v: "paper" }, { at: 20, v: "nope" }] };
    bad.scenes[0].groundTracks = [{ at: 0, v: { gradient: ["ink"] } }];
    const rules = lintFilm(bad).map((x) => `${x.rule}:${x.where}`);
    expect(rules).toContain("color:one.box.fill");
    expect(rules).toContain("color:one.line.colorTracks.color@20");
    expect(rules).toContain("color:one.groundTracks@0");
  });
});

describe("effects", () => {
  const fx = (): MgFilm => {
    const f = film();
    f.scenes[0].layers[0].effects = { shadow: { y: 20, blur: 50, alpha: 0.3 }, glow: { color: "accent", blur: 30, alpha: 0.5 }, blend: "screen" };
    return f;
  };
  test("shadow and glow become drop-shadows, a stroke knows text from a box", () => {
    const f = fx();
    const l = f.scenes[0].layers[0];
    const filter = filterOf(f, l.effects, 2);
    expect(filter).toBe("drop-shadow(0px 40px 100px rgba(0, 0, 0, 0.3)) drop-shadow(0 0 20px rgba(242, 180, 65, 0.5)) drop-shadow(0 0 60px rgba(242, 180, 65, 0.5))");
    expect(effectStyle(f, l, 1)).toMatchObject({ mixBlendMode: "screen" });
    expect(strokeStyle(f, { stroke: { color: "ink", width: 3 } }, 2, true)).toMatchObject({ WebkitTextStrokeWidth: "6px", WebkitTextStrokeColor: "#12151A" });
    expect(strokeStyle(f, { stroke: { color: "ink", width: 3 } }, 2, false)).toMatchObject({ boxShadow: "0 0 0 6px #12151A" });
    expect(gradientTextOf({ gradientText: ["accent", "rose"] })).toMatchObject({ gradient: ["accent", "rose"], angle: 90 });
  });
  test("the highlight sweeps after the layer has settled", () => {
    const f = film();
    const s = f.scenes[0];
    const l = s.layers[0];
    l.effects = { highlight: { color: "accent", pad: 8, only: "marks" } };
    // in at 0 for 10 frames, so the marker starts at 14
    expect(highlightAt(f, s, l, 12, 1)!.progress).toBe(0);
    expect(highlightAt(f, s, l, 26, 1)!.progress).toBe(1);
    const mid = highlightAt(f, s, l, 20, 1)!;
    expect(mid.progress).toBeGreaterThan(0);
    expect(mid.progress).toBeLessThan(1);
    expect(mid.style.backgroundSize).toBe(`${mid.progress * 100}% 100%`);
    expect(mid.only).toBe("marks");
    l.effects = { highlight: { in: { at: 40, dur: 10 }, only: "all" } };
    expect(highlightAt(f, s, l, 39, 1)!.progress).toBe(0);
    expect(highlightAt(f, s, l, 50, 1)!.progress).toBe(1);
  });
  test("what a layer tells the lints about itself", () => {
    const f = film();
    expect(lintFlags(f.scenes[0].layers[0])).toBe("color-track");
    expect(lintFlags({ id: "p", type: "particles", probe: false, count: 40 })).toBe("none no-collision");
    expect(lintFlags(f.scenes[0].layers[1])).toBeUndefined();
  });
  test("the lint reads the effects", () => {
    const f = film();
    f.scenes[0].layers[0].effects = { glow: { color: "nope" }, blend: "sideways", gradientText: ["accent"], shine: 1 } as never;
    const rules = lintFilm(f).map((x) => `${x.rule}:${x.where}`);
    expect(rules).toContain("effect:one.line.effects.shine");
    expect(rules).toContain("effect:one.line.effects.blend");
    expect(rules).toContain("color:one.line.effects.glow");
    expect(rules).toContain("effect:one.line.effects.gradientText");
    f.scenes[0].layers[1].effects = { highlight: { color: "accent" } };
    expect(lintFilm(f).map((x) => `${x.rule}:${x.where}`)).toContain("effect:one.box.effects.highlight");
  });
});

describe("text presets", () => {
  test("the new presets write the tracks they need", () => {
    expect(inTracks({ preset: "flip", dur: 14 })).toEqual({});
    expect(inTracks({ preset: "track", dur: 12 })).toEqual({ opacity: [{ at: 0, v: 0 }, { at: 12, v: 1, ease: "out" }] });
    expect(inTracks({ preset: "line-wipe", dur: 12 })).toEqual({ wipe: [{ at: 0, v: 0 }, { at: 12, v: 1, ease: "out" }] });
    const fall = inTracks({ preset: "fall", dur: 16, distance: 20 });
    expect(fall.y![0].v).toBe(-32);
    expect(fall.y![1]).toMatchObject({ at: 16, v: 0, ease: "bouncy" });
  });
  test("a line wipe reveals from its side and every line waits its turn", () => {
    const f = film();
    const s = f.scenes[0];
    const l = s.layers[0] as TextLayer;
    l.text = "one\ntwo\nthree";
    l.in = { preset: "line-wipe", at: 0, dur: 10, from: "left", stagger: { by: "line", each: 6 } };
    expect(poseAt(f, s, l, 5).wipeFrom).toBe("left");
    expect(poseAt(f, s, l, 5).wipe).toBeGreaterThan(0);
    expect(poseAt(f, s, l, 5).wipe).toBeLessThan(1);
    // the third line starts twelve frames after the first
    expect(poseAt(f, s, l, 5, staggerDelay(l.in.stagger, 2, 3)).wipe).toBe(0);
    expect(poseAt(f, s, l, 24, staggerDelay(l.in.stagger, 2, 3)).wipe).toBe(1);
  });
  test("scramble resolves left to right and draws the same frame the same way", () => {
    const text = "PLAN THE WEEK";
    expect(scrambleText(text, 1, 40)).toBe(text);
    expect(scrambleText(text, 0.5, 40).slice(0, 6)).toBe("PLAN T");
    expect(scrambleText(text, 0.5, 40)).not.toBe(text);
    expect(scrambleText(text, 0.5, 40)).toBe(scrambleText(text, 0.5, 40));
    // two frames apart the noise moves, the resolved part does not
    expect(scrambleText(text, 0.5, 44)).not.toBe(scrambleText(text, 0.5, 40));
    expect(scrambleText(text, 0.5, 44).slice(0, 6)).toBe("PLAN T");
    // spaces stay spaces, the length never changes
    expect(scrambleText(text, 0, 7).length).toBe(text.length);
    expect(scrambleText(text, 0, 7)[4]).toBe(" ");
  });
  test("a layer's own progress, per staggered unit", () => {
    const f = film();
    const s = f.scenes[0];
    const l = s.layers[0] as TextLayer;
    l.in = { preset: "flip", at: 0, dur: 10, ease: "linear", stagger: { by: "char", each: 2 } };
    expect(inProgress(f, s, l, 0)).toBe(0);
    expect(inProgress(f, s, l, 5)).toBeCloseTo(0.5, 5);
    expect(inProgress(f, s, l, 20)).toBe(1);
    expect(inProgress(f, s, l, 5, staggerDelay(l.in.stagger, 2, 6))).toBeCloseTo(0.1, 5);
  });
});

describe("shapes and charts", () => {
  test("a polygon, a star and an arrow are points on a circle", () => {
    const tri = polygonPath(50, 50, 40, 3);
    expect(tri.startsWith("M50,10L")).toBe(true);
    expect(tri.endsWith("Z")).toBe(true);
    expect(tri.split("L").length).toBe(3);
    const star = starPath(50, 50, 40, 5, 0.5);
    expect(star.split("L").length).toBe(10);
    expect(polygonPath(50, 50, 40, 1).split("L").length).toBe(3);
    expect(arrowBox(200, 30, 6)).toEqual([206, 36]);
    expect(arrowPath(200, 30, 6)).toBe("M3,18 L182,18 M167,3 L185,18 L167,33");
  });
  test("a line chart maps its values into its box and closes its area", () => {
    const g = chartGeometry([0, 5, 10], 100, 50, { min: 0, max: 10 });
    expect(g.points).toEqual([{ x: 0, y: 50 }, { x: 50, y: 25 }, { x: 100, y: 0 }]);
    expect(g.line).toBe("M0,50 L50,25 L100,0");
    expect(g.area.endsWith("L100,50 L0,50 Z")).toBe(true);
    const smooth = chartGeometry([0, 5, 2, 8], 90, 60, { smooth: true });
    expect(smooth.line).toContain(" C");
    const explicit = chartGeometry([{ x: 0, y: 2 }, { x: 3, y: 6 }], 60, 30);
    expect(explicit.points[1]).toEqual({ x: 60, y: 0 });
  });
  test("rings sit inside each other", () => {
    const a = ringGeometry(0, 300, 30, 10);
    const b = ringGeometry(1, 300, 30, 10);
    expect(a.r).toBe(135);
    expect(b.r).toBe(95);
    expect(a.c).toBeCloseTo(2 * Math.PI * 135, 5);
  });
  test("a drawn outline follows its progress", () => {
    expect(drawnProgress(undefined, false, 1, 0.4)).toBe(0.4);
    expect(drawnProgress(0.5, false, 1, 1)).toBe(0.5);
    expect(drawnProgress(undefined, true, 0.25, 1)).toBe(0.25);
    expect(drawnProgress(1, true, 2, 1)).toBe(1);
  });
  test("an odometer keeps its columns and rolls the last one", () => {
    expect(padDigits("40", 3)).toBe("040");
    expect(padDigits("1,240", 6)).toBe("001,240");
    expect(padDigits("40 ms", undefined)).toBe("40 ms");
    const cells = odometerCells(1240, "1,240");
    expect(cells.map((c) => c.char).join("")).toBe("1,240");
    expect(cells.filter((c) => c.digit).length).toBe(4);
    expect(cells[1].digit).toBe(false);
    // the last column shows the value itself, the ones above it their own place
    expect(odometerCells(7, "40")[1].offset).toBe(7);
    expect(odometerCells(7, "40")[0].offset).toBe(0);
    expect(odometerCells(37, "40")[0].offset).toBe(3);
    expect(odometerCells(37, "40")[1].offset).toBe(7);
    // a column holds its digit for most of the step and then flips, so a still frame shows whole numbers
    expect(odometerCells(37.5, "40")[1].offset).toBe(7);
    expect(odometerCells(37.9, "40")[1].offset).toBeCloseTo(7.5, 5);
    expect(odometerCells(39.9, "40")[0].offset).toBeCloseTo(3.95, 2);
    expect(odometerCells(1240, "1,240").filter((c) => c.digit).map((c) => c.offset)).toEqual([1, 2, 4, 0]);
  });
});

describe("particles", () => {
  test("the same frame draws the same field, another seed another one", () => {
    const f = { count: 40, seed: 3, size: 8, speed: 1.2, spread: 20 };
    const a = particlesAt(f, 120, { w: 1920, h: 1080 });
    const b = particlesAt(f, 120, { w: 1920, h: 1080 });
    expect(a).toEqual(b);
    expect(a.length).toBe(40);
    expect(particlesAt({ ...f, seed: 4 }, 120, { w: 1920, h: 1080 })).not.toEqual(a);
    expect(particlesAt(f, 121, { w: 1920, h: 1080 })).not.toEqual(a);
  });
  test("every particle stays in its box and the count is capped", () => {
    const parts = particlesAt({ count: 900, seed: 1 }, 400, { w: 800, h: 600 });
    expect(parts.length).toBe(MAX_PARTICLES);
    for (const p of parts) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(800);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(600);
      expect(p.opacity).toBeLessThanOrEqual(1);
    }
    expect(rng(7)()).toBe(rng(7)());
  });
  test("the lint counts them and asks for the layer to stay out of the way", () => {
    const f = film();
    f.scenes[0].layers.push({ id: "dust", type: "particles", count: 900, shape: "sparks" as never });
    const rules = lintFilm(f).map((x) => `${x.rule}:${x.where}`);
    expect(rules).toContain("particles:one.dust.count");
    expect(rules).toContain("particles:one.dust.shape");
    expect(rules).toContain("particles:one.dust");
  });
});
