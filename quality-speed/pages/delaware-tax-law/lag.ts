// SPDX-License-Identifier: Apache-2.0
// The page's own lane, beside the law kit's: change_lag, the days the law pack plan's Delaware units trail the Delaware
// Code. The Code's home page says which acts it includes ("includes all acts enacted as of October 01, 2026"); each unit's
// as_of says what was checked ("Enacted through 2026-10-01"). The reading is the oldest unit's gap, 0 when every unit is
// current. Delaware Code Online has no robots file. Anything it can't read, a unit dated after the Code, or a run with no
// run link to prove it, writes change_lag as missing, never 0.
//
//   node quality-speed/pages/delaware-tax-law/lag.ts --out <file>
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import type { MetricRecord } from '../../contract/format.ts';

const DAY = 86_400_000;
const ROOT = new URL('../../../', import.meta.url);

/** The date on the Code's home page, from its text with tags removed, or null. */
export function codeDate(html: string): number | null {
  const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  const found = /includes all acts enacted as of ([A-Z][a-z]+ \d{1,2}, \d{4})/.exec(text)?.[1];
  const at = found ? Date.parse(`${found} UTC`) : Number.NaN;
  return Number.isFinite(at) ? at : null;
}

/** Each relied-on unit's "Enacted through" date, from the plan. null when one the plan holds has no such date. */
export function unitDates(plan: string, ids: readonly string[]): number[] | null {
  const blocks = plan.split(/^\[\[unit\]\]$/m);
  const dates = ids.map((id) => {
    const block = blocks.find((b) => b.includes(`\nid = "${id}"\n`));
    if (!block) return undefined;
    const date = /^as_of = ".*?Enacted through (\d{4}-\d{2}-\d{2})/m.exec(block)?.[1];
    return date ? Date.parse(`${date}T00:00:00Z`) : null;
  });
  if (dates.includes(null)) return null;
  return dates.filter((d): d is number => typeof d === 'number');
}

/** Days from the oldest unit to the Code, or null: a unit dated after the Code can only be a typo, which would hide lag. */
export function lagDays(code: number, units: readonly number[]): number | null {
  if (!units.length || units.some((u) => u > code)) return null;
  return Math.round((code - Math.min(...units)) / DAY);
}

async function changeLag(): Promise<{ value: number; samples: number } | null> {
  const needs = JSON.parse(readFileSync(new URL('quality-speed/pages/delaware-tax-law/needs.json', ROOT), 'utf8')) as { needs: { covered_by: string[] }[] };
  const ids = [...new Set(needs.needs.flatMap((n) => n.covered_by.filter((r) => r.startsWith('unit:')).map((r) => r.slice(5))))];
  const units = unitDates(readFileSync(new URL('docs/design/law-pack-plan.toml', ROOT), 'utf8'), ids);
  if (!units?.length) return null;
  const headers = { 'user-agent': `Legallas law pack check${process.env.LEGALLAS_LAW_CONTACT ? ` (${process.env.LEGALLAS_LAW_CONTACT})` : ''}` };
  const res = await fetch('https://delcode.delaware.gov/', { headers, redirect: 'manual', signal: AbortSignal.timeout(30_000) });
  const code = res.ok ? codeDate(await res.text()) : null;
  const value = code === null ? null : lagDays(code, units);
  return value === null ? null : { value, samples: units.length };
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { out: { type: 'string' } } });
  if (!values.out) throw new Error('usage: lag.ts --out <file>');
  const now = new Date();
  const lag = await changeLag().catch(() => null);
  const run = process.env.GITHUB_RUN_ID && /^[1-9]\d*$/.test(process.env.GITHUB_RUN_ID) ? `https://github.com/Colorado-Startups/legallas/actions/runs/${process.env.GITHUB_RUN_ID}` : null;
  const record: MetricRecord =
    lag && run
      ? { id: 'change_lag', page: 'delaware-tax-law', value: lag.value, status: 'ok', stage: 'lab', measured_at: `${now.toISOString().slice(0, 19)}Z`, source_url: run, sample_size: lag.samples }
      : { id: 'change_lag', page: 'delaware-tax-law', value: null, status: 'missing', stage: 'lab', measured_at: null, source_url: null, sample_size: null };
  writeFileSync(values.out, `${JSON.stringify([record])}\n`);
  console.log(`change_lag ${lag ? lag.value : 'missing'}`);
}
