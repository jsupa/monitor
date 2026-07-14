import { connectToDatabase, loadMonitorConfigsFromDB } from "@monitor/database";
import { Scheduler } from "./scheduler.js";

async function main(): Promise<void> {
  console.log("[app] Starting Website Change Monitor...");

  const mongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017/monitor";

  // Connect to MongoDB first
  await connectToDatabase(mongoUri);

  // Load monitor configs from DB
  const configs = await loadMonitorConfigsFromDB();

  if (configs.length === 0) {
    console.warn("[app] No enabled monitor configs found in DB. Retrying every 30s...");
    const CHECK_INTERVAL_MS = 30_000;
    const recheck = async () => {
      const fresh = await loadMonitorConfigsFromDB();
      if (fresh.length > 0) {
        console.log(`[app] Found ${fresh.length} enabled monitor(s), starting...`);
        const scheduler = new Scheduler(fresh);
        scheduler.start();
        return;
      }
      setTimeout(recheck, CHECK_INTERVAL_MS);
    };
    setTimeout(recheck, CHECK_INTERVAL_MS);
    return;
  }

  console.log(`[app] Loaded ${configs.length} monitor(s):`);
  for (const config of configs) {
    console.log(`  - ${config.name}: ${config.url} [${config.schedule}]`);
  }

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
