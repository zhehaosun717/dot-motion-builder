import { MATRIX_SIZE } from "@/lib/idotmatrix/constants";

export type Rgb = readonly [number, number, number];

export const BLACK: Rgb = [0, 0, 0];

/** Scales a colour's brightness (0..1), e.g. for pulses and fades. */
export function dimmed(color: Rgb, factor: number): Rgb {
  const f = Math.max(0, Math.min(1, factor));
  return [Math.round(color[0] * f), Math.round(color[1] * f), Math.round(color[2] * f)];
}

/**
 * A 32x32 RGB drawing surface for agent scenes. Each scene builds its own canvas and returns its
 * pixels, so the in-place drawing stays local to one frame.
 */
export class PixelCanvas {
  readonly size = MATRIX_SIZE;
  readonly rgb = new Uint8Array(MATRIX_SIZE * MATRIX_SIZE * 3);

  set(x: number, y: number, color: Rgb) {
    const px = Math.round(x), py = Math.round(y);
    if (px < 0 || py < 0 || px >= this.size || py >= this.size) return;
    this.rgb.set(color, (py * this.size + px) * 3);
  }

  fillRect(x: number, y: number, width: number, height: number, color: Rgb) {
    for (let dy = 0; dy < height; dy++) for (let dx = 0; dx < width; dx++) this.set(x + dx, y + dy, color);
  }

  line(x0: number, y0: number, x1: number, y1: number, color: Rgb, thickness = 1) {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= steps; i++) {
      const x = x0 + ((x1 - x0) * i) / steps, y = y0 + ((y1 - y0) * i) / steps;
      this.fillRect(Math.round(x - (thickness - 1) / 2), Math.round(y - (thickness - 1) / 2), thickness, thickness, color);
    }
  }

  /** Filled disc or ring; ringWidth > 0 draws only the outer band. */
  circle(cx: number, cy: number, radius: number, color: Rgb, ringWidth = 0) {
    for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y++) {
      for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d <= radius + 0.3 && (ringWidth <= 0 || d >= radius - ringWidth + 0.3)) this.set(x, y, color);
      }
    }
  }

  /** Draws an ASCII sprite: each '#' (or a key from colors) is a pixel; '.' and ' ' are transparent. */
  sprite(rows: readonly string[], x: number, y: number, color: Rgb, colors: Readonly<Record<string, Rgb>> = {}) {
    rows.forEach((row, dy) => {
      [...row].forEach((ch, dx) => {
        if (ch === "#") this.set(x + dx, y + dy, color);
        else if (colors[ch]) this.set(x + dx, y + dy, colors[ch]);
      });
    });
  }
}
