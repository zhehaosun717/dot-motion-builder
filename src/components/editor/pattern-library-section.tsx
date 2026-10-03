"use client";

import { useEffect, useRef } from "react";
import { Language } from "@/lib/ui-copy";
import { useEditorStore } from "@/stores/use-editor-store";
import { PatternSnapshot } from "@/types/dot-motion";
import { Button } from "@/toolcraft/ui/components/primitives/button";
import { PanelSection } from "@/toolcraft/ui/components/panel/panel-section";

/** Each saved drawing is a few KB in the browser's ~5 MB project storage; this keeps well clear of the limit. */
export const MAX_SAVED_PATTERNS = 48;
const UNLIT = "#1B222B";
const FALLBACK_LIT = "#66BDFF";

const copy = {
  cn: {
    title: "图库",
    collapse: "收起图库",
    expand: "展开图库",
    save: "保存当前画面",
    full: `图库已满（${MAX_SAVED_PATTERNS} 张），先删掉几张`,
    empty: "保存的画面（含每格颜色）会出现在这里，点一下就能载入当前画板。",
    load: "载入",
    remove: "删除"
  },
  en: {
    title: "Library",
    collapse: "Collapse library",
    expand: "Expand library",
    save: "Save Current Drawing",
    full: `The library is full (${MAX_SAVED_PATTERNS}); delete a few first`,
    empty: "Saved drawings (with their colours) appear here; click one to load it into the current artboard.",
    load: "Load",
    remove: "Delete"
  }
} as const;

/** A tiny pixel-exact preview of a saved drawing. */
function PatternThumbnail({ pattern }: { pattern: PatternSnapshot }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rows = pattern.rows ?? 32, cols = pattern.cols ?? 32;

  useEffect(() => {
    const context = canvasRef.current?.getContext("2d");
    if (!context) return;
    context.fillStyle = UNLIT;
    context.fillRect(0, 0, cols, rows);
    for (const cell of pattern.activeCells) {
      context.fillStyle = pattern.cellColors?.[cell] ?? FALLBACK_LIT;
      context.fillRect(cell % cols, Math.floor(cell / cols), 1, 1);
    }
  }, [cols, pattern, rows]);

  return <canvas ref={canvasRef} width={cols} height={rows} className="pattern-library__thumb" />;
}

type PatternLibrarySectionProps = {
  language: Language;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
};

/** Saves drawings (with per-cell colours) to the project and loads them back into any artboard. */
export function PatternLibrarySection({ language, collapsed, onCollapsedChange }: PatternLibrarySectionProps) {
  const t = copy[language];
  const patterns = useEditorStore((state) => state.project.assets.patterns);
  const savePatternToLibrary = useEditorStore((state) => state.savePatternToLibrary);
  const applySavedPattern = useEditorStore((state) => state.applySavedPattern);
  const deleteSavedPattern = useEditorStore((state) => state.deleteSavedPattern);
  const full = patterns.length >= MAX_SAVED_PATTERNS;

  return (
    <PanelSection title={t.title} collapsible collapsed={collapsed} collapseLabel={t.collapse} expandLabel={t.expand} onCollapsedChange={onCollapsedChange}>
      <div className="toolcraft-control-stack">
        <div className="image-import">
          <Button type="button" variant="outline" size="default" disabled={full} onClick={savePatternToLibrary}>{t.save}</Button>
          <span className="image-import__hint">{full ? t.full : patterns.length ? `${patterns.length} / ${MAX_SAVED_PATTERNS}` : t.empty}</span>
        </div>
        {patterns.length ? (
          <ul className="pattern-library">
            {patterns.map((pattern) => (
              <li key={pattern.id} className="pattern-library__item">
                <button type="button" className="pattern-library__load" title={`${t.load} ${pattern.name ?? ""}`} aria-label={`${t.load} ${pattern.name ?? ""}`} onClick={() => applySavedPattern(pattern.id)}>
                  <PatternThumbnail pattern={pattern} />
                </button>
                <button type="button" className="pattern-library__delete" title={t.remove} aria-label={`${t.remove} ${pattern.name ?? ""}`} onClick={() => deleteSavedPattern(pattern.id)}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </PanelSection>
  );
}
