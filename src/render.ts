// On-demand HTML -> 2-bit PNG render pipeline for the TRMNL OG display.
// Port of reference/render.mjs. No headless browser: satori-html turns an
// HTML string into a satori (React-element-shaped) tree, satori lays it out
// with Yoga and emits SVG, resvg rasterizes to PNG, sharp quantizes to a
// 4-gray palette (matches the OG panel's 2-bit depth).
import satori from "satori";
import { html } from "satori-html";
import { Resvg } from "@resvg/resvg-js";
import sharp from "sharp";
import { readFileSync } from "node:fs";
import zlib from "node:zlib";

export const PANEL_WIDTH = 800;
export const PANEL_HEIGHT = 480;

interface SatoriFont {
  name: string;
  data: Buffer;
  weight: 400 | 700;
  style: "normal";
}

// Satori cannot parse variable fonts (its parser throws on any font with an
// fvar table), so only static-weight TTFs work here. DejaVu Sans for now;
// swap in static Inter weights if pixel-parity with the Terminus look is
// ever wanted. Vendored in assets/fonts (system font paths differ per
// distro -- Arch: /usr/share/fonts/TTF, Debian: .../truetype/dejavu).
export const FONT_FAMILY = "DejaVu Sans";

// Resolves correctly from both src/ (tsx) and dist/ (compiled) -- ../assets
// is the repo-root assets dir either way.
const fontsDir = new URL("../assets/fonts/", import.meta.url);

// Loaded once at module init -- reused across every render call.
export const fonts: SatoriFont[] = [
  {
    name: "DejaVu Sans",
    data: readFileSync(new URL("DejaVuSans.ttf", fontsDir)),
    weight: 400,
    style: "normal",
  },
  {
    name: "DejaVu Sans",
    data: readFileSync(new URL("DejaVuSans-Bold.ttf", fontsDir)),
    weight: 700,
    style: "normal",
  },
];

/** Strip inter-tag whitespace (satori treats it as a text-node child, which
 * trips the "explicit display:flex on any >1-child element" rule) and trim.
 * Screen authors never need to call this themselves -- `RenderContext.html()`
 * (see routes/display.ts) applies it before handing markup to `renderScreen`. */
export function minify(markup: string): string {
  return markup.replace(/>\s+</g, "><").trim();
}

// --- 2-bit grayscale PNG encoder -------------------------------------------
// Terminus serves color_type=0 (grayscale) bit_depth=2 PNGs — the one format
// the OG firmware is proven against. sharp can only emit 8-bit gray or
// palette PNGs, so we quantize + pack + chunk by hand (it's ~50 lines).

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(...buffers: Buffer[]): number {
  let c = 0xffffffff;
  for (const buf of buffers) {
    for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(head.subarray(4), body), 0);
  return Buffer.concat([head, body, crc]);
}

/** Quantize 8-bit grayscale pixels to the panel's 4 levels (0/85/170/255)
 * and encode as a color_type=0, bit_depth=2 PNG — byte-format parity with
 * what Terminus serves the device. */
export function encodeGray2bitPng(pixels: Buffer, width: number, height: number): Buffer {
  const bytesPerRow = Math.ceil(width / 4);
  const raw = Buffer.alloc(height * (1 + bytesPerRow));
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < width; x += 4) {
      let packed = 0;
      for (let i = 0; i < 4 && x + i < width; i++) {
        const v = pixels[y * width + x + i];
        const q = v < 43 ? 0 : v < 128 ? 1 : v < 213 ? 2 : 3;
        packed |= q << (6 - 2 * i);
      }
      raw[o++] = packed;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 2; // bit depth
  ihdr[9] = 0; // color type: grayscale
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * Render an HTML string (already minified/interpolated by the caller) to a
 * 2-bit grayscale PNG sized for the given panel dimensions (defaulting to
 * the OG panel's 800x480).
 */
export async function renderScreen(
  htmlString: string,
  width: number = PANEL_WIDTH,
  height: number = PANEL_HEIGHT,
): Promise<Buffer> {
  const markup = html(htmlString);
  const svg = await satori(markup, {
    width,
    height,
    fonts,
  });
  const png = new Resvg(svg, { fitTo: { mode: "width", value: width } }).render().asPng();
  const gray = await sharp(png)
    .flatten({ background: "#fff" })
    .grayscale()
    .raw()
    .toBuffer();
  return encodeGray2bitPng(gray, width, height);
}
