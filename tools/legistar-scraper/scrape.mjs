#!/usr/bin/env node
// CLI for the Philadelphia Legistar scraper.
//
//   node tools/legistar-scraper/scrape.mjs legislation --years all --max-pages 3 --out bills.json
//   node tools/legistar-scraper/scrape.mjs calendar --limit 50 --format csv --out meetings.csv
//
// See tools/legistar-scraper/README.md for details and caveats.

import { writeFile } from 'node:fs/promises';
import { scrapeLegislation, scrapeCalendar, toCSV, DEFAULT_CLIENT } from './lib/legistar.mjs';

function parseArgs(argv) {
  // Treat a leading flag (e.g. `--help`) as "no command".
  const [first, ...tail] = argv;
  const hasCommand = first && !first.startsWith('-');
  const command = hasCommand ? first : undefined;
  const rest = hasCommand ? tail : argv;
  const opts = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = rest[i + 1];
    if (next === undefined || next.startsWith('--')) { opts[key] = true; }
    else { opts[key] = next; i++; }
  }
  return { command, opts };
}

const USAGE = `Philadelphia Legistar scraper

Usage:
  node tools/legistar-scraper/scrape.mjs <legislation|calendar> [options]

Options:
  --client <name>     Legistar client (default: ${DEFAULT_CLIENT})
  --years <v>         legislation only: all | default | a year (e.g. 2026)
  --max-pages <n>     pages of results to walk (default: 1; ~100 rows/page)
  --limit <n>         stop after n rows
  --delay <ms>        pause between pages (default: 1000)
  --format <fmt>      json | csv (default: json)
  --out <file>        write to file instead of stdout
  --headful           show the browser (debugging)
  --help

Notes:
  * Reads only public data from the Legistar web UI. No login or token.
  * For bulk/official use, request an API token from the City Clerk and use
    webapi.legistar.com/v1/phila instead — far faster and more stable.`;

async function main() {
  const { command, opts } = parseArgs(process.argv.slice(2));

  if (!command || opts.help || command === 'help') {
    console.log(USAGE);
    process.exit(command ? 0 : 1);
  }

  const common = {
    client: opts.client || DEFAULT_CLIENT,
    maxPages: opts['max-pages'] ? Number(opts['max-pages']) : 1,
    limit: opts.limit ? Number(opts.limit) : undefined,
    delayMs: opts.delay ? Number(opts.delay) : 1000,
    headful: Boolean(opts.headful),
  };

  let rows;
  if (command === 'legislation') {
    rows = await scrapeLegislation({ ...common, years: opts.years || 'default' });
  } else if (command === 'calendar') {
    rows = await scrapeCalendar(common);
  } else {
    console.error(`Unknown command: ${command}\n`);
    console.log(USAGE);
    process.exit(1);
  }

  const format = (opts.format || 'json').toLowerCase();
  const output = format === 'csv' ? toCSV(rows) : JSON.stringify(rows, null, 2);

  if (opts.out) {
    await writeFile(opts.out, output);
    console.error(`Wrote ${rows.length} rows to ${opts.out}`);
  } else {
    process.stdout.write(output + '\n');
    console.error(`(${rows.length} rows)`);
  }
}

main().catch((err) => {
  console.error('Scrape failed:', err.message);
  process.exit(1);
});
