import { BLACK, dimmed, lightened, PixelCanvas, Rgb } from "@/lib/agent-display/pixel-canvas";
import type { Status } from "@/lib/agent-display/status-kinds";
import { clamp01, easeOutBack, eachPixel, wave } from "@/lib/agent-display/status-motion";

/**
 * The badge layer: one big solid disc in the status colour with its symbol cut out of it, so the
 * symbol is unlit LEDs. A 1px black halo keeps it apart from the light pattern behind.
 */

/** Centre and full radius; symbols are laid out for r = 13 and scaled from there. */
export type BadgeFrame = { cx: number; cy: number; r: number };

/** Below this scale (popping in or out) the disc is drawn without its symbol. */
const SYMBOL_MIN_SCALE = 0.7;
const RING_SEGMENTS = 12;
const RING_TAIL = [1, 0.75, 0.5, 0.35];
const RING_REST = 0.26;

function disc(canvas: PixelCanvas, { cx, cy }: BadgeFrame, r: number, color: Rgb) {
  canvas.circle(cx, cy, r, color);
}

/** Solid disc with a black halo. */
function plate(canvas: PixelCanvas, frame: BadgeFrame, r: number, color: Rgb) {
  disc(canvas, frame, r + 1, BLACK);
  disc(canvas, frame, r, color);
}

function cutLine(canvas: PixelCanvas, from: [number, number], to: [number, number], progress: number, thickness: number) {
  const p = clamp01(progress);
  if (p > 0) canvas.line(from[0], from[1], from[0] + (to[0] - from[0]) * p, from[1] + (to[1] - from[1]) * p, BLACK, thickness);
}

type BadgePainter = (canvas: PixelCanvas, t: number, color: Rgb, frame: BadgeFrame, scale: number) => void;

const PAINTERS: Record<Exclude<Status, "idle">, BadgePainter> = {
  /** Three dots cut out one after another, like "…". */
  thinking: (c, t, color, f, scale) => {
    plate(c, f, f.r * scale, color);
    if (scale < SYMBOL_MIN_SCALE) return;
    const u = f.r / 13, size = Math.max(2, Math.round(3 * u)), shown = Math.floor(t / 300) % 4;
    for (let i = 0; i < shown; i++) c.fillRect(Math.round(f.cx + (i - 1) * 6 * u - size / 2), Math.round(f.cy - size / 2), size, size, BLACK);
  },

  /** A thick ring with a bright segment chasing round it and a core that breathes. */
  working: (c, t, color, f, scale) => {
    const r = f.r * scale, u = r / 13, width = Math.max(2, 4 * u), head = Math.floor(t / 85) % RING_SEGMENTS;
    disc(c, f, r + 1, BLACK);
    eachPixel(32, (x, y) => {
      const dx = x - f.cx, dy = y - f.cy, d = Math.hypot(dx, dy);
      if (d > r + 0.4 || d < r - width + 0.4) return;
      const turn = ((Math.atan2(dy, dx) + Math.PI * 2.5) % (Math.PI * 2)) / (Math.PI * 2);
      const age = (head - Math.floor(turn * RING_SEGMENTS) + RING_SEGMENTS) % RING_SEGMENTS;
      c.set(x, y, age === 0 ? lightened(color, 0.15) : dimmed(color, RING_TAIL[age] ?? RING_REST));
    });
    disc(c, f, 4 * u, dimmed(color, 0.55 + 0.45 * wave(t, 1020)));
  },

  /** An exclamation mark in a disc that breathes. */
  waiting: (c, t, color, f, scale) => {
    const r = (f.r - 1.5 + wave(t, 1100)) * scale;
    plate(c, f, r, color);
    if (scale < SYMBOL_MIN_SCALE) return;
    const u = f.r / 13, w = Math.max(2, Math.round(4 * u)), x = Math.round(f.cx - w / 2);
    c.fillRect(x, Math.round(f.cy - 7.5 * u), w, Math.round(10 * u), BLACK);
    c.fillRect(x, Math.round(f.cy + 4.5 * u), w, Math.max(2, Math.round(4 * u)), BLACK);
  },

  /** The disc pops in, then a check mark is cut into it stroke by stroke. */
  done: (c, t, color, f, scale) => {
    plate(c, f, f.r * easeOutBack(t / 380) * scale, color);
    if (scale < SYMBOL_MIN_SCALE) return;
    const u = f.r / 13, thick = Math.max(2, Math.round(3 * u)), drawn = clamp01((t - 200) / 350);
    const a: [number, number] = [f.cx - 7 * u, f.cy + 0.5 * u], b: [number, number] = [f.cx - 2 * u, f.cy + 5.5 * u], e: [number, number] = [f.cx + 7.5 * u, f.cy - 4.5 * u];
    cutLine(c, a, b, drawn * 2, thick);
    cutLine(c, b, e, drawn * 2 - 1, thick);
  },

  /** A cross cut into a disc that shakes. */
  error: (c, t, color, f, scale) => {
    const shake = t % 1400 < 360 ? (Math.floor(t / 60) % 2 ? 1 : -1) : 0;
    const frame = { ...f, cx: f.cx + shake };
    plate(c, frame, f.r * scale, color);
    if (scale < SYMBOL_MIN_SCALE) return;
    const u = f.r / 13, k = 5 * u, thick = Math.max(2, Math.round(3 * u));
    cutLine(c, [frame.cx - k, f.cy - k], [frame.cx + k, f.cy + k], 1, thick);
    cutLine(c, [frame.cx + k, f.cy - k], [frame.cx - k, f.cy + k], 1, thick);
  }
};

/** Paints a status badge; scale 0..1 shrinks it while it pops in or out. Idle has no badge. */
export function paintBadge(canvas: PixelCanvas, status: Status, t: number, color: Rgb, frame: BadgeFrame, scale = 1) {
  if (status === "idle" || scale <= 0) return;
  PAINTERS[status](canvas, t, color, frame, clamp01(scale));
}
