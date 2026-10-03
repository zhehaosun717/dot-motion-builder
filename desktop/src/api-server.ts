import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { timingSafeEqual } from "node:crypto";
import { AgentScene, parseScene } from "@/lib/agent-display/scene";
import { editorDrawSchema, EditorDrawRequest } from "@/lib/agent-editor";
import { SCENE_SOURCES, SceneSource } from "./scene-priority";

export const MAX_BODY_BYTES = 64 * 1024;
const TOKEN_HEADER = "x-matrix-token";
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8"
};

export type ApiServerOptions = {
  token: string;
  /** The statically exported editor. */
  staticDir: string;
  /** Returns false when the scene was valid but not shown (e.g. a hook during an agent's hold). */
  onScene: (scene: AgentScene, source: SceneSource) => boolean | void;
  getState: () => unknown;
  /** Asks the editor window to read or draw artwork; rejects when the editor cannot answer. */
  onEditor?: (request: EditorRequest) => Promise<unknown>;
};

export type EditorRequest = { action: "get-drawing" } | { action: "draw"; payload: EditorDrawRequest };

type Envelope = { success: boolean; data: unknown; error: string | null };

function send(res: http.ServerResponse, status: number, body: Envelope) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

const fail = (res: http.ServerResponse, status: number, error: string) => send(res, status, { success: false, data: null, error });

/** Only accept requests addressed to this machine, which defeats DNS-rebinding pages. */
function isLocalHost(hostHeader: string | undefined) {
  if (!hostHeader) return false;
  const host = hostHeader.startsWith("[") ? hostHeader.slice(0, hostHeader.indexOf("]") + 1) : hostHeader.split(":")[0];
  return LOCAL_HOSTS.has(host.toLowerCase());
}

function hasToken(req: http.IncomingMessage, token: string) {
  const given = Buffer.from(String(req.headers[TOKEN_HEADER] ?? ""));
  const expected = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("request body too large"), { status: 413 }));
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function readJson(req: http.IncomingMessage): Promise<{ ok: true; json: unknown } | { ok: false; status: number; error: string }> {
  let raw: string;
  try {
    raw = await readBody(req);
  } catch (error) {
    return { ok: false, status: (error as { status?: number }).status ?? 400, error: "could not read request body" };
  }
  try {
    return { ok: true, json: JSON.parse(raw) };
  } catch {
    return { ok: false, status: 400, error: "body must be JSON" };
  }
}

/** Editor routes: GET /api/editor/drawing reads the selected artboard; POST /api/editor/draw adds artwork. */
async function handleEditor(req: http.IncomingMessage, res: http.ServerResponse, url: URL, options: ApiServerOptions) {
  if (!options.onEditor) return fail(res, 404, "unknown endpoint");
  let request: EditorRequest;
  if (req.method === "GET" && url.pathname === "/api/editor/drawing") {
    request = { action: "get-drawing" };
  } else if (req.method === "POST" && url.pathname === "/api/editor/draw") {
    const body = await readJson(req);
    if (!body.ok) return fail(res, body.status, body.error);
    const parsed = editorDrawSchema.safeParse(body.json);
    if (!parsed.success) return fail(res, 400, parsed.error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`).join("; "));
    request = { action: "draw", payload: parsed.data };
  } else {
    return fail(res, 404, "unknown endpoint");
  }
  try {
    return send(res, 200, { success: true, data: await options.onEditor(request), error: null });
  } catch (error) {
    return fail(res, 503, error instanceof Error ? error.message : "the editor did not answer");
  }
}

async function handleApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL, options: ApiServerOptions) {
  if (!hasToken(req, options.token)) return fail(res, 401, "missing or invalid token");
  if (url.pathname.startsWith("/api/editor/")) return handleEditor(req, res, url, options);
  if (req.method === "GET" && url.pathname === "/api/state") return send(res, 200, { success: true, data: options.getState(), error: null });
  if (req.method === "POST" && url.pathname === "/api/scene") {
    const source = (url.searchParams.get("source") ?? "agent") as SceneSource;
    if (!SCENE_SOURCES.includes(source)) return fail(res, 400, "source must be agent or hook");
    let raw: string;
    try {
      raw = await readBody(req);
    } catch (error) {
      return fail(res, (error as { status?: number }).status ?? 400, "could not read request body");
    }
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return fail(res, 400, "body must be JSON");
    }
    try {
      const scene = parseScene(json);
      const shown = options.onScene(scene, source) !== false;
      return send(res, 200, { success: true, data: { shown, kind: scene.kind }, error: null });
    } catch (error) {
      return fail(res, 400, error instanceof Error ? error.message : "invalid scene");
    }
  }
  return fail(res, 404, "unknown endpoint");
}

/** Serves files strictly inside staticDir; directories resolve to index.html (trailingSlash export). */
function serveStatic(res: http.ServerResponse, url: URL, staticDir: string) {
  let relative: string;
  try {
    relative = decodeURIComponent(url.pathname);
  } catch {
    return fail(res, 400, "bad path");
  }
  const root = path.resolve(staticDir);
  let file = path.resolve(root, `.${relative}`);
  if (file !== root && !file.startsWith(root + path.sep)) return fail(res, 404, "not found");
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return fail(res, 404, "not found");
  res.writeHead(200, { "content-type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}

/**
 * The desktop app's local server: the editor UI plus a token-protected JSON API that agents (via the
 * MCP server or hooks) use to put a scene on the panel. Bind it to 127.0.0.1 only.
 */
export function createApiServer(options: ApiServerOptions) {
  return http.createServer((req, res) => {
    if (!isLocalHost(req.headers.host)) return fail(res, 403, "forbidden host");
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    // No CORS headers anywhere: browsers must never be able to call the API from a web page.
    if (req.method === "OPTIONS") return fail(res, 405, "method not allowed");
    if (url.pathname.startsWith("/api/")) {
      handleApi(req, res, url, options).catch(() => fail(res, 500, "internal error"));
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") return fail(res, 405, "method not allowed");
    serveStatic(res, url, options.staticDir);
  });
}
