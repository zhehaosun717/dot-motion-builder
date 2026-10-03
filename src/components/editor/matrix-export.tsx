"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { MatrixPreview } from "@/components/editor/matrix-preview";
import { buildMatrixGif } from "@/lib/idotmatrix/build-gif";
import { GIF_BUDGET_BYTES } from "@/lib/idotmatrix/constants";
import { describeMatrixStatus, matrixCopy } from "@/lib/idotmatrix/matrix-copy";
import { isWebBluetoothAvailable } from "@/lib/idotmatrix/web-bluetooth";
import { sanitizeName } from "@/lib/exporters/utils";
import { Language } from "@/lib/ui-copy";
import { useEditorStore, useSelectedLoader } from "@/stores/use-editor-store";
import { useMatrixStore } from "@/stores/use-matrix-store";
import { Button } from "@/toolcraft/ui/components/primitives/button";
import { SwitchControl } from "@/toolcraft/ui/components/controls/boolean/boolean-controls";

type MatrixExportProps = {
  language: Language;
  onDownload: (blob: Blob, filename: string) => void;
};

export function MatrixExport({ language, onDownload }: MatrixExportProps) {
  const project = useEditorStore((state) => state.project);
  const loader = useSelectedLoader();
  const link = useMatrixStore((state) => state.link);
  const status = useMatrixStore((state) => state.status);
  const sendGif = useMatrixStore((state) => state.sendGif);
  const disconnect = useMatrixStore((state) => state.disconnect);
  const showInactive = useMatrixStore((state) => state.showInactive);
  const setShowInactive = useMatrixStore((state) => state.setShowInactive);
  const gaps = useMatrixStore((state) => state.pixelGaps);
  const setGaps = useMatrixStore((state) => state.setPixelGaps);
  const [supported, setSupported] = useState(true);
  const copy = matrixCopy[language];

  // navigator only exists in the browser; checking after mount keeps server and client markup equal.
  useEffect(() => setSupported(isWebBluetoothAvailable()), []);

  // Rendering ~120 frames takes tens of ms; deferring keeps edits responsive while the panel is open.
  const deferredProject = useDeferredValue(project);
  const deferredLoader = useDeferredValue(loader);
  const result = useMemo(
    () => buildMatrixGif(deferredProject, deferredLoader, { showInactive, gaps }),
    [deferredProject, deferredLoader, gaps, showInactive]
  );
  const busy = status.kind === "connecting" || status.kind === "picking" || status.kind === "uploading";
  const sizeKb = (result.gif.length / 1024).toFixed(1);

  function handleDownload() {
    onDownload(new Blob([new Uint8Array(result.gif)], { type: "image/gif" }), `${sanitizeName(loader.name)}-32x32.gif`);
  }

  return (
    <div className="matrix-export">
      <MatrixPreview frames={result.frames} delaysCs={result.delaysCs} label={copy.preview} />
      <div className="matrix-export__side">
        <p className="export-meta">
          <span>32×32 · {result.frameCount} {copy.frames} · {result.fps} fps · {sizeKb} KB</span>
        </p>
        <SwitchControl checked={showInactive} name={copy.showInactive} onCheckedChange={setShowInactive} />
        <SwitchControl checked={gaps} name={copy.pixelGaps} onCheckedChange={setGaps} />
        {result.gif.length > GIF_BUDGET_BYTES ? <p className="matrix-export__note">{copy.overBudget}</p> : null}
        <p className="matrix-export__status" role="status">
          {supported ? describeMatrixStatus(status, link?.name ?? null, language) : copy.unsupported}
        </p>
        <div className="panel__actions">
          <Button type="button" variant="outline" onClick={handleDownload}>
            {copy.downloadGif}
          </Button>
          {link ? (
            <Button type="button" variant="outline" onClick={disconnect} disabled={busy}>
              {copy.disconnect}
            </Button>
          ) : null}
          <Button type="button" variant="default" onClick={() => void sendGif(result.gif)} disabled={!supported || busy}>
            {link ? copy.send : copy.connectAndSend}
          </Button>
        </div>
      </div>
    </div>
  );
}
