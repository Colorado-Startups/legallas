// SPDX-License-Identifier: Apache-2.0
// The cite book: short ids for the prompt, mapped back exactly; pages only where text reached the prompt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CitableDoc } from './passages.ts';
import { aliasTags, citeBook, mentionTail, passagePages, restoreCites, restoreMentions } from './cite-book.ts';
import { buildPageParts } from '../scripts/indexparts-v2.ts';

const DOC_A = 'doc-alpha-0001';
const DOC_B = 'doc-bravo-0002';
const DOC_C = 'doc-charlie-0003';
const docs = new Map<string, CitableDoc>([
  [DOC_A, { id: DOC_A, name: 'Kitchen-Log__20120405__Copperline.pdf', pages: 9, folder: '03-Daily-Records' }],
  [DOC_B, { id: DOC_B, name: 'Motion-for-Site-Entry__20130626__Acme.pdf', pages: 20, folder: '07-Lawsuit' }],
  [DOC_C, { id: DOC_C, name: 'notes.md', pages: null, folder: '09-Cooler-Analysis' }],
]);
const chunks = [
  { docId: DOC_A, text: `[[doc:${DOC_A} p:3]]\nThe cooler failed.\n[[doc:${DOC_A} p:4]]\nIt stopped.` },
  { docId: DOC_B, text: `tail of page six\n[[doc:${DOC_B} p:7]]\nThe motion argues.` },
  { docId: DOC_C, text: 'A note with no marker at all.' },
];
const brief = { text: `Proof: strong [doc:${DOC_B} p:12] and [doc:${DOC_A} p:1].`, citable: new Map([[DOC_A, docs.get(DOC_A)!], [DOC_B, docs.get(DOC_B)!]]) };

test('aliases follow the prompt: case picture first, then passages, one per document', () => {
  const book = citeBook(chunks, docs, brief);
  assert.deepEqual([...book.entries.values()].map((e) => [e.doc.id, e.alias]), [[DOC_B, 'D1'], [DOC_A, 'D2'], [DOC_C, 'D3']]);
  assert.deepEqual([...book.ids], [['D1', DOC_B], ['D2', DOC_A], ['D3', DOC_C]]);
  assert.deepEqual([...book.citable.keys()], [DOC_B, DOC_A, DOC_C]);
  assert.deepEqual([...book.entries.values()].map((e) => e.kind), ['filing', 'record', 'summary']);
});

test('a page is citable only where its text reached the prompt, or as a proof tag names it', () => {
  const book = citeBook(chunks, docs, brief);
  assert.equal(book.allows(DOC_A, 3), true);
  assert.equal(book.allows(DOC_A, 4), true);
  assert.equal(book.allows(DOC_A, 1), true, 'a proof tag page');
  assert.equal(book.fromPassage(DOC_A, 1), false, 'but not a passage page');
  assert.equal(book.allows(DOC_A, 5), false);
  assert.equal(book.allows(DOC_B, 6), true, 'text before the first marker is the page before');
  assert.equal(book.allows(DOC_B, 8), false);
  assert.equal(book.allows(DOC_C, 1), true, 'a text document is one page');
  assert.equal(book.allows(DOC_C, 2), false);
  assert.equal(book.allows('doc-unknown', 1), false);
});

test('passage pages ignore markers naming another document and stay inside the page count', () => {
  assert.deepEqual(passagePages({ docId: 'a', text: '[[doc:a p:2]] x [[doc:b p:9]] y' }, 5), [2]);
  assert.deepEqual(passagePages({ docId: 'a', text: 'lead [[doc:a p:1]] x' }, 5), [1]);
  assert.deepEqual(passagePages({ docId: 'a', text: '[[doc:a p:7]] x' }, 5), []);
  assert.deepEqual(passagePages({ docId: 'a', text: 'no markers' }, 5), []);
});

test('an index v2 part reaches only its own page: the header line before the marker is not page text', () => {
  const header = 'DOE-000412 | Motion to compel, Roe | 2013-01-15 | motion to compel | pleading | 08-Court-Papers';
  assert.deepEqual(passagePages({ docId: 'a', text: `${header}\n[[doc:a p:3]]\nThe motion argues.\n` }, 5), [3]);
  assert.deepEqual(passagePages({ docId: 'a', text: `${header}\n[[doc:a p:1]]\nA note.\n` }, null), [1]);
  // v1 text that happens to open with a short line keeps the page before: it is page text, not a six-field header.
  assert.deepEqual(passagePages({ docId: 'a', text: 'tail of page two\n[[doc:a p:3]]\nx' }, 5), [3, 2]);
  assert.deepEqual(passagePages({ docId: 'a', text: 'a | b | c\n[[doc:a p:3]]\nx' }, 5), [3, 2]);
});

test('parts the v2 builder writes make no page reachable but their own', () => {
  const facts = { id: DOC_B, control: 'DOE-000412', name: 'Motion-for-Site-Entry__20130626__Acme.pdf', folder: '07-Lawsuit', kind: 'pdf' };
  const parts = buildPageParts(facts, [{ n: 6, text: 'Page six text.' }, { n: 7, text: 'Page seven text.' }]);
  const book = citeBook(parts.map((part) => ({ docId: DOC_B, text: part.body })), docs);
  assert.equal(book.allows(DOC_B, 6), true);
  assert.equal(book.allows(DOC_B, 7), true);
  assert.equal(book.allows(DOC_B, 5), false, 'the header of the page-six part is not page five');
  const second = citeBook([{ docId: DOC_B, text: parts[1]!.body }], docs);
  assert.equal(second.allows(DOC_B, 6), false, 'the header of the page-seven part is not page six');
});

test('prompt tags show aliases; a tag for a document outside the book is removed', () => {
  const book = citeBook(chunks, docs, brief);
  assert.equal(aliasTags(`See [doc:${DOC_A} p:3] and [doc:doc-zzz p:1].`, book), 'See [doc:D2 p:3] and .');
});

test('the model alias cites map back to real ids in the canonical form, however they are written', () => {
  const book = citeBook(chunks, docs, brief);
  const cases: [string, string][] = [
    ['x [doc:D2 p:3].', `x [doc:${DOC_A} p:3].`],
    ['x 【doc:D2 p:3】', `x [doc:${DOC_A} p:3]`],
    ['x [D2 p.3]', `x [doc:${DOC_A} p:3]`],
    ['x [doc: D1, page 7]', `x [doc:${DOC_B} p:7]`],
    ['x [doc:d2 p:4]', `x [doc:${DOC_A} p:4]`],
    ['x [doc:D2 pp. 3-4]', `x [doc:${DOC_A} p:3]`],
    ['x [doc:D2 p:3; doc:D1 p:7]', `x [doc:${DOC_A} p:3] [doc:${DOC_B} p:7]`],
    ['x [doc:D2 p:3, 4]', `x [doc:${DOC_A} p:3] [doc:${DOC_A} p:4]`],
    ['x [doc:D2 pp. 3 and 4, D1 p:7]', `x [doc:${DOC_A} p:3] [doc:${DOC_A} p:4] [doc:${DOC_B} p:7]`],
  ];
  for (const [written, shown] of cases) assert.equal(restoreCites(written, book), shown, written);
});

test('unknown aliases stay as written and are counted; other brackets are untouched', () => {
  const book = citeBook(chunks, docs, brief);
  const count = { unresolved: 0 };
  assert.equal(restoreCites('a [doc:D9 p:1] b', book, count), 'a [doc:D9 p:1] b');
  assert.equal(count.unresolved, 1);
  for (const text of ['[law:crs-7-80-714]', `[doc:${DOC_A} p:3]`, '[note]', '[D2]', '[doc:D2 p:3 and more]']) {
    assert.equal(restoreCites(text, book, count), text);
  }
  assert.equal(count.unresolved, 1);
});

test('a cite id outside a cite is rendered, and what may yet become one is held at the end of streamed text', () => {
  const book = citeBook(chunks, docs, brief);
  assert.equal(restoreMentions('see doc:D2 p:3 and (doc:D1) and doc:D3', book), `see [doc:${DOC_A} p:3] and and notes.md`);
  assert.equal(restoreMentions('gone (doc:D9) [doc:D9] doc:d9 p:1.', book), 'gone.');
  assert.equal(restoreMentions('kept [doc:D9 p:1] and a.com/doc:D2 p:3', book), 'kept [doc:D9 p:1] and a.com/doc:D2 p:3');
  assert.equal(restoreMentions('x/doc:D2 p:3', book, 2), 'x/doc:D2 p:3', 'text already sent is context only');
  assert.equal(restoreMentions('ab doc:D2 p:3', book, 2), `ab [doc:${DOC_A} p:3]`);
  for (const [text, held] of [['see ', ' '], ['see (', ' ('], ['see d', ' d'], ['see doc:D1 p:3', ' doc:D1 p:3'], ['see doc:D1 is', ''], ['a.com/do', ''], ['done.', '']] as const) {
    assert.equal(text.slice(mentionTail(text)), held, text);
  }
});
