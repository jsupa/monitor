import { readFileSync, readdirSync } from "node:fs";
import { join, extname } from "node:path";
import { monitorConfigSchema, type MonitorConfig } from "./types.js";

/**
 * Load and validate all monitor JSON config files from a directory.
 * Skips files that don't end in `.json` and disabled monitors.
 */
export function loadMonitorConfigs(dirPath: string): MonitorConfig[] {
  const entries = readdirSync(dirPath, { withFileTypes: true });
  const configs: MonitorConfig[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || extname(entry.name) !== ".json") {
      continue;
    }

    const filePath = join(dirPath, entry.name);
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    const result = monitorConfigSchema.safeParse(parsed);

    if (!result.success) {
      console.warn(
        `[core] Skipping invalid monitor config "${entry.name}":`,
        result.error.format(),
      );
      continue;
    }

    if (!result.data.enabled) {
      console.log(`[core] Monitor "${result.data.name}" is disabled, skipping.`);
      continue;
    }

    configs.push(result.data);
  }

  return configs;
}
