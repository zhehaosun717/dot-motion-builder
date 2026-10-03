import { app, BrowserWindow, desktopCapturer, DesktopCapturerSource, ipcMain, Menu, MenuItemConstructorOptions, nativeImage, Tray } from "electron";
import crypto from "node:crypto";
import fs from "node:fs";
import type { Server } from "node:http";
import path from "node:path";
import type { AgentScene } from "@/lib/agent-display/scene";
import type { DesktopPanelState } from "@/lib/desktop-bridge";
import { writeApiInfo } from "./api-info";
import { createApiServer } from "./api-server";
import { createEditorRelay, EditorResponse } from "./editor-relay";
import { faceIconBitmap } from "./app-icon";
import { pickPanel } from "./device-chooser";
import { acceptScene, SceneSource } from "./scene-priority";
import { DesktopSettings, loadSettings, saveSettings } from "./settings";

const APP_NAME = "Dot Matrix Studio";
const PREFERRED_PORT = 47321;
/** How long the device chooser waits for an IDM- panel to show up before giving up this attempt. */
const DEVICE_WAIT_MS = 20_000;
const RECONNECT_DELAY_MS = 8_000;
const START_HIDDEN_FLAG = "--hidden";

app.setName(APP_NAME);
// Fixed data folder: the MCP server and hooks look for agent-api.json here.
app.setPath("userData", path.join(app.getPath("appData"), APP_NAME));
if (!app.requestSingleInstanceLock()) app.quit();

let window: BrowserWindow | null = null;
let tray: Tray | null = null;
let server: Server | null = null;
let quitting = false;
let rendererReady = false;
let pendingScene: AgentScene | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let panelState: DesktopPanelState = { connected: false, deviceName: null, live: "off", status: "idle", scene: null };
let settings: DesktopSettings;
let lastAgentSceneAt = 0;

const dataDir = () => app.getPath("userData");
const agentToolsDir = () => (app.isPackaged ? path.join(process.resourcesPath, "mcp") : path.join(__dirname, "..", "..", "mcp", "dist"));
const staticDir = () => (app.isPackaged ? path.join(process.resourcesPath, "web") : path.join(__dirname, "..", "..", "out"));

/**
 * Copies the MCP server and hook CLI to %APPDATA%Dot Matrix Studiomcp so agent configs point at one
 * stable path whether the app runs installed or from source. Refreshed on every start.
 */
function installAgentTools() {
  try {
    fs.cpSync(agentToolsDir(), path.join(dataDir(), "mcp"), { recursive: true, force: true });
  } catch (error) {
    console.error("[desktop] could not install agent tools:", error);
  }
}

function sendScene(scene: AgentScene, source: SceneSource = "agent") {
  const now = Date.now();
  if (!acceptScene(source, scene, lastAgentSceneAt, now)) return false;
  if (source === "agent") lastAgentSceneAt = now;
  if (window && rendererReady) window.webContents.send("matrix:scene", scene);
  else pendingScene = scene;
  return true;
}

/** Agents' editor requests (read or draw artwork) go to the editor window and wait for its answer. */
const editorRelay = createEditorRelay((message) => {
  if (!window || window.isDestroyed() || window.webContents.isDestroyed() || !rendererReady) return false;
  window.webContents.send("matrix:editor-request", message);
  return true;
});

/** Web Bluetooth needs a user gesture; executeJavaScript(…, true) supplies one so the panel connects by itself. */
function autoConnect() {
  void window?.webContents.executeJavaScript("window.__matrixAutoConnect && window.__matrixAutoConnect()", true);
}

function scheduleReconnect() {
  if (reconnectTimer || quitting) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (!panelState.connected) autoConnect();
  }, RECONNECT_DELAY_MS);
}

function listen(srv: Server, port: number) {
  return new Promise<number>((resolve, reject) => {
    srv.once("error", reject);
    srv.listen(port, "127.0.0.1", () => {
      srv.removeListener("error", reject);
      const address = srv.address();
      resolve(typeof address === "object" && address ? address.port : port);
    });
  });
}

async function startServer() {
  const token = crypto.randomBytes(24).toString("hex");
  const create = () => createApiServer({ token, staticDir: staticDir(), onScene: sendScene, getState: () => panelState, onEditor: editorRelay.request });
  server = create();
  let port: number;
  try {
    port = await listen(server, PREFERRED_PORT);
  } catch {
    server = create(); // preferred port taken: let the OS pick; agents read the port from agent-api.json
    port = await listen(server, 0);
  }
  const args = app.isPackaged ? [START_HIDDEN_FLAG] : [app.getAppPath(), START_HIDDEN_FLAG];
  writeApiInfo(dataDir(), { port, token, executable: process.execPath, args, pid: process.pid });
  return port;
}

function installDeviceChooser(win: BrowserWindow) {
  let pending: ((deviceId: string) => void) | null = null;
  let giveUp: NodeJS.Timeout | null = null;
  // Chromium re-fires this as scanning finds devices; answer as soon as a panel appears.
  win.webContents.on("select-bluetooth-device", (event, devices, callback) => {
    event.preventDefault();
    pending = callback;
    const chosen = pickPanel(devices, settings.rememberedDeviceId);
    if (chosen) {
      if (giveUp) clearTimeout(giveUp);
      giveUp = null;
      pending = null;
      if (settings.rememberedDeviceId !== chosen) {
        settings = { ...settings, rememberedDeviceId: chosen };
        saveSettings(dataDir(), settings);
      }
      callback(chosen);
      return;
    }
    giveUp ??= setTimeout(() => {
      giveUp = null;
      pending?.("");
      pending = null;
    }, DEVICE_WAIT_MS);
  });
}

const MAX_WINDOW_CHOICES = 25;
const truncate = (text: string, max = 48) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

const CANCEL_GRACE_MS = 300;
const SOURCE_LIST_TIMEOUT_MS = 10_000;

/**
 * Shows screens and windows in a native menu and resolves the chosen source id (null when cancelled).
 * The editor captures it with getUserMedia's desktop source constraint, which, unlike getDisplayMedia,
 * needs neither a display-media handler (Electron cannot deny one without throwing) nor a fresh user gesture.
 */
async function pickCaptureSource(): Promise<string | null> {
  const sources = await Promise.race([
    desktopCapturer.getSources({ types: ["screen", "window"], thumbnailSize: { width: 0, height: 0 } }),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("listing capture sources timed out")), SOURCE_LIST_TIMEOUT_MS))
  ]);
  const screens = sources.filter((source) => source.id.startsWith("screen:"));
  const windows = sources.filter((source) => !source.id.startsWith("screen:") && source.name && !source.name.startsWith(APP_NAME));
  return new Promise((resolve) => {
    let settled = false;
    const finish = (source: DesktopCapturerSource | null) => {
      if (settled) return;
      settled = true;
      resolve(source ? source.id : null);
    };
    const items: MenuItemConstructorOptions[] = [
      { label: "选择要投到点阵屏上的内容", enabled: false },
      { type: "separator" },
      ...screens.map((source, i) => ({ label: screens.length > 1 ? `屏幕 ${i + 1}` : "整个屏幕", click: () => finish(source) })),
      { type: "separator" },
      ...windows.slice(0, MAX_WINDOW_CHOICES).map((source) => ({ label: truncate(source.name), click: () => finish(source) })),
      { type: "separator" },
      { label: "取消", click: () => finish(null) }
    ];
    // On Windows the close callback can fire before the click handler; give a click time to land.
    Menu.buildFromTemplate(items).popup({ window: window ?? undefined, callback: () => setTimeout(() => finish(null), CANCEL_GRACE_MS) });
  });
}

function installScreenPicker() {
  ipcMain.handle("matrix:pick-capture", async () => {
    try {
      return await pickCaptureSource();
    } catch (error) {
      console.error("[desktop] capture source listing failed:", error);
      return null;
    }
  });
}

function showWindow() {
  if (!window) return;
  window.show();
  window.focus();
}

function createWindow(port: number, startHidden: boolean) {
  const icon = faceIconBitmap(8);
  window = new BrowserWindow({
    width: 1440,
    height: 920,
    title: APP_NAME,
    show: !startHidden,
    backgroundColor: "#0a0b0f",
    icon: nativeImage.createFromBitmap(icon.buffer, { width: icon.size, height: icon.size }),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // The panel keeps animating while the window is hidden in the tray.
      backgroundThrottling: false
    }
  });
  installDeviceChooser(window);
  window.on("close", (event) => {
    if (quitting) return;
    event.preventDefault(); // closing keeps the app (and the panel link) alive in the tray
    window?.hide();
  });
  window.webContents.on("did-start-loading", () => { rendererReady = false; });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  void window.loadURL(`http://127.0.0.1:${port}/editor/`);
}

function refreshTray() {
  if (!tray) return;
  const status = panelState.connected ? `已连接 ${panelState.deviceName ?? ""}` : "点阵屏未连接";
  tray.setToolTip(`${APP_NAME} — ${status}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: status, enabled: false },
    { type: "separator" },
    { label: "打开编辑器", click: showWindow },
    { label: "立即连接点阵屏", enabled: !panelState.connected, click: autoConnect },
    {
      label: "开机自动启动",
      type: "checkbox",
      checked: settings.openAtLogin,
      click: (item) => {
        settings = { ...settings, openAtLogin: item.checked };
        saveSettings(dataDir(), settings);
        app.setLoginItemSettings({ openAtLogin: item.checked, args: [START_HIDDEN_FLAG] });
      }
    },
    { type: "separator" },
    { label: "退出", click: () => { quitting = true; app.quit(); } }
  ]));
}

function createTray() {
  const icon = faceIconBitmap(1);
  tray = new Tray(nativeImage.createFromBitmap(icon.buffer, { width: icon.size, height: icon.size }));
  tray.on("click", showWindow);
  refreshTray();
}

ipcMain.on("matrix:ready", () => {
  rendererReady = true;
  if (pendingScene) window?.webContents.send("matrix:scene", pendingScene);
  pendingScene = null;
  autoConnect();
});
ipcMain.on("matrix:state", (_event, state: DesktopPanelState) => {
  panelState = state;
  refreshTray();
});
ipcMain.on("matrix:request-connect", scheduleReconnect);
ipcMain.on("matrix:editor-response", (_event, response: EditorResponse) => editorRelay.handleResponse(response));

app.on("second-instance", showWindow);
app.on("before-quit", () => {
  quitting = true;
  server?.close();
});
app.on("window-all-closed", () => {
  // Stay in the tray; quitting is explicit.
});

app.whenReady().then(async () => {
  settings = loadSettings(dataDir());
  installAgentTools();
  Menu.setApplicationMenu(null);
  installScreenPicker();
  const port = await startServer();
  createTray();
  createWindow(port, process.argv.includes(START_HIDDEN_FLAG));
});
