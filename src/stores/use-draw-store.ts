"use client";

import { create } from "zustand";
import { normalizeHexColor } from "@/lib/colors";
import { DrawTool } from "@/lib/grid-tools";

export type Symmetry = "none" | "x" | "y" | "xy";
export const SYMMETRIES: readonly Symmetry[] = ["none", "x", "y", "xy"];
/** A selection box in grid coordinates (inclusive) on one artboard. */
export type SelectionBox = { loaderId: string; x0: number; y0: number; x1: number; y1: number };
/** Copied pixels with their real colours, by position relative to the copied box's top-left corner. */
export type PixelClipboard = { pixels: Array<{ x: number; y: number; color: string }>; x0: number; y0: number };

const RECENT_LIMIT = 12;
const RECENT_STORAGE_KEY = "dot-matrix-recent-colors";
const HEX = /^#[0-9A-F]{6}$/;

type DrawState = {
  tool: DrawTool;
  /** The tool the eyedropper returns to after a pick. */
  previousTool: DrawTool;
  /** null = paint with the artboard's base colour (no per-cell override), so changing that recolours it. */
  brushChoice: string | null;
  fillTolerance: number;
  /** Fill only the connected area (true) or every matching cell in the drawing (false). */
  fillContiguous: boolean;
  /** Rectangles and ellipses are solid; holding Shift while dragging draws the other kind. */
  shapeFilled: boolean;
  /** Most recent first. */
  recentColors: string[];
  /** Mirror every stroke, shape and fill left-right (x), top-bottom (y) or both. */
  symmetry: Symmetry;
  selection: SelectionBox | null;
  /** The layer holding a lifted selection while it is being moved (so it is lifted only once). */
  floatingLayerId: string | null;
  pixelClipboard: PixelClipboard | null;
  /** What Ctrl+V pastes: the last thing copied, pixels or a whole artboard. */
  lastCopy: "pixels" | "artboard" | null;
  setTool: (tool: DrawTool) => void;
  setBrushColor: (hex: string) => void;
  setFillTolerance: (value: number) => void;
  setFillContiguous: (value: boolean) => void;
  setShapeFilled: (value: boolean) => void;
  /** Records a colour that was just painted with (shown as a swatch). */
  rememberColor: (hex: string) => void;
  setSymmetry: (value: Symmetry) => void;
  setSelection: (selection: SelectionBox | null) => void;
  setFloatingLayer: (layerId: string | null) => void;
  setPixelClipboard: (clipboard: PixelClipboard) => void;
  setLastCopy: (kind: "pixels" | "artboard") => void;
};

function loadRecent(): string[] {
  try {
    const stored = typeof window === "undefined" ? null : window.localStorage.getItem(RECENT_STORAGE_KEY);
    const parsed: unknown = stored ? JSON.parse(stored) : [];
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string" && HEX.test(value)).slice(0, RECENT_LIMIT) : [];
  } catch (error) {
    console.warn("[editor] ignoring unreadable recent colours", error);
    return [];
  }
}

function saveRecent(colors: string[]) {
  try {
    window.localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(colors));
  } catch (error) {
    console.warn("[editor] could not save recent colours", error);
  }
}

/** Drawing-tool settings shared by the side panel, the canvas and the keyboard shortcuts. */
export const useDrawStore = create<DrawState>((set, get) => ({
  tool: "brush",
  previousTool: "brush",
  brushChoice: null,
  fillTolerance: 0,
  fillContiguous: true,
  shapeFilled: true,
  recentColors: loadRecent(),
  symmetry: "none",
  selection: null,
  floatingLayerId: null,
  pixelClipboard: null,
  lastCopy: null,
  setTool: (tool) => {
    const current = get().tool;
    if (tool === current) return;
    set({ tool, previousTool: current === "pick" ? get().previousTool : current });
  },
  setBrushColor: (hex) => set({ brushChoice: normalizeHexColor(hex) }),
  setFillTolerance: (value) => set({ fillTolerance: value }),
  setFillContiguous: (value) => set({ fillContiguous: value }),
  setShapeFilled: (value) => set({ shapeFilled: value }),
  rememberColor: (hex) => {
    const color = normalizeHexColor(hex);
    const current = get().recentColors;
    if (current[0] === color) return;
    const recentColors = [color, ...current.filter((value) => value !== color)].slice(0, RECENT_LIMIT);
    set({ recentColors });
    saveRecent(recentColors);
  },
  setSymmetry: (value) => set({ symmetry: value }),
  // A new or cleared selection is no longer the lifted one being moved.
  setSelection: (selection) => set({ selection, ...(selection ? {} : { floatingLayerId: null }) }),
  setFloatingLayer: (layerId) => set({ floatingLayerId: layerId }),
  setPixelClipboard: (clipboard) => set({ pixelClipboard: clipboard, lastCopy: "pixels" }),
  setLastCopy: (kind) => set({ lastCopy: kind })
}));
