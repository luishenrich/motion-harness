/**
 * Every cue file as numbers: duration, attack (first sample above -40 dBFS to the
 * peak), tail (peak to the last sample above -40 dBFS), peak level. A "hit" that
 * takes 3 s to peak is a riser, and this is where that shows.
 */
import { basename } from "node:path";
import { decodeMono } from "./beats.ts";
import { db } from "./probe.ts";

export type SfxAnalysis = {
  seconds: number;
  /** seconds from the first sample above the floor to the peak */
  attack: number;
  /** seconds from the peak to the last sample above the floor */
  tail: number;
  /** seconds of leading silence before the first sample above the floor */
  lead: number;
  peak: number;
  peakDb: number;
  peakAt: number;
  /** true when no sample rises above the floor */
  silent: boolean;
};

/** -40 dBFS as a linear amplitude */
export const FLOOR = 0.01;

export const analyzeSamples = (samples: Float32Array, sr: number, floor = FLOOR): SfxAnalysis => {
  let peak = 0, peakIdx = 0, first = -1, last = -1;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    if (a > peak) {
      peak = a;
      peakIdx = i;
    }
    if (a > floor) {
      if (first < 0) first = i;
      last = i;
    }
  }
  const seconds = samples.length / sr;
  if (first < 0) return { seconds, attack: 0, tail: 0, lead: seconds, peak, peakDb: db(peak), peakAt: 0, silent: true };
  return { seconds, attack: (peakIdx - first) / sr, tail: (last - peakIdx) / sr, lead: first / sr, peak, peakDb: db(peak), peakAt: peakIdx / sr, silent: false };
};

export const analyzeFile = async (file: string, sr = 48000): Promise<SfxAnalysis> => analyzeSamples(await decodeMono(file, sr), sr);

const HIT = /hit|click|tap|pop|thud|impact/i;

/** a cue that is named like a percussive hit, by id or file name */
export const looksLikeHit = (id: string, file: string): boolean => HIT.test(id) || HIT.test(basename(file));

export const HIT_MAX_ATTACK = 0.15;
export const HIT_MAX_SECONDS = 1.5;

/** why a hit-named cue does not behave like one, or null when it does */
export const hitWarnings = (a: SfxAnalysis): string[] => {
  const out: string[] = [];
  if (a.silent) return ["no sample above -40 dBFS"];
  if (a.attack > HIT_MAX_ATTACK) out.push(`attack ${Math.round(a.attack * 1000)} ms, a hit should peak within ${Math.round(HIT_MAX_ATTACK * 1000)} ms (this is a riser or a swell)`);
  if (a.seconds > HIT_MAX_SECONDS) out.push(`${a.seconds.toFixed(2)} s long, a hit should be under ${HIT_MAX_SECONDS} s`);
  return out;
};
