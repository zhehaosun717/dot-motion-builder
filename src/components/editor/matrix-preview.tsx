"use client";

import { useEffect, useRef } from "react";
import { MATRIX_SIZE } from "@/lib/idotmatrix/constants";

type MatrixPreviewProps = {
  frames: Uint8Array[];
  delaysCs: number[];
  label: string;
};

const PITCH = 8;
const LED_RADIUS = 3.1;
const PANEL_COLOR = "#050607";
const OFF_LED = "rgb(24, 26, 30)";
/** LED drive values are linear light; the screen expects sRGB. */
const LINEAR_TO_SRGB = Array.from({ length: 256 }, (_, v) => Math.round(255 * (v / 255) ** (1 / 2.2)));

function drawFrame(context: CanvasRenderingContext2D, rgb: Uint8Array) {
  context.fillStyle = PANEL_COLOR;
  context.fillRect(0, 0, MATRIX_SIZE * PITCH, MATRIX_SIZE * PITCH);
  for (let i = 0; i < MATRIX_SIZE * MATRIX_SIZE; i++) {
    const r = rgb[i * 3], g = rgb[i * 3 + 1], b = rgb[i * 3 + 2];
    context.fillStyle = r || g || b ? `rgb(${LINEAR_TO_SRGB[r]}, ${LINEAR_TO_SRGB[g]}, ${LINEAR_TO_SRGB[b]})` : OFF_LED;
    context.beginPath();
    context.arc((i % MATRIX_SIZE) * PITCH + PITCH / 2, Math.floor(i / MATRIX_SIZE) * PITCH + PITCH / 2, LED_RADIUS, 0, Math.PI * 2);
    context.fill();
  }
}

/** Plays the exact frames that will be uploaded, drawn as round LEDs. */
export function MatrixPreview({ frames, delaysCs, label }: MatrixPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const context = canvasRef.current?.getContext("2d");
    if (!context || frames.length === 0) return;
    let index = 0;
    let timer = 0;
    const tick = () => {
      drawFrame(context, frames[index]);
      const delayMs = (delaysCs[index] ?? 10) * 10;
      index = (index + 1) % frames.length;
      if (frames.length > 1) timer = window.setTimeout(tick, delayMs);
    };
    tick();
    return () => window.clearTimeout(timer);
  }, [frames, delaysCs]);

  return (
    <canvas
      ref={canvasRef}
      className="matrix-preview"
      width={MATRIX_SIZE * PITCH}
      height={MATRIX_SIZE * PITCH}
      role="img"
      aria-label={label}
    />
  );
}
