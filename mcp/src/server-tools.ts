import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MOODS } from "@/lib/agent-display/face";
import { STATUSES } from "@/lib/agent-display/status-icons";
import { PanelClient, SendResult } from "./panel-client";

export const SERVER_NAME = "dot-matrix-panel";
export const SERVER_VERSION = "1.0.0";

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

const text = (message: string, isError = false): ToolResult => ({ content: [{ type: "text", text: message }], ...(isError ? { isError } : {}) });

function report(result: SendResult, what: string): ToolResult {
  if (!result.ok) return text(result.error, true);
  return text(result.shown ? `Showing ${what} on the LED panel.` : `Accepted ${what}, but a more important state is showing right now.`);
}

/**
 * MCP tools that let an AI agent show its state on the user's 32x32 LED panel. Each tool sends one
 * validated scene to the desktop app; descriptions tell the agent when each is appropriate.
 */
export function createMatrixMcpServer(client: PanelClient) {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  server.registerTool("set_status", {
    title: "Show work status",
    description:
      "Show what you are doing on the user's desk LED panel. Use 'thinking' while planning, 'working' during long tasks, " +
      "'waiting' when you need the user's input or approval, 'done' when a task finished, 'error' when something failed, " +
      "'idle' when there is nothing going on. Optional short label (e.g. 'tests', 'deploy').",
    inputSchema: {
      status: z.enum(STATUSES).describe("Work status icon"),
      label: z.string().max(48).optional().describe("Short label under the icon, e.g. 'tests' or '部署' (scrolls if long)")
    }
  }, async ({ status, label }) => report(await client.sendScene({ kind: "status", status, label }), `status "${status}"`));

  server.registerTool("set_mood", {
    title: "Show a mood face",
    description:
      "Show an animated pixel face expressing how you feel about the work, e.g. 'happy' after a fix lands, 'proud' after a " +
      "hard win, 'confused' by an odd error, 'nervous' before a risky step, 'sleepy' for a long wait. A mood you set stays " +
      "visible for a little while before automatic status updates replace it.",
    inputSchema: { mood: z.enum(MOODS).describe("Mood to express") }
  }, async ({ mood }) => report(await client.sendScene({ kind: "mood", mood }), `mood "${mood}"`));

  server.registerTool("show_text", {
    title: "Show short text",
    description:
      "Show a short message on the 32x32 panel. Chinese is supported (10px pixel font: up to 9 hanzi stay static as " +
      "3 lines of 3); ASCII-only text uses a smaller font (up to ~40 characters static, 8 per line). Longer text scrolls. " +
      "Emoji and rare characters show as '?'.",
    inputSchema: {
      text: z.string().min(1).max(280).describe("Message text"),
      color: z.string().regex(/^#?[0-9a-fA-F]{6}$/).optional().describe("Hex colour like #00FF00")
    }
  }, async ({ text: message, color }) => report(await client.sendScene({ kind: "text", text: message, color }), "your text"));

  server.registerTool("draw_pixels", {
    title: "Draw pixel art",
    description:
      "Draw custom pixel art on the 32x32 panel. Each frame is up to 32 rows of up to 32 characters; each character is a " +
      "palette key ('.' and unknown keys are black). Several frames animate at fps (default 4). Bright, saturated colours " +
      "read best on LEDs.",
    inputSchema: {
      frames: z.array(z.array(z.string())).min(1).max(16).describe("Frames; each frame is a list of rows"),
      palette: z.record(z.string(), z.string()).describe("Map of single-character keys to hex colours, e.g. {\"r\": \"#FF0000\"}"),
      fps: z.number().min(0.5).max(20).optional().describe("Animation speed for multiple frames")
    }
  }, async ({ frames, palette, fps }) => report(await client.sendScene({ kind: "pixels", frames, palette, fps }), "your pixel art"));

  server.registerTool("get_panel_state", {
    title: "Read panel state",
    description: "Check whether the LED panel is connected and what it is currently showing.",
    inputSchema: {}
  }, async () => {
    const result = await client.getState();
    return result.ok ? text(JSON.stringify(result.state)) : text(result.error, true);
  });

  return server;
}
