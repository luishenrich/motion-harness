/** Generate the edit decision list as markdown from the compiled timeline. Never hand-edit the output. */
import { type Compiled, fmtTime } from "./schema.ts";

export const timelineMarkdown = (c: Compiled, title = "Timeline"): string => {
  const L: string[] = [];
  L.push(`# ${title}`);
  L.push("");
  L.push(`Generated from the timeline definition. ${c.scenes.length} scenes, ${c.parts.length} part${c.parts.length === 1 ? "" : "s"}, ${c.dur} frames at ${c.fps} fps = ${c.seconds.toFixed(2)} s. Do not edit by hand, change the timeline and regenerate.`);
  L.push("");
  for (const p of c.parts) {
    L.push(`## Part ${p.id}`);
    L.push("");
    L.push(`Composition: ${typeof p.composition === "string" ? p.composition : Object.entries(p.composition).map(([k, v]) => `${k}=${v}`).join(", ")}. ${p.dur} frames (${(p.dur / c.fps).toFixed(2)} s), film ${fmtTime(p.filmStart, c.fps)} to ${fmtTime(p.filmEnd, c.fps)}${p.overlap ? `, overlap ${p.overlap}` : ""}.`);
    L.push("");
    L.push("| # | scene | film in | film out | dur | part frames | enter | ground | events | why |");
    L.push("|---|---|---|---|---|---|---|---|---|---|");
    for (const s of p.scenes) {
      const ev = s.events.map((e) => `${e.name}@${e.local}`).join(" ");
      L.push(`| ${s.index} | ${s.id} | ${fmtTime(s.filmStart, c.fps)} | ${fmtTime(s.filmEnd, c.fps)} | ${s.dur} (${(s.dur / c.fps).toFixed(2)}s) | ${s.start}-${s.end - 1} | ${s.enter.type}${s.enter.dur ? ` ${s.enter.dur}f` : ""} | ${s.ground ?? ""} | ${ev} | ${s.why ?? ""} |`);
    }
    L.push("");
  }
  if (c.timeline.audio?.length) {
    L.push("## Audio");
    L.push("");
    L.push("| id | kind | file | at | gain | ramps | fade out |");
    L.push("|---|---|---|---|---|---|---|");
    for (const a of c.timeline.audio) {
      L.push(`| ${a.id} | ${a.kind} | ${a.file} | ${a.at} | ${a.gain ?? 1} | ${(a.ramps ?? []).map((r) => `${r.at}→${r.to}${r.over ? ` over ${r.over}s` : ""}`).join(", ")} | ${a.fadeOut ?? ""} |`);
    }
    L.push("");
  }
  return L.join("\n");
};

export const timelineJson = (c: Compiled) =>
  JSON.stringify(
    {
      fps: c.fps,
      dur: c.dur,
      seconds: c.seconds,
      parts: c.parts.map((p) => ({ id: p.id, composition: p.composition, dur: p.dur, filmStart: p.filmStart, filmEnd: p.filmEnd, overlap: p.overlap })),
      scenes: c.scenes.map((s) => ({
        index: s.index,
        part: s.part,
        id: s.id,
        dur: s.dur,
        start: s.start,
        end: s.end,
        filmStart: s.filmStart,
        filmEnd: s.filmEnd,
        settled: s.settled,
        enter: s.enter,
        ground: s.ground,
        text: s.text,
        why: s.why,
        events: s.events,
        states: s.states,
        probes: s.probes,
      })),
      audio: c.timeline.audio ?? [],
    },
    null,
    2,
  );
