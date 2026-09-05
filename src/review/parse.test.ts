import { describe, expect, test } from "bun:test";
import { compile, defineTimeline } from "../timeline/schema.ts";
import { parseFeedback, parseSentence, splitSentences } from "./parse.ts";

const tl = defineTimeline({
  fps: 30,
  parts: [
    {
      id: "opening",
      composition: "opening",
      enterFrames: 10,
      scenes: [
        { id: "black", dur: 24, enter: "cut" },
        { id: "line1", dur: 54, enter: "fade", text: "Studying used to be a system.", events: { lineIn: 10, lineOut: 44 } },
        { id: "upload", dur: 60, enter: "cut", text: "New Lecture", why: "the upload lands" },
      ],
    },
    {
      id: "product",
      composition: "product",
      enterFrames: 12,
      scenes: [
        { id: "card", dur: 70, enter: "wipe", why: "the card arrives, the cursor picks an answer", events: { cardIn: 12, hover: 30, click: 44, reveal: 52 }, probes: ["card", "check-button"] },
        { id: "topic-map", dur: 80, enter: "fade", why: "three rows, one gets a score", events: { rowsIn: 12, score: 40 }, probes: ["map"] },
      ],
    },
  ],
});
const c = compile(tl);
// film: black 0-23, line1 24-77, upload 78-137, card 138-207, topic-map 208-287

describe("split", () => {
  test("newlines, bullets and sentence ends, decimals survive", () => {
    expect(splitSentences("bei 20.5s zu schnell. Dann ok!\n- die Topic Map wackelt")).toEqual(["bei 20.5s zu schnell.", "Dann ok!", "die Topic Map wackelt"]);
  });
});

describe("feedback sentences", () => {
  test("1. bei 1:09 -> film frame 2070 clamped to the last scene", () => {
    const p = parseSentence(c, "bei 1:09 ist der Text zu klein");
    expect(p.hits.length).toBe(1);
    expect(p.hits[0].kind).toBe("time");
    expect(p.hits[0].phrase).toBe("1:09");
    expect(p.hits[0].location.filmFrame).toBe(c.dur - 1);
    expect(p.unresolved).toEqual([]);
  });
  test("2. Sekunde 5-6 is a range inside card", () => {
    const p = parseSentence(c, "Sekunde 5-6 ruckelt es");
    expect(p.hits.length).toBe(1);
    expect(p.hits[0].kind).toBe("range");
    expect(p.hits[0].location.scene.id).toBe("card");
    expect(p.hits[0].location.local).toBe(150 - 138);
    expect(p.hits[0].until!.filmFrame).toBe(180);
  });
  test("3. ab 3s is an open range, not a plain moment", () => {
    const p = parseSentence(c, "ab 3s bitte lauter");
    expect(p.hits.map((h) => h.kind)).toEqual(["from"]);
    expect(p.hits[0].location.filmFrame).toBe(90);
    expect(p.hits[0].location.scene.id).toBe("upload");
  });
  test("4. bei New Lecture matches the scene text, case-insensitive", () => {
    const p = parseSentence(c, "bei new lecture fehlt der Schatten");
    expect(p.hits.length).toBe(1);
    expect(p.hits[0].kind).toBe("text");
    expect(p.hits[0].ref).toBe("upload");
    expect(p.unresolved).toEqual([]);
  });
  test("5. beim Klicken auf Check hits card.click and the check-button element", () => {
    const p = parseSentence(c, "beim Klicken auf Check springt die Karte");
    const ev = p.hits.find((h) => h.kind === "event");
    expect(ev?.ref).toBe("card.click");
    expect(ev?.location.filmFrame).toBe(138 + 44);
    expect(p.hits.some((h) => h.kind === "element" && h.via.includes("check-button"))).toBe(true);
  });
  test("6. die Topic Map matches the hyphenated scene id; a stray name is unresolved", () => {
    const p = parseSentence(c, 'die Topic Map wackelt, und "Bo Mascot" fehlt');
    expect(p.hits.map((h) => h.ref)).toEqual(["topic-map"]);
    expect(p.unresolved).toEqual(["Bo Mascot"]);
  });
  test("explicit references and multi-sentence input", () => {
    const ps = parseFeedback(c, "card.click+4 zu früh. f50 ist ok, #2 auch. Bei 19-21s wackelt line1.");
    expect(ps.length).toBe(3);
    expect(ps[0].hits[0].ref).toBe("card.click+4");
    expect(ps[0].hits[0].location.local).toBe(48);
    expect(ps[1].hits.map((h) => h.ref)).toEqual(["f50", "#2"]);
    expect(ps[2].hits.map((h) => h.kind)).toEqual(["range", "scene"]);
  });
  test("a number without a unit is not a time", () => {
    const p = parseSentence(c, "3-4 Zeilen sind zu viel");
    expect(p.hits).toEqual([]);
  });
});
