"use client";

import { DrawTool, isShapeTool, MAX_FILL_TOLERANCE } from "@/lib/grid-tools";
import { GridTransform } from "@/lib/grid-transforms";
import { Language } from "@/lib/ui-copy";
import { redo, undo, useHistoryStore } from "@/stores/editor-history";
import { copySelection, cutSelection, deleteSelection, nudgeDrawing, pasteSelection } from "@/components/editor/selection-actions";
import { Symmetry, SYMMETRIES, useDrawStore } from "@/stores/use-draw-store";
import { useEditorStore } from "@/stores/use-editor-store";
import { LoaderComponent } from "@/types/dot-motion";
import { Button } from "@/toolcraft/ui/components/primitives/button";
import { SwitchControl } from "@/toolcraft/ui/components/controls/boolean/boolean-controls";
import { ColorControl } from "@/toolcraft/ui/components/controls/color/color-control";
import { SegmentedControl } from "@/toolcraft/ui/components/controls/segmented/segmented-control";
import { SliderControl } from "@/toolcraft/ui/components/controls/slider/slider-control";

/** Single-key shortcuts for the drawing tools (ignored while typing). */
export const DRAW_TOOL_KEYS: Record<string, DrawTool> = { b: "brush", e: "erase", g: "fill", i: "pick", m: "select", l: "line", r: "rect", o: "ellipse" };

const PAINT_TOOLS: readonly DrawTool[] = ["brush", "erase", "fill", "pick", "select"];
const SHAPE_TOOL_LIST: readonly DrawTool[] = ["line", "rect", "ellipse"];

const copy = {
  cn: {
    tools: "绘制工具", shapes: "形状",
    brush: "画笔 B", erase: "橡皮 E", fill: "填充 G", pick: "吸管 I", select: "选区 M", line: "直线 L", rect: "矩形 R", ellipse: "圆 O",
    symmetry: "对称绘制", symNone: "关", symX: "左右", symY: "上下", symXY: "四向",
    selectHint: "拖动框选；在选区里拖动可以移动内容（移出画面也不会丢）。Ctrl+C / X / V 复制、剪切、粘贴，Delete 清除，Esc 取消。",
    copy: "复制", cut: "剪切", paste: "粘贴", clear: "清除", deselect: "取消选区", pasted: "粘贴",
    brushColor: "画笔颜色（Alt+点击格子吸色）", recent: "最近用过",
    fillTolerance: "填充容差", fillContiguous: "只填相连区域（关掉 = 全图替换同色）",
    shapeFilled: "实心（拖动时按住 Shift 反转）",
    undo: "撤销", redo: "重做", undoHint: "Ctrl+Z / Ctrl+Y",
    transform: "移动当前图层（方向键也可；有选区时移动选区）",
    left: "左移", right: "右移", up: "上移", down: "下移",
    "flip-h": "水平翻转", "flip-v": "垂直翻转", "rotate-cw": "顺时针旋转", "rotate-ccw": "逆时针旋转"
  },
  en: {
    tools: "Draw tool", shapes: "Shapes",
    brush: "Brush B", erase: "Erase E", fill: "Fill G", pick: "Pick I", select: "Select M", line: "Line L", rect: "Rect R", ellipse: "Circle O",
    symmetry: "Symmetry", symNone: "Off", symX: "Left-right", symY: "Top-bottom", symXY: "Both",
    selectHint: "Drag to select; drag inside the box to move its contents (nothing is lost off the edge). Ctrl+C / X / V copy, cut, paste; Delete clears; Esc deselects.",
    copy: "Copy", cut: "Cut", paste: "Paste", clear: "Clear", deselect: "Deselect", pasted: "Pasted",
    brushColor: "Brush colour (Alt+click picks)", recent: "Recent",
    fillTolerance: "Fill tolerance", fillContiguous: "Connected area only (off = replace everywhere)",
    shapeFilled: "Solid (hold Shift while dragging for the other)",
    undo: "Undo", redo: "Redo", undoHint: "Ctrl+Z / Ctrl+Y",
    transform: "Move the layer (arrow keys too; moves the selection when there is one)",
    left: "Left", right: "Right", up: "Up", down: "Down",
    "flip-h": "Flip horizontal", "flip-v": "Flip vertical", "rotate-cw": "Rotate clockwise", "rotate-ccw": "Rotate counter-clockwise"
  }
} as const;

const TRANSFORM_BUTTONS: ReadonlyArray<{ op: GridTransform; glyph: string }> = [
  { op: "left", glyph: "←" },
  { op: "right", glyph: "→" },
  { op: "up", glyph: "↑" },
  { op: "down", glyph: "↓" },
  { op: "flip-h", glyph: "⇋" },
  { op: "flip-v", glyph: "⇵" },
  { op: "rotate-cw", glyph: "↻" },
  { op: "rotate-ccw", glyph: "↺" }
];

type DrawingToolsProps = {
  language: Language;
  loader: LoaderComponent;
};

/** Tool choice, brush colour, per-tool options, history and whole-drawing moves for the Grid section. */
export function DrawingTools({ language, loader }: DrawingToolsProps) {
  const t = copy[language];
  const tool = useDrawStore((state) => state.tool);
  const setTool = useDrawStore((state) => state.setTool);
  const brushChoice = useDrawStore((state) => state.brushChoice);
  const setBrushColor = useDrawStore((state) => state.setBrushColor);
  const recentColors = useDrawStore((state) => state.recentColors);
  const fillTolerance = useDrawStore((state) => state.fillTolerance);
  const setFillTolerance = useDrawStore((state) => state.setFillTolerance);
  const fillContiguous = useDrawStore((state) => state.fillContiguous);
  const setFillContiguous = useDrawStore((state) => state.setFillContiguous);
  const shapeFilled = useDrawStore((state) => state.shapeFilled);
  const setShapeFilled = useDrawStore((state) => state.setShapeFilled);
  const symmetry = useDrawStore((state) => state.symmetry);
  const setSymmetry = useDrawStore((state) => state.setSymmetry);
  const selection = useDrawStore((state) => (state.selection?.loaderId === loader.id ? state.selection : null));
  const setSelection = useDrawStore((state) => state.setSelection);
  const hasClipboard = useDrawStore((state) => Boolean(state.pixelClipboard?.pixels.length));
  const canUndo = useHistoryStore((state) => state.canUndo);
  const canRedo = useHistoryStore((state) => state.canRedo);
  const brushHex = brushChoice ?? loader.style.primaryColor;
  const pickTool = (value: string) => setTool(value as DrawTool);

  return (
    <>
      <div className="draw-button-row">
        <Button type="button" variant="outline" size="default" disabled={!canUndo} onClick={undo}>{t.undo}</Button>
        <Button type="button" variant="outline" size="default" disabled={!canRedo} onClick={redo}>{t.redo}</Button>
        <span className="image-import__hint">{t.undoHint}</span>
      </div>
      <SegmentedControl
        ariaLabel={t.tools}
        name={t.tools}
        value={PAINT_TOOLS.includes(tool) ? tool : ""}
        options={PAINT_TOOLS.map((value) => ({ value, label: t[value as keyof typeof t] }))}
        onValueChange={pickTool}
      />
      <SegmentedControl
        ariaLabel={t.shapes}
        name={t.shapes}
        value={SHAPE_TOOL_LIST.includes(tool) ? tool : ""}
        options={SHAPE_TOOL_LIST.map((value) => ({ value, label: t[value as keyof typeof t] }))}
        onValueChange={pickTool}
      />
      <SegmentedControl
        ariaLabel={t.symmetry}
        name={t.symmetry}
        value={symmetry}
        options={SYMMETRIES.map((value) => ({ value, label: { none: t.symNone, x: t.symX, y: t.symY, xy: t.symXY }[value] }))}
        onValueChange={(value) => setSymmetry(value as Symmetry)}
      />
      {tool === "select" ? (
        <div className="draw-transform">
          <span className="image-import__hint">{t.selectHint}</span>
          <div className="draw-button-row">
            <Button type="button" variant="outline" size="default" disabled={!selection} onClick={copySelection}>{t.copy}</Button>
            <Button type="button" variant="outline" size="default" disabled={!selection} onClick={cutSelection}>{t.cut}</Button>
            <Button type="button" variant="outline" size="default" disabled={!hasClipboard} onClick={() => pasteSelection(t.pasted)}>{t.paste}</Button>
            <Button type="button" variant="outline" size="default" disabled={!selection} onClick={deleteSelection}>{t.clear}</Button>
            <Button type="button" variant="outline" size="default" disabled={!selection} onClick={() => setSelection(null)}>{t.deselect}</Button>
          </div>
        </div>
      ) : null}
      <ColorControl showLabel name={t.brushColor} hex={brushHex} onValueChange={({ hex }) => setBrushColor(hex)} />
      {recentColors.length ? (
        <div className="draw-swatches" role="group" aria-label={t.recent}>
          {recentColors.map((hex) => (
            <button
              key={hex}
              type="button"
              className={`draw-swatch${hex === brushHex.toUpperCase() ? " is-current" : ""}`}
              style={{ background: hex }}
              title={hex}
              aria-label={`${t.recent} ${hex}`}
              onClick={() => setBrushColor(hex)}
            />
          ))}
        </div>
      ) : null}
      {tool === "fill" ? (
        <>
          <SliderControl showFill name={t.fillTolerance} min={0} max={MAX_FILL_TOLERANCE} step={1} unit="%" value={fillTolerance} onValueChange={setFillTolerance} />
          <SwitchControl checked={fillContiguous} name={t.fillContiguous} onCheckedChange={setFillContiguous} />
        </>
      ) : null}
      {isShapeTool(tool) && tool !== "line" ? (
        <SwitchControl checked={shapeFilled} name={t.shapeFilled} onCheckedChange={setShapeFilled} />
      ) : null}
      <div className="draw-transform">
        <span className="image-import__hint">{t.transform}</span>
        <div className="draw-button-row">
          {TRANSFORM_BUTTONS.map(({ op, glyph }) => (
            <Button
              key={op}
              type="button"
              variant="outline"
              size="default"
              className="draw-icon-button"
              title={t[op]}
              aria-label={t[op]}
              onClick={() => nudgeDrawing(loader.id, op)}
            >
              {glyph}
            </Button>
          ))}
        </div>
      </div>
    </>
  );
}
