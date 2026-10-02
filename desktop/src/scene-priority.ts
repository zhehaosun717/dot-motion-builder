import type { AgentScene } from "@/lib/agent-display/scene";

/** "agent": an agent called the MCP tools on purpose. "hook": an automatic agent lifecycle hook (prompt submitted, turn finished). */
export type SceneSource = "agent" | "hook";
export const SCENE_SOURCES: readonly SceneSource[] = ["agent", "hook"];

/** How long a scene an agent chose stays up before automatic hook updates may replace it. */
export const AGENT_HOLD_MS = 12_000;

/** Hook states that matter more than whatever the agent last chose: a new prompt, or needing the user. */
const ALWAYS_SHOWN = new Set(["thinking", "waiting"]);

/**
 * Agents end a turn with a mood, then the Stop hook fires "done" right after; tool hooks fire
 * "working" mid-turn. Without a hold the agent's own choice would only flash.
 */
export function acceptScene(source: SceneSource, scene: AgentScene, lastAgentSceneAt: number, now: number) {
  if (source === "agent") return true;
  if (scene.kind === "status" && ALWAYS_SHOWN.has(scene.status)) return true;
  return now - lastAgentSceneAt > AGENT_HOLD_MS;
}
