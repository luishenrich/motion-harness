/**
 * The sound bank on disk: ffmpeg synthesises each named sound under public/sfx.
 * Node only (the CLI); the pure vocabulary is in sound.ts.
 */
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { run } from "../util.ts";
import { SOUND_BANK, SOUND_NAMES } from "./sound.ts";

/** write the named sounds under public/sfx of the project when missing; returns the files */
export const ensureSoundBank = async (projectDir: string, names: string[] = SOUND_NAMES, opts: { force?: boolean; log?: (s: string) => void } = {}): Promise<Record<string, string>> => {
  const dir = join(projectDir, "public", "sfx");
  mkdirSync(dir, { recursive: true });
  const out: Record<string, string> = {};
  for (const n of names) {
    const spec = SOUND_BANK[n];
    if (!spec) continue;
    const file = join(dir, `${n}.wav`);
    if (!existsSync(file) || opts.force) {
      await run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", spec.source, "-af", spec.filters, "-ac", "1", "-ar", "48000", "-t", String(spec.seconds), file]);
      opts.log?.(`sfx ${n}: ${spec.seconds}s, ${spec.what}`);
    }
    out[n] = file;
  }
  return out;
};

