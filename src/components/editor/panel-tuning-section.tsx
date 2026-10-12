"use client";

import { DEFAULT_PANEL_TUNING, PANEL_TUNING_KEYS, PANEL_TUNING_RANGES, PanelTuning, PanelTuningKey } from "@/lib/idotmatrix/panel-tuning";
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
    hint: "只作用于发到屏幕的画面（实时同步、投屏、存到屏幕），编辑器和导出文件不变。「实测校准」用色度计实测这块屏（IDM-0384DA）的数据，把颜色、白点和明暗换算成和电脑屏幕一致，默认 100%；调到 0 是原来没校准的效果。其余滑块在校准之上微调：屋里很亮、暗点看不清时调高「暗部起亮」；红 / 绿 / 蓝单独调每个通道。",
    reset: "恢复默认",
    calibration: "实测校准",
    brightness: "亮度",
    contrast: "对比度",
    saturation: "饱和度",
    gamma: "伽马（中间调）",
    warmth: "色温（冷 ↔ 暖）",
    floor: "暗部起亮（最低亮度）",
    redGain: "红",
    greenGain: "绿",
    blueGain: "蓝"
  },
  en: {
    title: "Panel Colour",
    collapse: "Collapse panel colour",
    expand: "Expand panel colour",
    hint: "Only affects what is sent to the panel (live sync, mirroring, Save to Panel); the editor and exported files stay as they are. Measured calibration uses colorimeter data from this panel (IDM-0384DA) to match colours, white point and tones to your monitor; 100% by default, 0 gives the old uncalibrated look. The other sliders fine-tune on top: raise Dark floor if faint dots get lost in a bright room; Red / Green / Blue trim each channel.",
    reset: "Reset",
    calibration: "Measured calibration",
    brightness: "Brightness",
    contrast: "Contrast",
    saturation: "Saturation",
    gamma: "Gamma (midtones)",
    warmth: "Warmth (cool ↔ warm)",
    floor: "Dark floor (lowest level)",
    redGain: "Red",
    greenGain: "Green",
    blueGain: "Blue"
  }
} as const;

const UNITS: Record<PanelTuningKey, string | undefined> = {
  calibration: "%",
  brightness: "%",
  contrast: "%",
  saturation: "%",
  gamma: undefined,
  warmth: undefined,
  floor: undefined,
  redGain: "%",
  greenGain: "%",
  blueGain: "%"
};

const isDefaultTuning = (tuning: PanelTuning) => PANEL_TUNING_KEYS.every((key) => tuning[key] === DEFAULT_PANEL_TUNING[key]);

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
          <Button type="button" variant="outline" size="default" disabled={isDefaultTuning(tuning)} onClick={() => setTuning(DEFAULT_PANEL_TUNING)}>
            {copy.reset}
          </Button>
          <span className="image-import__hint">{copy.hint}</span>
        </div>
      </div>
    </PanelSection>
  );
}
