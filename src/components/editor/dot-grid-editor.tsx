"use client";

import { memo, useCallback, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { getCellShapeClassName, getCellShapeStyle } from "@/lib/cell-shapes";
import { getCanvasGridMetrics } from "@/lib/canvas-grid-metrics";
import { rgbaWithOpacity } from "@/lib/colors";
import { LEGACY_MAX_GRID_SIZE } from "@/lib/grid-limits";
import { cellAtPoint, cellsInRect, cellsOnLine, DrawTool, floodFill } from "@/lib/grid-tools";
import { LoaderComponent } from "@/types/dot-motion";

type DotGridEditorProps = {
  loader: LoaderComponent;
  tool?: DrawTool;
  /** Colour the brush, rectangle and fill paint with; defaults to the loader's active colour. */
  brushColor?: string;
  /** Sets many cells at once (one call per stroke step, rectangle or fill), lit cells in the given colour. */
  onApplyCells: (cells: number[], active: boolean, color?: string) => void;
  /** Alt+click picks a cell's colour (eyedropper). */
  onPickColor?: (hex: string) => void;
  variant?: "default" | "canvas";
};

/** The cell size the original glow values were tuned for; dense grids scale their glow down from it. */
const GLOW_REFERENCE_CELL = 22;

type Stroke = { pointerId: number; value: boolean; start: number; last: number };

type DotCellProps = {
  index: number;
  active: boolean;
  /** Per-cell colour override, if any. */
  color?: string;
  preview: boolean;
  className: string;
  style: CSSProperties;
  inactiveBackground: string;
};

/** Memoised so a stroke re-renders only the cells it changes, not all 1024 of a 32x32 grid. */
const DotCell = memo(function DotCell({ index, active, color, preview, className, style, inactiveBackground }: DotCellProps) {
  const activeStyle = color ? { ...style, ["--cell-color" as string]: color, ["--cell-glow-color" as string]: color } : style;
  return (
    <button
      type="button"
      data-dot-cell="true"
      className={`${className}${active ? " is-active" : ""}${preview ? " is-preview" : ""}`}
      onClick={(event) => event.preventDefault()}
      style={active ? activeStyle : { ...style, background: inactiveBackground }}
      aria-label={`Toggle cell ${index + 1}`}
      aria-pressed={active}
    />
  );
});

export function DotGridEditor({ loader, tool = "brush", brushColor, onApplyCells, onPickColor, variant = "default" }: DotGridEditorProps) {
  const { rows, cols, cellSize, gap } = loader.pattern.grid;
  const canvasMetrics = useMemo(() => getCanvasGridMetrics(loader), [loader]);
  const activeCells = useMemo(() => new Set(loader.pattern.activeCells), [loader.pattern.activeCells]);
  const dense = Math.max(rows, cols) > LEGACY_MAX_GRID_SIZE;
  const renderGap = variant === "canvas" ? canvasMetrics.gap : gap;
  const renderCellSize = variant === "canvas" ? canvasMetrics.cellSize : cellSize;
  const gridRef = useRef<HTMLDivElement>(null);
  const strokeRef = useRef<Stroke | null>(null);
  const [rectPreview, setRectPreview] = useState<Set<number> | null>(null);

  // Pointer handlers read the latest props from this ref so they never act on a stale grid.
  const cellColors = loader.pattern.cellColors;
  const paintColor = (brushColor ?? loader.style.primaryColor).toUpperCase();
  const colorOf = (cell: number) => (cellColors?.[cell] ?? loader.style.primaryColor).toUpperCase();
  const latest = useRef({ activeCells, onApplyCells, onPickColor, tool, rows, cols, renderCellSize, renderGap, paintColor, colorOf });
  latest.current = { activeCells, onApplyCells, onPickColor, tool, rows, cols, renderCellSize, renderGap, paintColor, colorOf };

  const cellFromPointer = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const grid = gridRef.current as HTMLDivElement;
    const box = grid.getBoundingClientRect();
    const current = latest.current;
    return cellAtPoint(event.clientX, event.clientY, {
      left: box.left,
      top: box.top,
      scale: box.width / (grid.offsetWidth || box.width || 1), // canvas zoom
      padding: Number.parseFloat(getComputedStyle(grid).paddingLeft) || 0,
      cellSize: current.renderCellSize,
      gap: current.renderGap,
      rows: current.rows,
      cols: current.cols
    });
  }, []);

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    try {
      // Keeps the stroke when the pointer leaves the grid; harmless to skip if the pointer is already gone.
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // no active pointer to capture (e.g. synthetic events)
    }
    const cell = cellFromPointer(event);
    const { activeCells: active, onApplyCells: apply, onPickColor: pick, tool: currentTool, rows: r, cols: c, paintColor: paint, colorOf: color } = latest.current;
    if (event.altKey) {
      if (active.has(cell)) pick?.(color(cell)); // eyedropper
      return;
    }
    // Starting on a cell that already has the brush colour erases instead (toggle), as before colours.
    const alreadyPainted = active.has(cell) && color(cell) === paint;
    const value = currentTool === "erase" ? false : currentTool === "rect" ? true : !alreadyPainted;
    if (currentTool === "fill") {
      const keyOf = (cellIndex: number) => (active.has(cellIndex) ? color(cellIndex) : "off");
      apply(floodFill(cell, active, r, c, keyOf), value, paint);
      return;
    }
    strokeRef.current = { pointerId: event.pointerId, value, start: cell, last: cell };
    if (currentTool === "rect") setRectPreview(new Set([cell]));
    else apply([cell], value, paint);
  }, [cellFromPointer]);

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const stroke = strokeRef.current;
    if (!stroke || stroke.pointerId !== event.pointerId) return;
    const cell = cellFromPointer(event);
    if (cell === stroke.last) return;
    const { onApplyCells: apply, tool: currentTool, cols: c, paintColor: paint } = latest.current;
    if (currentTool === "rect") setRectPreview(new Set(cellsInRect(stroke.start, cell, c)));
    else apply(cellsOnLine(stroke.last, cell, c), stroke.value, paint);
    strokeRef.current = { ...stroke, last: cell };
  }, [cellFromPointer]);

  const endStroke = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const stroke = strokeRef.current;
    if (!stroke || stroke.pointerId !== event.pointerId) return;
    strokeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const { onApplyCells: apply, tool: currentTool, cols: c, paintColor: paint } = latest.current;
    if (currentTool === "rect" && event.type === "pointerup") apply(cellsInRect(stroke.start, stroke.last, c), stroke.value, paint);
    setRectPreview(null);
  }, []);

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
        className={`dot-grid${variant === "canvas" ? " dot-grid--canvas" : ""}${dense ? " dot-grid--dense" : ""} dot-grid--tool-${tool}`}
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
      >
        {cells.map((cellIndex) => (
          <DotCell
            key={cellIndex}
            index={cellIndex}
            active={activeCells.has(cellIndex)}
            color={cellColors?.[cellIndex] ? rgbaWithOpacity(cellColors[cellIndex], 1, primaryAlpha ?? 1) : undefined}
            preview={Boolean(rectPreview?.has(cellIndex))}
            className={className}
            style={cellStyle}
            inactiveBackground={inactiveBackground}
          />
        ))}
      </div>
    </div>
  );
}
