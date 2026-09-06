# motion-harness as a product

Stand 2026-09-06. What the harness is when it leaves the StudyPDF repo, who pays for what, and
what stays free. Written after the market research in the StudyPDF repo
(`docs/research/agentic-video-market-2026-09-06/`).

## One sentence

Eyes and hands for AI agents that make videos: the layer between "the agent edited the code"
and "the film is right", sold to the people who already let agents build things and now want
them to build films.

## Who it is for, in order

1. Founders and developers who make product films, launch videos and ads with Claude Code,
   Codex or Cursor. Code-affine, pay for time, hate credits. Our own case.
2. AI filmmakers who assemble fifty generated clips into one film: colour drift, beats, cost
   per attempt, an animatic before spending.
3. Agencies with volume: skills, receipts and reproducibility over taste per project.

Editors in Premiere and Resolve are not a first market. For them the escape hatch matters
(exports they can open), not the harness.

## What is free and what is paid

Open core, MIT. Everything that runs on the user's machine is free and stays free: the CLI,
both engines, the probe, the lints, the skills, the MCP server, the review page export.

Paid, flat, per seat, no credits, because credits are the wound of the whole category:

- **Hosted review**: the review page hosted with shared comments, links for clients, a
  history of versions, comments back into the agent (`mh feedback --from <url>`).
- **Hosted render**: the native engine on our machines for teams without a Mac or a GPU,
  billed per seat with a fair-use cap, never per render.
- **Team receipts**: every receipt from every machine in one place; who rendered what from
  which commit.
- **Model second opinions** (`mh judge`) on our keys for teams that do not want their own.

A single seat covers a person; a studio seat covers an agency's agents. Price points to test:
20 USD per seat and month, 90 USD per studio seat; a yearly plan at ten months.

## What we do not build

- A timeline UI. The film is code and data; Remotion Studio, Diffusion Studio and the NLEs
  exist. We export to them (XML/OTIO is on the list) instead of competing with them.
- A generation model or a wrapper around one. Clips come from wherever; we register, lint and
  cost them.
- Credits.

## Positioning against the field

- Diffusion Studio, HyperFrames: renderers with an agent connector. We are the check layer on
  top of any renderer, including our own.
- Palmier, OpenChatCut: timelines as MCP. We are CLI plus skills first (cheaper, more reliable
  in every benchmark we found), MCP for the outer loop.
- Descript, Opus, Captions: models with credits. We are numbers with a flat price.

## Release order

1. `npm publish motion-harness@0.2.0` from a clean checkout, with the two example projects
   passing `mh check --engine native`.
2. Public GitHub repo, README as it is, the film about the tool (`examples/mh-film`) on the
   README and on YouTube, unlisted until the StudyPDF launch is through.
3. `npx skills add luishenrich/motion-harness` verified from a fresh machine.
4. Posts: Remotion Discord (tooling channel), Hacker News "Show HN: eyes and hands for AI
   agents that make videos", X. One post each, on a Tuesday to Thursday morning, after the
   StudyPDF launch week.
5. Hosted review as the first paid piece, when three outside teams have used the export.

Publishing, posting and pricing are Luis' decisions; this document proposes, the repo prepares.
