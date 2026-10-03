/** Whole-drawing moves: nudge by one cell, mirror, rotate. Cells are row-major indices. */

export type GridTransform = "left" | "right" | "up" | "down" | "flip-h" | "flip-v" | "rotate-cw" | "rotate-ccw";
export const GRID_TRANSFORMS: readonly GridTransform[] = ["left", "right", "up", "down", "flip-h", "flip-v", "rotate-cw", "rotate-ccw"];

export type TransformedPattern = { activeCells: number[]; cellColors: Record<string, string> };

/** Where cell (r, c) lands; null when it falls off the grid. Rotation needs a square grid. */
function mapCell(op: GridTransform, r: number, c: number, rows: number, cols: number): [number, number] | null {
  const moved: [number, number] = (() => {
    switch (op) {
      case "left": return [r, c - 1];
      case "right": return [r, c + 1];
      case "up": return [r - 1, c];
      case "down": return [r + 1, c];
      case "flip-h": return [r, cols - 1 - c];
      case "flip-v": return [rows - 1 - r, c];
      case "rotate-cw": return [c, rows - 1 - r];
      case "rotate-ccw": return [cols - 1 - c, r];
    }
  })();
  const [nr, nc] = moved;
  return nr >= 0 && nr < rows && nc >= 0 && nc < cols ? moved : null;
}

/**
 * Moves every lit cell and its colour. Nudged cells that leave the grid are dropped (undo brings
 * them back); a non-square grid rotates inside its bounds and drops what does not fit.
 */
export function transformPattern(
  activeCells: readonly number[],
  cellColors: Readonly<Record<string, string>> | undefined,
  rows: number,
  cols: number,
  op: GridTransform
): TransformedPattern {
  const nextCells: number[] = [];
  const nextColors: Record<string, string> = {};
  for (const cell of activeCells) {
    const target = mapCell(op, Math.floor(cell / cols), cell % cols, rows, cols);
    if (!target) continue;
    const index = target[0] * cols + target[1];
    nextCells.push(index);
    const color = cellColors?.[cell];
    if (color) nextColors[index] = color;
  }
  return { activeCells: nextCells.sort((a, b) => a - b), cellColors: nextColors };
}
