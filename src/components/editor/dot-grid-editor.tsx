"use client";

import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import type { CSSProperties } from "react";
import { getCellShapeClassName, getCellShapeStyle } from "@/lib/cell-shapes";
import { getCanvasGridMetrics } from "@/lib/canvas-grid-metrics";
import { rgbaWithOpacity } from "@/lib/colors";
import { LEGACY_MAX_GRID_SIZE } from "@/lib/grid-limits";
import { LoaderComponent } from "@/types/dot-motion";

type DotGridEditorProps = {
  loader: LoaderComponent;
  onToggleCell: (cellIndex: number) => void;
  onSetCellActive?: (cellIndex: number, active: boolean) => void;
  variant?: "default" | "canvas";
};

/** The cell size the original glow values were tuned for; dense grids scale their glow down from it. */
const GLOW_REFERENCE_CELL = 22;

type DotCellProps = {
  index: number;
  active: boolean;
  className: string;
  style: CSSProperties;
  inactiveBackground: string;
  onDown: (index: number) => void;
  onEnter: (index: number) => void;
};

/** Memoised so toggling one cell re-renders one button, not all 1024 of a 32x32 grid. */
const DotCell = memo(function DotCell({ index, active, className, style, inactiveBackground, onDown, onEnter }: DotCellProps) {
  return (
    <button
      type="button"
      data-dot-cell="true"
      className={`${className}${active ? " is-active" : ""}`}
      onClick={(event) => event.preventDefault()}
      onPointerDown={() => onDown(index)}
      onPointerEnter={() => onEnter(index)}
      style={active ? style : { ...style, background: inactiveBackground }}
      aria-label={`Toggle cell ${index + 1}`}
    />
  );
});

export function DotGridEditor({
  loader,
  onToggleCell,
  onSetCellActive,
  variant = "default"
}: DotGridEditorProps) {
  const { rows, cols, cellSize, gap } = loader.pattern.grid;
  const canvasMetrics = useMemo(() => getCanvasGridMetrics(loader), [loader]);
  const activeCells = useMemo(() => new Set(loader.pattern.activeCells), [loader.pattern.activeCells]);
  const dense = Math.max(rows, cols) > LEGACY_MAX_GRID_SIZE;
  const renderGap = variant === "canvas" ? canvasMetrics.gap : gap;
  const renderCellSize = variant === "canvas" ? canvasMetrics.cellSize : cellSize;
  const dragStateRef = useRef<{ nextValue: boolean; visited: Set<number> } | null>(null);

  // Handlers stay stable for the memoised cells and read the latest props from this ref.
  const latest = useRef({ activeCells, onToggleCell, onSetCellActive });
  latest.current = { activeCells, onToggleCell, onSetCellActive };

  useEffect(() => {
    function endDrag() {
      dragStateRef.current = null;
    }

    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
    return () => {
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
    };
  }, []);

  const applyCell = useCallback((cellIndex: number, active: boolean) => {
    const current = latest.current;
    if (current.onSetCellActive) {
      current.onSetCellActive(cellIndex, active);
      return;
    }
    if (current.activeCells.has(cellIndex) !== active) current.onToggleCell(cellIndex);
  }, []);

  const handlePointerDown = useCallback((cellIndex: number) => {
    const nextValue = !latest.current.activeCells.has(cellIndex);
    dragStateRef.current = { nextValue, visited: new Set([cellIndex]) };
    applyCell(cellIndex, nextValue);
  }, [applyCell]);

  const handlePointerEnter = useCallback((cellIndex: number) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.visited.has(cellIndex)) return;
    dragState.visited.add(cellIndex);
    applyCell(cellIndex, dragState.nextValue);
  }, [applyCell]);

  const { primaryColor, primaryAlpha, backgroundColor, backgroundAlpha, shadow, glow, cellShape, innerRadius } = loader.style;
  const cellStyle = useMemo<CSSProperties>(() => {
    const color = rgbaWithOpacity(primaryColor, 1, primaryAlpha ?? 1);
    const glowSize = shadow ? (dense ? glow * Math.min(1, renderCellSize / GLOW_REFERENCE_CELL) : glow) : 0;
    return {
      width: renderCellSize,
      height: renderCellSize,
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
        className={`dot-grid${variant === "canvas" ? " dot-grid--canvas" : ""}${dense ? " dot-grid--dense" : ""}`}
        style={{
          gridTemplateColumns: `repeat(${cols}, ${renderCellSize}px)`,
          gap: renderGap,
          padding: variant === "canvas" ? `${canvasMetrics.padding}px` : undefined
        }}
      >
        {cells.map((cellIndex) => (
          <DotCell
            key={cellIndex}
            index={cellIndex}
            active={activeCells.has(cellIndex)}
            className={className}
            style={cellStyle}
            inactiveBackground={inactiveBackground}
            onDown={handlePointerDown}
            onEnter={handlePointerEnter}
          />
        ))}
      </div>
    </div>
  );
}
