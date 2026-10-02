import { PanelClient } from "./panel-client";

const USAGE = `Usage:
  dot-matrix status <idle|thinking|working|waiting|done|error> [label]
  dot-matrix mood <neutral|happy|excited|love|proud|surprised|confused|sad|angry|sleepy|nervous>
  dot-matrix text <message>
Add --hook when called from an agent lifecycle hook (lower priority, never starts the app).`;

/** Hooks must never slow down or break the agent, so this always exits 0 within ~1.5 s. */
const HOOK_TIMEOUT_MS = 1500;

function toScene(args: string[]): unknown {
  const [command, value, ...rest] = args;
  if (command === "status") return { kind: "status", status: value, ...(rest.length ? { label: rest.join(" ") } : {}) };
  if (command === "mood") return { kind: "mood", mood: value };
  if (command === "text") return { kind: "text", text: [value, ...rest].join(" ") };
  return null;
}

async function main() {
  const argv = process.argv.slice(2);
  const hook = argv.includes("--hook");
  const scene = toScene(argv.filter((arg) => arg !== "--hook"));
  if (!scene) {
    console.error(USAGE);
    return;
  }
  const client = new PanelClient({ launch: false, timeoutMs: HOOK_TIMEOUT_MS });
  const result = await client.sendScene(scene, hook ? "hook" : "agent");
  if (!result.ok && !hook) console.error(result.error);
}

// Drain stdin (hooks pipe JSON event data) so the caller never blocks on a full pipe.
process.stdin.on("data", () => undefined);
process.stdin.on("error", () => undefined);
main()
  .catch(() => undefined)
  .finally(() => process.exit(0));
