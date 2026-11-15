// SPDX-License-Identifier: Apache-2.0
// legallas_read_pages never passes off an unread page as a blank one: a page past where the index read stopped
// is left for `next`, whatever the character limit. Drives readPages directly so the limit can vary.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readPages } from './pages.ts';
import { findLiveDocument } from './documents.ts';
import { body, catalogDb, fakeIndex, partsFor, words } from './doc-fixtures.ts';

const PAGES = Array.from({ length: 8 }, (_, i) => ({ n: i + 1, text: words(`p${i + 1}`, 300) }));

const unwrap = (text: string) => text.replace(/^<case-record>\n/, '').replace(/\n<\/case-record>$/, '');

async function setup() {
  const { db } = catalogDb([{ id: 'a1', path: 'A/Doe.pdf', pages: PAGES.length }]);
  const row = await findLiveDocument(db, 'a1', 'counsel');
  assert.ok(row);
  return { row, index: fakeIndex(partsFor('a1', PAGES, 2500)).bucket };
}

/** Follows `next` from page 1 to the end, returning every entry seen. */
async function readAll(maxChars: number) {
  const { row, index } = await setup();
  const seen: { page: number; text: string; truncated?: boolean }[] = [];
  let from: number | undefined = 1;
  for (let calls = 0; from !== undefined; calls += 1) {
    assert.ok(calls < 50, 'makes progress');
    const out = body(await readPages(index, row, 'DOE', from, undefined, maxChars));
    seen.push(...out.pages);
    from = out.next;
  }
  return seen;
}

test('the reported case: a limit equal to page 1 returns page 1 and continues at page 2', async () => {
  const { row, index } = await setup();
  const out = body(await readPages(index, row, 'DOE', 1, undefined, PAGES[0].text.length));
  assert.deepEqual(out.pages.map((p: { page: number }) => p.page), [1]);
  assert.equal(unwrap(out.pages[0].text), PAGES[0].text);
  assert.equal(out.next, 2);
});

test('across many limits every page comes back once, in order, never blank', async () => {
  for (let maxChars = 300; maxChars <= 9000; maxChars += 173) {
    const seen = await readAll(maxChars);
    assert.deepEqual(seen.map((p) => p.page), PAGES.map((p) => p.n), `pages in order at ${maxChars}`);
    for (const [i, entry] of seen.entries()) {
      const text = unwrap(entry.text);
      assert.ok(text.length > 0, `page ${entry.page} not blank at ${maxChars}`);
      if (entry.truncated) assert.ok(PAGES[i].text.startsWith(text), `page ${entry.page} cut cleanly at ${maxChars}`);
      else assert.equal(text, PAGES[i].text, `page ${entry.page} whole at ${maxChars}`);
    }
  }
});
