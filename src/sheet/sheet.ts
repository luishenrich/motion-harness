/**
 * Contact sheets with scene knowledge: every cell carries a border, the film
 * frame, the scene-local address, and the reason the frame is on the sheet.
 * Transition frames are marked so a reviewer never reports a wipe as a defect.
 */
import sharp from "sharp";
import { ensureDir } from "../util.ts";
import { join } from "node:path";

export type SheetCell = {
  file: string;
  title: string; // "probe+12"
  sub: string; // "film 20.53s f616 · event pick1"
  kind: "transition" | "settled" | "event" | "mid" | "end" | "check" | "dense" | "plain";
};

const KIND_COLOR: Record<SheetCell["kind"], string> = {
  transition: "#E8871E",
  event: "#2F6FDE",
  settled: "#6B6B6B",
  mid: "#6B6B6B",
  end: "#6B6B6B",
  check: "#8E44AD",
  dense: "#B8B8B8",
  plain: "#B8B8B8",
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const makeSheet = async (
  cells: SheetCell[],
  out: string,
  opts: { columns?: number; cellWidth?: number; aspect?: number; header?: string; footer?: string } = {},
): Promise<{ file: string; width: number; height: number }> => {
  const columns = opts.columns ?? 4;
  const cw = opts.cellWidth ?? 480;
  const aspect = opts.aspect ?? 16 / 9;
  const ih = Math.round(cw / aspect);
  const label = 44;
  const border = 3;
  const gap = 10;
  const headerH = opts.header ? 40 : 0;
  const footerH = opts.footer ? 30 : 0;
  const rows = Math.ceil(cells.length / columns);
  const cellH = ih + label + border * 2;
  const cellW = cw + border * 2;
  const W = columns * cellW + (columns + 1) * gap;
  const H = headerH + rows * cellH + (rows + 1) * gap + footerH;

  const composites: sharp.OverlayOptions[] = [];
  const svgParts: string[] = [];
  if (opts.header) svgParts.push(`<text x="${gap}" y="27" font-family="Helvetica, Arial, sans-serif" font-size="20" font-weight="700" fill="#111">${esc(opts.header)}</text>`);
  if (opts.footer) svgParts.push(`<text x="${gap}" y="${H - 10}" font-family="Helvetica, Arial, sans-serif" font-size="14" fill="#555">${esc(opts.footer)}</text>`);

  await Promise.all(
    cells.map(async (c, i) => {
      const col = i % columns;
      const row = Math.floor(i / columns);
      const x = gap + col * (cellW + gap);
      const y = headerH + gap + row * (cellH + gap);
      const color = KIND_COLOR[c.kind];
      svgParts.push(`<rect x="${x}" y="${y}" width="${cellW}" height="${cellH}" fill="${color}" />`);
      svgParts.push(`<rect x="${x + border}" y="${y + border + ih}" width="${cw}" height="${label}" fill="#FAFAFA" />`);
      svgParts.push(`<text x="${x + border + 8}" y="${y + border + ih + 18}" font-family="Helvetica, Arial, sans-serif" font-size="15" font-weight="700" fill="#111">${esc(c.title)}</text>`);
      svgParts.push(`<text x="${x + border + 8}" y="${y + border + ih + 36}" font-family="Helvetica, Arial, sans-serif" font-size="13" fill="#444">${esc(c.sub)}</text>`);
      const kindTag = c.kind === "transition" ? "IN TRANSITION" : c.kind === "event" ? "EVENT" : "";
      if (kindTag) svgParts.push(`<text x="${x + cellW - 8}" y="${y + border + ih + 18}" text-anchor="end" font-family="Helvetica, Arial, sans-serif" font-size="12" font-weight="700" fill="${color}">${kindTag}</text>`);
      // transparent pixels become black, as they would in the encoded film
      const img = await sharp(c.file).flatten({ background: "#000" }).resize(cw, ih, { fit: "contain", background: "#000" }).png().toBuffer();
      composites.push({ input: img, left: x + border, top: y + border });
    }),
  );

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${svgParts.join("")}</svg>`;
  ensureDir(join(out, ".."));
  await sharp({ create: { width: W, height: H, channels: 3, background: "#E9E9E9" } })
    .composite([{ input: Buffer.from(svg), left: 0, top: 0 }, ...composites])
    .png({ compressionLevel: 6 })
    .toFile(out);
  return { file: out, width: W, height: H };
};
