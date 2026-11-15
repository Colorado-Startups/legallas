// SPDX-License-Identifier: Apache-2.0
// The page's own lane, beside the law kit's: change_lag, the days since the first olls.info change to a C.R.S. title this
// page's list relies on that came after the law pack plan's `checked` date; 0 when there is none. It also asks for the
// next edition, which counts from the day it was posted whatever that date, since the units still name the old one. The
// olls.info robots file disallows only /crs-archive/. The securities rules sit on a host that bars robots, so a person
// checks those. Anything it can't read, or a run with no run link to prove it, writes change_lag as missing, never 0.
//
//   node quality-speed/pages/colorado-regulatory-agencies/collect.ts --out <file>
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import type { MetricRecord } from '../../contract/format.ts';

const PAGE = 'colorado-regulatory-agencies';
const DAY = 86_400_000;
const ROOT = new URL('../../../', import.meta.url);

/** Days since the newest official change, when the record was checked before it; 0 otherwise. */
export function lagDays(checked: string, changes: readonly string[], now: Date): number {
  const today = now.toISOString().slice(0, 10);
  const late = changes.filter((d) => d > checked && d <= today).sort();
  return late.length ? Math.floor((now.getTime() - Date.parse(`${late[0]}T00:00:00Z`)) / DAY) : 0;
}

/** The plan's checked date, and each C.R.S. title and edition a unit on the list is fetched from. */
export function titles(plan: string, units: ReadonlySet<string>): { checked: string; files: { title: string; edition: number }[] } {
  const checked = /^checked = "(\d{4}-\d{2}-\d{2})"$/m.exec(plan.slice(0, plan.search(/^\[/m)))?.[1] ?? '';
  const files = plan.split(/^\[\[unit\]\]$/m).slice(1).flatMap((unit) => {
    const id = /^id = "(.*)"$/m.exec(unit)?.[1];
    const url = /^official_url = "https:\/\/olls\.info\/crs\/crs(\d{4})-title-(\d{2})\.pdf"$/m.exec(unit);
    return id && url && units.has(`unit:${id}`) ? [{ title: url[2]!, edition: Number(url[1]) }] : [];
  });
  return { checked, files: [...new Map(files.map((f) => [`${f.edition}-${f.title}`, f])).values()] };
}

async function changeLag(now: Date): Promise<{ value: number; samples: number } | null> {
  const needs = JSON.parse(readFileSync(new URL(`quality-speed/pages/${PAGE}/needs.json`, ROOT), 'utf8')) as { needs: { covered_by: string[] }[] };
  const { checked, files } = titles(readFileSync(new URL('docs/design/law-pack-plan.toml', ROOT), 'utf8'), new Set(needs.needs.flatMap((n) => n.covered_by)));
  if (!checked || !files.length) return null;
  const headers = { 'user-agent': `Legallas law pack check${process.env.LEGALLAS_LAW_CONTACT ? ` (${process.env.LEGALLAS_LAW_CONTACT})` : ''}` };
  let worst = 0;
  for (const { title, edition } of files) {
    for (const year of [edition, edition + 1]) {
      // A redirect reads as missing, so a file moved under /crs-archive/, which the robots file disallows, is never followed.
      const res = await fetch(`https://olls.info/crs/crs${year}-title-${title}.docx`, { method: 'HEAD', headers, redirect: 'manual' });
      if (res.status === 404 && year > edition) continue;
      const modified = res.ok ? Date.parse(res.headers.get('last-modified') ?? '') : NaN;
      if (Number.isNaN(modified)) return null;
      worst = Math.max(worst, lagDays(year > edition ? '' : checked, [new Date(modified).toISOString().slice(0, 10)], now));
    }
  }
  return { value: worst, samples: files.length };
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { out: { type: 'string' } } });
  if (!values.out) throw new Error('usage: collect.ts --out <file>');
  const now = new Date();
  const lag = await changeLag(now).catch(() => null);
  const run = process.env.GITHUB_RUN_ID && /^[1-9]\d*$/.test(process.env.GITHUB_RUN_ID) ? `https://github.com/Colorado-Startups/legallas/actions/runs/${process.env.GITHUB_RUN_ID}` : null;
  const record: MetricRecord =
    lag && run
      ? { id: 'change_lag', page: PAGE, value: lag.value, status: 'ok', stage: 'lab', measured_at: `${now.toISOString().slice(0, 19)}Z`, source_url: run, sample_size: lag.samples }
      : { id: 'change_lag', page: PAGE, value: null, status: 'missing', stage: 'lab', measured_at: null, source_url: null, sample_size: null };
  writeFileSync(values.out, `${JSON.stringify([record])}\n`);
  console.log(`change_lag ${lag ? `${lag.value} days, C.R.S. titles watched: ${lag.samples}` : 'missing'}`);
}
