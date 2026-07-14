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

    let rawData: Record<string, unknown>;
    try {
      rawData = JSON.parse(decoded);
    } catch {
      console.error(`[worker:${config.name}] JSON parse failed.`);
      return;
    }

    // If a parsePrompt is set, run AI extraction on the raw JSON
    if (config.parsePrompt) {
      try {
        const rawJsonStr = JSON.stringify(rawData, null, 2).slice(0, 30_000);
        parsedData = await parseContent(
          rawJsonStr,
          config.dataSchema,
          config.parsePrompt ?? undefined,
        );
      } catch (err) {
        console.error(`[worker:${config.name}] AI parse failed:`, (err as Error).message);
        parsedData = transformRawData(rawData, config);
      }
    } else {
      parsedData = transformRawData(rawData, config);
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

/** Transform raw extracted JSON into a focused subset for AI parsing. */
function transformRawData(
  raw: Record<string, unknown>,
  _config: MonitorConfig,
): Record<string, unknown> {
  // Kickstarter: hydrateData.project.rewards.nodes + project metadata
  const ks = extractKickstarterData(raw);
  if (ks) return ks;

  // Generic: search for project-like data with rewards
  const found = findRewards(raw);
  if (found) return found;

  // Fallback: top-level keys
  const slim: Record<string, unknown> = {};
  for (const key of Object.keys(raw).slice(0, 30)) {
    slim[key] = raw[key];
  }
  return slim;
}

/** Extract Kickstarter project data from the hydrateData structure. */
function extractKickstarterData(
  raw: Record<string, unknown>,
): Record<string, unknown> | null {
  try {
    const hd = raw.hydrateData as Record<string, unknown> | undefined;
    if (!hd) return null;
    const project = hd.project as Record<string, unknown> | undefined;
    if (!project) return null;
    const rewards = project.rewards as Record<string, unknown> | undefined;
    const nodes = rewards?.nodes as Array<Record<string, unknown>> | undefined;
    if (!nodes || nodes.length === 0) return null;

    const slimRewards = nodes.map((r: Record<string, unknown>) => ({
      name: r.name,
      description: r.description,
      price: (r.amount as Record<string, unknown>)?.amount,
      currency: (r.amount as Record<string, unknown>)?.currency,
      backersCount: r.backersCount,
      limit: r.limit ?? null,
      remainingQuantity: r.remainingQuantity ?? null,
      available: r.available,
      estimatedDeliveryOn: r.estimatedDeliveryOn,
      shippingSummary: r.shippingSummary,
      isMaxPledge: r.isMaxPledge,
      items: ((r.items as Record<string, unknown>)?.nodes as Array<Record<string, unknown>>)
        ?.map((i: Record<string, unknown>) => i.name).filter(Boolean) ?? [],
    }));

    return {
      projectName: project.name,
      projectSlug: project.slug,
      currency: project.currency,
      projectDeadline: project.deadlineAt,
      rewards: slimRewards,
    };
  } catch {
    return null;
  }
}

/** Recursively search for a project node with rewards inside a Kickstarter JSON. */
function findRewards(
  obj: unknown,
  depth = 0,
): Record<string, unknown> | null {
  if (depth > 8 || obj == null || typeof obj !== "object") return null;

  if (Array.isArray(obj)) {
    // If this array has reward-like objects (have title/price/backers), return the parent context
    for (const item of obj.slice(0, 3)) {
      if (item && typeof item === "object") {
        const keys = Object.keys(item as Record<string, unknown>);
        const rewardKeys = ["title", "price", "pledgeAmount", "backersCount", "limit", "remaining", "available"];
        const matchCount = rewardKeys.filter((k) => keys.includes(k)).length;
        if (matchCount >= 3) {
          return { rewards: obj.slice(0, 50) };
        }
      }
    }
    // Recurse into array items
    for (const item of obj.slice(0, 20)) {
      const found = findRewards(item, depth + 1);
      if (found) return found;
    }
    return null;
  }

  const record = obj as Record<string, unknown>;
  const keys = Object.keys(record);

  // If this looks like a project node (has rewards + project-like keys), return slimmed version
  const projectKeys = ["rewards", "backersCount", "currency", "name", "slug", "state", "goal"];
  const projectMatch = projectKeys.filter((k) => keys.includes(k)).length;
  if (projectMatch >= 3 && Array.isArray(record.rewards)) {
    return {
      name: record.name,
      slug: record.slug,
      currency: record.currency,
      backersCount: record.backersCount,
      goal: record.goal,
      state: record.state,
      pledged: record.pledged,
      rewards: (record.rewards as unknown[]).slice(0, 50),
    };
  }

  // Recurse into object values
  const priorityKeys = [
    "project", "projectPage", "pageProps", "apolloState", "props",
    "initialState", "state", "data", "rootQuery", "ROOT_QUERY",
  ];
  const sortedKeys = [
    ...priorityKeys.filter((k) => keys.includes(k)),
    ...keys.filter((k) => !priorityKeys.includes(k)),
  ];

  for (const key of sortedKeys.slice(0, 30)) {
    const found = findRewards(record[key], depth + 1);
    if (found) return found;
  }

  return null;
}
