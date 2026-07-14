import type { MonitorConfig, ChangeRecord } from "@monitor/core";
import { fetchAndQuery, fetchRaw } from "@monitor/scraper";
import { parseContent, diffSnapshots } from "@monitor/analyzer";
import { getLastTwoSnapshots, pushSnapshot } from "@monitor/database";
import { sendChangeNotification } from "@monitor/notifier";

export async function runMonitorCheck(config: MonitorConfig): Promise<void> {
  const notifyUrl = config.notifyUrl || process.env.DISCORD_WEBHOOK_URL;
  if (!notifyUrl) {
    console.warn(`[worker:${config.name}] No webhook URL configured.`);
  }

  let parsedData: Record<string, unknown>;
  let rawText: string;

  // ── 1. Fetch & extract ───────────────────────────────────────

  if (config.rawDataPattern) {
    // Fast path: regex extract structured JSON from raw HTML
    console.log(`[worker:${config.name}] Fetching (raw+regex)...`);
    rawText = await fetchRaw(config.url, {
      headers: config.headers,
      browser: config.browser ?? undefined,
    });
    console.log(`[worker:${config.name}] ${rawText.length} chars.`);

    const match = new RegExp(config.rawDataPattern).exec(rawText);
    if (!match?.[1]) {
      console.warn(`[worker:${config.name}] Pattern not matched.`);
      return;
    }

    const decoded = match[1]
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");

    try {
      const raw = JSON.parse(decoded);
      parsedData = transformRawData(raw, config);
    } catch {
      console.error(`[worker:${config.name}] JSON parse failed.`);
      return;
    }
  } else {
    // Standard path: CSS selector + happy-dom + AI parse
    console.log(`[worker:${config.name}] Fetching (DOM)...`);
    const result = await fetchAndQuery(config.url, {
      selector: config.selector,
      attribute: config.attribute,
      waitForSelector: config.waitForSelector ?? undefined,
      headers: config.headers,
      browser: config.browser ?? undefined,
    });

    if (result.value === null) {
      console.warn(`[worker:${config.name}] Selector not found.`);
      return;
    }

    rawText = result.value;
    console.log(`[worker:${config.name}] ${rawText.length} chars.`);

    try {
      parsedData = await parseContent(
        rawText,
        config.dataSchema,
        config.parsePrompt ?? undefined,
      );
    } catch (err) {
      console.error(`[worker:${config.name}] AI parse failed:`, (err as Error).message);
      parsedData = { raw: rawText };
    }
  }

  console.log(`[worker:${config.name}] Data: ${JSON.stringify(parsedData).slice(0, 200)}`);

  // ── 2. Load history ──────────────────────────────────────────

  const snapshots = await getLastTwoSnapshots(config.name);
  const oldData = snapshots[0]?.data ?? null;

  // ── 3. LLM diff ──────────────────────────────────────────────

  let change: ChangeRecord;
  try {
    const diff = await diffSnapshots(oldData, parsedData);
    change = {
      monitorName: config.name,
      url: config.url,
      scrapedAt: new Date().toISOString(),
      oldData,
      newData: parsedData,
      rawText: rawText!.slice(0, 2000),
      significance: diff.significance === "first_run" ? "first_run" : diff.significance,
      summary: diff.summary,
    };
  } catch (err) {
    console.error(`[worker:${config.name}] Diff failed:`, (err as Error).message);
    change = {
      monitorName: config.name,
      url: config.url,
      scrapedAt: new Date().toISOString(),
      oldData,
      newData: parsedData,
      rawText: rawText!.slice(0, 2000),
      significance: "meaningful",
      summary: oldData ? "Change detected." : "Initial snapshot.",
    };
  }

  // ── 4. Notify (only meaningful changes) ──────────────────────

  if (change.significance !== "noise" && notifyUrl) {
    console.log(
      `[worker:${config.name}] ${change.significance === "first_run" ? "First run" : "Change"}: ${change.summary}`,
    );
    try {
      await sendChangeNotification(notifyUrl, change);
      console.log(`[worker:${config.name}] Discord sent.`);
    } catch (err) {
      console.error(`[worker:${config.name}] Discord failed:`, (err as Error).message);
    }
  } else if (change.significance === "noise") {
    console.log(`[worker:${config.name}] Noise: ${change.summary}`);
  }

  // ── 5. Store ─────────────────────────────────────────────────

  await pushSnapshot(config.name, parsedData, rawText!.slice(0, 5000));
  console.log(`[worker:${config.name}] Stored.`);
}

/** Transform raw extracted JSON into the monitor's expected shape. */
function transformRawData(
  raw: Record<string, unknown>,
  config: MonitorConfig,
): Record<string, unknown> {
  return raw;
}
