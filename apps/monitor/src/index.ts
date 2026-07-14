import { loadMonitorConfigs } from "@monitor/core";
import { connectToDatabase } from "@monitor/database";
import { Scheduler } from "./scheduler.js";

async function main(): Promise<void> {
  console.log("[app] Starting Website Change Monitor...");

  const monitorsDir = process.env.MONITORS_DIR || "./monitors";
  const mongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017/monitor";

  console.log(`[app] Loading monitors from: ${monitorsDir}`);
  const configs = loadMonitorConfigs(monitorsDir);

  if (configs.length === 0) {
    console.warn("[app] No enabled monitor configs found. Exiting.");
    process.exit(0);
  }

  console.log(`[app] Loaded ${configs.length} monitor(s):`);
  for (const config of configs) {
    console.log(`  - ${config.name}: ${config.url} [${config.schedule}]`);
  }

  // Connect to MongoDB
  await connectToDatabase(mongoUri);

  // Start scheduler
  const scheduler = new Scheduler(configs);
  scheduler.start();

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n[app] Received ${signal}. Shutting down...`);
    scheduler.stop();
    const { disconnectFromDatabase } = await import("@monitor/database");
    await disconnectFromDatabase();
    console.log("[app] Goodbye.");
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[app] Fatal error:", err);
  process.exit(1);
});
