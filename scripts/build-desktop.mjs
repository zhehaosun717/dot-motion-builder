// Builds everything the desktop app needs: the statically exported editor (out/), the Electron main and
// preload bundles (desktop/dist), the MCP server and hook CLI (mcp/dist), and the app icon.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skipWeb = process.argv.includes("--skip-web");

function run(command, args, env = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32", env: { ...process.env, ...env } });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
}

if (!skipWeb) run("npx", ["next", "build"], { DESKTOP_EXPORT: "1" });

const common = { bundle: true, platform: "node", target: "node22", format: "cjs", logLevel: "warning", absWorkingDir: root, tsconfig: path.join(root, "tsconfig.json") };
await Promise.all([
  build({ ...common, entryPoints: ["desktop/src/main.ts"], outfile: "desktop/dist/main.cjs", external: ["electron"] }),
  build({ ...common, entryPoints: ["desktop/src/preload.ts"], outfile: "desktop/dist/preload.cjs", external: ["electron"] }),
  build({ ...common, entryPoints: ["mcp/src/server.ts"], outfile: "mcp/dist/server.cjs" }),
  build({ ...common, entryPoints: ["mcp/src/cli.ts"], outfile: "mcp/dist/cli.cjs" })
]);

// App icon (256x256) rendered from the same pixel face the tray uses.
await build({ ...common, entryPoints: ["desktop/src/write-icon.ts"], outfile: "desktop/dist/write-icon.cjs" });
run("node", ["desktop/dist/write-icon.cjs", "desktop/build/icon.png"]);
fs.rmSync(path.join(root, "desktop/dist/write-icon.cjs"));

console.log("desktop build ready: out/, desktop/dist/, mcp/dist/, desktop/build/icon.png");
