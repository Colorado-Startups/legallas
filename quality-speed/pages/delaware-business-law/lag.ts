// SPDX-License-Identifier: Apache-2.0
// The page's own lane, beside the law kit's: change_lag, the days since the first change to a Delaware Code title this
// page's list relies on that came after the law pack plan's `checked` date; 0 when there is none. The Code Online signs a
// new PDF of a title when it takes in new acts, so the PDF's Last-Modified is the change date, the update check the plan
// names for its delcode host, which has no robots file. Anything it can't read, or a run with no run link to prove it,
// writes change_lag as missing, never 0.
//
//   node quality-speed/pages/delaware-business-law/lag.ts --out <file>
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import type { MetricRecord } from '../../contract/format.ts';

const DAY = 86_400_000;
const ROOT = new URL('../../../', import.meta.url);

/** Days since the first official change after the check, up to now; 0 when there is none. */
export function lagDays(checked: string, changes: readonly string[], now: Date): number {
  const today = now.toISOString().slice(0, 10);
  const late = changes.filter((d) => d > checked && d <= today).sort();
  return late.length ? Math.floor((now.getTime() - Date.parse(`${late[0]}T00:00:00Z`)) / DAY) : 0;
}

/** The plan's checked date, and each Delaware Code title a unit on the list is read from, once. */
export function titles(plan: string, units: ReadonlySet<string>): { checked: string; titles: string[] } {
  const checked = /^checked = "(\d{4}-\d{2}-\d{2})"$/m.exec(plan.slice(0, plan.search(/^\[/m)))?.[1] ?? '';
  const found = plan.split(/^\[\[unit\]\]$/m).slice(1).flatMap((unit) => {
    const id = /^id = "(.*)"$/m.exec(unit)?.[1];
    const title = /^official_url = "https:\/\/delcode\.delaware\.gov\/title(\d+)\//m.exec(unit)?.[1];
    return id && title && units.has(`unit:${id}`) ? [title] : [];
  });
  return { checked, titles: [...new Set(found)] };
}

async function changeLag(now: Date): Promise<{ value: number; samples: number } | null> {
  const needs = JSON.parse(readFileSync(new URL('quality-speed/pages/delaware-business-law/needs.json', ROOT), 'utf8')) as { needs: { covered_by: string[] }[] };
  const { checked, titles: list } = titles(readFileSync(new URL('docs/design/law-pack-plan.toml', ROOT), 'utf8'), new Set(needs.needs.flatMap((n) => n.covered_by)));
  if (!checked || !list.length) return null;
  const headers = { 'user-agent': `Legallas law pack check${process.env.LEGALLAS_LAW_CONTACT ? ` (${process.env.LEGALLAS_LAW_CONTACT})` : ''}` };
  let worst = 0;
  for (const title of list) {
    // A redirect reads as missing: the signed PDF is the change record, and a moved one says nothing about it.
    const res = await fetch(`https://delcode.delaware.gov/title${title}/title${title}.pdf`, { method: 'HEAD', headers, redirect: 'manual', signal: AbortSignal.timeout(30_000) });
    const modified = res.ok ? Date.parse(res.headers.get('last-modified') ?? '') : NaN;
    if (Number.isNaN(modified)) return null;
    worst = Math.max(worst, lagDays(checked, [new Date(modified).toISOString().slice(0, 10)], now));
  }
  return { value: worst, samples: list.length };
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { out: { type: 'string' } } });
  if (!values.out) throw new Error('usage: lag.ts --out <file>');
  const now = new Date();
  const lag = await changeLag(now).catch(() => null);
  const run = process.env.GITHUB_RUN_ID && /^[1-9]\d*$/.test(process.env.GITHUB_RUN_ID) ? `https://github.com/Colorado-Startups/legallas/actions/runs/${process.env.GITHUB_RUN_ID}` : null;
  const record: MetricRecord =
    lag && run
      ? { id: 'change_lag', page: 'delaware-business-law', value: lag.value, status: 'ok', stage: 'lab', measured_at: `${now.toISOString().slice(0, 19)}Z`, source_url: run, sample_size: lag.samples }
      : { id: 'change_lag', page: 'delaware-business-law', value: null, status: 'missing', stage: 'lab', measured_at: null, source_url: null, sample_size: null };
  writeFileSync(values.out, `${JSON.stringify([record])}\n`);
  console.log(`change_lag ${lag ? `${lag.value} days over ${lag.samples} titles` : 'missing'}`);
}
