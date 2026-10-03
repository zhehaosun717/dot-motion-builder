import { contextBridge, ipcRenderer } from "electron";
import type { DesktopPanelState, MatrixDesktopBridge } from "@/lib/desktop-bridge";

/** The only surface the editor page gets from Electron: scenes in, panel state out. */
const bridge: MatrixDesktopBridge = {
  onScene: (callback) => {
    const listener = (_event: unknown, scene: unknown) => callback(scene);
    ipcRenderer.on("matrix:scene", listener);
    return () => ipcRenderer.removeListener("matrix:scene", listener);
  },
  reportState: (state: DesktopPanelState) => ipcRenderer.send("matrix:state", state),
  ready: () => ipcRenderer.send("matrix:ready"),
  requestReconnect: () => ipcRenderer.send("matrix:request-connect"),
  pickCaptureSource: () => ipcRenderer.invoke("matrix:pick-capture") as Promise<string | null>,
  onEditorRequest: (handler) => {
    const listener = (_event: unknown, request: { id: number; action: string; payload?: unknown }) => {
      Promise.resolve()
        .then(() => handler({ action: request.action, payload: request.payload }))
        .then(
          (data) => ipcRenderer.send("matrix:editor-response", { id: request.id, ok: true, data }),
          (error: unknown) => ipcRenderer.send("matrix:editor-response", { id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) })
        );
    };
    ipcRenderer.on("matrix:editor-request", listener);
    return () => ipcRenderer.removeListener("matrix:editor-request", listener);
  }
};

contextBridge.exposeInMainWorld("matrixDesktop", bridge);
