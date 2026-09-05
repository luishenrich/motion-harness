// helper for the locate check: a letterboxed and a cropped copy of one rendered frame
import sharp from "sharp";
const [src, outDir] = process.argv.slice(2);
await sharp(src).resize(960, 540).extend({ top: 120, bottom: 120, background: "#000" }).png().toFile(`${outDir}/pasted-letterbox.png`);
await sharp(src).extract({ left: 500, top: 250, width: 900, height: 600 }).png().toFile(`${outDir}/pasted-crop.png`);
