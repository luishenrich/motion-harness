/**
 * Contact sheets with scene knowledge. No hard tile borders (they read as defects
 * on a dark ground); every tile is the picture plus a footer strip that carries
 * the scene address, the film time and the reason the frame is on the sheet.
 * Transition frames are marked so a reviewer never reports a wipe as a defect.
 * A tile can be a 1:1 crop around a probed element (`--zoom key`).
 */
import sharp from "sharp";
import { ensureDir } from "../util.ts";
import { join } from "node:path";

export type SheetCell = {
  file: string;
  title: string; // "probe+12"
  sub: string; // "film 20.53s f616 · event pick1"
  kind: "transition" | "settled" | "event" | "mid" | "end" | "check" | "dense" | "plain";
  /** 1:1 crop of the frame, in frame pixels; the tile shows exactly these pixels */
  crop?: { left: number; top: number; width: number; height: number };
  /** a short warning drawn in the footer ("no box for card") */
  mark?: string;
};

const KIND_COLOR: Record<SheetCell["kind"], string> = {
  transition: "#E8871E",
  event: "#2F6FDE",
  settled: "#6B6B6B",
  mid: "#6B6B6B",
  end: "#6B6B6B",
  check: "#8E44AD",
  dense: "#9A9A9A",
  plain: "#9A9A9A",
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const FONT = "Helvetica, Arial, sans-serif";

export type SheetOpts = {
  columns?: number;
  /** tile picture width in pixels; with `zoom` the crop size wins */
  cellWidth?: number;
  aspect?: number;
  header?: string;
  footer?: string;
  /** tile picture size when cells carry crops (all crops share it) */
  zoom?: { width: number; height: number };
};

export const makeSheet = async (cells: SheetCell[], out: string, opts: SheetOpts = {}): Promise<{ file: string; width: number; height: number }> => {
  const columns = opts.columns ?? 4;
  const cw = opts.zoom?.width ?? opts.cellWidth ?? 480;
  const ih = opts.zoom?.height ?? Math.round(cw / (opts.aspect ?? 16 / 9));
  const strip = 40; // footer strip inside the tile, under the picture
  const gap = 14;
  const headerH = opts.header ? 42 : 0;
  const footerH = opts.footer ? 30 : 0;
  const rows = Math.ceil(cells.length / columns);
  const cellH = ih + strip;
  const W = columns * cw + (columns + 1) * gap;
  const H = headerH + rows * cellH + (rows + 1) * gap + footerH;

  const composites: sharp.OverlayOptions[] = [];
  const svgParts: string[] = [];
  if (opts.header) svgParts.push(`<text x="${gap}" y="28" font-family="${FONT}" font-size="19" font-weight="700" fill="#111">${esc(opts.header)}</text>`);
  if (opts.footer) svgParts.push(`<text x="${gap}" y="${H - 10}" font-family="${FONT}" font-size="13" fill="#555">${esc(opts.footer)}</text>`);

  await Promise.all(
    cells.map(async (c, i) => {
      const col = i % columns;
      const row = Math.floor(i / columns);
      const x = gap + col * (cw + gap);
      const y = headerH + gap + row * (cellH + gap);
      const color = KIND_COLOR[c.kind];
      // the footer strip: white, a colored dot for the kind, the address, the film time and label
      svgParts.push(`<rect x="${x}" y="${y + ih}" width="${cw}" height="${strip}" fill="#FFFFFF" />`);
      svgParts.push(`<circle cx="${x + 12}" cy="${y + ih + 14}" r="4" fill="${color}" />`);
      svgParts.push(`<text x="${x + 22}" y="${y + ih + 18}" font-family="${FONT}" font-size="14" font-weight="700" fill="#111">${esc(c.title)}</text>`);
      svgParts.push(`<text x="${x + 22}" y="${y + ih + 33}" font-family="${FONT}" font-size="11.5" fill="#555">${esc(c.sub)}</text>`);
      const tag = c.mark ? c.mark.toUpperCase() : c.kind === "transition" ? "IN TRANSITION" : c.kind === "event" ? "EVENT" : "";
      if (tag) svgParts.push(`<text x="${x + cw - 8}" y="${y + ih + 18}" text-anchor="end" font-family="${FONT}" font-size="11" font-weight="700" fill="${c.mark ? "#C0392B" : color}">${esc(tag)}</text>`);
      // transparent pixels become black, as they would in the encoded film
      let img = sharp(c.file).flatten({ background: "#000" });
      if (c.crop) {
        const meta = await img.metadata();
        const fw = meta.width ?? 0, fh = meta.height ?? 0;
        const left = Math.max(0, Math.min(fw - c.crop.width, c.crop.left));
        const top = Math.max(0, Math.min(fh - c.crop.height, c.crop.top));
        const width = Math.min(c.crop.width, fw), height = Math.min(c.crop.height, fh);
        img = sharp(await img.extract({ left, top, width, height }).png().toBuffer());
        // 1:1 pixels: never scale a crop, pad if the frame is smaller than the window
        img = img.resize(cw, ih, { fit: "contain", position: "left top", background: "#000", withoutEnlargement: true });
      } else img = img.resize(cw, ih, { fit: "contain", background: "#000" });
      composites.push({ input: await img.png().toBuffer(), left: x, top: y });
    }),
  );

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${svgParts.join("")}</svg>`;
  ensureDir(join(out, ".."));
  await sharp({ create: { width: W, height: H, channels: 3, background: "#E4E2DC" } })
    .composite([{ input: Buffer.from(svg), left: 0, top: 0 }, ...composites])
    .png({ compressionLevel: 6 })
    .toFile(out);
  return { file: out, width: W, height: H };
};

/** a 480x320 window centred on an element box, clamped to the frame */
export const zoomWindow = (box: { x: number; y: number; w: number; h: number }, frame: { width: number; height: number }, size = { width: 480, height: 320 }) => {
  const width = Math.min(size.width, frame.width), height = Math.min(size.height, frame.height);
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  const left = Math.round(Math.max(0, Math.min(frame.width - width, cx - width / 2)));
  const top = Math.round(Math.max(0, Math.min(frame.height - height, cy - height / 2)));
  return { left, top, width, height };
};
