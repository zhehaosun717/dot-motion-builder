import { rgbToHex } from "@/lib/colors";

/** Pixels darker than this (0..255 luminance) stay off: on an LED panel black is simply an unlit LED. */
const BLACK_LUMINANCE = 12;
/** Mostly transparent pixels stay off. */
const MIN_ALPHA = 128;
export const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
/** Decoded size cap (~60 MP): a tiny but huge-dimensioned PNG must not exhaust memory. */
const MAX_IMPORT_PIXELS = 60_000_000;

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

export type ImportedCells = { cells: number[]; colors: Record<string, string> };

/** Converts a rows x cols RGBA readback into lit cells and their colours. */
export function pixelsToCells(rgba: Uint8ClampedArray, rows: number, cols: number): ImportedCells {
  const cells: number[] = [];
  const colors: Record<string, string> = {};
  for (let i = 0; i < rows * cols; i++) {
    const [r, g, b, a] = [rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2], rgba[i * 4 + 3]];
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (a < MIN_ALPHA || luminance < BLACK_LUMINANCE) continue;
    cells.push(i);
    colors[i] = rgbToHex({ r, g, b });
  }
  return { cells, colors };
}

/**
 * Reads an image file and scales it to the grid, letterboxed so nothing is cropped; each grid cell
 * takes the averaged colour of its area. Browser-only (canvas).
 */
export async function importImageFile(file: File, rows: number, cols: number): Promise<ImportedCells> {
  if (!file.type.startsWith("image/")) throw new Error("not an image file");
  if (file.size > MAX_IMPORT_BYTES) throw new Error("image is larger than 20 MB");
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width * bitmap.height > MAX_IMPORT_PIXELS) throw new Error("image dimensions are too large");
    const canvas = document.createElement("canvas");
    canvas.width = cols;
    canvas.height = rows;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("2D canvas unavailable");
    const scale = Math.min(cols / bitmap.width, rows / bitmap.height);
    const width = bitmap.width * scale, height = bitmap.height * scale;
    const reduced = halveTowards(bitmap, bitmap.width, bitmap.height, width, height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(reduced.image, (cols - width) / 2, (rows - height) / 2, width, height);
    return pixelsToCells(context.getImageData(0, 0, cols, rows).data, rows, cols);
  } finally {
    bitmap.close();
  }
}
