// Generates placeholder extension icons: a blocky "DS" monogram in white with
// a Lime underline on a Forest (#2F7D4F) background — brand palette from
// Dragon-marketing/BRANDING.md. Pure Node (zlib PNG encoder), zero deps, so it
// runs identically on any dev machine and in CI.
//
// Output: public/icons/icon{16,32,48,128}.png (committed; `npm run build`
// regenerates them deterministically).
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");
const SIZES = [16, 32, 48, 128];

const FOREST = [0x2f, 0x7d, 0x4f];
const LIME = [0x98, 0xcc, 0x65];
const WHITE = [0xff, 0xff, 0xff];

// 5x7 blocky glyphs.
const GLYPHS = {
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
};

// --- minimal PNG encoder (RGBA, 8-bit, no interlace) ---
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0; // filter: none
    rgba.copy(raw, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// --- drawing ---
function makeIcon(size) {
  const px = Buffer.alloc(size * size * 4);
  const set = (x, y, [r, g, b]) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
    px[i + 3] = 255;
  };
  // Background: Forest, with transparent rounded corners.
  const corner = Math.max(1, Math.round(size / 8));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = Math.max(corner - x, x - (size - 1 - corner), 0);
      const dy = Math.max(corner - y, y - (size - 1 - corner), 0);
      if (dx * dx + dy * dy > corner * corner) continue; // rounded corner cut
      set(x, y, FOREST);
    }
  }
  // "DS" monogram: two 5x7 glyphs + 1 col gap = 11 cols x 7 rows.
  const scale = Math.max(1, Math.floor((size * 0.72) / 11));
  const w = 11 * scale;
  const h = 7 * scale;
  const x0 = Math.floor((size - w) / 2);
  const y0 = Math.floor((size - h) / 2) - Math.floor(scale / 2);
  const drawGlyph = (glyph, gx) => {
    const rows = GLYPHS[glyph];
    for (let ry = 0; ry < 7; ry++) {
      for (let rx = 0; rx < 5; rx++) {
        if (rows[ry][rx] !== "1") continue;
        for (let sy = 0; sy < scale; sy++)
          for (let sx = 0; sx < scale; sx++)
            set(x0 + (gx + rx) * scale + sx, y0 + ry * scale + sy, WHITE);
      }
    }
  };
  drawGlyph("D", 0);
  drawGlyph("S", 6);
  // Lime underline beneath the monogram.
  const uy = y0 + h + Math.max(1, Math.floor(scale * 0.9));
  const uh = Math.max(1, Math.floor(scale * 0.8));
  for (let y = uy; y < uy + uh; y++)
    for (let x = x0; x < x0 + w; x++) set(x, y, LIME);
  return encodePng(size, size, px);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  const file = join(OUT_DIR, `icon${size}.png`);
  writeFileSync(file, makeIcon(size));
  console.log(`wrote ${file}`);
}
