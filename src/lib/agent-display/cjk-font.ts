import { CJK_FONT_DATA, CJK_FONT_GLYPH_COUNT, CJK_FONT_HEIGHT, CJK_FONT_INDEX } from "@/lib/agent-display/cjk-font-data";
import { hasGlyph } from "@/lib/agent-display/font";
import { PixelCanvas, Rgb } from "@/lib/agent-display/pixel-canvas";

export { CJK_FONT_GLYPH_COUNT, CJK_FONT_HEIGHT };

export type CjkGlyph = { width: number; bits: Uint8Array };

const FALLBACK = "?".codePointAt(0) as number;

function decodeBase64(text: string): Uint8Array {
  if (typeof atob === "function") return Uint8Array.from(atob(text), c => c.charCodeAt(0));
  return new Uint8Array(Buffer.from(text, "base64"));
}

let table: Map<number, number> | null = null;
let data: Uint8Array | null = null;

/** Builds the code point -> byte offset table on first use (the font is ~170 KB of base64). */
function load() {
  if (table && data) return { table, data };
  const index = decodeBase64(CJK_FONT_INDEX);
  data = decodeBase64(CJK_FONT_DATA);
  table = new Map();
  let codePoint = 0, cursor = 0, offset = 0;
  while (cursor < index.length) {
    let delta = 0, shift = 0, byte = 0;
    do {
      byte = index[cursor++];
      delta |= (byte & 0x7f) << shift;
      shift += 7;
    } while (byte & 0x80);
    codePoint += delta;
    table.set(codePoint, offset);
    offset += 1 + Math.ceil((data[offset] * CJK_FONT_HEIGHT) / 8);
  }
  return { table, data };
}

/** The 10px glyph for a code point (width x 10 bits, row-major), or null when the font lacks it. */
export function cjkGlyph(codePoint: number): CjkGlyph | null {
  const { table: glyphs, data: bytes } = load();
  const offset = glyphs.get(codePoint);
  if (offset === undefined) return null;
  const width = bytes[offset];
  const bits = new Uint8Array(width * CJK_FONT_HEIGHT);
  for (let i = 0; i < bits.length; i++) bits[i] = (bytes[offset + 1 + (i >> 3)] >> (7 - (i & 7))) & 1;
  return { width, bits };
}

const glyphOrFallback = (ch: string) => cjkGlyph(ch.codePointAt(0) ?? FALLBACK) ?? (cjkGlyph(FALLBACK) as CjkGlyph);

/** True when text has characters the 3x5 font cannot show, so the 10px font should be used. */
export function needsCjk(text: string) {
  return [...text].some(ch => ch !== " " && !hasGlyph(ch));
}

export function measureCjk(text: string) {
  return [...text].reduce((sum, ch) => sum + glyphOrFallback(ch).width, 0);
}

export function drawCjk(canvas: PixelCanvas, text: string, x: number, y: number, color: Rgb) {
  let pen = x;
  for (const ch of text) {
    const glyph = glyphOrFallback(ch);
    for (let row = 0; row < CJK_FONT_HEIGHT; row++) {
      for (let col = 0; col < glyph.width; col++) {
        if (glyph.bits[row * glyph.width + col]) canvas.set(pen + col, y + row, color);
      }
    }
    pen += glyph.width;
  }
}

/**
 * Wraps text into lines no wider than maxWidth pixels: hanzi break anywhere, Latin words stay whole
 * when they fit, and leading spaces are dropped at line starts.
 */
export function wrapCjk(text: string, maxWidth: number): string[] {
  const tokens = text.trim().match(/[A-Za-z0-9'’.,!?:;%&@#+\-_/()]+|\s+|./gu) ?? [];
  const lines: string[] = [];
  let line = "";
  for (const token of tokens) {
    if (/^\s+$/.test(token)) {
      if (line) line += " ";
      continue;
    }
    if (measureCjk(line + token) <= maxWidth) {
      line += token;
      continue;
    }
    if (line.trim()) lines.push(line.trimEnd());
    line = "";
    // A word wider than a whole line is split by character.
    for (const ch of token) {
      if (measureCjk(line + ch) > maxWidth && line) {
        lines.push(line);
        line = "";
      }
      line += ch;
    }
  }
  if (line.trim()) lines.push(line.trimEnd());
  return lines;
}
