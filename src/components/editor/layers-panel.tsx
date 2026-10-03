"use client";

import { useState } from "react";
import { Language } from "@/lib/ui-copy";
import { layersOf, MAX_LAYERS } from "@/stores/layer-ops";
import { useDrawStore } from "@/stores/use-draw-store";
import { useEditorStore } from "@/stores/use-editor-store";
import { LoaderComponent } from "@/types/dot-motion";
import { Button } from "@/toolcraft/ui/components/primitives/button";

const copy = {
  cn: {
    title: "图层",
    layer: (n: number) => `图层 ${n}`,
    copyName: (name: string) => `${name} 副本`,
    add: "新建", duplicate: "复制", remove: "删除", up: "上移", down: "下移", merge: "向下合并",
    show: "显示", hide: "隐藏", rename: "双击改名",
    hint: "画笔、橡皮、填充、方向键和翻转只作用于选中的图层；导入的图片和文字各自是一个图层。",
    full: `最多 ${MAX_LAYERS} 个图层`
  },
  en: {
    title: "Layers",
    layer: (n: number) => `Layer ${n}`,
    copyName: (name: string) => `${name} copy`,
    add: "New", duplicate: "Duplicate", remove: "Delete", up: "Up", down: "Down", merge: "Merge Down",
    show: "Show", hide: "Hide", rename: "Double-click to rename",
    hint: "Brush, eraser, fill, arrow keys and flips act on the selected layer; imported images and text each get their own layer.",
    full: `Up to ${MAX_LAYERS} layers`
  }
} as const;

type LayersPanelProps = {
  language: Language;
  loader: LoaderComponent;
};

/** The layer stack of the selected artboard, top layer first. */
export function LayersPanel({ language, loader }: LayersPanelProps) {
  const t = copy[language];
  const { layers, activeId } = layersOf(loader);
  const editor = useEditorStore.getState();
  const [renaming, setRenaming] = useState<string | null>(null);
  const displayName = (index: number) => layers[index].name || t.layer(index + 1);
  const activeIndex = layers.findIndex((layer) => layer.id === activeId);
  const full = layers.length >= MAX_LAYERS;
  // Layer edits end a lifted selection: the moved pixels stay on their own layer.
  const act = (run: () => void) => () => {
    useDrawStore.getState().setFloatingLayer(null);
    run();
  };

  return (
    <div className="layers-panel">
      <ul className="layers-panel__list" aria-label={t.title}>
        {layers.map((layer, index) => index).reverse().map((index) => {
          const layer = layers[index];
          const active = layer.id === activeId;
          return (
            <li key={layer.id} className={`layers-panel__row${active ? " is-active" : ""}${layer.visible ? "" : " is-hidden"}`}>
              <button
                type="button"
                className="layers-panel__eye"
                aria-label={`${layer.visible ? t.hide : t.show} ${displayName(index)}`}
                title={layer.visible ? t.hide : t.show}
                onClick={act(() => editor.setLayerVisible(loader.id, layer.id, !layer.visible))}
              >
                {layer.visible ? "●" : "○"}
              </button>
              {renaming === layer.id ? (
                <input
                  className="layers-panel__rename"
                  autoFocus
                  defaultValue={layer.name}
                  maxLength={40}
                  aria-label={t.rename}
                  onBlur={(event) => {
                    editor.renameLayer(loader.id, layer.id, event.currentTarget.value);
                    setRenaming(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                    if (event.key === "Escape") setRenaming(null);
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="layers-panel__name"
                  title={t.rename}
                  aria-pressed={active}
                  onClick={act(() => editor.selectLayer(loader.id, layer.id))}
                  onDoubleClick={() => setRenaming(layer.id)}
                >
                  {displayName(index)}
                  <span className="layers-panel__count">{Object.keys(layer.pixels).length}</span>
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <div className="draw-button-row">
        <Button type="button" variant="outline" size="default" disabled={full} onClick={act(() => editor.addLayer(loader.id, ""))}>{t.add}</Button>
        <Button type="button" variant="outline" size="default" disabled={full || activeIndex < 0} onClick={act(() => editor.duplicateLayer(loader.id, activeId, t.copyName(displayName(activeIndex))))}>{t.duplicate}</Button>
        <Button type="button" variant="outline" size="default" onClick={act(() => editor.deleteLayer(loader.id, activeId))}>{t.remove}</Button>
        <Button type="button" variant="outline" size="default" disabled={activeIndex >= layers.length - 1} onClick={act(() => editor.reorderLayer(loader.id, activeId, 1))}>{t.up}</Button>
        <Button type="button" variant="outline" size="default" disabled={activeIndex <= 0} onClick={act(() => editor.reorderLayer(loader.id, activeId, -1))}>{t.down}</Button>
        <Button type="button" variant="outline" size="default" disabled={activeIndex <= 0} onClick={act(() => editor.mergeLayerDown(loader.id, activeId))}>{t.merge}</Button>
      </div>
      <span className="image-import__hint">{full ? t.full : t.hint}</span>
    </div>
  );
}
