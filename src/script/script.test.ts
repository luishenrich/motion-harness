import { describe, expect, test } from "bun:test";
import { normalizeScript, scriptMarkdown, parseScriptMarkdown, scaffoldFiles } from "./script.ts";
import { compile } from "../timeline/schema.ts";
import { otioDocument } from "../otio/otio.ts";
import { contrastRatio, lintContrast } from "../lint/lint.ts";

const assets = [
  { id: "interview", file: "public/assets/interview.mp4", kind: "video" as const, seconds: 40, width: 1920, height: 1080, bytes: 1, addedAt: "" },
  { id: "desk", file: "public/assets/desk.jpg", kind: "image" as const, width: 1200, height: 800, bytes: 1, addedAt: "" },
];
const script = normalizeScript(
  {
    title: "Placement Check Launch",
    design: { ink: "#101820", paper: "#fdfbf7", accent: "#ff6b35", fontDisplay: "Space Grotesk" },
    scenes: [
      { id: "Problem!", seconds: 3, kind: "text", ground: "dark", headline: "Every AI forgets what you know." },
      { id: "problem", seconds: 40, kind: "text", ground: "cream" as never, headline: "Introducing", body: "A course, not a chat.", visual: "the wordmark on cream", why: "the brand arrives" },
      { id: "2nd", seconds: 0.5, kind: "text", ground: "purple" as never, headline: "Try it" },
      { id: "talk", seconds: 8, kind: "clip", ground: "dark", headline: "", asset: "interview.mp4", in: 36, focus: [0.4, 0.3] },
      { id: "still", seconds: 4, kind: "clip", ground: "light", headline: "The desk", asset: "desk" },
    ],
  },
  assets,
);

describe("script", () => {
  test("ids kebab and unique, seconds clamped, grounds valid", () => {
    expect(script.scenes.map((s) => s.id)).toEqual(["problem", "problem-2", "s2nd", "talk", "still"]);
    expect(script.scenes.map((s) => s.seconds)).toEqual([3, 12, 1.5, 4, 4]);
    expect(script.scenes[1].ground).toBe("light");
    expect(script.scenes[2].ground).toBe("dark");
    // a clip past the asset's end is shortened; an asset named by file resolves to its id; an image asset makes an image scene
    expect(script.scenes[3]).toMatchObject({ kind: "clip", asset: "interview", in: 36, seconds: 4, focus: [0.4, 0.3] });
    expect(script.scenes[4]).toMatchObject({ kind: "image", asset: "desk" });
    expect(script.design).toMatchObject({ ink: "#101820", paper: "#FDFBF7", accent: "#FF6B35", muted: "#6B6B6B", fontDisplay: "Space Grotesk", fontBody: "" });
  });
  test("markdown round trip", () => {
    const md = scriptMarkdown(script);
    expect(md).toContain("## 2. problem-2 (12s, text, light)");
    expect(md).toContain("Asset: interview @ 36s focus 0.4,0.3");
    expect(md).toContain("Design: ink #101820, paper #FDFBF7, accent #FF6B35, muted #6B6B6B, display Space Grotesk");
    const back = parseScriptMarkdown(md, assets);
    expect(back.title).toBe("Placement Check Launch");
    expect(back.scenes[1]).toMatchObject({ id: "problem-2", seconds: 12, kind: "text", ground: "light", headline: "Introducing", body: "A course, not a chat.", visual: "the wordmark on cream", why: "the brand arrives" });
    expect(back.scenes[3]).toMatchObject({ kind: "clip", asset: "interview", in: 36, focus: [0.4, 0.3] });
    expect(back.design?.fontDisplay).toBe("Space Grotesk");
  });
  test("scaffold compiles to a timeline with the right frames", async () => {
    const files = scaffoldFiles(script, { harnessImport: "../../src", formats: ["wide", "vertical"], assets });
    expect(Object.keys(files)).toEqual(["src/timeline.ts", "src/Film.tsx", "src/Root.tsx", "harness.config.ts", "tsconfig.json", "package.json", ".gitignore", "script.md", "public/.gitkeep"]);
    expect(files["src/timeline.ts"]).toContain('"problem": { dur: 90, kind: "text"');
    expect(files["src/timeline.ts"]).toContain('"interview": { file: "assets/interview.mp4", kind: "video", seconds: 40');
    expect(files["src/timeline.ts"]).toContain('DESIGN = { ink: "#101820"');
    expect(files["src/Film.tsx"]).toContain("fonts.googleapis.com/css2?family=Space+Grotesk");
    expect(files["src/Root.tsx"]).toContain('id="placement-check-launch-vertical"');
    expect(files["harness.config.ts"]).toContain('engine: "native"');
    // the generated timeline is real TypeScript: evaluate it through the same schema module
    const { mkdtempSync, writeFileSync, mkdirSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join, resolve } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "mh-scaffold-"));
    mkdirSync(join(dir, "src"));
    const src = files["src/timeline.ts"].replace('"../../src/timeline/schema.ts"', JSON.stringify(resolve(import.meta.dir, "../timeline/schema.ts")));
    writeFileSync(join(dir, "src/timeline.ts"), src);
    const mod = await import(join(dir, "src/timeline.ts"));
    const c = compile(mod.timeline);
    expect(c.dur).toBe(90 + 360 + 45 + 120 + 120);
    expect(c.scenes[1].text).toEqual(["Introducing", "A course, not a chat."]);
    expect(c.scenes[0].enter.type).toBe("cut");
    expect(c.scenes[1].exit?.dur).toBe(8);
    expect(c.scenes[3].clip).toBe("interview");
    expect(c.scenes[3].text).toBeUndefined();
    expect(c.scenes[3].stage).toBe("clip");
  });
});

describe("otio", () => {
  test("a clip per scene with markers, missing references when nothing was rendered", () => {
    const c = compile({ fps: 30, parts: [{ id: "a", composition: "a", scenes: [{ id: "one", dur: 30, events: { hit: 10 } }, { id: "two", dur: 60 }] }, { id: "b", composition: "b", gap: 15, scenes: [{ id: "three", dur: 45 }] }] });
    const doc = otioDocument(c, "test", [{ sceneId: "one", file: "/tmp/one.mp4" }], { audio: "/tmp/mix.mp4" });
    const video = (doc.tracks.children as { name: string; children: Record<string, unknown>[] }[])[0];
    expect(video.children.map((k) => k.OTIO_SCHEMA)).toEqual(["Clip.2", "Clip.2", "Gap.1", "Clip.2"]);
    const one = video.children[0] as { markers: { name: string }[]; media_references: { DEFAULT_MEDIA: { OTIO_SCHEMA: string; target_url?: string } } };
    expect(one.markers[0].name).toBe("hit");
    expect(one.media_references.DEFAULT_MEDIA.target_url).toBe("file:///tmp/one.mp4");
    expect((video.children[1] as typeof one).media_references.DEFAULT_MEDIA.OTIO_SCHEMA).toBe("MissingReference.1");
    expect(doc.tracks.children.length).toBe(2);
  });
});

describe("contrast", () => {
  test("ratios and the lint", () => {
    expect(contrastRatio("#FFFFFF", "#000000")).toBeCloseTo(21, 1);
    expect(contrastRatio("#FFBC14", "#F7F4E3")).toBeLessThan(3);
    const item = (key: string, color: string, bg: string, fontSize: string, weight = "400") => ({ key, kind: "text" as const, tag: "div", x: 0, y: 0, w: 100, h: 20, visible: true, opacity: 1, color, bg, fontSize, fontWeight: weight, fontFamily: "x", text: "hello" });
    const probe = { viewport: { w: 1920, h: 1080 }, colors: [{ prop: "bg" as const, value: "rgb(247, 244, 227)", count: 9, example: "" }], items: [item("gold-on-cream", "rgb(255, 188, 20)", "rgba(0, 0, 0, 0)", "40px"), item("ink-on-cream", "rgb(28, 26, 23)", "rgba(0, 0, 0, 0)", "16px"), item("cream-on-ink", "rgb(247, 244, 227)", "rgb(28, 26, 23)", "16px")] };
    const f = lintContrast("t+0", probe);
    expect(f.map((x) => x.where)).toEqual(["t+0 gold-on-cream"]);
    expect(f[0].message).toMatch(/large text needs 3:1/);
  });
});
