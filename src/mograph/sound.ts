/**
 * Sound design from the same data. A layer says `"sound": "pop"` and the
 * film gets an sfx cue at that layer's in; a scene's transition can say it
 * too. The bank is a handful of synthesised sounds ffmpeg writes on demand
 * (no downloads, no rights), a film can map its own files under `sounds`.
 * Cues are plain timeline audio cues, so mh audio, mh sfx and mh beats see
 * them like any other.
 */
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { AudioCue } from "../timeline/schema.ts";
import type { Layer, MgFilm, MgScene } from "./schema.ts";
import { run } from "../util.ts";

export type SoundRef = string | { name: string; gain?: number; /** frames after the layer's in (negative: before) */ at?: number };

/** name -> ffmpeg lavfi source and filter chain; every sound is short, mono, 48 kHz */
export const SOUND_BANK: Record<string, { source: string; filters: string; seconds: number; what: string }> = {
  pop: { source: "aevalsrc='0.7*sin(2*PI*(520+260*exp(-t*40))*t)*exp(-t*22)':d=0.3:s=48000", filters: "highpass=f=120,alimiter=limit=0.9", seconds: 0.3, what: "a soft pop for something that arrives with a scale" },
  tick: { source: "aevalsrc='2.4*(random(0)-0.5)*exp(-t*300)':d=0.08:s=48000", filters: "highpass=f=1800,lowpass=f=9000,volume=8dB,alimiter=limit=0.9", seconds: 0.08, what: "a dry tick for a counter step or a list item" },
  click: { source: "aevalsrc='0.8*sin(2*PI*1400*t)*exp(-t*140)':d=0.06:s=48000", filters: "highpass=f=400,alimiter=limit=0.9", seconds: 0.06, what: "a small click for a cursor or a toggle" },
  whoosh: { source: "anoisesrc=d=0.55:c=pink:a=1:r=48000", filters: "highpass=f=250,lowpass=f=5000,volume=9dB,afade=t=in:st=0:d=0.12:curve=qsin,afade=t=out:st=0.22:d=0.33:curve=qsin,alimiter=limit=0.85", seconds: 0.55, what: "air moving, for a slide or a wipe" },
  rise: { source: "aevalsrc='0.45*sin(2*PI*(180+700*t*t)*t)*min(1,t*3)':d=0.7:s=48000", filters: "afade=t=out:st=0.45:d=0.25,alimiter=limit=0.9", seconds: 0.7, what: "a sweep up, for a reveal that builds" },
  thud: { source: "aevalsrc='0.95*sin(2*PI*(64+40*exp(-t*30))*t)*exp(-t*10)':d=0.45:s=48000", filters: "lowpass=f=300,alimiter=limit=0.95", seconds: 0.45, what: "a low landing, for a drop or a heavy word" },
  ding: { source: "aevalsrc='0.45*(sin(2*PI*880*t)+0.5*sin(2*PI*1760*t)+0.2*sin(2*PI*2637*t))*exp(-t*3.5)':d=1.3:s=48000", filters: "alimiter=limit=0.9", seconds: 1.3, what: "a bell, for a result or a check mark" },
  swell: { source: "aevalsrc='0.4*(sin(2*PI*110*t)+0.5*sin(2*PI*165*t))*min(1,t*1.5)':d=1.6:s=48000", filters: "lowpass=f=900,afade=t=out:st=1.0:d=0.6,alimiter=limit=0.9", seconds: 1.6, what: "a low swell under a title" },
};

export const SOUND_NAMES = Object.keys(SOUND_BANK);

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

const refOf = (s: SoundRef | undefined): { name: string; gain: number; at: number } | null => (s === undefined ? null : typeof s === "string" ? { name: s, gain: 0.8, at: 0 } : { name: s.name, gain: s.gain ?? 0.8, at: s.at ?? 0 });

const walk = (layers: Layer[], prefix: string, fn: (l: Layer, addr: string) => void) => {
  for (const l of layers) {
    fn(l, prefix ? `${prefix}.${l.id}` : l.id);
    const kids = (l as { layers?: Layer[] }).layers;
    if (Array.isArray(kids)) walk(kids, prefix ? `${prefix}.${l.id}` : l.id, fn);
  }
};

/** the file a sound name points at: the film's own mapping first, then the bank under public/sfx */
export const soundFile = (film: MgFilm, name: string): string | null => {
  const own = (film as { sounds?: Record<string, string> }).sounds?.[name];
  if (own) return own.startsWith("public/") ? own : `public/${own}`;
  if (SOUND_BANK[name]) return `public/sfx/${name}.wav`;
  return null;
};

/** every `sound` on a layer or a scene as an sfx cue at the moment it belongs to */
export const soundCues = (film: MgFilm): AudioCue[] => {
  const cues: AudioCue[] = [];
  for (const s of film.scenes) {
    const sc = refOf((s as { sound?: SoundRef }).sound);
    if (sc) {
      const file = soundFile(film, sc.name);
      if (file) cues.push({ id: `${s.id}-sound`, kind: "sfx", file, at: sc.at ? `${s.id}+${Math.max(0, sc.at)}` : `${s.id}+0`, gain: sc.gain });
    }
    walk(s.layers, "", (l, addr) => {
      const r = refOf((l as { sound?: SoundRef }).sound);
      if (!r) return;
      const file = soundFile(film, r.name);
      if (!file) return;
      const top = addr.split(".")[0];
      cues.push({ id: `${s.id}-${addr.replace(/\./g, "-")}-sound`, kind: "sfx", file, at: r.at ? `${s.id}.${top}In${r.at > 0 ? `+${r.at}` : r.at}` : `${s.id}.${top}In`, gain: r.gain });
    });
  }
  return cues;
};

/** names used by the film that neither the bank nor `sounds` knows */
export const unknownSounds = (film: MgFilm): { where: string; name: string }[] => {
  const out: { where: string; name: string }[] = [];
  for (const s of film.scenes) {
    const sc = refOf((s as { sound?: SoundRef }).sound);
    if (sc && !soundFile(film, sc.name)) out.push({ where: `${s.id}.sound`, name: sc.name });
    walk(s.layers, "", (l, addr) => {
      const r = refOf((l as { sound?: SoundRef }).sound);
      if (r && !soundFile(film, r.name)) out.push({ where: `${s.id}.${addr}.sound`, name: r.name });
    });
  }
  return out;
};

/** the bank names a film uses (to generate only those) */
export const soundsUsed = (film: MgFilm): string[] => {
  const names = new Set<string>();
  for (const s of film.scenes) {
    const sc = refOf((s as { sound?: SoundRef }).sound);
    if (sc && SOUND_BANK[sc.name]) names.add(sc.name);
    walk(s.layers, "", (l) => {
      const r = refOf((l as { sound?: SoundRef }).sound);
      if (r && SOUND_BANK[r.name]) names.add(r.name);
    });
  }
  return [...names];
};
