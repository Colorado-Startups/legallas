// SPDX-License-Identifier: Apache-2.0
// Card F4. Compares the built manifest with the published one: per list, how many entries were added,
// removed or changed. Entries are matched by id (links by from, to and label; docs by documents.id; meta as
// one entry with builtAt ignored). Counts only, so the output never carries case text.
import type { Matter } from '../../worker/matter-types.ts';

/** The counts of entries added and removed in one list. */
export interface ListDiff {
  added: number;
  removed: number;
  changed: number;
  unchanged: number;
}

/** The lists that the diff compares. */
export const DIFF_LISTS = ['meta', 'tracks', 'violations', 'events', 'people', 'orgs', 'links', 'claims', 'money', 'docs'] as const;
/** The name of one list that the diff compares. */
export type DiffList = (typeof DIFF_LISTS)[number];

type Keyed = Map<string, string>;

function keyed(matter: Matter | null, list: DiffList): Keyed {
  const out: Keyed = new Map();
  if (!matter) return out;
  if (list === 'meta') {
    const { builtAt: _builtAt, ...rest } = matter.meta;
    out.set('meta', JSON.stringify(rest));
  } else if (list === 'docs') {
    for (const [id, facts] of Object.entries(matter.docs ?? {})) out.set(id, JSON.stringify(facts));
  } else if (list === 'links') {
    for (const link of matter.links ?? []) out.set(JSON.stringify([link.from, link.to, link.label]), JSON.stringify(link));
  } else {
    // A published manifest from before tracks and violations has neither list.
    for (const entry of (matter[list] ?? []) as { id: string }[]) out.set(entry.id, JSON.stringify(entry));
  }
  return out;
}

/** Diffs every list. `published` is null when nothing has been published yet. */
export function diffMatter(published: Matter | null, built: Matter): Record<DiffList, ListDiff> {
  const out = {} as Record<DiffList, ListDiff>;
  for (const list of DIFF_LISTS) {
    const before = keyed(published, list);
    const after = keyed(built, list);
    const diff: ListDiff = { added: 0, removed: 0, changed: 0, unchanged: 0 };
    for (const [key, value] of after) {
      const old = before.get(key);
      if (old === undefined) diff.added += 1;
      else if (old === value) diff.unchanged += 1;
      else diff.changed += 1;
    }
    for (const key of before.keys()) if (!after.has(key)) diff.removed += 1;
    out[list] = diff;
  }
  return out;
}

/** Formats the diff of the built and published manifests as text. */
export function formatDiff(diff: Record<DiffList, ListDiff>, publishedExists: boolean): string {
  const lines = [publishedExists ? 'Built manifest versus the published one:' : 'Nothing is published yet; every entry is new:'];
  for (const list of DIFF_LISTS) {
    const d = diff[list];
    lines.push(`  ${list.padEnd(10)} +${d.added}  -${d.removed}  ~${d.changed}  =${d.unchanged}`);
  }
  return lines.join('\n');
}
