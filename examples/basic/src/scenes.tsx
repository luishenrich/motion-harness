/** Shared helpers: scenes read their frames from the compiled timeline, never from literals. */
import React from "react";
import { Sequence, useCurrentFrame, interpolate, Easing } from "remotion";
import { compile, type CompiledScene, type CompiledPart } from "../../../src/timeline/schema.ts";
import { timeline } from "./timeline.ts";

export const compiled = compile(timeline);
export const part = (id: string): CompiledPart => compiled.parts.find((p) => p.id === id)!;

export const colors = {
  dark: "#1C1A17",
  cream: "#F7F4E3",
  ink: "#251F1A",
  gold: "#FFBC14",
  forest: "#1D4B3A",
  white: "#FFFFFF",
};

export const SceneCtx = React.createContext<CompiledScene | null>(null);
export const useScene = () => {
  const s = React.useContext(SceneCtx);
  if (!s) throw new Error("useScene outside a scene");
  return s;
};
export const ev = (s: CompiledScene, name: string) => {
  const e = s.events.find((x) => x.name === name);
  if (!e) throw new Error(`scene ${s.id} has no event ${name}`);
  return e.local;
};

/** mounts every scene of a part as a Sequence, with overlap so enters can wipe over the previous scene */
export const Montage: React.FC<{ part: CompiledPart; views: Record<string, React.FC>; story: boolean }> = ({ part, views }) => (
  <>
    {part.scenes.map((s) => {
      const View = views[s.id];
      if (!View) throw new Error(`no view for scene ${s.id}`);
      return (
        <Sequence key={s.id} from={s.start} durationInFrames={s.dur + part.overlap} layout="none">
          <SceneCtx.Provider value={s}>
            <Enter scene={s}>
              <View />
            </Enter>
          </SceneCtx.Provider>
        </Sequence>
      );
    })}
  </>
);

const Enter: React.FC<{ scene: CompiledScene; children: React.ReactNode }> = ({ scene, children }) => {
  const f = useCurrentFrame();
  const d = scene.enter.dur ?? 0;
  const t = d === 0 ? 1 : interpolate(f, [0, d], [0, 1], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  const style: React.CSSProperties = { position: "absolute", inset: 0 };
  if (scene.enter.type === "fade") style.opacity = t;
  if (scene.enter.type === "wipe") style.clipPath = `inset(0 ${(1 - t) * 100}% 0 0)`;
  return (
    <div style={style} data-scene={scene.id}>
      {children}
    </div>
  );
};

export const Ground: React.FC<{ kind?: string; children?: React.ReactNode }> = ({ kind, children }) => (
  <div style={{ position: "absolute", inset: 0, background: kind === "cream" ? colors.cream : colors.dark, color: kind === "cream" ? colors.ink : colors.cream, fontFamily: "Helvetica, Arial, sans-serif" }}>{children}</div>
);

export const Line: React.FC<{ text: string; at: number; out?: number; story: boolean }> = ({ text, at, out, story }) => {
  const f = useCurrentFrame();
  const inT = interpolate(f, [at, at + 12], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  const outT = out === undefined ? 1 : interpolate(f, [out, out + 8], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div data-probe="line" style={{ position: "absolute", left: "10%", right: "10%", top: story ? "40%" : "42%", textAlign: "center", fontSize: story ? 64 : 84, fontWeight: 500, letterSpacing: -1, opacity: inT * outT, transform: `translateY(${(1 - inT) * 24}px)` }}>
      {text}
    </div>
  );
};
