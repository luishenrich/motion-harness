/**
 * Films as data: the film is data (film.mograph.json). This module types it and
 * compiles it into the timeline the harness checks; the compositions draw the same data.
 * Edit the JSON (mh set, mh key, mh add, or the editor: mh edit), never this file.
 */
import raw from "../film.mograph.json";
import type { MgFilm } from "../../../src/mograph/schema.ts";
import { mographTimeline } from "../../../src/mograph/timeline.ts";

export const film = raw as MgFilm;
export const timeline = mographTimeline(film, { film: "reel" });
