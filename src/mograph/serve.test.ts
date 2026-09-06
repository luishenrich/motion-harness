import { describe, expect, test } from "bun:test";
import type { MgFilm } from "./schema.ts";
import { applyOp, editorPage, opLabel, resolveNested } from "./serve.ts";

const film = (): MgFilm =>
  ({
    title: "t",
    fps: 30,
    design: { ink: "#101010", paper: "#F5F1E8", accent: "#F2B441", colors: { teal: "#3FB9A8" } },
    formats: { wide: { width: 1920, height: 1080 }, vertical: { width: 1080, height: 1920 } },
    scenes: [
      {
        id: "hook",
        dur: 90,
        ground: "ink",
        layers: [
          { id: "line", type: "text", text: "One", size: 96, color: "paper", at: { x: 0.5, y: 0.4 }, in: { preset: "rise", at: 4, dur: 16 }, tracks: { y: [{ at: 0, v: 40 }, { at: 20, v: 0, ease: "out" }] } },
          { id: "card", type: "group", at: { x: 0.5, y: 0.5 }, w: 900, h: 520, layers: [{ id: "title", type: "text", text: "In a group", size: 64, at: { x: 0.5, y: 0.3 } }] },
        ],
      },
    ],
  }) as unknown as MgFilm;

describe("the editor's ops", () => {
  test("a batch is one change made of many", () => {
    const f = applyOp(film(), { op: "batch", name: "align", ops: [{ op: "set", addr: "hook.line.at", value: { x: 0.2, y: 0.4 } }, { op: "set", addr: "hook.line.size", value: 80 }] });
    const l = f.scenes[0].layers[0] as { at: { x: number }; size: number };
    expect(l.at.x).toBe(0.2);
    expect(l.size).toBe(80);
    expect(opLabel({ op: "batch", name: "align", ops: [] })).toBe("batch align(0)");
  });

  test("a keyframe moved keeps its value and its easing", () => {
    const f = applyOp(film(), { op: "move-key", addr: "hook.line.y", from: 20, to: 34 });
    const keys = (f.scenes[0].layers[0] as { tracks: { y: { at: number; v: number; ease?: string }[] } }).tracks.y;
    expect(keys.map((k) => k.at)).toEqual([0, 34]);
    expect(keys[1]).toMatchObject({ v: 0, ease: "out" });
    expect(() => applyOp(film(), { op: "move-key", addr: "hook.line.y", from: 99, to: 1 })).toThrow(/no keyframe at 99/);
  });

  test("a group child is addressed scene.group.child and written through the index path", () => {
    const f = film();
    expect(resolveNested(f, "hook.card.title.size")).toBe("hook.card.layers.0.size");
    expect(resolveNested(f, "hook.line.size")).toBe("hook.line.size");
    expect(resolveNested(f, "hook.dur")).toBe("hook.dur");
    const after = applyOp(film(), { op: "set", addr: "hook.card.title.size", value: 70 });
    const kids = (after.scenes[0].layers[1] as unknown as { layers: { size: number }[] }).layers;
    expect(kids[0].size).toBe(70);
    // and nothing was invented on the group itself
    expect((after.scenes[0].layers[1] as unknown as Record<string, unknown>).title).toBeUndefined();
  });

  test("removing a group child takes it out of its parent, not the scene", () => {
    const after = applyOp(film(), { op: "remove", addr: "hook.card.title" });
    expect(after.scenes[0].layers.length).toBe(2);
    expect((after.scenes[0].layers[1] as unknown as { layers: unknown[] }).layers.length).toBe(0);
  });

  test("replace swaps the whole film, the way undo does", () => {
    const a = film();
    a.title = "other";
    expect(applyOp(film(), { op: "replace", film: a }).title).toBe("other");
  });
});

describe("the editor page", () => {
  const html = editorPage({ title: "Eyes and hands (spot)" });
  test("carries the surfaces the editor promises", () => {
    for (const id of ["strip", "mh-state", "history", "undoBtn", "redoBtn", "fmtOnly", "al-left", "al-dist-v", "sceneForm", "quick", "findings", "layers", "mh-tokens"]) expect(html).toContain(`id="${id}"`);
    expect(html).toContain("window.mhEdit");
    for (const fn of ["state:state", "select:", "set:", "op:", "frame:", "play:", "reload:", "selection:", "undo:undoOnce", "redo:redoOnce"]) expect(html).toContain(fn);
  });
  test("every control says what it is and the focus is visible", () => {
    expect(html).toContain(":focus-visible");
    const controls = html.match(/<(button|select|input|textarea)\b[^>]*>/g) ?? [];
    // the layer JSON has a visually hidden <label for>, everything else says what it is
    const unlabelled = controls.filter((c) => !/aria-label=/.test(c) && !/id="json"/.test(c));
    expect(unlabelled).toEqual([]);
  });
  test("escapes the title it is given", () => {
    expect(editorPage({ title: '<script>"x"' })).toContain("&lt;script&gt;&quot;x&quot;");
  });
});
