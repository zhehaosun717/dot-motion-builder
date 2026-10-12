import { BLACK, dimmed, lightened, PixelCanvas, Rgb } from "@/lib/agent-display/pixel-canvas";
import type { Status } from "@/lib/agent-display/status-kinds";
import { eachPixel, wave } from "@/lib/agent-display/status-motion";

/**
 * The blob layer: a round, solid character in the status colour that stays on the panel once a
 * status has been announced. Its face is cut out of the body (unlit LEDs), which keeps it legible
 * at 32x32 without a second colour.
 */

/** Where the blob stands: bottom row (ground) and half width / half height of the body. */
export type BlobFrame = { ground: number; a: number; b: number };

type Body = BlobFrame & { cx: number };

const CX = 15.5;
const WHITE: Rgb = [255, 255, 255];
/** How square the body is: 2 is an ellipse, higher is boxier. */
const ROUNDNESS = 2.6;
const SHADE = 0.62;

const inside = (x: number, y: number, { cx, ground, a, b }: Body, grow = 0) =>
  Math.abs((x - cx) / (a + grow)) ** ROUNDNESS + Math.abs((y - (ground - b)) / (b + grow)) ** ROUNDNESS <= 1;

/** Body with a black halo, a darker base and a small highlight; returns its top row. */
function body(canvas: PixelCanvas, color: Rgb, shape: Body, level = 1) {
  const top = shape.ground - 2 * shape.b;
  eachPixel(32, (x, y) => { if (inside(x, y, shape, 1.2)) canvas.set(x, y, BLACK); });
  eachPixel(32, (x, y) => {
    if (inside(x, y, shape)) canvas.set(x, y, dimmed(color, (y >= shape.ground - 3 ? SHADE : 1) * level));
  });
  const shine = dimmed(lightened(color, 0.55), level), hx = Math.round(shape.cx - shape.a + 4);
  canvas.set(hx, top + 2, shine);
  canvas.set(hx + 1, top + 2, shine);
  canvas.set(hx, top + 3, shine);
  return top;
}

/** Left (-1) or right (1) eye's x for an eye w pixels wide, symmetric about the body's centre. */
function eyeX(shape: Body, w: number, side: -1 | 1) {
  const d = w % 2 === 0 ? Math.floor(shape.a * 0.4) + 0.5 : Math.round(shape.a * 0.42);
  return Math.round(shape.cx + side * d - w / 2);
}
const eyeY = (shape: Body, top: number) => top + Math.round(shape.b * 0.6);
const eyeH = (shape: Body) => Math.max(3, Math.round(shape.b * 0.4));

function eyes(canvas: PixelCanvas, shape: Body, top: number, w: number, h: number, dx = 0, dy = 0) {
  for (const side of [-1, 1] as const) canvas.fillRect(eyeX(shape, w, side) + dx, eyeY(shape, top) + dy, w, h, BLACK);
}

function eyeSprites(canvas: PixelCanvas, shape: Body, top: number, rows: readonly string[]) {
  for (const side of [-1, 1] as const) canvas.sprite(rows, eyeX(shape, 3, side), eyeY(shape, top), BLACK);
}

/** Three small dots above the head; lit(i) says which are on, lift(i) raises one by a pixel. */
function headDots(canvas: PixelCanvas, shape: Body, top: number, color: Rgb, lit: (i: number) => boolean, lift: (i: number) => number = () => 0) {
  const spacing = shape.a >= 11 ? 5 : 4, x0 = Math.round(shape.cx - 1 - spacing), y = Math.max(1, top - 5);
  for (let i = 0; i < 3; i++) {
    const x = x0 + i * spacing, dy = -lift(i);
    canvas.fillRect(x - 1, y - 1 + dy, 4, 4, BLACK);
    canvas.fillRect(x, y + dy, 2, 2, lit(i) ? lightened(color, 0.25) : dimmed(color, 0.35));
  }
}

/** Height of a hop at phase p (0..1) of a jump that takes the first 40% of the cycle. */
const hop = (p: number) => (p < 0.4 ? Math.sin((p / 0.4) * Math.PI) : 0);

type BlobPainter = (canvas: PixelCanvas, t: number, color: Rgb, frame: BlobFrame) => void;

const PAINTERS: Record<Status, BlobPainter> = {
  /** Flattened, dim, eyes shut, a "z" floating up. */
  idle: (c, t, color, f) => {
    const shape = { ...f, cx: CX, a: f.a + 1, b: Math.round(f.b * 0.7) };
    const top = body(c, color, shape, 0.4);
    for (const side of [-1, 1] as const) c.fillRect(eyeX(shape, 3, side), top + Math.round(shape.b * 0.7), 3, 1, BLACK);
    const p = (t % 2400) / 2400;
    c.sprite(["###", "..#", ".#.", "###"], Math.round(CX + 9.5), top - 2 - Math.round(p * 8), dimmed(color, 0.45 * (1 - p) + 0.1));
  },

  /** Looking up, with dots bobbing over its head one after another. */
  thinking: (c, t, color, f) => {
    const shape = { ...f, cx: CX };
    const top = body(c, color, shape);
    eyes(c, shape, top, 2, 3, 1, -1);
    const beat = Math.floor(t / 260) % 4;
    headDots(c, shape, top, color, () => true, i => (beat === i ? 1 : 0));
  },

  /** Glancing left and right while "typing" dots fill up above its head. */
  working: (c, t, color, f) => {
    const shape = { ...f, cx: CX, b: f.b - Math.round(wave(t, 700)) * 0.5 };
    const top = body(c, color, shape);
    eyes(c, shape, top, 2, eyeH(shape), Math.floor(t / 900) % 2 ? 1 : -1);
    const filled = Math.floor(t / 220) % 4;
    headDots(c, shape, top, color, i => filled > i);
  },

  /** Hopping with wide eyes until you answer. */
  waiting: (c, t, color, f) => {
    const p = (t % 1100) / 1100;
    const land = p >= 0.4 && p < 0.55 ? Math.sin(((p - 0.4) / 0.15) * Math.PI) : 0;
    const top0 = f.ground - 2 * f.b;
    const shape = { cx: CX, ground: f.ground - Math.round(hop(p) * Math.min(6, top0 - 2)), a: f.a + land * 1.5, b: f.b - land * 1.5 };
    const top = body(c, color, shape);
    eyes(c, shape, top, 3, eyeH(shape) + 1, 0, -1);
    for (const side of [-1, 1] as const) c.set(eyeX(shape, 3, side) + 1, eyeY(shape, top), WHITE);
  },

  /** Smiling eyes and mouth, with one happy hop when it arrives. */
  done: (c, t, color, f) => {
    const lift = Math.round(Math.max(0, Math.sin(Math.min(1, t / 500) * Math.PI)) * 4);
    const shape = { ...f, cx: CX, ground: f.ground - lift };
    const top = body(c, color, shape);
    eyeSprites(c, shape, top, [".#.", "#.#"]);
    c.sprite(["#...#", ".###."], Math.round(CX - 2.5), top + Math.round(shape.b * 1.1), BLACK);
  },

  /** Crossed eyes and a flat mouth; it shudders now and then. */
  error: (c, t, color, f) => {
    const shake = t % 2000 < 600 ? (Math.floor(t / 60) % 2 ? 1 : -1) : 0;
    const shape = { ...f, cx: CX + shake };
    const top = body(c, color, shape);
    eyeSprites(c, shape, top, ["#.#", ".#.", "#.#"]);
    c.fillRect(Math.round(shape.cx - 2), top + Math.round(shape.b * 1.15), 4, 1, BLACK);
  }
};

export function paintBlob(canvas: PixelCanvas, status: Status, t: number, color: Rgb, frame: BlobFrame) {
  PAINTERS[status](canvas, t, color, frame);
}
