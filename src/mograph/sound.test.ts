import { describe, expect, test } from "bun:test";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { soundCues, unknownSounds, soundsUsed, SOUND_NAMES } from "./sound.ts";
import { ensureSoundBank } from "./sound-make.ts";
import type { MgFilm } from "./schema.ts";
import { run } from "../util.ts";

const film = (): MgFilm => ({
  title: "s",
  fps: 30,
  design: { ink: "#111111", paper: "#FFFFFF", accent: "#FF0000" },
  formats: { wide: { width: 1920, height: 1080 } },
  scenes: [
    { id: "a", dur: 60, sound: "swell", layers: [{ id: "n", type: "counter", to: 40, sound: { name: "pop", gain: 0.5, at: 4 } } as never, { id: "l", type: "list", items: ["x"], sound: "nope" } as never] } as never,
  ],
  sounds: { nope2: "sfx/own.wav" },
} as never);

describe("sound design from data", () => {
  test("cues at the layer's in, unknown names reported, bank names listed", () => {
    const f = film();
    const cues = soundCues(f);
    expect(cues.map((c) => [c.id, c.at, c.file, c.gain])).toEqual([
      ["a-sound", "a+0", "public/sfx/swell.wav", 0.8],
      ["a-n-sound", "a.nIn+4", "public/sfx/pop.wav", 0.5],
    ]);
    expect(unknownSounds(f)).toEqual([{ where: "a.l.sound", name: "nope" }]);
    expect(soundsUsed(f).sort()).toEqual(["pop", "swell"]);
    expect(SOUND_NAMES).toContain("whoosh");
  });
  test("ffmpeg writes the bank", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mh-sfx-"));
    const files = await ensureSoundBank(dir, ["pop", "tick", "whoosh"]);
    for (const f of Object.values(files)) {
      expect(existsSync(f)).toBe(true);
      const d = parseFloat((await run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f])).out.trim());
      expect(d).toBeGreaterThan(0.04);
      expect(d).toBeLessThan(1);
    }
  }, 30000);
});
