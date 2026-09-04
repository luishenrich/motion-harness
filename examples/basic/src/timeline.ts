/**
 * The one place timing lives. Compositions read scene lengths and event frames
 * from here, the harness resolves feedback against it, docs are generated from it.
 */
import { defineTimeline } from "../../../src/timeline/schema.ts";

export const FPS = 30;

export const timeline = defineTimeline({
  fps: FPS,
  rules: {
    minSceneDur: 20,
    maxEnterFrames: 14,
    holdFrames: [12, 90],
    safeZone: { vertical: { top: 220, bottom: 320, x: 60 } },
  },
  parts: [
    {
      id: "opening",
      composition: { wide: "example-opening-wide", vertical: "example-opening-vertical" },
      enterFrames: 10,
      scenes: [
        { id: "black", dur: 24, enter: "cut", ground: "dark", why: "a breath before the first line" },
        { id: "line1", dur: 54, enter: "fade", ground: "dark", text: "Studying used to be a system.", events: { lineIn: 10, lineOut: 44 } },
        { id: "line2", dur: 54, enter: "cut", ground: "dark", text: "Now it is a chat window.", events: { lineIn: 10 } },
      ],
    },
    {
      id: "product",
      composition: { wide: "example-product-wide", vertical: "example-product-vertical" },
      enterFrames: 12,
      overlap: 12,
      scenes: [
        { id: "card", dur: 70, enter: "wipe", ground: "cream", why: "the card arrives, the cursor picks an answer", events: { cardIn: 12, hover: 30, click: 44, reveal: 52 }, probes: ["card", "check-button"] },
        { id: "map", dur: 80, enter: "fade", ground: "cream", why: "three rows, one gets a score", events: { rowsIn: 12, score: 40 }, probes: ["map"] },
        { id: "end", dur: 60, enter: "cut", ground: "dark", text: "Your course, not a chat.", events: { lineIn: 8 } },
      ],
    },
  ],
  audio: [
    { id: "bed", kind: "music", file: "public/bed.mp3", at: "0s", gain: 0.25, ramps: [{ at: "product:0", to: 0.6, over: 1 }], fadeOut: 1.5, loop: true },
    { id: "click", kind: "sfx", file: "public/click.mp3", at: "card.click", gain: 0.9 },
  ],
});
