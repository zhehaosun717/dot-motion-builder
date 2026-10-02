import { drawText } from "@/lib/agent-display/font";
import { dimmed, PixelCanvas, Rgb } from "@/lib/agent-display/pixel-canvas";

export const MOODS = [
  "neutral", "happy", "excited", "love", "proud", "surprised",
  "confused", "sad", "angry", "sleepy", "nervous"
] as const;
export type Mood = (typeof MOODS)[number];

/** Saturated colours: on raw LEDs dark or pastel tones wash out. */
const MOOD_COLORS: Record<Mood, Rgb> = {
  neutral: [110, 200, 255],
  happy: [255, 200, 40],
  excited: [255, 140, 0],
  love: [255, 50, 130],
  proud: [255, 200, 40],
  surprised: [255, 255, 255],
  confused: [180, 120, 255],
  sad: [70, 130, 255],
  angry: [255, 40, 20],
  sleepy: [120, 95, 220],
  nervous: [110, 255, 170]
};

const LEFT_EYE_X = 10;
const RIGHT_EYE_X = 21;
const EYE_Y = 13;
const MOUTH_Y = 22;
const BLINK_PERIOD_MS = 3200;
const BLINK_MS = 160;

const EYE_OPEN = [".##.", "####", "####", "####", "####", ".##."];
const EYE_BLINK = ["....", "....", "....", "####", "....", "...."];
const EYE_HAPPY = [".##.", "#..#", "#..#"];
const EYE_CLOSED = ["#..#", ".##."];
const EYE_SQUINT = ["####"];
const EYE_RING = [".####.", "#....#", "#.##.#", "#.##.#", "#....#", ".####."];
const EYE_HEART_BIG = [".##.##.", "#######", "#######", ".#####.", "..###..", "...#..."];
const EYE_HEART_SMALL = [".#.#.", "#####", ".###.", "..#.."];

const MOUTH_SMILE = ["#......#", ".#....#.", "..####.."];
const MOUTH_GRIN = ["########", ".######.", "..####.."];
const MOUTH_FROWN = ["..####..", ".#....#.", "#......#"];
const MOUTH_FLAT = ["######"];
const MOUTH_SHORT = ["####"];
const MOUTH_O = [".##.", "#..#", "#..#", ".##."];
const MOUTH_WAVY = [".#...#..", "#.#.#.#.", "...#...#"];
const MOUTH_SMIRK = [".......#", "......#.", "######.."];

const SPARKLE_SPOTS = [[3, 4], [28, 6], [5, 27], [27, 26], [15, 2]] as const;

/** Draws a sprite centred on (cx, cy). */
function centred(canvas: PixelCanvas, rows: readonly string[], cx: number, cy: number, color: Rgb) {
  canvas.sprite(rows, Math.round(cx - rows[0].length / 2), Math.round(cy - rows.length / 2), color);
}

function eyes(canvas: PixelCanvas, rows: readonly string[], color: Rgb, dx = 0, dy = 0, rightRows = rows) {
  centred(canvas, rows, LEFT_EYE_X + dx, EYE_Y + dy, color);
  centred(canvas, rightRows, RIGHT_EYE_X + dx, EYE_Y + dy, color);
}

function mouth(canvas: PixelCanvas, rows: readonly string[], color: Rgb, dx = 0, dy = 0) {
  centred(canvas, rows, 16 + dx, MOUTH_Y + dy, color);
}

const isBlinking = (t: number) => t % BLINK_PERIOD_MS < BLINK_MS;
const phase = (t: number, periodMs: number) => (t % periodMs) / periodMs;

type MoodPainter = (canvas: PixelCanvas, t: number, color: Rgb) => void;

const PAINTERS: Record<Mood, MoodPainter> = {
  neutral: (c, t, color) => {
    eyes(c, isBlinking(t) ? EYE_BLINK : EYE_OPEN, color);
    mouth(c, MOUTH_FLAT, color);
  },
  happy: (c, t, color) => {
    const bob = Math.round(Math.sin(phase(t, 1600) * Math.PI * 2) * 0.6);
    eyes(c, EYE_HAPPY, color, 0, bob);
    mouth(c, MOUTH_SMILE, color, 0, bob);
  },
  excited: (c, t, color) => {
    const bob = Math.round(Math.sin(phase(t, 500) * Math.PI * 2) * 1.5);
    eyes(c, EYE_HAPPY, color, 0, bob);
    mouth(c, MOUTH_GRIN, color, 0, bob);
    SPARKLE_SPOTS.forEach(([x, y], i) => {
      const on = phase(t + i * 230, 900) < 0.5;
      if (on) c.sprite([".#.", "###", ".#."], x - 1, y - 1, [255, 240, 120]);
    });
  },
  love: (c, t, color) => {
    const big = phase(t, 700) < 0.55;
    eyes(c, big ? EYE_HEART_BIG : EYE_HEART_SMALL, color);
    mouth(c, MOUTH_SMILE, color);
  },
  proud: (c, t, color) => {
    const lens: Rgb = [70, 20, 170];
    c.fillRect(4, 10, 24, 1, [150, 120, 255]);
    c.fillRect(5, 11, 9, 5, lens);
    c.fillRect(18, 11, 9, 5, lens);
    // A glint sweeps across the lenses every couple of seconds.
    const glint = Math.floor(phase(t, 2400) * 40) - 4;
    for (const lx of [5, 18]) for (let k = 0; k < 2; k++) c.set(lx + glint - k, 11 + k, [255, 255, 255]);
    mouth(c, MOUTH_SMIRK, color, 1);
  },
  surprised: (c, t, color) => {
    eyes(c, EYE_RING, color);
    const pulse = phase(t, 900) < 0.5 ? MOUTH_O : [".##.", "#..#", ".##."];
    mouth(c, pulse, color, 0, 1);
  },
  confused: (c, t, color) => {
    const sway = Math.round(Math.sin(phase(t, 1400) * Math.PI * 2));
    centred(c, EYE_OPEN, LEFT_EYE_X, EYE_Y, color);
    centred(c, EYE_SQUINT, RIGHT_EYE_X, EYE_Y + 1, color);
    c.line(18, 8, 24, 9, color);
    mouth(c, MOUTH_WAVY, color);
    drawText(c, "?", 25 + sway, 1, [255, 220, 0]);
  },
  sad: (c, t, color) => {
    eyes(c, EYE_OPEN, color, 0, 1);
    c.line(7, 9, 12, 7, color);
    c.line(19, 7, 24, 9, color);
    mouth(c, MOUTH_FROWN, color, 0, 1);
    const tearY = 17 + Math.floor(phase(t, 1300) * 12);
    c.fillRect(8, tearY, 1, 2, [130, 210, 255]);
  },
  angry: (c, t, color) => {
    const shake = Math.floor(t / 90) % 2 === 0 ? 0 : 1;
    eyes(c, EYE_OPEN, color, shake, 1);
    // Brows slant down towards the nose and stay a row clear of the eyes.
    c.line(6 + shake, 5, 12 + shake, 8, color, 2);
    c.line(19 + shake, 8, 25 + shake, 5, color, 2);
    mouth(c, MOUTH_FROWN, color, shake, 1);
  },
  sleepy: (c, t, color) => {
    eyes(c, EYE_CLOSED, color, 0, 1);
    mouth(c, MOUTH_SHORT, dimmed(color, 0.8));
    for (let i = 0; i < 2; i++) {
      const p = phase(t + i * 1000, 2000);
      const zColor = dimmed([170, 170, 255], 1 - p * 0.7);
      drawText(c, "Z", 22 + Math.round(p * 4), 9 - Math.round(p * 9), zColor);
    }
  },
  nervous: (c, t, color) => {
    const glance = phase(t, 1800) < 0.5 ? -1 : 1;
    eyes(c, isBlinking(t * 1.7) ? EYE_BLINK : EYE_OPEN, color, glance);
    mouth(c, MOUTH_WAVY, color);
    const dropY = 4 + Math.floor(phase(t, 1500) * 8);
    c.sprite([".#.", "###", "###", ".#."], 26, dropY, [100, 200, 255]);
  }
};

/** One frame of an animated pixel face expressing a mood. t is milliseconds since the mood was set. */
export function paintMood(canvas: PixelCanvas, mood: Mood, t: number) {
  PAINTERS[mood](canvas, t, MOOD_COLORS[mood]);
}
