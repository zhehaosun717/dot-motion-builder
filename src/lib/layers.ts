/**
 * Drawing layers. Each layer keeps its pixels in its own coordinates plus an offset, so moving a layer
 * never loses pixels that leave the grid. The flattened activeCells/cellColors every renderer reads are
 * derived from the visible layers (top layer wins).
 */
import { GridTransform } from "@/lib/grid-transforms";
import { PatternLayer } from "@/types/dot-motion";

export type { PatternLayer };

/** "" as a pixel colour means the artboard's base colour (no per-cell override). */
export const BASE_COLOR = "";

export type FlatPattern = { activeCells: number[]; cellColors: Record<string, string> };

const keyOf = (x: number, y: number) => `${x},${y}`;
const parseKey = (key: string): [number, number] => {
  const [x, y] = key.split(",").map(Number);
  return [x, y];
};
const HEX = /^#[0-9A-F]{6}$/;

export function createLayer(name: string, pixels: Record<string, string> = {}, id: string = newLayerId()): PatternLayer {
  return { id, name, visible: true, offsetX: 0, offsetY: 0, pixels };
}

export function newLayerId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `layer-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** A layer holding exactly the given grid cells (offset 0); colours that equal the base colour are stored as base. */
export function layerFromCells(name: string, cells: readonly number[], colors: Readonly<Record<string, string>> | undefined, cols: number, id?: string): PatternLayer {
  const pixels: Record<string, string> = {};
  for (const cell of cells) pixels[keyOf(cell % cols, Math.floor(cell / cols))] = colors?.[cell] ?? BASE_COLOR;
  return createLayer(name, pixels, id);
}

/** Drops malformed pixels and fields (stored projects are untrusted). */
export function sanitizeLayer(layer: Partial<PatternLayer> | undefined, index: number): PatternLayer | null {
  if (!layer || typeof layer !== "object" || typeof layer.id !== "string") return null;
  const pixels: Record<string, string> = {};
  for (const [key, value] of Object.entries(layer.pixels ?? {})) {
    const [x, y] = parseKey(key);
    if (!Number.isInteger(x) || !Number.isInteger(y) || Math.abs(x) > 4096 || Math.abs(y) > 4096) continue;
    const color = String(value).toUpperCase();
    pixels[keyOf(x, y)] = HEX.test(color) ? color : BASE_COLOR;
  }
  const offset = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? Math.round(value) : 0);
  return {
    id: layer.id,
    // An empty name shows as "Layer n" in the panel, in the interface language.
    name: typeof layer.name === "string" ? layer.name.trim().slice(0, 40) : "",
    visible: layer.visible !== false,
    offsetX: offset(layer.offsetX),
    offsetY: offset(layer.offsetY),
    pixels
  };
}

/** The visible layers composited onto a rows x cols grid, bottom layer first. */
export function flattenLayers(layers: readonly PatternLayer[], rows: number, cols: number): FlatPattern {
  const colorByCell = new Map<number, string>();
  for (const layer of layers) {
    if (!layer.visible) continue;
    for (const [key, color] of Object.entries(layer.pixels)) {
      const [lx, ly] = parseKey(key);
      const x = lx + layer.offsetX, y = ly + layer.offsetY;
      if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
      colorByCell.set(y * cols + x, color);
    }
  }
  const activeCells = [...colorByCell.keys()].sort((a, b) => a - b);
  const cellColors: Record<string, string> = {};
  for (const cell of activeCells) {
    const color = colorByCell.get(cell);
    if (color) cellColors[cell] = color;
  }
  return { activeCells, cellColors };
}

/** The layer's colour at a grid cell: undefined when the layer has no pixel there. */
export function layerPixelAt(layer: PatternLayer, cell: number, cols: number): string | undefined {
  return layer.pixels[keyOf((cell % cols) - layer.offsetX, Math.floor(cell / cols) - layer.offsetY)];
}

/**
 * Lights or clears grid cells on a layer. color undefined keeps an existing pixel's colour (new pixels
 * get the base colour); otherwise the pixel takes that colour ("" = base colour).
 */
export function paintLayer(layer: PatternLayer, cells: readonly number[], active: boolean, cols: number, color?: string): PatternLayer {
  const pixels = { ...layer.pixels };
  let changed = false;
  for (const cell of cells) {
    const key = keyOf((cell % cols) - layer.offsetX, Math.floor(cell / cols) - layer.offsetY);
    if (!active) {
      if (key in pixels) {
        delete pixels[key];
        changed = true;
      }
      continue;
    }
    const next = color === undefined ? pixels[key] ?? BASE_COLOR : color;
    if (pixels[key] !== next) {
      pixels[key] = next;
      changed = true;
    }
  }
  return changed ? { ...layer, pixels } : layer;
}

/** Replaces all of a layer's pixels with the given grid cells (and resets its offset). */
export function replaceLayerCells(layer: PatternLayer, cells: readonly number[], colors: Readonly<Record<string, string>> | undefined, cols: number): PatternLayer {
  return { ...layerFromCells(layer.name, cells, colors, cols, layer.id), visible: layer.visible };
}

/** Grid cells (inside the grid) where the layer has pixels, with their colours. */
export function layerCells(layer: PatternLayer, rows: number, cols: number): FlatPattern {
  return flattenLayers([{ ...layer, visible: true }], rows, cols);
}

/**
 * Moves (by changing the offset, so nothing is lost), mirrors or rotates a layer. Mirrors and rotations
 * turn around the grid's centre and also keep pixels that end up outside the grid.
 */
export function transformLayer(layer: PatternLayer, op: GridTransform, rows: number, cols: number): PatternLayer {
  const shifts: Partial<Record<GridTransform, [number, number]>> = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };
  const shift = shifts[op];
  if (shift) return { ...layer, offsetX: layer.offsetX + shift[0], offsetY: layer.offsetY + shift[1] };
  const map = (x: number, y: number): [number, number] => {
    switch (op) {
      case "flip-h": return [cols - 1 - x, y];
      case "flip-v": return [x, rows - 1 - y];
      case "rotate-cw": return [rows - 1 - y, x];
      default: return [y, cols - 1 - x]; // rotate-ccw
    }
  };
  const pixels: Record<string, string> = {};
  for (const [key, color] of Object.entries(layer.pixels)) {
    const [lx, ly] = parseKey(key);
    const [x, y] = map(lx + layer.offsetX, ly + layer.offsetY);
    pixels[keyOf(x, y)] = color;
  }
  return { ...layer, offsetX: 0, offsetY: 0, pixels };
}

/** Moves a layer by whole cells. */
export function offsetLayer(layer: PatternLayer, dx: number, dy: number): PatternLayer {
  return dx || dy ? { ...layer, offsetX: layer.offsetX + dx, offsetY: layer.offsetY + dy } : layer;
}

/** Puts upper on top of lower in one layer (the result keeps lower's id, name and offset). */
export function mergeLayers(lower: PatternLayer, upper: PatternLayer): PatternLayer {
  const pixels = { ...lower.pixels };
  if (upper.visible) {
    for (const [key, color] of Object.entries(upper.pixels)) {
      const [lx, ly] = parseKey(key);
      pixels[keyOf(lx + upper.offsetX - lower.offsetX, ly + upper.offsetY - lower.offsetY)] = color;
    }
  }
  return { ...lower, pixels };
}

/** Grid cells inside a rectangle of grid coordinates (inclusive), clipped to the grid. */
export function cellsInBox(box: { x0: number; y0: number; x1: number; y1: number }, rows: number, cols: number): number[] {
  const cells: number[] = [];
  for (let y = Math.max(0, box.y0); y <= Math.min(rows - 1, box.y1); y++) {
    for (let x = Math.max(0, box.x0); x <= Math.min(cols - 1, box.x1); x++) cells.push(y * cols + x);
  }
  return cells;
}

/**
 * Splits a layer: the pixels under the given grid cells move to a new layer (same place on the grid),
 * the rest stay. Used to lift a selection so it can be moved without disturbing the drawing around it.
 */
export function liftCells(layer: PatternLayer, cells: readonly number[], cols: number, name: string): { rest: PatternLayer; lifted: PatternLayer } {
  const restPixels = { ...layer.pixels };
  const liftedPixels: Record<string, string> = {};
  for (const cell of cells) {
    const x = cell % cols, y = Math.floor(cell / cols);
    const key = keyOf(x - layer.offsetX, y - layer.offsetY);
    if (!(key in restPixels)) continue;
    liftedPixels[keyOf(x, y)] = restPixels[key];
    delete restPixels[key];
  }
  return { rest: { ...layer, pixels: restPixels }, lifted: createLayer(name, liftedPixels) };
}

/** Mirrored partners of a cell for symmetric drawing (the cell itself first, no duplicates). */
export function mirroredCells(cell: number, rows: number, cols: number, symmetry: "none" | "x" | "y" | "xy"): number[] {
  const x = cell % cols, y = Math.floor(cell / cols);
  const xs = symmetry === "x" || symmetry === "xy" ? [x, cols - 1 - x] : [x];
  const ys = symmetry === "y" || symmetry === "xy" ? [y, rows - 1 - y] : [y];
  return [...new Set(ys.flatMap((my) => xs.map((mx) => my * cols + mx)))];
}
