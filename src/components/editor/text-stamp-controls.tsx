"use client";

import { useState } from "react";
import type { TextFont } from "@/lib/text-cells";
import { Language } from "@/lib/ui-copy";
import { useDrawStore } from "@/stores/use-draw-store";
import { useEditorStore } from "@/stores/use-editor-store";
import { LoaderComponent } from "@/types/dot-motion";
import { Button } from "@/toolcraft/ui/components/primitives/button";
import { SegmentedControl } from "@/toolcraft/ui/components/controls/segmented/segmented-control";

const MAX_TEXT_LENGTH = 200;

const copy = {
  cn: {
    label: "文字",
    placeholder: "输入文字，回车换行",
    font: "字体", large: "10px 中文", small: "3×5 小字（英文数字）",
    stamp: "写到画布",
    hint: "用画笔颜色写在画面中间，可以再用方向键挪位置",
    failed: "文字渲染失败"
  },
  en: {
    label: "Text",
    placeholder: "Type text; Enter for a new line",
    font: "Font", large: "10px (Chinese)", small: "3×5 small (Latin, digits)",
    stamp: "Write on Canvas",
    hint: "Written in the brush colour, centred; nudge it with the arrow keys",
    failed: "Could not render the text"
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
  const [failed, setFailed] = useState(false);
  const setCellsActiveForLoader = useEditorStore((state) => state.setCellsActiveForLoader);
  const brushChoice = useDrawStore((state) => state.brushChoice);
  const rememberColor = useDrawStore((state) => state.rememberColor);

  async function stamp() {
    try {
      // The Chinese font is ~170 KB, so it loads only when text is first written.
      const { textToCells } = await import("@/lib/text-cells");
      const { rows, cols } = loader.pattern.grid;
      const cells = textToCells(text, rows, cols, font);
      const color = brushChoice ?? loader.style.primaryColor;
      if (cells.length) {
        setCellsActiveForLoader(loader.id, cells, true, color);
        rememberColor(color);
      }
      setFailed(false);
    } catch (error) {
      console.warn("[editor] text stamp failed", error);
      setFailed(true);
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
      <div className="image-import">
        <Button type="button" variant="outline" size="default" disabled={!text.trim()} onClick={() => void stamp()}>{t.stamp}</Button>
        <span className="image-import__hint">{failed ? t.failed : t.hint}</span>
      </div>
    </div>
  );
}
