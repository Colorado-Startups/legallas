// SPDX-License-Identifier: Apache-2.0
// The rule lives with the Build page, whose site build may read only quality-speed/; web/scripts/migration-numbers.test.ts checks web/migrations with it.
// D1 migration numbers: each once, from 0001 with no gap, so the order Wrangler applies them in (by name) is the order
// they were written (#362). Two pairs landed in parallel before this check. They stay: D1 records a migration by name,
// so a renamed one would run again in a room that already applied it, and an applied migration never changes. Each
// pair's files create objects the other never touches, so either order gives the same database. No new pair joins them.
export const SHARED_NUMBERS: Readonly<Record<number, readonly string[]>> = {
  16: ['0016_checklist.sql', '0016_sync_upload_bytes.sql'],
  19: ['0019_audit_append_only.sql', '0019_hold_custodians.sql'],
};

const NAME = /^(\d{4})_[a-z0-9_]+\.sql$/;
const pad = (n: number) => String(n).padStart(4, '0');

/** What is wrong with these migration file names; an empty list when they are numbered in order. */
export function numberingProblems(names: readonly string[]): string[] {
  const problems: string[] = [];
  const byNumber = new Map<number, string[]>();
  for (const name of names) {
    const match = NAME.exec(name);
    if (!match) {
      problems.push(`${name} is not NNNN_name.sql`);
      continue;
    }
    const n = Number(match[1]);
    byNumber.set(n, [...(byNumber.get(n) ?? []), name]);
  }
  const numbers = [...byNumber.keys()].sort((a, b) => a - b);
  const gap = numbers.findIndex((n, i) => n !== i + 1);
  if (gap >= 0) problems.push(`${pad(gap + 1)} is missing`);
  for (const n of numbers) {
    const files = (byNumber.get(n) ?? []).sort();
    if (files.length === 1) continue;
    const known = [...(SHARED_NUMBERS[n] ?? [])].sort();
    if (files.join() !== known.join()) problems.push(`${files.join(' and ')} share ${pad(n)}: give the newer one the next free number`);
  }
  return problems;
}
