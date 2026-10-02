import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readApiInfo } from "../../desktop/src/api-info";
import type { SceneSource } from "../../desktop/src/scene-priority";

export const APP_NAME = "Dot Matrix Studio";
const POLL_MS = 300;
const NOT_RUNNING = `${APP_NAME} is not running. Start the ${APP_NAME} app (it owns the panel's Bluetooth link) and try again.`;

export type PanelClientOptions = {
  /** Where the app writes agent-api.json; defaults to %APPDATA%\Dot Matrix Studio. */
  dataDir?: string;
  /** Start the app when it is not reachable (MCP: yes; lifecycle hooks: no). */
  launch?: boolean;
  timeoutMs?: number;
  launchWaitMs?: number;
  spawnApp?: (executable: string, args: string[]) => Promise<void> | void;
};

export type SendResult = { ok: true; shown: boolean } | { ok: false; error: string };
export type StateResult = { ok: true; state: unknown } | { ok: false; error: string };

type Envelope = { success: boolean; data: unknown; error: string | null };

export function defaultDataDir() {
  if (process.env.DOT_MATRIX_DATA_DIR) return process.env.DOT_MATRIX_DATA_DIR;
  const appData = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
  return path.join(appData, APP_NAME);
}

function defaultSpawn(executable: string, args: string[]) {
  const child = spawn(executable, args, { detached: true, stdio: "ignore", windowsHide: true });
  child.unref();
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

class Unreachable extends Error {}

/** Talks to the desktop app's local API using the discovery file it writes. */
export class PanelClient {
  private readonly options: Required<Omit<PanelClientOptions, "spawnApp">> & Pick<PanelClientOptions, "spawnApp">;

  constructor(options: PanelClientOptions = {}) {
    this.options = {
      dataDir: options.dataDir ?? defaultDataDir(),
      launch: options.launch ?? false,
      timeoutMs: options.timeoutMs ?? 3000,
      launchWaitMs: options.launchWaitMs ?? 20_000,
      spawnApp: options.spawnApp
    };
  }

  async sendScene(scene: unknown, source: SceneSource = "agent"): Promise<SendResult> {
    const result = await this.call("POST", `/api/scene?source=${source}`, scene);
    if (!result.ok) return result;
    const data = result.data as { shown?: boolean } | null;
    return { ok: true, shown: data?.shown !== false };
  }

  async getState(): Promise<StateResult> {
    const result = await this.call("GET", "/api/state");
    return result.ok ? { ok: true, state: result.data } : result;
  }

  private async call(method: string, urlPath: string, body?: unknown): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
    try {
      return await this.request(method, urlPath, body);
    } catch (error) {
      if (!(error instanceof Unreachable)) return { ok: false, error: error instanceof Error ? error.message : String(error) };
      if (!this.options.launch) return { ok: false, error: NOT_RUNNING };
      return this.launchAndRetry(method, urlPath, body);
    }
  }

  private async launchAndRetry(method: string, urlPath: string, body?: unknown): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
    const info = readApiInfo(this.options.dataDir);
    const executable = info?.executable;
    if (!executable) return { ok: false, error: NOT_RUNNING };
    if (!this.options.spawnApp && !fs.existsSync(executable)) return { ok: false, error: NOT_RUNNING };
    await (this.options.spawnApp ?? defaultSpawn)(executable, info?.args ?? []);
    const deadline = Date.now() + this.options.launchWaitMs;
    while (Date.now() < deadline) {
      await sleep(POLL_MS);
      try {
        return await this.request(method, urlPath, body); // the new instance writes a fresh port and token
      } catch (error) {
        if (!(error instanceof Unreachable)) return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
    return { ok: false, error: `${APP_NAME} was started but did not answer in time; try again in a moment.` };
  }

  private async request(method: string, urlPath: string, body?: unknown): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
    const info = readApiInfo(this.options.dataDir);
    if (!info) throw new Unreachable();
    let response: Response;
    try {
      response = await fetch(`http://127.0.0.1:${info.port}${urlPath}`, {
        method,
        headers: { "x-matrix-token": info.token, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.options.timeoutMs)
      });
    } catch {
      throw new Unreachable();
    }
    const envelope = (await response.json().catch(() => null)) as Envelope | null;
    if (response.status === 401) return { ok: false, error: `${APP_NAME} rejected the token; restart the app.` };
    if (!response.ok || !envelope?.success) return { ok: false, error: envelope?.error ?? `${APP_NAME} answered HTTP ${response.status}` };
    return { ok: true, data: envelope.data };
  }
}
