/** the film about the tool: native engine, no Remotion install, no sound (a bed can be dropped in as a cue) */
import { defineConfig } from "../../src/config.ts";
import { timeline } from "./src/timeline.ts";

export default defineConfig({
  root: "./src/Root.tsx",
  rootExport: "Root",
  publicDir: "public",
  cacheDir: ".harness",
  engine: "native",
  films: {
    mh: {
      timeline,
      formats: { wide: { width: 1920, height: 1080 }, vertical: { width: 1080, height: 1920 } },
      defaultFormat: "wide",
    },
  },
  tokens: {
    colors: ["#1C1A17", "#F7F4E3", "#FFBC14", "#1D4B3A", "#FBF9EF", "#6B6459", "#0F0E0C", "#FFFFFF", "#E4E2DC", "#111111", "#555555", "#6B6B6B", "#2F6FDE", "#9A9A9A", "#8E44AD", "#E8871E", "#FF5F57", "#FEBC2E", "#28C840"],
    sources: ["src/**/*.tsx"],
  },
  captions: { bottom: { wide: 70, vertical: 340 } },
});
