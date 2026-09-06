/**
 * Burned-in captions from the same entries the SRT file gets: one transparent
 * PNG per entry (sharp renders the text), overlaid by ffmpeg for exactly the
 * entry's span. No libass, no drawtext: works on every ffmpeg build. Styled
 * like the platforms' own captions: a sans in a dark pill, bottom-centred,
 * above the format's safe zone.
 */
import { join } from "node:path";
import sharp from "sharp";
import type { SrtEntry } from "./srt.ts";
import { ensureDir, run } from "../util.ts";

export type CaptionStyle = {
  font?: string;
  /** px at the film's height; default height/22 */
  size?: number;
  color?: string;
  bg?: string;
  /** px from the bottom edge to the pill's bottom; default 8% of the height (a safe zone raises it) */
  bottom?: number;
  maxWidthRatio?: number;
  weight?: number;
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** the pill for one entry as a PNG the size of the frame; lines from the entry's own breaks, long lines wrapped by character count */
export const captionImage = async (text: string, size: { width: number; height: number }, style: CaptionStyle, file: string): Promise<string> => {
  const fontSize = style.size ?? Math.round(size.height / 22);
  const font = style.font ?? "Helvetica Neue, Helvetica, Arial, sans-serif";
  const weight = style.weight ?? 600;
  const maxChars = Math.max(12, Math.floor((size.width * (style.maxWidthRatio ?? 0.8)) / (fontSize * 0.52)));
  const lines = text
    .split("\n")
    .flatMap((line) => {
      const words = line.split(/\s+/);
      const out: string[] = [];
      let cur = "";
      for (const w of words) {
        if ((cur + " " + w).trim().length > maxChars && cur) {
          out.push(cur);
          cur = w;
        } else cur = (cur + " " + w).trim();
      }
      if (cur) out.push(cur);
      return out;
    })
    .slice(0, 3);
  const lineH = Math.round(fontSize * 1.3);
  const padX = Math.round(fontSize * 0.7), padY = Math.round(fontSize * 0.35);
  const textW = Math.round(Math.max(...lines.map((l) => l.length)) * fontSize * 0.55) + padX * 2;
  const boxW = Math.min(size.width - 40, textW);
  const boxH = lines.length * lineH + padY * 2;
  const bottom = style.bottom ?? Math.round(size.height * 0.08);
  const x = Math.round((size.width - boxW) / 2), y = size.height - bottom - boxH;
  const tspans = lines.map((l, i) => `<tspan x="${size.width / 2}" dy="${i === 0 ? 0 : lineH}">${esc(l)}</tspan>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}">
  <rect x="${x}" y="${y}" width="${boxW}" height="${boxH}" rx="${Math.round(fontSize * 0.35)}" fill="${style.bg ?? "rgba(0,0,0,0.72)"}"/>
  <text x="${size.width / 2}" y="${y + padY + Math.round(fontSize * 0.95)}" text-anchor="middle" font-family="${esc(font)}" font-size="${fontSize}" font-weight="${weight}" fill="${style.color ?? "#FFFFFF"}">${tspans}</text>
</svg>`;
  await sharp(Buffer.from(svg)).png().toFile(file);
  return file;
};

/** every entry overlaid on the film for its span; audio copied; returns the output file */
export const burnCaptions = async (video: string, entries: SrtEntry[], size: { width: number; height: number }, style: CaptionStyle, out: string, workDir: string): Promise<string> => {
  if (!entries.length) throw new Error("no caption entries to burn");
  ensureDir(workDir);
  const pngs: string[] = [];
  for (const e of entries) pngs.push(await captionImage(e.text, size, style, join(workDir, `cap-${String(e.index).padStart(3, "0")}.png`)));
  const inputs: string[] = ["-i", video];
  for (const p of pngs) inputs.push("-i", p);
  const chain: string[] = [];
  let prev = "[0:v]";
  entries.forEach((e, i) => {
    const label = i === entries.length - 1 ? "[v]" : `[v${i}]`;
    chain.push(`${prev}[${i + 1}:v]overlay=0:0:enable='between(t,${e.start.toFixed(3)},${e.end.toFixed(3)})'${label}`);
    prev = label;
  });
  await run(["ffmpeg", "-y", "-v", "error", ...inputs, "-filter_complex", chain.join(";"), "-map", "[v]", "-map", "0:a?", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", out]);
  return out;
};
