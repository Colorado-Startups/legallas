// SPDX-License-Identifier: Apache-2.0
// Turns this run's records and the last state into the new state that build.ts reads.
//
//   node quality-speed/core/merge.ts --fresh <dir> --state <dir> --out <dir> --planned <matrix JSON> [--copy-page-files]
//
// A state folder holds history.jsonl, records/<slug>.json (one list per page) and lanes/<slug>/<lane>.json (the last
// records of each lane). A lane this run didn't plan keeps its last records and their original times, so a weekly lane
// survives the daily runs and goes stale honestly. A lane it planned that left no file failed, whatever stopped it, so
// the metrics it last reported read as missing right away instead of showing an old number. A lane's detail goes with its
// records, and a failed lane loses it but keeps its facts, so its next run isn't cold. Only records that pass the
// format reach records/, and each page gets one new score line after the old ones. Only counts are printed.
//
// <fresh> holds one folder per lane's artifact, as `site` downloads them. A lane's records count only from
// records-<slug>-<lane>/<slug>/<lane>.json and its detail folder beside it, so one lane's job can't report another
// page's or lane's records (#373). Anything else there is ignored.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import type { HistoryLine, Manifest, MetricRecord } from '../contract/format.ts';
import { PUBLIC_PAGES, type PageSlug } from '../contract/pages.ts';
import { validateRecords } from '../contract/validate.ts';
import { carryDetail, carryFacts, copyPageFiles } from './detail.ts';
import { HISTORY_FILE } from './history-fetch.ts';
import { loadManifest, PAGES_DIR, publicLanes } from './lanes.ts';
import { scorePage } from './score.ts';

/** A record that says only that the metric failed. A null value, so an error can't read as a zero. */
const asMissing = (r: MetricRecord): MetricRecord => ({
  id: r.id,
  page: r.page,
  value: null,
  status: 'missing',
  stage: r.stage,
  measured_at: null,
  source_url: null,
  sample_size: null,
});

/** What a lane holds after this run. */
export function laneAfterRun(fresh: MetricRecord[] | undefined, carried: readonly MetricRecord[], planned: boolean): MetricRecord[] {
  if (fresh) return fresh;
  return planned ? carried.map(asMissing) : [...carried];
}

/** The lanes this run set out to run, as `<slug>/<lane>`. An unreadable plan throws: every lane would then look unplanned. */
export function plannedLanes(matrix: string): Set<string> {
  const { include } = JSON.parse(matrix) as { include: { slug: string; lane: string }[] };
  return new Set(include.map((row) => `${row.slug}/${row.lane}`));
}

/** One page's score line. */
export function historyLine(page: PageSlug, manifest: Manifest | null, records: readonly MetricRecord[], now: Date): HistoryLine {
  const { quality, speed, consumption, total } = scorePage(page, manifest, records, now);
  const at = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
  return { at, page, quality, speed, consumption, total };
}

/** The artifact one lane's job uploads its records in, as the workflow names it. */
export const laneArtifact = (slug: string, lane: string): string => `records-${slug}-${lane}`;

/** A lane's records, or undefined when the file is absent or isn't a list, which reads as that lane having no file. */
function readRecords(file: string): MetricRecord[] | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    return Array.isArray(parsed) ? (parsed as MetricRecord[]) : undefined;
  } catch {
    return undefined;
  }
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value)}\n`);
}

/** Writes the new state and returns how many records it holds and how many it had to drop. */
export function merge(fresh: string, state: string, out: string, planned: ReadonlySet<string>, now: Date, pagesDir = PAGES_DIR): { kept: number; dropped: number } {
  const lines: HistoryLine[] = [];
  let kept = 0;
  let dropped = 0;
  // Public pages and lanes only (pages.ts): a private page's last records, detail and lanes are not carried into the new state.
  for (const slug of PUBLIC_PAGES) {
    const manifest = loadManifest(slug, pagesDir);
    const all: MetricRecord[] = [];
    // Only declared lanes carry over, so a retired lane's numbers don't linger. This run's lanes go first: when two lanes
    // report a metric the first one counts, and a carried number must not outrank this run's reading or its failure.
    const lanes = publicLanes(slug, pagesDir);
    const key = (id: string) => (planned.has(`${slug}/${id}`) ? 0 : 1);
    for (const lane of [...lanes].sort((a, b) => key(a.id) - key(b.id))) {
      const name = `${lane.id}.json`;
      const own = path.join(fresh, laneArtifact(slug, lane.id), slug);
      const ran = readRecords(path.join(own, name));
      const isPlanned = planned.has(`${slug}/${lane.id}`);
      const after = laneAfterRun(ran, readRecords(path.join(state, 'lanes', slug, name)) ?? [], isPlanned);
      writeJson(path.join(out, 'lanes', slug, name), after);
      all.push(...after);
      if (ran) carryDetail(path.join(own, lane.id), path.join(out, 'lanes', slug, lane.id));
      else if (!isPlanned) carryDetail(path.join(state, 'lanes', slug, lane.id), path.join(out, 'lanes', slug, lane.id));
      else carryFacts(path.join(state, 'lanes', slug, lane.id), path.join(out, 'lanes', slug, lane.id));
    }
    // A manifest can have changed since a carried record was measured, and two lanes can report one metric.
    const checked = manifest ? validateRecords(all, manifest) : { records: [], errors: [] };
    kept += checked.records.length;
    dropped += all.length - checked.records.length;
    writeJson(path.join(out, 'records', `${slug}.json`), checked.records);
    lines.push(historyLine(slug, manifest, checked.records, now));
  }
  const olderFile = path.join(state, HISTORY_FILE);
  // The history only grows (history-fetch.ts checks that), so a private page's earlier score lines stay; build.ts skips them.
  const older = existsSync(olderFile) ? readFileSync(olderFile, 'utf8') : '';
  writeFileSync(path.join(out, HISTORY_FILE), `${older}${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);
  return { kept, dropped };
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: { fresh: { type: 'string' }, state: { type: 'string' }, out: { type: 'string' }, planned: { type: 'string' }, 'copy-page-files': { type: 'boolean' } },
  });
  if (!values.fresh || !values.state || !values.out || !values.planned) {
    console.error('usage: merge.ts --fresh <dir> --state <dir> --out <dir> --planned <matrix JSON> [--copy-page-files]');
    process.exit(1);
  }
  const { kept, dropped } = merge(values.fresh, values.state, values.out, plannedLanes(values.planned), new Date());
  if (values['copy-page-files']) copyPageFiles(values.out, PUBLIC_PAGES, PAGES_DIR);
  console.log(`State: ${kept} records kept, ${dropped} dropped, ${PUBLIC_PAGES.length} score lines added.`);
}
