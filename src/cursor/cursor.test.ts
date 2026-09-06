import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compile, defineTimeline } from "../timeline/schema.ts";
import { planLegs, parkTarget, parkX, targetsModule, writeTargets } from "./cursor.ts";

const c = compile(
  defineTimeline({
    fps: 30,
    parts: [
      { id: "a", composition: "a", scenes: [{ id: "one", dur: 30, enter: "cut" }] },
      { id: "b", composition: { wide: "b-wide" }, scenes: [{ id: "probe", dur: 60, enter: "cut", events: { pick2: 20 } }, { id: "exam", dur: 40, enter: "cut", events: { build: 10 } }] },
    ],
  }),
);

describe("cursor legs", () => {
  test("refs resolve to part frames, park is flagged", () => {
    const legs = planLegs(c, [["probe.pick2", "blank"], ["exam.build+16", "build"], ["exam.build+20", "park"]]);
    expect(legs.map((l) => [l.part, l.partFrame, l.park])).toEqual([["b", 20, false], ["b", 86, false], ["b", 90, true]]);
    expect(legs[0].filmFrame).toBe(50);
  });
  test("a bad ref or key names the leg", () => {
    expect(() => planLegs(c, [["probe.nope", "x"]])).toThrow(/leg #0 "probe.nope": scene "probe" has no event/);
    const hover = planLegs(c, [["probe.pick2", "blank?"]])[0];
    expect(hover.key).toBe("blank");
    expect(hover.hover).toBe(true);
    expect(hover.park).toBe(false);
    expect(() => planLegs(c, [["probe.pick2", "?"]])).toThrow(/before "\?"/);
    expect(() => planLegs(c, [["probe", ""]])).toThrow(/leg #0 must be \[ref, key\]/);
    expect(() => planLegs(c, [["probe"] as any])).toThrow(/leg #0/);
  });
  test("park sits off frame beside the previous target", () => {
    const [leg] = planLegs(c, [["exam.build+16", "park"]]);
    expect(parkX(1920)).toBe(2040);
    expect(parkX(1080, "left")).toBe(-120);
    expect(parkTarget(leg, { id: "x", frame: 1, x: 500, y: 700, click: true }, 2040)).toEqual({ id: "exam.build+16 park", frame: 86, x: 2040, y: 560, click: false });
    expect(parkTarget(leg, undefined, 2040).y).toBe(400);
  });
});

describe("targets module", () => {
  const targets = [
    { id: "probe.pick2 -> blank", frame: 20, x: 843, y: 440, click: true },
    { id: "probe.pick2+16 park", frame: 36, x: 2040, y: 300, click: false },
  ];
  test("exports CURSOR_TARGETS with the film's shape", () => {
    const src = targetsModule(targets);
    expect(src).toContain("export const CURSOR_TARGETS: CursorTarget[] = ");
    expect(JSON.parse(src.slice(src.indexOf("= [") + 2, src.lastIndexOf("];") + 1))).toEqual(targets);
  });
  test("writes the file, creating the directory", () => {
    const file = join(mkdtempSync(join(tmpdir(), "mh-cursor-")), "gen", "cursor-targets.ts");
    expect(writeTargets(file, targets).changed).toBe(true);
    expect(readFileSync(file, "utf8")).toBe(targetsModule(targets));
    expect(writeTargets(file, targets).changed).toBe(false);
  });
});
