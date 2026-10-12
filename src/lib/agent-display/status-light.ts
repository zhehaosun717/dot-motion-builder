import { dimmed, lightened, PixelCanvas, Rgb } from "@/lib/agent-display/pixel-canvas";
import type { Status } from "@/lib/agent-display/status-kinds";
import { clamp01, eachPixel, hash01, wave } from "@/lib/agent-display/status-motion";

/**
 * The light layer: a dim full-panel pattern behind the badge and the blob, and the bright sweep that
 * announces a new status. Few levels and hard edges, which read better on LEDs than smooth gradients.
 */

const MID = 15.5;
/** Background brightness: the pattern should be felt, not compete with what is in front. */
const LEVEL = 0.3;
const STAR_LEVEL = 0.45;

const ringPhase = (x: number, y: number, t: number, speedMs: number) => {
  const d = Math.max(Math.abs(x - MID), Math.abs(y - MID));
  return (((d - t / speedMs) % 6) + 6) % 6;
};

/** 0..1 brightness of each status's pattern at a pixel. */
const PATTERNS: Record<Status, (x: number, y: number, t: number) => number> = {
  /** A few stars that twinkle slowly. */
  idle: (x, y, t) => {
    const s = hash01(x, y);
    return s > 0.955 ? (STAR_LEVEL / LEVEL) * (0.5 + 0.5 * wave(t + s * 4000, 2600)) : 0;
  },
  /** Square rings drifting inwards, slowly. */
  thinking: (x, y, t) => (ringPhase(x, y, -t, 200) < 1.5 ? 0.8 : 0),
  /** Diagonal stripes marching, like a progress bar across the whole panel. */
  working: (x, y, t) => {
    const p = (((x + y - Math.floor(t / 55)) % 8) + 8) % 8;
    return p < 3 ? 1 : p === 3 ? 0.45 : 0;
  },
  /** Square rings pushing outwards and breathing. */
  waiting: (x, y, t) => {
    const p = ringPhase(x, y, t, 110);
    return (p < 2 ? 1 : p < 3 ? 0.4 : 0) * (0.6 + 0.4 * wave(t, 1100));
  },
  /** Rays turning slowly around the centre. */
  done: (x, y, t) => {
    const turn = (Math.atan2(y - MID, x - MID) + t * 0.0006) / (Math.PI * 2);
    return (((turn * 10) % 1) + 1) % 1 < 0.45 ? 0.8 : 0;
  },
  /** Horizontal bands that blink. */
  error: (x, y, t) => (y % 4 < 2 ? (t % 1000 < 500 ? 1 : 0.35) : 0)
};

/** Paints the dim background pattern over the top `rows` rows. */
export function paintLight(canvas: PixelCanvas, status: Status, t: number, color: Rgb, rows = 32) {
  const pattern = PATTERNS[status];
  eachPixel(rows, (x, y) => {
    const level = pattern(x, y, t);
    if (level > 0) canvas.set(x, y, dimmed(color, level * LEVEL));
  });
}

/** The sweep's diagonal reach (x + y) when it has crossed the panel, including its fading tail. */
const SWEEP_REACH = 70;

/** A bright diagonal band crossing the panel; progress 0..1. Bright edge, solid body, two fading steps. */
export function paintSweep(canvas: PixelCanvas, progress: number, color: Rgb, rows = 32) {
  const front = clamp01(progress) * SWEEP_REACH;
  eachPixel(rows, (x, y) => {
    const behind = front - (x + y);
    if (behind <= 0) return;
    canvas.set(x, y, behind < 3 ? lightened(color, 0.35) : behind < 12 ? color : behind < 22 ? dimmed(color, 0.5) : dimmed(color, 0.2));
  });
}
