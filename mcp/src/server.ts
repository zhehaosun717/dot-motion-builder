import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { PanelClient } from "./panel-client";
import { createMatrixMcpServer } from "./server-tools";

/** stdio entry point: `node server.cjs`. Starts the desktop app on demand when a tool is used. */
async function main() {
  const server = createMatrixMcpServer(new PanelClient({ launch: true }));
  await server.connect(new StdioServerTransport());
}

main().catch((error) => {
  // stdout carries the MCP protocol; diagnostics go to stderr.
  console.error("[dot-matrix-panel] failed to start:", error);
  process.exit(1);
});
