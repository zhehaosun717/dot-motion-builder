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
  /** Sets many cells at once: one call per stroke step, rectangle or fill. */
  onApplyCells: (cells: number[], active: boolean) => void;
  variant?: "default" | "canvas";
};

/** The cell size the original glow values were tuned for; dense grids scale their glow down from it. */
const GLOW_REFERENCE_CELL = 22;

type Stroke = { pointerId: number; value: boolean; start: number; last: number };

type DotCellProps = {
  index: number;
  active: boolean;
  preview: boolean;
  className: string;
  style: CSSProperties;
  inactiveBackground: string;
};

/** Memoised so a stroke re-renders only the cells it changes, not all 1024 of a 32x32 grid. */
const DotCell = memo(function DotCell({ index, active, preview, className, style, inactiveBackground }: DotCellProps) {
  return (
    <button
      type="button"
      data-dot-cell="true"
      className={`${className}${active ? " is-active" : ""}${preview ? " is-preview" : ""}`}
      onClick={(event) => event.preventDefault()}
      style={active ? style : { ...style, background: inactiveBackground }}
      aria-label={`Toggle cell ${index + 1}`}
      aria-pressed={active}
    />
  );
});

export function DotGridEditor({ loader, tool = "brush", onApplyCells, variant = "default" }: DotGridEditorProps) {
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
  const latest = useRef({ activeCells, onApplyCells, tool, rows, cols, renderCellSize, renderGap });
  latest.current = { activeCells, onApplyCells, tool, rows, cols, renderCellSize, renderGap };

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
    event.currentTarget.setPointerCapture(event.pointerId);
    const cell = cellFromPointer(event);
    const { activeCells: active, onApplyCells: apply, tool: currentTool, rows: r, cols: c } = latest.current;
    const value = currentTool === "erase" ? false : !active.has(cell);
    if (currentTool === "fill") {
      apply(floodFill(cell, active, r, c), value);
      return;
    }
    strokeRef.current = { pointerId: event.pointerId, value, start: cell, last: cell };
    if (currentTool === "rect") setRectPreview(new Set([cell]));
    else apply([cell], value);
  }, [cellFromPointer]);

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const stroke = strokeRef.current;
    if (!stroke || stroke.pointerId !== event.pointerId) return;
    const cell = cellFromPointer(event);
    if (cell === stroke.last) return;
    const { onApplyCells: apply, tool: currentTool, cols: c } = latest.current;
    if (currentTool === "rect") setRectPreview(new Set(cellsInRect(stroke.start, cell, c)));
    else apply(cellsOnLine(stroke.last, cell, c), stroke.value);
    strokeRef.current = { ...stroke, last: cell };
  }, [cellFromPointer]);

  const endStroke = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const stroke = strokeRef.current;
    if (!stroke || stroke.pointerId !== event.pointerId) return;
    strokeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const { onApplyCells: apply, tool: currentTool, cols: c } = latest.current;
    if (currentTool === "rect" && event.type === "pointerup") apply(cellsInRect(stroke.start, stroke.last, c), stroke.value);
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
