// SPDX-License-Identifier: Apache-2.0
// The Employment law page's own lane, beside the law kit's: change_lag, the days since an official change to law this page
// relies on that the law pack plan doesn't reflect yet; 0 when there is none. Two official feeds, both open to machines:
// eCFR's versions API for each relied-on C.F.R. part, against the date its unit's as_of names, and olls.info's C.R.S. file
// for each relied-on Colorado title, whose Last-Modified, and next year's edition once posted, are checked against the plan's
// checked date. Anything it can't read, or a run with no run link, writes change_lag as missing, never 0.
//
//   node quality-speed/pages/employment-law/lag.ts --out <file>
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import type { MetricRecord } from '../../contract/format.ts';

const DAY = 86_400_000;
const ROOT = new URL('../../../', import.meta.url);
const HEADERS = { 'user-agent': `Legallas quality-speed${process.env.LEGALLAS_LAW_CONTACT ? ` (${process.env.LEGALLAS_LAW_CONTACT})` : ''}` };

export type Source = { kind: 'cfr'; title: string; part: string; since: string } | { kind: 'crs'; year: number; title: string; since: string };

/** Days since the earliest change after `since`, up to `now`; 0 when there is none. */
export function lagDays(since: string, changes: readonly string[], now: Date): number {
  const today = now.toISOString().slice(0, 10);
  const late = changes.filter((d) => d > since && d <= today).sort();
  return late.length ? Math.floor((now.getTime() - Date.parse(`${late[0]}T00:00:00Z`)) / DAY) : 0;
}

/** The official feeds behind the relied-on units: each C.F.R. part, and each C.R.S. title the pack downloads. */
export function sources(plan: string, units: ReadonlySet<string>): Source[] {
  const [preamble = '', ...blocks] = plan.split(/^\[\[unit\]\]$/m);
  const checked = /^checked = "(\d{4}-\d{2}-\d{2})"$/m.exec(preamble.slice(0, preamble.search(/^\[/m)))?.[1] ?? '';
  const out = new Map<string, Source>();
  for (const unit of blocks) {
    const start = (key: string) => `${key} = "`;
    const field = (key: string) => unit.split(/[\n\r\u2028\u2029]/).find((l) => l.length > start(key).length && l.startsWith(start(key)) && l.endsWith('"'))?.slice(start(key).length, -1) ?? '';
    if (!units.has(`unit:${field('id')}`)) continue;
    const cfr = /\b(\d+) CFR Part (\d+)\b/.exec(field('citation'));
    if (cfr) out.set(`cfr-${cfr[1]}-${cfr[2]}`, { kind: 'cfr', title: cfr[1]!, part: cfr[2]!, since: /\d{4}-\d{2}-\d{2}/.exec(field('as_of'))?.[0] ?? checked });
    const crs = field('host') === 'olls' ? /\/crs(\d{4})-title-(\d{2})\.pdf$/.exec(field('official_url')) : null;
    if (crs) out.set(`crs-${crs[2]}`, { kind: 'crs', year: Number(crs[1]), title: crs[2]!, since: checked });
  }
  return [...out.values()];
}

const day = (header: string | null) => (header ? new Date(header).toISOString().slice(0, 10) : null);

/** The dates each feed says the law changed. Throws when a feed can't be read, so the metric reads missing. */
async function changes(source: Source): Promise<string[]> {
  if (source.kind === 'cfr') {
    const res = await fetch(`https://www.ecfr.gov/api/versioner/v1/versions/title-${source.title}.json?part=${source.part}`, { headers: HEADERS });
    const body = res.ok ? ((await res.json()) as { content_versions?: { amendment_date?: string }[] }) : {};
    if (!Array.isArray(body.content_versions)) throw new Error('eCFR versions unreadable');
    return body.content_versions.flatMap((v) => v.amendment_date ?? []);
  }
  const url = (year: number) => `https://olls.info/crs/crs${year}-title-${source.title}.pdf`;
  const current = await fetch(url(source.year), { method: 'HEAD', headers: HEADERS });
  const next = await fetch(url(source.year + 1), { method: 'HEAD', headers: HEADERS });
  const posted = day(current.headers.get('last-modified'));
  if (!current.ok || !posted || (!next.ok && next.status !== 404)) throw new Error('C.R.S. file unreadable');
  const nextPosted = next.ok ? day(next.headers.get('last-modified')) : null;
  return nextPosted ? [posted, nextPosted] : [posted];
}

async function changeLag(now: Date): Promise<{ value: number; samples: number } | null> {
  const needs = JSON.parse(readFileSync(new URL('quality-speed/pages/employment-law/needs.json', ROOT), 'utf8')) as { needs: { covered_by: string[] }[] };
  const list = sources(readFileSync(new URL('docs/design/law-pack-plan.toml', ROOT), 'utf8'), new Set(needs.needs.flatMap((n) => n.covered_by)));
  if (!list.length) return null;
  let worst = 0;
  for (const source of list) worst = Math.max(worst, lagDays(source.since, await changes(source), now));
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
      ? { id: 'change_lag', page: 'employment-law', value: lag.value, status: 'ok', stage: 'lab', measured_at: `${now.toISOString().slice(0, 19)}Z`, source_url: run, sample_size: lag.samples }
      : { id: 'change_lag', page: 'employment-law', value: null, status: 'missing', stage: 'lab', measured_at: null, source_url: null, sample_size: null };
  writeFileSync(values.out, `${JSON.stringify([record])}\n`);
  console.log(`change_lag ${lag ? `${lag.value} days over ${lag.samples} feeds` : 'missing'}`);
}
