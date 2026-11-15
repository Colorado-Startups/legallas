// SPDX-License-Identifier: Apache-2.0
// Page text regrouped from size-based index parts, built with the sync's own writer (scripts/indexparts.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listParts, readPageRange, splitSegments } from './pages-text.ts';
import { fakeIndex, partsFor, words } from './tools/doc-fixtures.ts';

test('splitSegments drops markers and keeps the page of each segment', () => {
  const body = '[[doc:a1 p:1]]\nalpha beta\n\n[[doc:a1 p:1]]\ngamma\n\n[[doc:a1 p:2]]\ndelta\n\n';
  assert.deepEqual(splitSegments(body, 'a1'), [
    { page: 1, text: 'alpha beta' },
    { page: 1, text: 'gamma' },
    { page: 2, text: 'delta' },
  ]);
});

test('listParts follows list cursors, sorts parts numerically and ignores other documents', async () => {
  const objects = new Map<string, string>();
  for (let n = 1; n <= 12; n += 1) objects.set(`text/a1.p${n}.md`, '');
  objects.set('text/a1-other.p1.md', '');
  objects.set('text/a1.p1.md.bak', '');
  const { bucket, calls } = fakeIndex(objects, 5);
  const keys = await listParts(bucket, 'a1');
  assert.deepEqual(keys, Array.from({ length: 12 }, (_, i) => `text/a1.p${i + 1}.md`));
  assert.ok(calls.list >= 3, 'paged through the listing');
});

test('a page that spans two parts comes back whole, in order, without markers', async () => {
  const pages = [1, 2, 3].map((n) => ({ n, text: words(`p${n}`, 400) }));
  const objects = partsFor('a1', pages, 2500);
  assert.ok(objects.size > 3, 'the fixture splits pages across parts');
  const { bucket } = fakeIndex(objects);
  const out = await readPageRange(bucket, 'a1', 1, 3, 1_000_000);
  assert.equal(out.hasText, true);
  assert.equal(out.complete, true);
  assert.equal(out.lastPage, 3);
  for (const page of pages) assert.equal(out.pages.get(page.n), page.text);
  for (const text of out.pages.values()) assert.doesNotMatch(text, /\[\[doc:/);
});

test('one part holding several pages is sliced to the range', async () => {
  const pages = [1, 2, 3, 4].map((n) => ({ n, text: words(`p${n}`, 20) }));
  const objects = partsFor('a1', pages);
  assert.equal(objects.size, 1);
  const out = await readPageRange(fakeIndex(objects).bucket, 'a1', 2, 3, 1_000_000);
  assert.deepEqual([...out.pages.keys()], [2, 3]);
  assert.equal(out.complete, false, 'stopped at page 4');
});

test('reading stops at the first part past the range', async () => {
  const pages = Array.from({ length: 10 }, (_, i) => ({ n: i + 1, text: words(`p${i + 1}`, 300) }));
  const objects = partsFor('a1', pages, 2500);
  const { bucket, calls } = fakeIndex(objects);
  const out = await readPageRange(bucket, 'a1', 1, 2, 1_000_000);
  assert.deepEqual([...out.pages.keys()], [1, 2]);
  assert.ok(calls.get.length < objects.size / 2, `read ${calls.get.length} of ${objects.size} parts`);
});

test('reading stops after a part once more than maxChars are collected', async () => {
  const pages = Array.from({ length: 10 }, (_, i) => ({ n: i + 1, text: words(`p${i + 1}`, 300) }));
  const objects = partsFor('a1', pages, 2500);
  const { bucket, calls } = fakeIndex(objects);
  const out = await readPageRange(bucket, 'a1', 1, 10, 3000);
  assert.equal(out.complete, false);
  assert.ok(calls.get.length < objects.size);
});

test('a document without parts has no text', async () => {
  const out = await readPageRange(fakeIndex(new Map()).bucket, 'a1', 1, 5, 1000);
  assert.equal(out.hasText, false);
  assert.equal(out.pages.size, 0);
});

test('an id that is not a document id lists nothing', async () => {
  const { bucket, calls } = fakeIndex(new Map([['text/a.p1.md', '']]));
  assert.deepEqual(await listParts(bucket, 'a.*'), []);
  assert.equal(calls.list, 0);
});

test('readThrough is `to` past the range, lastPage when all is read, and lastPage - 1 after an early stop', async () => {
  const pages = Array.from({ length: 8 }, (_, i) => ({ n: i + 1, text: words(`p${i + 1}`, 300) }));
  const { bucket } = fakeIndex(partsFor('a1', pages, 2500));
  assert.equal((await readPageRange(bucket, 'a1', 1, 3, 1_000_000)).readThrough, 3);
  const all = await readPageRange(bucket, 'a1', 1, 8, 1_000_000);
  assert.deepEqual([all.complete, all.readThrough], [true, 8]);
  const early = await readPageRange(bucket, 'a1', 1, 8, pages[0].text.length);
  assert.equal(early.complete, false);
  assert.equal(early.readThrough, early.lastPage - 1);
});

test('characters are counted as long as the joined page text', async () => {
  const pages = [{ n: 1, text: words('p1', 400) }, { n: 2, text: words('p2', 400) }];
  const objects = partsFor('a1', pages, 900);
  const exact = await readPageRange(fakeIndex(objects).bucket, 'a1', 1, 2, pages[0].text.length + pages[1].text.length);
  assert.equal(exact.complete, true, 'exactly at the limit is not over it');
});

test("another document's marker inside a part is text, not a page break", async () => {
  const body = '[[doc:a1 p:1]]\none [[doc:zz p:9]] two\n\n[[doc:a1 p:2]]\nthree\n\n';
  assert.deepEqual(splitSegments(body, 'a1'), [
    { page: 1, text: 'one [ [doc:zz p:9]] two' },
    { page: 2, text: 'three' },
  ]);
  const out = await readPageRange(fakeIndex(new Map([['text/a1.p1.md', body]])).bucket, 'a1', 1, 9, 1000);
  assert.deepEqual([...out.pages.keys()], [1, 2]);
  assert.equal(out.lastPage, 2);
});

test('a part that vanished after the listing stops the read as incomplete', async () => {
  const pages = Array.from({ length: 4 }, (_, i) => ({ n: i + 1, text: words(`p${i + 1}`, 300) }));
  const objects = partsFor('a1', pages, 2500);
  const { bucket } = fakeIndex(objects);
  const listed = bucket.list.bind(bucket);
  const second = [...objects.keys()].sort()[1];
  (bucket as { list: typeof listed }).list = async (options) => {
    const out = await listed(options);
    objects.delete(second);
    return out;
  };
  const out = await readPageRange(bucket, 'a1', 1, 4, 1_000_000);
  assert.equal(out.complete, false);
  assert.equal(out.readThrough, out.lastPage - 1);
});
