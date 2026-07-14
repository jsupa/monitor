import cron from "node-cron";
import type { MonitorConfig } from "@monitor/core";
import { runMonitorCheck } from "./worker.js";

export class Scheduler {
  private configs: MonitorConfig[];
  private tasks: cron.ScheduledTask[] = [];

  constructor(configs: MonitorConfig[]) {
    this.configs = configs;
  }

  start(): void {
    for (const config of this.configs) {
      if (!cron.validate(config.schedule)) {
        console.error(
          `[scheduler] Invalid cron expression "${config.schedule}" for monitor "${config.name}". Skipping.`,
        );
        continue;
      }

      const task = cron.schedule(config.schedule, async () => {
        console.log(
          `[scheduler] Running monitor "${config.name}" [${new Date().toISOString()}]`,
        );
        try {
          await runMonitorCheck(config);
        } catch (err) {
          console.error(
            `[scheduler] Error in monitor "${config.name}":`,
            (err as Error).message,
          );
        }
      });

      this.tasks.push(task);
      console.log(
        `[scheduler] Registered "${config.name}" on schedule "${config.schedule}"`,
      );
    }
  }

  stop(): void {
    for (const task of this.tasks) {
      task.stop();
    }
    console.log(`[scheduler] Stopped ${this.tasks.length} monitor(s).`);
  }
}
