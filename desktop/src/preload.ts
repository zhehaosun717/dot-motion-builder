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
  requestReconnect: () => ipcRenderer.send("matrix:request-connect")
};

contextBridge.exposeInMainWorld("matrixDesktop", bridge);
