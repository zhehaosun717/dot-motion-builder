"use client";

import { useState } from "react";
import { MAX_TEXT_SCALE, type TextFont } from "@/lib/text-cells";
import { Language } from "@/lib/ui-copy";
import { useDrawStore } from "@/stores/use-draw-store";
import { useEditorStore } from "@/stores/use-editor-store";
import { LoaderComponent } from "@/types/dot-motion";
import { Button } from "@/toolcraft/ui/components/primitives/button";
import { SegmentedControl } from "@/toolcraft/ui/components/controls/segmented/segmented-control";
import { SliderControl } from "@/toolcraft/ui/components/controls/slider/slider-control";

const MAX_TEXT_LENGTH = 200;

const copy = {
  cn: {
    label: "文字",
    placeholder: "输入文字，回车换行",
    font: "字体", large: "10px 中文", small: "3×5 小字（英文数字）", scale: "字号（放大倍数）",
    stamp: "写到画布",
    hint: "用画笔颜色写在画面中间，单独成一个图层，可以用方向键挪位置",
    failed: "文字渲染失败",
    full: "这个画板的图层已满（16 个），先删除或合并几个图层"
  },
  en: {
    label: "Text",
    placeholder: "Type text; Enter for a new line",
    font: "Font", large: "10px (Chinese)", small: "3×5 small (Latin, digits)", scale: "Size (enlargement)",
    stamp: "Write on Canvas",
    hint: "Written in the brush colour, centred, on its own layer; nudge it with the arrow keys",
    failed: "Could not render the text",
    full: "This artboard has the maximum 16 layers; delete or merge some first"
  }
} as const;

type TextStampControlsProps = {
  language: Language;
  loader: LoaderComponent;
};

/** Writes text onto the drawing with the app's built-in pixel fonts (the same ones agents use). */
export function TextStampControls({ language, loader }: TextStampControlsProps) {
  const t = copy[language];
  const [text, setText] = useState("");
  const [font, setFont] = useState<TextFont>("large");
  const [scale, setScale] = useState(1);
  const maxScale = MAX_TEXT_SCALE[font];
  const effectiveScale = Math.min(scale, maxScale);
  const [problem, setProblem] = useState<"failed" | "full" | null>(null);
  const importCellsForLoader = useEditorStore((state) => state.importCellsForLoader);
  const brushChoice = useDrawStore((state) => state.brushChoice);
  const rememberColor = useDrawStore((state) => state.rememberColor);

  async function stamp() {
    try {
      // The Chinese font is ~170 KB, so it loads only when text is first written.
      const { textToCells } = await import("@/lib/text-cells");
      const { rows, cols } = loader.pattern.grid;
      const cells = textToCells(text, rows, cols, font, effectiveScale);
      const color = brushChoice ?? loader.style.primaryColor;
      if (cells.length) {
        // Each text goes on its own layer named after it, so it can be moved or deleted on its own.
        const colors = Object.fromEntries(cells.map((cell) => [cell, color]));
        const layerId = importCellsForLoader(loader.id, cells, colors, { name: text.trim().replace(/\s+/g, " ").slice(0, 20) });
        if (!layerId) {
          setProblem("full");
          return;
        }
        rememberColor(color);
      }
      setProblem(null);
    } catch (error) {
      console.warn("[editor] text stamp failed", error);
      setProblem("failed");
    }
  }

  return (
    <div className="text-stamp">
      <label className="text-stamp__label" htmlFor="text-stamp-input">{t.label}</label>
      <textarea
        id="text-stamp-input"
        className="text-stamp__input"
        rows={2}
        maxLength={MAX_TEXT_LENGTH}
        placeholder={t.placeholder}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <SegmentedControl
        ariaLabel={t.font}
        name={t.font}
        value={font}
        options={[{ value: "large", label: t.large }, { value: "small", label: t.small }]}
        onValueChange={(value) => setFont(value === "small" ? "small" : "large")}
      />
      <SliderControl
        showFill
        variant="discrete"
        markerCount={maxScale}
        name={t.scale}
        min={1}
        max={maxScale}
        step={1}
        unit="×"
        value={effectiveScale}
        onValueChange={setScale}
      />
      <div className="image-import">
        <Button type="button" variant="outline" size="default" disabled={!text.trim()} onClick={() => void stamp()}>{t.stamp}</Button>
        <span className="image-import__hint">{problem ? t[problem] : t.hint}</span>
      </div>
    </div>
  );
}
