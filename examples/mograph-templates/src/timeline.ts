/**
 * The film is data (film.mograph.json) and every scene of it came from a
 * template: `mh template add <name> --param k=v`. This module types the film
 * and compiles it into the timeline the harness checks; the compositions read
 * the same data.
 */
import raw from "../film.mograph.json";
import type { MgFilm } from "../../../src/mograph/schema.ts";
import { mographTimeline } from "../../../src/mograph/timeline.ts";

export const film = raw as MgFilm;
export const timeline = mographTimeline(film, { film: "templates" });
