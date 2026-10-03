/**
 * The format AI agents use to read and draw artwork in the editor (through the desktop app's API and
 * the MCP server): rows of palette keys, like the panel's draw_pixels scene.
 */
import { z } from "zod";
import { medianCutPalette, nearestIndex } from "@/lib/idotmatrix/color-quantizer";
import { layersOf } from "@/stores/layer-ops";
import { LoaderComponent } from "@/types/dot-motion";

export const MAX_ARTWORK_SIZE = 32;
export const MAX_ARTWORK_FRAMES = 24;
/** Keys handed out when reading a drawing ('.' is reserved for unlit). */
const PALETTE_KEYS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const HEX_COLOR = /^#?[0-9a-fA-F]{6}$/;

export const editorDrawSchema = z.object({
  frames: z.array(z.array(z.string().max(MAX_ARTWORK_SIZE)).max(MAX_ARTWORK_SIZE)).min(1).max(MAX_ARTWORK_FRAMES),
  palette: z.record(z.string().length(1), z.string().regex(HEX_COLOR)).refine((value) => Object.keys(value).length <= 64, "at most 64 palette entries"),
  /** layer: a new layer on the selected artboard; artboard: a new artboard. Several frames always make a sequence. */
  target: z.enum(["layer", "artboard"]).default("layer"),
  name: z.string().max(40).optional(),
  x: z.number().int().min(-MAX_ARTWORK_SIZE).max(MAX_ARTWORK_SIZE).default(0),
  y: z.number().int().min(-MAX_ARTWORK_SIZE).max(MAX_ARTWORK_SIZE).default(0),
  fps: z.number().min(1).max(20).optional()
});
export type EditorDrawRequest = z.infer<typeof editorDrawSchema>;

export type EditorArtwork = {
  artboard: string;
  rows: number;
  cols: number;
  palette: Record<string, string>;
  /** Unlit cells are '.'. */
  pixels: string[];
  layers: Array<{ name: string; visible: boolean; active: boolean; pixelCount: number }>;
};

const normalizeHex = (hex: string) => `#${hex.replace("#", "").toUpperCase()}`;

/** One frame as pixels keyed "x,y" on the grid (shifted by x, y); '.', spaces and unknown keys stay unlit. */
export function artworkPixels(rows: readonly string[], palette: Readonly<Record<string, string>>, x = 0, y = 0): Record<string, string> {
  const pixels: Record<string, string> = {};
  rows.forEach((row, rowIndex) => {
    [...row].forEach((key, colIndex) => {
      const color = palette[key];
      if (key === "." || key === " " || !color || !HEX_COLOR.test(color)) return;
      pixels[`${x + colIndex},${y + rowIndex}`] = normalizeHex(color);
    });
  });
  return pixels;
}

/** One frame as lit grid cells and colours, clipped to the grid (for sequence frames). */
export function artworkCells(rows: readonly string[], palette: Readonly<Record<string, string>>, gridRows: number, gridCols: number, x = 0, y = 0) {
  const cells: number[] = [];
  const colors: Record<string, string> = {};
  for (const [key, color] of Object.entries(artworkPixels(rows, palette, x, y))) {
    const [cx, cy] = key.split(",").map(Number);
    if (cx < 0 || cy < 0 || cx >= gridCols || cy >= gridRows) continue;
    const cell = cy * gridCols + cx;
    cells.push(cell);
    colors[cell] = color;
  }
  return { cells: cells.sort((a, b) => a - b), colors };
}

/** The selected artboard as the agent sees it: the flattened picture as palette rows plus its layers. */
export function drawingToArtwork(loader: LoaderComponent): EditorArtwork {
  const { rows, cols } = loader.pattern.grid;
  const base = loader.style.primaryColor.toUpperCase();
  const colorOf = (cell: number) => (loader.pattern.cellColors?.[cell] ?? base).toUpperCase();
  const lit = new Set(loader.pattern.activeCells);
  const counts = new Map<number, number>();
  for (const cell of lit) {
    const value = Number.parseInt(colorOf(cell).slice(1), 16);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  // More colours than keys (e.g. an imported photo): reduce them for reading.
  const colors = counts.size <= PALETTE_KEYS.length ? [...counts.keys()] : (() => {
    const flat = medianCutPalette(counts, PALETTE_KEYS.length);
    return Array.from({ length: flat.length / 3 }, (_, i) => (flat[i * 3] << 16) | (flat[i * 3 + 1] << 8) | flat[i * 3 + 2]);
  })();
  const flatPalette = colors.flatMap((value) => [(value >> 16) & 255, (value >> 8) & 255, value & 255]);
  const palette = Object.fromEntries(colors.map((value, i) => [PALETTE_KEYS[i], `#${value.toString(16).padStart(6, "0").toUpperCase()}`]));
  const pixels = Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => {
    const cell = r * cols + c;
    if (!lit.has(cell)) return ".";
    const value = Number.parseInt(colorOf(cell).slice(1), 16);
    return PALETTE_KEYS[nearestIndex(flatPalette, (value >> 16) & 255, (value >> 8) & 255, value & 255)];
  }).join(""));
  const { layers, activeId } = layersOf(loader);
  return {
    artboard: loader.name,
    rows,
    cols,
    palette,
    pixels,
    layers: [...layers].reverse().map((layer, i) => ({
      name: layer.name || `Layer ${layers.length - i}`,
      visible: layer.visible,
      active: layer.id === activeId,
      pixelCount: Object.keys(layer.pixels).length
    }))
  };
}
