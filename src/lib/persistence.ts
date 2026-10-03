import { Project } from "@/types/dot-motion";

export const STORAGE_KEY = "dot-motion-builder.project.v9";

type SaveListener = (ok: boolean) => void;
const saveListeners = new Set<SaveListener>();

/** Notified after every save attempt; false means the browser refused it (usually storage full). */
export function onSaveResult(listener: SaveListener) {
  saveListeners.add(listener);
  return () => {
    saveListeners.delete(listener);
  };
}

/**
 * Writes the project to localStorage. A full storage (~5 MB) must not throw out of a store update and
 * lose the edit on screen too, so failures are reported to listeners instead.
 */
export function saveProject(project: Project) {
  if (typeof window === "undefined") {
    return;
  }

  let ok = true;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
  } catch (error) {
    ok = false;
    console.warn("[editor] could not save the project", error);
  }
  saveListeners.forEach((listener) => listener(ok));
}

export function loadProject() {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as Project;
  } catch {
    return null;
  }
}
