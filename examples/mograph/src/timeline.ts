/**
 * The film is data (film.mograph.json). This module types it and compiles it
 * into the timeline the harness checks; the compositions read the same data.
 */
import raw from "../film.mograph.json";
import type { MgFilm } from "../../../src/mograph/schema.ts";
import { mographTimeline } from "../../../src/mograph/timeline.ts";

export const film = raw as MgFilm;
export const timeline = mographTimeline(film, { film: "spot" });
