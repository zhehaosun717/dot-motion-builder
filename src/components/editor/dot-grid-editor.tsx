"use client";

import { memo, useCallback, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { getCellShapeClassName, getCellShapeStyle } from "@/lib/cell-shapes";
import { getCanvasGridMetrics } from "@/lib/canvas-grid-metrics";
import { rgbaWithOpacity } from "@/lib/colors";
import { LEGACY_MAX_GRID_SIZE } from "@/lib/grid-limits";
import { cellAtPoint, cellsOnLine, colorsWithinTolerance, floodFillWhere, GridGeometry, isPointOnCells, isShapeTool, shapeCells, ShapeTool } from "@/lib/grid-tools";
import { moveSelection } from "@/components/editor/selection-actions";
import { layerPixelAt, mirroredCells } from "@/lib/layers";
import { layersOf } from "@/stores/layer-ops";
import { useDrawStore } from "@/stores/use-draw-store";
import { LoaderComponent } from "@/types/dot-motion";

/** Tool, brush colour and tool options come from the draw store; Alt+click picks a colour with any tool. */
type DotGridEditorProps = {
  loader: LoaderComponent;
  /** Sets many cells at once (one call per stroke step, shape or fill), lit cells in the given colour. */
  onApplyCells: (cells: number[], active: boolean, color?: string) => void;
  variant?: "default" | "canvas";
};

/**
 * Pointer presses the grid turned into drawing. The canvas underneath checks this so it does not also
 * start dragging the artboard and steal the pointer — which used to drop rectangles started in a gap.
 */
export const drawingPointerDowns = new WeakSet<Event>();

/** The cell size the original glow values were tuned for; dense grids scale their glow down from it. */
const GLOW_REFERENCE_CELL = 22;

/** mode: what the drag does — paint/shape strokes, drawing a selection box, or moving the selection. */
type Stroke = { pointerId: number; value: boolean; start: number; last: number; mode: "draw" | "select" | "move" };

type DotCellProps = {
  index: number;
  active: boolean;
  /** Per-cell colour override, if any. */
  color?: string;
  preview: boolean;
  /** Inside the selection box. */
  selected: boolean;
  className: string;
  style: CSSProperties;
  inactiveBackground: string;
};

/** Memoised so a stroke re-renders only the cells it changes, not all 1024 of a 32x32 grid. */
const DotCell = memo(function DotCell({ index, active, color, preview, selected, className, style, inactiveBackground }: DotCellProps) {
  const activeStyle = color ? { ...style, ["--cell-color" as string]: color, ["--cell-glow-color" as string]: color } : style;
  return (
    <button
      type="button"
      data-dot-cell="true"
      className={`${className}${active ? " is-active" : ""}${preview ? " is-preview" : ""}${selected ? " is-selected" : ""}`}
      onClick={(event) => event.preventDefault()}
      style={active ? activeStyle : { ...style, background: inactiveBackground }}
      aria-label={`Toggle cell ${index + 1}`}
      aria-pressed={active}
    />
  );
});

export function DotGridEditor({ loader, onApplyCells, variant = "default" }: DotGridEditorProps) {
  const { rows, cols, cellSize, gap } = loader.pattern.grid;
  const canvasMetrics = useMemo(() => getCanvasGridMetrics(loader), [loader]);
  const activeCells = useMemo(() => new Set(loader.pattern.activeCells), [loader.pattern.activeCells]);
  const dense = Math.max(rows, cols) > LEGACY_MAX_GRID_SIZE;
  const renderGap = variant === "canvas" ? canvasMetrics.gap : gap;
  const renderCellSize = variant === "canvas" ? canvasMetrics.cellSize : cellSize;
  const gridRef = useRef<HTMLDivElement>(null);
  const strokeRef = useRef<Stroke | null>(null);
  const [shapePreview, setShapePreview] = useState<Set<number> | null>(null);
  const tool = useDrawStore((state) => state.tool);
  const brushChoice = useDrawStore((state) => state.brushChoice);

  // Pointer handlers read the latest props from this ref so they never act on a stale grid.
  const cellColors = loader.pattern.cellColors;
  const paintColor = (brushChoice ?? loader.style.primaryColor).toUpperCase();
  const colorOf = (cell: number) => (cellColors?.[cell] ?? loader.style.primaryColor).toUpperCase();
  const symmetry = useDrawStore((state) => state.symmetry);
  const selection = useDrawStore((state) => (state.selection?.loaderId === loader.id ? state.selection : null));
  // Brush toggling looks at the layer being drawn on: lower layers show through but are not touched.
  const activeLayer = useMemo(() => {
    const { layers, activeId } = layersOf(loader);
    return layers.find((layer) => layer.id === activeId) ?? null;
  }, [loader]);
  const activeLayerColorOf = (cell: number) => {
    const pixel = activeLayer ? layerPixelAt(activeLayer, cell, cols) : undefined;
    return pixel === undefined ? null : (pixel || loader.style.primaryColor).toUpperCase();
  };
  const loaderId = loader.id;
  const latest = useRef({ activeCells, onApplyCells, rows, cols, renderCellSize, renderGap, paintColor, colorOf, activeLayerColorOf, loaderId });
  latest.current = { activeCells, onApplyCells, rows, cols, renderCellSize, renderGap, paintColor, colorOf, activeLayerColorOf, loaderId };
  /** Adds the mirrored partners of every cell when symmetric drawing is on. */
  const mirror = useCallback((cells: readonly number[]) => {
    const { symmetry: mode } = useDrawStore.getState();
    const { rows: r, cols: c } = latest.current;
    return mode === "none" ? [...cells] : [...new Set(cells.flatMap((cell) => mirroredCells(cell, r, c, mode)))];
  }, []);

  const geometry = useCallback((): GridGeometry => {
    const grid = gridRef.current as HTMLDivElement;
    const box = grid.getBoundingClientRect();
    const current = latest.current;
    return {
      left: box.left,
      top: box.top,
      scale: box.width / (grid.offsetWidth || box.width || 1), // canvas zoom
      padding: Number.parseFloat(getComputedStyle(grid).paddingLeft) || 0,
      cellSize: current.renderCellSize,
      gap: current.renderGap,
      rows: current.rows,
      cols: current.cols
    };
  }, []);
  const cellFromPointer = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => cellAtPoint(event.clientX, event.clientY, geometry()),
    [geometry]
  );
  /** Holding Shift draws the other kind of shape (outline instead of solid, or the reverse). */
  const shapeFor = useCallback((shape: ShapeTool, from: number, to: number, shiftKey: boolean) => {
    const filled = useDrawStore.getState().shapeFilled !== shiftKey;
    return mirror(shapeCells(shape, from, to, latest.current.cols, filled));
  }, [mirror]);

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    // A press on the padding around the cells is left to the canvas, which drags the artboard.
    if (!isPointOnCells(event.clientX, event.clientY, geometry())) return;
    drawingPointerDowns.add(event.nativeEvent);
    event.preventDefault();
    try {
      // Keeps the stroke when the pointer leaves the grid; harmless to skip if the pointer is already gone.
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // no active pointer to capture (e.g. synthetic events)
    }
    const cell = cellFromPointer(event);
    const { activeCells: active, onApplyCells: apply, rows: r, cols: c, paintColor: paint, colorOf: color, activeLayerColorOf, loaderId: id } = latest.current;
    const draw = useDrawStore.getState();
    if (draw.tool === "select" && !event.altKey) {
      // Inside the current box: drag moves its contents; elsewhere: start a new box.
      const x = cell % c, y = Math.floor(cell / c);
      const box = draw.selection;
      const inside = box && box.loaderId === id && x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1;
      if (!inside) draw.setSelection({ loaderId: id, x0: x, y0: y, x1: x, y1: y });
      strokeRef.current = { pointerId: event.pointerId, value: true, start: cell, last: cell, mode: inside ? "move" : "select" };
      return;
    }
    if (event.altKey || draw.tool === "pick") {
      // Eyedropper: takes a lit cell's colour, then returns to the tool you were using.
      if (!active.has(cell)) return;
      draw.setBrushColor(color(cell));
      if (draw.tool === "pick") draw.setTool(draw.previousTool);
      return;
    }
    // Starting on a cell that already has the brush colour erases instead (toggle), as before colours.
    const alreadyPainted = activeLayerColorOf(cell) === paint;
    const value = draw.tool === "erase" ? false : isShapeTool(draw.tool) ? true : !alreadyPainted;
    if (value) draw.rememberColor(paint);
    if (draw.tool === "fill") {
      const colorAt = (cellIndex: number) => (active.has(cellIndex) ? color(cellIndex) : null);
      const target = colorAt(cell);
      const belongs = (cellIndex: number) => colorsWithinTolerance(colorAt(cellIndex), target, draw.fillTolerance);
      // With symmetry, each mirrored seed fills its own region.
      const seeds = mirror([cell]);
      const region = draw.fillContiguous
        ? [...new Set(seeds.flatMap((seed) => floodFillWhere(seed, r, c, (cellIndex) => colorsWithinTolerance(colorAt(cellIndex), colorAt(seed), draw.fillTolerance))))]
        : Array.from({ length: r * c }, (_, index) => index).filter(belongs);
      apply(region, value, paint);
      return;
    }
    strokeRef.current = { pointerId: event.pointerId, value, start: cell, last: cell, mode: "draw" };
    if (isShapeTool(draw.tool)) setShapePreview(new Set(shapeFor(draw.tool, cell, cell, event.shiftKey)));
    else apply(mirror([cell]), value, paint);
  }, [cellFromPointer, geometry, mirror, shapeFor]);

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const stroke = strokeRef.current;
    if (!stroke || stroke.pointerId !== event.pointerId) return;
    const cell = cellFromPointer(event);
    const { tool: currentTool } = useDrawStore.getState();
    const { cols: c } = latest.current;
    if (stroke.mode === "select") {
      const [ax, ay, bx, by] = [stroke.start % c, Math.floor(stroke.start / c), cell % c, Math.floor(cell / c)];
      useDrawStore.getState().setSelection({ loaderId: latest.current.loaderId, x0: Math.min(ax, bx), y0: Math.min(ay, by), x1: Math.max(ax, bx), y1: Math.max(ay, by) });
    } else if (stroke.mode === "move") {
      moveSelection((cell % c) - (stroke.last % c), Math.floor(cell / c) - Math.floor(stroke.last / c), "");
    } else if (isShapeTool(currentTool)) {
      // Re-evaluated on every move so pressing or releasing Shift mid-drag updates the preview.
      setShapePreview(new Set(shapeFor(currentTool, stroke.start, cell, event.shiftKey)));
    } else if (cell !== stroke.last) {
      const { onApplyCells: apply, paintColor: paint } = latest.current;
      apply(mirror(cellsOnLine(stroke.last, cell, c)), stroke.value, paint);
    }
    strokeRef.current = { ...stroke, last: cell };
  }, [cellFromPointer, mirror, shapeFor]);

  const endStroke = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const stroke = strokeRef.current;
    if (!stroke || stroke.pointerId !== event.pointerId) return;
    strokeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const { onApplyCells: apply, paintColor: paint } = latest.current;
    const { tool: currentTool } = useDrawStore.getState();
    // The release point counts too: a quick drag can end before a pointermove reports the last cell.
    if (stroke.mode === "draw" && isShapeTool(currentTool) && event.type === "pointerup") {
      apply(shapeFor(currentTool, stroke.start, cellFromPointer(event), event.shiftKey), stroke.value, paint);
    }
    setShapePreview(null);
  }, [cellFromPointer, shapeFor]);

  const { primaryColor, primaryAlpha, backgroundColor, backgroundAlpha, shadow, glow, cellShape, innerRadius } = loader.style;
  const cellStyle = useMemo<CSSProperties>(() => {
    const color = rgbaWithOpacity(primaryColor, 1, primaryAlpha ?? 1);
    const glowSize = shadow ? (dense ? glow * Math.min(1, renderCellSize / GLOW_REFERENCE_CELL) : glow) : 0;
    return {
      width: renderCellSize,
      height: renderCellSize,
      // getCellShapeStyle only reads the shape fields; passing just those keeps this memo stable while drawing.
      ...getCellShapeStyle({ style: { cellShape, innerRadius } } as LoaderComponent, renderCellSize),
      ["--cell-color" as string]: color,
      ["--cell-glow-color" as string]: color,
      ["--cell-glow-size" as string]: `${glowSize}px`
    };
  }, [cellShape, dense, glow, innerRadius, primaryAlpha, primaryColor, renderCellSize, shadow]);
  const inactiveBackground = useMemo(
    () => rgbaWithOpacity(backgroundColor ?? "#2D3743", 1, backgroundAlpha ?? 1),
    [backgroundAlpha, backgroundColor]
  );
  const className = `dot-grid__cell ${getCellShapeClassName(loader)}${variant === "canvas" ? " dot-grid__cell--canvas" : ""}`;
  const cells = useMemo(() => Array.from({ length: rows * cols }, (_, index) => index), [rows, cols]);

  return (
    <div className={`dot-grid-editor-shell${variant === "canvas" ? " dot-grid-editor-shell--canvas" : ""}`}>
      <div
        ref={gridRef}
        className={`dot-grid${variant === "canvas" ? " dot-grid--canvas" : ""}${dense ? " dot-grid--dense" : ""} dot-grid--tool-${tool}${symmetry === "none" ? "" : ` dot-grid--sym-${symmetry}`}`}
        style={{
          gridTemplateColumns: `repeat(${cols}, ${renderCellSize}px)`,
          gap: renderGap,
          padding: variant === "canvas" ? `${canvasMetrics.padding}px` : undefined,
          touchAction: "none"
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endStroke}
        onPointerCancel={endStroke}
        onLostPointerCapture={endStroke}
        onDragStart={(event) => event.preventDefault()}
      >
        {cells.map((cellIndex) => (
          <DotCell
            key={cellIndex}
            index={cellIndex}
            active={activeCells.has(cellIndex)}
            color={cellColors?.[cellIndex] ? rgbaWithOpacity(cellColors[cellIndex], 1, primaryAlpha ?? 1) : undefined}
            preview={Boolean(shapePreview?.has(cellIndex))}
            selected={Boolean(selection && cellIndex % cols >= selection.x0 && cellIndex % cols <= selection.x1 && Math.floor(cellIndex / cols) >= selection.y0 && Math.floor(cellIndex / cols) <= selection.y1)}
            className={className}
            style={cellStyle}
            inactiveBackground={inactiveBackground}
          />
        ))}
      </div>
    </div>
  );
}
