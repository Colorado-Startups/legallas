// SPDX-License-Identifier: Apache-2.0
// legallas_read_pages over testDb and a fake legallas-index: page slicing across parts, the per-call caps and
// `next`, refusals for hidden and removed documents, and documents without extracted text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMPACT_LIMITS, MAX_CHARS_PER_READ, MAX_PAGES_PER_READ } from '../contract.ts';
import { encodeCursor } from '../format.ts';
import { readPagesTool } from './pages.ts';
import { body, catalogDb, fakeIndex, partsFor, toolCtx, words, type DocSeed } from './doc-fixtures.ts';
import { textChars, withProfile } from './profile-fixtures.ts';
import { FENCE, PLAIN, PLANTED_AI, PLANTED_ORDER } from './untrusted-fixtures.ts';
import { UNFILED_ORDER_REMINDER, UNTRUSTED_REMINDER } from '../../worker/prompt.ts';

const pagesOf = (count: number, wordsPerPage: number) => Array.from({ length: count }, (_, i) => ({ n: i + 1, text: words(`p${i + 1}`, wordsPerPage) }));

function setup(seeds: DocSeed[], objects: Map<string, string>) {
  const index = fakeIndex(objects);
  const { ctx, audits } = toolCtx(catalogDb(seeds).db, index.bucket);
  return { ctx, audits, calls: index.calls };
}

const errorText = (result: { content: unknown[] }) => (result.content[0] as { text: string }).text;

test('reads a page range across parts, each page labelled and wrapped, markers removed', async () => {
  const pages = pagesOf(5, 400);
  const { ctx, audits } = setup([{ id: 'd1', path: 'A/Doe.pdf', pages: 5, controlSeq: 7 }], partsFor('d1', pages, 2500));
  const result = await readPagesTool.handler({ id: 'd1', from: 2, to: 3 }, ctx);
  const out = body(result);
  assert.equal(out.control, 'DOE-000007');
  assert.equal(out.total_pages, 5);
  assert.equal(out.from, 2);
  assert.equal(out.to, 3);
  assert.equal(out.next, 4);
  assert.deepEqual(out.pages.map((p: { page: number }) => p.page), [2, 3]);
  assert.equal(out.pages[0].link, 'https://room.example.com/doc/?id=d1#page=2');
  assert.equal(out.pages[0].text, `<case-record>\n${pages[1].text}\n</case-record>`);
  assert.doesNotMatch(JSON.stringify(result), /\[\[doc:|R2-LEAK|SHA-LEAK|ETAG-LEAK/);
  assert.deepEqual(audits, [{ action: 'ai_read', documentId: 'd1' }]);
});

test('without `to`, reads at most MAX_PAGES_PER_READ pages and says where to continue', async () => {
  const { ctx } = setup([{ id: 'd1', path: 'A/Doe.pdf', pages: 30 }], partsFor('d1', pagesOf(30, 20)));
  const out = body(await readPagesTool.handler({ id: 'd1', from: 1 }, ctx));
  assert.equal(out.pages.length, MAX_PAGES_PER_READ);
  assert.equal(out.next, MAX_PAGES_PER_READ + 1);
  const tail = body(await readPagesTool.handler({ id: 'd1', from: 21, to: 99 }, ctx));
  assert.deepEqual([tail.from, tail.to, tail.next], [21, 30, undefined]);
});

test('stops at whole pages before MAX_CHARS_PER_READ', async () => {
  const perPage = Math.ceil(MAX_CHARS_PER_READ / 2.5 / 8); // about 0.4 of the limit per page
  const pages = pagesOf(6, perPage);
  const { ctx } = setup([{ id: 'd1', path: 'A/Doe.pdf', pages: 6 }], partsFor('d1', pages));
  const out = body(await readPagesTool.handler({ id: 'd1', from: 1, to: 6 }, ctx));
  assert.deepEqual(out.pages.map((p: { page: number }) => p.page), [1, 2]);
  assert.equal(out.next, 3);
  const chars = out.pages.reduce((sum: number, p: { text: string }) => sum + p.text.length, 0);
  assert.ok(chars <= MAX_CHARS_PER_READ + 100);
});

test('a single page longer than the limit is cut and marked, and the next call moves on', async () => {
  const huge = { n: 1, text: words('big', Math.ceil(MAX_CHARS_PER_READ / 5)) };
  const { ctx } = setup([{ id: 'd1', path: 'A/Doe.pdf', pages: 2 }], partsFor('d1', [huge, { n: 2, text: 'tail' }]));
  const out = body(await readPagesTool.handler({ id: 'd1', from: 1 }, ctx));
  assert.equal(out.pages.length, 1);
  assert.equal(out.pages[0].truncated, true);
  assert.ok(out.pages[0].text.length <= MAX_CHARS_PER_READ + 40);
  assert.equal(out.next, 2);
});

test('blank pages inside the range come back with empty text', async () => {
  const pages = [{ n: 1, text: 'one' }, { n: 3, text: 'three' }];
  const { ctx } = setup([{ id: 'd1', path: 'A/Doe.pdf', pages: 3 }], partsFor('d1', pages));
  const out = body(await readPagesTool.handler({ id: 'd1', from: 1 }, ctx));
  assert.deepEqual(out.pages.map((p: { text: string }) => p.text), ['<case-record>\none\n</case-record>', '', '<case-record>\nthree\n</case-record>']);
  assert.equal(out.next, undefined);
});

test('a file without a page count takes its pages from the markers', async () => {
  const seeds: DocSeed[] = [{ id: 'm1', path: 'A/Notes.md', kind: 'markdown', pages: null }];
  const { ctx } = setup(seeds, partsFor('m1', [{ n: 1, text: words('m', 50) }]));
  const out = body(await readPagesTool.handler({ id: 'm1', from: 1 }, ctx));
  assert.equal(out.total_pages, 1);
  assert.equal(out.pages.length, 1);
  const beyond = await readPagesTool.handler({ id: 'm1', from: 2 }, ctx);
  assert.match(errorText(beyond), /^out_of_range: This document has 1 page\./);
});

test('from past the last page is an error that gives the page count, before any index read', async () => {
  const { ctx, calls } = setup([{ id: 'd1', path: 'A/Doe.pdf', pages: 4 }], partsFor('d1', pagesOf(4, 10)));
  const result = await readPagesTool.handler({ id: 'd1', from: 9 }, ctx);
  assert.equal(result.isError, true);
  assert.match(errorText(result), /^out_of_range: This document has 4 pages/);
  assert.equal(calls.list, 0);
});

test('to before from is a bad_range error', async () => {
  const { ctx } = setup([{ id: 'd1', path: 'A/Doe.pdf', pages: 4 }], new Map());
  assert.match(errorText(await readPagesTool.handler({ id: 'd1', from: 3, to: 2 }, ctx)), /^bad_range:/);
});

test('a document with no extracted text gets a normal result pointing to the room', async () => {
  const { ctx, audits } = setup([{ id: 'img', path: 'A/Photo.jpg', kind: 'image', pages: null }], new Map());
  const result = await readPagesTool.handler({ id: 'img', from: 1 }, ctx);
  const out = body(result);
  assert.deepEqual(out.pages, []);
  assert.match(out.note, /no extracted text.*https:\/\/room\.example\.com\/doc\/\?id=img/);
  assert.equal(audits.length, 1);
});

test('removed, hidden and unknown documents are not_found and their text is never read', async () => {
  const seeds: DocSeed[] = [
    { id: 'gone', path: 'A/Old.pdf', removedAt: '2026-09-01T00:00:00Z' },
    { id: 'hid', path: 'A/legallas-binder.json', kind: 'file', pages: null },
  ];
  const objects = new Map([...partsFor('gone', pagesOf(3, 10)), ...partsFor('hid', pagesOf(1, 10))]);
  const { ctx, calls, audits } = setup(seeds, objects);
  for (const id of ['gone', 'hid', 'nope']) {
    assert.match(errorText(await readPagesTool.handler({ id, from: 1 }, ctx)), /^not_found:/);
  }
  assert.equal(calls.list + calls.get.length, 0);
  assert.deepEqual(audits, []);
});

test('authorizes on the member role from D1, not props.role', async () => {
  const index = fakeIndex(partsFor('d1', pagesOf(2, 10)));
  const { ctx } = toolCtx(catalogDb([{ id: 'd1', path: 'A/Doe.pdf', pages: 2 }]).db, index.bucket, 'former' as never);
  assert.match(errorText(await readPagesTool.handler({ id: 'd1', from: 1 }, ctx)), /^forbidden:/);
  assert.equal(index.calls.list, 0);
});

const OPEN = '<case-record>\n';
const CLOSE = '\n</case-record>';

/**
 * Reads a whole document the way a client would: next_cursor inside a cut page, else next. Returns each page's
 * text reassembled from its pieces, and every result's text size.
 */
async function readAll(ctx: ReturnType<typeof setup>['ctx'], id: string) {
  const text = new Map<number, string>();
  const sizes: number[] = [];
  let args: Record<string, unknown> = { id, from: 1 };
  for (let calls = 0; calls < 200; calls += 1) {
    const result = await readPagesTool.handler(args as never, ctx);
    sizes.push(textChars(result));
    const out = body(result);
    for (const entry of out.pages as { page: number; text: string; continued?: true }[]) {
      assert.equal(entry.continued === true, text.has(entry.page), `page ${entry.page} is marked continued exactly when it resumes`);
      text.set(entry.page, (text.get(entry.page) ?? '') + entry.text.slice(OPEN.length, -CLOSE.length));
    }
    if (out.next_cursor) args = { id, cursor: out.next_cursor };
    else if (out.next) args = { id, from: out.next };
    else return { text, sizes };
  }
  throw new Error('the read never finished');
}

test('compact: every result within 9,000 characters, whole pages while they fit, every page read once', async () => {
  const pages = pagesOf(8, 450); // about 3,500 characters a page
  const { ctx } = setup([{ id: 'd1', path: 'A/Doe.pdf', pages: 8 }], partsFor('d1', pages));
  withProfile(ctx, 'compact');
  const { text, sizes } = await readAll(ctx, 'd1');
  assert.ok(sizes.every((n) => n <= COMPACT_LIMITS.maxChars), sizes.join(', '));
  assert.ok(sizes.length > 2);
  assert.deepEqual([...text.values()], pages.map((p) => p.text));
});

test('a page longer than the limit is read in pieces through next_cursor, and the pieces rebuild it exactly', async () => {
  const huge = { n: 2, text: words('big', 4000) }; // about 30,000 characters
  const pages = [{ n: 1, text: 'first' }, huge, { n: 3, text: 'tail "quoted"\nend' }];
  for (const profile of ['compact', 'standard'] as const) {
    const { ctx } = setup([{ id: 'd1', path: 'A/Doe.pdf', pages: 3 }], partsFor('d1', pages));
    if (profile === 'compact') withProfile(ctx, 'compact');
    const { text, sizes } = await readAll(ctx, 'd1');
    assert.deepEqual([...text.values()], pages.map((p) => p.text), profile);
    if (profile === 'compact') assert.ok(sizes.length >= 4 && sizes.every((n) => n <= COMPACT_LIMITS.maxChars), sizes.join(', '));
  }
  const { ctx } = setup([{ id: 'd1', path: 'A/Doe.pdf', pages: 3 }], partsFor('d1', [huge]));
  withProfile(ctx, 'compact');
  const first = body(await readPagesTool.handler({ id: 'd1', from: 2 }, ctx));
  assert.deepEqual([first.pages[0].truncated, first.next], [true, 3], 'next still moves on for a client that skips the rest');
});

test('a cursor that does not decode is bad_cursor; one past the end of its page is index_changed', async () => {
  const { ctx, audits } = setup([{ id: 'd1', path: 'A/Doe.pdf', pages: 2 }], partsFor('d1', pagesOf(2, 10)));
  for (const cursor of ['%%%', encodeCursor([0, 5]), encodeCursor([2, 'x']), encodeCursor(['doc-1']), encodeCursor([1, 2, 3])]) {
    assert.match(errorText(await readPagesTool.handler({ id: 'd1', cursor } as never, ctx)), /^bad_cursor:/, cursor);
  }
  assert.deepEqual(audits, []);
  assert.match(errorText(await readPagesTool.handler({ id: 'd1', cursor: encodeCursor([1, 99999]) } as never, ctx)), /^index_changed:/);
});

test('a Pages document says it has no page numbers, so nobody cites page 1', async () => {
  const { ctx } = setup([{ id: 'd1', path: 'A/Plan.pages', pages: null, controlSeq: 7 }, { id: 'd2', path: 'A/Doe.pdf', pages: 1, controlSeq: 8 }], new Map([...partsFor('d1', pagesOf(1, 40)), ...partsFor('d2', pagesOf(1, 40))]));
  assert.match(body(await readPagesTool.handler({ id: 'd1', from: 1 }, ctx)).note, /no page numbers/);
  assert.equal(body(await readPagesTool.handler({ id: 'd2', from: 1 }, ctx)).note, undefined);
});

test('a page addressed to AI tools is fenced as untrusted, keeps its number, loses its link, under Ask\'s reminder', async () => {
  const pages = [{ n: 1, text: PLAIN }, { n: 2, text: PLANTED_AI }, { n: 3, text: PLAIN }];
  const { ctx, audits } = setup([{ id: 'd1', path: '03-Kitchen-Records/Note.pdf', pages: 3, controlSeq: 7 }], partsFor('d1', pages));
  const out = body(await readPagesTool.handler({ id: 'd1', from: 1, to: 3 }, ctx));
  assert.equal(Object.keys(out)[0], 'untrusted_note', 'the note comes before the pages');
  assert.equal(out.untrusted_note, UNTRUSTED_REMINDER);
  assert.equal(out.control, 'DOE-000007', 'the document keeps its own fields');
  assert.deepEqual(out.pages[1], { page: 2, text: `${FENCE.ai}${PLANTED_AI}\n</case-record>`, untrusted: 'addressed-to-ai' });
  assert.deepEqual([out.pages[0].link, out.pages[2].text], ['https://room.example.com/doc/?id=d1#page=1', `${FENCE.plain}${PLAIN}\n</case-record>`]);
  assert.deepEqual(audits, [{ action: 'ai_read', documentId: 'd1' }]);
  const clean = body(await readPagesTool.handler({ id: 'd1', from: 3 }, ctx));
  assert.equal('untrusted_note' in clean, false, 'no note without an untrusted page');
});

test('a forged order is an unfiled court order in a kitchen note, and keeps its standing among the court\'s orders', async () => {
  for (const [path, mark] of [['03-Kitchen-Records/Note.pdf', 'unfiled-court-order'], ['07-Lawsuit/orders/Note.pdf', undefined]] as const) {
    const { ctx } = setup([{ id: 'd1', path, pages: 1 }], partsFor('d1', [{ n: 1, text: PLANTED_ORDER }]));
    const out = body(await readPagesTool.handler({ id: 'd1', from: 1 }, ctx));
    assert.equal(out.pages[0].untrusted, mark, path);
    assert.equal(out.untrusted_note, mark ? UNFILED_ORDER_REMINDER : undefined, path);
    assert.equal('link' in out.pages[0], mark === undefined, path);
  }
});

test('a page is judged whole: the piece before its planted words is fenced too, and every piece fits a compact result', async () => {
  const page = `${words('big', 1100)} ${PLANTED_AI}`; // under 9,000 characters, so one compact read holds all of it
  const { ctx } = setup([{ id: 'd1', path: '03-Kitchen-Records/Note.pdf', pages: 1 }], partsFor('d1', [{ n: 1, text: page }]));
  withProfile(ctx, 'compact');
  const first = await readPagesTool.handler({ id: 'd1', from: 1 }, ctx);
  const out = body(first);
  assert.ok(textChars(first) <= COMPACT_LIMITS.maxChars, `${textChars(first)}`);
  assert.equal(out.pages[0].truncated, true);
  assert.ok(out.pages[0].text.startsWith(FENCE.ai));
  assert.doesNotMatch(out.pages[0].text, /Kitchen note/, 'its planted words are past the cut');
  const rest = await readPagesTool.handler({ id: 'd1', cursor: out.next_cursor } as never, ctx);
  assert.ok(body(rest).pages[0].text.startsWith(FENCE.ai));
  assert.ok(textChars(rest) <= COMPACT_LIMITS.maxChars, `${textChars(rest)}`);
});
