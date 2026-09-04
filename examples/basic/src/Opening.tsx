import React from "react";
import { AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame, interpolate } from "remotion";
import { Montage, part, useScene, ev, Ground, Line } from "./scenes.tsx";

const opening = part("opening");

const Black: React.FC = () => <Ground kind="dark" />;

const LineScene: React.FC<{ story: boolean }> = ({ story }) => {
  const s = useScene();
  const out = s.events.find((e) => e.name === "lineOut")?.local;
  return (
    <Ground kind="dark">
      <Line text={s.text?.[0] ?? ""} at={ev(s, "lineIn")} out={out} story={story} />
      <Grain />
    </Ground>
  );
};

const Grain: React.FC = () => {
  const f = useCurrentFrame();
  const o = interpolate(f % 4, [0, 3], [0.03, 0.06]);
  return <AbsoluteFill style={{ opacity: o, background: "repeating-linear-gradient(0deg, #fff 0 1px, transparent 1px 3px)", mixBlendMode: "overlay" }} />;
};

export const Opening: React.FC<{ story: boolean }> = ({ story }) => (
  <AbsoluteFill>
    <Montage part={opening} story={story} views={{ black: Black, line1: () => <LineScene story={story} />, line2: () => <LineScene story={story} /> }} />
    {/* the opening carries its own foley, the music comes from the timeline at mix time */}
    <Sequence from={opening.scenes[1].start} durationInFrames={20}>
      <Audio src={staticFile("click.mp3")} volume={0.4} />
    </Sequence>
  </AbsoluteFill>
);
