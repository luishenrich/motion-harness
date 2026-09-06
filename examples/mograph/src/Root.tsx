import React from "react";
import { Composition } from "remotion";
import { MgFilmView, filmDuration } from "../../../src/mograph/runtime.tsx";
import { film } from "./timeline.ts";

export const Root: React.FC = () => (
  <>
    {Object.entries(film.formats).map(([format, size]) => (
      <Composition key={format} id={`spot-${format}`} component={MgFilmView} width={size.width} height={size.height} fps={film.fps} durationInFrames={filmDuration(film)} defaultProps={{ film, format }} />
    ))}
  </>
);
