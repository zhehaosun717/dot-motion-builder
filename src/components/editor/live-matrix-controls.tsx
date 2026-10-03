"use client";

import { useEffect, useState } from "react";
import { getDesktopBridge } from "@/lib/desktop-bridge";
import { buildMatrixGif } from "@/lib/idotmatrix/build-gif";
import { describeMatrixStatus, matrixCopy } from "@/lib/idotmatrix/matrix-copy";
import { isWebBluetoothAvailable } from "@/lib/idotmatrix/web-bluetooth";
import { Language } from "@/lib/ui-copy";
import { useEditorStore, useSelectedLoader } from "@/stores/use-editor-store";
import { useMatrixStore } from "@/stores/use-matrix-store";
import { Button } from "@/toolcraft/ui/components/primitives/button";

type LiveMatrixControlsProps = {
  language: Language;
};

/** Top-bar entry to the panel: connect, then toggle live editor sync or screen mirroring. */
export function LiveMatrixControls({ language }: LiveMatrixControlsProps) {
  const link = useMatrixStore((state) => state.link);
  const live = useMatrixStore((state) => state.live);
  const status = useMatrixStore((state) => state.status);
  const connect = useMatrixStore((state) => state.connect);
  const setLive = useMatrixStore((state) => state.setLive);
  const disconnect = useMatrixStore((state) => state.disconnect);
  const agentEnabled = useMatrixStore((state) => state.agentEnabled);
  const setAgentEnabled = useMatrixStore((state) => state.setAgentEnabled);
  const sendGif = useMatrixStore((state) => state.sendGif);
  const project = useEditorStore((state) => state.project);
  const loader = useSelectedLoader();
  const [supported, setSupported] = useState(false);
  const [desktop, setDesktop] = useState(false);
  const copy = matrixCopy[language];

  // navigator only exists in the browser; checking after mount keeps server and client markup equal.
  useEffect(() => {
    setSupported(isWebBluetoothAvailable());
    setDesktop(Boolean(getDesktopBridge()));
  }, []);
  if (!supported) return null;

  const busy = status.kind === "connecting" || status.kind === "picking" || status.kind === "uploading";
  const statusText = describeMatrixStatus(status, link?.name ?? null, language);

  /** Stores the animation being edited in the panel's own memory as a looping GIF. */
  function saveToPanel() {
    const { showInactive, pixelGaps } = useMatrixStore.getState();
    void sendGif(buildMatrixGif(project, loader, { showInactive, gaps: pixelGaps }).gif);
  }

  if (!link) {
    return (
      <Button type="button" className="toolbar-button" variant="outline" size="default" disabled={busy} title={statusText} onClick={() => void connect()}>
        {copy.connectPanel}
      </Button>
    );
  }

  return (
    <>
      {desktop ? (
        <Button
          type="button"
          className={`toolbar-button${agentEnabled ? " is-live" : ""}`}
          variant="outline"
          size="default"
          disabled={busy}
          title={statusText}
          aria-pressed={agentEnabled}
          onClick={() => setAgentEnabled(!agentEnabled)}
        >
          {copy.agentDisplay}
        </Button>
      ) : null}
      <Button
        type="button"
        className={`toolbar-button${live === "editor" ? " is-live" : ""}`}
        variant="outline"
        size="default"
        disabled={busy}
        title={statusText}
        aria-pressed={live === "editor"}
        onClick={() => void setLive(live === "editor" ? "off" : "editor")}
      >
        {live === "editor" ? copy.liveEditorStop : copy.liveEditor}
      </Button>
      <Button
        type="button"
        className={`toolbar-button${live === "screen" ? " is-live" : ""}`}
        variant="outline"
        size="default"
        disabled={busy}
        title={statusText}
        aria-pressed={live === "screen"}
        onClick={() => void setLive(live === "screen" ? "off" : "screen")}
      >
        {live === "screen" ? copy.liveScreenStop : copy.liveScreen}
      </Button>
      <Button type="button" className="toolbar-button" variant="outline" size="default" disabled={busy} title={statusText} onClick={saveToPanel}>
        {copy.saveToPanel}
      </Button>
      <Button type="button" className="toolbar-button" variant="outline" size="default" disabled={busy} title={statusText} onClick={disconnect}>
        {copy.disconnect}
      </Button>
    </>
  );
}
