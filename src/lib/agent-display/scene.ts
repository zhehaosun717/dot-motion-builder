import { z } from "zod";
import { paintMood, MOODS } from "@/lib/agent-display/face";
import { drawText, GLYPH_ADVANCE, GLYPH_HEIGHT, measureText, wrapText } from "@/lib/agent-display/font";
import { PixelCanvas, Rgb } from "@/lib/agent-display/pixel-canvas";
import { paintStatus, statusColor, STATUSES } from "@/lib/agent-display/status-icons";

const SIZE = 32;
const MAX_LABEL = 48;
const MAX_TEXT = 280;
const MAX_FRAMES = 16;
const TEXT_LINE_CHARS = Math.floor((SIZE + 1) / GLYPH_ADVANCE);
const TEXT_LINE_HEIGHT = GLYPH_HEIGHT + 1;
const TEXT_MAX_LINES = Math.floor((SIZE + 1) / TEXT_LINE_HEIGHT);
const MARQUEE_SCALE = 2;
const MARQUEE_PX_PER_S = 22;
const LABEL_TOP = 26;
const DEFAULT_TEXT_COLOR: Rgb = [255, 220, 140];

const hexColor = z.string().regex(/^#?[0-9a-fA-F]{6}$/, "color must be a hex colour like #FF8800");

/** Every scene an agent can put on the panel. Validated at the API boundary; t=0 is when it was set. */
export const sceneSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("status"),
    status: z.enum(STATUSES, { errorMap: () => ({ message: `status must be one of ${STATUSES.join(", ")}` }) }),
    label: z.string().max(MAX_LABEL, `label must be at most ${MAX_LABEL} characters`).optional()
  }),
  z.object({
    kind: z.literal("mood"),
    mood: z.enum(MOODS, { errorMap: () => ({ message: `mood must be one of ${MOODS.join(", ")}` }) })
  }),
  z.object({
    kind: z.literal("text"),
    text: z.string().trim().min(1, "text must not be empty").max(MAX_TEXT, `text must be at most ${MAX_TEXT} characters`),
    color: hexColor.optional()
  }),
  z.object({
    kind: z.literal("pixels"),
    frames: z
      .array(z.array(z.string().max(SIZE, `rows must be at most ${SIZE} characters`)).max(SIZE, `at most ${SIZE} rows per frame`))
      .min(1, "frames must contain at least one frame")
      .max(MAX_FRAMES, `frames must contain at most ${MAX_FRAMES} frames`),
    palette: z.record(z.string().length(1), z.string().regex(/^#?[0-9a-fA-F]{6}$/, "palette colours must be hex like #FF8800")),
    fps: z.number().min(0.5).max(20).optional()
  })
], { errorMap: (issue, ctx) => (issue.code === "invalid_union_discriminator" ? { message: "kind must be status, mood, text or pixels" } : { message: ctx.defaultError }) });

export type AgentScene = z.infer<typeof sceneSchema>;

/** Validates untrusted input (API body, MCP arguments) into a scene, with a readable error. */
export function parseScene(input: unknown): AgentScene {
  const result = sceneSchema.safeParse(input);
  if (!result.success) throw new Error(result.error.issues.map(issue => issue.message).join("; "));
  return result.data;
}

function parseHex(hex: string): Rgb {
  const value = Number.parseInt(hex.replace("#", ""), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function textLayout(text: string) {
  const lines = wrapText(text, TEXT_LINE_CHARS);
  return lines.length <= TEXT_MAX_LINES ? { lines, marquee: false } : { lines: [text.replace(/\s+/g, " ")], marquee: true };
}

/** Whether frames change over time (static scenes only need to be sent once). */
export function isAnimated(scene: AgentScene) {
  if (scene.kind === "text") return textLayout(scene.text).marquee;
  if (scene.kind === "pixels") return scene.frames.length > 1;
  return true;
}

function marqueeOffset(width: number, t: number) {
  return Math.floor((t * MARQUEE_PX_PER_S) / 1000) % (width + SIZE);
}

function paintText(canvas: PixelCanvas, text: string, color: Rgb, t: number) {
  const { lines, marquee } = textLayout(text);
  if (marquee) {
    const width = measureText(lines[0], MARQUEE_SCALE);
    drawText(canvas, lines[0], SIZE - marqueeOffset(width, t), (SIZE - GLYPH_HEIGHT * MARQUEE_SCALE) / 2, color, MARQUEE_SCALE);
    return;
  }
  const top = Math.floor((SIZE - (lines.length * TEXT_LINE_HEIGHT - 1)) / 2);
  lines.forEach((line, i) => drawText(canvas, line, Math.floor((SIZE - measureText(line)) / 2), top + i * TEXT_LINE_HEIGHT, color));
}

function paintLabel(canvas: PixelCanvas, label: string, color: Rgb, t: number) {
  const width = measureText(label);
  const x = width <= SIZE ? Math.floor((SIZE - width) / 2) : SIZE - marqueeOffset(width, t);
  drawText(canvas, label, x, LABEL_TOP + 1, color);
}

function paintPixels(canvas: PixelCanvas, scene: Extract<AgentScene, { kind: "pixels" }>, t: number) {
  const fps = scene.fps ?? 4;
  const frame = scene.frames[Math.floor((t * fps) / 1000) % scene.frames.length];
  const colors = Object.fromEntries(Object.entries(scene.palette).map(([key, hex]) => [key, parseHex(hex)]));
  frame.forEach((row, y) => [...row].forEach((ch, x) => colors[ch] && canvas.set(x, y, colors[ch])));
}

/** Renders a scene at t milliseconds after it was set, as 32x32 RGB. */
export function renderScene(scene: AgentScene, t: number): Uint8Array {
  const canvas = new PixelCanvas();
  const time = Math.max(0, t);
  switch (scene.kind) {
    case "mood":
      paintMood(canvas, scene.mood, time);
      break;
    case "status":
      paintStatus(canvas, scene.status, time, scene.label ? 12 : 16);
      if (scene.label) paintLabel(canvas, scene.label, statusColor(scene.status), time);
      break;
    case "text":
      paintText(canvas, scene.text, scene.color ? parseHex(scene.color) : DEFAULT_TEXT_COLOR, time);
      break;
    case "pixels":
      paintPixels(canvas, scene, time);
      break;
  }
  return canvas.rgb;
}
