/** Small timing helpers shared by the status layers. Times are milliseconds. */

export const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

/** 1 at t = 0, 0 half a period later, back to 1: a smooth pulse. */
export const wave = (t: number, periodMs: number) => 0.5 + 0.5 * Math.cos((t / periodMs) * Math.PI * 2);

/** Overshoots a little before settling, for things that pop in. */
export function easeOutBack(p: number) {
  const s = 1.7, q = clamp01(p) - 1;
  return 1 + q * q * ((s + 1) * q + s);
}

/** Stable pseudo-random 0..1 per pixel, so scattered stars stay put between frames. */
export function hash01(x: number, y: number) {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/** Calls fn for every pixel of the top `rows` rows of the 32x32 panel. */
export function eachPixel(rows: number, fn: (x: number, y: number) => void) {
  for (let y = 0; y < rows; y++) for (let x = 0; x < 32; x++) fn(x, y);
}
