// SPDX-License-Identifier: Apache-2.0
// The SEC page's own lane, beside the law kit's: change_lag, the days since an eCFR amendment to a title 17 part the reviewed
// list relies on that the law pack plan's as_of doesn't reflect yet; 0 when there is none. The eCFR robots file allows the
// versions API. Anything it can't read, or a run with no run link to prove it, writes change_lag as missing, never 0.
//
//   node quality-speed/pages/sec/collect.ts --out <file>
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import type { MetricRecord } from '../../contract/format.ts';

const DAY = 86_400_000;
const VERSIONS = 'https://www.ecfr.gov/api/versioner/v1/versions/title-17.json?part=';
const ROOT = new URL('../../../', import.meta.url);

/** Days since the earliest amendment after `asOf`, up to `now`; 0 when there is none. */
export function lagDays(asOf: string, amendments: readonly string[], now: Date): number {
  const today = now.toISOString().slice(0, 10);
  const late = amendments.filter((d) => d > asOf && d <= today).sort();
  return late.length ? Math.floor((now.getTime() - Date.parse(`${late[0]}T00:00:00Z`)) / DAY) : 0;
}

/** Each title 17 part a relied-on unit stores, with the date its as_of names. */
export function parts(plan: string, units: ReadonlySet<string>): { part: string; asOf: string }[] {
  return plan.split(/^\[\[unit\]\]$/m).slice(1).flatMap((unit) => {
    const start = (key: string) => `${key} = "`;
    const field = (key: string) => unit.split(/[\n\r\u2028\u2029]/).find((l) => l.length > start(key).length && l.startsWith(start(key)) && l.endsWith('"'))?.slice(start(key).length, -1) ?? '';
    const asOf = /\d{4}-\d{2}-\d{2}/.exec(field('as_of'))?.[0];
    if (!units.has(`unit:${field('id')}`) || !asOf || !field('citation').startsWith('17 CFR Part')) return [];
    return [...field('citation').matchAll(/\b(2\d\d)\b/g)].map((m) => ({ part: m[1]!, asOf }));
  });
}

async function changeLag(now: Date): Promise<{ value: number; samples: number } | null> {
  const needs = JSON.parse(readFileSync(new URL('quality-speed/pages/sec/needs.json', ROOT), 'utf8')) as { needs: { covered_by: string[] }[] };
  const list = parts(readFileSync(new URL('docs/design/law-pack-plan.toml', ROOT), 'utf8'), new Set(needs.needs.flatMap((n) => n.covered_by)));
  if (!list.length) return null;
  let worst = 0;
  for (const { part, asOf } of list) {
    const res = await fetch(`${VERSIONS}${part}`);
    if (!res.ok) return null;
    const body = (await res.json()) as { content_versions?: { amendment_date?: string }[] };
    if (!Array.isArray(body.content_versions)) return null;
    worst = Math.max(worst, lagDays(asOf, body.content_versions.flatMap((v) => v.amendment_date ?? []), now));
  }
  return { value: worst, samples: list.length };
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { out: { type: 'string' } } });
  if (!values.out) throw new Error('usage: collect.ts --out <file>');
  const now = new Date();
  const lag = await changeLag(now).catch(() => null);
  const run = process.env.GITHUB_RUN_ID && /^[1-9]\d*$/.test(process.env.GITHUB_RUN_ID) ? `https://github.com/Colorado-Startups/legallas/actions/runs/${process.env.GITHUB_RUN_ID}` : null;
  const record: MetricRecord =
    lag && run
      ? { id: 'change_lag', page: 'sec', value: lag.value, status: 'ok', stage: 'lab', measured_at: `${now.toISOString().slice(0, 19)}Z`, source_url: run, sample_size: lag.samples }
      : { id: 'change_lag', page: 'sec', value: null, status: 'missing', stage: 'lab', measured_at: null, source_url: null, sample_size: null };
  writeFileSync(values.out, `${JSON.stringify([record])}\n`);
  console.log(`change_lag ${lag ? lag.value : 'missing'}`);
}
