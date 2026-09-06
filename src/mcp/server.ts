#!/usr/bin/env bun
/**
 * The outer loop: mh as an MCP server for hosts that speak MCP rather than a
 * shell (ChatGPT Work, Claude Cowork, a non-developer's Claude app). Every tool
 * runs the same CLI; the inner loop for coding agents stays the CLI plus skills,
 * which is cheaper and more reliable. stdio transport: `mh mcp` or `bun run
 * src/mcp/server.ts`; register with `claude mcp add motion-harness -- mh mcp`.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { resolve } from "node:path";
import { readFileSync, existsSync } from "node:fs";

const CLI = resolve(import.meta.dir, "../cli.ts");

const runMh = async (command: string, args: string[], project?: string, json = false): Promise<{ code: number; out: string; err: string }> => {
  const argv = ["bun", "run", CLI, command, ...args];
  if (project) argv.push("--project", project);
  if (json && !args.includes("--json")) argv.push("--json");
  const proc = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe", env: { ...process.env, MH_PROJECT: project ?? process.env.MH_PROJECT ?? "" } });
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { code: await proc.exited, out, err };
};

const text = (r: { code: number; out: string; err: string }) => {
  const body = [r.out.trim(), r.err.trim()].filter(Boolean).join("\n");
  return { content: [{ type: "text" as const, text: body.slice(0, 60000) || "(no output)" }], isError: r.code !== 0 };
};

const server = new McpServer({ name: "motion-harness", version: "0.2.0" });

const project = z.string().optional().describe("project directory holding harness.config.ts (default: MH_PROJECT or the last project used)");
const format = z.string().optional().describe("format name, or 'all'");

server.registerTool("mh_timeline", { title: "Timeline", description: "The compiled timeline: scenes with frames, film time, events, audio cues. Start here to learn the film's addresses.", inputSchema: { project, json: z.boolean().optional() } }, async ({ project: p, json }) => text(await runMh("timeline", [], p, !!json)));
server.registerTool("mh_resolve", { title: "Resolve a moment", description: "Turn any reference (20.5s, f616, probe.pick1, probe+12, product:f120, #7) into scene, local frame, part frame, film frame and seconds.", inputSchema: { refs: z.array(z.string()).min(1), project } }, async ({ refs, project: p }) => text(await runMh("resolve", refs, p, true)));
server.registerTool("mh_frame", { title: "Render exact frames", description: "Render exactly these frames (any reference) now and return their file paths. Use to look at one moment before and after an edit.", inputSchema: { refs: z.array(z.string()).min(1), format, project } }, async ({ refs, format: f, project: p }) => text(await runMh("frame", [...refs, ...(f ? ["--format", f] : [])], p, true)));
server.registerTool("mh_check", { title: "Check an edit", description: "One edit round: typecheck, lint, doctor, cursor targets, check frames with contact sheets and rendered lint for the given scenes, per format. Returns the pass/fail table.", inputSchema: { scenes: z.array(z.string()).optional(), format, engine: z.enum(["remotion", "native"]).optional(), project } }, async ({ scenes, format: f, engine, project: p }) => text(await runMh("check", [...(scenes?.length ? ["--scene", scenes.join(",")] : []), ...(f ? ["--format", f] : []), ...(engine ? ["--engine", engine] : [])], p)));
server.registerTool("mh_lint", { title: "Lint", description: "Static colours, timeline rules, rendered layout (overflow, wrap, collision, safe zone), clip colour drift.", inputSchema: { rendered: z.boolean().optional(), format, project } }, async ({ rendered, format: f, project: p }) => text(await runMh("lint", [...(rendered ? ["--rendered"] : []), ...(f ? ["--format", f] : []), "--no-fail"], p)));
server.registerTool("mh_render", { title: "Render the film", description: "Render the film (segments cached per scene, music mixed from the timeline). remix=true only re-mixes sound. preview scenes render a clip of those scenes.", inputSchema: { format, engine: z.enum(["remotion", "native"]).optional(), remix: z.boolean().optional(), draft: z.boolean().optional(), previewScenes: z.array(z.string()).optional(), outDir: z.string().optional(), project } }, async ({ format: f, engine, remix, draft, previewScenes, outDir, project: p }) => text(await runMh("render", [...(f ? ["--format", f] : []), ...(engine ? ["--engine", engine] : []), ...(remix ? ["--remix"] : []), ...(draft ? ["--draft"] : []), ...(previewScenes?.length ? ["--scene", previewScenes.join(","), "--preview"] : []), ...(outDir ? ["--out-dir", outDir] : [])], p)));
server.registerTool("mh_audio", { title: "Audio report", description: "Music coverage, loudness vs platform targets, rms profile, every cue checked (audibility of short effects).", inputSchema: { scene: z.string().optional(), project } }, async ({ scene, project: p }) => text(await runMh("audio", scene ? ["--scene", scene] : [], p)));
server.registerTool("mh_motion", { title: "Motion curve", description: "Frame-to-frame motion of scenes: settle, holds, jumps; optional reference clip comparison.", inputSchema: { scenes: z.array(z.string()).min(1), reference: z.string().optional(), engine: z.enum(["remotion", "native"]).optional(), project } }, async ({ scenes, reference, engine, project: p }) => text(await runMh("motion", ["--scene", scenes.join(","), ...(reference ? ["--reference", reference] : []), ...(engine ? ["--engine", engine] : [])], p)));
server.registerTool("mh_judge", { title: "Model second opinion", description: "A model watches a clip of the scenes and returns findings with film times (leads to confirm with mh_frame).", inputSchema: { scenes: z.array(z.string()).min(1), model: z.string().optional(), engine: z.enum(["remotion", "native"]).optional(), project } }, async ({ scenes, model, engine, project: p }) => text(await runMh("judge", ["--scene", scenes.join(","), ...(model ? ["--model", model] : []), ...(engine ? ["--engine", engine] : [])], p, true)));
server.registerTool("mh_srt", { title: "Subtitles", description: "Subtitles from the timeline (scene text or caption), or the YouTube chapter list.", inputSchema: { chapters: z.boolean().optional(), lang: z.string().optional(), out: z.string().optional(), project } }, async ({ chapters, lang, out, project: p }) => text(await runMh("srt", [...(chapters ? ["--chapters"] : []), ...(lang ? ["--lang", lang] : []), ...(out ? ["--out", out] : [])], p)));
server.registerTool("mh_still", { title: "Stills", description: "Render and lint every registered <Still> (thumbnails, covers, OG image); ids or 'all'.", inputSchema: { ids: z.array(z.string()).optional(), width: z.number().optional(), engine: z.enum(["remotion", "native"]).optional(), project } }, async ({ ids, width, engine, project: p }) => text(await runMh("still", [ids?.length ? ids.join(",") : "all", "--jpg", "--no-fail", ...(width ? ["--width", String(width)] : []), ...(engine ? ["--engine", engine] : [])], p, true)));
server.registerTool("mh_deliver", { title: "Deliver", description: "Films per format, stills, srt, per-platform loudness copies, burned captions, optional upload; a manifest with sizes, sha1, chapters and urls.", inputSchema: { out: z.string(), stills: z.array(z.string()).optional(), platforms: z.array(z.string()).optional(), captions: z.boolean().optional(), upload: z.string().optional(), lang: z.string().optional(), project } }, async ({ out, stills, platforms, captions, upload, lang, project: p }) => text(await runMh("deliver", ["--out", out, "--format", "all", ...(stills?.length ? ["--stills", stills.join(",")] : []), ...(platforms?.length ? ["--platforms", platforms.join(",")] : []), ...(captions ? ["--captions"] : []), ...(upload ? ["--upload", upload] : []), ...(lang ? ["--lang", lang] : [])], p)));
server.registerTool("mh_feedback", { title: "Feedback", description: "Review-player comments as scene addresses, or free text turned into addresses.", inputSchema: { text: z.string().optional(), project } }, async ({ text: t, project: p }) => {
  if (!t) return text(await runMh("feedback", [], p));
  const proc = Bun.spawn(["bun", "run", CLI, "feedback", "--from", "-", ...(p ? ["--project", p] : [])], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  proc.stdin.write(t);
  proc.stdin.end();
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return text({ code: await proc.exited, out, err });
});
server.registerTool("mh", { title: "Any mh command", description: "Run any mh command with raw arguments (see mh_help for the list). Prefer the typed tools; use this for commands they do not cover (doctor, sheet, probe, diff, beats, sfx, clips, voice, captions, compare, receipts).", inputSchema: { command: z.string(), args: z.array(z.string()).optional(), project } }, async ({ command, args, project: p }) => text(await runMh(command, args ?? [], p)));
server.registerTool("mh_help", { title: "Help", description: "The full command reference of mh.", inputSchema: {} }, async () => text(await runMh("help", [])));

server.registerResource("skill", "motion-harness://skill", { title: "The motion-harness skill", description: "How to work on a film with the harness", mimeType: "text/markdown" }, async (uri) => {
  const f = resolve(import.meta.dir, "../../skills/motion-harness/SKILL.md");
  return { contents: [{ uri: uri.href, text: existsSync(f) ? readFileSync(f, "utf8") : "skill file missing" }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);
