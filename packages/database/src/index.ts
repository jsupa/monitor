export { connectToDatabase, disconnectFromDatabase, isConnected } from "./connection.js";
export { SnapshotModel } from "./models/snapshot.js";
export type { SnapshotDocument } from "./models/snapshot.js";
export { MonitorConfigModel } from "./models/monitor-config.js";
export type { MonitorConfigDocument } from "./models/monitor-config.js";

import { SnapshotModel } from "./models/snapshot.js";
import type { SnapshotDocument } from "./models/snapshot.js";
import { MonitorConfigModel } from "./models/monitor-config.js";
import type { MonitorConfigDocument } from "./models/monitor-config.js";
import type { MonitorConfig } from "@monitor/core";

/**
 * Get the last two snapshots for a monitor, newest first.
 */
export async function getLastTwoSnapshots(
  monitorName: string,
): Promise<SnapshotDocument[]> {
  return SnapshotModel.find({ monitorName })
    .sort({ createdAt: -1 })
    .limit(2)
    .exec();
}

/**
 * Push a new snapshot and prune to keep only the last 2.
 */
export async function pushSnapshot(
  monitorName: string,
  data: Record<string, unknown>,
  rawText: string,
): Promise<SnapshotDocument> {
  const doc = await SnapshotModel.create({
    monitorName,
    data,
    rawText,
    scrapedAt: new Date(),
  });

  // Prune: keep only the last 2 snapshots for this monitor
  const toDelete = await SnapshotModel.find({ monitorName })
    .sort({ createdAt: -1 })
    .skip(2)
    .select("_id")
    .exec();

  if (toDelete.length > 0) {
    await SnapshotModel.deleteMany({
      _id: { $in: toDelete.map((d) => d._id) },
    });
  }

  return doc;
}

/**
 * Load all enabled monitor configs from MongoDB.
 */
export async function loadMonitorConfigsFromDB(): Promise<MonitorConfig[]> {
  const docs = await MonitorConfigModel.find({ enabled: true }).lean().exec();
  return docs.map((doc) => ({
    name: doc.name,
    url: doc.url,
    schedule: doc.schedule,
    selector: doc.selector,
    attribute: doc.attribute,
    notifyUrl: doc.notifyUrl,
    enabled: doc.enabled,
    waitForSelector: doc.waitForSelector,
    headers: doc.headers as Record<string, string>,
    browser: doc.browser,
    dataSchema: doc.dataSchema as { description: string; fields: string[] },
    parsePrompt: doc.parsePrompt,
    rawDataPattern: doc.rawDataPattern,
  })) as MonitorConfig[];
}

/**
 * Upsert a monitor config into MongoDB (by name).
 */
export async function upsertMonitorConfig(
  config: MonitorConfig,
): Promise<MonitorConfigDocument> {
  return MonitorConfigModel.findOneAndUpdate(
    { name: config.name },
    { $set: config },
    { upsert: true, new: true },
  ).exec();
}
