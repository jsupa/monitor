# Website Change Monitor

A Node.js/TypeScript monorepo that monitors website elements for changes on cron schedules. Fetches pages with **impit**, parses DOM with **happy-dom**, uses **DeepSeek** (or any OpenAI-compatible LLM) to extract structured JSON and detect meaningful changes, stores snapshots in **MongoDB**, and sends rich embed notifications to **Discord**.

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│  monitors/   │────▶│  sync:monitors│────▶│   MongoDB    │
│  *.json      │     │  upsert to DB │     │ MonitorConfig│
│  (configs)   │     └──────────────┘     │  collection  │
└─────────────┘                           └──────┬───────┘
                                                  │
                                                  ▼
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│  @monitor/  │◀────│  load from   │     │  @monitor/   │
│  scheduler  │     │  MongoDB     │     │  app         │
│  node-cron  │     └──────────────┘     │  entry       │
└──────┬──────┘                          └──────────────┘
       │ cron tick
       ▼
┌──────────────────────────────────────────────────────────┐
│                    Worker Pipeline                         │
│                                                          │
│  1. Scrape         2. AI Parse        3. Load History    │
│  impit fetch ──▶  DeepSeek ──▶     MongoDB snapshots    │
│  + happy-dom      raw→JSON          (last 2 per monitor) │
│                                                          │
│  4. AI Diff        5. Notify          6. Store           │
│  old vs new ──▶   Discord ──▶      MongoDB push         │
│  JSON compare     rich embed        (prune to 2)         │
└──────────────────────────────────────────────────────────┘
```

### Packages

| Package | Purpose | Key Dependencies |
|---|---|---|
| `@monitor/core` | Shared types, Zod schemas, config loader | `zod` |
| `@monitor/scraper` | Page fetching + DOM parsing | `impit`, `happy-dom` |
| `@monitor/analyzer` | LLM-powered JSON parsing + change diffing | `openai` (DeepSeek-compatible) |
| `@monitor/database` | MongoDB connection + models (snapshots, monitor configs) | `mongoose` |
| `@monitor/notifier` | Discord webhook rich embeds | — |
| `@monitor/app` | CLI entry point, cron scheduler, worker | `node-cron`, `tsdown` |

## Setup

### Prerequisites

- **Node.js** ≥ 22
- **pnpm** ≥ 9
- **MongoDB** running locally or a connection URI
- **DeepSeek API key** (or any OpenAI-compatible provider)

### 1. Clone and install

```bash
git clone <repo-url> && cd monitor
pnpm install
```

### 2. Environment variables

```bash
cp .env.example .env
```

Edit `.env`:

```bash
# Required: Discord webhook URL for notifications
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/XXX/YYY

# Required: LLM API key (DeepSeek by default)
LLM_API_KEY=sk-your-deepseek-api-key

# Optional overrides
# LLM_BASE_URL=https://api.deepseek.com     # default
# LLM_MODEL=deepseek-v4-pro                 # default

# Required: MongoDB connection
MONGODB_URI=mongodb://localhost:27017/monitor
```

> **Using OpenAI instead of DeepSeek?** Set `LLM_BASE_URL=https://api.openai.com/v1` and `LLM_MODEL=gpt-4o-mini`.

### 3. Build

```bash
pnpm build
```

### 4. Create and sync monitor configs

Place `.json` files in the `monitors/` directory, then sync them to MongoDB:

```bash
# Create a monitor config
cp monitors/example.json monitors/my-site.json
# Edit my-site.json with your URL, selector, and schedule

# Sync all monitors from ./monitors/ to MongoDB
pnpm sync:monitors
```

**Monitor configs are stored in MongoDB** — the app loads them from the database at runtime. The `sync:monitors` command reads all `.json` files from `./monitors/`, validates them, and upserts them into the `monitorconfigs` MongoDB collection by name.

To update monitors after editing the JSON files, just run `pnpm sync:monitors` again. Disabled monitors (`"enabled": false`) are synced too but won't be loaded by the app.

### 5. Run

```bash
pnpm --filter @monitor/app start
```

## Monitor Config

Each monitor is a JSON file in the `monitors/` directory. Every file represents one website element to track.

### Full schema

```jsonc
{
  // Unique name for this monitor (used in logs, Discord, MongoDB)
  "name": "my-monitor",

  // The URL to scrape
  "url": "https://example.com/page",

  // Cron expression for how often to check
  // */5 * * * *  = every 5 minutes
  // 0 * * * *    = every hour
  // 0 9 * * 1-5  = weekdays at 9am
  "schedule": "*/5 * * * *",

  // CSS selector for the element to extract
  "selector": ".price-value",

  // What to extract from the element
  // "textContent" = visible text only
  // "innerHTML"   = full HTML (use for parsing multiple items)
  "attribute": "textContent",

  // Enable/disable this monitor
  "enabled": true,

  // Optional: Discord webhook override for this monitor only
  // When null, uses DISCORD_WEBHOOK_URL from .env
  "notifyUrl": null,

  // Optional: wait for this selector to exist before extracting
  // Useful for JS-rendered pages (Kickstarter, SPAs, etc.)
  "waitForSelector": "[data-testid=\"reward-item\"]",

  // Optional: custom HTTP request headers
  "headers": {
    "Accept-Language": "en-US,en;q=0.9"
  },

  // Describes what data the AI should extract
  "dataSchema": {
    "description": "What this data represents",
    "fields": ["field1", "field2"]
  },

  // Optional: custom system prompt for the LLM parser
  // Overrides the default extraction prompt entirely.
  // Use for complex pages where you need specific extraction rules.
  "parsePrompt": "You are a data extraction tool. Extract the following..."
}
```

### Example: Kickstarter rewards tracker

See [`monitors/nanokvm-go.json`](./monitors/nanokvm-go.json) for a real-world example that:

- Scrapes Kickstarter every 5 minutes
- Uses `rawDataPattern` to extract embedded JSON from `data-initial_state`
- Has a custom `dataSchema` teaching the LLM to extract reward tiers
- Sends a rich Discord embed when backer counts change or tiers sell out

### Example: Simple price watch

```jsonc
{
  "name": "product-price-watch",
  "url": "https://shop.example.com/product/123",
  "schedule": "0 * * * *",
  "selector": "[data-price]",
  "attribute": "textContent",
  "enabled": true,
  "dataSchema": {
    "description": "Product price",
    "fields": ["price", "currency"]
  }
}
```

## How It Works

### Scraping

`@monitor/scraper` uses **impit** (a browser-emulating HTTP client by Apify) to fetch the page. It mimics real browser TLS fingerprints, headers, and ciphers — bypassing basic bot detection. The response HTML is parsed with **happy-dom** (a lightweight DOM implementation) and the configured CSS selector is queried.

### AI Parsing

`@monitor/analyzer` sends the scraped content to the LLM with structured output (`response_format: { type: "json_object" }`). Two distinct steps:

1. **Parse** — raw HTML/text → structured JSON (guided by `dataSchema` and optional `parsePrompt`)
2. **Diff** — old JSON vs new JSON → `{ significance: "meaningful" | "noise", summary: "..." }`

If `parsePrompt` is set in the monitor config, it replaces the default extraction prompt entirely — giving you full control over how the LLM interprets the page.

### Storage

`@monitor/database` stores the **last 2 snapshots** per monitor in MongoDB. Each snapshot contains:

- `monitorName` — which monitor
- `data` — the AI-parsed JSON object
- `rawText` — original scraped text
- `scrapedAt` — timestamp

**Monitor configs** are also stored in MongoDB (in the `monitorconfigs` collection), synced via `pnpm sync:monitors`. The app loads configs from the database at startup, so no file mounts are needed in production.

On each new check, the oldest snapshot is pruned (only 2 kept).

### Notifications

`@monitor/notifier` sends a **rich Discord embed** when a meaningful change is detected:

| Field | Content |
|---|---|
| 🤖 AI Analysis | Human-readable summary of what changed |
| 📋 Current Rewards | Formatted table of parsed data |
| 🔄 Changes | Per-item diff (backers +X, status change, etc.) |
| 📊 Raw Data | Full JSON for debugging |

**Color coding**: 🟢 green = first snapshot, 🔴 red = change detected.

### Scheduling

`@monitor/app` uses **node-cron** to run each monitor on its configured schedule. The scheduler validates cron expressions, runs checks asynchronously (errors don't crash the process), and handles graceful shutdown on SIGINT/SIGTERM.

## Project Structure

```
monitor/
├── package.json                 # Root workspace + scripts
├── pnpm-workspace.yaml          # Workspace definition
├── turbo.json                   # Turborepo build pipeline
├── tsconfig.base.json           # Shared TypeScript config
├── .env.example                 # Environment template
├── sync-monitors.ts             # CLI script: sync monitors/ → MongoDB
│
├── packages/
│   ├── core/src/                # Types, schemas, config loader
│   ├── scraper/src/             # impit + happy-dom fetcher
│   ├── analyzer/src/            # DeepSeek/OpenAI integration
│   ├── database/src/            # MongoDB + Mongoose models
│   └── notifier/src/            # Discord webhook embeds
│
├── apps/
│   └── monitor/src/             # CLI entry, scheduler, worker
│
└── monitors/                    # Your monitor configs live here
    ├── example.json
    └── nanokvm-go.json
```

## Scripts

```bash
pnpm install          # Install all dependencies
pnpm build            # Build all packages (Turborepo)
pnpm dev              # Watch mode for all packages
pnpm clean            # Remove build artifacts

# Sync monitor configs from ./monitors/ to MongoDB
pnpm sync:monitors

# Run the monitor app
pnpm --filter @monitor/app start
```

## Docker

```bash
# Build and push
pnpm docker:release

# Or just build locally
pnpm docker:build

# Run (MongoDB must be accessible from the container)
docker compose up -d
```

The app loads monitor configs from MongoDB at runtime. Run `pnpm sync:monitors` before starting the container to seed the database, or run it inside the container:

```bash
docker compose exec monitor node -e "require('child_process').execSync('pnpm sync:monitors', {cwd:'/app', stdio:'inherit'})"
```

## Deployment

### PM2

```bash
pm2 start apps/monitor/dist/index.js --name website-monitor
```

### systemd

```ini
[Service]
WorkingDirectory=/opt/monitor
ExecStart=/usr/bin/node apps/monitor/dist/index.js
Restart=always
EnvironmentFile=/opt/monitor/.env
```
