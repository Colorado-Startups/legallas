// SPDX-License-Identifier: Apache-2.0
// Once a list has a signoff_comment, goals only tighten. Fails a change that removes a metric, eases a goal or floor, changes a
// weight, lowers a sample minimum, or lengthens an age limit, unless a new change-log entry states exactly that
// change, with its reason and issue. Also fails a change loosening more than one page; touching any number of pages and
// the shared code is fine. Output holds pages, ids and numbers only. check-pages.ts runs first, so the lists here already pass the format.
//
// A pull request is checked as one change. A push to main or a merge group can hold several squashed pull requests, so
// there each first-parent commit is checked against its own parent, as its pull request was.
//
//   GOAL_CHECK_BASE=<commit> EVENT_NAME=pull_request node quality-speed/core/goal-check.ts
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Change, Manifest, MetricDef } from '../contract/format.ts';
import { PAGES, type PageSlug } from '../contract/pages.ts';

/** One loosening: what a matching change-log entry has to say. */
type Loosening = Pick<Change, 'metric' | 'field' | 'from' | 'to'>;

/** A change may loosen at most one page. */
export function checkLoosened(loosened: readonly string[]): string[] {
  return loosened.length > 1 ? ['paths: a pull request may loosen one page only'] : [];
}

/** How a metric moved, in the direction that matters for each field. Any change of what its numbers mean counts. */
function looseningsOf(base: MetricDef, head: MetricDef): Loosening[] {
  const out: Loosening[] = [];
  const add = (field: Change['field'], from: Change['from'], to: Change['to']) => out.push({ metric: base.id, field, from, to });
  // A new direction or unit makes the old numbers incomparable, so then any change to them counts.
  const sameScale = head.direction === base.direction && head.unit === base.unit;
  const eased = (from: number, to: number) => (sameScale ? (base.direction === 'higher' ? to < from : to > from) : to !== from);
  for (const field of ['direction', 'unit', 'lens', 'coverage_metric', 'group'] as const) {
    if (head[field] !== base[field]) add(field, base[field] ?? null, head[field] ?? null);
  }
  if (eased(base.goal, head.goal)) add('goal', base.goal, head.goal);
  if (eased(base.floor, head.floor)) add('floor', base.floor, head.floor);
  // Weights only mean anything against each other, so raising one lowers the rest.
  if (head.weight !== base.weight) add('weight', base.weight, head.weight);
  if (head.min_samples < base.min_samples) add('min_samples', base.min_samples, head.min_samples);
  if (head.max_age_hours > base.max_age_hours) add('max_age_hours', base.max_age_hours, head.max_age_hours);
  return out;
}

/** Every way the head list is easier than the base list. */
export function findLoosenings(base: Manifest, head: Manifest): Loosening[] {
  const metrics = new Map(head.metrics.map((m) => [m.id, m]));
  const groups = new Map((head.groups ?? []).map((g) => [g.id, g.weight]));
  return [
    ...base.metrics.flatMap((b) => {
      const h = metrics.get(b.id);
      return h ? looseningsOf(b, h) : [{ metric: b.id, field: 'retired' as const, from: null, to: null }];
    }),
    ...(base.groups ?? []).flatMap((g) => {
      const to = groups.get(g.id) ?? null;
      return to === g.weight ? [] : [{ metric: g.id, field: 'group_weight' as const, from: g.weight, to }];
    }),
  ];
}

const label = (l: Loosening) => `${l.metric} ${l.field} ${String(l.from)} to ${String(l.to)}`;

/** Compares one page's signed-off list. The log is append-only, and each loosening needs a new entry saying exactly that. */
export function compareManifests(page: PageSlug, base: Manifest | null, head: Manifest | null): string[] {
  if (base?.signoff_comment === undefined) return [];
  if (!head) return [`${page}: the list was removed, and a change log can't excuse that`];
  if (head.signoff_comment === undefined) return [`${page}: a list's signoff_comment can't be removed`];
  if (JSON.stringify(head.changes.slice(0, base.changes.length)) !== JSON.stringify(base.changes)) return [`${page}: the change log may only be added to`];
  const added = head.changes.slice(base.changes.length);
  return findLoosenings(base, head)
    .filter((l) => !added.some((e) => e.metric === l.metric && e.field === l.field && e.from === l.from && e.to === l.to))
    .map((l) => `${page}: ${label(l)} needs a change-log entry`);
}

/** Whether a page's signed-off list got easier, or went. */
export function isLoosened(base: Manifest | null, head: Manifest | null): boolean {
  return base?.signoff_comment !== undefined && (!head || findLoosenings(base, head).length > 0);
}

const git = (root: string, ...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

/** The list on the base commit, or null when the page really had none. An unreadable one stops the check. */
export function baseManifest(root: string, base: string, page: PageSlug): Manifest | null {
  const file = `quality-speed/pages/${page}/manifest.json`;
  return git(root, 'ls-tree', '--full-tree', '--name-only', base, file) ? (JSON.parse(git(root, 'show', `${base}:${file}`)) as Manifest) : null;
}

/** Every problem with the change from a base commit to `head`: the working tree for `HEAD`, otherwise that commit's files. */
export function goalCheck(root: string, base: string, head = 'HEAD'): string[] {
  // CI's base is already an ancestor of what it checks out. A newer base would read pages landed since as removed.
  const from = git(root, 'merge-base', base, head).trim();
  const pages = PAGES.map((page) => {
    const file = path.join(root, 'quality-speed', 'pages', page, 'manifest.json');
    const working = () => (existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Manifest) : null);
    return { page, base: baseManifest(root, from, page), head: head === 'HEAD' ? working() : baseManifest(root, head, page) };
  });
  return [
    ...checkLoosened(pages.filter((p) => isLoosened(p.base, p.head)).map((p) => p.page)),
    ...pages.flatMap((p) => compareManifests(p.page, p.base, p.head)),
  ];
}

/** Each first-parent commit from a base commit to HEAD, oldest first, checked against the one before it. On main, with squash
 * merges only, each is one pull request; a merge commit would be checked as one change, which is no looser than before. */
export function goalCheckEach(root: string, base: string): string[] {
  const commits = git(root, 'rev-list', '--first-parent', '--reverse', `${base}..HEAD`).split('\n').filter(Boolean);
  return commits.flatMap((commit, i) => goalCheck(root, i === 0 ? base : (commits[i - 1] ?? base), commit).map((error) => `${commit.slice(0, 12)}: ${error}`));
}

if (import.meta.main) {
  const base = process.env.GOAL_CHECK_BASE ?? '';
  const event = process.env.EVENT_NAME ?? '';
  // A manual run has nothing to compare with. A pull request or merge group always has a base, so its absence must fail.
  if (!base && (event === 'pull_request' || event === 'merge_group')) {
    console.error(`goal check: no base commit on a ${event}`);
    process.exit(1);
  }
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const each = event === 'push' || event === 'merge_group';
  const errors = !base ? [] : each ? goalCheckEach(root, base) : goalCheck(root, base);
  for (const error of errors) console.error(error);
  if (errors.length) process.exit(1);
  console.log(base ? 'Goal check passed.' : 'Goal check: no base commit to compare with.');
}
