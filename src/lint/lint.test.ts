import { describe, expect, test } from "bun:test";
import { compile, defineTimeline } from "../timeline/schema.ts";
import type { ProbeResult } from "../render/frames.ts";
import { lintOverflow, lintWrap, lintCollision, lintSameTop, lintFormatParity, cursorLegFrames, type LayoutItem, type ProbeFrame } from "./lint.ts";

const item = (o: Partial<LayoutItem> & { key: string }): LayoutItem => ({
  kind: "probe",
  tag: "div",
  x: 0,
  y: 0,
  w: 100,
  h: 40,
  visible: true,
  opacity: 1,
  color: "rgb(0, 0, 0)",
  bg: "rgba(0, 0, 0, 0)",
  fontSize: "32px",
  fontWeight: "400",
  fontFamily: "Inter",
  text: "",
  ancestors: [],
  lineHeight: "40px",
  brs: 0,
  ...o,
});

const probe = (items: LayoutItem[], viewport = { w: 1920, h: 1080 }): ProbeResult => {
  items.forEach((it, i) => (it.id = it.id ?? i));
  return { viewport, items, colors: [] };
};

describe("overflow", () => {
  test("boxes leaving the frame by more than 2px, with side and px", () => {
    const fs = lintOverflow("card+12", probe([
      item({ key: "ok", x: 10, y: 10, w: 100, h: 40 }),
      item({ key: "edge", x: -2, y: 0, w: 1922, h: 40 }),
      item({ key: "left", x: -30, y: 100, w: 200, h: 40 }),
      item({ key: "bottom", x: 0, y: 1060, w: 200, h: 60 }),
      item({ key: "hidden", x: -300, y: 0, w: 200, h: 40, opacity: 0.03 }),
    ]));
    expect(fs.map((f) => f.where)).toEqual(["card+12 left", "card+12 bottom"]);
    expect(fs[0].message).toContain("left by 30px");
    expect(fs[1].message).toContain("bottom by 40px");
    expect(fs.every((f) => f.rule === "overflow" && f.level === "error")).toBe(true);
  });
});

describe("wrap", () => {
  test("text taller than lineHeight * expected lines + 4px", () => {
    const fs = lintWrap("line1+10", probe([
      item({ key: "text:one line", kind: "text", text: "one line", h: 42 }),
      item({ key: "text:two lines", kind: "text", text: "two lines", h: 80 }),
      item({ key: "text:with br", kind: "text", text: "with br", h: 80, brs: 1 }),
      item({ key: "headline", text: "declared two, got three", h: 120, lines: 2 }),
      item({ key: "text:declared ok", kind: "text", text: "declared ok", h: 80, lines: 2 }),
      item({ key: "text:invisible", kind: "text", text: "invisible", h: 200, visible: false }),
      item({ key: "box", text: "", h: 400 }),
    ]));
    expect(fs.map((f) => [f.where, f.level])).toEqual([
      ["line1+10 text:two lines", "warn"],
      ["line1+10 headline", "error"],
    ]);
    expect(fs[0].message).toContain("wraps to 2 lines, expected 1");
    expect(fs[1].message).toContain("wraps to 3 lines, declared 2");
  });
  test("falls back to fontSize * 1.2 when lineHeight is normal", () => {
    const fs = lintWrap("s+0", probe([item({ key: "text:x", kind: "text", text: "x", lineHeight: "normal", fontSize: "50px", h: 130 })]));
    expect(fs).toHaveLength(1);
    expect(fs[0].message).toContain("line 60px");
  });
});

describe("collision", () => {
  test("overlap over 4px on both axes, parents excluded", () => {
    const card = item({ key: "card", id: 0, x: 100, y: 100, w: 600, h: 400 });
    const title = item({ key: "text:Title", id: 1, kind: "text", text: "Title", x: 140, y: 140, w: 300, h: 40, ancestors: [0] });
    const mark = item({ key: "mark", id: 2, x: 120, y: 500, w: 40, h: 40 });
    const line = item({ key: "line", id: 3, x: 100, y: 510, w: 600, h: 20 });
    const chip = item({ key: "chip-a", id: 4, x: 800, y: 100, w: 100, h: 40 });
    const chip2 = item({ key: "chip-b", id: 5, x: 896, y: 100, w: 100, h: 40 });
    const label = item({ key: "text:loose", id: 6, kind: "text", text: "loose", x: 120, y: 120, w: 200, h: 30 });
    const ghost = item({ key: "ghost", id: 7, x: 100, y: 100, w: 600, h: 400, visible: false });
    const fs = lintCollision("map+12", probe([card, title, mark, line, chip, chip2, label, ghost]));
    expect(fs.map((f) => f.where + " / " + f.message)).toEqual([
      'map+12 card / overlaps "text:loose" by 200x30px',
      'map+12 mark / overlaps "line" by 40x20px',
    ]);
    expect(fs.every((f) => f.rule === "collision" && f.level === "error")).toBe(true);
  });
  test("two text elements never collide with each other", () => {
    const fs = lintCollision("s+0", probe([
      item({ key: "text:a", kind: "text", text: "a", x: 0, y: 0, w: 100, h: 40 }),
      item({ key: "text:b", kind: "text", text: "b", x: 10, y: 10, w: 100, h: 40 }),
    ]));
    expect(fs).toEqual([]);
  });
});

const demoFilm = compile(
  defineTimeline({
    fps: 30,
    parts: [
      {
        id: "product",
        composition: { wide: "p-wide", vertical: "p-vertical" },
        enterFrames: 12,
        scenes: [
          { id: "intro", dur: 40, enter: "cut" },
          { id: "card", dur: 60, enter: "fade", stage: "demo", probes: ["stage", "card"] },
          { id: "map", dur: 60, enter: "fade", stage: "demo", probes: ["stage", "map"] },
          { id: "exam", dur: 60, enter: "fade", stage: "demo", probes: ["stage"] },
        ],
      },
    ],
  }),
);

const frame = (sceneId: string, local: number, items: LayoutItem[]): ProbeFrame => {
  const s = demoFilm.scenes.find((x) => x.id === sceneId)!;
  return { label: `${sceneId}+${local}`, sceneId, local, partFrame: s.start + local, probe: probe(items) };
};

describe("same-top", () => {
  test("demo scenes share the stage top within 3px, outliers reported", () => {
    const fs = lintSameTop(demoFilm, [
      frame("intro", 0, [item({ key: "stage", y: 900 })]),
      frame("card", 0, [item({ key: "stage", y: 500 })]),
      frame("card", 12, [item({ key: "stage", y: 240 })]),
      frame("map", 12, [item({ key: "stage", y: 242 })]),
      frame("exam", 12, [item({ key: "stage", y: 260 })]),
    ]);
    expect(fs).toHaveLength(1);
    expect(fs[0].where).toBe("exam+12 stage");
    expect(fs[0].level).toBe("error");
    expect(fs[0].message).toContain("stage top 260px, the other demo scenes sit at 242px");
  });
  test("a demo scene without a stage probe is a warning, nothing else", () => {
    const fs = lintSameTop(demoFilm, [
      frame("card", 12, [item({ key: "stage", y: 240 })]),
      frame("map", 12, [item({ key: "stage", y: 240 })]),
      frame("exam", 12, [item({ key: "card", y: 240 })]),
    ]);
    expect(fs.map((f) => [f.level, f.where])).toEqual([["warn", "exam+12 stage"]]);
  });
});

describe("format-parity", () => {
  test("visible probe keys must match across formats at the settled frame", () => {
    const fs = lintFormatParity(demoFilm, {
      wide: [frame("card", 12, [item({ key: "stage" }), item({ key: "card" }), item({ key: "bo" })])],
      vertical: [frame("card", 12, [item({ key: "stage" }), item({ key: "card" }), item({ key: "bo", visible: false })])],
    });
    expect(fs).toHaveLength(1);
    expect(fs[0].where).toBe("card bo");
    expect(fs[0].message).toBe("visible in wide but not in vertical");
  });
  test("cursor legs need a visible cursor in every format", () => {
    const legs = cursorLegFrames(demoFilm, { cursor: { legs: [{ from: "card+20", to: "card+40" }, { at: "nowhere.ever" }] } });
    expect(legs.map((l) => l.partFrame)).toEqual([60, 80]);
    const fs = lintFormatParity(
      demoFilm,
      {
        wide: [frame("card", 20, [item({ key: "cursor" })]), frame("card", 40, [item({ key: "cursor" })])],
        vertical: [frame("card", 20, [item({ key: "cursor", visible: false, opacity: 0 })])],
      },
      legs,
    );
    expect(fs.map((f) => [f.level, f.where])).toEqual([
      ["error", "card cursor@card+20"],
      ["warn", "card cursor@card+40"],
    ]);
    expect(fs[0].message).toContain("cursor not visible in vertical");
  });
  test("no film cursor block, no legs", () => {
    expect(cursorLegFrames(demoFilm, {})).toEqual([]);
    expect(cursorLegFrames(demoFilm, undefined)).toEqual([]);
  });
});
