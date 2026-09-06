/**
 * Images for the film from a prompt: backgrounds, start frames, thumbnail
 * plates. The model paints, the harness fits the picture to the format and
 * keeps the typography deterministic (a still composes the text, never the
 * model). Every image is registered with its prompt, model and size so a plate
 * can be regenerated or explained later.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import sharp from "sharp";
import type { LoadedConfig } from "../config.ts";
import { generateImage, type ImageProvider } from "../ai/azure.ts";
import { ensureDir } from "../util.ts";

export type ImageEntry = { id: string; file: string; prompt: string; fullPrompt: string; provider: string; model: string; width: number; height: number; ms: number; madeAt: string; license?: string };

export const imagesPath = (cfg: LoadedConfig) => join(cfg.projectDir, "images.json");
export const loadImages = (cfg: LoadedConfig): ImageEntry[] => (existsSync(imagesPath(cfg)) ? (JSON.parse(readFileSync(imagesPath(cfg), "utf8")) as ImageEntry[]) : []);
export const saveImages = (cfg: LoadedConfig, list: ImageEntry[]) => writeFileSync(imagesPath(cfg), JSON.stringify(list, null, 2));

/** the brand's style suffix from the config, so every plate speaks the same visual language */
export const fullPrompt = (cfg: LoadedConfig, prompt: string, opts: { noText?: boolean } = {}) => {
  const style = cfg.imageStyle ? ` ${cfg.imageStyle.trim()}` : "";
  const noText = opts.noText === false ? "" : " No text, no letters, no logos, no watermark.";
  return `${prompt.trim()}${style}${noText}`;
};

/** fit a square or other model output to the requested size: cover-crop from the centre, never stretch */
export const fitTo = async (png: Buffer, width: number, height: number): Promise<Buffer> => sharp(png).resize({ width, height, fit: "cover", position: "centre" }).png().toBuffer();

export const makeImage = async (cfg: LoadedConfig, prompt: string, opts: { id?: string; out?: string; width?: number; height?: number; provider?: ImageProvider; model?: string; noText?: boolean; license?: string; log?: (s: string) => void }): Promise<ImageEntry> => {
  const log = opts.log ?? (() => {});
  const width = opts.width ?? 1920, height = opts.height ?? 1080;
  const id = opts.id ?? (prompt.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "image");
  const out = resolve(cfg.projectDir, opts.out ?? join(cfg.publicPath, "img", `${id}.png`));
  const full = fullPrompt(cfg, prompt, { noText: opts.noText });
  log(`asking ${opts.provider ?? "the image provider"} for "${prompt.slice(0, 60)}${prompt.length > 60 ? "..." : ""}"`);
  const r = await generateImage(full, { provider: opts.provider, width, height, model: opts.model });
  ensureDir(join(out, ".."));
  const meta = await sharp(r.png).metadata();
  const buf = meta.width === width && meta.height === height ? r.png : await fitTo(r.png, width, height);
  writeFileSync(out, buf);
  const entry: ImageEntry = { id, file: relative(cfg.projectDir, out), prompt, fullPrompt: full, provider: r.provider, model: r.model, width, height, ms: r.ms, madeAt: new Date().toISOString(), license: opts.license ?? (r.provider.startsWith("azure") ? "generated on the project's Azure Foundry" : undefined) };
  const list = loadImages(cfg).filter((e) => e.id !== id);
  list.push(entry);
  saveImages(cfg, list);
  log(`${basename(out)}: ${meta.width}x${meta.height} from ${r.provider} ${r.model} in ${(r.ms / 1000).toFixed(1)}s${meta.width !== width || meta.height !== height ? `, fitted to ${width}x${height}` : ""}`);
  return entry;
};
