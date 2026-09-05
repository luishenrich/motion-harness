/**
 * Resolve any way a human or an agent refers to a moment in the film into one
 * location: part, scene, local frame, part frame, film frame, film seconds.
 *
 * Accepted forms:
 *   "20.5s" | "20.5" | "0:20.5"      film seconds
 *   "f830"                           film frame
 *   "product:f120" | "product:4.2s"  part-local frame or seconds
 *   "probe"                          scene start
 *   "probe.pick1"                    named event
 *   "probe.mid" | "probe.end" | "probe.settled"   reserved events
 *   "probe+12" | "probe-3"           scene-local offset (negative counts from the end)
 *   "#7"                             scene by film index
 */
import { compile, type Compiled, type CompiledScene, fmtTime } from "./schema.ts";

export type Location = {
  part: string;
  scene: CompiledScene;
  local: number;
  partFrame: number;
  filmFrame: number;
  filmSeconds: number;
  /** nearest named event at or before this frame, if any */
  event?: { name: string; local: number; distance: number };
  /** true when the frame is still inside the enter transition */
  inTransition: boolean;
  label: string;
};

const parseSeconds = (s: string): number | null => {
  const m = s.match(/^(?:(\d+):)?(\d+(?:\.\d+)?)s?$/);
  if (!m) return null;
  return (m[1] ? parseInt(m[1], 10) * 60 : 0) + parseFloat(m[2]);
};

export const locate = (c: Compiled, filmFrame: number): Location => {
  const frame = Math.max(0, Math.min(c.dur - 1, Math.round(filmFrame)));
  const scene = c.scenes.find((s) => frame >= s.filmStart && frame < s.filmEnd) ?? c.scenes[c.scenes.length - 1];
  const part = c.parts.find((p) => p.id === scene.part)!;
  const partFrame = frame - part.filmStart;
  const local = frame - scene.filmStart;
  const before = scene.events.filter((e) => e.local <= local).sort((a, b) => b.local - a.local)[0];
  const inTransition = local < (scene.enter.dur ?? 0);
  return {
    part: part.id,
    scene,
    local,
    partFrame,
    filmFrame: frame,
    filmSeconds: frame / c.fps,
    event: before ? { name: before.name, local: before.local, distance: local - before.local } : undefined,
    inTransition,
    label: `${scene.id}+${local} (${part.id} f${partFrame}, film f${frame} ${fmtTime(frame, c.fps)})`,
  };
};

/** like resolve, but the result may lie before the film starts (negative film frame), used for audio that begins early */
export const resolveUnclamped = (c: Compiled, ref: string | number): { filmFrame: number; filmSeconds: number } => {
  if (typeof ref === "string") {
    const m = ref.trim().match(/^(.+?)\s*([+-])\s*(\d+(?:\.\d+)?)s$/);
    if (m) {
      const base = resolve(c, m[1]).filmFrame;
      const off = Math.round(parseFloat(m[3]) * c.fps) * (m[2] === "-" ? -1 : 1);
      const f = base + off;
      return { filmFrame: f, filmSeconds: f / c.fps };
    }
  }
  const L = resolve(c, ref);
  return { filmFrame: L.filmFrame, filmSeconds: L.filmSeconds };
};

export const resolve = (c: Compiled, ref: string | number): Location => {
  if (typeof ref === "number") return locate(c, Math.round(ref * c.fps));
  const r = ref.trim();

  // "<ref> - 9s" / "<ref> + 1.5s": seconds offset from any other reference
  if (/^(.+?)\s*([+-])\s*(\d+(?:\.\d+)?)s$/.test(r)) return locate(c, resolveUnclamped(c, r).filmFrame);

  if (r.startsWith("#")) {
    const i = parseInt(r.slice(1), 10);
    const s = c.scenes[i];
    if (!s) throw new Error(`no scene #${i} (film has ${c.scenes.length})`);
    return locate(c, s.filmStart);
  }
  if (/^f\d+$/.test(r)) return locate(c, parseInt(r.slice(1), 10));
  const secs = parseSeconds(r);
  if (secs !== null) return locate(c, Math.round(secs * c.fps));

  const partRef = r.match(/^([\w-]+):(.+)$/);
  if (partRef) {
    const part = c.parts.find((p) => p.id === partRef[1]);
    if (!part) throw new Error(`no part "${partRef[1]}" (parts: ${c.parts.map((p) => p.id).join(", ")})`);
    const rest = partRef[2];
    if (/^f\d+$/.test(rest)) return locate(c, part.filmStart + parseInt(rest.slice(1), 10));
    const ps = parseSeconds(rest);
    if (ps !== null) return locate(c, part.filmStart + Math.round(ps * c.fps));
    throw new Error(`cannot read "${rest}" after part "${part.id}" (use f120 or 4.2s)`);
  }

  // scene ids may contain hyphens followed by a letter ("tv-off"); a hyphen followed by digits is an offset
  const sceneRef = r.match(/^(\w+(?:-[A-Za-z_]\w*)*)(?:\.(\w+(?:-[A-Za-z_]\w*)*))?(?:([+-])(\d+))?$/);
  if (!sceneRef) throw new Error(`cannot resolve "${r}"`);
  const [, sceneId, eventName, sign, offsetStr] = sceneRef;
  const scene = c.scenes.find((s) => s.id === sceneId);
  if (!scene) {
    // a part id stands for the first frame of that part ("product", "product+12", "product - 9s")
    const part = c.parts.find((p) => p.id === sceneId);
    if (part && !eventName) return locate(c, part.filmStart + (sign ? (sign === "+" ? 1 : -1) * parseInt(offsetStr, 10) : 0));
    const near = c.scenes.filter((s) => s.id.toLowerCase().includes(sceneId.toLowerCase())).map((s) => s.id);
    throw new Error(`no scene "${sceneId}"${near.length ? `, did you mean ${near.join(", ")}` : ""}`);
  }
  let local = 0;
  if (eventName) {
    if (eventName === "mid") local = Math.floor(scene.dur / 2);
    else if (eventName === "end") local = scene.dur - 1;
    else if (eventName === "settled") local = scene.settled - scene.start;
    else {
      const ev = scene.events.find((e) => e.name === eventName);
      if (!ev) throw new Error(`scene "${scene.id}" has no event "${eventName}" (events: ${scene.events.map((e) => e.name).join(", ") || "none"})`);
      local = ev.local;
    }
  }
  if (sign) {
    const n = parseInt(offsetStr, 10);
    local = sign === "+" ? local + n : eventName ? local - n : scene.dur - n;
  }
  return locate(c, scene.filmStart + local);
};

/** every frame a QA pass should look at for one scene, with a reason */
export type CheckFrame = { local: number; partFrame: number; filmFrame: number; kind: "transition" | "settled" | "event" | "mid" | "end" | "check" | "dense"; label: string };

export const checkFramesFor = (scene: CompiledScene, opts: { dense?: number; afterEvent?: number; eventWindow?: [number, number, number] | false } = {}): CheckFrame[] => {
  const out: CheckFrame[] = [];
  const push = (local: number, kind: CheckFrame["kind"], label: string) => {
    const l = Math.max(0, Math.min(scene.dur - 1, local));
    if (out.some((o) => o.local === l)) return;
    out.push({ local: l, partFrame: scene.start + l, filmFrame: scene.filmStart + l, kind, label });
  };
  const enterDur = scene.enter.dur ?? 0;
  if (enterDur > 0) {
    push(0, "transition", "enter start");
    push(Math.floor(enterDur / 2), "transition", "enter mid");
  }
  push(enterDur, "settled", "settled");
  for (const e of scene.events) {
    push(e.local, "event", e.name);
    push(e.local + (opts.afterEvent ?? 6), "event", `${e.name}+${opts.afterEvent ?? 6}`);
  }
  for (const s of scene.states) push(s.local, "event", `state ${s.id}`);
  push(Math.floor(scene.dur / 2), "mid", "mid");
  for (const f of scene.checkFrames) push(f, "check", `check ${f}`);
  push(scene.dur - 1, "end", "last");
  if (opts.dense) for (let f = 0; f < scene.dur; f += opts.dense) push(f, "dense", `every ${opts.dense}`);
  // a gesture lives in the frames around its event: event-6 .. event+18 at 2 f steps, always, capped to the scene
  if (opts.eventWindow !== false) {
    const [before, after, step] = opts.eventWindow ?? EVENT_WINDOW;
    for (const e of scene.events) {
      for (let off = -before; off <= after; off += step) {
        const l = e.local + off;
        if (l < 0 || l >= scene.dur) continue;
        push(l, "dense", `${e.name}${off < 0 ? "" : "+"}${off}`);
      }
    }
  }
  return out.sort((a, b) => a.local - b.local);
};

/** frames before, frames after, step */
export const EVENT_WINDOW: [number, number, number] = [6, 18, 2];

export { compile };
