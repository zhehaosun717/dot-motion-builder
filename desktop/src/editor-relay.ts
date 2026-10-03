import type { EditorRequest } from "./api-server";

export const EDITOR_TIMEOUT_MS = 5000;

/** What the editor window sends back for a request. */
export type EditorResponse = { id: number; ok: boolean; data?: unknown; error?: string };

/**
 * Request/response over one-way IPC: the main process sends numbered requests to the editor window and
 * resolves each when the window answers with the same id (or rejects after a timeout).
 */
export function createEditorRelay(send: (message: { id: number } & EditorRequest) => boolean, timeoutMs = EDITOR_TIMEOUT_MS) {
  let nextId = 1;
  const pending = new Map<number, { resolve: (data: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();

  function request(editorRequest: EditorRequest): Promise<unknown> {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("The Dot Matrix Studio editor did not answer in time."));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      if (!send({ id, ...editorRequest })) {
        clearTimeout(timer);
        pending.delete(id);
        reject(new Error("The Dot Matrix Studio editor is still starting; try again in a moment."));
      }
    });
  }

  function handleResponse(response: EditorResponse) {
    const entry = pending.get(response?.id);
    if (!entry) return;
    pending.delete(response.id);
    clearTimeout(entry.timer);
    if (response.ok) entry.resolve(response.data ?? null);
    else entry.reject(new Error(response.error || "The editor could not do that."));
  }

  return { request, handleResponse };
}
