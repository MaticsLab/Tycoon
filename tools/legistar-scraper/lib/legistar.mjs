// Core scraping logic for Philadelphia's public Legistar site (phila.legistar.com).
//
// The city's Legistar Web API (webapi.legistar.com/v1/phila) requires an API
// token the City Clerk issues on request. Until you have one, the public web
// UI is the only open surface — but it's an ASP.NET WebForms app with a
// Telerik RadGrid that loads its rows via postback, so a plain fetch of the
// page returns an empty grid. We drive it with a headless browser instead.
//
// This module is deliberately standalone: it does not import anything from the
// game worker/ or shared/ code, and nothing in the game imports it. It is a
// data-ingestion tool, run with `node`, not part of the deployed Worker.

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// Playwright isn't a dependency of this repo (the Worker can't use it), but the
// cloud session and most dev machines have it available globally. Resolve it
// from a few likely places rather than assuming it sits in ./node_modules.
export function loadChromium() {
  const names = [process.env.PLAYWRIGHT_MODULE, 'playwright', 'playwright-core'].filter(Boolean);
  const extraBases = [
    '/opt/node-tools/node_modules',
    process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/../node_modules`,
  ].filter(Boolean);

  for (const name of names) {
    try {
      const mod = require(name);
      if (mod?.chromium) return mod.chromium;
    } catch { /* try next */ }
  }
  for (const base of extraBases) {
    for (const name of ['playwright', 'playwright-core']) {
      try {
        const mod = require(require.resolve(name, { paths: [base] }));
        if (mod?.chromium) return mod.chromium;
      } catch { /* try next */ }
    }
  }
  throw new Error(
    'Playwright is not installed. Install it with `npm i -D playwright && npx playwright install chromium`, ' +
    'or set PLAYWRIGHT_MODULE to an absolute path to a playwright install.',
  );
}

export const DEFAULT_CLIENT = 'phila';
const BASE = (client) => `https://${client}.legistar.com`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Map a RadGrid header label to a stable camelCase key.
const HEADER_KEYS = {
  'file #': 'file',
  'type': 'type',
  'status': 'status',
  'file created': 'created',
  'final action': 'finalAction',
  'title': 'title',
  'name': 'name',
  'meeting date': 'date',
  'meeting time': 'time',
  'meeting location': 'location',
  'agenda': 'agenda',
  'minutes': 'minutes',
};

function keyFor(label, index) {
  const norm = label.toLowerCase().replace(/\s+/g, ' ').trim();
  return HEADER_KEYS[norm] || norm.replace(/[^a-z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : '')) || `col${index}`;
}

// Read the currently-rendered RadGrid into an array of row objects. Runs inside
// the page context. Column order is read from the header, so a reordering on
// the city's side won't silently shift field values.
async function readGrid(page) {
  return page.evaluate(() => {
    const table = document.querySelector('table[id$="_gridMain_ctl00"], table.rgMasterTable');
    if (!table) return { headers: [], rows: [] };

    // Read only the first header row's cells, so headers line up 1:1 with the
    // <td>s in each data row. (A blank header — e.g. an icon column — is kept
    // as a positional placeholder rather than dropped, to preserve alignment.)
    const headRow = table.querySelector('thead tr');
    const headers = headRow ? [...headRow.children].map((c) => c.innerText.replace(/\s+/g, ' ').trim()) : [];

    const rows = [...table.querySelectorAll('tr.rgRow, tr.rgAltRow')].map((tr) => {
      const cells = [...tr.querySelectorAll('td')];
      const texts = cells.map((td) => td.innerText.replace(/\s+/g, ' ').trim());
      const links = {};
      for (const a of tr.querySelectorAll('a[href]')) {
        const href = a.getAttribute('href') || '';
        if (/Detail\.aspx/i.test(href) || /View\.ashx/i.test(href)) {
          const label = (a.innerText || '').trim();
          links[label || href] = href;
        }
      }
      return { texts, links };
    });
    return { headers, rows };
  });
}

function shapeRows(grid, base) {
  const { headers, rows } = grid;
  return rows.map(({ texts, links }) => {
    const obj = {};
    headers.forEach((h, i) => {
      if (!h) return; // skip placeholder/icon columns with no header
      obj[keyFor(h, i)] = texts[i] ?? '';
    });
    // Attach the first detail link we found, resolved to an absolute URL.
    const firstHref = Object.values(links)[0];
    if (firstHref) obj.url = new URL(firstHref, base + '/').href;
    return obj;
  });
}

// Advance the RadGrid to the next page if a "next" pager control exists and is
// enabled. Returns true if it navigated, false if there's no further page.
async function goNextPage(page) {
  const next = page.locator(
    'input.rgPageNext:not(.rgPagerButtonDisabled), a.rgPageNext:not(.rgPagerButtonDisabled), [title="Next Page"]:not([disabled])',
  ).first();
  if (!(await next.count())) return false;
  const disabled = await next.evaluate((el) => el.disabled || el.className.includes('Disabled')).catch(() => false);
  if (disabled) return false;

  const firstFileBefore = await page.locator('tr.rgRow td, tr.rgAltRow td').first().innerText().catch(() => '');
  await next.click();
  // Wait for the grid to actually change (postback replaces the rows).
  await page.waitForFunction(
    (prev) => {
      const el = document.querySelector('tr.rgRow td, tr.rgAltRow td');
      return el && el.innerText.trim() !== prev;
    },
    firstFileBefore,
    { timeout: 20000 },
  ).catch(() => {});
  return true;
}

async function withPage(chromium, { headful }, fn) {
  const browser = await chromium.launch({ headless: !headful });
  try {
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
        'Chrome/124.0 Safari/537.36 legistar-scraper/1.0 (civic data; respectful, 1 req/sec)',
    });
    const page = await context.newPage();
    return await fn(page);
  } finally {
    await browser.close();
  }
}

// Pick a value in the Years combo. The Legislation grid opens empty until a
// year (or "All Years") is chosen, so we always select something — defaulting
// to the current year keeps a bare run from returning nothing.
async function setYears(page, years) {
  const choice = !years || years === 'default' ? String(new Date().getFullYear()) : years;
  try {
    await page.locator('[id*="lstYears"]').first().click({ timeout: 4000 });
    await page.waitForTimeout(400);
    const label = choice === 'all' ? /All Years/i : new RegExp(`\\b${choice}\\b`);
    const opt = page.getByText(label).first();
    if (await opt.count()) {
      await opt.click();
      await page.waitForTimeout(2500);
    }
  } catch { /* combo not present; ignore */ }
}

async function paginate(page, { maxPages, limit, delayMs, base }) {
  const all = [];
  for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
    await page.waitForSelector('tr.rgRow td, tr.rgAltRow td', { timeout: 20000 }).catch(() => {});
    const grid = await readGrid(page);
    const shaped = shapeRows(grid, base);
    all.push(...shaped);
    if (limit && all.length >= limit) return all.slice(0, limit);
    const moved = await goNextPage(page);
    if (!moved) break;
    if (delayMs) await sleep(delayMs);
  }
  return limit ? all.slice(0, limit) : all;
}

/**
 * Scrape the Legislation search grid.
 * @param {object} opts
 * @param {string} [opts.client='phila']
 * @param {string} [opts.years='default']  'all' | 'default' | a year like '2026'
 * @param {number} [opts.maxPages=1]
 * @param {number} [opts.limit]            cap total rows
 * @param {number} [opts.delayMs=1000]     pause between pages
 * @param {boolean}[opts.headful=false]
 */
export async function scrapeLegislation(opts = {}) {
  const { client = DEFAULT_CLIENT, years = 'default', maxPages = 1, limit, delayMs = 1000, headful = false } = opts;
  const chromium = loadChromium();
  const base = BASE(client);
  return withPage(chromium, { headful }, async (page) => {
    await page.goto(`${base}/Legislation.aspx`, { waitUntil: 'networkidle', timeout: 60000 });
    await setYears(page, years);
    await page.waitForTimeout(2000);
    return paginate(page, { maxPages, limit, delayMs, base });
  });
}

/**
 * Scrape the Calendar (meetings) grid. Same RadGrid shape as Legislation.
 */
export async function scrapeCalendar(opts = {}) {
  const { client = DEFAULT_CLIENT, maxPages = 1, limit, delayMs = 1000, headful = false } = opts;
  const chromium = loadChromium();
  const base = BASE(client);
  return withPage(chromium, { headful }, async (page) => {
    await page.goto(`${base}/Calendar.aspx`, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(2500);
    return paginate(page, { maxPages, limit, delayMs, base });
  });
}

// --- Legislation detail pages ---------------------------------------------

// Caption text (as shown on the detail page) -> stable key.
const DETAIL_FIELD_KEYS = {
  'file #': 'file',
  'version': 'version',
  'name': 'name',
  'type': 'type',
  'status': 'status',
  'file created': 'created',
  'in control': 'inControl',
  'on agenda': 'onAgenda',
  'final action': 'finalAction',
  'title': 'title',
  'sponsors': 'sponsors',
  'indexes': 'indexes',
  'attachments': 'attachments',
};

function detailKey(caption) {
  const norm = caption.replace(/:\s*$/, '').toLowerCase().replace(/\s+/g, ' ').trim();
  return DETAIL_FIELD_KEYS[norm] || norm.replace(/[^a-z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : '')) || 'field';
}

// Pull a single LegislationDetail page into a structured object. Runs in-page.
async function readDetail(page) {
  return page.evaluate(() => {
    // Fields render as caption span `..._lblX` + value span `..._lblX2`.
    const captions = {};
    const values = {};
    for (const s of document.querySelectorAll('span[id*="_lbl"]')) {
      const seg = s.id.split('_').pop(); // e.g. lblFile or lblFile2
      const text = (s.innerText || '').replace(/\s+/g, ' ').trim();
      if (/2$/.test(seg)) values[seg.replace(/2$/, '')] = text;
      else captions[seg] = text;
    }
    const fields = [];
    for (const [base, cap] of Object.entries(captions)) {
      if (!cap) continue;
      if (base in values) fields.push([cap, values[base]]);
    }

    // History grid (gridLegislation): action timeline.
    const histTable = document.querySelector('table[id$="_gridLegislation_ctl00"]');
    const historyHeaders = histTable
      ? [...histTable.querySelectorAll('thead tr:first-child th')].map((h) => h.innerText.replace(/\s+/g, ' ').trim())
      : [];
    const historyRows = histTable
      ? [...histTable.querySelectorAll('tr.rgRow, tr.rgAltRow')].map((tr) => {
          const texts = [...tr.querySelectorAll('td')].map((td) => td.innerText.replace(/\s+/g, ' ').trim());
          const links = {};
          for (const a of tr.querySelectorAll('a[href]')) {
            const href = a.getAttribute('href') || '';
            if (!href || href === '#') continue; // skip JS-postback links (e.g. "Action details")
            const label = (a.innerText || '').trim().toLowerCase();
            if (label.includes('meeting')) links.meetingDetails = href;
            else if (label.includes('video')) links.video = href;
            else if (label.includes('action')) links.actionDetails = href;
          }
          return { texts, links };
        })
      : [];

    // Attachments are file links (View.ashx?M=F).
    const attachments = [...document.querySelectorAll('a[href*="View.ashx?M=F"]')].map((a) => ({
      name: (a.innerText || '').trim(),
      href: a.getAttribute('href'),
    }));

    return { fields, historyHeaders, historyRows, attachments };
  });
}

function shapeDetail(raw, url, base) {
  const out = { url };
  for (const [cap, val] of raw.fields) {
    const k = detailKey(cap);
    if (k === 'attachments') continue; // handled separately below
    out[k] = val;
  }

  out.history = raw.historyRows.map(({ texts, links }) => {
    const row = {};
    raw.historyHeaders.forEach((h, i) => {
      const key = keyFor(h, i);
      // Skip the link-label columns; their URLs are attached below.
      if (['actionDetails', 'meetingDetails', 'video'].includes(key)) return;
      row[key] = texts[i] ?? '';
    });
    if (links.actionDetails) row.actionDetailsUrl = new URL(links.actionDetails, base + '/').href;
    if (links.meetingDetails) row.meetingDetailsUrl = new URL(links.meetingDetails, base + '/').href;
    if (links.video && !/not available/i.test(links.video)) row.videoUrl = new URL(links.video, base + '/').href;
    return row;
  });

  out.attachments = raw.attachments
    .filter((a) => a.name)
    .map((a) => ({ name: a.name, url: new URL(a.href, base + '/').href }));

  return out;
}

/**
 * Scrape one or more LegislationDetail pages, reusing a single browser.
 * @param {string[]} urls  LegislationDetail.aspx URLs (as produced by scrapeLegislation)
 * @param {object} [opts]
 * @param {number} [opts.delayMs=1000]  pause between pages
 * @param {number} [opts.limit]         cap how many URLs to fetch
 * @param {boolean}[opts.headful=false]
 */
export async function scrapeDetails(urls, opts = {}) {
  const { delayMs = 1000, limit, headful = false } = opts;
  const list = (limit ? urls.slice(0, limit) : urls).filter(Boolean);
  if (!list.length) return [];
  const chromium = loadChromium();

  const browser = await chromium.launch({ headless: !headful });
  const results = [];
  try {
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
        'Chrome/124.0 Safari/537.36 legistar-scraper/1.0 (civic data; respectful, 1 req/sec)',
    });
    const page = await context.newPage();
    for (let i = 0; i < list.length; i++) {
      const url = list[i];
      const base = new URL(url).origin;
      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
        await page.waitForTimeout(1500);
        results.push(shapeDetail(await readDetail(page), url, base));
      } catch (err) {
        results.push({ url, error: err.message });
      }
      if (delayMs && i < list.length - 1) await sleep(delayMs);
    }
  } finally {
    await browser.close();
  }
  return results;
}

/** Convenience wrapper for a single detail page. */
export async function scrapeDetail(url, opts = {}) {
  return (await scrapeDetails([url], { ...opts, limit: 1 }))[0];
}

// Minimal CSV encoder for the flat row objects we produce.
export function toCSV(rows) {
  if (!rows.length) return '';
  const cols = [...rows.reduce((s, r) => { Object.keys(r).forEach((k) => s.add(k)); return s; }, new Set())];
  const esc = (v) => {
    // Nested arrays/objects (e.g. a detail row's history) are JSON-encoded so
    // the row stays on one CSV line without losing the data.
    const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}
