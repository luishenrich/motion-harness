/**
 * mh sounds: the synthesised sound bank a motion graphics film can name
 * (`"sound": "pop"` on a layer). Lists the bank, writes the files a film
 * uses (or all of them) under public/sfx, and reports what a film asks for
 * that nothing provides.
 */
import { SOUND_BANK, SOUND_NAMES, soundsUsed, unknownSounds, soundCues, designSounds } from "./sound.ts";
import { ensureSoundBank, ensureBed, BED_NAMES } from "./sound-make.ts";
import type { MgFilm } from "./schema.ts";

export const HELP = `  sounds [--make] [--all] [--force] [--design]
                                    the synthesised sound bank (pop, tick, click, whoosh, rise, thud, ding, swell); --make writes the ones the film names
                                    under public/sfx, --all every one; --design gives a film without sounds a light default (a swell, a hit per scene) and writes them
  sounds --bed calm|warm|pulse [--seconds 64] [--gain 0.35]
                                    a synthesised music bed under public/music and a looping music cue "bed" in the film (a placeholder until a licensed track replaces it)`;

/** the command body; the CLI passes the loaded film, the project dir and its output helpers */
export const soundsCommand = async (o: { film: MgFilm; projectDir: string; make: boolean; all: boolean; force: boolean; design?: boolean; bed?: string; seconds?: number; gain?: number; save?: (film: MgFilm) => void; log: (s: string) => void; table: (rows: (string | number)[][], header?: string[]) => string }) => {
  if (o.bed) {
    if (!BED_NAMES.includes(o.bed)) throw new Error(`no bed "${o.bed}" (have ${BED_NAMES.join(", ")})`);
    const file = await ensureBed(o.projectDir, o.bed, o.seconds ?? 64, { force: o.force, log: o.log });
    const rel = `music/bed-${o.bed}.wav`;
    const audio = (o.film.audio ??= []);
    const cue = audio.find((a) => a.id === "bed");
    const next = { id: "bed", kind: "music" as const, file: rel, at: "0s", gain: o.gain ?? 0.35, loop: true, fadeOut: 2.5, license: `synthesised by mh sounds --bed ${o.bed}: a placeholder, replace with a licensed track before publishing` };
    if (cue) Object.assign(cue, next);
    else audio.unshift(next);
    o.save?.(o.film);
    o.log(`bed ${o.bed} -> ${file}; cue "bed" (music, loop, gain ${next.gain}) in the film; mh audio shows the coverage`);
    return [file];
  }
  if (o.design) {
    const added = designSounds(o.film);
    if (added.length) {
      o.save?.(o.film);
      o.log(`sound design: ${added.map((a) => `${a.address} = ${a.sound}`).join(", ")}`);
      o.make = true;
    } else o.log("sound design: every scene already carries a sound, nothing added");
  }
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
