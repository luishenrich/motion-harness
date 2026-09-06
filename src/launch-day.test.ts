/** the nine lessons of 2026-09-06, each pinned by a test on the pure part */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compile, defineTimeline } from "./timeline/schema.ts";
import { cueAudibility, highpass, audibleFrom, headProfile } from "./audio/audibility.ts";
import { srtEntries, srtText, fmtSrtTime, chapterLines } from "./srt/srt.ts";
import { lintAudioCues } from "./lint/lint.ts";
import { resolveProjectDir } from "./config.ts";
import { planLegs, targetsModule } from "./cursor/cursor.ts";
import { pickStills, lintStill } from "./still/still.ts";
import { manifestMarkdown } from "./deliver/deliver.ts";
import { isStale } from "./render/bundle.ts";

const c = compile(
  defineTimeline({
    fps: 30,
    parts: [
      { id: "opening", composition: "o", scenes: [{ id: "turn", dur: 60, enter: "cut", text: "forgets what you know." }, { id: "intro", dur: 60, enter: "cut", text: "Introducing" }] },
      { id: "product", composition: "p", enterFrames: 12, scenes: [{ id: "mapping", dur: 90, enter: "fade", caption: "Bo is mapping your course" }, { id: "say1", dur: 60, enter: "fade", text: ["Your course,", "not a chat."] }, { id: "probe", dur: 120, enter: "fade", events: { pick1: 12, optD: 84, opt2: 100 } }] },
    ],
    audio: [
      { id: "bed", kind: "music", file: "bed.mp3", at: "opening", gain: 0, ramps: [{ at: "opening", to: 0.4, over: 2 }, { at: "product - 9s", to: 0.5, over: 1 }, { at: "probe + 30s", to: 0.1 }] },
      { id: "key", kind: "sfx", file: "key.mp3", at: "turn+10" },
    ],
  }),
);

describe("4. audibility of a short cue under a bed", () => {
  const sr = 8000;
  const seconds = 3;
  const bed = new Float32Array(sr * seconds);
  for (let i = 0; i < bed.length; i++) bed[i] = 0.3 * Math.sin((2 * Math.PI * 180 * i) / sr) + 0.15 * Math.sin((2 * Math.PI * 440 * i) / sr);
  const withKey = Float32Array.from(bed);
  // a 30 ms burst of 5 kHz at 1.5 s, quiet: invisible to a 250 ms rms, plain to the high-passed peak
  for (let i = 0; i < sr * 0.03; i++) withKey[Math.round(sr * 1.5) + i] += 0.08 * Math.sin((2 * Math.PI * 3500 * i) / sr);
  test("the key is audible, the bed alone is not", () => {
    const hp = highpass(withKey, sr, 2000);
    const a = cueAudibility(hp, sr, 1.5);
    expect(a.verdict).toBe("audible");
    expect(a.deltaDb).toBeGreaterThan(6);
    const none = cueAudibility(highpass(bed, sr, 2000), sr, 1.5);
    expect(none.verdict).toBe("masked");
    expect(Math.abs(none.deltaDb)).toBeLessThan(1);
  });
  test("a 250 ms rms would not have seen it", () => {
    const rms = (s: Float32Array, from: number) => {
      let acc = 0;
      const a = Math.round(from * sr), b = a + Math.round(0.25 * sr);
      for (let i = a; i < b; i++) acc += s[i] * s[i];
      return Math.sqrt(acc / (b - a));
    };
    const delta = 20 * Math.log10(rms(withKey, 1.5) / rms(withKey, 1.25));
    expect(Math.abs(delta)).toBeLessThan(1);
  });
  test("audible from: silence then sound", () => {
    const s = new Float32Array(sr * 2);
    for (let i = sr * 0.7; i < s.length; i++) s[i] = 0.2 * Math.sin((2 * Math.PI * 200 * i) / sr);
    expect(audibleFrom(s, sr, -40)).toBeCloseTo(0.7, 1);
    expect(audibleFrom(new Float32Array(sr), sr)).toBeNull();
    const head = headProfile(s, sr, 2, 0.1);
    expect(head.length).toBe(20);
    expect(head[0]).toBe(-Infinity);
    expect(head[10]).toBeGreaterThan(-20);
  });
});

describe("4b. cue lint: ramps before the film, bad refs", () => {
  test("a ramp resolved before frame 0 warns, a bad ref errors", () => {
    const f = lintAudioCues(c);
    const before = f.find((x) => x.rule === "ramp-before-start");
    expect(before?.where).toBe("audio bed ramp product - 9s");
    expect(before?.message).toMatch(/-5.00s/);
    const after = f.find((x) => x.rule === "ramp-after-end");
    expect(after?.where).toBe("audio bed ramp probe + 30s");
    const bad = compile(defineTimeline({ fps: 30, parts: [{ id: "a", composition: "a", scenes: [{ id: "one", dur: 30 }] }], audio: [{ id: "x", kind: "sfx", file: "x.mp3", at: "one.nope" }] }));
    expect(lintAudioCues(bad)[0].rule).toBe("cue-ref");
  });
});

describe("6. srt from the timeline", () => {
  test("text and caption scenes become entries, times from the compile, settled start", () => {
    const e = srtEntries(c);
    expect(e.map((x) => x.scene)).toEqual(["turn", "intro", "mapping", "say1"]);
    expect(e[0].start).toBe(0);
    expect(e[0].end).toBeCloseTo(2 - 0.04, 5);
    expect(e[2].text).toBe("Bo is mapping your course");
    expect(e[2].start).toBeCloseTo(4 + 12 / 30, 5); // enter fade of 12f
    expect(e[3].text).toBe("Your course,\nnot a chat.");
    expect(srtEntries(c, { useCaption: false }).map((x) => x.scene)).toEqual(["turn", "intro", "say1"]);
  });
  test("srt text and chapter lines", () => {
    expect(fmtSrtTime(65.5)).toBe("00:01:05,500");
    const txt = srtText(srtEntries(c));
    expect(txt.startsWith("1\n00:00:00,000 --> 00:00:01,960\nforgets what you know.\n\n2\n")).toBe(true);
    const ch = chapterLines(srtEntries(c));
    expect(ch[0]).toBe("0:00 forgets what you know.");
    expect(ch[3]).toBe("0:07 Your course, not a chat.");
  });
  test("one line over two scenes is one entry", () => {
    const d = compile(defineTimeline({ fps: 30, parts: [{ id: "a", composition: "a", scenes: [{ id: "x", dur: 30, text: "Same" }, { id: "y", dur: 30, text: "Same" }, { id: "z", dur: 30, text: "Other" }] }] }));
    const e = srtEntries(d);
    expect(e.length).toBe(2);
    expect(e[0].end).toBeCloseTo(2 - 0.04, 5);
  });
});

describe("9. project resolution and hover dwell", () => {
  test("--project, MH_PROJECT, cwd with config, last", () => {
    const dir = mkdtempSync(join(tmpdir(), "mh-proj-"));
    const withCfg = join(dir, "p1");
    const empty = join(dir, "p2");
    const home = join(dir, "home");
    for (const d of [withCfg, empty, home]) require("node:fs").mkdirSync(d);
    writeFileSync(join(withCfg, "harness.config.ts"), "export default {}");
    const oldEnv = process.env.MH_PROJECT, oldHome = process.env.MH_HOME;
    delete process.env.MH_PROJECT;
    process.env.MH_HOME = home;
    try {
      expect(resolveProjectDir("x", empty)).toEqual({ dir: join(empty, "x"), from: "flag" });
      expect(resolveProjectDir(undefined, withCfg)).toEqual({ dir: withCfg, from: "cwd" });
      expect(resolveProjectDir(undefined, empty).from).toBe("cwd");
      writeFileSync(join(home, "last"), withCfg);
      expect(resolveProjectDir(undefined, empty)).toEqual({ dir: withCfg, from: "last" });
      process.env.MH_PROJECT = withCfg;
      expect(resolveProjectDir(undefined, empty)).toEqual({ dir: withCfg, from: "env" });
    } finally {
      if (oldEnv === undefined) delete process.env.MH_PROJECT;
      else process.env.MH_PROJECT = oldEnv;
      if (oldHome === undefined) delete process.env.MH_HOME;
      else process.env.MH_HOME = oldHome;
    }
  });
  test("a hover leg with dwell carries both into the plan and the module", () => {
    const legs = planLegs(c, [["probe.optD", "opt-d?", { dwell: 10 }], ["probe.opt2", "opt-c"]]);
    expect(legs[0]).toMatchObject({ key: "opt-d", hover: true, dwell: 10, partFrame: 234 });
    expect(legs[1].dwell).toBeUndefined();
    expect(() => planLegs(c, [["probe.optD", "opt-d?", { dwell: -1 }]])).toThrow(/dwell/);
    const mod = targetsModule([{ id: "probe.optD -> opt-d (hover)", frame: 234, x: 10, y: 20, click: false, dwell: 10 }]);
    expect(mod).toContain('"dwell": 10');
    expect(mod).toContain("dwell?: number");
  });
});

describe("5. stills", () => {
  const avail = [{ id: "thumb-a", width: 1920, height: 1080 }, { id: "og", width: 1200, height: 630 }];
  test("all, some, unknown", () => {
    expect(pickStills(avail, ["all"]).length).toBe(2);
    expect(pickStills(avail, ["og"]).map((s) => s.id)).toEqual(["og"]);
    expect(() => pickStills(avail, ["nope"])).toThrow(/no still "nope" \(stills registered: thumb-a, og\)/);
  });
  test("a still is linted like a frame: text past the frame edge is an overflow error", () => {
    const probe = { viewport: { w: 1920, h: 1080 }, colors: [], items: [{ key: "h1", kind: "text" as const, tag: "h1", x: 1700, y: 100, w: 400, h: 80, visible: true, opacity: 1, color: "", bg: "", fontSize: "60px", fontWeight: "400", fontFamily: "x", text: "Stop studying in a chat" }] };
    const f = lintStill("thumb-a", probe);
    expect(f.some((x) => x.rule === "overflow" && x.level === "error" && /right by 180px/.test(x.message))).toBe(true);
    expect(lintStill("og", undefined)[0].rule).toBe("probe-missing");
  });
});

describe("7. deliver manifest", () => {
  test("files, chapters, scenes, audio", () => {
    const md = manifestMarkdown(
      { film: "launch", c, films: [] },
      [{ kind: "film", format: "wide", file: "/x/launch-wide-1920x1080.mp4", bytes: 9_500_000, sha1: "abc", seconds: 12, kbps: 6333, width: 1920, height: 1080 }],
      "launch-en.srt",
      new Date("2026-09-06T10:00:00Z"),
    );
    expect(md).toContain("# launch delivery (2026-09-06)");
    expect(md).toContain("| film | wide | `launch-wide-1920x1080.mp4` | 9.1 MB | 12.00 s | 6333 kbit/s |  | abc |");
    expect(md).toContain("- 0:00 forgets what you know.");
    expect(md).toContain("| 4 | product | probe | 9.00s | 4.00 s |  |");
    expect(md).toContain("- key (sfx): `key.mp3` at turn+10");
    expect(md).toContain("Generated by `mh deliver`");
  });
});

describe("2. stale runs", () => {
  test("a run from another bundle is stale, a run without a hash is not judged", () => {
    expect(isStale("aaa:1:plain", "bbb:1:plain")).toBe(true);
    expect(isStale("aaa:1:plain", "aaa:1:plain")).toBe(false);
    expect(isStale(undefined, "aaa")).toBe(false);
  });
});

describe("8. render stats line", () => {
  test("size and bitrate read from the file", async () => {
    const { statsLine } = await import("./util.ts");
    expect(statsLine({ file: "x", bytes: 9_500_000, seconds: 58.7, kbps: 1295 }, 1761)).toBe("1761f, 58.70s, 9.1 MB, 1295 kbit/s");
  });
});

test("scaffold: temp files exist only inside the test", () => {
  const d = mkdtempSync(join(tmpdir(), "mh-x-"));
  writeFileSync(join(d, "a"), "1");
  expect(existsSync(join(d, "a"))).toBe(true);
  expect(readFileSync(join(d, "a"), "utf8")).toBe("1");
});
