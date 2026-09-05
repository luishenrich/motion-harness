/**
 * A beat-quantized duration is only a suggestion until the timeline rules agree:
 * the same lint that runs on the timeline runs on the changed durations, and a
 * change that adds a finding to its scene is dropped, with the reason.
 */
import type { LoadedConfig } from "../config.ts";
import { compile, type Compiled, type Timeline } from "../timeline/schema.ts";
import { lintTimeline, type Finding } from "../lint/lint.ts";

/** the timeline with some scene durations replaced, compiled again */
export const withDurations = (t: Timeline, durations: Record<string, number>): Compiled =>
  compile({
    ...t,
    parts: t.parts.map((p) => ({ ...p, scenes: p.scenes.map((s) => (durations[s.id] === undefined ? s : { ...s, dur: durations[s.id] })) })),
  });

const key = (f: Finding) => `${f.rule}|${f.where}`;
const ofScene = (f: Finding, id: string) => f.where === id || f.where.startsWith(`${id}.`) || f.where.startsWith(`${id}:`);

/**
 * Findings on `sceneId` that the changed durations cause: new ones, and, when the
 * scene gets shorter, ones it already had (a shorter scene never fixes them).
 */
export const vetDurations = (cfg: LoadedConfig, c: Compiled, durations: Record<string, number>, sceneId: string): Finding[] => {
  const before = new Set(lintTimeline(cfg, c).map(key));
  const after = lintTimeline(cfg, withDurations(c.timeline, durations));
  const was = c.scenes.find((s) => s.id === sceneId)?.dur ?? 0;
  const shorter = (durations[sceneId] ?? was) < was;
  return after.filter((f) => ofScene(f, sceneId) && (shorter || !before.has(key(f))));
};
