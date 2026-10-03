"use client";

import { useEffect, useMemo, useRef } from "react";
import { getCellClipPath, normalizeCellShape } from "@/lib/cell-shapes";
import { clampAlpha } from "@/lib/colors";
import { getCycleDuration, sampleBackground, sampleMotion } from "@/lib/core/motion-sampler";
import { CellShape, LoaderComponent } from "@/types/dot-motion";

type DenseCellCanvasProps = {
  loader: LoaderComponent;
  cellSize: number;
  gap: number;
  width: number;
  height: number;
  isAnimated: boolean;
  staticOnly: boolean;
  /** Fixed background phase (sequence playback drives it from outside). */
  backgroundProgress?: number;
};

/** Glow sizes were tuned for ~22 px cells; dense grids scale them down proportionally. */
const GLOW_REFERENCE_CELL = 22;
const GLOW_ALPHA = 0.65;
const ROUNDED_RADIUS = 0.22;

type CellTracer = (context: CanvasRenderingContext2D, x: number, y: number, size: number) => void;

function createTracer(shape: CellShape, innerRadius: number | undefined): CellTracer {
  const normalized = normalizeCellShape(shape);
  if (normalized === "square") return (c, x, y, s) => c.rect(x, y, s, s);
  if (normalized === "circle") return (c, x, y, s) => { c.moveTo(x + s, y + s / 2); c.arc(x + s / 2, y + s / 2, s / 2, 0, Math.PI * 2); };
  const points = getCellClipPath(normalized, innerRadius)?.match(/[\d.]+/g)?.map(n => Number(n) / 100);
  if (points && points.length >= 6) {
    return (c, x, y, s) => {
      c.moveTo(x + points[0] * s, y + points[1] * s);
      for (let i = 2; i < points.length; i += 2) c.lineTo(x + points[i] * s, y + points[i + 1] * s);
      c.closePath();
    };
  }
  return (c, x, y, s) => c.roundRect(x, y, s, s, s * ROUNDED_RADIUS);
}

/**
 * Canvas renderer for grids above 13x13. One draw call per cell per frame instead of two DOM nodes
 * re-rendered by React at 60 fps, so a 32x32 preview stays smooth. Visuals mirror PreviewStage.
 */
export function DenseCellCanvas({ loader, cellSize, gap, width, height, isAnimated, staticOnly, backgroundProgress }: DenseCellCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glowRef = useRef<HTMLCanvasElement | null>(null);
  const { rows, cols } = loader.pattern.grid;
  const active = useMemo(() => new Set(loader.pattern.activeCells), [loader.pattern.activeCells]);
  const tracer = useMemo(() => createTracer(loader.style.cellShape, loader.style.innerRadius), [loader.style.cellShape, loader.style.innerRadius]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const glowCanvas = glowRef.current ?? (glowRef.current = document.createElement("canvas"));
    glowCanvas.width = canvas.width;
    glowCanvas.height = canvas.height;
    const glowContext = glowCanvas.getContext("2d");

    const style = loader.style;
    const glowSize = style.shadow ? style.glow * Math.min(1, cellSize / GLOW_REFERENCE_CELL) : 0;
    const primaryAlpha = clampAlpha(style.primaryAlpha);
    const backgroundAlpha = clampAlpha(style.backgroundAlpha);
    const durationMs = getCycleDuration(loader);
    const pitch = cellSize + gap;

    const drawActive = (target: CanvasRenderingContext2D, progress: number) => {
      const cellColors = loader.pattern.cellColors;
      for (const index of active) {
        target.fillStyle = cellColors?.[index] ?? style.primaryColor;
        const motion = staticOnly || !isAnimated ? { opacity: 1, scale: 1 } : sampleMotion(loader, index, progress);
        if (motion.opacity <= 0 || motion.scale <= 0) continue;
        const size = cellSize * motion.scale;
        const x = (index % cols) * pitch + (cellSize - size) / 2;
        const y = Math.floor(index / cols) * pitch + (cellSize - size) / 2;
        target.globalAlpha = primaryAlpha * motion.opacity;
        target.beginPath();
        tracer(target, x, y, size);
        target.fill();
      }
      target.globalAlpha = 1;
    };

    const draw = (progress: number, backgroundPhase: number) => {
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);
      context.fillStyle = style.backgroundColor ?? "#2D3743";
      for (let index = 0; index < rows * cols; index++) {
        context.globalAlpha = backgroundAlpha * sampleBackground(loader, index, backgroundPhase);
        context.beginPath();
        tracer(context, (index % cols) * pitch, Math.floor(index / cols) * pitch, cellSize);
        context.fill();
      }
      context.globalAlpha = 1;
      if (glowSize > 0 && glowContext) {
        glowContext.setTransform(dpr, 0, 0, dpr, 0, 0);
        glowContext.clearRect(0, 0, width, height);
        drawActive(glowContext, progress);
        context.save();
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.filter = `blur(${(glowSize * dpr) / 2}px)`;
        context.globalAlpha = GLOW_ALPHA;
        context.drawImage(glowCanvas, 0, 0);
        context.restore();
      }
      drawActive(context, progress);
    };

    if (!isAnimated || staticOnly) {
      const phase = backgroundProgress ?? 0;
      draw(0, phase);
      return;
    }
    let frame = 0;
    const startedAt = performance.now();
    const tick = (now: number) => {
      const progress = ((now - startedAt) % durationMs) / durationMs;
      draw(progress, backgroundProgress ?? progress);
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [active, backgroundProgress, cellSize, cols, gap, height, isAnimated, loader, rows, staticOnly, tracer, width]);

  return <canvas ref={canvasRef} className="dense-cell-canvas" style={{ width, height, display: "block" }} aria-hidden="true" />;
}
