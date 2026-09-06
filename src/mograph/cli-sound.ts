/**
 * mh sounds: the synthesised sound bank a motion graphics film can name
 * (`"sound": "pop"` on a layer). Lists the bank, writes the files a film
 * uses (or all of them) under public/sfx, and reports what a film asks for
 * that nothing provides.
 */
import { SOUND_BANK, SOUND_NAMES, ensureSoundBank, soundsUsed, unknownSounds, soundCues } from "./sound.ts";
import type { MgFilm } from "./schema.ts";

export const HELP = `  sounds [--make] [--all] [--force] the synthesised sound bank (pop, tick, click, whoosh, rise, thud, ding, swell); --make writes the ones the film names under public/sfx, --all every one`;

/** the command body; the CLI passes the loaded film, the project dir and its output helpers */
export const soundsCommand = async (o: { film: MgFilm; projectDir: string; make: boolean; all: boolean; force: boolean; log: (s: string) => void; table: (rows: (string | number)[][], header?: string[]) => string }) => {
  const used = soundsUsed(o.film);
  const unknown = unknownSounds(o.film);
  o.log(o.table(SOUND_NAMES.map((n) => [n, `${SOUND_BANK[n].seconds}s`, used.includes(n) ? "used" : "", SOUND_BANK[n].what]), ["sound", "length", "film", "what"]));
  for (const u of unknown) o.log(`warn   sound                    ${u.where.padEnd(40)} "${u.name}" is neither in the bank nor in the film's sounds map`);
  const cues = soundCues(o.film);
  if (cues.length) o.log(`${cues.length} sound cue${cues.length === 1 ? "" : "s"} from the film: ${cues.map((c) => `${c.id} at ${String(c.at)}`).join(", ")}`);
  if (o.make || o.all) {
    const files = await ensureSoundBank(o.projectDir, o.all ? SOUND_NAMES : used, { force: o.force, log: o.log });
    o.log(`${Object.keys(files).length} file${Object.keys(files).length === 1 ? "" : "s"} under public/sfx`);
    return Object.values(files);
  }
  return [];
};
