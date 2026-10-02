import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

const SETTINGS_FILE = "settings.json";

const settingsSchema = z.object({
  rememberedDeviceId: z.string().nullable().default(null),
  openAtLogin: z.boolean().default(false)
});

export type DesktopSettings = z.infer<typeof settingsSchema>;

export function loadSettings(dir: string): DesktopSettings {
  try {
    return settingsSchema.parse(JSON.parse(fs.readFileSync(path.join(dir, SETTINGS_FILE), "utf8")));
  } catch {
    return settingsSchema.parse({});
  }
}

export function saveSettings(dir: string, settings: DesktopSettings) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, SETTINGS_FILE), JSON.stringify(settings, null, 2), "utf8");
}
