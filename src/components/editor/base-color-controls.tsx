"use client";

import { Language } from "@/lib/ui-copy";
import { useEditorStore } from "@/stores/use-editor-store";
import { LoaderComponent } from "@/types/dot-motion";
import { Button } from "@/toolcraft/ui/components/primitives/button";
import { ColorControl } from "@/toolcraft/ui/components/controls/color/color-control";
import { SliderControl } from "@/toolcraft/ui/components/controls/slider/slider-control";

const copy = {
  cn: {
    baseColor: "默认颜色",
    baseHint: "没有单独上色的点都用这个颜色，改它会一起变（用和它相同的画笔颜色画的笔画也算）。",
    brightness: "整体亮度",
    unify: "全部统一成默认颜色",
    unifyHint: "清掉所有单独上的颜色，整幅画都改用默认颜色",
    hasOverrides: (count: number) => `${count} 个点有单独的颜色`
  },
  en: {
    baseColor: "Base colour",
    baseHint: "Every cell without its own colour uses this one, and follows when you change it (including strokes painted in this same colour).",
    brightness: "Overall brightness",
    unify: "Use Base Colour Everywhere",
    unifyHint: "Clears every per-cell colour so the whole drawing uses the base colour",
    hasOverrides: (count: number) => `${count} cells have their own colour`
  }
} as const;

type BaseColorControlsProps = {
  language: Language;
  loader: LoaderComponent;
};

/** The artboard's base colour, its overall brightness, and a reset of per-cell colours to it. */
export function BaseColorControls({ language, loader }: BaseColorControlsProps) {
  const t = copy[language];
  const setPrimaryColor = useEditorStore((state) => state.setPrimaryColor);
  const setPrimaryAlpha = useEditorStore((state) => state.setPrimaryAlpha);
  const applyBaseColorEverywhere = useEditorStore((state) => state.applyBaseColorEverywhere);
  const overrides = Object.keys(loader.pattern.cellColors ?? {}).length;

  return (
    <>
      <ColorControl showLabel name={t.baseColor} hex={loader.style.primaryColor} onValueChange={({ hex }) => setPrimaryColor(hex)} />
      <span className="image-import__hint">{t.baseHint}</span>
      <SliderControl
        showFill
        name={t.brightness}
        min={0}
        max={100}
        step={1}
        unit="%"
        baseValue={100}
        value={Math.round((loader.style.primaryAlpha ?? 1) * 100)}
        onValueChange={(value) => setPrimaryAlpha(value / 100)}
      />
      <div className="image-import">
        <Button type="button" variant="outline" size="default" disabled={!overrides} title={t.unifyHint} onClick={() => applyBaseColorEverywhere()}>
          {t.unify}
        </Button>
        <span className="image-import__hint">{overrides ? t.hasOverrides(overrides) : t.unifyHint}</span>
      </div>
    </>
  );
}
