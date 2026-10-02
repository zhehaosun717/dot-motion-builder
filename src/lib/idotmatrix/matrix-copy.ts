import type { Language } from "@/lib/ui-copy";
import type { MatrixStatus } from "@/stores/use-matrix-store";

export const matrixCopy = {
  cn: {
    format: "iDotMatrix",
    preview: "iDotMatrix 32×32 预览",
    showInactive: "显示未激活点",
    downloadGif: "下载 GIF",
    connectAndSend: "连接并发送",
    send: "发送到屏幕",
    disconnect: "断开",
    frames: "帧",
    connectPanel: "连接点阵屏",
    liveEditor: "实时同步",
    liveEditorStop: "停止同步",
    liveScreen: "投屏",
    liveScreenStop: "停止投屏",
    agentDisplay: "Agent 显示",
    overBudget: "GIF 超过 40 KB，屏幕播放可能会卡顿，可以减少序列帧数。",
    unsupported: "当前浏览器不支持 Web Bluetooth。请用桌面版 Chrome 或 Edge 打开，或先下载 GIF。"
  },
  en: {
    format: "iDotMatrix",
    preview: "iDotMatrix 32×32 preview",
    showInactive: "Show inactive dots",
    downloadGif: "Download GIF",
    connectAndSend: "Connect & Send",
    send: "Send to Panel",
    disconnect: "Disconnect",
    frames: "frames",
    connectPanel: "Connect Panel",
    liveEditor: "Live Sync",
    liveEditorStop: "Stop Sync",
    liveScreen: "Mirror Screen",
    liveScreenStop: "Stop Mirror",
    agentDisplay: "Agent Display",
    overBudget: "GIF is over 40 KB and may play sluggishly; try fewer sequence frames.",
    unsupported: "This browser has no Web Bluetooth. Open the editor in desktop Chrome or Edge, or download the GIF."
  }
} as const;

export function describeMatrixStatus(status: MatrixStatus, deviceName: string | null, language: Language): string {
  const cn = language === "cn";
  const name = deviceName ?? "iDotMatrix";
  switch (status.kind) {
    case "idle":
      return cn ? "未连接。点「连接并发送」，在浏览器弹窗里选择 IDM- 开头的设备。" : "Not connected. Press Connect & Send and pick your IDM-… panel.";
    case "connecting":
      return cn ? "正在连接…" : "Connecting…";
    case "connected":
      return cn ? `已连接 ${name}` : `Connected to ${name}`;
    case "picking":
      return cn ? "在浏览器弹窗里选择要投到屏上的屏幕、窗口或标签页…" : "Pick the screen, window or tab to mirror in the browser dialog…";
    case "live":
      if (status.source === "screen") return cn ? `正在投屏到 ${name}（最高约 15 帧/秒）` : `Mirroring to ${name} (up to ~15 fps)`;
      if (status.source === "agent") return cn ? `${name} 正在显示 AI agent 的状态和心情` : `${name} is showing your AI agent's status and mood`;
      return cn ? `实时同步到 ${name}：画的每一笔、预览的动画都会直接显示在屏上` : `Live on ${name}: every edit and the preview animation show on the panel`;
    case "uploading":
      // Chrome throttles timers in background tabs, which stretches the paced upload to minutes.
      return cn
        ? `正在发送 ${status.sent}/${status.total}…（请让这个页面保持在前台）`
        : `Sending ${status.sent}/${status.total}… (keep this tab in front)`;
    case "sent":
      if (status.missedAcks > 0) {
        return cn
          ? `已发送，但有 ${status.missedAcks} 块没收到屏幕确认。如果画面没变，给屏幕断电 5 秒后再试。`
          : `Sent, but ${status.missedAcks} chunk(s) were not acknowledged. If nothing changed, power-cycle the panel for 5 s and retry.`;
      }
      return cn ? `已发送到 ${name}，断开后屏幕也会继续循环播放。` : `Sent to ${name}. The panel keeps looping it after you disconnect.`;
    case "error":
      if (status.reason === "unsupported") return matrixCopy[language].unsupported;
      if (status.reason === "bluetooth-off") {
        return cn ? "找不到蓝牙适配器。确认电脑蓝牙已打开，再试一次。" : "No Bluetooth adapter available. Turn Bluetooth on and retry.";
      }
      if (status.reason === "connect-failed") {
        return cn
          ? "连接失败。先关掉手机上的 iDotMatrix App（屏幕同一时间只能连一个设备），再试一次。"
          : "Could not connect. Close the iDotMatrix phone app (the panel accepts one connection at a time) and retry.";
      }
      // A half-received GIF can leave the firmware ignoring the next upload until it is power-cycled.
      return cn
        ? `发送中断（${status.detail}）。如果屏幕卡住或不再接收新画面，给屏幕断电 5 秒后再发一次。`
        : `Upload interrupted (${status.detail}). If the panel freezes or ignores new uploads, unplug it for 5 s and send again.`;
  }
}
