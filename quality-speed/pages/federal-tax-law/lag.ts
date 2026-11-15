// SPDX-License-Identifier: Apache-2.0
// The page's own lane, beside the law kit's: change_lag, how many days the reviewed list trails a change to federal tax law.
// Each need with a `checked` date has one source, and each source gives one change date: an irs.gov page's "Page Last
// Reviewed or Updated" line, an irs.gov PDF's Last-Modified, an eCFR section's latest amendment from eCFR's versions API, or
// a U.S. Code section's latest amending law, the last date in its source credit. A source that changed after its need was
// checked lags by the days since the change; the reading is the longest lag, 0 when none does. Whoever opens the changed
// source again checks the documents the need relies on, then moves its `checked`. A need never opened (`checked` null) has
// no date to trail; the kit counts it unheld. A source on another host, one with no date, or a run with no run link to
// prove it writes change_lag as missing, never 0.
//
//   node quality-speed/pages/federal-tax-law/lag.ts --out <file>
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import type { MetricRecord } from '../../contract/format.ts';

const DAY = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Before this, a server's date is a placeholder, such as 1970-01-01, not a change. */
const EARLIEST = Date.UTC(1990, 0, 1);

/** An IRS page's own date, "Page Last Reviewed or Updated: 16-Oct-2026", or NaN. Its Last-Modified moves with each render. */
export function reviewedOn(page: string): number {
  const m = /Page Last Reviewed or Updated:\s*(\d{1,2})-([A-Z][a-z]{2})-(\d{4})/.exec(page);
  const month = m ? MONTHS.indexOf(m[2]!) : -1;
  return m && month >= 0 ? Date.UTC(Number(m[3]), month, Number(m[1])) : Number.NaN;
}

/** A PDF's Last-Modified, or NaN when it has none or a placeholder. */
export function pdfDate(lastModified: string | null): number {
  const at = Date.parse(lastModified ?? '');
  return at >= EARLIEST ? at : Number.NaN;
}

/** A U.S. Code section's latest amendment: the last date in its source credit, "(Added Pub. L. 103-66, ..., Aug. 10, 1993;
 * ... Pub. L. 119-21, ..., July 4, 2025, ...)", or NaN. The page's "current through" line is the whole Code's, not the section's. */
export function amendedOn(page: string): number {
  const credit = /id="sourcecredit">([\s\S]*?)<\/p>/.exec(page)?.[1]?.replace(/<[^>]+>/g, ' ') ?? '';
  const dates = [...credit.matchAll(/\b([A-Z][a-z]{2})[a-z]*\.?\s+(\d{1,2})\s*,\s*(\d{4})\b/g)].flatMap(([, month, day, year]) =>
    MONTHS.includes(month!) ? [Date.UTC(Number(year), MONTHS.indexOf(month!), Number(day))] : [],
  );
  return dates.length ? Math.max(...dates) : Number.NaN;
}

/** An eCFR versions answer's latest amendment date, or NaN. */
export function ecfrAmended(body: unknown): number {
  const date = (body as { meta?: { latest_amendment_date?: unknown } } | null)?.meta?.latest_amendment_date;
  return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(`${date}T00:00:00Z`) : Number.NaN;
}

/** Where a source's change date lives: the request to make and how to read its answer, or null for a host this can't date. */
export function dater(url: string): { url: string; method: 'GET' | 'HEAD'; read: (response: Response) => Promise<number> } | null {
  const cfr = /^https:\/\/www\.ecfr\.gov\/current\/title-(\d+)\/section-([\w.-]+)$/.exec(url);
  if (cfr) return { url: `https://www.ecfr.gov/api/versioner/v1/versions/title-${cfr[1]}.json?section=${cfr[2]}`, method: 'GET', read: async (r) => ecfrAmended(await r.json()) };
  if (/^https:\/\/uscode\.house\.gov\/us\/usc\/t\d+\/s\w+\/$/.test(url)) return { url, method: 'GET', read: async (r) => amendedOn(await r.text()) };
  if (!url.startsWith('https://www.irs.gov/')) return null;
  if (url.endsWith('.pdf')) return { url, method: 'HEAD', read: async (r) => pdfDate(r.headers.get('last-modified')) };
  return { url, method: 'GET', read: async (r) => reviewedOn(await r.text()) };
}

/** The longest lag in days: a change after the day its need was checked counts from the day it happened. */
export function lagDays(pairs: readonly { changed: number; checked: number }[], now: number): number {
  return Math.max(0, ...pairs.map(({ changed, checked }) => (changed > checked && changed <= now ? Math.floor((now - changed) / DAY) : 0)));
}

const headers = { 'user-agent': `Legallas law pack check${process.env.LEGALLAS_LAW_CONTACT ? ` (${process.env.LEGALLAS_LAW_CONTACT})` : ''}` };

async function changed(url: string): Promise<number> {
  const how = dater(url);
  if (!how) throw new Error(`${url} is not on www.irs.gov, www.ecfr.gov or uscode.house.gov, so lag.ts can't date it`);
  // One request at a time, a second apart: the IRS refuses some quick repeats.
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const response = await fetch(how.url, { method: how.method, headers, redirect: 'error', signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${how.url} answered ${response.status}`);
  const at = await how.read(response);
  if (Number.isNaN(at)) throw new Error(`${url} gave no change date`);
  return at;
}

async function changeLag(now: number): Promise<{ value: number; samples: number }> {
  const { needs } = JSON.parse(readFileSync(new URL('needs.json', import.meta.url), 'utf8')) as { needs: { source: string; checked: string | null }[] };
  const opened = needs.flatMap((n) => (n.checked === null ? [] : [{ source: n.source, checked: Date.parse(`${n.checked}T00:00:00Z`) }]));
  // A checked day to come would hide any lag.
  if (!opened.length || opened.some((n) => !(n.checked <= now))) throw new Error('no need with a past checked date');
  const dates = new Map<string, number>();
  for (const source of new Set(opened.map((n) => n.source))) dates.set(source, await changed(source));
  return { value: lagDays(opened.map((n) => ({ changed: dates.get(n.source)!, checked: n.checked })), now), samples: opened.length };
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { out: { type: 'string' } } });
  if (!values.out) throw new Error('usage: lag.ts --out <file>');
  const now = new Date();
  const lag = await changeLag(now.getTime()).catch((error: Error) => (console.error(`change_lag: ${error.message}`), null));
  const run = process.env.GITHUB_RUN_ID && /^[1-9]\d*$/.test(process.env.GITHUB_RUN_ID) ? `https://github.com/Colorado-Startups/legallas/actions/runs/${process.env.GITHUB_RUN_ID}` : null;
  const record: MetricRecord =
    lag && run
      ? { id: 'change_lag', page: 'federal-tax-law', value: lag.value, status: 'ok', stage: 'lab', measured_at: `${now.toISOString().slice(0, 19)}Z`, source_url: run, sample_size: lag.samples }
      : { id: 'change_lag', page: 'federal-tax-law', value: null, status: 'missing', stage: 'lab', measured_at: null, source_url: null, sample_size: null };
  writeFileSync(values.out, `${JSON.stringify([record])}\n`);
  console.log(`change_lag ${lag ? `${lag.value} days over ${lag.samples} needs` : 'missing'}`);
}
