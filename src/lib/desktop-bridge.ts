/** State the editor reports to the desktop app (tray menu, GET /api/state). */
export type DesktopPanelState = {
  connected: boolean;
  deviceName: string | null;
  live: string;
  status: string;
  scene: unknown;
};

/** What the Electron preload script exposes as window.matrixDesktop. Absent in a normal browser. */
export type MatrixDesktopBridge = {
  onScene: (callback: (scene: unknown) => void) => () => void;
  reportState: (state: DesktopPanelState) => void;
  ready: () => void;
  requestReconnect: () => void;
  /** Desktop app: native screen/window picker; resolves a desktop capture source id, or null if cancelled. */
  pickCaptureSource?: () => Promise<string | null>;
};

export function getDesktopBridge(): MatrixDesktopBridge | null {
  if (typeof window === "undefined") return null;
  return (window as Window & { matrixDesktop?: MatrixDesktopBridge }).matrixDesktop ?? null;
}
