import React from "react";
import { Composition } from "remotion";
import { compile } from "../../../src/timeline/schema.ts";
import { timeline, FPS } from "./timeline.ts";
import { Opening } from "./Opening.tsx";
import { Product } from "./Product.tsx";

const c = compile(timeline);
const opening = c.parts.find((p) => p.id === "opening")!;
const product = c.parts.find((p) => p.id === "product")!;

const SIZES = { wide: { width: 1920, height: 1080 }, vertical: { width: 1080, height: 1920 } } as const;

export const Root: React.FC = () => (
  <>
    {(["wide", "vertical"] as const).map((f) => (
      <Composition key={`o-${f}`} id={`example-opening-${f}`} component={Opening} durationInFrames={opening.dur} fps={FPS} width={SIZES[f].width} height={SIZES[f].height} defaultProps={{ story: f === "vertical" }} />
    ))}
    {(["wide", "vertical"] as const).map((f) => (
      <Composition key={`p-${f}`} id={`example-product-${f}`} component={Product} durationInFrames={product.dur} fps={FPS} width={SIZES[f].width} height={SIZES[f].height} defaultProps={{ story: f === "vertical" }} />
    ))}
  </>
);
