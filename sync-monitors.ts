/**
 * Sync monitor JSON configs from ./monitors/ into MongoDB.
 *
 * Usage: pnpm sync:monitors
 *
 * Reads every .json file in the monitors directory, validates it,
 * and upserts it into the MonitorConfig MongoDB collection by name.
 * Disabled monitors are also synced (just with enabled=false),
 * so you can disable a monitor by editing the file and running sync again.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, extname } from "node:path";
import "dotenv/config";

// Import from built dist (after pnpm build) so we don't rely on tsx workspace resolution
const MONITORS_DIR = process.env.MONITORS_DIR || "./monitors";
const MONGO_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/monitor";

async function main(): Promise<void> {
  console.log("[sync:monitors] Loading configs from:", MONITORS_DIR);

  // Dynamic imports from built packages
  const core = await import("./packages/core/dist/index.js");
  const db = await import("./packages/database/dist/index.js");

  const entries = readdirSync(MONITORS_DIR, { withFileTypes: true });
  const configs: Array<{ name: string; enabled: boolean }> = [];

  for (const entry of entries) {
    if (!entry.isFile() || extname(entry.name) !== ".json") continue;

    const filePath = join(MONITORS_DIR, entry.name);
    const raw = readFileSync(filePath, "utf-8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.warn(`[sync:monitors] Skipping invalid JSON "${entry.name}"`);
      continue;
    }

    const result = core.monitorConfigSchema.safeParse(parsed);

    if (!result.success) {
      console.warn(`[sync:monitors] Skipping invalid "${entry.name}":`, result.error.format());
      continue;
    }

    configs.push(result.data);
  }

  if (configs.length === 0) {
    console.warn("[sync:monitors] No valid monitor configs found.");
    process.exit(0);
  }

  console.log(`[sync:monitors] Connecting to MongoDB: ${MONGO_URI.replace(/\/\/.*@/, "//***@")}`);
  await db.connectToDatabase(MONGO_URI);

  for (const config of configs) {
    await db.upsertMonitorConfig(config);
    console.log(`[sync:monitors] Upserted: "${config.name}" (enabled=${config.enabled})`);
  }

  await db.disconnectFromDatabase();
  console.log(`[sync:monitors] Done. ${configs.length} monitor(s) synced to MongoDB.`);
}

main().catch((err) => {
  console.error("[sync:monitors] Fatal:", err);
  process.exit(1);
});
