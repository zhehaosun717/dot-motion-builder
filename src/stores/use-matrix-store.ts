"use client";

import { create } from "zustand";
import { AgentScene, isAnimated, renderScene } from "@/lib/agent-display/scene";
import { MATRIX_SIZE } from "@/lib/idotmatrix/constants";
import { FrameSource, LiveFrameStream } from "@/lib/idotmatrix/live-stream";
import { MatrixLink } from "@/lib/idotmatrix/matrix-link";
import { applyPanelTuning, NEUTRAL_PANEL_TUNING, PanelTuning, sanitizePanelTuning } from "@/lib/idotmatrix/panel-tuning";
import { encodePng } from "@/lib/idotmatrix/png-encoder";
import { ScreenMirror, startScreenMirror } from "@/lib/idotmatrix/screen-mirror";
import { connectMatrix, MatrixError, MatrixErrorKind } from "@/lib/idotmatrix/web-bluetooth";

/** "agent": scenes pushed by AI agents through the desktop app's API (status, mood, text, pixels). */
export type LiveSource = "off" | "editor" | "screen" | "agent";

export type MatrixStatus =
  | { kind: "idle" }
  | { kind: "connecting" }
  | { kind: "picking" }
  | { kind: "connected" }
  | { kind: "live"; source: Exclude<LiveSource, "off"> }
  | { kind: "uploading"; sent: number; total: number }
  | { kind: "sent"; missedAcks: number; agentPaused: boolean }
  | { kind: "error"; reason: MatrixErrorKind; detail: string };

type MatrixState = {
  link: MatrixLink | null;
  status: MatrixStatus;
  live: LiveSource;
  showInactive: boolean;
  /** Dark line between scaled-up cells on the panel (off: blocks fill the panel edge to edge). */
  pixelGaps: boolean;
  /** Colour correction applied to every frame and GIF sent to the panel (not to the editor or exports). */
  tuning: PanelTuning;
  /** Desktop app: agents may drive the panel whenever you are not using live sync or mirroring. */
  agentEnabled: boolean;
  agentScene: AgentScene | null;
  /** Why the last link ended: only a lost link (not your Disconnect) should be reconnected automatically. */
  lastDisconnect: "manual" | "lost" | null;
  connect: () => Promise<MatrixLink | null>;
  sendGif: (gif: Uint8Array) => Promise<void>;
  setLive: (source: LiveSource) => Promise<void>;
  pushFrame: (rgb: Uint8Array) => void;
  /** Streams an animation by sampling it whenever the link is free; null stops it. */
  playFrames: (source: FrameSource | null) => void;
  setShowInactive: (value: boolean) => void;
  setPixelGaps: (value: boolean) => void;
  setTuning: (patch: Partial<PanelTuning>) => void;
  showAgentScene: (scene: AgentScene) => void;
  setAgentEnabled: (enabled: boolean) => void;
  disconnect: () => void;
};

function toErrorStatus(error: unknown, fallback: MatrixErrorKind): MatrixStatus {
  const reason = error instanceof MatrixError ? error.kind : fallback;
  const detail = error instanceof Error ? error.message : String(error);
  // warn, not error: these are expected device conditions and must not trip the Next.js error overlay.
  console.warn("[iDotMatrix]", reason, error);
  return { kind: "error", reason, detail };
}

// Non-serialisable live plumbing stays outside the reactive state.
let stream: LiveFrameStream | null = null;
let mirror: ScreenMirror | null = null;
/** Bumped by every live-mode change; a screen picker that resolves after a newer change is discarded. */
let liveRequest = 0;
/** When the current agent scene was set; its animation time starts here. */
let agentSince = 0;
/** The last frame handed to the stream, before tuning: re-sent when the tuning changes. */
let lastLiveFrame: Uint8Array | null = null;

const TUNING_STORAGE_KEY = "dot-matrix-panel-tuning";

function loadTuning(): PanelTuning {
  try {
    const stored = typeof window === "undefined" ? null : window.localStorage.getItem(TUNING_STORAGE_KEY);
    return stored ? sanitizePanelTuning(JSON.parse(stored)) : NEUTRAL_PANEL_TUNING;
  } catch (error) {
    console.warn("[iDotMatrix] ignoring unreadable panel tuning", error);
    return NEUTRAL_PANEL_TUNING;
  }
}

function saveTuning(tuning: PanelTuning) {
  try {
    window.localStorage.setItem(TUNING_STORAGE_KEY, JSON.stringify(tuning));
  } catch (error) {
    console.warn("[iDotMatrix] could not save panel tuning", error);
  }
}

function stopMirror() {
  const active = mirror;
  mirror = null;
  active?.stop();
}

/** Lives outside the export drawer so the BLE connection survives closing and reopening it. */
export const useMatrixStore = create<MatrixState>((set, get) => {
  const isCurrent = (link: MatrixLink) => get().link === link;

  /** Puts the current agent scene on the panel; returns false when it cannot or should not. */
  const playAgent = () => {
    const { link, agentEnabled, agentScene } = get();
    if (!link || !agentEnabled || !agentScene || !stream || link.uploading) return false;
    stream.cancel();
    stream.reset();
    if (isAnimated(agentScene)) stream.play((displayAt) => renderScene(agentScene, displayAt - agentSince));
    else stream.show(renderScene(agentScene, 0));
    set({ live: "agent", status: { kind: "live", source: "agent" } });
    return true;
  };

  /** Stops whatever is streaming without handing the panel back to the agent (e.g. before a GIF upload). */
  const stopLive = () => {
    liveRequest++;
    stopMirror();
    stream?.cancel();
    set({ live: "off", status: get().link ? { kind: "connected" } : { kind: "idle" } });
  };

  return {
    link: null,
    status: { kind: "idle" },
    live: "off",
    showInactive: true,
    pixelGaps: false,
    tuning: loadTuning(),
    agentEnabled: false,
    agentScene: null,
    lastDisconnect: null,

    connect: async () => {
      set({ status: { kind: "connecting" } });
      try {
        const link = await connectMatrix((closed) => {
          if (!isCurrent(closed)) return;
          liveRequest++;
          stopMirror();
          stream = null;
          set({
            link: null,
            live: "off",
            lastDisconnect: "lost",
            status: closed.uploading ? { kind: "error", reason: "upload-failed", detail: "disconnected" } : { kind: "idle" }
          });
        });
        stream = new LiveFrameStream(async (rgb, stillWanted) => {
          lastLiveFrame = rgb;
          // Plain RGB PNGs: indexed PNGs were acknowledged by the panel but showed black in live sync
          // (user report on v0.2.0), so the panel's decoder is only trusted with what v0.1 proved.
          const png = await encodePng(MATRIX_SIZE, MATRIX_SIZE, applyPanelTuning(rgb, get().tuning), { allowPalette: false });
          if (stillWanted()) await link.showFrame(png);
        }, {
          onError: (error) => {
            if (!isCurrent(link)) return;
            liveRequest++;
            stopMirror();
            set({ live: "off", status: toErrorStatus(error, "upload-failed") });
          }
        });
        set({ link, status: { kind: "connected" }, lastDisconnect: null });
        playAgent();
        return link;
      } catch (error) {
        const cancelled = error instanceof MatrixError && error.kind === "cancelled";
        set({ status: cancelled ? { kind: "idle" } : toErrorStatus(error, "connect-failed") });
        return null;
      }
    },

    sendGif: async (gif) => {
      stopLive();
      // A frame still being encoded or waiting its turn would otherwise land after the GIF and replace it.
      stream?.cancel();
      await stream?.idle();
      const link = get().link ?? (await get().connect());
      if (!link || link.uploading) return;
      // A link that has since disconnected or been replaced must not overwrite the current status.
      const update = (status: MatrixStatus) => {
        if (isCurrent(link)) set({ status });
      };
      update({ kind: "uploading", sent: 0, total: 1 });
      try {
        const result = await link.uploadGif(gif, (sent, total) => update({ kind: "uploading", sent, total }));
        stream?.reset();
        // The GIF now lives in the panel's memory; agent scenes would replace it on the next hook, so the
        // agent display pauses until you turn it back on.
        const agentPaused = get().agentEnabled;
        if (agentPaused && isCurrent(link)) set({ agentEnabled: false });
        update({ kind: "sent", missedAcks: result.missedAcks, agentPaused });
      } catch (error) {
        update(toErrorStatus(error, "upload-failed"));
      }
    },

    setLive: async (source) => {
      if (source === get().live) return;
      const request = ++liveRequest;
      stopMirror();
      stream?.cancel();
      if (source === "off" || source === "agent") {
        // Leaving live sync or mirroring hands the panel back to the agent display when it is on.
        if (!playAgent()) set({ live: "off", status: get().link ? { kind: "connected" } : { kind: "idle" } });
        return;
      }
      // Both the device chooser and the screen picker need a fresh click, so live modes start
      // only once connected (the UI offers "connect" first).
      const link = get().link;
      if (!link) return;
      stream?.reset();
      if (source === "screen") {
        set({ live: "off", status: { kind: "picking" } });
        let started: ScreenMirror;
        try {
          started = await startScreenMirror((rgb) => get().pushFrame(rgb), () => {
            if (get().live === "screen") set({ live: "off", status: { kind: "connected" } });
          });
        } catch (error) {
          if (request !== liveRequest) return;
          // Dismissing the browser's share picker is a NotAllowedError: treat it as "never mind".
          const dismissed = error instanceof DOMException && error.name === "NotAllowedError";
          set({ live: "off", status: dismissed ? { kind: "connected" } : toErrorStatus(error, "connect-failed") });
          return;
        }
        // Superseded while the picker was open (stopped, disconnected, another mode): release the capture.
        if (request !== liveRequest || !isCurrent(link)) {
          started.stop();
          return;
        }
        mirror = started;
      }
      set({ live: source, status: { kind: "live", source } });
    },

    pushFrame: (rgb) => {
      if (get().live !== "off" && !get().link?.uploading) stream?.show(rgb);
    },

    playFrames: (source) => {
      if (!source) {
        stream?.play(null);
        return;
      }
      if (get().live !== "off" && !get().link?.uploading) stream?.play(source);
    },

    setShowInactive: (value) => set({ showInactive: value }),
    setPixelGaps: (value) => set({ pixelGaps: value }),

    setTuning: (patch) => {
      const tuning = sanitizePanelTuning({ ...get().tuning, ...patch });
      set({ tuning });
      saveTuning(tuning);
      // A still picture would keep its old colours until the next edit: show it again with the new tuning.
      if (stream && lastLiveFrame && get().live !== "off" && !get().link?.uploading) {
        stream.reset();
        stream.show(lastLiveFrame);
      }
    },

    showAgentScene: (scene) => {
      agentSince = Date.now();
      set({ agentScene: scene });
      // Your own live sync or mirroring keeps the panel; the scene shows once you stop them.
      const live = get().live;
      if (live === "off" || live === "agent") playAgent();
    },

    setAgentEnabled: (enabled) => {
      set({ agentEnabled: enabled });
      if (enabled && get().live === "off") playAgent();
      if (!enabled && get().live === "agent") stopLive();
    },

    disconnect: () => {
      liveRequest++;
      stopMirror();
      stream = null;
      get().link?.disconnect();
      set({ link: null, live: "off", status: { kind: "idle" }, lastDisconnect: "manual" });
    }
  };
});
