/** the shim's math against Remotion's own package: same inputs, same numbers */
import { describe, expect, test } from "bun:test";
import * as R from "remotion";
import { interpolate, spring, Easing, random, staticFile, measureSpring } from "./shim/remotion.tsx";

const inputs = Array.from({ length: 61 }, (_, i) => -5 + i * 0.5);

describe("interpolate", () => {
  test("clamp, extend, easing, multi-segment", () => {
    for (const x of inputs) {
      expect(interpolate(x, [0, 10], [0, 100], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })).toBe(R.interpolate(x, [0, 10], [0, 100], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
      expect(interpolate(x, [0, 10], [5, -5])).toBe(R.interpolate(x, [0, 10], [5, -5]));
      expect(interpolate(x, [0, 4, 10, 20], [0, 1, 0, 3], { extrapolateLeft: "wrap", extrapolateRight: "identity" })).toBe(R.interpolate(x, [0, 4, 10, 20], [0, 1, 0, 3], { extrapolateLeft: "wrap", extrapolateRight: "identity" }));
      expect(interpolate(x, [0, 10], [0, 1], { easing: Easing.out(Easing.cubic), extrapolateLeft: "clamp", extrapolateRight: "clamp" })).toBeCloseTo(R.interpolate(x, [0, 10], [0, 1], { easing: R.Easing.out(R.Easing.cubic), extrapolateLeft: "clamp", extrapolateRight: "clamp" }), 12);
      expect(interpolate(x, [0, 10], [0, 1], { easing: Easing.bezier(0.2, 0.8, 0.3, 1), extrapolateLeft: "clamp", extrapolateRight: "clamp" })).toBeCloseTo(R.interpolate(x, [0, 10], [0, 1], { easing: R.Easing.bezier(0.2, 0.8, 0.3, 1), extrapolateLeft: "clamp", extrapolateRight: "clamp" }), 12);
    }
  });
  test("tuples and posterize", () => {
    expect(interpolate(3, [0, 10], [[0, 0], [10, 20]])).toEqual([...R.interpolate(3, [0, 10], [[0, 0], [10, 20]])]);
    expect(interpolate(3.7, [0, 10], [0, 10], { posterize: 1 })).toBe(R.interpolate(3.7, [0, 10], [0, 10], { posterize: 1 }));
    expect(() => interpolate(1, [0, 1, 1], [0, 1, 2])).toThrow(/monotonically/);
  });
});

describe("Easing", () => {
  test("every curve matches over [-0.5, 1.5]", () => {
    const pairs: [string, (t: number) => number, (t: number) => number][] = [
      ["out cubic", Easing.out(Easing.cubic), R.Easing.out(R.Easing.cubic)],
      ["inOut cubic", Easing.inOut(Easing.cubic), R.Easing.inOut(R.Easing.cubic)],
      ["in quad", Easing.in(Easing.quad), R.Easing.in(R.Easing.quad)],
      ["bezier", Easing.bezier(0.42, 0, 0.58, 1), R.Easing.bezier(0.42, 0, 0.58, 1)],
      ["elastic", Easing.elastic(1.5), R.Easing.elastic(1.5)],
      ["bounce", Easing.bounce, R.Easing.bounce],
      ["back", Easing.back(2), R.Easing.back(2)],
      ["ease", Easing.ease, R.Easing.ease],
      ["sin", Easing.sin, R.Easing.sin],
      ["circle", Easing.circle, R.Easing.circle],
      ["exp", Easing.exp, R.Easing.exp],
      ["poly", Easing.poly(4), R.Easing.poly(4)],
      ["step0", Easing.step0, R.Easing.step0],
      ["step1", Easing.step1, R.Easing.step1],
    ];
    for (const [, a, b] of pairs) for (let t = -0.5; t <= 1.5; t += 0.05) expect(a(t)).toBeCloseTo(b(t), 12);
  });
});

describe("spring", () => {
  test("default config, custom config, from/to, durationInFrames, delay, reverse, clamping", () => {
    const configs = [{}, { damping: 200 }, { damping: 12, stiffness: 180, mass: 0.6 }, { damping: 8, stiffness: 100, overshootClamping: true }];
    for (const config of configs) {
      for (let frame = -2; frame <= 80; frame += 1) {
        expect(spring({ frame, fps: 30, config })).toBeCloseTo(R.spring({ frame, fps: 30, config }), 12);
        expect(spring({ frame, fps: 30, config, from: 10, to: -4 })).toBeCloseTo(R.spring({ frame, fps: 30, config, from: 10, to: -4 }), 12);
        expect(spring({ frame, fps: 30, config, durationInFrames: 24 })).toBeCloseTo(R.spring({ frame, fps: 30, config, durationInFrames: 24 }), 12);
        expect(spring({ frame, fps: 30, config, delay: 6 })).toBeCloseTo(R.spring({ frame, fps: 30, config, delay: 6 }), 12);
        expect(spring({ frame, fps: 30, config, reverse: true, durationInFrames: 30 })).toBeCloseTo(R.spring({ frame, fps: 30, config, reverse: true, durationInFrames: 30 }), 12);
      }
      expect(measureSpring({ fps: 30, config })).toBe(R.measureSpring({ fps: 30, config }));
    }
    expect(spring({ frame: 12.5, fps: 30 })).toBeCloseTo(R.spring({ frame: 12.5, fps: 30 }), 12);
  });
});

describe("random and staticFile", () => {
  test("seeded random matches", () => {
    for (const seed of ["f12", "imp-3-x", "a", "", "forgets what you know", 0, 1, 42, 12345, 0.5]) expect(random(seed)).toBe(R.random(seed));
  });
  test("staticFile encodes segments", () => {
    expect(staticFile("brands/claude.svg")).toBe(R.staticFile("brands/claude.svg"));
    expect(staticFile("/music/a b.mp3")).toBe(R.staticFile("/music/a b.mp3"));
  });
});
