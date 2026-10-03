"use client";

import { useEffect, useState } from "react";
import { onSaveResult } from "@/lib/persistence";
import { Language } from "@/lib/ui-copy";

const copy = {
  cn: "保存失败：浏览器存储空间满了，刚才的修改只在当前窗口里。删掉几个画板、序列帧或图库图片后会自动恢复保存。",
  en: "Saving failed: browser storage is full, so recent edits exist only in this window. Delete some artboards, sequence frames or library drawings and saving resumes."
} as const;

/** Tells you when the project could not be saved, instead of losing edits silently on the next start. */
export function SaveStatusBanner({ language }: { language: Language }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => onSaveResult((ok) => setFailed(!ok)), []);
  if (!failed) return null;
  return (
    <div className="save-status-banner" role="alert">
      {copy[language]}
    </div>
  );
}
