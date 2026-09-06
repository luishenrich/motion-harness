# motion-harness for agents

This repository is a CLI (`mh`) that gives coding agents eyes and hands on a video project:
a timeline as data, frames in seconds, a DOM probe, lints, motion and audio numbers, a native
renderer, stills, subtitles and deliveries. The skills in `skills/` teach the loop:

- `skills/motion-harness/SKILL.md`: the working loop (resolve, frames, probe, check, diff)
- `skills/motion-harness-feedback/SKILL.md`: a human's feedback turned into edits with proof
- `skills/motion-harness-sound/SKILL.md`: music, sfx, voice, loudness as numbers
- `skills/motion-harness-deliver/SKILL.md`: the handover folder, platform copies, upload

Install them: `npx skills add luishenrich/motion-harness` (Claude Code, Codex, Cursor, Gemini
CLI and every agentskills.io client), or copy `skills/*` into your agent's skills directory.

Run the CLI: `bun run src/cli.ts <command> --project <dir>` or, installed, `mh <command>`. Every
command prints text for people and, with `--json`, one JSON document on stdout for machines.
Every command leaves a receipt in `<cache>/receipts/`. `mh help` is the reference.

Working in this repo: `bun test` (unit tests, including the shim's parity with Remotion),
`bunx tsc --noEmit`, and `bun run src/cli.ts doctor --project examples/basic` against the
example project. Do not add a second copy of timing numbers anywhere; the timeline is the truth.

## Motion graphics

A film with a `film.mograph.json` is data: edit it with `mh set`, `mh key`, `mh add`, `mh layout` (never the generated `src/`), look at the frame the edit names, run `mh check --format all`. The layer types, presets and easings live in `src/mograph/`; add a layer type there when a look needs code. Skill: `skills/motion-harness-mograph/SKILL.md`, reference: `docs/mograph.md`.
