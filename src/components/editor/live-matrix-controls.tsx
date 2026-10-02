"use client";

import { useEffect, useState } from "react";
import { describeMatrixStatus, matrixCopy } from "@/lib/idotmatrix/matrix-copy";
import { isWebBluetoothAvailable } from "@/lib/idotmatrix/web-bluetooth";
import { Language } from "@/lib/ui-copy";
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
  const [supported, setSupported] = useState(false);
  const copy = matrixCopy[language];

  // navigator only exists in the browser; checking after mount keeps server and client markup equal.
  useEffect(() => setSupported(isWebBluetoothAvailable()), []);
  if (!supported) return null;

  const busy = status.kind === "connecting" || status.kind === "picking" || status.kind === "uploading";
  const statusText = describeMatrixStatus(status, link?.name ?? null, language);

  if (!link) {
    return (
      <Button type="button" className="toolbar-button" variant="outline" size="default" disabled={busy} title={statusText} onClick={() => void connect()}>
        {copy.connectPanel}
      </Button>
    );
  }

  return (
    <>
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
    </>
  );
}
