/**
 * Timers that keep their pace when the tab is hidden or the window is covered.
 * Chrome aligns main-thread timers in hidden pages to ~1 s, which would turn the 18 ms BLE packet
 * gap into a second per packet; timers inside a dedicated worker are not throttled that way.
 * Outside the browser (tests, SSR) this falls back to plain setTimeout.
 */
const WORKER_SOURCE = "onmessage = (e) => setTimeout(() => postMessage(e.data.id), e.data.ms);";

let worker: Worker | null | undefined;
let nextId = 0;
const waiters = new Map<number, () => void>();

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  if (typeof window === "undefined" || typeof Worker === "undefined") return (worker = null);
  try {
    const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "text/javascript" }));
    worker = new Worker(url);
    worker.onmessage = (event: MessageEvent<number>) => {
      const resolve = waiters.get(event.data);
      waiters.delete(event.data);
      resolve?.();
    };
    // A blocked worker can fail after construction; fall back so no sleep hangs forever.
    worker.onerror = () => {
      worker?.terminate();
      worker = null;
      const pending = [...waiters.values()];
      waiters.clear();
      pending.forEach(resolve => resolve());
    };
  } catch {
    worker = null; // e.g. a CSP that forbids blob: workers
  }
  return worker;
}

export function backgroundSleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  const timerWorker = getWorker();
  if (!timerWorker) return new Promise(resolve => setTimeout(resolve, ms));
  return new Promise(resolve => {
    const id = nextId++;
    waiters.set(id, resolve);
    timerWorker.postMessage({ id, ms });
  });
}

/** Calls tick every intervalMs until the returned stop function is called. */
export function backgroundInterval(intervalMs: number, tick: () => void): () => void {
  let running = true;
  void (async () => {
    while (running) {
      await backgroundSleep(intervalMs);
      if (running) tick();
    }
  })();
  return () => { running = false; };
}
