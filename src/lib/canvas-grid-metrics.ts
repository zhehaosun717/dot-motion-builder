import { LEGACY_MAX_GRID_SIZE } from "@/lib/grid-limits";
import { LoaderComponent } from "@/types/dot-motion";

export const CANVAS_FRAME_INSET = 14;
export const CANVAS_GRID_PADDING = 20;
const LEGACY_MIN_CELL_SIZE = 22;
const DENSE_GAP_RATIO = 0.25;

export type CanvasGridMetrics = {
  rows: number;
  cols: number;
  cellSize: number;
  gap: number;
  gridWidth: number;
  gridHeight: number;
  panelWidth: number;
  panelHeight: number;
  padding: number;
};

export function getCanvasGridMetrics(loader: LoaderComponent): CanvasGridMetrics {
  const { rows, cols, gap } = loader.pattern.grid;
  const squareStage = Math.min(loader.artboard.width, loader.artboard.height);
  const availableSide = squareStage - CANVAS_FRAME_INSET * 2 - CANVAS_GRID_PADDING * 2;
  const span = Math.max(rows, cols);
  const dense = span > LEGACY_MAX_GRID_SIZE;
  // Grids beyond the original 13 cells (up to a 32x32 LED panel) cap the gap at a
  // fraction of the pitch so the cells still fit the artboard and stay clickable.
  const requestedGap = dense
    ? Math.min(Math.max(0, Math.round(gap)), Math.max(1, Math.floor((availableSide / span) * DENSE_GAP_RATIO)))
    : Math.max(0, Math.round(gap));
  // The reference fish-eye uses a 16 px cell with a 3 px gap. Preserve that
  // breathing room at every output size so the 1.3x lens bulge stays organic
  // instead of collapsing into a dense, overlapping block.
  const fishEyeCell = availableSide / (span + .2 * (span - 1));
  const renderGap = loader.animation.style === "fisheye"
    ? Math.max(requestedGap, Math.round(fishEyeCell * .2))
    : requestedGap;
  const availableWidth = availableSide - (cols - 1) * renderGap;
  const availableHeight = availableSide - (rows - 1) * renderGap;
  const cellSize = Math.max(dense ? 1 : LEGACY_MIN_CELL_SIZE, Math.floor(Math.min(availableWidth / cols, availableHeight / rows)));
  const gridWidth = cols * cellSize + (cols - 1) * renderGap;
  const gridHeight = rows * cellSize + (rows - 1) * renderGap;

  return {
    rows,
    cols,
    cellSize,
    gap: renderGap,
    gridWidth,
    gridHeight,
    panelWidth: gridWidth + CANVAS_GRID_PADDING * 2,
    panelHeight: gridHeight + CANVAS_GRID_PADDING * 2,
    padding: CANVAS_GRID_PADDING
  };
}
