import { CJK_FONT_HEIGHT, drawCjk, measureCjk, wrapCjk } from "@/lib/agent-display/cjk-font";
import { drawText, GLYPH_ADVANCE, GLYPH_HEIGHT, measureText, wrapText } from "@/lib/agent-display/font";
import { PixelCanvas, Rgb } from "@/lib/agent-display/pixel-canvas";

/** large: the 10px pixel font with Chinese; small: the 3x5 font (Latin letters, digits, punctuation). */
export type TextFont = "large" | "small";
export const TEXT_FONTS: readonly TextFont[] = ["large", "small"];

const LINE_GAP = 1;
const INK: Rgb = [255, 255, 255];

type FontMetrics = { height: number; wrap: (line: string, width: number) => string[]; measure: (line: string) => number; draw: (canvas: PixelCanvas, line: string, x: number, y: number) => void };

const FONTS: Record<TextFont, FontMetrics> = {
  large: {
    height: CJK_FONT_HEIGHT,
    wrap: (line, width) => wrapCjk(line, width),
    measure: measureCjk,
    draw: (canvas, line, x, y) => drawCjk(canvas, line, x, y, INK)
  },
  small: {
    height: GLYPH_HEIGHT,
    wrap: (line, width) => wrapText(line, Math.max(1, Math.floor((width + 1) / GLYPH_ADVANCE))),
    measure: (line) => measureText(line),
    draw: (canvas, line, x, y) => drawText(canvas, line, x, y, INK)
  }
};

/** Largest whole-number enlargement per font: the 10px font at 3x is already 30 cells tall. */
export const MAX_TEXT_SCALE: Record<TextFont, number> = { large: 3, small: 4 };

/** Lit pixels of one line drawn at 1x, left-aligned at the origin. */
function linePixels(metrics: FontMetrics, line: string): Array<[number, number]> {
  const canvas = new PixelCanvas();
  metrics.draw(canvas, line, 0, 0);
  const pixels: Array<[number, number]> = [];
  for (let y = 0; y < metrics.height; y++) {
    for (let x = 0; x < canvas.size; x++) if (canvas.rgb[(y * canvas.size + x) * 3] > 0) pixels.push([x, y]);
  }
  return pixels;
}

/**
 * The cells that spell out text, wrapped to the grid width and centred. scale enlarges every font pixel
 * to a scale x scale block (pixel fonts only scale by whole numbers). Explicit line breaks are kept;
 * whatever does not fit the grid is cut off.
 */
export function textToCells(text: string, rows: number, cols: number, font: TextFont, scale = 1): number[] {
  const metrics = FONTS[font];
  const factor = Math.max(1, Math.min(MAX_TEXT_SCALE[font], Math.round(scale)));
  const wrapWidth = Math.max(1, Math.floor(cols / factor));
  const lines = text.split(/\r?\n/).flatMap((line) => (line.trim() ? metrics.wrap(line, wrapWidth) : [""]));
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  if (!lines.length) return [];
  const pitch = metrics.height + LINE_GAP;
  const blockHeight = (lines.length * pitch - LINE_GAP) * factor;
  const top = Math.max(0, Math.floor((rows - blockHeight) / 2));
  const cells = new Set<number>();
  lines.forEach((line, i) => {
    const left = Math.max(0, Math.floor((cols - metrics.measure(line) * factor) / 2));
    for (const [x, y] of linePixels(metrics, line)) {
      for (let dy = 0; dy < factor; dy++) {
        for (let dx = 0; dx < factor; dx++) {
          const row = top + (i * pitch + y) * factor + dy, col = left + x * factor + dx;
          if (row < rows && col < cols) cells.add(row * cols + col);
        }
      }
    }
  });
  return [...cells].sort((a, b) => a - b);
}
