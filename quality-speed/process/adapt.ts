// SPDX-License-Identifier: Apache-2.0
// Turns Legallas's Quality and Speed state into the Quality run Git Crafter actions/pages reads, for the metrics maps.json names.
//
//   node quality-speed/process/adapt.ts --state <dir> [--out quality-speed/process/out]
//
// <dir> is merge.ts's state folder (records/<slug>.json). Writes <out>/targets/legallas.json (one definition per step
// metric, its goal from the page's manifest) and <out>/data/latest.json (one entry per metric). A reading the Legallas page
// would score 0 (missing, stale, too old, too few samples, no events) goes over as not measured, never as a number.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import type { Manifest, MetricDef, MetricRecord } from '../contract/format.ts';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const PAGES_DIR = path.join(HERE, '..', 'pages');
/** The one Process tab every adapted metric sits on (quality.json tabs). */
export const TAB = 'legallas';
export const PREFIX = 'legallas.';

type Def = Record<string, unknown>;
type Entry = { value: number; source: string; read_at: string } | { could_not_check: string; source: string };

/** Every metric id the maps name, `legallas.<page>.<id>`, in order, once. The prefix keeps clear of Git Crafter's template ids. */
export function stepMetrics(maps: { maps: { steps: unknown }[] }): string[] {
  const ids = maps.maps.flatMap((m) => Object.values(m.steps as Record<string, { metric?: string }>).map((s) => s.metric));
  return [...new Set(ids.filter((id): id is string => typeof id === 'string'))];
}

/** A Git Crafter definition from a Legallas manifest metric. */
export function toDef(page: string, m: MetricDef): Def {
  return {
    id: `${PREFIX}${page}.${m.id}`,
    tab: TAB,
    kind: m.lens,
    label: `${page}: ${m.id.replaceAll('_', ' ')}`,
    unit: m.unit,
    goal: m.goal,
    near: m.floor,
    direction: m.direction,
    goal_source: m.goal_source ?? `quality-speed/pages/${page}/manifest.json`,
    source: `Legallas Quality and Speed run, page ${page}`,
    needs: 'none',
  };
}

/** A Git Crafter entry from a Legallas record, read at `now`. */
export function toEntry(m: MetricDef, r: MetricRecord | undefined, now: number): Entry {
  const source = r?.source_url ?? 'Legallas Quality and Speed run';
  if (!r || r.status !== 'ok' || r.value === null || r.measured_at === null) return { could_not_check: `${r?.status ?? 'missing'} in Legallas's run`, source };
  const ageHours = (now - Date.parse(r.measured_at)) / 3_600_000;
  if (ageHours > m.max_age_hours) return { could_not_check: `older than ${m.max_age_hours} hours`, source };
  if ((r.sample_size ?? 0) < m.min_samples) return { could_not_check: `${r.sample_size ?? 0} samples, under ${m.min_samples}`, source };
  return { value: r.value, source, read_at: r.measured_at };
}

const readJson = <T>(file: string): T => JSON.parse(readFileSync(file, 'utf8')) as T;

export function adapt(state: string, out: string, now = Date.now()): { defs: Def[]; metrics: Record<string, Entry> } {
  const defs: Def[] = [];
  const metrics: Record<string, Entry> = {};
  for (const full of stepMetrics(readJson(path.join(HERE, 'maps.json')))) {
    if (!full.startsWith(PREFIX)) throw new Error(`maps.json names ${full}; a step metric is ${PREFIX}<page>.<id>`);
    // A data-room metric id has dots of its own, so only the first one splits page from id.
    const rest = full.slice(PREFIX.length);
    const dot = rest.indexOf('.');
    const [page, id] = dot < 0 ? [rest, ''] : [rest.slice(0, dot), rest.slice(dot + 1)];
    const metric = readJson<Manifest>(path.join(PAGES_DIR, page, 'manifest.json')).metrics.find((m) => m.id === id);
    if (!metric) throw new Error(`maps.json names ${full}, which ${page}/manifest.json does not define`);
    const file = path.join(state, 'records', `${page}.json`);
    const records = existsSync(file) ? readJson<MetricRecord[]>(file) : [];
    defs.push(toDef(page, metric));
    metrics[full] = toEntry(metric, records.find((r) => r.id === id), now);
  }
  mkdirSync(path.join(out, 'targets'), { recursive: true });
  mkdirSync(path.join(out, 'data'), { recursive: true });
  writeFileSync(path.join(out, 'targets', 'legallas.json'), `${JSON.stringify(defs, null, 1)}\n`);
  writeFileSync(path.join(out, 'data', 'latest.json'), `${JSON.stringify({ metrics }, null, 1)}\n`);
  return { defs, metrics };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({ options: { state: { type: 'string' }, out: { type: 'string' } } });
  if (!values.state) {
    console.error('usage: adapt.ts --state <dir> [--out <dir>]');
    process.exit(2);
  }
  const { metrics } = adapt(values.state, values.out ?? path.join(HERE, 'out'));
  const measured = Object.values(metrics).filter((e) => 'value' in e).length;
  console.log(`${measured} of ${Object.keys(metrics).length} step metrics measured`);
}
