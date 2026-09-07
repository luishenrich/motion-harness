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


/* ---------- a music bed, synthesised ---------- */

/** chord progressions in semitones from the root, four chords, eight seconds each */
const BEDS: Record<string, { root: number; chords: number[][]; what: string; lowpass: number; pulse: boolean; noise: number }> = {
  calm: { root: 130.81, chords: [[0, 7, 12, 16], [-3, 4, 12, 16], [5, 12, 16, 21], [7, 11, 14, 19]], what: "a warm pad, C major, no pulse", lowpass: 1400, pulse: false, noise: 0.012 },
  warm: { root: 110, chords: [[0, 7, 12, 16], [0, 5, 12, 17], [-3, 4, 12, 16], [0, 7, 12, 16]], what: "a slow A major pad with a soft air", lowpass: 1100, pulse: false, noise: 0.02 },
  pulse: { root: 146.83, chords: [[0, 3, 7, 12], [-2, 3, 7, 10], [5, 8, 12, 15], [3, 7, 10, 15]], what: "a D minor pad with a quiet pulse", lowpass: 1800, pulse: true, noise: 0.008 },
};

export const BED_NAMES = Object.keys(BEDS);

const freq = (root: number, semis: number) => root * Math.pow(2, semis / 12);

/**
 * writes public/music/bed-<name>.wav: four chords of detuned sines under a slow envelope, looped to
 * `seconds`, low passed, a little air on top; not a composer's work, but a bed a silent film lacks
 */
export const ensureBed = async (projectDir: string, name: string, seconds = 64, opts: { force?: boolean; log?: (s: string) => void } = {}): Promise<string> => {
  const spec = BEDS[name];
  if (!spec) throw new Error(`no bed "${name}" (have ${BED_NAMES.join(", ")})`);
  const dir = join(projectDir, "public", "music");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `bed-${name}.wav`);
  if (existsSync(file) && !opts.force) return file;
  const seg = 8;
  const cycle = seg * spec.chords.length;
  // one expression per chord tone: the tone sounds only inside its chord's eight seconds, with a 1.5 s attack and release
  const voices = spec.chords.flatMap((chord, ci) =>
    chord.map((semi, vi) => {
      const f = freq(spec.root, semi).toFixed(3);
      const start = ci * seg;
      const env = `min(1,min((mod(t,${cycle})-${start})/1.5,(${start + seg}-mod(t,${cycle}))/1.5))*gte(mod(t,${cycle}),${start})*lt(mod(t,${cycle}),${start + seg})`;
      const det = vi % 2 ? 1.003 : 0.997;
      return `(${env})*(sin(2*PI*${f}*t)*0.5+sin(2*PI*${(parseFloat(f) * det).toFixed(3)}*t)*0.3+sin(2*PI*${(parseFloat(f) * 2).toFixed(3)}*t)*0.08)`;
    }),
  );
  const pulse = spec.pulse ? "*(0.75+0.25*sin(2*PI*1.6*t))" : "";
  const expr = `0.11*(${voices.join("+")})${pulse}`;
  const filters = `lowpass=f=${spec.lowpass},aecho=0.6:0.4:120|240:0.25|0.12,afade=t=in:st=0:d=2,afade=t=out:st=${Math.max(0, seconds - 3)}:d=3,alimiter=limit=0.7`;
  await run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", `aevalsrc='${expr}':s=48000:d=${seconds}`, "-f", "lavfi", "-i", `anoisesrc=d=${seconds}:c=pink:a=${spec.noise}:r=48000`, "-filter_complex", `[1:a]highpass=f=2000,lowpass=f=6000[n];[0:a][n]amix=inputs=2:normalize=0,${filters}`, "-ac", "2", "-ar", "48000", file]);
  opts.log?.(`bed ${name}: ${seconds}s, ${spec.what}`);
  return file;
};
