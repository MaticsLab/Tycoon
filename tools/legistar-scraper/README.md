# Philadelphia Legistar scraper

A small, standalone tool for pulling **public** legislative data from
Philadelphia's Legistar site (`phila.legistar.com`) — bills/resolutions and the
meeting calendar — as JSON or CSV.

It is **not** part of the Tycoon game. It lives here as a data-ingestion helper
and shares no code with `worker/` or `shared/`. Nothing in the game imports it.

## Why a browser scraper?

Philadelphia exposes two surfaces:

1. **Legistar Web API** — `https://webapi.legistar.com/v1/phila/...`. Clean JSON,
   fast, stable. But it returns `403 Token is required`: Philadelphia (like NYC)
   gates it behind an API token you request from the **City Clerk's office**
   (Room 402, City Hall; 215-686-3410). If you get a token, use the API instead
   of this scraper — add `?token=YOUR_TOKEN` to each request. It's the better
   path for anything bulk or production.

2. **The public web UI** — no token, but it's an ASP.NET WebForms app whose
   results grid (Telerik RadGrid) loads its rows via postback. A plain `fetch`
   of the page gets an empty table. So this tool drives the page with a headless
   browser (Playwright/Chromium) and reads the rendered grid.

## Requirements

- Node 18+ (uses built-in `fetch`-free logic; only needs ESM + fs).
- **Playwright with Chromium.** The tool looks for `playwright` on the module
  path and in a couple of common global locations. If it can't find it:

  ```bash
  npm i -D playwright
  npx playwright install chromium
  ```

  or point it at an existing install:

  ```bash
  PLAYWRIGHT_MODULE=/abs/path/to/node_modules/playwright node tools/legistar-scraper/scrape.mjs ...
  ```

## Usage

```bash
# Current year's bills/resolutions, to stdout as JSON
node tools/legistar-scraper/scrape.mjs legislation

# A specific year, as CSV, to a file
node tools/legistar-scraper/scrape.mjs legislation --years 2025 --format csv --out bills-2025.csv

# "All Years" view (most-recent items — see the cap note below)
node tools/legistar-scraper/scrape.mjs legislation --years all --limit 50

# Upcoming / recent meetings
node tools/legistar-scraper/scrape.mjs calendar --format csv --out meetings.csv
```

### Options

| Flag | Meaning |
|------|---------|
| `--client <name>` | Legistar client (default `phila`). Other cities' public sites work too — `seattle`, `cook-county`, etc. |
| `--years <v>` | legislation only: `all`, `default` (current year), or a year like `2026` |
| `--max-pages <n>` | pages of results to walk (default 1). Only matters where the grid has a pager — see below. |
| `--limit <n>` | stop after N rows |
| `--delay <ms>` | pause between pages (default 1000) — be a good citizen |
| `--format <fmt>` | `json` (default) or `csv` |
| `--out <file>` | write to a file instead of stdout |
| `--headful` | show the browser window (for debugging) |

## Output

**legislation** rows:

```json
{
  "file": "260908",
  "type": "Resolution",
  "status": "IN COUNCIL",
  "created": "10/22/2026",
  "finalAction": "",
  "title": "Authorizing the Philadelphia Land Bank to dispose of ...",
  "url": "https://phila.legistar.com/LegislationDetail.aspx?ID=8297150&GUID=..."
}
```

**calendar** rows carry `name`, `date`, `time`, `location`, agenda/minutes
labels, and a `url` to the meeting record.

The `url` on each row points at the detail page, which has the full text,
sponsors, history, and attachments — a natural next step if you want to go
deeper per item.

## Known limitation: the 100-row cap

The public **Legislation** grid returns at most ~100 (most-recent) rows for any
year selection and exposes **no pager** — this is a server-side cap in the
Philadelphia install, not something the scraper can page past. So:

- `--years 2025` gives the 100 most-recent 2025 items, not all of them.
- `--max-pages` has no effect on legislation (there's no next-page control). It
  is honored on grids that *do* paginate.

To get complete history you need either the **API token** (route 1 above) or a
narrower search on the site (by committee/body or date range) that brings the
result set under 100. The `--client` flag lets you point this at other cities'
Legistar sites, where grid behavior may differ.

## Please scrape responsibly

This reads only public data, one page at a time, with a default 1s delay and a
descriptive User-Agent. Keep `--delay` reasonable, cache what you pull, and
prefer the API if you obtain a token. Check the site's terms of use before
heavy or automated use.
