import type { ChangeRecord } from "@monitor/core";

const DESC_MAX = 4096;

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + "...";
}

export async function sendChangeNotification(
  webhookUrl: string,
  change: ChangeRecord,
): Promise<void> {
  const color =
    change.significance === "first_run"
      ? 0x2ecc71 // green
      : 0xe74c3c; // red

  const title =
    change.significance === "first_run"
      ? `📸 First Snapshot · ${change.monitorName}`
      : `🔔 Change · ${change.monitorName}`;

  const description =
    change.significance === "first_run"
      ? "Initial snapshot captured. Changes will be reported here when detected."
      : change.summary;

  const embed = {
    title: truncate(title, 256),
    url: change.url,
    color,
    description: truncate(description, DESC_MAX),
    timestamp: new Date(change.scrapedAt).toISOString(),
    footer: { text: `monitor · ${change.monitorName}` },
  };

  const body = { embeds: [embed] };

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "unknown");
    throw new Error(
      `[notifier] Discord webhook failed (${response.status}): ${errorBody}`,
    );
  }

  const remaining = response.headers.get("X-RateLimit-Remaining");
  if (remaining !== null) {
    console.log(`[notifier] Discord rate limit — remaining: ${remaining}`);
  }
}
