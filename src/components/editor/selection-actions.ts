/**
 * Copy, cut, paste and delete for the selection box, shared by the keyboard shortcuts and the panel
 * buttons. They read the stores directly, so they can run from any event handler.
 */
import { GridTransform } from "@/lib/grid-transforms";
import { cellsInBox, layerPixelAt } from "@/lib/layers";
import { layersOf } from "@/stores/layer-ops";
import { SelectionBox, useDrawStore } from "@/stores/use-draw-store";
import { useEditorStore } from "@/stores/use-editor-store";

function selectedLoaderFor(selection: SelectionBox | null) {
  if (!selection) return null;
  const loader = useEditorStore.getState().project.loaders.find((item) => item.id === selection.loaderId);
  return loader ?? null;
}

/** The selection box, if it is on the selected artboard (the one keyboard shortcuts act on). */
export function activePixelSelection(): SelectionBox | null {
  const { selection } = useDrawStore.getState();
  return selection && selection.loaderId === useEditorStore.getState().selectedLoaderId ? selection : null;
}

const NUDGE_STEPS: Partial<Record<GridTransform, [number, number]>> = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };

/**
 * Arrow keys and the move buttons: with a selection they move its contents, otherwise they move,
 * flip or rotate the active layer.
 */
export function nudgeDrawing(loaderId: string, op: GridTransform) {
  const step = NUDGE_STEPS[op];
  if (activePixelSelection()) {
    // With a box, arrows only ever move the box and its contents, never the whole layer.
    if (step) {
      moveSelection(step[0], step[1], "");
      return;
    }
    // Flips and rotations act on the layer; the box would no longer match what it covers.
    useDrawStore.getState().setSelection(null);
  }
  useEditorStore.getState().transformLoaderCells(loaderId, op);
}

function selectionCells(selection: SelectionBox, rows: number, cols: number) {
  return cellsInBox(selection, rows, cols);
}

/**
 * Copies the active layer's pixels inside the selection, with real colours (cut removes exactly these,
 * so cut and paste round-trip). False if there is no selection on the selected artboard.
 */
export function copySelection(): boolean {
  const selection = activePixelSelection();
  const { setPixelClipboard } = useDrawStore.getState();
  const loader = selectedLoaderFor(selection);
  if (!selection || !loader) return false;
  const { rows, cols } = loader.pattern.grid;
  const { layers, activeId } = layersOf(loader);
  const layer = layers.find((item) => item.id === activeId);
  if (!layer) return false;
  const base = loader.style.primaryColor.toUpperCase();
  const pixels = selectionCells(selection, rows, cols).flatMap((cell) => {
    const color = layerPixelAt(layer, cell, cols);
    return color === undefined ? [] : [{ x: (cell % cols) - selection.x0, y: Math.floor(cell / cols) - selection.y0, color: color || base }];
  });
  setPixelClipboard({ pixels, x0: selection.x0, y0: selection.y0 });
  return true;
}

/** Clears the selection's cells on the active layer. */
export function deleteSelection(): boolean {
  const selection = activePixelSelection();
  const loader = selectedLoaderFor(selection);
  if (!selection || !loader) return false;
  const { rows, cols } = loader.pattern.grid;
  useEditorStore.getState().setCellsActiveForLoader(loader.id, selectionCells(selection, rows, cols), false);
  return true;
}

export function cutSelection(): boolean {
  return copySelection() && deleteSelection();
}

/**
 * Pastes copied pixels as a new layer on the selected artboard, at the place they were copied from,
 * and selects them so they can be dragged or nudged into place.
 */
export function pasteSelection(layerName: string): boolean {
  const { pixelClipboard, setSelection, setFloatingLayer } = useDrawStore.getState();
  const editor = useEditorStore.getState();
  const loaderId = editor.selectedLoaderId;
  if (!pixelClipboard || !loaderId) return false;
  const pixels = Object.fromEntries(pixelClipboard.pixels.map(({ x, y, color }) => [`${pixelClipboard.x0 + x},${pixelClipboard.y0 + y}`, color]));
  const layerId = editor.addLayerFromPixels(loaderId, layerName, pixels);
  if (!layerId) return false;
  const xs = pixelClipboard.pixels.map(({ x }) => x), ys = pixelClipboard.pixels.map(({ y }) => y);
  if (xs.length) {
    setSelection({
      loaderId,
      x0: pixelClipboard.x0 + Math.min(...xs),
      y0: pixelClipboard.y0 + Math.min(...ys),
      x1: pixelClipboard.x0 + Math.max(...xs),
      y1: pixelClipboard.y0 + Math.max(...ys)
    });
    setFloatingLayer(layerId);
  }
  return true;
}

/**
 * Moves the selection's contents by whole cells: the first move lifts them off the active layer into
 * their own layer, later moves just shift that layer (nothing is lost at the grid edge).
 */
export function moveSelection(dx: number, dy: number, liftedLayerName: string): boolean {
  const draw = useDrawStore.getState();
  const box = activePixelSelection();
  const loader = selectedLoaderFor(box);
  if (!box || !loader || (!dx && !dy)) return false;
  const editor = useEditorStore.getState();
  let floating = draw.floatingLayerId;
  const stillThere = floating && loader.pattern.layers?.some((layer) => layer.id === floating);
  if (!stillThere) {
    const { rows, cols } = loader.pattern.grid;
    floating = editor.liftToLayer(loader.id, selectionCells(box, rows, cols), liftedLayerName);
  }
  // Nothing on the active layer under the box (or no room for another layer): just move the box.
  if (floating) editor.moveLayerBy(loader.id, floating, dx, dy);
  useDrawStore.setState({
    selection: { ...box, x0: box.x0 + dx, x1: box.x1 + dx, y0: box.y0 + dy, y1: box.y1 + dy },
    floatingLayerId: floating ?? null
  });
  return true;
}
