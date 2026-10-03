"use client";

import { useEffect } from "react";
import { create } from "zustand";
import { saveProject } from "@/lib/persistence";
import { useEditorStore } from "@/stores/use-editor-store";
import { Project } from "@/types/dot-motion";

const HISTORY_LIMIT = 100;
/** Changes outside a pointer gesture this close together (typing, key nudges) are one undo step. */
const COALESCE_MS = 500;

type HistoryCounts = { canUndo: boolean; canRedo: boolean };
/** Reactive flags for the undo/redo buttons; the stacks themselves stay outside React. */
export const useHistoryStore = create<HistoryCounts>(() => ({ canUndo: false, canRedo: false }));

let past: Project[] = [];
let future: Project[] = [];
let restoring = false;
let pointerDown = false;
let gestureRecorded = false;
/** Counts presses, so a release's deferred cleanup cannot end a newer gesture. */
let gesture = 0;
let lastRecordAt = 0;
let installed = false;

const publish = () => useHistoryStore.setState({ canUndo: past.length > 0, canRedo: future.length > 0 });

/** Pan and zoom live in the project too, but undoing them would feel like nothing happened. */
const onlyViewChanged = (next: Project, prev: Project) => next.loaders === prev.loaders && next.assets === prev.assets;

function record(prev: Project) {
  const now = Date.now();
  const sameStep = pointerDown ? gestureRecorded : now - lastRecordAt < COALESCE_MS;
  lastRecordAt = now;
  future = [];
  if (!sameStep) {
    past = [...past, prev].slice(-HISTORY_LIMIT);
    if (pointerDown) gestureRecorded = true;
  }
  publish();
}

function restore(target: Project) {
  const { project: current, selectedLoaderId } = useEditorStore.getState();
  // Keep the current view; the selection falls back to the first artboard if it no longer exists.
  const project = { ...target, canvas: current.canvas };
  const stillThere = !selectedLoaderId || project.loaders.some((loader) => loader.id === selectedLoaderId);
  const selected = stillThere ? selectedLoaderId : project.loaders[0]?.id ?? "";
  restoring = true;
  try {
    useEditorStore.setState({ project, selectedLoaderId: selected });
    saveProject(project);
  } finally {
    restoring = false;
  }
  lastRecordAt = 0;
  publish();
}

export function undo() {
  const target = past[past.length - 1];
  if (!target) return;
  past = past.slice(0, -1);
  future = [useEditorStore.getState().project, ...future].slice(0, HISTORY_LIMIT);
  restore(target);
}

export function redo() {
  const target = future[0];
  if (!target) return;
  future = future.slice(1);
  past = [...past, useEditorStore.getState().project].slice(-HISTORY_LIMIT);
  restore(target);
}

function install() {
  if (installed) return;
  installed = true;
  useEditorStore.subscribe((state, prev) => {
    if (restoring || state.project === prev.project) return;
    if (!prev.hydrated) {
      // Loading the saved project is the starting point, not an edit.
      past = [];
      future = [];
      publish();
      return;
    }
    if (onlyViewChanged(state.project, prev.project)) return;
    record(prev.project);
  });
  // A stroke, slider drag or artboard drag is one step however many store updates it makes.
  window.addEventListener("pointerdown", () => {
    gesture++;
    pointerDown = true;
    gestureRecorded = false;
  }, true);
  // Ends after the release has been handled: shapes are committed by the pointerup itself.
  const endGesture = () => {
    if (!pointerDown) return;
    const ending = gesture;
    setTimeout(() => {
      if (ending !== gesture) return;
      pointerDown = false;
      gestureRecorded = false;
      lastRecordAt = 0;
    }, 0);
  };
  window.addEventListener("pointerup", endGesture, true);
  window.addEventListener("pointercancel", endGesture, true);
  // A release can be missed (outside the window, focus lost mid-drag); never let a gesture stay open.
  window.addEventListener("blur", endGesture);
  window.addEventListener("pointermove", (event) => {
    if (event.buttons === 0) endGesture();
  }, true);
}

/** Starts recording edits (once per app). */
export function useEditorHistory() {
  useEffect(install, []);
}
