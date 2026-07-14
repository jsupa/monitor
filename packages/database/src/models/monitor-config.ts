import { Schema, model, type Document } from "mongoose";
import type { MonitorConfig } from "@monitor/core";

export interface MonitorConfigDocument
  extends Document,
    Omit<MonitorConfig, "dataSchema"> {
  dataSchema: {
    description: string;
    fields: string[];
  };
}

const dataSchemaDef = new Schema(
  {
    description: { type: String, required: true },
    fields: [{ type: String, required: true }],
  },
  { _id: false },
);

const monitorConfigSchema = new Schema<MonitorConfigDocument>(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    url: { type: String, required: true },
    schedule: { type: String, required: true },
    selector: { type: String, required: true },
    attribute: { type: String, default: "textContent" },
    notifyUrl: { type: String, default: null },
    enabled: { type: Boolean, default: true },
    waitForSelector: { type: String, default: null },
    headers: { type: Schema.Types.Mixed, default: {} },
    browser: { type: String, default: null },
    dataSchema: { type: dataSchemaDef, required: true },
    parsePrompt: { type: String, default: null },
    rawDataPattern: { type: String, default: null },
  },
  {
    timestamps: true,
  },
);

export const MonitorConfigModel = model<MonitorConfigDocument>(
  "MonitorConfig",
  monitorConfigSchema,
);
