/**
 * Subtitles from the timeline: one entry per scene that carries `text` (the on-screen
 * copy) or `caption` (a line for scenes without copy). Times come from the compile,
 * so the file is never off by the frame a scene was retimed.
 */
import type { Compiled } from "../timeline/schema.ts";

export type SrtEntry = { index: number; start: number; end: number; text: string; scene: string };

const GAP = 0.04; // seconds between two entries so players never show both

export const srtEntries = (c: Compiled, opts: { useCaption?: boolean; fromSettled?: boolean } = {}): SrtEntry[] => {
  const out: SrtEntry[] = [];
  for (const s of c.scenes) {
    const text = s.text?.length ? s.text.join("\n") : opts.useCaption === false ? undefined : s.caption;
    if (!text) continue;
    const start = (s.filmStart + (opts.fromSettled === false ? 0 : Math.min(s.enter.dur ?? 0, s.dur - 1))) / c.fps;
    const end = s.filmEnd / c.fps - GAP;
    const prev = out[out.length - 1];
    // the same line over two scenes is one entry
    if (prev && prev.text === text && Math.abs(prev.end + GAP - s.filmStart / c.fps) < 0.5) {
      prev.end = end;
      continue;
    }
    out.push({ index: out.length + 1, start, end: Math.max(start + 0.5, end), text, scene: s.id });
  }
  return out;
};

export const fmtSrtTime = (t: number): string => {
  const ms = Math.round(Math.max(0, t) * 1000);
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000), r = ms % 1000;
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(h)}:${p(m)}:${p(s)},${p(r, 3)}`;
};

export const srtText = (entries: SrtEntry[]): string => entries.map((e) => `${e.index}\n${fmtSrtTime(e.start)} --> ${fmtSrtTime(e.end)}\n${e.text}\n`).join("\n") + (entries.length ? "\n" : "");

/** YouTube chapter list ("0:00 Title"), one line per subtitle entry, first entry pinned to 0:00 as YouTube requires */
export const chapterLines = (entries: SrtEntry[]): string[] => {
  const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
  return entries.map((e, i) => `${fmt(i === 0 ? 0 : e.start)} ${e.text.replace(/\n/g, " ")}`);
};
