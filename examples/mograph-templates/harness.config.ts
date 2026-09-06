import { defineConfig } from "../../src/config.ts";
import { designColors } from "../../src/mograph/schema.ts";
import { film, timeline } from "./src/timeline.ts";

export default defineConfig({
  root: "./src/Root.tsx",
  rootExport: "Root",
  publicDir: "public",
  cacheDir: ".harness",
  engine: "native",
  films: {
    templates: {
      timeline,
      formats: film.formats,
      defaultFormat: "wide",
      mograph: "film.mograph.json",
    },
  },
  tokens: { colors: designColors(film.design), sources: ["src/**/*.tsx"] },
  captions: { bottom: { wide: 70, vertical: 340 } },
});
