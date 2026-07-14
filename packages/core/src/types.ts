import { z } from "zod";

// ---- Monitor Config ----

export const dataSchemaDef = z.object({
  description: z.string().min(1).describe("What this data represents"),
  fields: z.array(z.string()).min(1).describe("Field names the AI should extract"),
});

export const monitorConfigSchema = z.object({
  name: z.string().min(1).max(100),
  url: z.string().url(),
  schedule: z.string().min(1).describe("Cron expression"),
  selector: z.string().min(1).describe("CSS selector to watch"),
  attribute: z
    .string()
    .default("textContent")
    .describe(
      "What to extract: 'textContent', 'innerHTML', or an HTML attribute name like 'data-initial_state'",
    ),
  notifyUrl: z
    .string()
    .url()
    .nullable()
    .default(null)
    .describe("Optional Discord webhook override"),
  enabled: z.boolean().default(true),
  waitForSelector: z
    .string()
    .nullable()
    .default(null)
    .describe("Optional: wait for this selector before scraping"),
  headers: z
    .record(z.string(), z.string())
    .default({})
    .describe("Optional custom request headers"),
  browser: z
    .string()
    .nullable()
    .default(null)
    .describe(
      "Optional browser to emulate via impit (e.g. 'chrome136'). Uses TLS fingerprinting to bypass bot detection.",
    ),
  dataSchema: dataSchemaDef.describe(
    "Describes the JSON shape the AI should parse scraped content into",
  ),
  parsePrompt: z
    .string()
    .nullable()
    .default(null)
    .describe(
      "Optional custom system prompt for the LLM parser.",
    ),
  rawDataPattern: z
    .string()
    .nullable()
    .default(null)
    .describe(
      "Regex with capture group to extract JSON from raw HTML. Skips happy-dom. E.g. 'data-initial_state=\"([^\"]+)\"'",
    ),
});

export type MonitorConfig = z.infer<typeof monitorConfigSchema>;
export type DataSchemaDef = z.infer<typeof dataSchemaDef>;

// ---- Change / Diff Results ----

export interface ChangeRecord {
  monitorName: string;
  url: string;
  scrapedAt: string;
  oldData: Record<string, unknown> | null;
  newData: Record<string, unknown>;
  rawText: string;
  significance: "meaningful" | "noise" | "first_run";
  summary: string;
}

export interface DiffResult {
  significance: "meaningful" | "noise";
  summary: string;
}

// ---- Snapshot (stored in MongoDB) ----

export interface SnapshotData {
  monitorName: string;
  data: Record<string, unknown>;
  rawText: string;
  scrapedAt: Date;
}
