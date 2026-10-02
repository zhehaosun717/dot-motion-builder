import { DEVICE_NAME_PREFIX, NOTIFY_UUID, SERVICE_UUID, WRITE_UUID } from "@/lib/idotmatrix/constants";
import { DEFAULT_PACKET_SIZES, MatrixLink } from "@/lib/idotmatrix/matrix-link";
import { SCREEN_ON } from "@/lib/idotmatrix/protocol";

// Web Bluetooth is not in TypeScript's DOM lib; only the members used here are declared.
type BleCharacteristic = EventTarget & {
  value?: DataView | null;
  startNotifications(): Promise<BleCharacteristic>;
  writeValueWithoutResponse(data: Uint8Array): Promise<void>;
};
type BleServer = {
  connect(): Promise<BleServer>;
  disconnect(): void;
  getPrimaryService(uuid: string): Promise<{ getCharacteristic(uuid: string): Promise<BleCharacteristic> }>;
};
type BleDevice = EventTarget & { name?: string; gatt?: BleServer };
type BleNavigator = Navigator & {
  bluetooth?: { requestDevice(options: { filters: { namePrefix: string }[]; optionalServices: string[] }): Promise<BleDevice> };
};

export type MatrixErrorKind = "unsupported" | "bluetooth-off" | "cancelled" | "connect-failed" | "upload-failed";

export class MatrixError extends Error {
  readonly kind: MatrixErrorKind;

  constructor(kind: MatrixErrorKind, cause?: unknown) {
    super(cause instanceof Error ? cause.message : kind);
    this.kind = kind;
  }
}

export function isWebBluetoothAvailable() {
  return typeof navigator !== "undefined" && Boolean((navigator as BleNavigator).bluetooth);
}

/**
 * Web Bluetooth hides the MTU. Windows and Linux reject oversize writes, so large sizes can be probed there;
 * Android may silently truncate them, so it starts at the always-safe 20 bytes.
 */
function packetSizesForPlatform(): readonly number[] {
  const agent = navigator.userAgent;
  if (/Android/i.test(agent)) return [20];
  if (/Macintosh|Mac OS X/i.test(agent)) return [182, 20];
  return DEFAULT_PACKET_SIZES;
}

/** Chrome uses NotFoundError both for a dismissed chooser and for a missing or switched-off adapter. */
function classifyChooserError(error: unknown): MatrixErrorKind {
  if (!(error instanceof DOMException) || error.name !== "NotFoundError") return "connect-failed";
  return /cancel/i.test(error.message) ? "cancelled" : "bluetooth-off";
}

/** Opens the browser's device chooser (needs a user gesture) and connects to the chosen IDM-… panel. */
export async function connectMatrix(onDisconnected: (link: MatrixLink) => void): Promise<MatrixLink> {
  const bluetooth = typeof navigator === "undefined" ? undefined : (navigator as BleNavigator).bluetooth;
  if (!bluetooth) throw new MatrixError("unsupported");

  let device: BleDevice;
  try {
    device = await bluetooth.requestDevice({ filters: [{ namePrefix: DEVICE_NAME_PREFIX }], optionalServices: [SERVICE_UUID] });
  } catch (error) {
    throw new MatrixError(classifyChooserError(error), error);
  }

  try {
    if (!device.gatt) throw new Error("device has no GATT server");
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(SERVICE_UUID);
    const [write, notify] = await Promise.all([service.getCharacteristic(WRITE_UUID), service.getCharacteristic(NOTIFY_UUID)]);
    await notify.startNotifications();
    const link = new MatrixLink(
      { name: device.name ?? "iDotMatrix", write, notify, disconnect: () => server.disconnect() },
      { packetSizes: packetSizesForPlatform() }
    );
    device.addEventListener("gattserverdisconnected", () => onDisconnected(link), { once: true });
    await link.send(SCREEN_ON);
    return link;
  } catch (error) {
    device.gatt?.disconnect();
    throw new MatrixError("connect-failed", error);
  }
}
