// SPDX-License-Identifier: Apache-2.0
// sync-windows runs only when a file on its list changes (.github/scripts/changed-paths.sh), so a file its tests reach and
// the list misses lets ci-ok pass with Windows untested. The list has drifted each time a new import landed, so this walks
// what the job's tests reach, and fails naming what's missing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

/** Every file these reach: imports (not `import type`), modules a test loads at run time, and scripts it starts by name. */
function reached(starts: readonly string[]): Set<string> {
  const seen = new Set<string>();
  const walk = (rel: string) => {
    if (seen.has(rel) || !existsSync(path.join(ROOT, rel))) return;
    seen.add(rel);
    const text = read(rel);
    const beside = (name: string) => path.posix.join(path.posix.dirname(rel), name);
    for (const m of text.matchAll(/(?:^|\n)\s*(?:import|export)\s+(?!type\b)(?:[^'";]*?\sfrom\s+)?['"](\.{1,2}\/[^'"]+)['"]/g)) walk(beside(m[1]!)); // safe: group 1 always takes part
    for (const m of text.matchAll(/\bimport\('(\.{1,2}\/[^']+)'\)/g)) walk(beside(m[1]!)); // safe: group 1 always takes part
    for (const m of text.matchAll(/loadModule(?:<[\s\S]*?>)?\('([^']+)'\)/g)) walk(`web/${m[1]!}`); // safe: group 1 always takes part
    for (const m of text.matchAll(/'(?:\.\/)?(scripts\/[\w./-]+\.ts)'/g)) walk(`web/${m[1]!}`); // safe: group 1 always takes part
  };
  starts.forEach(walk);
  return seen;
}

test('the Windows job\'s file list covers everything its tests reach', () => {
  const job = /\n {2}sync-windows:\n[\s\S]*?(?=\n {2}\S)/.exec(read('.github/workflows/ci.yml'))?.[0];
  assert.ok(job, 'ci.yml has a sync-windows job');
  const tests = /node --test ((?:scripts\/\S+\s*)+)/.exec(job)?.[1]?.trim().split(/\s+/).map((name) => `web/${name}`) ?? [];
  assert.ok(tests.length > 0, 'the job runs tests');
  const list = /^sync_files='(.+)'$/m.exec(read('.github/scripts/changed-paths.sh'))?.[1];
  assert.ok(list, 'changed-paths.sh has a sync_files list');
  const listed = new RegExp(`^(?:${list})$`);

  const files = reached(tests);
  assert.ok(files.size > tests.length, 'the walk found what the tests import');
  assert.deepEqual([...files].filter((file) => !listed.test(file)).sort(), []);
  // Read at run time, so no import shows them.
  assert.ok(listed.test('web/migrations/0016_sync_upload_bytes.sql'), 'the test room builds its tables from the migrations');
  if (job.includes('npm ci')) assert.ok(listed.test('web/package-lock.json'), 'the job installs packages');
});
