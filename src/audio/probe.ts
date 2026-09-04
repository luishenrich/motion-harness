/**
 * Sound as numbers: RMS per window over a media file, checked against the audio
 * cues of the timeline ("music lifts at product.start", "foley in the first
 * second"). Needs ffmpeg on the PATH.
 */


export type AudioProfile = { file: string; seconds: number; window: number; rms: number[]; peak: number; silentUntil: number | null };

export const audioProfile = async (file: string, windowSec = 0.25): Promise<AudioProfile> => {
  const proc = Bun.spawn(["ffmpeg", "-v", "error", "-i", file, "-vn", "-ac", "1", "-ar", "8000", "-f", "f32le", "-"], { stdout: "pipe", stderr: "pipe" });
  const [buf, err] = await Promise.all([new Response(proc.stdout).arrayBuffer().then((b) => Buffer.from(b)), new Response(proc.stderr).text()]);
  const code = await proc.exited;
  if (code !== 0) throw new Error(`ffmpeg failed on ${file}: ${err.slice(-500)}`);
  const samples = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
  const sr = 8000;
  const win = Math.round(windowSec * sr);
  const rms: number[] = [];
  let peak = 0;
  for (let i = 0; i < samples.length; i += win) {
    let s = 0;
    const end = Math.min(samples.length, i + win);
    for (let j = i; j < end; j++) {
      const v = samples[j];
      s += v * v;
      const a = Math.abs(v);
      if (a > peak) peak = a;
    }
    rms.push(Math.sqrt(s / Math.max(1, end - i)));
  }
  let silentUntil: number | null = null;
  const first = rms.findIndex((x) => x > 0.002);
  if (first > 0) silentUntil = first * windowSec;
  if (first < 0) silentUntil = samples.length / sr;
  return { file, seconds: samples.length / sr, window: windowSec, rms, peak, silentUntil };
};

export const rmsAt = (p: AudioProfile, seconds: number) => p.rms[Math.min(p.rms.length - 1, Math.max(0, Math.floor(seconds / p.window)))] ?? 0;

export const db = (x: number) => (x <= 0 ? -Infinity : 20 * Math.log10(x));
