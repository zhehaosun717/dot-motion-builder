/**
 * Copy, cut, paste and delete for the selection box, shared by the keyboard shortcuts and the panel
 * buttons. They read the stores directly, so they can run from any event handler.
 */
import { GridTransform } from "@/lib/grid-transforms";
import { cellsInBox } from "@/lib/layers";
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
  if (step && activePixelSelection() && moveSelection(step[0], step[1], "")) return;
  useEditorStore.getState().transformLoaderCells(loaderId, op);
}

function selectionCells(selection: SelectionBox, rows: number, cols: number) {
  return cellsInBox(selection, rows, cols);
}

/** Copies what is visible inside the selection (all layers), with real colours. False if nothing selected. */
export function copySelection(): boolean {
  const { selection, setPixelClipboard } = useDrawStore.getState();
  const loader = selectedLoaderFor(selection);
  if (!selection || !loader) return false;
  const { rows, cols } = loader.pattern.grid;
  const lit = new Set(loader.pattern.activeCells);
  const base = loader.style.primaryColor.toUpperCase();
  const pixels = selectionCells(selection, rows, cols)
    .filter((cell) => lit.has(cell))
    .map((cell) => ({ x: (cell % cols) - selection.x0, y: Math.floor(cell / cols) - selection.y0, color: loader.pattern.cellColors?.[cell] ?? base }));
  setPixelClipboard({ pixels, x0: selection.x0, y0: selection.y0 });
  return true;
}

/** Clears the selection's cells on the active layer. */
export function deleteSelection(): boolean {
  const { selection } = useDrawStore.getState();
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
  const loader = selectedLoaderFor(draw.selection);
  if (!draw.selection || !loader || (!dx && !dy)) return false;
  const editor = useEditorStore.getState();
  let floating = draw.floatingLayerId;
  const stillThere = floating && loader.pattern.layers?.some((layer) => layer.id === floating);
  if (!stillThere) {
    const { rows, cols } = loader.pattern.grid;
    floating = editor.liftToLayer(loader.id, selectionCells(draw.selection, rows, cols), liftedLayerName);
    if (!floating) return false;
    draw.setFloatingLayer(floating);
  }
  editor.moveLayerBy(loader.id, floating as string, dx, dy);
  const box = draw.selection;
  useDrawStore.setState({ selection: { ...box, x0: box.x0 + dx, x1: box.x1 + dx, y0: box.y0 + dy, y1: box.y1 + dy } });
  return true;
}
