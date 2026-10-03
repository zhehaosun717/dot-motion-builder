"use client";

import { useRef, useState } from "react";
import {
  DEFAULT_IMPORT_OPTIONS,
  IMPORT_COLOR_CHOICES,
  ImportedRaster,
  ImportFit,
  ImportOptions,
  MAX_IMPORT_FRAMES,
  pixelsToCells,
  rasterizeImageFile
} from "@/lib/image-import";
import { Language } from "@/lib/ui-copy";
import { useEditorStore } from "@/stores/use-editor-store";
import { LoaderComponent } from "@/types/dot-motion";
import { Button } from "@/toolcraft/ui/components/primitives/button";
import { SwitchControl } from "@/toolcraft/ui/components/controls/boolean/boolean-controls";
import { SegmentedControl } from "@/toolcraft/ui/components/controls/segmented/segmented-control";
import { SelectControl } from "@/toolcraft/ui/components/controls/select/select-control";
import { SliderControl } from "@/toolcraft/ui/components/controls/slider/slider-control";

const MAX_BLACK_CUT = 50;

const copy = {
  cn: {
    importImage: "导入图片 / GIF",
    importHint: `按当前网格缩放，32×32 时一格一像素；动图会变成序列帧（最多 ${MAX_IMPORT_FRAMES} 帧）`,
    importFailed: "图片读取失败，换一张试试",
    importing: "正在读取…",
    fit: "适配方式", contain: "完整显示", cover: "铺满裁切",
    blackCut: "暗部截断（更暗的像素不亮）",
    colors: "颜色数", allColors: "不限",
    dither: "抖动（减色时保留渐变）",
    adjusting: (name: string) => `正在调整「${name}」：改上面的选项会重新套用`,
    done: "完成"
  },
  en: {
    importImage: "Import Image / GIF",
    importHint: `Scaled to the grid (one pixel per cell at 32×32); animations become sequence frames (up to ${MAX_IMPORT_FRAMES})`,
    importFailed: "Could not read that image",
    importing: "Reading…",
    fit: "Fit", contain: "Whole picture", cover: "Fill & crop",
    blackCut: "Black cut (darker pixels stay off)",
    colors: "Colours", allColors: "All",
    dither: "Dither (keeps gradients when reducing colours)",
    adjusting: (name: string) => `Adjusting "${name}": changing the options above re-applies it`,
    done: "Done"
  }
} as const;

/** Where the last import landed: one layer per artboard (one for a picture, one per GIF frame). */
type ImportTarget = { loaderId: string; layerId: string };
type LastImport = { file: File; targets: ImportTarget[] };
type RasterCache = { file: File; rows: number; cols: number; fit: ImportFit; raster: ImportedRaster };

type ImageImportControlsProps = {
  language: Language;
  loader: LoaderComponent;
};

/**
 * Imports a picture or animated GIF into the grid. The options stay live for the last import, so the
 * black cut, colour count and dithering can be tuned while watching the canvas (or the panel).
 */
export function ImageImportControls({ language, loader }: ImageImportControlsProps) {
  const t = copy[language];
  const importCellsForLoader = useEditorStore((state) => state.importCellsForLoader);
  const importCellsForLoaders = useEditorStore((state) => state.importCellsForLoaders);
  const importSequence = useEditorStore((state) => state.importSequence);
  const setMotionPreset = useEditorStore((state) => state.setMotionPreset);
  const [options, setOptions] = useState<ImportOptions>(DEFAULT_IMPORT_OPTIONS);
  // Read when a slow first import finishes, so options changed while it loaded still apply.
  const optionsRef = useRef(options);
  const [lastImport, setLastImport] = useState<LastImport | null>(null);
  const [status, setStatus] = useState<"idle" | "busy" | "failed">("idle");
  const inputRef = useRef<HTMLInputElement>(null);
  const cacheRef = useRef<RasterCache | null>(null);
  const requestRef = useRef(0);

  async function rasterFor(file: File, rows: number, cols: number, fit: ImportFit) {
    const cached = cacheRef.current;
    if (cached && cached.file === file && cached.rows === rows && cached.cols === cols && cached.fit === fit) return cached.raster;
    const raster = await rasterizeImageFile(file, rows, cols, fit);
    cacheRef.current = { file, rows, cols, fit, raster };
    return raster;
  }

  /** First import adds a layer (or a frame sequence); later runs re-apply onto the same layers. */
  async function run(file: File, previous: ImportTarget[] | null) {
    const request = ++requestRef.current;
    const loaders = useEditorStore.getState().project.loaders;
    const targets = previous?.filter(({ loaderId, layerId }) => loaders.some((item) => item.id === loaderId && item.pattern.layers?.some((layer) => layer.id === layerId))) ?? [];
    if (previous && targets.length !== previous.length) {
      // Some imported artboards were deleted or undone: never re-apply onto whatever is selected now.
      setLastImport(null);
      return;
    }
    const gridSource = loaders.find((item) => item.id === targets[0]?.loaderId) ?? loader;
    const { rows, cols } = gridSource.pattern.grid;
    setStatus("busy");
    try {
      let fit = optionsRef.current.fit;
      let raster = await rasterFor(file, rows, cols, fit);
      // The fit may have been changed while a first import was still decoding.
      while (fit !== optionsRef.current.fit) {
        fit = optionsRef.current.fit;
        raster = await rasterFor(file, rows, cols, fit);
      }
      if (request !== requestRef.current) return; // a newer change superseded this one
      const nextOptions = optionsRef.current;
      const frames = raster.frames.map((frame) => pixelsToCells(frame, rows, cols, nextOptions));
      if (previous && targets.length === frames.length) {
        importCellsForLoaders(targets.map((target, index) => ({ ...target, ...frames[index] })));
      } else if (previous) {
        setLastImport(null);
      } else if (frames.length > 1) {
        setLastImport({ file, targets: importSequence(gridSource.id, frames, raster.fps) });
      } else {
        // A picture lands on its own new layer, so it never replaces what is already drawn.
        const layerId = importCellsForLoader(gridSource.id, frames[0].cells, frames[0].colors, { name: file.name.replace(/\.[^.]+$/, "") });
        // Show the picture as is; only if that artboard is still the one selected after decoding.
        if (useEditorStore.getState().selectedLoaderId === gridSource.id) setMotionPreset("static");
        setLastImport({ file, targets: [{ loaderId: gridSource.id, layerId }] });
      }
      setStatus("idle");
    } catch (error) {
      console.warn("[editor] image import failed", error);
      if (request === requestRef.current) setStatus("failed");
    }
  }

  function changeOptions(patch: Partial<ImportOptions>) {
    const next = { ...optionsRef.current, ...patch };
    optionsRef.current = next;
    setOptions(next);
    if (lastImport) void run(lastImport.file, lastImport.targets);
  }

  const hint = status === "busy" ? t.importing : status === "failed" ? t.importFailed : t.importHint;

  return (
    <div className="image-import-controls">
      <div className="image-import">
        <Button type="button" variant="outline" size="default" onClick={() => inputRef.current?.click()}>
          {t.importImage}
        </Button>
        <span className="image-import__hint">{hint}</span>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void run(file, null);
          }}
        />
      </div>
      <SegmentedControl
        ariaLabel={t.fit}
        name={t.fit}
        value={options.fit}
        options={[{ value: "contain", label: t.contain }, { value: "cover", label: t.cover }]}
        onValueChange={(value) => changeOptions({ fit: value === "cover" ? "cover" : "contain" })}
      />
      <SliderControl showFill name={t.blackCut} min={0} max={MAX_BLACK_CUT} step={1} unit="%" baseValue={DEFAULT_IMPORT_OPTIONS.blackCut} value={options.blackCut} onValueChange={(value) => changeOptions({ blackCut: value })} />
      <SelectControl
        name={t.colors}
        value={String(options.colors)}
        options={IMPORT_COLOR_CHOICES.map((count) => ({ value: String(count), label: count === 0 ? t.allColors : String(count) }))}
        onValueChange={(value) => changeOptions({ colors: Number(value) })}
      />
      {options.colors > 0 ? <SwitchControl checked={options.dither} name={t.dither} onCheckedChange={(value) => changeOptions({ dither: value })} /> : null}
      {lastImport ? (
        <div className="image-import">
          <span className="image-import__hint">{t.adjusting(lastImport.file.name)}</span>
          <Button type="button" variant="outline" size="default" onClick={() => setLastImport(null)}>{t.done}</Button>
        </div>
      ) : null}
    </div>
  );
}
