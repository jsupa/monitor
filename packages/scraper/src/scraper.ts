import { Window } from "happy-dom";

export interface ScrapeOptions {
  /** CSS selector to query after page load */
  selector: string;
  /** What to extract: textContent, innerHTML, or a named HTML attribute */
  attribute?: "textContent" | "innerHTML" | string;
  /** Optional: wait for this selector to appear before querying */
  waitForSelector?: string;
  /** Optional custom HTTP headers */
  headers?: Record<string, string>;
  /** Timeout in milliseconds */
  timeout?: number;
  /** Browser to emulate via impit (e.g. "chrome136") */
  browser?: string;
}

export interface ScrapeResult {
  value: string | null;
  html: string;
}

export interface FetchRawOptions {
  headers?: Record<string, string>;
  timeout?: number;
  browser?: string;
}

// Shared impit fetch
async function fetchPage(
  url: string,
  options: { headers?: Record<string, string>; timeout?: number; browser?: string },
): Promise<string> {
  const { headers = {}, timeout = 120_000, browser } = options;

  const { Impit } = await import("impit");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const client = new Impit({
      timeout,
      headers: {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "Sec-Ch-Ua": '"Chromium";v="136", "Google Chrome";v="136", "Not.A/Brand";v="99"',
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": '"macOS"',
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
        ...headers,
      },
      browser: browser as import("impit").Browser | undefined,
    });

    const response = await client.fetch(url, { signal: controller.signal });

    if (!response.ok) {
      throw new Error(
        `[scraper] HTTP ${response.status} for "${url}": ${response.statusText}`,
      );
    }

    return await response.text();
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(`[scraper] Request timed out after ${timeout}ms for "${url}"`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Fetch a page and return the raw HTML — no DOM parsing.
 * Use for regex extraction or feeding HTML to an LLM directly.
 */
export async function fetchRaw(url: string, options: FetchRawOptions = {}): Promise<string> {
  return fetchPage(url, options);
}

/**
 * Fetch a page with impit, parse with happy-dom, and query a CSS selector.
 */
export async function fetchAndQuery(
  url: string,
  options: ScrapeOptions,
): Promise<ScrapeResult> {
  const { selector, attribute = "textContent", waitForSelector } = options;

  const html = await fetchPage(url, options);

  const window = new Window();
  const document = window.document;
  document.write(html);

  try {
    await Promise.race([
      window.happyDOM.waitUntilComplete(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("happy-dom timeout")), 15_000),
      ),
    ]);
  } catch {
    // continue with partial DOM
  }

  if (waitForSelector) {
    const waited = document.querySelector(waitForSelector);
    if (!waited) {
      console.warn(
        `[scraper] waitForSelector "${waitForSelector}" not found on "${url}"`,
      );
    }
  }

  const element = document.querySelector(selector);
  if (!element) {
    window.close();
    return { value: null, html };
  }

  let value: string | null;
  if (attribute === "innerHTML") {
    value = element.innerHTML;
  } else if (attribute === "textContent") {
    value = element.textContent;
  } else {
    value = element.getAttribute(attribute);
  }

  window.close();
  return { value, html };
}
