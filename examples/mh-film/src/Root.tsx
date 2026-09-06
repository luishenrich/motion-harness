import React from "react";
import { Composition } from "remotion";
import { Film, FILM_DURATION } from "./Film.tsx";
import { FPS } from "./timeline.ts";

export const Root: React.FC = () => (
  <>
    <Composition id="mh-film-wide" component={Film} width={1920} height={1080} fps={FPS} durationInFrames={FILM_DURATION} defaultProps={{ story: false }} />
    <Composition id="mh-film-vertical" component={Film} width={1080} height={1920} fps={FPS} durationInFrames={FILM_DURATION} defaultProps={{ story: true }} />
  </>
);
