"use client";

import { isNeutralTuning, NEUTRAL_PANEL_TUNING, PANEL_TUNING_KEYS, PANEL_TUNING_RANGES, PanelTuningKey } from "@/lib/idotmatrix/panel-tuning";
import { Language } from "@/lib/ui-copy";
import { useMatrixStore } from "@/stores/use-matrix-store";
import { Button } from "@/toolcraft/ui/components/primitives/button";
import { PanelSection } from "@/toolcraft/ui/components/panel/panel-section";
import { SliderControl } from "@/toolcraft/ui/components/controls/slider/slider-control";

const tuningCopy = {
  cn: {
    title: "点阵屏色彩",
    collapse: "收起点阵屏色彩",
    expand: "展开点阵屏色彩",
    hint: "只作用于发到屏幕的画面（实时同步、投屏、存到屏幕），编辑器和导出文件不变。开着实时同步拖动滑块，对照电脑屏幕调。照片可先试伽马 1.8–2.2。",
    reset: "恢复默认",
    brightness: "亮度",
    contrast: "对比度",
    saturation: "饱和度",
    gamma: "伽马（中间调）",
    warmth: "色温（冷 ↔ 暖）"
  },
  en: {
    title: "Panel Colour",
    collapse: "Collapse panel colour",
    expand: "Expand panel colour",
    hint: "Only affects what is sent to the panel (live sync, mirroring, Save to Panel); the editor and exported files stay as they are. Turn on live sync and compare against your monitor. For photos, try gamma 1.8–2.2.",
    reset: "Reset",
    brightness: "Brightness",
    contrast: "Contrast",
    saturation: "Saturation",
    gamma: "Gamma (midtones)",
    warmth: "Warmth (cool ↔ warm)"
  }
} as const;

const UNITS: Record<PanelTuningKey, string | undefined> = {
  brightness: "%",
  contrast: "%",
  saturation: "%",
  gamma: undefined,
  warmth: undefined
};

type PanelTuningSectionProps = {
  language: Language;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
};

/** Sliders that colour-correct the LED panel so it matches the monitor; stored per browser/app. */
export function PanelTuningSection({ language, collapsed, onCollapsedChange }: PanelTuningSectionProps) {
  const tuning = useMatrixStore((state) => state.tuning);
  const setTuning = useMatrixStore((state) => state.setTuning);
  const copy = tuningCopy[language];

  return (
    <PanelSection
      title={copy.title}
      collapsible
      collapsed={collapsed}
      collapseLabel={copy.collapse}
      expandLabel={copy.expand}
      onCollapsedChange={onCollapsedChange}
    >
      <div className="toolcraft-control-stack">
        {PANEL_TUNING_KEYS.map((key) => {
          const { min, max, step, neutral } = PANEL_TUNING_RANGES[key];
          return (
            <SliderControl
              key={key}
              showFill
              name={copy[key]}
              min={min}
              max={max}
              step={step}
              baseValue={neutral}
              unit={UNITS[key]}
              value={tuning[key]}
              valueLabel={key === "gamma" ? tuning.gamma.toFixed(1) : undefined}
              onValueChange={(value) => setTuning({ [key]: value })}
            />
          );
        })}
        <div className="image-import">
          <Button type="button" variant="outline" size="default" disabled={isNeutralTuning(tuning)} onClick={() => setTuning(NEUTRAL_PANEL_TUNING)}>
            {copy.reset}
          </Button>
          <span className="image-import__hint">{copy.hint}</span>
        </div>
      </div>
    </PanelSection>
  );
}
