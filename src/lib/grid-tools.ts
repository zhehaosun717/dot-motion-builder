/** Pure geometry behind the canvas drawing tools; cells are row-major indices. */

/** brush: paint (or erase when the stroke starts on a lit cell); erase; rect: drag a box; fill: bucket fill. */
export type DrawTool = "brush" | "erase" | "rect" | "fill";
export const DRAW_TOOLS: readonly DrawTool[] = ["brush", "erase", "rect", "fill"];

const rowOf = (cell: number, cols: number) => Math.floor(cell / cols);
const colOf = (cell: number, cols: number) => cell % cols;

/**
 * Every cell on the straight line between two cells (Bresenham). Pointer events arrive far apart on
 * a fast drag across small cells; filling the line keeps the stroke continuous.
 */
export function cellsOnLine(from: number, to: number, cols: number): number[] {
  let x = colOf(from, cols), y = rowOf(from, cols);
  const x1 = colOf(to, cols), y1 = rowOf(to, cols);
  const dx = Math.abs(x1 - x), dy = -Math.abs(y1 - y);
  const sx = x < x1 ? 1 : -1, sy = y < y1 ? 1 : -1;
  let error = dx + dy;
  const cells = [y * cols + x];
  while (x !== x1 || y !== y1) {
    const doubled = 2 * error;
    if (doubled >= dy) { error += dy; x += sx; }
    if (doubled <= dx) { error += dx; y += sy; }
    cells.push(y * cols + x);
  }
  return cells;
}

/** All cells in the rectangle spanned by two corner cells, in any drag direction. */
export function cellsInRect(a: number, b: number, cols: number): number[] {
  const [r0, r1] = [rowOf(a, cols), rowOf(b, cols)].sort((p, q) => p - q);
  const [c0, c1] = [colOf(a, cols), colOf(b, cols)].sort((p, q) => p - q);
  const cells: number[] = [];
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) cells.push(r * cols + c);
  return cells;
}

/**
 * The 4-connected region of cells that look like the start cell: same on/off state, or — with keyOf —
 * the same key (e.g. state plus colour, so a fill stops at a differently coloured area).
 */
export function floodFill(
  start: number,
  active: ReadonlySet<number>,
  rows: number,
  cols: number,
  keyOf: (cell: number) => string = (cell) => (active.has(cell) ? "on" : "off")
): number[] {
  const target = keyOf(start);
  return floodFillWhere(start, rows, cols, (cell) => keyOf(cell) === target);
}

/** The 4-connected region around start of cells that belong to it (start is always included). */
export function floodFillWhere(start: number, rows: number, cols: number, belongs: (cell: number) => boolean): number[] {
  const seen = new Set([start]);
  const queue = [start];
  for (let i = 0; i < queue.length; i++) {
    const cell = queue[i];
    const r = rowOf(cell, cols), c = colOf(cell, cols);
    const neighbours = [r > 0 ? cell - cols : -1, r < rows - 1 ? cell + cols : -1, c > 0 ? cell - 1 : -1, c < cols - 1 ? cell + 1 : -1];
    for (const next of neighbours) {
      if (next < 0 || seen.has(next) || !belongs(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return queue;
}

export const MAX_FILL_TOLERANCE = 100;

/**
 * Whether two cell colours count as the same area for the fill tool. null is an unlit cell, which is
 * black on an LED panel. Tolerance 0..100 is the largest per-channel difference, as a percentage of 255
 * (like an image editor's magic wand); 0 means identical, and keeps unlit and lit cells apart.
 */
export function colorsWithinTolerance(a: string | null, b: string | null, tolerance: number): boolean {
  if (tolerance <= 0) return a === b;
  const channels = (hex: string | null) => {
    const value = hex ? Number.parseInt(hex.slice(1, 7), 16) : 0;
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  };
  const [ca, cb] = [channels(a), channels(b)];
  const limit = (Math.min(tolerance, MAX_FILL_TOLERANCE) / MAX_FILL_TOLERANCE) * 255;
  return ca.every((channel, i) => Math.abs(channel - cb[i]) <= limit);
}

export type GridGeometry = {
  /** Screen position of the grid element's padding box. */
  left: number;
  top: number;
  /** Screen pixels per layout pixel (the canvas zoom). */
  scale: number;
  padding: number;
  cellSize: number;
  gap: number;
  rows: number;
  cols: number;
};

/** Whether a screen point lies on the cells (gaps between them included), not in the grid's padding. */
export function isPointOnCells(clientX: number, clientY: number, g: GridGeometry): boolean {
  const within = (screen: number, origin: number, count: number) => {
    const local = (screen - origin) / g.scale - g.padding;
    return local >= -g.gap / 2 && local <= count * g.cellSize + (count - 1) * g.gap + g.gap / 2;
  };
  return within(clientX, g.left, g.cols) && within(clientY, g.top, g.rows);
}

/** The cell under a screen point; points in gaps snap to the nearest cell, points outside clamp. */
export function cellAtPoint(clientX: number, clientY: number, g: GridGeometry): number {
  const pitch = g.cellSize + g.gap;
  const toIndex = (screen: number, origin: number, count: number) => {
    const local = (screen - origin) / g.scale - g.padding;
    const index = Math.round((local - g.cellSize / 2) / pitch);
    return Math.max(0, Math.min(count - 1, index));
  };
  return toIndex(clientY, g.top, g.rows) * g.cols + toIndex(clientX, g.left, g.cols);
}
