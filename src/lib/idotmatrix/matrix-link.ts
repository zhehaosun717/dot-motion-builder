import { buildGifChunks, buildImageFrame, DIY_MODE_ON, isGifAck, isImageAck } from "@/lib/idotmatrix/protocol";
import { backgroundSleep } from "@/lib/idotmatrix/background-timer";

/** The GATT pieces MatrixLink needs; Web Bluetooth objects satisfy this shape. */
export type MatrixGatt = {
  name: string;
  write: { writeValueWithoutResponse(data: Uint8Array): Promise<void> };
  notify: EventTarget & { value?: DataView | null };
  disconnect(): void;
};

export type MatrixLinkOptions = {
  /** Back-to-back unpaced packets are silently dropped by the panel (hardware). */
  packetGapMs?: number;
  ackTimeoutMs?: number;
  /** Rapid repeat GIF uploads make the panel stop acking (hardware). */
  cooldownMs?: number;
  /** Packet sizes to probe, largest first; a size is kept once a full-size packet goes through. */
  packetSizes?: readonly number[];
  /** First retry delay for a failed write; doubles per attempt. */
  retryDelayMs?: number;
  /** How long a live frame waits for its predecessor's ack before moving on. */
  frameAckTimeoutMs?: number;
  /** Entering DIY mode blanks the panel briefly; frames sent sooner can be lost. */
  diySettleMs?: number;
};

export type UploadResult = { chunks: number; missedAcks: number };
type PanelMode = "unknown" | "diy" | "gif";

/** 509 B is the vendor app's size for MTU 512+; smaller sizes cover links that negotiated less. */
export const DEFAULT_PACKET_SIZES = [509, 182, 20] as const;
const WRITE_RETRIES = 3;
const MAX_INBOX = 32;
/** One frame in flight: waiting for every ack caps at ~2.6 fps, pipelining one gives ~9 fps (hardware). */
const MAX_FRAMES_IN_FLIGHT = 1;
/** A frame ack this late after its timeout is treated as stale rather than credited to a newer frame. */
const LATE_ACK_GRACE_MS = 1000;
const DEFAULT_OPTIONS: Required<MatrixLinkOptions> = {
  packetGapMs: 18,
  ackTimeoutMs: 3000,
  cooldownMs: 3000,
  packetSizes: DEFAULT_PACKET_SIZES,
  retryDelayMs: 50,
  frameAckTimeoutMs: 600,
  diySettleMs: 400
};

const sleep = (ms: number) => backgroundSleep(ms);

/** One connected panel: serialised, paced writes with MTU fallback and ack flow control. */
export class MatrixLink {
  readonly name: string;
  private readonly gatt: MatrixGatt;
  private readonly options: Required<MatrixLinkOptions>;
  private packetSizeIndex = 0;
  private packetSizeConfirmed = false;
  private inbox: Uint8Array[] = [];
  private wake: (() => void) | null = null;
  private busy = false;
  private readyAt = 0;
  private mode: PanelMode = "unknown";
  private framesInFlight = 0;
  private staleImageAcks = 0;
  private staleImageAcksUntil = 0;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(gatt: MatrixGatt, options: MatrixLinkOptions = {}) {
    this.gatt = gatt;
    this.name = gatt.name;
    this.options = { ...DEFAULT_OPTIONS, ...options };
    gatt.notify.addEventListener("characteristicvaluechanged", this.onNotify);
  }

  get uploading() {
    return this.busy;
  }

  send(data: Uint8Array) {
    return this.exclusive(() => this.writePacketed(data));
  }

  /** Never abandoned midway: a half-sent GIF leaves the firmware ignoring the next one (hardware). */
  async uploadGif(gif: Uint8Array, onProgress?: (sent: number, total: number) => void): Promise<UploadResult> {
    if (this.busy) throw new Error("A GIF upload is already in progress");
    this.busy = true;
    try {
      return await this.exclusive(() => this.writeGif(gif, onProgress));
    } finally {
      this.readyAt = Date.now() + this.options.cooldownMs;
      this.busy = false;
    }
  }

  /** Shows one PNG immediately (DIY mode); the panel keeps it until something else is sent. */
  showFrame(png: Uint8Array) {
    return this.exclusive(async () => {
      if (this.mode !== "diy") {
        await this.writePacketed(DIY_MODE_ON);
        await sleep(this.options.diySettleMs);
        this.mode = "diy";
        this.framesInFlight = 0;
      }
      await this.writePacketed(buildImageFrame(png));
      this.framesInFlight++;
      while (this.framesInFlight > MAX_FRAMES_IN_FLIGHT) {
        if (!(await this.waitFor(isImageAck, this.options.frameAckTimeoutMs))) {
          // Its ack may still turn up; it must not then release a newer frame early.
          this.staleImageAcks++;
          this.staleImageAcksUntil = Date.now() + LATE_ACK_GRACE_MS;
        }
        this.framesInFlight--;
      }
    });
  }

  disconnect() {
    this.gatt.notify.removeEventListener("characteristicvaluechanged", this.onNotify);
    this.gatt.disconnect();
  }

  /** Runs operations one at a time so GIF chunks and live frames never interleave on the wire. */
  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.queue.then(operation, operation);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async writeGif(gif: Uint8Array, onProgress?: (sent: number, total: number) => void): Promise<UploadResult> {
    await sleep(this.readyAt - Date.now());
    const chunks = buildGifChunks(gif);
    let missedAcks = 0;
    this.mode = "gif";
    for (const [i, chunk] of chunks.entries()) {
      // The panel acks a chunk only once it has all of it, so anything received before the
      // last packet goes out is a late ack for an earlier, timed-out chunk.
      await this.writePacketed(chunk, () => { this.inbox = []; });
      if (!(await this.waitFor(isGifAck, this.options.ackTimeoutMs))) missedAcks++;
      onProgress?.(i + 1, chunks.length);
    }
    return { chunks: chunks.length, missedAcks };
  }

  private onNotify = () => {
    const value = this.gatt.notify.value;
    if (!value) return;
    const bytes = new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
    if (isImageAck(bytes) && this.staleImageAcks > 0) {
      this.staleImageAcks--;
      if (Date.now() < this.staleImageAcksUntil) return;
    }
    this.inbox = [...this.inbox, bytes].slice(-MAX_INBOX);
    this.wake?.();
  };

  /**
   * Writes data in paced packets. A rejected write delivered nothing, so the same bytes are retried
   * with backoff; only a size that keeps failing before any full-size success is stepped down.
   */
  private async writePacketed(data: Uint8Array, beforeLastPacket?: () => void) {
    const sizes = this.options.packetSizes;
    let offset = 0;
    let failures = 0;
    while (offset < data.length) {
      const size = sizes[this.packetSizeIndex];
      const packet = data.slice(offset, offset + size);
      if (offset + packet.length === data.length) beforeLastPacket?.();
      try {
        await this.gatt.write.writeValueWithoutResponse(packet);
      } catch (error) {
        failures++;
        if (failures <= WRITE_RETRIES) {
          await sleep(this.options.retryDelayMs * 2 ** (failures - 1));
          continue;
        }
        if (this.packetSizeConfirmed || this.packetSizeIndex === sizes.length - 1) throw error;
        this.packetSizeIndex++;
        failures = 0;
        continue;
      }
      failures = 0;
      if (packet.length === size) this.packetSizeConfirmed = true;
      offset += packet.length;
      await sleep(this.options.packetGapMs);
    }
  }

  private async waitFor(match: (bytes: Uint8Array) => boolean, timeoutMs: number): Promise<Uint8Array | null> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const index = this.inbox.findIndex(match);
      if (index >= 0) {
        const hit = this.inbox[index];
        this.inbox = this.inbox.slice(index + 1);
        return hit;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) return null;
      await new Promise<void>(resolve => {
        const done = () => {
          if (this.wake === done) this.wake = null;
          resolve();
        };
        this.wake = done;
        void backgroundSleep(remaining).then(done);
      });
    }
  }
}
