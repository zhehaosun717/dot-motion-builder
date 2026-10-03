/**
 * Answers AI agents' editor requests (relayed by the desktop app from its local API): read the selected
 * artboard, or draw artwork as a new layer, a new artboard or a frame sequence. Every drawing is one
 * undoable edit the user can keep working on.
 */
import { artworkCells, artworkPixels, drawingToArtwork, editorDrawSchema } from "@/lib/agent-editor";
import { useEditorStore } from "@/stores/use-editor-store";

const DEFAULT_SEQUENCE_FPS = 6;

function selectedLoader() {
  const { project, selectedLoaderId } = useEditorStore.getState();
  return project.loaders.find((loader) => loader.id === selectedLoaderId) ?? project.loaders[0];
}

export function handleEditorRequest(request: { action: string; payload?: unknown }): unknown {
  if (request.action === "get-drawing") {
    const loader = selectedLoader();
    if (!loader) throw new Error("There is no artboard in the editor.");
    return drawingToArtwork(loader);
  }
  if (request.action !== "draw") throw new Error(`unknown editor action "${request.action}"`);

  const draw = editorDrawSchema.parse(request.payload);
  const editor = useEditorStore.getState();
  const base = selectedLoader();
  if (!base) throw new Error("There is no artboard in the editor.");
  const name = draw.name?.trim() || "AI";

  if (draw.frames.length > 1) {
    const { rows, cols } = base.pattern.grid;
    const frames = draw.frames.map((frame) => artworkCells(frame, draw.palette, rows, cols, draw.x, draw.y));
    const created = editor.importSequence(base.id, frames, draw.fps ?? DEFAULT_SEQUENCE_FPS);
    return { created: "sequence", frames: created.length, grid: `${cols}x${rows}` };
  }

  let loaderId = base.id;
  if (draw.target === "artboard") {
    editor.addLoader("custom");
    loaderId = useEditorStore.getState().selectedLoaderId;
    // A picture should show as drawn, not animated by the default preset.
    useEditorStore.getState().setMotionPreset("static");
    useEditorStore.getState().renameLoader(name);
  }
  const pixels = artworkPixels(draw.frames[0], draw.palette, draw.x, draw.y);
  const layerId = useEditorStore.getState().addLayerFromPixels(loaderId, name, pixels);
  if (!layerId) throw new Error("That artboard already has the maximum number of layers; delete or merge some first.");
  const loader = useEditorStore.getState().project.loaders.find((item) => item.id === loaderId);
  return {
    created: draw.target === "artboard" ? "artboard" : "layer",
    layer: name,
    pixels: Object.keys(pixels).length,
    grid: loader ? `${loader.pattern.grid.cols}x${loader.pattern.grid.rows}` : undefined
  };
}
