import { defineConfig, defineTimeline } from "motion-harness";

/**
 * Timing lives here (or in a timeline.ts your compositions import). Scenes are
 * frames. Events are local frames you can address as `scene.event`.
 */
const timeline = defineTimeline({
  fps: 30,
  parts: [
    {
      id: "main",
      composition: { wide: "my-composition-wide", vertical: "my-composition-vertical" },
      enterFrames: 12,
      overlap: 0,
      scenes: [
        { id: "intro", dur: 60, enter: "cut", ground: "dark", text: "Hello", events: { lineIn: 10 } },
        { id: "demo", dur: 120, enter: "wipe", ground: "cream", events: { click: 40 }, probes: ["button"] },
      ],
    },
  ],
  audio: [
    // { id: "bed", kind: "music", file: "public/music/bed.mp3", at: "0s", gain: 0.3, ramps: [{ at: "demo", to: 0.6, over: 1 }], fadeOut: 2 },
  ],
  rules: { minSceneDur: 20, maxEnterFrames: 14, holdFrames: [12, 120] },
});

export default defineConfig({
  root: "./src/Root.tsx",
  rootExport: "Root",
  publicDir: "public",
  cacheDir: ".harness",
  // webpackOverride: enableTailwind,   // import { enableTailwind } from "@remotion/tailwind"
  films: {
    main: {
      timeline,
      formats: { wide: { width: 1920, height: 1080 }, vertical: { width: 1080, height: 1920 } },
      defaultFormat: "wide",
    },
  },
  tokens: {
    colors: ["#000000", "#FFFFFF"],
    sources: ["src/**/*.{ts,tsx}"],
  },
});
