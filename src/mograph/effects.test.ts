import { describe, expect, test } from "bun:test";
import type { MgFilm } from "./schema.ts";
import { colorOf } from "./schema.ts";
import { colorTrackAt, flatOf, gradientCss, groundFlat, groundPaint, layerPaint, mixHex, oklabToRgb, paintOf, rgbToOklab, toHex, toRgb } from "./colour.ts";
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
