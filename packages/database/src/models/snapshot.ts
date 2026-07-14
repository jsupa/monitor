import { Schema, model, type Document } from "mongoose";
import type { SnapshotData } from "@monitor/core";

export interface SnapshotDocument extends Document, Omit<SnapshotData, "monitorName"> {
  monitorName: string;
}

const snapshotSchema = new Schema<SnapshotDocument>(
  {
    monitorName: {
      type: String,
      required: true,
      index: true,
    },
    data: {
      type: Schema.Types.Mixed,
      required: true,
    },
    rawText: {
      type: String,
      required: true,
    },
    scrapedAt: {
      type: Date,
      required: true,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  },
);

// Compound index for efficient queries: get latest snapshots per monitor
snapshotSchema.index({ monitorName: 1, createdAt: -1 });

export const SnapshotModel = model<SnapshotDocument>("Snapshot", snapshotSchema);
