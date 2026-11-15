// SPDX-License-Identifier: Apache-2.0
// The page's speed metric, change_lag: how many days the product trails an official change to a source on the reviewed
// list. Each need names its source and the day it was read (needs.json). A source that changed after that day lags by the
// days since the change; the reading is the longest lag, 0 when none does. The change date is the file's Last-Modified,
// or, for a USPTO page, the date the page itself states: its dcterms.modified, or the MPEP's "Last Modified" line.
// A need nobody has read (`checked` null) has no read day, so its source is left out and named; coverage already counts it.
// A source that gives no change date, or a run with no run link, writes change_lag as missing, never 0. The USPTO's
// robots file disallows none of these paths; olls.info disallows only /crs-archive/, so a redirect is never followed.
//
//   node quality-speed/pages/intellectual-property-law/lag.ts --out <file>
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import type { MetricRecord } from '../../contract/format.ts';

const PAGE = 'intellectual-property-law';
const DAY = 86_400_000;

interface Need {
  id: string;
  source: string;
  checked: string | null;
}

/** When a source last changed, as a UTC day: its Last-Modified, else the date its own page states; '' when it gives none. */
export function changeDay(lastModified: string | null, html: string): string {
  const header = Date.parse(lastModified ?? '');
  if (Number.isFinite(header)) return new Date(header).toISOString().slice(0, 10);
  const meta = /<meta name="dcterms\.modified" content="(\d{4}-\d{2}-\d{2})T/.exec(html);
  if (meta) return meta[1]!;
  const mpep = /Last Modified:\s*(\d{2})\/(\d{2})\/(\d{4})/.exec(html);
  return mpep ? `${mpep[3]}-${mpep[1]}-${mpep[2]}` : '';
}

/** Each source a need was read from, once, with the earliest day it was read: a change after that day is one the list missed. */
export function watched(needs: readonly Need[]): { url: string; read: string }[] {
  const read = new Map<string, string>();
  for (const n of needs) {
    const before = read.get(n.source);
    if (n.checked && (!before || n.checked < before)) read.set(n.source, n.checked);
  }
  return [...read].map(([url, day]) => ({ url, read: day }));
}

/** The longest lag in days: a change after the day its source was read counts from the day it happened. */
export function lagDays(pairs: readonly { changed: string; read: string }[], now: Date): number {
  const today = now.toISOString().slice(0, 10);
  const late = pairs.filter(({ changed, read }) => changed > read && changed <= today).map(({ changed }) => Date.parse(`${changed}T00:00:00Z`));
  return late.length ? Math.floor((now.getTime() - Math.min(...late)) / DAY) : 0;
}

async function changed(url: string): Promise<string> {
  const contact = process.env.LEGALLAS_LAW_CONTACT;
  const headers = { 'user-agent': `legallas-quality-speed${contact ? ` (${contact})` : ''}` };
  const ask = (method: string) => fetch(url, { method, headers, redirect: 'manual', signal: AbortSignal.timeout(30_000) });
  const head = await ask('HEAD');
  const modified = head.ok ? head.headers.get('last-modified') : null;
  const page = head.ok && !modified ? await ask('GET') : null;
  const day = changeDay(modified, page?.ok ? await page.text() : '');
  if (!head.ok || !day) throw new Error(`${url} gave no change date`);
  return day;
}

async function changeLag(now: Date): Promise<{ value: number; samples: number }> {
  const needs = (JSON.parse(readFileSync(new URL('./needs.json', import.meta.url), 'utf8')) as { needs: Need[] }).needs;
  for (const n of needs) if (!n.checked) console.error(`change_lag: ${n.id} has no read day, so its source is left out`);
  const list = watched(needs);
  const today = now.toISOString().slice(0, 10);
  // A read day to come would hide any lag.
  if (!list.length || list.some((s) => s.read > today)) throw new Error('no source to watch, or a read day to come');
  const pairs: { changed: string; read: string }[] = [];
  for (const { url, read } of list) pairs.push({ changed: await changed(url), read });
  return { value: lagDays(pairs, now), samples: pairs.length };
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { out: { type: 'string' } } });
  if (!values.out) throw new Error('usage: lag.ts --out <file>');
  const now = new Date();
  const lag = await changeLag(now).catch((error: Error) => {
    console.error(`change_lag: ${error.message}; it reads missing`);
    return null;
  });
  const run = process.env.GITHUB_RUN_ID && /^[1-9]\d*$/.test(process.env.GITHUB_RUN_ID) ? `https://github.com/Colorado-Startups/legallas/actions/runs/${process.env.GITHUB_RUN_ID}` : null;
  const record: MetricRecord =
    lag && run
      ? { id: 'change_lag', page: PAGE, value: lag.value, status: 'ok', stage: 'lab', measured_at: `${now.toISOString().slice(0, 19)}Z`, source_url: run, sample_size: lag.samples }
      : { id: 'change_lag', page: PAGE, value: null, status: 'missing', stage: 'lab', measured_at: null, source_url: null, sample_size: null };
  writeFileSync(values.out, `${JSON.stringify([record])}\n`);
  console.log(`change_lag ${lag ? `${lag.value} days over ${lag.samples} sources` : 'missing'}`);
}
