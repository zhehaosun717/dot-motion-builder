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

/**
 * The cells that spell out text, wrapped to the grid width and centred. Explicit line breaks are kept;
 * lines that do not fit below the grid are cut off.
 */
export function textToCells(text: string, rows: number, cols: number, font: TextFont): number[] {
  const metrics = FONTS[font];
  const lines = text.split(/\r?\n/).flatMap((line) => (line.trim() ? metrics.wrap(line, cols) : [""]));
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  if (!lines.length) return [];
  const blockHeight = lines.length * metrics.height + (lines.length - 1) * LINE_GAP;
  const top = Math.max(0, Math.floor((rows - blockHeight) / 2));
  const canvas = new PixelCanvas();
  lines.forEach((line, i) => {
    const left = Math.max(0, Math.floor((cols - metrics.measure(line)) / 2));
    metrics.draw(canvas, line, left, top + i * (metrics.height + LINE_GAP));
  });
  const cells: number[] = [];
  for (let y = 0; y < Math.min(rows, canvas.size); y++) {
    for (let x = 0; x < Math.min(cols, canvas.size); x++) {
      if (canvas.rgb[(y * canvas.size + x) * 3] > 0) cells.push(y * cols + x);
    }
  }
  return cells;
}
