import { defineConfig } from "../../src/config.ts";
import { timeline } from "./src/timeline.ts";

export default defineConfig({
  root: "./src/Root.tsx",
  rootExport: "Root",
  publicDir: "public",
  cacheDir: ".harness",
  films: {
    example: {
      timeline,
      formats: { wide: { width: 1920, height: 1080 }, vertical: { width: 1080, height: 1920 } },
      defaultFormat: "wide",
    },
  },
  tokens: {
    colors: ["#1C1A17", "#F7F4E3", "#251F1A", "#FFBC14", "#1D4B3A", "#473206", "#FFFFFF"],
    sources: ["src/**/*.tsx", "src/**/*.ts"],
  },
});
