import { hexToRgb, RgbColor } from "@/lib/colors";
import { getCycleDuration, sampleBackground, sampleMotion } from "@/lib/core/motion-sampler";
import { MATRIX_SIZE, MAX_GIF_FPS, MAX_GIF_FRAMES } from "@/lib/idotmatrix/constants";
import { getShapeMask, ShapeMask } from "@/lib/idotmatrix/shape-mask";
import { LoaderComponent, Project } from "@/types/dot-motion";

export type MatrixLayout = { cell: number; gap: number; offsetX: number; offsetY: number };
export type MatrixRenderOptions = { showInactive: boolean; maxFrames?: number };
export type MatrixFrames = { frames: Uint8Array[]; delaysCs: number[]; fps: number };

type FramePlan = { loader: LoaderComponent; progress: number; discrete: boolean; delayCs: number };
type FrameStyle = { primary: RgbColor; inactive: RgbColor; layout: MatrixLayout; mask: ShapeMask };

const PIXELS = MATRIX_SIZE * MATRIX_SIZE;
/** LEDs are linear while the editor blends in sRGB; gamma on coverage keeps fades looking like the preview. */
const FADE_GAMMA = 2.2;
/** Coarse brightness steps keep every colour in one shared GIF palette. */
const ACTIVE_LEVELS = 24;
const INACTIVE_LEVELS = 6;
const SUPERSAMPLE = 4;

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const gapFor = (cell: number) => Math.max(1, Math.floor(cell / 5));

/**
 * Dim inactive dots are linearised so they stay background-dim on LEDs (raw #2D3743 would glow as mid grey).
 * Active colours stay raw: vivid UI colours read best on the panel unconverted (DeskDot hardware notes).
 */
function linearize({ r, g, b }: RgbColor): RgbColor {
  const toLinear = (c: number) => Math.round(255 * (c / 255) ** FADE_GAMMA);
  return { r: toLinear(r), g: toLinear(g), b: toLinear(b) };
}

/** Largest square dot that fits the grid on the panel, always with a dark gap, centred. */
export function getMatrixLayout(rows: number, cols: number, size = MATRIX_SIZE): MatrixLayout {
  const span = Math.max(rows, cols);
  const extentOf = (n: number, cell: number, gap: number) => n * cell + (n - 1) * gap;
  let cell = Math.max(1, Math.floor((size + 1) / span));
  while (cell > 1 && extentOf(span, cell, gapFor(cell)) > size) cell--;
  const gap = extentOf(span, cell, gapFor(cell)) <= size ? gapFor(cell) : 0;
  return {
    cell,
    gap,
    offsetX: Math.floor((size - extentOf(cols, cell, gap)) / 2),
    offsetY: Math.floor((size - extentOf(rows, cell, gap)) / 2)
  };
}

function planFrames(project: Project, loader: LoaderComponent, maxFrames: number): FramePlan[] {
  const fps = clamp(Math.round(loader.animation.fps), 1, MAX_GIF_FPS);
  if (loader.sequenceId) {
    const sequence = project.loaders
      .filter(item => item.sequenceId === loader.sequenceId)
      .sort((a, b) => (a.sequenceIndex ?? 0) - (b.sequenceIndex ?? 0));
    const frames = (sequence.length ? sequence : [loader]).slice(0, maxFrames);
    return frames.map((item, i) => ({ loader: item, progress: i / frames.length, discrete: true, delayCs: Math.round(100 / fps) }));
  }
  const durationMs = getCycleDuration(loader);
  const count = clamp(Math.round((durationMs / 1000) * fps), 2, maxFrames);
  const totalCs = Math.round(durationMs / 10);
  return Array.from({ length: count }, (_, i) => ({
    loader,
    progress: i / count,
    discrete: false,
    delayCs: Math.round(((i + 1) * totalCs) / count) - Math.round((i * totalCs) / count)
  }));
}

/** Rasterises one (optionally scaled) dot into a coverage buffer, keeping the brighter value on overlap. */
function paintDot(target: Float32Array, style: FrameStyle, x0: number, y0: number, scale: number, alpha: number) {
  if (alpha <= 0 || scale <= 0) return;
  const { cell } = style.layout;
  const reach = Math.ceil((cell * (Math.max(scale, 1) - 1)) / 2);
  const samples = SUPERSAMPLE * SUPERSAMPLE;
  for (let py = Math.max(0, y0 - reach); py < Math.min(MATRIX_SIZE, y0 + cell + reach); py++) {
    for (let px = Math.max(0, x0 - reach); px < Math.min(MATRIX_SIZE, x0 + cell + reach); px++) {
      let hits = 0;
      for (let s = 0; s < samples; s++) {
        const u = 0.5 + ((px - x0 + ((s % SUPERSAMPLE) + 0.5) / SUPERSAMPLE) / cell - 0.5) / scale;
        const v = 0.5 + ((py - y0 + (Math.floor(s / SUPERSAMPLE) + 0.5) / SUPERSAMPLE) / cell - 0.5) / scale;
        if (u >= 0 && u <= 1 && v >= 0 && v <= 1 && style.mask(u, v)) hits++;
      }
      const index = py * MATRIX_SIZE + px;
      target[index] = Math.max(target[index], (alpha * hits) / samples);
    }
  }
}

const toLevel = (value: number, levels: number) => Math.round(clamp(value, 0, 1) ** FADE_GAMMA * levels) / levels;

function compose(active: Float32Array, inactive: Float32Array, style: FrameStyle) {
  const rgb = new Uint8Array(PIXELS * 3);
  for (let i = 0; i < PIXELS; i++) {
    const a = toLevel(active[i], ACTIVE_LEVELS);
    const b = toLevel(inactive[i], INACTIVE_LEVELS) * (1 - a);
    rgb[i * 3] = Math.round(style.primary.r * a + style.inactive.r * b);
    rgb[i * 3 + 1] = Math.round(style.primary.g * a + style.inactive.g * b);
    rgb[i * 3 + 2] = Math.round(style.primary.b * a + style.inactive.b * b);
  }
  return rgb;
}

function renderFrame(plan: FramePlan, showInactive: boolean) {
  const { loader, progress, discrete } = plan;
  const { rows, cols } = loader.pattern.grid;
  const layout = getMatrixLayout(rows, cols);
  const style: FrameStyle = {
    primary: hexToRgb(loader.style.primaryColor),
    inactive: linearize(hexToRgb(loader.style.backgroundColor ?? "#2D3743")),
    layout,
    mask: getShapeMask(loader.style.cellShape, loader.style.innerRadius, layout.cell)
  };
  const active = new Float32Array(PIXELS);
  const inactive = new Float32Array(PIXELS);
  const activeCells = new Set(loader.pattern.activeCells);
  for (let cellIndex = 0; cellIndex < rows * cols; cellIndex++) {
    const x0 = layout.offsetX + (cellIndex % cols) * (layout.cell + layout.gap);
    const y0 = layout.offsetY + Math.floor(cellIndex / cols) * (layout.cell + layout.gap);
    if (showInactive) {
      paintDot(inactive, style, x0, y0, 1, (loader.style.backgroundAlpha ?? 1) * sampleBackground(loader, cellIndex, progress));
    }
    if (activeCells.has(cellIndex)) {
      const motion = discrete ? { opacity: 1, scale: 1 } : sampleMotion(loader, cellIndex, progress);
      paintDot(active, style, x0, y0, motion.scale, (loader.style.primaryAlpha ?? 1) * motion.opacity);
    }
  }
  return compose(active, inactive, style);
}

/** The drawn pattern as it looks while editing: active cells fully lit, inactive dots at rest. */
export function renderMatrixStill(loader: LoaderComponent, options: { showInactive: boolean }): Uint8Array {
  return renderFrame({ loader, progress: 0, discrete: true, delayCs: 0 }, options.showInactive);
}

/** Samples the shared motion field into 32x32 RGB frames with per-frame GIF delays. */
export function renderMatrixFrames(project: Project, loader: LoaderComponent, options: MatrixRenderOptions): MatrixFrames {
  const plans = planFrames(project, loader, options.maxFrames ?? MAX_GIF_FRAMES);
  const totalCs = plans.reduce((sum, plan) => sum + plan.delayCs, 0);
  return {
    frames: plans.map(plan => renderFrame(plan, options.showInactive)),
    delaysCs: plans.map(plan => plan.delayCs),
    fps: Math.round((plans.length * 100 * 10) / Math.max(1, totalCs)) / 10
  };
}
