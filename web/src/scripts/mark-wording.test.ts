// SPDX-License-Identifier: Apache-2.0
// The privilege mark's wording (docs/legal/product-notices.md, A1 and A7; research W1, W2): every room surface that
// shows a mark renders mark-words.ts's label, and no rendered string reads privileged as a status. Only a served
// privilege log may state a claim, and none is in these files. The Data room page
// (quality-speed/pages/data-room/list.ts) reads this test by name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { INDEX_HEADER } from '../../worker/export.ts';
import { MARK_LABEL, UNMARKED_LABEL } from './mark-words.ts';

const WEB = join(import.meta.dirname, '..', '..');
/** Every surface that shows a document's mark. */
const SURFACES = ['doc-page.ts', 'documents-table-view.ts', 'exhibit-pane-view.ts', 'overview-news-feed.ts', 'people-profile.ts'];
/** A rendered string that is, or starts with, the status word: a quoted literal or an element's text. */
const STATUS = /(['"`>])\s*Privileged\b[^'"`<\n]{0,40}(['"`<])/;

function* files(dir: string): Generator<string> {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* files(full);
    else if (/\.(ts|astro)$/.test(name) && !name.endsWith('.test.ts')) yield full;
  }
}

test('as rendered, the label reads "Marked privileged by you", no status reads privileged, and no room surface states a claim', () => {
  const notices = readFileSync(join(WEB, '..', 'docs', 'legal', 'product-notices.md'), 'utf8');
  assert.ok(notices.includes(`**${MARK_LABEL}.**`), 'the A7 folder mark, word for word');
  assert.ok(notices.includes(`| ${MARK_LABEL}; access rule |`), 'A1 "Say"');
  assert.equal(UNMARKED_LABEL, 'Not marked');

  for (const name of SURFACES) assert.match(readFileSync(join(WEB, 'src', 'scripts', name), 'utf8'), /\bMARK_LABEL\b/, name);
  assert.ok((INDEX_HEADER as readonly string[]).includes(MARK_LABEL), 'the exported index too');

  const found: string[] = [];
  for (const file of [...files(join(WEB, 'src')), ...files(join(WEB, 'worker')), ...files(join(WEB, 'mcp', 'pages'))]) {
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (!/^\s*(\/\/|\*|\/\*)/.test(line) && STATUS.test(line)) found.push(`${relative(WEB, file)}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(found, []);
});
