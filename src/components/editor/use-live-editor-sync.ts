"use client";

import { useEffect, useMemo } from "react";
import { backgroundSleep } from "@/lib/idotmatrix/background-timer";
import { renderMatrixFrames, renderMatrixStill } from "@/lib/idotmatrix/render-frames";
import { useMatrixStore } from "@/stores/use-matrix-store";
import { LoaderComponent, Project } from "@/types/dot-motion";

/**
 * While live sync is on, mirrors the loader being edited onto the panel: the drawn pattern after
 * every edit, or the animation (up to ~20 fps) while the canvas preview plays.
 */
export function useLiveEditorSync(project: Project, loader: LoaderComponent | undefined, animate: boolean) {
  const live = useMatrixStore((state) => state.live);
  const showInactive = useMatrixStore((state) => state.showInactive);
  const pushFrame = useMatrixStore((state) => state.pushFrame);
  const active = live === "editor" && Boolean(loader);

  const animation = useMemo(
    () => (active && animate && loader ? renderMatrixFrames(project, loader, { showInactive }) : null),
    [active, animate, loader, project, showInactive]
  );

  useEffect(() => {
    if (!active || animate || !loader) return;
    pushFrame(renderMatrixStill(loader, { showInactive }));
  }, [active, animate, loader, pushFrame, showInactive]);

  useEffect(() => {
    if (!animation || animation.frames.length === 0) return;
    let running = true;
    // Background timers keep the panel animating while this window is covered.
    void (async () => {
      for (let index = 0; running; index = (index + 1) % animation.frames.length) {
        pushFrame(animation.frames[index]);
        await backgroundSleep((animation.delaysCs[index] ?? 10) * 10);
      }
    })();
    return () => { running = false; };
  }, [animation, pushFrame]);
}
