import { rgbToHex } from "@/lib/colors";
import { MAX_GIF_FPS } from "@/lib/idotmatrix/constants";
import { medianCutPalette, nearestIndex } from "@/lib/idotmatrix/color-quantizer";

/** Mostly transparent pixels stay off. */
const MIN_ALPHA = 128;
export const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
/** Decoded size cap (~60 MP): a tiny but huge-dimensioned PNG must not exhaust memory. */
const MAX_IMPORT_PIXELS = 60_000_000;
/** An animated image becomes at most this many sequence frames (evenly sampled), keeping the canvas usable. */
export const MAX_IMPORT_FRAMES = 24;

/** contain: the whole picture, letterboxed; cover: fills the grid, cropping the overflow. */
export type ImportFit = "contain" | "cover";
export type ImportOptions = {
  fit: ImportFit;
  /** Pixels darker than this (0..100 % luminance) stay off: on an LED panel black is an unlit LED. */
  blackCut: number;
  /** Reduce to this many colours (0 = keep every colour). */
  colors: number;
  /** Floyd–Steinberg dithering when reducing colours, so gradients keep their shape. */
  dither: boolean;
};
export const IMPORT_COLOR_CHOICES = [0, 32, 16, 8, 4, 2] as const;
export const DEFAULT_IMPORT_OPTIONS: ImportOptions = { fit: "contain", blackCut: 5, colors: 0, dither: false };

export type ImportedCells = { cells: number[]; colors: Record<string, string> };
/** Grid-sized RGBA rasters of every (sampled) frame; one frame for a still picture. */
export type ImportedRaster = { frames: Uint8ClampedArray[]; fps: number };

const luminanceOf = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const clampByte = (value: number) => Math.max(0, Math.min(255, value));

/** Spreads a pixel's quantisation error onto its unvisited neighbours (Floyd–Steinberg weights). */
function diffuse(rgb: Float32Array, rows: number, cols: number, index: number, error: [number, number, number]) {
  const r = Math.floor(index / cols), c = index % cols;
  const spread: Array<[number, number, number]> = [[0, 1, 7 / 16], [1, -1, 3 / 16], [1, 0, 5 / 16], [1, 1, 1 / 16]];
  for (const [dr, dc, weight] of spread) {
    const nr = r + dr, nc = c + dc;
    if (nr >= rows || nc < 0 || nc >= cols) continue;
    const target = (nr * cols + nc) * 3;
    for (let k = 0; k < 3; k++) rgb[target + k] += error[k] * weight;
  }
}

/** Converts a rows x cols RGBA readback into lit cells and their colours. */
export function pixelsToCells(rgba: Uint8ClampedArray, rows: number, cols: number, options: Partial<ImportOptions> = {}): ImportedCells {
  const { blackCut, colors: maxColors, dither } = { ...DEFAULT_IMPORT_OPTIONS, ...options };
  const cutLuminance = (Math.max(0, Math.min(100, blackCut)) / 100) * 255;
  const count = rows * cols;
  const visible = (i: number) => rgba[i * 4 + 3] >= MIN_ALPHA;
  const rgb = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) for (let k = 0; k < 3; k++) rgb[i * 3 + k] = rgba[i * 4 + k];

  let palette: number[] | null = null;
  if (maxColors > 0) {
    const counts = new Map<number, number>();
    for (let i = 0; i < count; i++) {
      const [r, g, b] = [rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]];
      if (!visible(i) || luminanceOf(r, g, b) < cutLuminance) continue;
      const key = (r << 16) | (g << 8) | b;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    if (counts.size > 0) palette = medianCutPalette(counts, maxColors);
  }

  const cells: number[] = [];
  const colors: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    if (!visible(i)) continue;
    const [r, g, b] = [clampByte(rgb[i * 3]), clampByte(rgb[i * 3 + 1]), clampByte(rgb[i * 3 + 2])];
    if (luminanceOf(r, g, b) < cutLuminance) continue;
    let out: [number, number, number] = [Math.round(r), Math.round(g), Math.round(b)];
    if (palette) {
      const p = nearestIndex(palette, r, g, b) * 3;
      out = [palette[p], palette[p + 1], palette[p + 2]];
      if (dither) diffuse(rgb, rows, cols, i, [r - out[0], g - out[1], b - out[2]]);
    }
    cells.push(i);
    colors[i] = rgbToHex({ r: out[0], g: out[1], b: out[2] });
  }
  return { cells, colors };
}

/** Evenly picks at most max of count frame indices. */
export function sampleFrameIndices(count: number, max: number): number[] {
  if (count <= max) return Array.from({ length: count }, (_, i) => i);
  return Array.from({ length: max }, (_, k) => Math.floor((k * count) / max));
}

/** Playback rate that keeps a sampled animation's total duration (clamped to what the panel plays). */
export function sequenceFps(totalMs: number, frameCount: number): number {
  if (totalMs <= 0 || frameCount <= 0) return 10;
  return Math.max(1, Math.min(MAX_GIF_FPS, Math.round((frameCount * 1000) / totalMs)));
}

/**
 * Downscales by halving until close to the target, so every cell averages its whole area
 * (one big drawImage step only samples a few source pixels per cell).
 */
function halveTowards(source: CanvasImageSource, width: number, height: number, targetWidth: number, targetHeight: number) {
  let current: CanvasImageSource = source;
  let w = width, h = height;
  while (w / 2 >= targetWidth * 2 && h / 2 >= targetHeight * 2) {
    const next = document.createElement("canvas");
    next.width = Math.max(1, Math.round(w / 2));
    next.height = Math.max(1, Math.round(h / 2));
    const context = next.getContext("2d");
    if (!context) break;
    context.imageSmoothingQuality = "high";
    context.drawImage(current, 0, 0, next.width, next.height);
    current = next;
    w = next.width;
    h = next.height;
  }
  return { image: current, width: w, height: h };
}

/** Scales one picture to the grid (letterboxed or cropped); each cell takes the averaged colour of its area. */
function rasterize(source: CanvasImageSource, width: number, height: number, rows: number, cols: number, fit: ImportFit): Uint8ClampedArray {
  if (width * height > MAX_IMPORT_PIXELS) throw new Error("image dimensions are too large");
  const canvas = document.createElement("canvas");
  canvas.width = cols;
  canvas.height = rows;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("2D canvas unavailable");
  const scale = fit === "cover" ? Math.max(cols / width, rows / height) : Math.min(cols / width, rows / height);
  const drawWidth = width * scale, drawHeight = height * scale;
  const reduced = halveTowards(source, width, height, drawWidth, drawHeight);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(reduced.image, (cols - drawWidth) / 2, (rows - drawHeight) / 2, drawWidth, drawHeight);
  return context.getImageData(0, 0, cols, rows).data;
}

type DecodedFrame = { image: CanvasImageSource & { displayWidth: number; displayHeight: number; duration: number | null; close(): void } };
type ImageDecoderLike = {
  completed: Promise<void>;
  tracks: { ready: Promise<void>; selectedTrack: { frameCount: number } | null };
  decode(options: { frameIndex: number }): Promise<DecodedFrame>;
  close(): void;
};
type ImageDecoderCtor = {
  new (init: { data: ArrayBuffer; type: string }): ImageDecoderLike;
  isTypeSupported(type: string): Promise<boolean>;
};

/** Every frame of an animated image (GIF, WebP, APNG) via WebCodecs, or null when unsupported or still. */
async function rasterizeAnimation(file: File, rows: number, cols: number, fit: ImportFit): Promise<ImportedRaster | null> {
  const Decoder = (globalThis as unknown as { ImageDecoder?: ImageDecoderCtor }).ImageDecoder;
  if (!Decoder || !(await Decoder.isTypeSupported(file.type))) return null;
  const decoder = new Decoder({ data: await file.arrayBuffer(), type: file.type });
  try {
    // frameCount can still grow until the whole file is parsed.
    await decoder.tracks.ready;
    await decoder.completed;
    const frameCount = decoder.tracks.selectedTrack?.frameCount ?? 1;
    if (frameCount < 2) return null;
    const frames: Uint8ClampedArray[] = [];
    let totalMs = 0;
    const picked = new Set(sampleFrameIndices(frameCount, MAX_IMPORT_FRAMES));
    for (let index = 0; index < frameCount; index++) {
      const { image } = await decoder.decode({ frameIndex: index });
      try {
        totalMs += (image.duration ?? 100_000) / 1000; // microseconds
        if (picked.has(index)) frames.push(rasterize(image, image.displayWidth, image.displayHeight, rows, cols, fit));
      } finally {
        image.close();
      }
    }
    return { frames, fps: sequenceFps(totalMs, frames.length) };
  } finally {
    decoder.close();
  }
}

/**
 * Reads an image file into grid-sized rasters: every sampled frame of an animated image, or the single
 * picture. Browser-only (canvas, WebCodecs).
 */
export async function rasterizeImageFile(file: File, rows: number, cols: number, fit: ImportFit): Promise<ImportedRaster> {
  if (!file.type.startsWith("image/")) throw new Error("not an image file");
  if (file.size > MAX_IMPORT_BYTES) throw new Error("image is larger than 20 MB");
  const animated = await rasterizeAnimation(file, rows, cols, fit).catch((error) => {
    console.warn("[editor] animated decode failed, importing the first frame", error);
    return null;
  });
  if (animated) return animated;
  const bitmap = await createImageBitmap(file);
  try {
    return { frames: [rasterize(bitmap, bitmap.width, bitmap.height, rows, cols, fit)], fps: 10 };
  } finally {
    bitmap.close();
  }
}
