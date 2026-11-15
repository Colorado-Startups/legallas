// SPDX-License-Identifier: Apache-2.0
// Builds the site with no packages. It scores each page from its reviewed list and validated records, then writes a home
// page and one page per section, complete before any script runs. A page's folder may hold page.ts, whose render() returns
// the body; without one a signed-off page shows a table of its metrics. --synthetic puts every metric at its goal so CI
// can build and check every page on invented numbers, and the publish guard refuses to publish that build.
//
// The command runs itself again inside Node's permission fence, because a page's code is real code and patterns over
// source can't hold it: it can read only quality-speed/, the state and its output, write only its output, and start no
// process or worker, with an empty environment.
//
//   node quality-speed/core/build.ts --state <dir> --out <dir>
//   node quality-speed/core/build.ts --synthetic --out <dir>
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import type { HistoryLine, Ideal, Manifest, Metric, MetricRecord } from '../contract/format.ts';
import { PAGE_GROUPS, PAGES, RENAMED, REPO, type PageSlug } from '../contract/pages.ts';
import { isPublicUrl, joinMetrics, validateHistoryLine, validateIdeal, validateManifest, validateRecords } from '../contract/validate.ts';
import { dataTable, esc, fmtDate, historyRows, missingTile, ring, ringGrid, tileRow, timeline, type RingProps, type TimelineRow, type TimelineScore } from './charts/index.ts';
import { pageDetail, type Detail } from './detail.ts';
import { countWords, PAGE_END, pageHead, SAFE_NAME } from './guard.ts';
import { scoreHome, scorePage, type PageScore } from './score.ts';

/** What a page's render() receives. */
export interface PageContext {
  score: PageScore;
  metrics: Metric[];
  history: HistoryLine[];
  /** Every page's scores, so a page can show another's without measuring twice. */
  others: Partial<Record<PageSlug, Pick<PageScore, 'quality' | 'speed' | 'consumption' | 'total'>>>;
  /** The drill-down behind the metrics, if a lane wrote one (core/detail.ts). */
  detail: Detail | null;
}

/** What a page's render() returns. Each `data` and `pages` entry is written beside the page, loaded on demand. */
export interface PageOutput {
  body: string;
  /** <name>.json */
  data?: Record<string, unknown>;
  /** <name>.html, a drill-down body in the same shell */
  pages?: Record<string, string>;
}

interface BuildOptions {
  pagesDir: string;
  /** Holds history.jsonl and records/<slug>.json. Null for a synthetic build. */
  state: string | null;
  out: string;
  now: Date;
}

interface Loaded extends Omit<PageContext, 'others'> {
  page: PageSlug;
  manifest: Manifest | null;
  /** The reviewed ideal.json, or null when it is missing or fails its check. */
  ideal: Ideal | null;
}

const ASSETS = [new URL('./charts/charts.css', import.meta.url), new URL('./charts/charts.js', import.meta.url), new URL('./site.css', import.meta.url)];

const ACRONYMS: Record<string, string> = {
  sec: 'Securities and Exchange Commission',
  'ai-connectors': 'AI connectors',
  'ci-overview': 'CI overview',
  // Its full name, as quality-speed/BRIEF.md asks.
  'colorado-regulatory-agencies': 'Colorado Department of Regulatory Agencies',
};
const titleOf = (page: string) => ACRONYMS[page] ?? `${page.charAt(0).toUpperCase()}${page.slice(1).replaceAll('-', ' ')}`;

function readJson(file: string): unknown {
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : undefined;
}

/** A page's ideal.json, or null when it is absent, isn't JSON or fails its check, so the page shows the red tile. */
function readIdeal(page: PageSlug, pagesDir: string, now: Date): Ideal | null {
  const file = path.join(pagesDir, page, 'ideal.json');
  if (!existsSync(file)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    console.error(`${page}/ideal.json: not valid JSON`);
    return null;
  }
  const checked = validateIdeal(parsed, now);
  for (const error of checked.errors) console.error(`${page}/ideal.json: ${error}`);
  return checked.value;
}

/** Every metric at its goal, marked lab. */
function syntheticRecords(manifest: Manifest, now: Date): MetricRecord[] {
  return manifest.metrics.map((m) => ({
    id: m.id,
    page: manifest.page,
    value: m.goal,
    status: 'ok',
    stage: 'lab',
    measured_at: now.toISOString().replace(/\.\d+Z$/, 'Z'),
    source_url: `https://github.com/Colorado-Startups/${REPO}/actions/runs/1`,
    sample_size: m.min_samples,
  }));
}

function loadPage(page: PageSlug, history: HistoryLine[], { pagesDir, state, now }: BuildOptions): Loaded {
  const parsed = readJson(path.join(pagesDir, page, 'manifest.json'));
  const checked = parsed === undefined ? null : validateManifest(parsed, page);
  for (const error of checked?.errors ?? []) console.error(`${page}/manifest.json: ${error}`);
  const manifest = checked?.value ?? null;
  const input = !manifest ? [] : state ? (readJson(path.join(state, 'records', `${page}.json`)) ?? []) : syntheticRecords(manifest, now);
  const { records, errors } = manifest ? validateRecords(input, manifest) : { records: [], errors: [] };
  for (const error of errors) console.error(`${page}/records: ${error}`);
  return {
    page,
    manifest,
    ideal: readIdeal(page, pagesDir, now),
    score: scorePage(page, manifest, records, now),
    metrics: manifest ? joinMetrics(manifest, records) : [],
    history: history.filter((line) => line.page === page),
    detail: state ? pageDetail(state, page) : null,
  };
}

export function readHistory(state: string | null): HistoryLine[] {
  const file = state === null ? null : path.join(state, 'history.jsonl');
  if (file === null || !existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      const parsed: unknown = JSON.parse(line);
      // A renamed page's old lines read under its new slug (pages.ts).
      const page = (parsed as { page?: unknown } | null)?.page;
      const renamed = typeof page === 'string' && Object.hasOwn(RENAMED, page) ? { ...(parsed as object), page: RENAMED[page] } : parsed;
      return validateHistoryLine(renamed).value ?? [];
    });
}

/** A row per metric, for a page with no page.ts yet. A table, because a long list would pass the word limit as tiles. */
function defaultBody({ score, metrics }: Pick<PageContext, 'score' | 'metrics'>): string {
  if (!score.has_list) return '';
  const columns = [{ key: 'metric', label: 'metric' }, { key: 'value', label: 'value', type: 'num' as const, unitKey: 'unit' }, { key: 'reading', label: 'reading' }];
  return dataTable({ caption: 'Metrics', columns, rows: metrics.map((m, i) => ({ metric: m.id, value: m.value, unit: m.unit, reading: score.metrics[i]?.reading ?? 'missing' })) });
}

/** The change log's file. A page's own on-demand page can't take this name. */
const CHANGES = 'changes';

/**
 * The change log, so a retired metric or an eased goal stays on the site: on its own page, because it only grows and
 * would otherwise spend the first view's bytes (#458). The first view keeps a one-row table linking to it.
 */
function changeLog(page: PageSlug, manifest: Manifest | null): { link: string; page: string } | null {
  if (!manifest?.changes.length) return null;
  const columns = ['date', 'metric', 'field', 'from', 'to', 'reason'].map((key) => ({ key, label: key }));
  const table = dataTable({ caption: 'Changes', columns, rows: manifest.changes.map((c) => ({ ...c, from: String(c.from), to: String(c.to), issue: null, signoff_comment: null })) });
  const link = dataTable({ caption: 'Changes', filter: false, columns: [{ key: 'rows', label: 'rows', type: 'num' as const }], rows: [{ rows: manifest.changes.length, href: `${CHANGES}.html` }], linkKey: 'href' });
  return { link, page: `<nav><a href="./">${esc(titleOf(page))}</a></nav><main><h1>Changes</h1>${table}</main>` };
}

/**
 * The page's ideal state and the documents it rests on, under the ring. Each source links its own document; the guard
 * lets a page link outside this repository only to a URL its own reviewed ideal.json lists. A page with no valid
 * ideal.json shows the red tile a missing reading gets.
 */
function idealHeader(ideal: Ideal | null, noConsumption: boolean): string {
  // A signed-off page with no consumption metric scores 0 there, and says so as loudly as a missing reading.
  const tiles = [...(ideal ? [] : [missingTile({ label: 'Ideal state' })]), ...(noConsumption ? [missingTile({ label: 'Consumption' })] : [])];
  const row = tiles.length ? tileRow(tiles) : '';
  if (!ideal) return row;
  const lines = (['quality', 'speed', 'consumption'] as const).flatMap((lens) => (ideal[lens] ? [{ part: titleOf(lens), state: ideal[lens] }] : []));
  const state = dataTable({ caption: 'Ideal state', filter: false, columns: [{ key: 'part', label: 'part' }, { key: 'state', label: 'ideal state' }], rows: [{ part: 'Ideal', state: ideal.ideal }, ...lines] });
  const columns = [{ key: 'title', label: 'source' }, { key: 'date', label: 'date' }];
  const rows = ideal.sources.map((source, i) => ({ title: `${i + 1}. ${source.title}`, date: source.date, href: source.url }));
  const safe = (url: string) => (isPublicUrl(url) ? url : null);
  return `${row}<div class="qs-ideal">${state}<div class="qs-ideal-sources">${dataTable({ caption: 'Sources', filter: false, columns, rows, linkKey: 'href', safe })}</div></div>`;
}

function shell(title: string, root: string, body: string, synthetic: boolean): string {
  return `${pageHead(esc(title), root, synthetic)}${body}${PAGE_END}`;
}

/** A page's on-demand files, under names that can't leave its folder. */
function writeOnDemand(entries: Record<string, unknown> | undefined, write: (name: string, value: unknown) => void, page: string): void {
  for (const [name, value] of Object.entries(entries ?? {})) {
    if (!SAFE_NAME.test(name)) throw new Error(`${page}: an on-demand file's name must be lowercase letters, digits and hyphens`);
    write(name, value);
  }
}

function ringOf({ page, score }: Pick<Loaded, 'page' | 'score'>): RingProps {
  const known = score.has_list;
  return { id: page, label: titleOf(page), q: known ? score.quality : null, s: known ? score.speed : null, c: known ? score.consumption : null, total: known ? score.total : null };
}

/** What every page has around its own body: the nav, the title, the ring and the ideal-state header. */
function frame(loaded: Pick<Loaded, 'page' | 'score' | 'ideal' | 'manifest'>, inner: string): string {
  const noConsumption = loaded.score.has_list && !loaded.manifest?.metrics.some((m) => m.lens === 'consumption');
  return `<nav><a href="../">Home</a></nav><main><h1>${esc(titleOf(loaded.page))}</h1>${ring({ ...ringOf(loaded), label: '', size: 'xl' })}${idealHeader(loaded.ideal, noConsumption)}${inner}</main>`;
}

/**
 * The visible words the build adds around a page's body, at their most: the ring's key shown, and the red tiles for no
 * valid ideal.json and for a list with no consumption metric. A page test budgets `MAX_WORDS - frameWords(page)` for
 * its own `render().body`.
 */
export function frameWords(page: PageSlug, pagesDir = fileURLToPath(new URL('../pages', import.meta.url)), now = new Date()): number {
  const score = { ...scorePage(page, null, [], now), has_list: true };
  const parsed = readJson(path.join(pagesDir, page, 'manifest.json'));
  const manifest = parsed === undefined ? null : validateManifest(parsed, page).value;
  return countWords(frame({ page, score, manifest, ideal: readIdeal(page, pagesDir, now) }, ''));
}

async function writePage(loaded: Loaded, others: PageContext['others'], { pagesDir, out, state }: BuildOptions): Promise<void> {
  const code = path.join(pagesDir, loaded.page, 'page.ts');
  const output: PageOutput = existsSync(code)
    ? ((await import(pathToFileURL(code).href)) as { render(context: PageContext): PageOutput }).render({ ...loaded, others })
    : { body: defaultBody(loaded) };
  const dir = path.join(out, loaded.page);
  mkdirSync(dir, { recursive: true });
  writeOnDemand(output.data, (name, value) => writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(value)), loaded.page);
  if (output.pages && CHANGES in output.pages) throw new Error(`${loaded.page}: "${CHANGES}" is the change log's page`);
  writeOnDemand(output.pages, (name, html) => writeFileSync(path.join(dir, `${name}.html`), shell(titleOf(loaded.page), '../', html as string, state === null)), loaded.page);
  const log = changeLog(loaded.page, loaded.manifest);
  if (log) writeFileSync(path.join(dir, `${CHANGES}.html`), shell(titleOf(loaded.page), '../', log.page, state === null));
  const body = frame(loaded, `${output.body}${log?.link ?? ''}`);
  writeFileSync(path.join(dir, 'index.html'), shell(titleOf(loaded.page), '../', body, state === null));
}

/** The home ring from each page's scores, whether from today's pages or a day in the history. */
function homeOf(rings: Record<string, TimelineScore>): TimelineScore {
  const home = (field: 'q' | 's' | 'c' | 'total') => scoreHome(Object.fromEntries(Object.entries(rings).map(([page, r]) => [page, r[field]])));
  return { q: home('q'), s: home('s'), c: home('c'), total: home('total') };
}

function writeHome(pages: readonly Loaded[], rows: readonly TimelineRow[], { out, state }: BuildOptions): void {
  const item = (page: PageSlug) => ({ ...ringOf(pages.find((p) => p.page === page) as Loaded), href: `${page}/` });
  const groups = Object.entries(PAGE_GROUPS).map(([group, list]) => ({
    label: titleOf(group),
    rings: list.filter((page) => page !== 'data-room').map(item),
  }));
  const home = homeOf(Object.fromEntries(pages.map((p) => [p.page, { q: p.score.quality, s: p.score.speed, c: p.score.consumption, total: p.score.total }])));
  const line = rows.length ? timeline({ history: [...rows], main: 'home', src: 'history.json' }) : '';
  // The Motion films (private claude.ai pages) are listed in BRIEF.md: the guard keeps links inside this repository.
  const films = `<nav><a href="https://github.com/Colorado-Startups/${REPO}/blob/main/quality-speed/BRIEF.md">How scores work: films</a></nav>`;
  const body = `${films}<main><h1>Quality and Speed</h1>${ring({ id: 'home', size: 'lg', ...home })}${ringGrid(item('data-room'), groups)}${line}</main>`;
  writeFileSync(path.join(out, 'index.html'), shell('Quality and Speed', '', body, state === null));
  writeFileSync(path.join(out, 'history.json'), JSON.stringify(rows.map((r) => ({ label: fmtDate(r.t), rings: r.rings }))));
}

/** Writes the whole site. */
export async function buildSite(options: BuildOptions): Promise<void> {
  // A folder with old files in it could carry a test build's numbers past a real guard.
  if (existsSync(options.out) && readdirSync(options.out).length) throw new Error('build: --out must be empty');
  mkdirSync(options.out, { recursive: true });
  for (const asset of ASSETS) copyFileSync(asset, path.join(options.out, path.basename(fileURLToPath(asset))));
  const history = readHistory(options.state);
  const pages = PAGES.map((page) => loadPage(page, history, options));
  const others = Object.fromEntries(pages.map(({ page, score }) => [page, { quality: score.quality, speed: score.speed, consumption: score.consumption, total: score.total }]));
  for (const loaded of pages) await writePage(loaded, others, options);
  writeHome(pages, historyRows(history, homeOf), options);
}

/** Runs this command again inside the fence, on real paths, because module loading can't stat a symlink from inside it. */
function runFenced(out: string, state: string | null, pages: string | undefined): never {
  mkdirSync(out, { recursive: true });
  const dirs = { out: realpathSync(out), state: state && realpathSync(state), pages: pages && realpathSync(pages) };
  const reads = [fileURLToPath(new URL('..', import.meta.url)), dirs.out, dirs.state, dirs.pages].filter(Boolean).map((dir) => `--allow-fs-read=${dir?.replace(/\/$/, '')}/`);
  const args = ['--out', dirs.out, ...(dirs.state ? ['--state', dirs.state] : ['--synthetic']), ...(dirs.pages ? ['--pages', dirs.pages] : [])];
  const result = spawnSync(process.execPath, ['--permission', ...reads, `--allow-fs-write=${dirs.out}/`, fileURLToPath(import.meta.url), ...args], { stdio: 'inherit', env: {} });
  process.exit(result.status ?? 1);
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { state: { type: 'string' }, out: { type: 'string' }, pages: { type: 'string' }, synthetic: { type: 'boolean' } } });
  if (!values.out || (!values.state && !values.synthetic)) {
    console.error('usage: build.ts --state <dir> --out <dir>, or build.ts --synthetic --out <dir>');
    process.exit(1);
  }
  const state = values.synthetic ? null : (values.state ?? null);
  if (!process.permission) runFenced(values.out, state, values.pages);
  await buildSite({ pagesDir: values.pages ?? fileURLToPath(new URL('../pages', import.meta.url)), state, out: values.out, now: new Date() });
}
