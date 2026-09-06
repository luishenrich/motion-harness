---
name: motion-harness-feedback
description: Turn a human's feedback on a motion film ("second 21 is too fast", "picture 2", "the button clicks too late", a pasted screenshot, review-player comments) into scene addresses, edits and proof. Use whenever someone comments on a rendered film built with motion-harness and the agent has to act on it. Triggers: feedback, review, comments, too fast, too slow, too early, too late, this frame, that screenshot, second N, at 0:21, the middle screen.
---

# From feedback to a verified edit

Feedback arrives in seconds, screenshot numbers and scene nicknames. The film knows frames.
Translate first, edit second, prove third. Never guess a frame.

1. Translate every reference to an address.
   - Free text: `mh feedback --from -` (paste the text on stdin) lists each phrase with its
     `scene+local`, film frame and seconds.
   - A time: `mh resolve 21s` or `mh resolve 0:21.4`.
   - A pasted picture: `mh locate shot.png` finds the frame (or the hold it belongs to).
   - Player comments: `mh feedback` (they already carry `scene+local`).
2. Look before touching: `mh frame <scene+local> --format all` renders exactly that moment;
   `mh sheet --scene <id>` shows the scene around it. Read the picture, do not assume.
3. Edit the source. Timing lives in the timeline (scene `dur`, `events`); a literal in a
   component is mirrored as an event first. Cursor targets come from `mh cursor`, never by hand.
4. Prove it: `mh check --scene <id> --format all`. Then `mh diff` against the approved run to
   see that nothing else moved, `mh motion --scene <id>` when the complaint was about tempo,
   `mh audio --scene <id>` when it was about sound. For a second opinion on a clip,
   `mh judge --scene <id>`: its findings are leads, confirm each with `mh frame`.
5. Answer with addresses and evidence: which scene and frame changed, from what to what, the
   sheet or frame that shows it. Mark the comment done in the player or say it was not changed
   and why.

Things that look like defects and are not: an orange (in transition) cell with a hard edge; a
black first frame of a part that cuts from black; text at opacity 0 at `settled` when its
event comes later. Check the timeline `why` and `mh probe` before reporting them.
