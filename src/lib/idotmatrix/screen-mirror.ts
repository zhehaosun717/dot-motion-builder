import { backgroundInterval } from "@/lib/idotmatrix/background-timer";
import { MATRIX_SIZE } from "@/lib/idotmatrix/constants";
import { getDesktopBridge } from "@/lib/desktop-bridge";

const PIXELS = MATRIX_SIZE * MATRIX_SIZE;
/** Raw LEDs wash out sRGB content: linearise and warm it up a little (DeskDot hardware calibration). */
const GAMMA = 2.2;
const WHITE_BALANCE = [1, 0.88, 0.82] as const;
const LUT = WHITE_BALANCE.map(gain => Uint8Array.from({ length: 256 }, (_, v) => Math.round(255 * gain * (v / 255) ** GAMMA)));
const FRAME_INTERVAL_MS = 66;

/** Converts a 32x32 RGBA canvas readback into LED drive values. */
export function screenPixelsToLed(rgba: Uint8ClampedArray): Uint8Array {
  const rgb = new Uint8Array(PIXELS * 3);
  for (let i = 0; i < PIXELS; i++) {
    for (let c = 0; c < 3; c++) rgb[i * 3 + c] = LUT[c][rgba[i * 4 + c]];
  }
  return rgb;
}

export type ScreenMirror = { stop: () => void };
type FrameSource = { width: number; height: number; image: CanvasImageSource; release: () => void };
type ImageCaptureLike = { grabFrame(): Promise<ImageBitmap> };
type ImageCaptureCtor = new (track: MediaStreamTrack) => ImageCaptureLike;

/**
 * Grabs frames straight from the capture track where the browser allows it (Chrome's ImageCapture),
 * which keeps working while this window is covered; otherwise reads a hidden <video>.
 */
async function createFrameSource(media: MediaStream): Promise<() => Promise<FrameSource | null>> {
  const track = media.getVideoTracks()[0];
  const Capture = (globalThis as unknown as { ImageCapture?: ImageCaptureCtor }).ImageCapture;
  if (track && Capture) {
    const capture = new Capture(track);
    return async () => {
      const bitmap = await capture.grabFrame();
      return { width: bitmap.width, height: bitmap.height, image: bitmap, release: () => bitmap.close() };
    };
  }
  const video = document.createElement("video");
  video.muted = true;
  video.srcObject = media;
  await video.play();
  return async () => (video.videoWidth ? { width: video.videoWidth, height: video.videoHeight, image: video, release: () => undefined } : null);
}

/**
 * In the desktop app the user picks a source from a native menu and it is captured through Electron's
 * desktop source constraint; in a browser, the browser's own getDisplayMedia picker is used.
 */
async function openCapture(): Promise<MediaStream> {
  const pick = getDesktopBridge()?.pickCaptureSource;
  if (!pick) return navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 10 }, audio: false });
  const sourceId = await pick();
  if (!sourceId) throw new DOMException("Screen pick cancelled", "NotAllowedError");
  // Capped resolution: the picture ends up 32x32, so capturing a 4K desktop at full size only burns CPU.
  const desktopVideo = { mandatory: { chromeMediaSource: "desktop", chromeMediaSourceId: sourceId, maxFrameRate: 10, maxWidth: 640, maxHeight: 640 } };
  return navigator.mediaDevices.getUserMedia({ audio: false, video: desktopVideo as MediaTrackConstraints });
}

/**
 * Captures a screen, window or tab (the browser asks which) and hands 32x32 frames to onFrame.
 * The whole picture is letterboxed into the square so nothing is cropped.
 */
export async function startScreenMirror(onFrame: (rgb: Uint8Array) => void, onEnded: () => void): Promise<ScreenMirror> {
  const media = await openCapture();
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = MATRIX_SIZE;
  let context: CanvasRenderingContext2D;
  let nextFrame: () => Promise<FrameSource | null>;
  try {
    const context2d = canvas.getContext("2d", { willReadFrequently: true });
    if (!context2d) throw new Error("2D canvas unavailable");
    context = context2d;
    nextFrame = await createFrameSource(media);
  } catch (error) {
    // Never leave the screen shared (and the browser's sharing bar up) after a failed start.
    media.getTracks().forEach(track => track.stop());
    throw error;
  }
  let grabbing = false;
  let stopped = false;

  const stopTicking = backgroundInterval(FRAME_INTERVAL_MS, () => {
    if (grabbing) return;
    grabbing = true;
    nextFrame()
      .then(frame => {
        if (!frame) return;
        if (stopped) {
          frame.release(); // grabbed just before stop(): must not reach the panel after the user moved on
          return;
        }
        const scale = Math.min(MATRIX_SIZE / frame.width, MATRIX_SIZE / frame.height);
        context.fillStyle = "#000";
        context.fillRect(0, 0, MATRIX_SIZE, MATRIX_SIZE);
        context.imageSmoothingQuality = "high";
        context.drawImage(frame.image, (MATRIX_SIZE - frame.width * scale) / 2, (MATRIX_SIZE - frame.height * scale) / 2, frame.width * scale, frame.height * scale);
        frame.release();
        onFrame(screenPixelsToLed(context.getImageData(0, 0, MATRIX_SIZE, MATRIX_SIZE).data));
      })
      .catch(() => undefined) // a frame can fail while the source window is minimised; try again next tick
      .finally(() => { grabbing = false; });
  });

  const stop = () => {
    if (stopped) return;
    stopped = true;
    stopTicking();
    media.getTracks().forEach(track => track.stop());
    onEnded();
  };
  // The browser's own "Stop sharing" button ends the track.
  media.getVideoTracks()[0]?.addEventListener("ended", stop, { once: true });
  return { stop };
}
