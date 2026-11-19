// SPDX-License-Identifier: Apache-2.0
// Which collectors a run takes. Each page declares its lanes in its own lanes.json, so adding one never edits the workflow.
//
//   node quality-speed/core/lanes.ts --event <name> --weekday <1-7>
//
// Prints matrix=<JSON> for $GITHUB_OUTPUT. A page whose lanes.json is wrong is reported and left out, so its metrics read
// as missing and the other pages still run; the test beside this file refuses such a file before it reaches main.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import type { Manifest } from '../contract/format.ts';
import { isPublicLane, PAGES, type PageSlug } from '../contract/pages.ts';
import { validateManifest } from '../contract/validate.ts';

export const PAGES_DIR = fileURLToPath(new URL('../pages', import.meta.url));

/**
 * `linux` takes Blacksmith's free minutes first, through the `choose-runner` job, and has 10 minutes and the narrower read
 * scopes; `linux-hosted` is always GitHub's, and has 45 and all of them, so a long lane or an alert reader declares that.
 */
const RUNNERS = { linux: 'choose-runner', 'linux-hosted': 'ubuntu-latest', macos: 'macos-26', windows: 'windows-2025' } as const;
/** Everyone else's collectors never see repository settings. */
const ADMIN_PAGES: readonly string[] = ['launch-readiness', 'projects', 'security', 'settings'];
/** The most lanes a run sends to Blacksmith. With their 10 minutes, this is the run's worst case in build_minutes_guard.py. */
const MAX_BLACKSMITH_LANES = 30;
const LANE_KEYS = new Set(['id', 'runner', 'cadence', 'collector', 'args', 'install', 'admin']);
/** In the page's folder, or the shared kits in core/. No other way out of the folder, and never a shell. */
function isCollector(collector: string): boolean {
  const NAME = /^[a-z0-9][a-z0-9_-]*$/;
  const folders = (collector.startsWith('../../core/') ? collector.slice('../../core/'.length) : collector).split('/');
  const [base = '', ...extensions] = (folders.pop() ?? '').split('.');
  return folders.every((folder) => NAME.test(folder)) && NAME.test(base) && extensions.at(-1) === 'ts' && extensions.every((extension) => /^[a-z0-9]+$/.test(extension));
}
const ARG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export interface Lane {
  id: string;
  runner: keyof typeof RUNNERS;
  /** daily: the schedule, and merges on Linux. nightly: the schedule only. weekly: Sundays only. */
  cadence: 'daily' | 'nightly' | 'weekly';
  /** A .ts file in the page's folder, or ../../core/<kit>/<file>.ts. */
  collector: string;
  /** Plain words passed before --out, such as a shared kit's page name. */
  args: string[];
  /** Runs `npm ci --ignore-scripts` in web/ first. */
  install: boolean;
  /** Receives the admin key's read-outs, so it stays on GitHub's own runners. */
  admin: boolean;
}

/** The pages a merge touched, or null when it touched anything that can change every page. */
export function touchedPages(commit: { added?: string[]; modified?: string[]; removed?: string[] } | null | undefined): Set<string> | null {
  const files = [...(commit?.added ?? []), ...(commit?.modified ?? []), ...(commit?.removed ?? [])];
  const pages = files.map((file) => /^quality-speed\/pages\/([^/]+)\//.exec(file)?.[1]);
  return !files.length || pages.includes(undefined) ? null : new Set(pages as string[]);
}

/** A page's reviewed list, or null when it has none yet or the file is wrong (check-pages.ts refuses that on a pull request). */
export function loadManifest(slug: PageSlug, pagesDir = PAGES_DIR): Manifest | null {
  try {
    return validateManifest(JSON.parse(readFileSync(path.join(pagesDir, slug, 'manifest.json'), 'utf8')), slug).value;
  } catch {
    return null;
  }
}

function laneErrors(item: Record<string, unknown>, slug: PageSlug, pageDir: string): string[] {
  const { id, runner, cadence, collector, args, install, admin } = item;
  const errors: string[] = [];
  if (Object.keys(item).some((key) => !LANE_KEYS.has(key))) errors.push('unknown field');
  if (typeof id !== 'string' || !/^[a-z][a-z0-9-]{0,30}$/.test(id)) errors.push('id must be short, lowercase letters, digits and hyphens');
  if (typeof runner !== 'string' || !Object.hasOwn(RUNNERS, runner)) errors.push('runner is not in the closed list');
  if (cadence !== 'daily' && cadence !== 'nightly' && cadence !== 'weekly') errors.push('cadence must be daily, nightly or weekly');
  // Their minutes count extra, so one hanging every day would take a large share of the month's allowance.
  if ((runner === 'macos' || runner === 'windows') && cadence !== 'weekly') errors.push('macos and windows lanes must be weekly');
  if (admin !== undefined && typeof admin !== 'boolean') errors.push('admin must be true or false');
  if (admin === true && !ADMIN_PAGES.includes(slug)) errors.push('this page may not read the admin read-outs');
  if (admin === true && runner === 'linux') errors.push('a lane with the admin read-outs must be linux-hosted');
  if (args !== undefined && !(Array.isArray(args) && args.every((arg) => typeof arg === 'string' && ARG.test(arg)))) errors.push('args must be a list of plain words');
  if (install !== undefined && typeof install !== 'boolean') errors.push('install must be true or false');
  if (typeof collector !== 'string' || !isCollector(collector)) errors.push("collector must be a .ts file in the page's folder or core/");
  else if (!existsSync(path.join(pageDir, collector))) errors.push('collector file is missing');
  return errors;
}

/** A page's declared lanes. No lanes.json is fine. One problem refuses the whole file. */
export function loadLanes(slug: PageSlug, pagesDir = PAGES_DIR): { lanes: Lane[]; errors: string[] } {
  const file = path.join(pagesDir, slug, 'lanes.json');
  if (!existsSync(file)) return { lanes: [], errors: [] };
  if (!loadManifest(slug, pagesDir)) return { lanes: [], errors: ['lanes.json needs a valid manifest.json'] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return { lanes: [], errors: ['lanes.json is not valid JSON'] };
  }
  if (!Array.isArray(parsed)) return { lanes: [], errors: ['lanes.json must be a list'] };
  const errors = parsed.flatMap((item: Record<string, unknown>, i) => laneErrors(item ?? {}, slug, path.dirname(file)).map((e) => `lanes[${i}]: ${e}`));
  const ids = parsed.map((item: { id?: unknown }) => item?.id);
  if (new Set(ids).size !== ids.length) errors.push('lanes: an id repeats');
  if (errors.length) return { lanes: [], errors };
  return { lanes: parsed.map((item: Lane) => ({ ...item, args: item.args ?? [], install: item.install ?? false, admin: item.admin ?? false })), errors };
}

/**
 * Whether this lane runs on this event. Mac minutes count 10x, so a merge takes only daily Linux lanes. The schedule takes
 * daily and nightly lanes, plus weekly ones on Sundays, and a manual run takes everything. Any other event takes nothing.
 */
export function runsNow(lane: Pick<Lane, 'runner' | 'cadence'>, event: string, weekday: number): boolean {
  if (event === 'workflow_dispatch') return true;
  if (event === 'push') return lane.runner.startsWith('linux') && lane.cadence === 'daily';
  if (event === 'schedule') return lane.cadence !== 'weekly' || weekday === 7;
  return false;
}

/** A page's lanes that may run in this public repository's workflow: none for a private page (pages.ts, PUBLIC_PAGES). */
export function publicLanes(slug: PageSlug, pagesDir = PAGES_DIR): Lane[] {
  return loadLanes(slug, pagesDir).lanes.filter((lane) => isPublicLane(slug, lane.id));
}

/** This run's matrix, plus any problem found on the way. A private page's lanes.json is still checked, but no lane of it is planned. */
export function matrixFor(event: string, weekday: number, pagesDir = PAGES_DIR, touched: Set<string> | null = null) {
  const declared = PAGES.map((slug) => ({ slug, lanes: publicLanes(slug, pagesDir), errors: loadLanes(slug, pagesDir).errors }));
  let onBlacksmith = 0;
  const runnerOf = (lane: Lane) => {
    if (lane.runner !== 'linux') return RUNNERS[lane.runner];
    onBlacksmith += 1;
    return onBlacksmith <= MAX_BLACKSMITH_LANES ? RUNNERS.linux : RUNNERS['linux-hosted'];
  };
  return {
    rows: declared.filter(({ slug }) => !touched || touched.has(slug)).flatMap(({ slug, lanes }) =>
      lanes.filter((lane) => runsNow(lane, event, weekday)).map((lane) => ({ slug, lane: lane.id, runner: runnerOf(lane), install: lane.install, admin: lane.admin })),
    ),
    errors: declared.flatMap(({ slug, errors }) => errors.map((e) => `pages/${slug}: ${e}`)),
  };
}

/** Every lane for `site`, then one matrix per job, because a job's read scopes are fixed. */
export function planOutputs(rows: readonly { runner: string }[]): string[] {
  const output = (name: string, include: readonly { runner: string }[]) => `${name}=${JSON.stringify({ include })}`;
  return [
    output('matrix', rows),
    output('blacksmith', rows.filter((row) => row.runner === RUNNERS.linux)),
    output('hosted', rows.filter((row) => row.runner !== RUNNERS.linux)),
  ];
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { event: { type: 'string' }, weekday: { type: 'string' }, page: { type: 'string', default: '' } } });
  // A merge remeasures only the pages it changed, and a manual run naming a page only that page; the rest keep their last
  // records, and the daily run takes them all.
  const payload = process.env.GITHUB_EVENT_PATH ? JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')) : null;
  if (values.page && !(PAGES as readonly string[]).includes(values.page)) console.error(`::error title=Quality and Speed lanes::no page is named ${values.page}`);
  const touched = values.page ? new Set([values.page]) : values.event === 'push' ? touchedPages(payload?.head_commit) : null;
  const { rows, errors } = matrixFor(values.event ?? '', Number(values.weekday), PAGES_DIR, touched);
  for (const error of errors) console.error(`::error title=Quality and Speed lanes::${error}`);
  for (const line of planOutputs(rows)) console.log(line);
}
