export type BluetoothCandidate = { deviceId: string; deviceName: string };

const PANEL_PREFIX = "IDM-";

/**
 * Chooses which device answers the editor's Web Bluetooth request: the panel used last time if it is
 * in range, otherwise the first iDotMatrix panel. Null means keep scanning.
 */
export function pickPanel(devices: readonly BluetoothCandidate[], rememberedId: string | null): string | null {
  const panels = devices.filter(device => device.deviceName?.startsWith(PANEL_PREFIX));
  return panels.find(device => device.deviceId === rememberedId)?.deviceId ?? panels[0]?.deviceId ?? null;
}
