import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Layer, MgFilm, MgScene } from "./schema.ts";
import { lintFilm } from "./edit.ts";
import { normalizeFilm } from "./script.ts";
import { TEMPLATES, buildScene, coerceParams, expandTemplates, groundIsLight, paletteFor, parseList, parsePairs, resolveTemplate, templateNames, uniqueId } from "./templates.ts";
import { commands } from "./cli-templates.ts";

const film = (scenes: MgScene[]): MgFilm => ({
  title: "templates",
  fps: 30,
  design: { ink: "#12161F", paper: "#F4F1EA", accent: "#C05621", muted: "#6A707A", colors: { teal: "#1F7A6C" } },
  formats: { wide: { width: 1920, height: 1080 }, vertical: { width: 1080, height: 1920 } },
  defaults: { enterFrames: 0, layerIn: { preset: "rise", dur: 14, ease: "out" } },
  scenes,
  audio: [],
});

const findings = (scene: MgScene) => lintFilm(film([scene]));
const errors = (scene: MgScene) => findings(scene).filter((f) => f.level === "error");

describe("templates", () => {
  test("the fifteen the roadmap asks for are there", () => {
    expect(templateNames()).toEqual(["title", "statement", "stat", "list", "compare", "quote", "lower-third", "chart", "logo", "cta", "steps", "split", "kinetic", "countdown", "end-card"]);
    expect(resolveTemplate("bullets")?.name).toBe("list");
    expect(resolveTemplate("outro")?.name).toBe("end-card");
    expect(resolveTemplate("nothing")).toBeUndefined();
  });

  test("every template lints without a finding on its defaults", () => {
    for (const name of templateNames()) {
      const scene = buildScene(name);
      const f = findings(scene);
      expect(`${name}: ${f.map((x) => `${x.level} ${x.rule} ${x.where} ${x.message}`).join("; ") || "clean"}`).toBe(`${name}: clean`);
      expect(scene.layers.length).toBeGreaterThan(0);
      expect(scene.dur).toBeGreaterThanOrEqual(20);
    }
  });

  test("every template ships a vertical override and records where the scene came from", () => {
    for (const name of templateNames()) {
      const scene = buildScene(name);
      expect(scene.template).toBe(name);
      const withOverride = scene.layers.filter((l) => (l as Layer & { formats?: Record<string, unknown> }).formats?.vertical);
      expect(`${name} ${withOverride.length > 0}`).toBe(`${name} true`);
    }
  });

  test("params override the defaults and are recorded, the rest stay defaults", () => {
    const scene = buildScene("stat", { value: "96", label: "frames a second", dur: 120 });
    const counter = scene.layers.find((l) => l.id === "value") as Layer & { to: number; from: number };
    expect(counter.to).toBe(96);
    expect(counter.from).toBe(0);
    expect(scene.dur).toBe(120);
    expect((scene.layers.find((l) => l.id === "label") as Layer & { text: string }).text).toBe("frames a second");
    expect(scene.params).toMatchObject({ value: 96, label: "frames a second", dur: 120 });
    expect(scene.params?.size).toBeUndefined();
    expect(errors(scene)).toEqual([]);
  });

  test("an empty optional line drops its layer", () => {
    expect(buildScene("stat", { note: "" }).layers.map((l) => l.id)).toEqual(["value", "label"]);
    expect(buildScene("stat", { note: "measured on the same film" }).layers.map((l) => l.id)).toEqual(["value", "label", "note"]);
    expect(buildScene("title").layers.map((l) => l.id)).toEqual(["headline", "rule"]);
    expect(buildScene("title", { kicker: "a kicker" }).layers.map((l) => l.id)).toEqual(["kicker", "headline", "rule"]);
  });

  test("the ground picks the colours, and a light ground keeps accent out of the text", () => {
    expect(groundIsLight("paper")).toBe(true);
    expect(groundIsLight("ink")).toBe(false);
    expect(groundIsLight("#F0EDE6")).toBe(true);
    expect(paletteFor("ink")).toMatchObject({ fg: "paper", accentText: "accent" });
    expect(paletteFor("paper")).toMatchObject({ fg: "ink", accentText: "ink" });
    expect(paletteFor("paper", "accent").accentText).toBe("accent");
    const dark = buildScene("list", { ground: "ink" }).layers.find((l) => l.id === "items") as Layer & { color: string; markerColor: string };
    expect([dark.color, dark.markerColor]).toEqual(["paper", "accent"]);
    const lightList = buildScene("list", { ground: "paper" }).layers.find((l) => l.id === "items") as Layer & { color: string; markerColor: string };
    expect([lightList.color, lightList.markerColor]).toEqual(["ink", "ink"]);
  });

  test("a group is one layer, --no-groups the same children flat", () => {
    for (const name of ["lower-third", "cta"]) {
      const flat = buildScene(name, { groups: false });
      const grouped = buildScene(name, { groups: true });
      expect(grouped.layers.filter((l) => (l as { type: string }).type === "group").length).toBe(1);
      const g = grouped.layers.find((l) => (l as { type: string }).type === "group") as unknown as { layers: Layer[] };
      const inside = new Set([...g.layers.map((l) => l.id), ...grouped.layers.map((l) => l.id)]);
      for (const l of flat.layers) expect(`${name} ${l.id} ${inside.has(l.id)}`).toBe(`${name} ${l.id} true`);
      expect(errors(flat)).toEqual([]);
      expect(errors(grouped)).toEqual([]);
    }
  });

  test("ids are unique and grounds alternate", () => {
    expect(uniqueId("stat", ["stat", "stat-2"])).toBe("stat-3");
    expect(buildScene("stat", {}, { taken: ["stat"] }).id).toBe("stat-2");
    expect(buildScene("stat", {}, { id: "numbers" }).id).toBe("numbers");
    expect(buildScene("stat").ground).toBe("ink");
    expect(buildScene("stat", {}, { previousGround: "ink" }).ground).toBe("paper");
    expect(buildScene("stat", { ground: "ink" }, { previousGround: "ink" }).ground).toBe("ink");
  });

  test("values read from strings the way the manifest says", () => {
    expect(parseList("a | b | c")).toEqual(["a", "b", "c"]);
    expect(parseList("a, b")).toEqual(["a", "b"]);
    expect(parseList(["a", "b"])).toEqual(["a", "b"]);
    expect(parsePairs("Remotion=0.57 | native=0.06")).toEqual([{ label: "Remotion", value: 0.57 }, { label: "native", value: 0.06 }]);
    expect(coerceParams(TEMPLATES.chart, { values: "a=1" })).toMatchObject({ values: [{ label: "a", value: 1 }], direction: "horizontal" });
    expect(coerceParams(TEMPLATES.title, { rule: "false" }).rule).toBe(false);
    expect(coerceParams(TEMPLATES.stat, { value: "12.5" }).value).toBe(12.5);
  });
});

describe("expandTemplates", () => {
  test("a scene of id, template and params becomes layers; an expanded scene is left alone", () => {
    const raw = {
      scenes: [
        { id: "open", template: "title", params: { title: "Hello", kicker: "hi" } },
        { id: "numbers", template: "stat", params: { value: 12 }, dur: 96 },
        { id: "raw", dur: 60, ground: "ink", layers: [{ id: "line", type: "text", text: "written by hand" }] },
        { id: "unknown", template: "no-such-template", dur: 40 },
      ],
    };
    const out = expandTemplates(raw) as { scenes: MgScene[] };
    expect(out.scenes.map((s) => s.id)).toEqual(["open", "numbers", "raw", "unknown"]);
    expect(out.scenes[0].layers.map((l) => l.id)).toEqual(["kicker", "headline", "rule"]);
    expect(out.scenes[1].dur).toBe(96);
    expect(out.scenes[1].ground).toBe("paper"); // alternates away from the title's ink
    expect(out.scenes[2].layers.length).toBe(1);
    expect(out.scenes[3].layers).toBeUndefined();
    // expanding again changes nothing: after the first pass the layers are the truth
    expect(expandTemplates(out)).toEqual(out);
  });

  test("normalizeFilm expands them and keeps the record", () => {
    const f = normalizeFilm({ title: "t", scenes: [{ id: "open", template: "title", params: { title: "Hello there" } } as unknown as MgScene] });
    expect(f.scenes[0].layers.map((l) => l.id)).toEqual(["headline", "rule"]);
    expect(f.scenes[0].template).toBe("title");
    expect(f.scenes[0].params).toMatchObject({ title: "Hello there" });
    expect(lintFilm(f).filter((x) => x.level === "error")).toEqual([]);
  });
});

describe("mh template", () => {
  const tempFilm = () => {
    const dir = mkdtempSync(join(tmpdir(), "mh-template-"));
    const path = join(dir, "film.mograph.json");
    writeFileSync(path, JSON.stringify(film([]), null, 2));
    return path;
  };
  const read = (path: string) => JSON.parse(readFileSync(path, "utf8")) as MgFilm;

  test("add places a scene, apply builds it again from its params", async () => {
    const path = tempFilm();
    await commands.template({ _: ["add", "title"], file: path, param: ["title=Hello there", "kicker=a test"] });
    await commands.template({ _: ["add", "stat"], file: path, param: ["value=96", "label=frames a second"] });
    await commands.template({ _: ["add", "end-card"], file: path, param: ["title=the end"], after: "title" });
    let f = read(path);
    expect(f.scenes.map((s) => s.id)).toEqual(["title", "end-card", "stat"]);
    expect(f.scenes[0].params).toMatchObject({ title: "Hello there", kicker: "a test" });
    expect(f.scenes[2].ground).toBe("paper");
    expect((f.scenes[2].layers.find((l) => l.id === "value") as Layer & { to: number }).to).toBe(96);
    expect(lintFilm(f).filter((x) => x.level === "error")).toEqual([]);

    await commands.template({ _: ["apply", "stat"], file: path, param: ["label=frames per second", "size=180"] });
    f = read(path);
    expect(f.scenes.map((s) => s.id)).toEqual(["title", "end-card", "stat"]);
    const stat = f.scenes[2];
    expect(stat.params).toMatchObject({ value: 96, label: "frames per second", size: 180 });
    expect((stat.layers.find((l) => l.id === "value") as Layer & { to: number; size: number }).to).toBe(96);
    expect((stat.layers.find((l) => l.id === "value") as Layer & { size: number }).size).toBe(180);

    // a second scene from the same template takes a unique id
    await commands.template({ _: ["add", "stat"], file: path, param: ["value=7"] });
    expect(read(path).scenes.map((s) => s.id)).toEqual(["title", "end-card", "stat", "stat-2"]);
    expect(process.exitCode ?? 0).toBe(0);
  });

  test("apply may name another template, add refuses a place that does not exist", async () => {
    const path = tempFilm();
    await commands.template({ _: ["add", "statement"], file: path, param: ["headline=One line"] });
    await commands.template({ _: ["apply", "statement", "kinetic"], file: path, param: ["line=One line"] });
    const f = read(path);
    expect(f.scenes[0].template).toBe("kinetic");
    expect(f.scenes[0].layers.map((l) => l.id)).toEqual(["line"]);
    expect(commands.template({ _: ["add", "title"], file: path, after: "nope" })).rejects.toThrow(/no scene "nope"/);
    expect(commands.template({ _: ["add", "no-such"], file: path })).rejects.toThrow(/no template/);
  });
});
