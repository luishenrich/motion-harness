/**
 * The film about the tool. Built with the Remotion API, rendered by the native
 * engine, checked with mh. Every element that matters carries a data-probe so
 * the lints and the cursor can find it.
 */
import React from "react";
import { AbsoluteFill, Easing, Sequence, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { compile } from "../../../src/timeline/schema.ts";
import { timeline, SCENES, FADE } from "./timeline.ts";

const c = compile(timeline);
const scene = (id: string) => c.scenes.find((s) => s.id === id)!;

export const INK = "#1C1A17", CREAM = "#F7F4E3", GOLD = "#FFBC14", FOREST = "#1D4B3A", PAPER = "#FBF9EF", MUTED = "#6B6459";
const SANS = "-apple-system, 'Helvetica Neue', Helvetica, Arial, sans-serif";
const MONO = "ui-monospace, Menlo, Monaco, Consolas, monospace";

const rise = (frame: number, at: number, dur = 14) => {
  const p = interpolate(frame, [at, at + dur], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  return { opacity: p, transform: `translateY(${(1 - p) * 18}px)` };
};

const Ground: React.FC<{ dark?: boolean; children: React.ReactNode }> = ({ dark, children }) => <AbsoluteFill style={{ backgroundColor: dark ? INK : CREAM, color: dark ? CREAM : INK, fontFamily: SANS }}>{children}</AbsoluteFill>;

const Fade: React.FC<{ dur: number; children: React.ReactNode }> = ({ dur, children }) => {
  const f = useCurrentFrame();
  const o = interpolate(f, [0, 10, dur - FADE.dur, dur - 1], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return <AbsoluteFill style={{ opacity: o }}>{children}</AbsoluteFill>;
};

const Title: React.FC<{ story: boolean }> = ({ story }) => {
  const f = useCurrentFrame();
  const chars = Math.floor(interpolate(f, [6, 40], [0, 14], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  return (
    <Ground dark>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", padding: story ? "0 80px" : "0 200px", boxSizing: "border-box" }}>
        <div data-probe="wordmark" style={{ fontFamily: MONO, fontSize: story ? 64 : 84, letterSpacing: -2, color: CREAM }}>
          {"motion-harness".slice(0, chars)}
          <span style={{ color: GOLD, opacity: f % 20 < 10 ? 1 : 0 }}>_</span>
        </div>
        <div data-probe="claim" data-lines={story ? 2 : 1} style={{ ...rise(f, 44), marginTop: 28, fontSize: story ? 44 : 40, lineHeight: 1.3, textAlign: "center", color: CREAM, maxWidth: story ? 900 : 1400 }}>
          Eyes and hands for AI agents that make videos.
        </div>
      </AbsoluteFill>
    </Ground>
  );
};

const Terminal: React.FC<{ story: boolean }> = ({ story }) => {
  const f = useCurrentFrame();
  const { typed, answer } = SCENES.resolve.events;
  const cmd = "mh resolve 21s";
  const n = Math.floor(interpolate(f, [8, typed], [0, cmd.length], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  const w = story ? 940 : 1280;
  return (
    <Ground dark>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <div data-probe="terminal" style={{ width: w, borderRadius: 16, background: "#0F0E0C", border: "1px solid rgba(247,244,227,0.14)", padding: story ? "28px 32px" : "32px 40px", fontFamily: MONO, fontSize: story ? 28 : 30, lineHeight: 1.7, color: CREAM, boxShadow: "0 30px 80px rgba(0,0,0,0.45)" }}>
          <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
            {["#FF5F57", "#FEBC2E", "#28C840"].map((k) => <span key={k} style={{ width: 14, height: 14, borderRadius: 7, background: k, display: "inline-block" }} />)}
          </div>
          <div data-probe="prompt"><span style={{ color: GOLD }}>$ </span>{cmd.slice(0, n)}<span style={{ opacity: f < typed && f % 16 < 8 ? 1 : 0 }}>▌</span></div>
          <div style={{ ...rise(f, answer, 10), color: CREAM }}>
            21s{"  "}<span style={{ color: MUTED }}>{"->"}</span>{"  "}<span style={{ color: GOLD }}>probe+14</span>{"   "}<span style={{ color: MUTED }}>part product f310   film f630 21.00s   after pick1+2</span>
          </div>
          <div style={{ ...rise(f, answer + 8, 10), color: MUTED, fontSize: story ? 24 : 26 }}>scene probe: part frames 296-373 (78f), enter cut, events pick1@12 next@24</div>
        </div>
        <div style={{ ...rise(f, answer + 16), marginTop: 36, fontSize: story ? 36 : 34, color: CREAM }}>Every moment has an address.</div>
      </AbsoluteFill>
    </Ground>
  );
};

const TILE_LABELS = ["probe+0", "probe+6", "probe+12", "probe+14", "probe+18", "probe+24", "probe+30", "probe+39", "probe+52", "probe+66", "probe+70", "probe+77"];
const TILE_KIND = ["settled", "event", "event", "dense", "dense", "event", "mid", "settled", "check", "event", "dense", "end"];
const KIND_COLOR: Record<string, string> = { settled: "#6B6B6B", event: "#2F6FDE", dense: "#9A9A9A", mid: "#6B6B6B", check: "#8E44AD", end: "#6B6B6B", transition: "#E8871E" };

const Sheet: React.FC<{ story: boolean }> = ({ story }) => {
  const f = useCurrentFrame();
  const { tiles, badge } = SCENES.frames.events;
  const cols = story ? 3 : 4;
  const tw = story ? 290 : 380, th = Math.round(tw * 9 / 16);
  return (
    <Ground>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <div data-probe="sheet" style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, ${tw}px)`, gap: 14, padding: 20, background: "#E4E2DC", borderRadius: 12 }}>
          {TILE_LABELS.map((label, i) => {
            const at = tiles + i * 4;
            const p = interpolate(f, [at, at + 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
            const hue = 34 + (i % 4) * 6;
            return (
              <div key={label} data-lint="no-collision" style={{ opacity: p, transform: `scale(${0.92 + 0.08 * p})`, width: tw, background: "#fff", borderRadius: 6, overflow: "hidden" }}>
                <div style={{ height: th, background: `linear-gradient(135deg, hsl(${hue} 60% ${22 + i * 2}%), hsl(${hue + 20} 70% 45%))`, position: "relative" }}>
                  <div style={{ position: "absolute", left: 14 + (i % 3) * 8, top: 12 + (i % 2) * 6, width: tw * 0.55, height: 10, background: "rgba(247,244,227,0.9)", borderRadius: 3 }} />
                  <div style={{ position: "absolute", left: 14 + (i % 3) * 8, top: 30 + (i % 2) * 6, width: tw * 0.35, height: 8, background: "rgba(247,244,227,0.6)", borderRadius: 3 }} />
                  <div style={{ position: "absolute", right: 16, bottom: 14, width: 64, height: 22, background: GOLD, borderRadius: 4 }} />
                </div>
                <div style={{ height: 36, display: "flex", alignItems: "center", gap: 8, padding: "0 10px", fontFamily: SANS }}>
                  <span style={{ width: 8, height: 8, borderRadius: 4, background: KIND_COLOR[TILE_KIND[i]] }} />
                  <span style={{ fontSize: 15, fontWeight: 700, color: "#111" }}>{label}</span>
                  <span style={{ fontSize: 12, color: "#555" }}>{TILE_KIND[i]}</span>
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ ...rise(f, badge), marginTop: 30, fontSize: story ? 36 : 34, color: INK }}>Frames in seconds, not renders in minutes.</div>
      </AbsoluteFill>
    </Ground>
  );
};

const ROWS: [string, string, string][] = [
  ["typecheck", "pass", ""],
  ["lint static+timeline", "pass", "2 warnings"],
  ["cursor wide", "pass", "cursor-targets.ts unchanged"],
  ["doctor wide", "pass", ""],
  ["frames+sheets wide", "pass", "probe -> run check-171743"],
  ["lint rendered wide", "pass", "0 warnings"],
];

const Check: React.FC<{ story: boolean }> = ({ story }) => {
  const f = useCurrentFrame();
  const { rows, verdict } = SCENES.check.events;
  const w = story ? 940 : 1200;
  return (
    <Ground>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <div data-probe="table" style={{ width: w, background: PAPER, borderRadius: 14, boxShadow: "0 20px 60px rgba(28,26,23,0.12)", overflow: "hidden", fontFamily: MONO, fontSize: story ? 26 : 26 }}>
          <div style={{ padding: "18px 28px", borderBottom: `1px solid rgba(28,26,23,0.12)`, color: MUTED }}><span style={{ color: FOREST }}>$ </span>mh check --scene probe --format all</div>
          {ROWS.map(([step, state, detail], i) => {
            const at = rows + i * 10;
            const p = interpolate(f, [at, at + 8], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
            return (
              <div key={step} style={{ display: "grid", gridTemplateColumns: story ? "1fr 90px" : "360px 90px 1fr", gap: 16, alignItems: "center", padding: "12px 28px", opacity: p, transform: `translateX(${(1 - p) * -10}px)`, borderBottom: "1px solid rgba(28,26,23,0.06)" }}>
                <span style={{ color: INK }}>{step}</span>
                <span style={{ display: "inline-block", padding: "2px 10px", borderRadius: 999, background: FOREST, color: CREAM, fontSize: 20, textAlign: "center" }}>{state}</span>
                {story ? null : <span style={{ color: MUTED, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{detail}</span>}
              </div>
            );
          })}
          <div style={{ ...rise(f, verdict, 10), padding: "18px 28px", color: FOREST, fontWeight: 700 }}>all steps passed</div>
        </div>
        <div style={{ ...rise(f, verdict + 6), marginTop: 30, fontSize: story ? 36 : 34, color: INK }}>One command checks an edit.</div>
      </AbsoluteFill>
    </Ground>
  );
};

const Numbers: React.FC<{ story: boolean }> = ({ story }) => {
  const f = useCurrentFrame();
  const { second, third } = SCENES.numbers.events;
  const items: [string, string, string, number][] = [["n1", "40 ms", "a frame", 4], ["n2", "60 s", "a film", second], ["n3", "0", "credits", third]];
  return (
    <Ground dark>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", flexDirection: story ? "column" : "row", gap: story ? 70 : 140 }}>
        {items.map(([key, big, small, at]) => (
          <div key={key} data-probe={key} style={{ ...rise(f, at, 16), textAlign: "center" }}>
            <div style={{ fontFamily: MONO, fontSize: story ? 120 : 150, letterSpacing: -4, color: GOLD, lineHeight: 1 }}>{big}</div>
            <div style={{ marginTop: 14, fontSize: story ? 36 : 34, color: CREAM }}>{small}</div>
          </div>
        ))}
      </AbsoluteFill>
    </Ground>
  );
};

const End: React.FC<{ story: boolean }> = ({ story }) => {
  const f = useCurrentFrame();
  const { url } = SCENES.end.events;
  return (
    <Ground dark>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <div data-probe="cmd" style={{ ...rise(f, 4), fontFamily: MONO, fontSize: story ? 56 : 72, color: CREAM }}>
          <span style={{ color: GOLD }}>$ </span>npx motion-harness
        </div>
        <div data-lines={story ? 2 : 1} style={{ ...rise(f, url), marginTop: 30, fontSize: story ? 30 : 32, lineHeight: 1.4, color: MUTED, textAlign: "center", maxWidth: story ? 860 : 1500, padding: "0 40px" }}>github.com/luishenrich/motion-harness · MIT · skills for Claude Code, Codex, Cursor</div>
      </AbsoluteFill>
    </Ground>
  );
};

export const Film: React.FC<{ story?: boolean }> = ({ story = false }) => {
  const { width } = useVideoConfig();
  const s = story || width < 1200;
  const order: [string, React.FC<{ story: boolean }>][] = [["title", Title], ["resolve", Terminal], ["frames", Sheet], ["check", Check], ["numbers", Numbers], ["end", End]];
  return (
    <AbsoluteFill style={{ backgroundColor: INK }}>
      {order.map(([id, C]) => {
        const sc = scene(id);
        return (
          <Sequence key={id} from={sc.start} durationInFrames={sc.dur}>
            <Fade dur={sc.dur}>
              <C story={s} />
            </Fade>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

export const FILM_DURATION = c.dur;
