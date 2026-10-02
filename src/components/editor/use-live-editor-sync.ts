"use client";

import { useEffect } from "react";
import { renderMatrixAt, renderMatrixStill } from "@/lib/idotmatrix/render-frames";
import { useMatrixStore } from "@/stores/use-matrix-store";
import { LoaderComponent, Project } from "@/types/dot-motion";

/**
 * While live sync is on, mirrors the loader being edited onto the panel: the drawn pattern after
 * every edit, or — while the canvas preview plays — the animation sampled at the moment each frame
 * will light up, so motion keeps real-time pace however many frames the link manages.
 */
export function useLiveEditorSync(project: Project, loader: LoaderComponent | undefined, animate: boolean) {
  const live = useMatrixStore((state) => state.live);
  const showInactive = useMatrixStore((state) => state.showInactive);
  const pushFrame = useMatrixStore((state) => state.pushFrame);
  const playFrames = useMatrixStore((state) => state.playFrames);
  const active = live === "editor" && Boolean(loader);

  useEffect(() => {
    if (!active || animate || !loader) return;
    pushFrame(renderMatrixStill(loader, { showInactive }));
  }, [active, animate, loader, pushFrame, showInactive]);

  useEffect(() => {
    if (!active || !animate || !loader) return;
    const startedAt = Date.now();
    playFrames((displayAt) => renderMatrixAt(project, loader, displayAt - startedAt, { showInactive }));
    return () => playFrames(null);
  }, [active, animate, loader, playFrames, project, showInactive]);
}
