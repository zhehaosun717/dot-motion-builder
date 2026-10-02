import { dimmed, PixelCanvas, Rgb } from "@/lib/agent-display/pixel-canvas";

export const STATUSES = ["idle", "thinking", "working", "waiting", "done", "error"] as const;
export type Status = (typeof STATUSES)[number];

const STATUS_COLORS: Record<Status, Rgb> = {
  idle: [90, 160, 255],
  thinking: [255, 170, 0],
  working: [0, 150, 255],
  waiting: [255, 110, 0],
  done: [40, 230, 80],
  error: [255, 30, 30]
};

const phase = (t: number, periodMs: number) => (t % periodMs) / periodMs;
const pulse = (t: number, periodMs: number, low = 0.35) => low + (1 - low) * (0.5 + 0.5 * Math.cos(phase(t, periodMs) * Math.PI * 2));

type IconPainter = (canvas: PixelCanvas, t: number, cy: number, color: Rgb) => void;

const SPINNER_DOTS = 8;
const CHECK_POINTS = [[8, 0], [13, 5], [24, -6]] as const;

const PAINTERS: Record<Status, IconPainter> = {
  /** A dim, slowly breathing dot: present but quiet. */
  idle: (c, t, cy, color) => c.circle(16, cy, 3, dimmed(color, pulse(t, 4000, 0.25) * 0.6)),

  /** Dots on a ring with a bright head chasing round and a fading tail. */
  thinking: (c, t, cy, color) => {
    const head = Math.floor(t / 110) % SPINNER_DOTS;
    for (let i = 0; i < SPINNER_DOTS; i++) {
      const angle = (i / SPINNER_DOTS) * Math.PI * 2 - Math.PI / 2;
      const age = (head - i + SPINNER_DOTS) % SPINNER_DOTS;
      const level = age === 0 ? 1 : age < 4 ? 0.7 - age * 0.15 : 0.12;
      c.circle(16 + Math.cos(angle) * 9, cy + Math.sin(angle) * 9, 1.2, dimmed(color, level));
    }
  },

  /** A progress bar with stripes marching through it. */
  working: (c, t, cy, color) => {
    const top = cy - 4, height = 8, left = 3, width = 26;
    c.fillRect(left, top, width, 1, color);
    c.fillRect(left, top + height - 1, width, 1, color);
    c.fillRect(left, top, 1, height, color);
    c.fillRect(left + width - 1, top, 1, height, color);
    const shift = Math.floor(t / 70) % 6;
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        if ((x + y + shift) % 6 < 3) c.set(left + x, top + y, dimmed(color, 0.75));
      }
    }
  },

  /** Needs you: a pulsing ring around an exclamation mark. */
  waiting: (c, t, cy, color) => {
    c.circle(16, cy, 11, dimmed(color, pulse(t, 900, 0.25)), 2);
    c.fillRect(15, cy - 6, 3, 8, color);
    c.fillRect(15, cy + 4, 3, 3, color);
  },

  /** A check mark that draws itself, then twinkles. */
  done: (c, t, cy, color) => {
    const drawn = Math.min(1, t / 500);
    const [a, b, d] = CHECK_POINTS;
    const firstLeg = Math.min(1, drawn * 2), secondLeg = Math.max(0, drawn * 2 - 1);
    c.line(a[0], cy + a[1], a[0] + (b[0] - a[0]) * firstLeg, cy + a[1] + (b[1] - a[1]) * firstLeg, color, 3);
    if (secondLeg > 0) c.line(b[0], cy + b[1], b[0] + (d[0] - b[0]) * secondLeg, cy + b[1] + (d[1] - b[1]) * secondLeg, color, 3);
    if (drawn >= 1 && phase(t, 1200) < 0.3) c.sprite([".#.", "###", ".#."], 25, cy + 4, [220, 255, 220]);
  },

  /** A red cross that pulses. */
  error: (c, t, cy, color) => {
    const shown = dimmed(color, pulse(t, 1000, 0.45));
    c.line(8, cy - 8, 24, cy + 8, shown, 3);
    c.line(24, cy - 8, 8, cy + 8, shown, 3);
  }
};

/** One frame of a status icon centred vertically on cy. t is milliseconds since the status was set. */
export function paintStatus(canvas: PixelCanvas, status: Status, t: number, cy = 16) {
  PAINTERS[status](canvas, t, cy, STATUS_COLORS[status]);
}

export function statusColor(status: Status): Rgb {
  return STATUS_COLORS[status];
}
