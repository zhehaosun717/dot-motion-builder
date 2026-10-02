import { backgroundSleep } from "@/lib/idotmatrix/background-timer";

export type LiveStreamOptions = {
  /** Lower bound between pushes. Small 32x32 pixel-art frames (~200 B PNG) streamed at 40 fps on the
   *  user's panel (2026-10-02); photo-like frames span several packets and are paced by acks instead. */
  minIntervalMs?: number;
  onError?: (error: Error) => void;
};

/**
 * Pushes one frame. Call stillWanted() after any slow step (e.g. PNG encoding) and drop the frame
 * if it returns false: the stream was cancelled meanwhile, for instance because a GIF upload began.
 */
export type FramePush = (rgb: Uint8Array, stillWanted: () => boolean) => Promise<void>;

const DEFAULT_MIN_INTERVAL_MS = 50;
const sameFrame = (a: Uint8Array | null, b: Uint8Array) => a !== null && a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * Latest-frame-wins pump: while one frame is being pushed, newer frames replace each other,
 * so a slow link shows the most recent state instead of falling behind. Unchanged frames are skipped.
 */
export class LiveFrameStream {
  private readonly push: FramePush;
  private readonly minIntervalMs: number;
  private readonly onError?: (error: Error) => void;
  private pending: Uint8Array | null = null;
  private lastSent: Uint8Array | null = null;
  private lastAt = 0;
  private generation = 0;
  private running: Promise<void> | null = null;

  constructor(push: FramePush, options: LiveStreamOptions = {}) {
    this.push = push;
    this.minIntervalMs = options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
    this.onError = options.onError;
  }

  show(rgb: Uint8Array) {
    this.pending = rgb;
    if (!this.running) this.running = this.pump().finally(() => { this.running = null; });
  }

  /** Drops the waiting frame and tells an in-progress push to abandon its frame. */
  cancel() {
    this.pending = null;
    this.generation++;
  }

  /** Forget the last frame so the next one is sent even if identical (e.g. after a GIF replaced it). */
  reset() {
    this.lastSent = null;
  }

  async idle() {
    while (this.running) await this.running;
  }

  private async pump() {
    while (this.pending) {
      const generation = this.generation;
      const wait = this.lastAt + this.minIntervalMs - Date.now();
      if (wait > 0) await backgroundSleep(wait);
      const frame = this.pending;
      this.pending = null;
      if (!frame || generation !== this.generation || sameFrame(this.lastSent, frame)) continue;
      try {
        await this.push(frame, () => generation === this.generation);
        if (generation === this.generation) this.lastSent = frame;
      } catch (error) {
        this.onError?.(error instanceof Error ? error : new Error(String(error)));
      }
      this.lastAt = Date.now();
    }
  }
}
