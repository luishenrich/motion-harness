/**
 * Loudness as numbers, per platform. YouTube normalises to about -14 LUFS and
 * never raises a quiet upload; TikTok and Instagram publish no target and the
 * community lands around -14; Apple podcasts sit at -16. `measure` reads
 * integrated loudness, true peak and range with ffmpeg's ebur128, `normalize`
 * runs the two-pass loudnorm to a target without touching the picture.
 */
import { run } from "../util.ts";

export type Loudness = { lufs: number; truePeak: number; lra: number; threshold: number };

export type PlatformTarget = { lufs: number; truePeak: number; note: string };

export const PLATFORM_TARGETS: Record<string, PlatformTarget> = {
  youtube: { lufs: -14, truePeak: -1, note: "YouTube normalises down to about -14 LUFS and never up" },
  linkedin: { lufs: -14, truePeak: -1, note: "no published target; -14 matches the feed" },
  instagram: { lufs: -14, truePeak: -1, note: "no published target; reels sit around -14, some go to -12" },
  tiktok: { lufs: -14, truePeak: -1, note: "no published target; the feed is loud, -14 to -12" },
  x: { lufs: -14, truePeak: -1, note: "no published target" },
  apple: { lufs: -16, truePeak: -1, note: "Apple Podcasts and Music" },
  spotify: { lufs: -14, truePeak: -1, note: "Spotify normalises to -14" },
  broadcast: { lufs: -23, truePeak: -1, note: "EBU R128" },
};

/** integrated loudness, true peak, range: what the platform will measure */
export const measureLoudness = async (file: string): Promise<Loudness> => {
  const r = await run(["ffmpeg", "-hide_banner", "-nostats", "-i", file, "-vn", "-af", "ebur128=peak=true", "-f", "null", "-"], { quiet: true });
  const text = r.err + r.out;
  const pick = (re: RegExp) => {
    const m = text.match(re);
    return m ? parseFloat(m[1]) : NaN;
  };
  const lufs = pick(/Integrated loudness:[\s\S]*?I:\s*(-?[\d.]+) LUFS/);
  const lra = pick(/Loudness range:[\s\S]*?LRA:\s*(-?[\d.]+) LU/);
  const truePeak = pick(/True peak:[\s\S]*?Peak:\s*(-?[\d.]+) dBFS/);
  const threshold = pick(/Integrated loudness:[\s\S]*?Threshold:\s*(-?[\d.]+) LUFS/);
  if (!Number.isFinite(lufs)) throw new Error(`could not measure loudness of ${file}: ${text.slice(-400)}`);
  return { lufs, truePeak, lra, threshold };
};

/** two-pass loudnorm: measure, then linear gain toward the target where possible; video stream copied */
export const normalizeLoudness = async (input: string, output: string, target: PlatformTarget): Promise<{ before: Loudness; after: Loudness }> => {
  const before = await measureLoudness(input);
  const first = await run(["ffmpeg", "-hide_banner", "-nostats", "-i", input, "-vn", "-af", `loudnorm=I=${target.lufs}:TP=${target.truePeak}:LRA=11:print_format=json`, "-f", "null", "-"], { quiet: true });
  const m = (first.err + first.out).match(/\{[\s\S]*?\}/g);
  const stats = m ? (JSON.parse(m[m.length - 1]) as Record<string, string>) : null;
  const measured = stats ? `:measured_I=${stats.input_i}:measured_TP=${stats.input_tp}:measured_LRA=${stats.input_lra}:measured_thresh=${stats.input_thresh}:offset=${stats.target_offset}:linear=true` : "";
  await run(["ffmpeg", "-y", "-v", "error", "-i", input, "-c:v", "copy", "-af", `loudnorm=I=${target.lufs}:TP=${target.truePeak}:LRA=11${measured}`, "-ar", "48000", "-c:a", "aac", "-b:a", "256k", "-movflags", "+faststart", output]);
  const after = await measureLoudness(output);
  return { before, after };
};

export const loudnessVerdict = (l: Loudness, t: PlatformTarget): string => {
  const d = l.lufs - t.lufs;
  const peak = l.truePeak > t.truePeak ? `, true peak ${l.truePeak.toFixed(1)} dBTP over the ${t.truePeak} ceiling` : "";
  if (Math.abs(d) <= 1 && !peak) return "on target";
  if (d < -1) return `${(-d).toFixed(1)} LU quiet (the platform will not raise it)${peak}`;
  if (d > 1) return `${d.toFixed(1)} LU loud (the platform turns it down, dynamics survive)${peak}`;
  return `on level${peak}`;
};
