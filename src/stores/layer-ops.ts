/**
 * Loader-level layer edits used by the editor store. Every function returns a new loader whose
 * activeCells/cellColors are the flattened result of its layers, so every renderer stays unchanged.
 */
import { GridTransform } from "@/lib/grid-transforms";
import {
  createLayer,
  flattenLayers,
  layerFromCells,
  layerPixelAt,
  liftCells,
  mergeLayers,
  offsetLayer,
  paintLayer,
  PatternLayer,
  replaceLayerCells,
  sanitizeLayer,
  transformLayer
} from "@/lib/layers";
import { LoaderComponent } from "@/types/dot-motion";

/** A project keeps this many layers per artboard at most (each is a few KB in browser storage). */
export const MAX_LAYERS = 16;

export type LayerState = { layers: PatternLayer[]; activeId: string };

export const baseLayerId = (loader: LoaderComponent) => `${loader.id}:base`;

/** The loader's layers; a drawing from before layers becomes a single unnamed layer on first use. */
export function layersOf(loader: LoaderComponent): LayerState {
  const existing = loader.pattern.layers;
  if (existing?.length) {
    const activeId = existing.some((layer) => layer.id === loader.pattern.activeLayerId)
      ? (loader.pattern.activeLayerId as string)
      : existing[existing.length - 1].id;
    return { layers: existing, activeId };
  }
  // A fixed id: the panel and the store must agree on this stand-in layer across calls.
  const layer = layerFromCells("", loader.pattern.activeCells, loader.pattern.cellColors, loader.pattern.grid.cols, baseLayerId(loader));
  return { layers: [layer], activeId: layer.id };
}

/** Stores layers on the loader and re-derives the flat drawing from them. */
export function withLayers(loader: LoaderComponent, layers: PatternLayer[], activeId: string): LoaderComponent {
  const { rows, cols } = loader.pattern.grid;
  const flat = flattenLayers(layers, rows, cols);
  const active = layers.some((layer) => layer.id === activeId) ? activeId : layers[layers.length - 1]?.id;
  return {
    ...loader,
    pattern: { ...loader.pattern, layers, activeLayerId: active, activeCells: flat.activeCells, cellColors: flat.cellColors }
  };
}

/**
 * Normalisation after every edit: the flat cells are re-derived from the layers, so they can never
 * disagree. Per-pixel sanitising is costly, so it runs only for stored data (sanitiseStored).
 */
export function syncLayers(loader: LoaderComponent): LoaderComponent {
  const layers = loader.pattern.layers;
  if (!layers?.length) return loader;
  return withLayers(loader, layers.slice(0, MAX_LAYERS), loader.pattern.activeLayerId ?? "");
}

/** Cleans layers read from storage (untrusted): drops malformed layers and pixels. */
export function sanitiseStoredLayers(loader: LoaderComponent): LoaderComponent {
  const stored = loader.pattern.layers;
  if (!stored?.length) return loader;
  const layers = stored.map((layer, index) => sanitizeLayer(layer, index)).filter((layer): layer is PatternLayer => Boolean(layer)).slice(0, MAX_LAYERS);
  if (!layers.length) return { ...loader, pattern: { ...loader.pattern, layers: undefined, activeLayerId: undefined } };
  return { ...loader, pattern: { ...loader.pattern, layers } };
}

function updateLayer(loader: LoaderComponent, layerId: string | null, update: (layer: PatternLayer) => PatternLayer): LoaderComponent {
  const { layers, activeId } = layersOf(loader);
  const targetId = layerId ?? activeId;
  let changed = false;
  const next = layers.map((layer) => {
    if (layer.id !== targetId) return layer;
    const updated = update(layer);
    changed = changed || updated !== layer;
    return updated;
  });
  return changed || !loader.pattern.layers?.length ? withLayers(loader, next, activeId) : loader;
}

/** Colour stored for a paint stroke: the base colour (no override) when it equals the artboard colour. */
export function storedColor(loader: LoaderComponent, color: string | undefined): string | undefined {
  if (color === undefined) return undefined;
  return color.toUpperCase() === loader.style.primaryColor.toUpperCase() ? "" : color.toUpperCase();
}

export function paintCells(loader: LoaderComponent, cells: readonly number[], active: boolean, color?: string): LoaderComponent {
  const { cols } = loader.pattern.grid;
  return updateLayer(loader, null, (layer) => paintLayer(layer, cells, active, cols, storedColor(loader, color)));
}

export function transformActiveLayer(loader: LoaderComponent, op: GridTransform): LoaderComponent {
  const { rows, cols } = loader.pattern.grid;
  return updateLayer(loader, null, (layer) => transformLayer(layer, op, rows, cols));
}

export function moveLayerBy(loader: LoaderComponent, layerId: string, dx: number, dy: number): LoaderComponent {
  return updateLayer(loader, layerId, (layer) => offsetLayer(layer, dx, dy));
}

/** Fills the whole grid on the active layer with the base colour, or empties that layer. */
export function fillActiveLayer(loader: LoaderComponent, filled: boolean): LoaderComponent {
  const { rows, cols } = loader.pattern.grid;
  const all = Array.from({ length: rows * cols }, (_, index) => index);
  return updateLayer(loader, null, (layer) => (filled ? paintLayer(layer, all, true, cols, "") : { ...layer, pixels: {} }));
}

/** Replaces the whole drawing with one layer (pattern presets). */
export function replaceDrawing(loader: LoaderComponent, cells: readonly number[], colors?: Record<string, string>): LoaderComponent {
  const layer = layerFromCells("", cells, colors, loader.pattern.grid.cols);
  return withLayers(loader, [layer], layer.id);
}

/**
 * Puts cells on a layer: replaces the pixels of layerId when the loader has it, otherwise adds a new
 * layer on top and makes it active. Returns the loader and the layer that received the cells.
 */
export function putCellsOnLayer(
  loader: LoaderComponent,
  cells: readonly number[],
  colors: Readonly<Record<string, string>> | undefined,
  target: { layerId?: string; name: string }
): { loader: LoaderComponent; layerId: string | null } {
  const { cols } = loader.pattern.grid;
  const { layers, activeId } = layersOf(loader);
  const stored = colors ? Object.fromEntries(Object.entries(colors).map(([cell, hex]) => [cell, storedColor(loader, hex) || ""]).filter(([, hex]) => hex)) : undefined;
  const existing = layers.find((layer) => layer.id === target.layerId);
  if (existing) {
    // Re-applied pixels keep the layer where you moved it.
    const next = layers.map((layer) => (layer.id === existing.id ? { ...replaceLayerCells(layer, cells, stored, cols), offsetX: layer.offsetX, offsetY: layer.offsetY } : layer));
    return { loader: withLayers(loader, next, activeId), layerId: existing.id };
  }
  // At the layer limit nothing is added (never drop an existing layer to make room).
  if (layers.length >= MAX_LAYERS) return { loader, layerId: null };
  const layer = layerFromCells(target.name, cells, stored, cols);
  return { loader: withLayers(loader, [...layers, layer], layer.id), layerId: layer.id };
}

/** Adds a layer with pixels in grid coordinates (may lie off the grid) on top and makes it active. */
export function addLayerWithPixels(loader: LoaderComponent, name: string, pixels: Readonly<Record<string, string>>): { loader: LoaderComponent; layerId: string | null } {
  const { layers } = layersOf(loader);
  if (layers.length >= MAX_LAYERS) return { loader, layerId: null };
  const stored = Object.fromEntries(Object.entries(pixels).map(([key, color]) => [key, storedColor(loader, color || undefined) ?? ""]));
  const layer = createLayer(name, stored);
  return { loader: withLayers(loader, [...layers, layer], layer.id), layerId: layer.id };
}

export function addEmptyLayer(loader: LoaderComponent, name: string): LoaderComponent {
  const { layers } = layersOf(loader);
  if (layers.length >= MAX_LAYERS) return loader;
  const layer = createLayer(name);
  return withLayers(loader, [...layers, layer], layer.id);
}

export function duplicateLayer(loader: LoaderComponent, layerId: string, name: string): LoaderComponent {
  const { layers } = layersOf(loader);
  const index = layers.findIndex((layer) => layer.id === layerId);
  if (index < 0 || layers.length >= MAX_LAYERS) return loader;
  const copy = { ...createLayer(name), visible: layers[index].visible, offsetX: layers[index].offsetX, offsetY: layers[index].offsetY, pixels: { ...layers[index].pixels } };
  return withLayers(loader, [...layers.slice(0, index + 1), copy, ...layers.slice(index + 1)], copy.id);
}

/** Deletes a layer; the last remaining layer is emptied instead, so there is always one to draw on. */
export function deleteLayer(loader: LoaderComponent, layerId: string): LoaderComponent {
  const { layers, activeId } = layersOf(loader);
  const index = layers.findIndex((layer) => layer.id === layerId);
  if (index < 0) return loader;
  if (layers.length === 1) return withLayers(loader, [{ ...layers[0], pixels: {}, offsetX: 0, offsetY: 0 }], layers[0].id);
  const next = layers.filter((layer) => layer.id !== layerId);
  const nextActive = layerId === activeId ? next[Math.max(0, index - 1)].id : activeId;
  return withLayers(loader, next, nextActive);
}

export function selectLayer(loader: LoaderComponent, layerId: string): LoaderComponent {
  const { layers } = layersOf(loader);
  return layers.some((layer) => layer.id === layerId) ? withLayers(loader, layers, layerId) : loader;
}

export function setLayerVisible(loader: LoaderComponent, layerId: string, visible: boolean): LoaderComponent {
  return updateLayer(loader, layerId, (layer) => (layer.visible === visible ? layer : { ...layer, visible }));
}

export function renameLayer(loader: LoaderComponent, layerId: string, name: string): LoaderComponent {
  const trimmed = name.trim().slice(0, 40);
  return updateLayer(loader, layerId, (layer) => (layer.name === trimmed ? layer : { ...layer, name: trimmed }));
}

/** Moves a layer one step up (towards the top, +1) or down (-1) in the stack. */
export function reorderLayer(loader: LoaderComponent, layerId: string, direction: 1 | -1): LoaderComponent {
  const { layers, activeId } = layersOf(loader);
  const index = layers.findIndex((layer) => layer.id === layerId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= layers.length) return loader;
  const next = [...layers];
  [next[index], next[target]] = [next[target], next[index]];
  return withLayers(loader, next, activeId);
}

/** Merges a layer into the one below it (the lower layer keeps its name and stays active). */
export function mergeLayerDown(loader: LoaderComponent, layerId: string): LoaderComponent {
  const { layers } = layersOf(loader);
  const index = layers.findIndex((layer) => layer.id === layerId);
  if (index <= 0) return loader;
  const merged = mergeLayers(layers[index - 1], layers[index]);
  return withLayers(loader, [...layers.slice(0, index - 1), merged, ...layers.slice(index + 1)], merged.id);
}

/**
 * Moves the active layer's pixels under the given cells to a new layer right above it, so the
 * selection can be moved without disturbing the rest. Returns the new layer id (null if nothing to lift).
 */
export function liftToLayer(loader: LoaderComponent, cells: readonly number[], name: string): { loader: LoaderComponent; layerId: string | null } {
  const { layers, activeId } = layersOf(loader);
  if (layers.length >= MAX_LAYERS) return { loader, layerId: null };
  const { cols } = loader.pattern.grid;
  const hasPixelsIn = (layer: PatternLayer) => cells.some((cell) => layerPixelAt(layer, cell, cols) !== undefined);
  // Move what you see: the active layer if it has pixels in the box, else the topmost visible one that does.
  const activeIndex = layers.findIndex((layer) => layer.id === activeId);
  const fallback = layers.map((layer, i) => i).reverse().find((i) => layers[i].visible && hasPixelsIn(layers[i]));
  const index = hasPixelsIn(layers[activeIndex]) ? activeIndex : fallback ?? activeIndex;
  const { rest, lifted: raw } = liftCells(layers[index], cells, cols, name);
  if (!Object.keys(raw.pixels).length) return { loader, layerId: null };
  const lifted = { ...raw, visible: layers[index].visible };
  const next = [...layers.slice(0, index), rest, lifted, ...layers.slice(index + 1)];
  return { loader: withLayers(loader, next, lifted.id), layerId: lifted.id };
}
