/**
 * Hand-written Remotion equivalent of the "hook" and "speed" scenes from
 * examples/mograph/film.mograph.json, written the way a developer would
 * write it directly against the Remotion API (no motion-harness imports).
 * Not wired into any project; written only to count lines against the JSON.
 *
 * Scope, to keep the comparison honest:
 * - one format only (1920x1080 wide). The JSON scenes also carry vertical
 *   overrides (size, position, width) for both scenes; adding a real
 *   vertical layout here would mean a parallel set of constants and either
 *   a duplicated component or a "format" prop threaded through every
 *   position and size below - see the notes at the bottom of the file.
 * - fonts are declared but font loading (Google Fonts fetch + @import),
 *   design-token color naming (colorOf, "accent" | "muted" | hex), and
 *   image fitting are all skipped as out of scope for two scenes; the JSON
 *   format gets them for free from the shared runtime (src/mograph/runtime.tsx).
 * - no lint, no probe attributes (data-probe / data-mg), no events
 *   (hook.lineSettled etc). Those exist for every layer in the JSON file
 *   for free; here they would have to be hand-added and hand-kept in sync.
 */
import React from "react";
import { AbsoluteFill, Easing, Sequence, interpolate, useCurrentFrame } from "remotion";

// ---- design tokens, hand-copied from film.mograph.json's "design" object ----
const INK = "#12151A";
const PAPER = "#F2EEE6";
const ACCENT = "#F2B441";
const MUTED = "#5F6670";
const TEAL = "#3FB9A8";
const FONT_DISPLAY = "'Sora', -apple-system, 'Helvetica Neue', Helvetica, Arial, sans-serif";
const FONT_BODY = "'Inter Tight', -apple-system, 'Helvetica Neue', Helvetica, Arial, sans-serif";

// the JSON's "settle" easing: cubic-bezier(0.2, 0.9, 0.1, 1)
const settle = Easing.bezier(0.2, 0.9, 0.1, 1);

/** scene-level fade in/out over the ground color (the JSON's "exit": { type: "fade", dur: 8 } on every scene but the last) */
const useSceneFade = (frame: number, dur: number, exitDur: number) =>
  interpolate(frame, [Math.max(0, dur - 1 - exitDur), dur - 1], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

// ============================== hook scene ==============================
// text "An agent cannot *see* its own video." size 104 color paper, rise-in
// staggered by word (each 3f, dur 16f, ease out), at (0.5, 0.47), maxWidth 0.8
// shape line, w 220 thickness 6 fill accent, grow-in at 30 dur 14, at (0.5, 0.6)

const HOOK_TEXT = "An agent cannot *see* its own video.";
const HOOK_WORDS = HOOK_TEXT.split(/(\s+)/).filter((w) => w.length > 0);

/** *word* renders in the accent color; every other run of text is plain */
const renderMarked = (segment: string, key: string) => {
  const parts = segment.split(/(\*[^*]+\*)/).filter((s) => s.length > 0);
  return parts.map((p, i) =>
    p.startsWith("*") && p.endsWith("*") ? (
      <span key={`${key}-${i}`} style={{ color: ACCENT }}>{p.slice(1, -1)}</span>
    ) : (
      <React.Fragment key={`${key}-${i}`}>{p}</React.Fragment>
    ),
  );
};

export const HookScene: React.FC = () => {
  const frame = useCurrentFrame();
  const dur = 96;
  const opacity = useSceneFade(frame, dur, 8);

  return (
    <AbsoluteFill style={{ backgroundColor: INK, overflow: "hidden" }}>
      <AbsoluteFill style={{ opacity }}>
        {/* headline, word by word */}
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "47%",
            transform: "translate(-50%, -50%)",
            width: 0.8 * 1920,
            textAlign: "center",
            fontFamily: FONT_DISPLAY,
            fontSize: 104,
            fontWeight: 700,
            lineHeight: 1.1,
            letterSpacing: "-0.01em",
            color: PAPER,
            whiteSpace: "pre-wrap",
          }}
        >
          {HOOK_WORDS.map((word, i) => {
            // each word starts 3 frames after the previous one, at local frame 4
            const wordStart = 4 + i * 3;
            const localT = interpolate(frame, [wordStart, wordStart + 16], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.out(Easing.cubic),
            });
            const wordOpacity = localT;
            const wordY = interpolate(localT, [0, 1], [32, 0]); // "rise" preset: 32px below, fades up
            if (/^\s+$/.test(word)) return <span key={i}>{word}</span>;
            return (
              <span
                key={i}
                style={{
                  display: "inline-block",
                  opacity: wordOpacity,
                  transform: `translateY(${wordY}px)`,
                }}
              >
                {renderMarked(word, `w${i}`)}
              </span>
            );
          })}
        </div>

        {/* the rule: a line that grows from the left, starting at local frame 30 */}
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "60%",
            transform: "translate(-50%, -50%)",
          }}
        >
          <div
            style={{
              width: 220,
              height: 6,
              borderRadius: 3,
              background: ACCENT,
              transformOrigin: "left center",
              transform: `scaleX(${interpolate(frame, [30, 44], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.out(Easing.cubic),
              })})`,
            }}
          />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ============================== speed scene ==============================
// head: text "Seconds for one still" size 60 color ink, rise-in at 0 dur 12
// bars: Remotion 0.57 (muted) vs native 0.06 (teal), max 0.6, grow-in staggered
//       by item (each 6f), dur 22f, ease "settle" (cubic-bezier(0.2,0.9,0.1,1))
// note: text "measured on the same film, same pixels" fade-in at 40 dur 12

type BarValue = { label: string; value: number; color: string };
const BAR_VALUES: BarValue[] = [
  { label: "Remotion", value: 0.57, color: MUTED },
  { label: "native", value: 0.06, color: TEAL },
];
const BAR_MAX = 0.6;
const BAR_W = 1100;
const BAR_THICKNESS = 44;
const BAR_GAP = 28;

const formatBarValue = (v: number) => v.toFixed(2); // the JSON's bars.format: "0.00"

export const SpeedScene: React.FC = () => {
  const frame = useCurrentFrame();
  const dur = 120;
  const opacity = useSceneFade(frame, dur, 8);

  const headlineT = interpolate(frame, [0, 12], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  return (
    <AbsoluteFill style={{ backgroundColor: PAPER, overflow: "hidden" }}>
      <AbsoluteFill style={{ opacity }}>
        {/* headline */}
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "20%",
            transform: `translate(-50%, calc(-50% + ${interpolate(headlineT, [0, 1], [32, 0])}px))`,
            opacity: headlineT,
            width: 0.8 * 1920,
            textAlign: "center",
            fontFamily: FONT_DISPLAY,
            fontSize: 60,
            fontWeight: 700,
            color: INK,
          }}
        >
          Seconds for one still
        </div>

        {/* bars: labels left, growing fill, value printed after the fill */}
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "52%",
            transform: "translate(-50%, -50%)",
            width: BAR_W,
            display: "flex",
            flexDirection: "column",
            gap: BAR_GAP,
            fontFamily: FONT_BODY,
            fontSize: 34,
            color: INK,
          }}
        >
          {BAR_VALUES.map((bar, i) => {
            // stagger by item: bar i starts (14 + i * 6) local frames in, dur 22, ease settle
            const start = 14 + i * 6;
            const t = interpolate(frame, [start, start + 22], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: settle,
            });
            const frac = Math.max(0, Math.min(1, bar.value / BAR_MAX)) * t;
            return (
              <div key={bar.label} style={{ display: "flex", alignItems: "center", gap: 18, opacity: t > 0 ? 1 : 0 }}>
                <div style={{ width: Math.round(BAR_W * 0.28), textAlign: "right", whiteSpace: "nowrap" }}>{bar.label}</div>
                <div style={{ flex: 1, height: BAR_THICKNESS, position: "relative" }}>
                  <div
                    style={{
                      position: "absolute",
                      left: 0,
                      top: 0,
                      height: BAR_THICKNESS,
                      width: `${frac * 100}%`,
                      background: bar.color,
                      borderRadius: BAR_THICKNESS / 2,
                    }}
                  />
                  <div
                    style={{
                      position: "absolute",
                      left: `calc(${frac * 100}% + 14px)`,
                      top: 0,
                      height: BAR_THICKNESS,
                      display: "flex",
                      alignItems: "center",
                      fontVariantNumeric: "tabular-nums",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {formatBarValue(bar.value)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* note, fades in at local frame 40 */}
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "78%",
            transform: "translate(-50%, -50%)",
            opacity: interpolate(frame, [40, 52], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
            fontFamily: FONT_BODY,
            fontSize: 34,
            fontWeight: 500,
            color: MUTED,
          }}
        >
          measured on the same film, same pixels
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ============================== sequencing ==============================
// A real project also needs these two mounted in the film's Sequence list
// and a <Composition> registered in the Root — both free in the JSON
// version (scaffoldMgFiles + MgFilmView already do this for all 6 scenes).
export const HookAndSpeedFilm: React.FC = () => (
  <AbsoluteFill>
    <Sequence from={0} durationInFrames={96}>
      <HookScene />
    </Sequence>
    <Sequence from={96} durationInFrames={120}>
      <SpeedScene />
    </Sequence>
  </AbsoluteFill>
);

// What is NOT in this file that the JSON gets for free (see docs/benchmark-mograph-2026-09-07.md):
// - a vertical format of both scenes (sizes, positions, maxWidth all differ)
// - the four other scenes of the film (stat, loop, cmd, end): counter, list, ring-progress, image, typewriter
// - lint (unknown color/easing/preset, in-past-scene-end, stagger overrun, text hold time, missing image, id collisions)
// - check-frame addresses (hook.lineSettled, hook.ruleIn+6, ...) and the DOM probe hookup (data-probe, data-mg)
// - the audio cue schema, or any of `mh set` / `mh key` / `mh layout` / `mh edit` operating on this scene
