import { GIF_BUDGET_BYTES, MATRIX_SIZE, MAX_GIF_FRAMES } from "@/lib/idotmatrix/constants";
import { encodeGif } from "@/lib/idotmatrix/gif-encoder";
import { renderMatrixFrames } from "@/lib/idotmatrix/render-frames";
import { LoaderComponent, Project } from "@/types/dot-motion";

export type MatrixGif = {
  gif: Uint8Array;
  frames: Uint8Array[];
  delaysCs: number[];
  frameCount: number;
  fps: number;
};

const MAX_ATTEMPTS = 8;

/** Renders and encodes the loader, halving the frame rate until the GIF fits the panel's comfortable budget. */
export function buildMatrixGif(project: Project, loader: LoaderComponent, options: { showInactive: boolean }): MatrixGif {
  let maxFrames = MAX_GIF_FRAMES;
  let result: MatrixGif | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const rendered = renderMatrixFrames(project, loader, { ...options, maxFrames });
    const gif = encodeGif(MATRIX_SIZE, MATRIX_SIZE, rendered.frames.map((rgb, i) => ({ rgb, delayCs: rendered.delaysCs[i] })));
    result = { gif, frames: rendered.frames, delaysCs: rendered.delaysCs, frameCount: rendered.frames.length, fps: rendered.fps };
    const canShrink = !loader.sequenceId && rendered.frames.length > 2;
    if (gif.length <= GIF_BUDGET_BYTES || !canShrink) break;
    maxFrames = Math.max(2, Math.floor(rendered.frames.length / 2));
  }
  if (!result) throw new Error("GIF rendering produced no result");
  return result;
}
