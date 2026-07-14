export { connectToDatabase, disconnectFromDatabase, isConnected } from "./connection.js";
export { SnapshotModel } from "./models/snapshot.js";
export type { SnapshotDocument } from "./models/snapshot.js";

import { SnapshotModel } from "./models/snapshot.js";
import type { SnapshotDocument } from "./models/snapshot.js";

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
