import { renderScene } from "@/lib/agent-display/scene";

const TILE_BGR = [24, 20, 18] as const;

/** Whether pixel (x, y) lies inside a square of the given size with rounded corners. */
function insideRoundedSquare(x: number, y: number, size: number, radius: number) {
  const px = x + 0.5, py = y + 0.5;
  const cx = Math.min(Math.max(px, radius), size - radius);
  const cy = Math.min(Math.max(py, radius), size - radius);
  return Math.hypot(px - cx, py - cy) <= radius;
}

/** The app and tray icon: the agent's happy face on a dark tile, as BGRA for nativeImage.createFromBitmap. */
export function faceIconBitmap(scale: number): { buffer: Buffer; size: number } {
  const rgb = renderScene({ kind: "mood", mood: "happy" }, 0);
  const size = 32 * scale;
  const buffer = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const src = (Math.floor(y / scale) * 32 + Math.floor(x / scale)) * 3;
      const dst = (y * size + x) * 4;
      const lit = rgb[src] || rgb[src + 1] || rgb[src + 2];
      const tile = insideRoundedSquare(x, y, size, scale * 6);
      buffer[dst] = lit ? rgb[src + 2] : TILE_BGR[0];
      buffer[dst + 1] = lit ? rgb[src + 1] : TILE_BGR[1];
      buffer[dst + 2] = lit ? rgb[src] : TILE_BGR[2];
      buffer[dst + 3] = lit || tile ? 255 : 0;
    }
  }
  return { buffer, size };
}
