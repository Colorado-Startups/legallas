// SPDX-License-Identifier: Apache-2.0
// Goals only tighten, for expected-settings.json too. Compares the base branch's copy with the pull request's and fails on any
// loosening that has no matching entry in `changes`: a setting removed or ungated, an expected value changed (except a min raised
// or a max lowered), or a case-data path dropped from the push rule or its size cap raised. A matching entry names the setting, the field and the exact from and to, with a reason and an issue; a
// signoff_comment is optional.
//
//   node quality-speed/pages/settings/guard.ts <base expected-settings.json> <head expected-settings.json>
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Change, Expected } from './settings.ts';

export interface Loosening {
  setting: string;
  field: Change['field'];
  from: unknown;
  to: unknown;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const positive = (n: unknown) => Number.isInteger(n) && (n as number) > 0;

/** Every loosening from base to head, before looking at the change log. */
export function looseningsOf(base: Expected, head: Expected): Loosening[] {
  const out: Loosening[] = [];
  const headById = new Map(head.settings.map((s) => [s.id, s]));
  for (const b of base.settings) {
    const h = headById.get(b.id);
    if (!h) {
      out.push({ setting: b.id, field: 'removed', from: b.expect, to: null });
      continue;
    }
    if (b.gate && !h.gate) out.push({ setting: b.id, field: 'gate', from: true, to: false });
    if (same(b.expect, h.expect)) continue;
    const tighter =
      b.expect.op === h.expect.op &&
      typeof b.expect.value === 'number' &&
      typeof h.expect.value === 'number' &&
      ((b.expect.op === 'min' && h.expect.value > b.expect.value) || (b.expect.op === 'max' && h.expect.value < b.expect.value));
    if (!tighter) out.push({ setting: b.id, field: 'expect', from: b.expect, to: h.expect });
  }
  const headPaths = new Set(head.push_ruleset.restricted_file_paths);
  for (const p of base.push_ruleset.restricted_file_paths) {
    if (!headPaths.has(p)) out.push({ setting: 'restricted_file_paths', field: 'push_ruleset', from: p, to: null });
  }
  if (head.push_ruleset.max_file_size_mb > base.push_ruleset.max_file_size_mb) {
    out.push({ setting: 'max_file_size_mb', field: 'push_ruleset', from: base.push_ruleset.max_file_size_mb, to: head.push_ruleset.max_file_size_mb });
  }
  return out;
}

/** The loosenings that no complete, matching change-log entry covers. */
export function uncovered(base: Expected, head: Expected): Loosening[] {
  const entries = Array.isArray(head.changes) ? head.changes : [];
  return looseningsOf(base, head).filter(
    (l) =>
      !entries.some(
        (c) =>
          c.setting === l.setting &&
          c.field === l.field &&
          same(c.from, l.from) &&
          same(c.to, l.to) &&
          typeof c.reason === 'string' &&
          c.reason.length > 0 &&
          positive(c.issue) &&
          (c.signoff_comment === undefined || positive(c.signoff_comment)),
      ),
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [baseFile, headFile] = process.argv.slice(2);
  if (!baseFile || !headFile) {
    console.error('usage: guard.ts <base file> <head file>');
    process.exit(2);
  }
  const read = (f: string) => JSON.parse(readFileSync(f, 'utf8')) as Expected;
  const problems = uncovered(read(baseFile), read(headFile));
  for (const p of problems) console.error(`expected-settings.json: ${p.field} of ${p.setting} loosens with no change entry`);
  if (problems.length) process.exit(1);
  console.log('expected-settings.json: nothing loosens without a change entry');
}
