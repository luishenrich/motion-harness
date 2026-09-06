/**
 * The escape hatch into the editor: the timeline as an OpenTimelineIO document,
 * one video track, one clip per scene pointing at the rendered segment file.
 * DaVinci Resolve, Premiere (via plugin) and Final Cut (via otioconvert) open it
 * and the editor gets the cut with the scene names, not one flat mp4.
 */
import type { Compiled } from "../timeline/schema.ts";

export type OtioClipSource = { sceneId: string; file: string };

const rt = (value: number, rate: number) => ({ OTIO_SCHEMA: "RationalTime.1", rate, value });
const range = (start: number, dur: number, rate: number) => ({ OTIO_SCHEMA: "TimeRange.1", start_time: rt(start, rate), duration: rt(dur, rate) });

export const otioDocument = (c: Compiled, name: string, sources: OtioClipSource[], opts: { audio?: string; gapsAsBlack?: boolean } = {}) => {
  const rate = c.fps;
  const byScene = new Map(sources.map((s) => [s.sceneId, s.file]));
  const children: unknown[] = [];
  let at = 0;
  for (const part of c.parts) {
    if (part.gap > 0) {
      children.push({ OTIO_SCHEMA: "Gap.1", name: `gap before ${part.id}`, source_range: range(0, part.gap, rate), effects: [], markers: [], metadata: {} });
      at += part.gap;
    }
    for (const s of part.scenes) {
      const file = byScene.get(s.id);
      const markers = s.events.map((e) => ({ OTIO_SCHEMA: "Marker.2", name: e.name, color: "BLUE", marked_range: range(e.local, 1, rate), metadata: { mh: { event: e.name, local: e.local } } }));
      children.push({
        OTIO_SCHEMA: "Clip.2",
        name: s.id,
        source_range: range(0, s.dur, rate),
        effects: [],
        markers,
        metadata: { mh: { part: s.part, index: s.index, filmStart: s.filmStart, ground: s.ground ?? null, text: s.text ?? null, why: s.why ?? null, enter: s.enter, exit: s.exit ?? null } },
        media_references: file ? { DEFAULT_MEDIA: { OTIO_SCHEMA: "ExternalReference.1", name: s.id, target_url: file.startsWith("/") ? `file://${file}` : file, available_range: range(0, s.dur, rate), metadata: {} } } : { DEFAULT_MEDIA: { OTIO_SCHEMA: "MissingReference.1", name: `${s.id} (not rendered)`, metadata: {} } },
        active_media_reference_key: "DEFAULT_MEDIA",
        enabled: true,
      });
      at += s.dur;
    }
  }
  const tracks: unknown[] = [{ OTIO_SCHEMA: "Track.1", name: "V1 scenes", kind: "Video", children, source_range: null, effects: [], markers: [], metadata: {} }];
  if (opts.audio) {
    tracks.push({
      OTIO_SCHEMA: "Track.1",
      name: "A1 mix",
      kind: "Audio",
      children: [{ OTIO_SCHEMA: "Clip.2", name: "mix", source_range: range(0, c.dur, rate), effects: [], markers: [], metadata: {}, media_references: { DEFAULT_MEDIA: { OTIO_SCHEMA: "ExternalReference.1", name: "mix", target_url: opts.audio.startsWith("/") ? `file://${opts.audio}` : opts.audio, available_range: range(0, c.dur, rate), metadata: {} } }, active_media_reference_key: "DEFAULT_MEDIA", enabled: true }],
      source_range: null,
      effects: [],
      markers: [],
      metadata: {},
    });
  }
  return {
    OTIO_SCHEMA: "Timeline.1",
    name,
    global_start_time: rt(0, rate),
    metadata: { mh: { fps: c.fps, frames: c.dur, seconds: c.seconds, parts: c.parts.map((p) => ({ id: p.id, filmStart: p.filmStart, dur: p.dur })) } },
    tracks: { OTIO_SCHEMA: "Stack.1", name: "tracks", children: tracks, source_range: null, effects: [], markers: [], metadata: {} },
  };
};
