// SPDX-License-Identifier: Apache-2.0
// The page's speed metric, change_lag: how many days the product trails an official change to a court rule it relies on.
// Each pack unit the reviewed list relies on is watched through one official document in watch.json, with the day a
// person last read it. When that document changed after that day, the unit lags by the days since the change; the reading
// is the longest lag, 0 when none does. Whoever reads a new edition updates the unit in the plan and its day here.
// A unit with no watched document, or a document that gives no change date, leaves the metric missing: this writes nothing
// and exits 1, so the lane shows red. The law kit's lane measures the rest of the page.
//
//   node quality-speed/pages/court-rules/lag.ts [--out <file>]
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const PAGE = 'court-rules';
const DAY = 86_400_000;
const here = new URL('.', import.meta.url);

/** One unit's official document, never a web page, whose own date moves with every visit, and the day it was last read. */
export interface Watch {
  unit: string;
  url: string;
  read: string;
}

/** When a document last changed: its Last-Modified, or a "(month.day.year)" date in its file name, as Delaware's courts give. */
export function changeDate(lastModified: string | null, disposition: string | null): number {
  const at = Date.parse(lastModified ?? '');
  if (Number.isFinite(at)) return at;
  const m = /\((\d{1,2})\.(\d{1,2})\.(\d{4})\)/.exec(disposition ?? '');
  return m ? Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2])) : Number.NaN;
}

/** The longest lag in days: a change after the day its document was read counts from the day it happened. */
export function lagDays(pairs: readonly { changed: number; read: number }[], now: number): number {
  return Math.max(0, ...pairs.map(({ changed, read }) => (changed > read ? Math.floor((now - changed) / DAY) : 0)));
}

async function changed(url: string): Promise<number> {
  const contact = process.env.LEGALLAS_LAW_CONTACT;
  const response = await fetch(url, { method: 'HEAD', headers: { 'user-agent': `legallas-quality-speed${contact ? ` (${contact})` : ''}` }, signal: AbortSignal.timeout(30_000) });
  const at = changeDate(response.headers.get('last-modified'), response.headers.get('content-disposition'));
  if (!response.ok || !Number.isFinite(at)) throw new Error(`${url} gave no change date`);
  return at;
}

async function measure(): Promise<Record<string, unknown>> {
  const now = Date.now();
  const needs = (JSON.parse(readFileSync(new URL('needs.json', here), 'utf8')) as { needs: { covered_by: string[] }[] }).needs;
  const units = [...new Set(needs.flatMap((n) => n.covered_by.filter((r) => r.startsWith('unit:')).map((r) => r.slice(5))))];
  if (!units.length) throw new Error('no unit to watch');
  const watched = JSON.parse(readFileSync(new URL('watch.json', here), 'utf8')) as Watch[];
  const pairs: { changed: number; read: number }[] = [];
  for (const unit of units) {
    const watch = watched.find((w) => w.unit === unit);
    // A unit whose official document hasn't been opened has nothing to watch: it is left out and named, and min_samples
    // (today's watched count) makes a dropped entry score 0 rather than read well.
    if (!watch) {
      console.error(`change_lag: ${unit} has no watched document, so it is left out`);
      continue;
    }
    const read = Date.parse(`${watch.read}T00:00:00Z`);
    // A read day to come would hide any lag.
    if (!Number.isFinite(read) || read > now) throw new Error(`${unit} has no past read date`);
    pairs.push({ changed: await changed(watch.url), read });
  }
  if (!pairs.length) throw new Error('no unit has a watched document');
  const repo = 'https://github.com/Colorado-Startups/legallas';
  const sha = () => process.env.GITHUB_SHA ?? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  return {
    id: 'change_lag',
    page: PAGE,
    value: lagDays(pairs, now),
    status: 'ok',
    stage: 'lab',
    measured_at: new Date(now).toISOString().replace(/\.\d+Z$/, 'Z'),
    source_url: process.env.GITHUB_RUN_ID ? `${repo}/actions/runs/${process.env.GITHUB_RUN_ID}` : `${repo}/commit/${sha()}`,
    sample_size: pairs.length,
  };
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { out: { type: 'string' } } });
  try {
    const record = await measure();
    const text = `${JSON.stringify([record], null, 1)}\n`;
    if (values.out) writeFileSync(values.out, text);
    else process.stdout.write(text);
    console.error(`change_lag ${record.value} days over ${record.sample_size} units`);
  } catch (error) {
    console.error(`change_lag: ${(error as Error).message}; it reads missing`);
    process.exitCode = 1;
  }
}
