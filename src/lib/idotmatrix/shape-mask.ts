import { getCellClipPath, normalizeCellShape } from "@/lib/cell-shapes";
import { CellShape } from "@/types/dot-motion";

/** Inside test in cell-local unit space: (0,0) top-left, (1,1) bottom-right. */
export type ShapeMask = (u: number, v: number) => boolean;

/** Shapes need room to read; below this, blocks are solid squares (rounded corners on 3-5px blocks look like seams). */
const MIN_SHAPED_CELL_PX = 6;
const ROUNDED_RADIUS = 0.22;

const fullSquare: ShapeMask = () => true;

function roundedRect(u: number, v: number) {
  const dx = Math.max(ROUNDED_RADIUS - u, u - (1 - ROUNDED_RADIUS), 0);
  const dy = Math.max(ROUNDED_RADIUS - v, v - (1 - ROUNDED_RADIUS), 0);
  return dx * dx + dy * dy <= ROUNDED_RADIUS * ROUNDED_RADIUS;
}

function circle(u: number, v: number) {
  return (u - 0.5) ** 2 + (v - 0.5) ** 2 <= 0.25;
}

function polygonMask(points: number[]): ShapeMask {
  const xs = points.filter((_, i) => i % 2 === 0).map(n => n / 100);
  const ys = points.filter((_, i) => i % 2 === 1).map(n => n / 100);
  return (u, v) => {
    let inside = false;
    for (let i = 0, j = xs.length - 1; i < xs.length; j = i++) {
      if ((ys[i] > v) !== (ys[j] > v) && u < ((xs[j] - xs[i]) * (v - ys[i])) / (ys[j] - ys[i]) + xs[i]) inside = !inside;
    }
    return inside;
  };
}

export function getShapeMask(shape: CellShape, innerRadius: number | undefined, cellPx: number): ShapeMask {
  if (cellPx < MIN_SHAPED_CELL_PX) return fullSquare;
  const normalized = normalizeCellShape(shape);
  if (normalized === "square") return fullSquare;
  if (normalized === "circle") return circle;
  const clipPath = getCellClipPath(normalized, innerRadius);
  const points = clipPath?.match(/[\d.]+/g)?.map(Number);
  return points && points.length >= 6 ? polygonMask(points) : roundedRect;
}
