import React from "react";
import { AbsoluteFill, useCurrentFrame, interpolate, spring, useVideoConfig } from "remotion";
import { Montage, part, useScene, ev, Ground, Line, colors } from "./scenes.tsx";

const product = part("product");

const Cursor: React.FC<{ x: number; y: number; from: { x: number; y: number }; at: number; click: number }> = ({ x, y, from, at, click }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = spring({ frame: f - at, fps, config: { damping: 20, stiffness: 120 } });
  const cx = from.x + (x - from.x) * t, cy = from.y + (y - from.y) * t;
  const press = f >= click && f < click + 6 ? 0.85 : 1;
  const ripple = interpolate(f, [click, click + 14], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div style={{ position: "absolute", left: cx, top: cy, zIndex: 5 }}>
      {f >= click && ripple < 1 && <div style={{ position: "absolute", left: -20 * ripple, top: -20 * ripple, width: 40 * ripple, height: 40 * ripple, borderRadius: 999, border: `2px solid ${colors.gold}`, opacity: 1 - ripple }} />}
      <svg width="28" height="28" viewBox="0 0 24 24" style={{ transform: `scale(${press})`, filter: "drop-shadow(0 2px 4px rgba(0,0,0,.3))" }}>
        <path d="M5 3l14 8-6 1 3 6-3 1-3-6-5 4z" fill="#fff" stroke="#000" strokeWidth="1.5" />
      </svg>
    </div>
  );
};

const Card: React.FC<{ story: boolean }> = ({ story }) => {
  const s = useScene();
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const cardIn = ev(s, "cardIn"), hover = ev(s, "hover"), click = ev(s, "click"), reveal = ev(s, "reveal");
  const up = spring({ frame: f - cardIn, fps, config: { damping: 18 } });
  const revealed = f >= reveal;
  const W = story ? 900 : 1100;
  return (
    <Ground kind="cream">
      <div data-probe="card" style={{ position: "absolute", left: "50%", top: story ? 520 : 200, width: W, transform: `translateX(-50%) translateY(${(1 - up) * 40}px)`, opacity: up, background: colors.white, borderRadius: 24, boxShadow: "0 16px 48px rgba(0,0,0,0.07)", padding: 40 }}>
        <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: 2, textTransform: "uppercase", color: colors.forest }}>Placement check · 2 of 8</div>
        <div data-probe="question" style={{ fontSize: 40, fontWeight: 500, marginTop: 16, lineHeight: 1.25 }}>Which structure produces the majority of ATP in a eukaryotic cell?</div>
        <div style={{ display: "grid", gridTemplateColumns: story ? "1fr" : "1fr 1fr", gap: 14, marginTop: 28 }}>
          {["Golgi apparatus", "Mitochondrion", "Ribosome", "Lysosome"].map((o, i) => {
            const chosen = i === 1 && f >= click;
            const hovered = i === 1 && f >= hover && f < click;
            return (
              <div key={o} data-probe={`option-${i}`} style={{ padding: "18px 22px", borderRadius: 12, fontSize: 28, border: `1.5px solid ${chosen ? colors.gold : hovered ? colors.forest : "rgba(37,31,26,0.15)"}`, background: chosen ? "rgba(255,188,20,0.12)" : colors.white }}>
                {o}
                {revealed && i === 1 && <span style={{ marginLeft: 12, color: colors.forest, fontWeight: 600 }}>correct</span>}
              </div>
            );
          })}
        </div>
        <div data-probe="check-button" style={{ marginTop: 28, display: "inline-block", background: colors.gold, color: colors.ink, fontWeight: 500, fontSize: 24, padding: "14px 28px", borderRadius: 12, opacity: revealed ? 0.35 : 1 }}>
          Check
        </div>
      </div>
      <Cursor from={{ x: story ? 900 : 1500, y: story ? 1500 : 900 }} x={story ? 560 : 900} y={story ? 1010 : 690} at={hover - 8} click={click} />
    </Ground>
  );
};

const Map: React.FC<{ story: boolean }> = ({ story }) => {
  const s = useScene();
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const rowsIn = ev(s, "rowsIn"), score = ev(s, "score");
  const rows = ["Cell structure", "Energy metabolism", "Protein synthesis"];
  return (
    <Ground kind="cream">
      <div data-probe="map" style={{ position: "absolute", left: "50%", top: story ? 560 : 240, width: story ? 900 : 1000, transform: "translateX(-50%)", background: colors.white, borderRadius: 24, padding: 36, boxShadow: "0 16px 48px rgba(0,0,0,0.07)" }}>
        <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: 2, textTransform: "uppercase", color: colors.forest }}>Course map</div>
        {rows.map((r, i) => {
          const t = spring({ frame: f - rowsIn - i * 5, fps, config: { damping: 18 } });
          const scored = i === 1 && f >= score;
          const pct = scored ? Math.round(interpolate(f, [score, score + 20], [0, 62], { extrapolateRight: "clamp" })) : null;
          return (
            <div key={r} data-probe={`row-${i}`} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 0", borderBottom: "1px solid rgba(37,31,26,0.1)", opacity: t, transform: `translateX(${(1 - t) * -30}px)`, fontSize: 30 }}>
              <span>{r}</span>
              <span style={{ fontSize: 20, fontWeight: 600, padding: "6px 14px", borderRadius: 999, background: scored ? "rgba(255,188,20,0.2)" : "rgba(29,75,58,0.1)", color: scored ? "#473206" : colors.forest }}>{pct === null ? "New" : `${pct}%`}</span>
            </div>
          );
        })}
      </div>
    </Ground>
  );
};

const End: React.FC<{ story: boolean }> = ({ story }) => {
  const s = useScene();
  return (
    <Ground kind="dark">
      <Line text={s.text?.[0] ?? ""} at={ev(s, "lineIn")} story={story} />
      <div data-probe="wordmark" style={{ position: "absolute", left: 0, right: 0, bottom: story ? 400 : 120, textAlign: "center", fontSize: 28, letterSpacing: 4, color: colors.gold }}>EXAMPLE</div>
    </Ground>
  );
};

export const Product: React.FC<{ story: boolean }> = ({ story }) => (
  <AbsoluteFill>
    <Montage part={product} story={story} views={{ card: () => <Card story={story} />, map: () => <Map story={story} />, end: () => <End story={story} /> }} />
  </AbsoluteFill>
);
