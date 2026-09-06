/**
 * The film about the tool, as data. Six scenes, one part, 24 seconds. The
 * components read these numbers; nothing is timed anywhere else.
 */
import { defineTimeline } from "../../../src/timeline/schema.ts";

export const FPS = 30;

export const SCENES = {
  title: { dur: 84 },
  resolve: { dur: 96, events: { typed: 30, answer: 54 } },
  frames: { dur: 120, events: { tiles: 12, badge: 90 } },
  check: { dur: 132, events: { rows: 10, verdict: 110 } },
  numbers: { dur: 96, events: { second: 24, third: 48 } },
  end: { dur: 96, events: { url: 30 } },
} as const;

/** every scene leaves through an 8 frame fade (the Fade wrapper in Film.tsx reads the same number) */
export const FADE = { type: "fade", dur: 8 } as const;

export const timeline = defineTimeline({
  fps: FPS,
  parts: [
    {
      id: "film",
      composition: { wide: "mh-film-wide", vertical: "mh-film-vertical" },
      enterFrames: 10,
      audio: false,
      source: "src/Film.tsx",
      scenes: [
        { id: "title", dur: SCENES.title.dur, enter: "fade", exit: FADE, ground: "dark", text: "Eyes and hands for AI agents that make videos.", probes: ["wordmark"], why: "the thesis on black" },
        { id: "resolve", dur: SCENES.resolve.dur, enter: "fade", exit: FADE, ground: "dark", events: { ...SCENES.resolve.events }, text: "Every moment has an address.", probes: ["terminal", "prompt"], why: "a human says 21s, the tool answers scene and frame" },
        { id: "frames", dur: SCENES.frames.dur, enter: "fade", exit: FADE, ground: "cream", events: { ...SCENES.frames.events }, text: "Frames in seconds, not renders in minutes.", probes: ["sheet"], why: "a contact sheet builds itself" },
        { id: "check", dur: SCENES.check.dur, enter: "fade", exit: FADE, ground: "cream", events: { ...SCENES.check.events }, text: "One command checks an edit.", probes: ["table"], why: "the pass/fail table of mh check" },
        { id: "numbers", dur: SCENES.numbers.dur, enter: "fade", exit: FADE, ground: "dark", events: { ...SCENES.numbers.events }, text: "40 ms a frame. 60 s a film. No credits.", probes: ["n1"], why: "the three numbers" },
        { id: "end", dur: SCENES.end.dur, enter: "fade", exit: FADE, ground: "dark", events: { ...SCENES.end.events }, text: "npx motion-harness", probes: ["cmd"], why: "how to get it" },
      ],
    },
  ],
  rules: { minSceneDur: 24, maxEnterFrames: 14, safeZone: { vertical: { top: 220, bottom: 320, x: 60 } } },
});
