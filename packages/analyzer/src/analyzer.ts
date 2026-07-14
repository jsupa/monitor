import OpenAI from "openai";
import type { DataSchemaDef, DiffResult } from "@monitor/core";

const DEFAULT_MODEL = "deepseek-v4-pro";
const DEFAULT_BASE_URL = "https://api.deepseek.com";

function getClient(): OpenAI {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) {
    throw new Error("[analyzer] LLM_API_KEY environment variable is not set");
  }

  const baseURL = process.env.LLM_BASE_URL || DEFAULT_BASE_URL;

  return new OpenAI({
    apiKey,
    baseURL,
    timeout: 30_000,
    maxRetries: 1,
  });
}

function getModel(): string {
  return process.env.LLM_MODEL || DEFAULT_MODEL;
}

/**
 * Use the LLM to parse raw scraped text into structured JSON.
 * Uses the monitor's parsePrompt if provided, otherwise falls back
 * to a generic extraction prompt guided by dataSchema.
 */
export async function parseContent(
  rawText: string,
  dataSchema: DataSchemaDef,
  parsePrompt?: string,
): Promise<Record<string, unknown>> {
  const client = getClient();
  const model = getModel();

  const systemPrompt = parsePrompt
    ? `${parsePrompt}\n\nReturn ONLY a valid JSON object. No markdown, no explanations.`
    : buildDefaultParsePrompt(dataSchema);

  const response = await client.chat.completions.create({
    model,
    temperature: 0,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: rawText },
    ],
    response_format: { type: "json_object" },
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("[analyzer] LLM returned empty response for parseContent");
  }

  try {
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    throw new Error(
      `[analyzer] Failed to parse LLM response as JSON. Content: ${content.slice(0, 500)}`,
    );
  }
}

/**
 * Build a default parse prompt from the dataSchema definition.
 */
function buildDefaultParsePrompt(dataSchema: DataSchemaDef): string {
  const fieldList = dataSchema.fields.join(", ");

  return `You are a precise data extraction tool. Given raw content scraped from a website (HTML or text), extract structured data into a JSON object.

Context: ${dataSchema.description}
Expected top-level fields: ${fieldList}

Rules:
- Return ONLY valid JSON, no markdown fences, no explanations.
- Use null for missing values.
- Keep string values clean — trim whitespace, normalize.
- Preserve numeric values as numbers when appropriate.
- If the input is HTML, extract data from the relevant elements.`;
}

/**
 * Use the LLM to compare old and new structured data snapshots.
 * Returns a significance classification and a human-readable summary.
 */
export async function diffSnapshots(
  oldData: Record<string, unknown> | null,
  newData: Record<string, unknown>,
): Promise<DiffResult> {
  const client = getClient();
  const model = getModel();

  // First run — no old data to compare
  if (oldData === null) {
    return {
      significance: "first_run" as "meaningful",
      summary: "Initial snapshot captured.",
    };
  }

  const response = await client.chat.completions.create({
    model,
    temperature: 0,
    messages: [
      {
        role: "system",
        content: `You are a change detection analyst. Compare two JSON snapshots of scraped website data.

Classify the change as:
- "meaningful": Real content change (price changed, new text, item sold out, backer count changed, availability changed, new/deleted items, etc.)
- "noise": Irrelevant change (timestamps, view counters, random IDs, minor formatting)

Return a JSON object with:
- "significance": "meaningful" or "noise"
- "summary": A short human-readable description of what changed. If noise, explain why it's noise. If meaningful, be specific about what changed.`,
      },
      {
        role: "user",
        content: `Old data:\n${JSON.stringify(oldData, null, 2)}\n\nNew data:\n${JSON.stringify(newData, null, 2)}`,
      },
    ],
    response_format: { type: "json_object" },
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("[analyzer] LLM returned empty response for diffSnapshots");
  }

  const parsed = JSON.parse(content) as { significance: string; summary: string };

  if (parsed.significance !== "meaningful" && parsed.significance !== "noise") {
    return { significance: "meaningful", summary: parsed.summary || "Unknown change detected." };
  }

  return {
    significance: parsed.significance as "meaningful" | "noise",
    summary: parsed.summary,
  };
}
