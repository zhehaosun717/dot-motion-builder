"use client";

import { useEffect } from "react";
import { parseScene } from "@/lib/agent-display/scene";
import { getDesktopBridge } from "@/lib/desktop-bridge";
import { useMatrixStore } from "@/stores/use-matrix-store";

type AutoConnectWindow = Window & { __matrixAutoConnect?: () => void };

/**
 * Inside the desktop app: turns on the agent display, shows scenes that agents post to the local API,
 * reports panel state to the tray, and lets the main process (re)connect the panel without a click.
 * Does nothing in a normal browser.
 */
export function useDesktopBridge() {
  useEffect(() => {
    const bridge = getDesktopBridge();
    if (!bridge) return;
    const store = useMatrixStore;
    store.getState().setAgentEnabled(true);

    // Called by the main process with a synthetic user gesture, which Web Bluetooth requires.
    const target = window as AutoConnectWindow;
    target.__matrixAutoConnect = () => {
      const state = store.getState();
      if (!state.link && state.status.kind !== "connecting") void state.connect();
    };

    const offScene = bridge.onScene((raw) => {
      try {
        store.getState().showAgentScene(parseScene(raw));
      } catch (error) {
        console.warn("[desktop] ignored invalid agent scene", error);
      }
    });

    const report = (state = store.getState()) => bridge.reportState({
      connected: Boolean(state.link),
      deviceName: state.link?.name ?? null,
      live: state.live,
      status: state.status.kind,
      scene: state.agentScene
    });
    report();
    const unsubscribe = store.subscribe((state, previous) => {
      report(state);
      const linkLost = Boolean(previous.link) && !state.link && state.lastDisconnect === "lost";
      const attemptFailed = previous.status.kind === "connecting" && !state.link;
      if ((linkLost || attemptFailed) && state.lastDisconnect !== "manual") bridge.requestReconnect();
    });
    bridge.ready();

    return () => {
      offScene();
      unsubscribe();
      delete target.__matrixAutoConnect;
    };
  }, []);
}
