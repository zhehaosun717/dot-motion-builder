import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

/** Written to the app's data folder so the MCP server and hooks can find and authenticate to the API. */
export const API_INFO_FILE = "agent-api.json";

const apiInfoSchema = z.object({
  port: z.number().int().min(1).max(65535),
  token: z.string().min(1),
  executable: z.string(),
  /** Arguments to start the app hidden (in development the app path precedes the flag). */
  args: z.array(z.string()).default([]),
  pid: z.number().int()
});

export type ApiInfo = z.infer<typeof apiInfoSchema>;

export function writeApiInfo(dir: string, info: ApiInfo) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, API_INFO_FILE), JSON.stringify(info, null, 2), { encoding: "utf8", mode: 0o600 });
}

export function readApiInfo(dir: string): ApiInfo | null {
  try {
    const parsed = apiInfoSchema.safeParse(JSON.parse(fs.readFileSync(path.join(dir, API_INFO_FILE), "utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
