// SPDX-License-Identifier: Apache-2.0
// The full notice (A3), its tick and A7's first-use block are word for word docs/legal/product-notices.md, every line
// both ways, and its version follows its words. Node built-ins only, so it runs anywhere in seconds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIRST_USE_PRIVILEGE, FULL_NOTICE, NOTICE_TICK, NOTICE_VERSION, noticeVersion } from './full-notice.ts';

const NOTICES = readFileSync(join(import.meta.dirname, '..', '..', 'docs', 'legal', 'product-notices.md'), 'utf8').split('\n');

/** The `> ` lines from the first line starting `from` up to the next line starting `until`, without the `> `. */
function quoted(from: string, until: string): string[] {
  const start = NOTICES.findIndex((line) => line.startsWith(from));
  assert.ok(start >= 0, from);
  const end = NOTICES.findIndex((line, i) => i > start && line.startsWith(until));
  assert.ok(end > start, until);
  return NOTICES.slice(start, end).filter((line) => line.startsWith('> ')).map((line) => line.slice(2));
}

test('the notice and its tick are word for word the notices file, every line of it (A3)', () => {
  assert.deepEqual([...FULL_NOTICE], quoted('## A3. Full notice', '**Tick required:**'));
  assert.deepEqual([`☐ ${NOTICE_TICK}`], quoted('**Tick required:**', '## A4.'));
});

test('the privilege block the notice links to is word for word A7\'s first-use block', () => {
  assert.deepEqual([...FIRST_USE_PRIVILEGE], quoted('**On first use, and at the top of any case room:**', '**Before connecting'));
  assert.ok(NOTICES.includes('## A7. Privilege and confidentiality'), 'the anchor A3 links to');
});

test('the version comes from the words: any change to the notice or the tick is a new version', () => {
  assert.match(NOTICE_VERSION, /^A3-[0-9a-f]{8}$/);
  assert.equal(noticeVersion(FULL_NOTICE, NOTICE_TICK), NOTICE_VERSION);
  assert.notEqual(noticeVersion([...FULL_NOTICE.slice(0, -1), `${FULL_NOTICE.at(-1)} `], NOTICE_TICK), NOTICE_VERSION);
  assert.notEqual(noticeVersion(FULL_NOTICE, NOTICE_TICK.replace('agree', 'consent')), NOTICE_VERSION);
});
