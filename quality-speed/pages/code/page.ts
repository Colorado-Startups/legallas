// SPDX-License-Identifier: Apache-2.0
// The Code page body, composed from the chart kit. The build supplies the title and the score ring and calls render()
// with this page's scores and validated readings only, so everything here is numbers: every folder on Q, S and C
// (the docs lane's tree.json, drilling to files), the ideal state as a pass grid, Road to 100, and every metric
// against its goal with its baseline.
import { existsSync, readFileSync } from 'node:fs';
import type { Manifest } from '../../contract/format.ts';
import type { PageContext, PageOutput } from '../../core/build.ts';
import { NEVER_PUBLISHED } from '../../core/guard.ts';
import { combine, lineScore, type MetricScore } from '../../core/score.ts';
import { bullets, dotMatrix, esc, heatLegend, heatmap, markKey, metricBullet, missingTile, roadTo100 } from '../../core/charts/index.ts';
import type { PassState, RoadFixProps } from '../../core/charts/index.ts';
import { fixGain } from '../../core/charts/road.ts';
import { folderScores, readRows, type FileRow, type Scores } from './collect/tree.ts';

/** One or two words per metric: these are most of the page's visible words. */
export const LABELS: Record<string, string> = {
  checks_failing: 'Checks red',
  long_functions: 'Long functions',
  long_files: 'Long files',
  type_escapes: 'Type escapes',
  dead_code: 'Dead code',
  duplication: 'Copied lines',
  dependencies_current: 'Current packages',
  public_symbols_documented: 'Documented',
  dead_names: 'Dead names',
  broken_internal_links: 'Broken links',
  long_sentence_share: 'Long sentences',
  lag_drill: 'Lag drill',
  reading_minutes_p90: 'Reading time',
  doc_lag_hours_p90: 'Doc lag',
  web_loop_seconds: 'Web loop',
  mac_loop_seconds: 'Mac jobs',
  lane_minutes: 'Lane minutes',
};

/** The values measured before any fix (PLAN.md, Baseline). Null where the collector had nothing to read yet. */
export const BASELINE: Record<string, number | null> = {
  checks_failing: 0,
  long_functions: 23,
  long_files: 7,
  type_escapes: 572,
  dead_code: 29,
  duplication: 1.174551,
  dependencies_current: 96.969697,
  web_loop_seconds: 104.5,
  mac_loop_seconds: 162,
};

/** The fixes left, each with the metrics it brings to goal. The Road ranks them by what they add. */
const FIXES: { id: string; label: string; metrics: string[]; ref?: string }[] = [
  { id: 'green', label: 'Green checks', metrics: ['checks_failing'] },
  { id: 'units', label: 'Short units', metrics: ['long_functions', 'long_files'] },
  { id: 'typed', label: 'Typed', metrics: ['type_escapes'] },
  { id: 'dead', label: 'Dead code', metrics: ['dead_code'], ref: '#150' },
  { id: 'web-loop', label: 'Faster web', metrics: ['web_loop_seconds'] },
  { id: 'mac-loop', label: 'Faster Mac', metrics: ['mac_loop_seconds'] },
  { id: 'packages', label: 'Packages', metrics: ['dependencies_current'] },
  { id: 'copies', label: 'Copies', metrics: ['duplication'] },
  { id: 'lane', label: 'Lane in 5 min', metrics: ['lane_minutes'] },
  { id: 'docs', label: 'True docs', metrics: ['public_symbols_documented', 'dead_names', 'broken_internal_links', 'long_sentence_share', 'lag_drill'] },
  { id: 'quick-docs', label: 'Quick docs', metrics: ['reading_minutes_p90', 'doc_lag_hours_p90'] },
];

/** The ideal state, one row per word of it, and which metrics prove it for each side of the code. */
const IDEAL: { row: string; web: string[]; mac: string[] }[] = [
  { row: 'Green', web: ['checks_failing'], mac: ['checks_failing'] },
  { row: 'Typed', web: ['type_escapes'], mac: ['type_escapes'] },
  { row: 'Small', web: ['long_functions', 'long_files'], mac: ['long_functions', 'long_files'] },
  { row: 'Clean', web: ['dead_code', 'duplication'], mac: ['duplication'] },
  { row: 'Current', web: ['dependencies_current'], mac: [] },
  { row: 'Fast', web: ['web_loop_seconds'], mac: ['mac_loop_seconds'] },
  { row: 'Documented', web: ['public_symbols_documented', 'long_sentence_share'], mac: ['public_symbols_documented'] },
  { row: 'No drift', web: ['broken_internal_links', 'dead_names', 'doc_lag_hours_p90'], mac: ['broken_internal_links', 'dead_names', 'doc_lag_hours_p90'] },
];

/** dotMatrix reads any state outside its list as missing, in red: a metric with no reading proves nothing. */
const MISSING = 'missing' as PassState;

function stateOf(ids: string[], scores: Map<string, MetricScore>): PassState {
  if (ids.length === 0) return 'na';
  const found = ids.map((id) => scores.get(id));
  if (found.some((s) => !s || (s.reading !== 'measured' && s.reading !== 'no_events'))) return MISSING;
  return found.every((s) => s?.score === 100) ? 'pass' : 'fail';
}

/** What each fix adds to each ring: the weight its metrics still lack, as a share of that lens. */
function roadFixes(manifest: Pick<Manifest, 'metrics'>, scores: Map<string, MetricScore>): RoadFixProps[] {
  const lensWeight = (lens: string) => manifest.metrics.filter((m) => m.lens === lens).reduce((a, m) => a + m.weight, 0);
  return FIXES.flatMap((fix) => {
    let q = 0;
    let s = 0;
    let c = 0;
    for (const id of fix.metrics) {
      const def = manifest.metrics.find((m) => m.id === id);
      if (!def) continue;
      const lack = (100 * def.weight * (100 - (scores.get(id)?.score ?? 0))) / 100 / lensWeight(def.lens);
      if (def.lens === 'quality') q += lack;
      else if (def.lens === 'speed') s += lack;
      else c += lack;
    }
    const gains = { q, s, c };
    if (fixGain(gains) <= 0) return [];
    const props: RoadFixProps = { id: fix.id, label: fix.label, ...gains };
    if (fix.ref) props.ref = fix.ref;
    return [props];
  }).sort((a, b) => fixGain(b) - fixGain(a));
}

/** The page score the baseline values give, by the same rule as today's. */
export function baselineScore(manifest: Pick<Manifest, 'metrics'>): { q: number; s: number; total: number } {
  const rows = manifest.metrics.map((def) => {
    const v = BASELINE[def.id];
    return { id: def.id, lens: def.lens, weight: def.weight, score: v === null || v === undefined ? 0 : lineScore(def, v) };
  });
  const c = combine(rows);
  return { q: c.quality, s: c.speed, total: c.total };
}

const LENSES = [{ id: 'q', label: 'Quality', short: 'Q' }, { id: 's', label: 'Speed', short: 'S' }, { id: 'c', label: 'Consumption', short: 'C' }];

/** One heatmap row per entry, its three scores, each cell linking to `href` when given. */
function scoreGrid(title: string, entries: { id: string; label: string; scores: Scores; href?: string }[]): string {
  const cells = entries.flatMap((e) => LENSES.map((l) => ({ row: e.id, col: l.id, score: e.scores[l.id as keyof Scores], ...(e.href ? { href: e.href } : {}) })));
  return heatmap({ title, rows: entries.map((e) => ({ id: e.id, label: e.label })), cols: LENSES, cells });
}

/**
 * Every folder on Q, S and C. The first view shows the repository and its top folders; each folder's own page lists
 * its folders, each a link, and its files. Pages are named by index, since a path can't be a file name.
 */
export function tree(all: readonly FileRow[]): { body: string; pages: Record<string, string> } {
  // A file whose path names something the site never publishes (an eval or audit script) stays off the tree.
  const rows = all.filter(([path]) => !NEVER_PUBLISHED.test(path));
  if (rows.length === 0) return { body: missingTile({ label: 'Folders' }), pages: {} };
  const folders = folderScores(rows);
  const dirs = [...folders.keys()].sort();
  const pageOf = (dir: string) => `tree-${dirs.indexOf(dir)}`;
  const parentOf = (path: string) => path.split('/').slice(0, -1).join('/');
  const name = (path: string) => path.split('/').pop() || 'Repo';
  const childDirs = (dir: string) =>
    dirs.filter((d) => d !== '' && parentOf(d) === dir).map((d) => ({ id: d, label: `${name(d)}/`, scores: folders.get(d) as Scores, href: `${pageOf(d)}.html` }));
  const pages: Record<string, string> = {};
  for (const dir of dirs) {
    const files = rows.filter((r) => parentOf(r[0]) === dir).map(([path, q, s, c]) => ({ id: path, label: name(path), scores: { q, s, c } }));
    const up = dir === '' ? '<a href="./">Code</a>' : `<a href="${pageOf(parentOf(dir))}.html">${esc(name(parentOf(dir)))}</a>`;
    pages[pageOf(dir)] = `<nav>${up}</nav><main>${heatLegend()}${scoreGrid(dir || 'Repo', [...childDirs(dir), ...files])}</main>`;
  }
  const top = [{ id: '', label: 'Repo', scores: folders.get('') as Scores, href: `${pageOf('')}.html` }, ...childDirs('')];
  return { body: `${heatLegend()}${scoreGrid('Folders', top)}`, pages };
}

/** tree.json, which the docs lane writes beside this file before the build; none yet reads as an empty tree. */
function readTree(): FileRow[] {
  const file = new URL('tree.json', import.meta.url);
  if (!existsSync(file)) return [];
  try {
    return readRows(JSON.parse(readFileSync(file, 'utf8')));
  } catch {
    return [];
  }
}

/** The page body: what the build puts under its title and score ring. */
export function render({ score, metrics }: PageContext, rows: readonly FileRow[] = readTree()): PageOutput {
  if (!score.has_list) return { body: '' };
  const folders = tree(rows);
  const scores = new Map(score.metrics.map((m) => [m.id, m]));
  const bulletRows = (lens: 'quality' | 'speed') =>
    metrics
      .filter((m) => m.lens === lens)
      .map((m) => {
        const reading = scores.get(m.id)?.reading ?? 'missing';
        const b = BASELINE[m.id];
        return metricBullet(m, LABELS[m.id] ?? m.id, b === null || b === undefined ? { reading } : { reading, baseline: b });
      });
  const grid = dotMatrix({
    caption: 'Ideal',
    rows: IDEAL.map((i) => i.row),
    cols: ['Web', 'Mac'],
    states: IDEAL.map((i) => [stateOf(i.web, scores), stateOf(i.mac, scores)]),
  });
  // Exact lens scores, so each fix's bar starts where the last ended and rounding leaves no false gap. The consumption ring's
  // score too: a variable, so it type-checks before core's RoadScore takes `c`.
  const now = { q: score.exact_quality, s: score.exact_speed, total: score.total, c: score.exact_consumption };
  const road = roadTo100({ baseline: baselineScore({ metrics }), now, fixes: roadFixes({ metrics }, scores) });
  return { body: `${folders.body}${markKey()}${grid}${road}${bullets('Quality', bulletRows('quality'))}${bullets('Speed', bulletRows('speed'))}`, pages: folders.pages };
}
