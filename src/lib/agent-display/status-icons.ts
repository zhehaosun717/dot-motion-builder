import type { PixelCanvas, Rgb } from "@/lib/agent-display/pixel-canvas";
import { BadgeFrame, paintBadge } from "@/lib/agent-display/status-badge";
import { BlobFrame, paintBlob } from "@/lib/agent-display/status-blob";
import { STATUSES, type Status } from "@/lib/agent-display/status-kinds";
import { paintLight, paintSweep } from "@/lib/agent-display/status-light";

export { STATUSES };
export type { Status };

const STATUS_COLORS: Record<Status, Rgb> = {
  idle: [90, 160, 255],
  thinking: [255, 170, 0],
  working: [0, 150, 255],
  waiting: [255, 110, 0],
  done: [40, 230, 80],
  error: [255, 30, 30]
};

/**
 * What a new status looks like over time (ms after it was set):
 * a bright sweep crosses the panel so it is noticed from across the room, a badge says what
 * happened, then the blob character stays, over a dim moving light in the same colour.
 * Idle skips the announcement: nothing happened.
 */
export const SWEEP_MS = 500;
/** The badge grows in over the tail of the sweep. */
const BADGE_FROM = 300;
const BADGE_GROW_MS = 200;
export const BADGE_UNTIL = 1800;
const BADGE_SHRINK_MS = 160;

type StatusLayout = { rows: number; badge: BadgeFrame; blob: BlobFrame };

const FULL_LAYOUT: StatusLayout = { rows: 32, badge: { cx: 15.5, cy: 15.5, r: 13 }, blob: { ground: 28, a: 12, b: 10 } };

/** Fits the badge and blob into the top `rows` rows, leaving the rest for a label. */
function layoutFor(rows: number): StatusLayout {
  if (rows >= FULL_LAYOUT.rows) return FULL_LAYOUT;
  const b = Math.min(10, Math.floor((rows - 7) / 2));
  return { rows, badge: { cx: 15.5, cy: rows / 2 - 0.5, r: rows / 2 - 3 }, blob: { ground: rows - 1, a: b + 2, b } };
}

/**
 * One frame of a status, t milliseconds after it was set, drawn in color (the status's own colour
 * unless the sender chose one, e.g. one colour per assistant) within the top `rows` rows.
 */
export function paintStatus(canvas: PixelCanvas, status: Status, t: number, color: Rgb = STATUS_COLORS[status], rows = 32) {
  const layout = layoutFor(rows);
  if (status === "idle") {
    paintLight(canvas, status, t, color, layout.rows);
    paintBlob(canvas, status, t, color, layout.blob);
    return;
  }
  if (t < SWEEP_MS) {
    paintSweep(canvas, t / SWEEP_MS, color, layout.rows);
    paintBadge(canvas, status, t - BADGE_FROM, color, layout.badge, (t - BADGE_FROM) / BADGE_GROW_MS);
    return;
  }
  paintLight(canvas, status, t, color, layout.rows);
  if (t < BADGE_UNTIL) {
    paintBadge(canvas, status, t - BADGE_FROM, color, layout.badge, (BADGE_UNTIL - t) / BADGE_SHRINK_MS);
    return;
  }
  paintBlob(canvas, status, t - BADGE_UNTIL, color, layout.blob);
}

export function statusColor(status: Status): Rgb {
  return STATUS_COLORS[status];
}
