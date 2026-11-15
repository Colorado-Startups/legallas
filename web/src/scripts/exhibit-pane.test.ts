// SPDX-License-Identifier: Apache-2.0
// The exhibit pane's pure pieces (card F7): quote normalization and matching, the PDF find query, the
// deep-link hash (#page=N&q=<passage>), cite hrefs read back into targets, and the pane's meta line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { docHref, docTarget, pageFromHash, quoteFromHash } from './files-api.ts';
import { locateQuote, normalizeQuote, pageLabel, partyLine, pdfFindQuery, QUOTE_MAX } from './files-format.ts';

test('normalizeQuote collapses whitespace, drops soft hyphens and trims', () => {
  assert.equal(normalizeQuote('  Roe\n confirmed\tthe order. '), 'Roe confirmed the order.');
  assert.equal(normalizeQuote('con­sulting services'), 'consulting services');
  for (const none of [null, undefined, '', '   \n ']) assert.equal(normalizeQuote(none), '', String(none));
});

test('normalizeQuote cuts long passages at a word boundary, never past the cap', () => {
  const words = Array.from({ length: 80 }, (_, i) => `word${i}`).join(' ');
  const cut = normalizeQuote(words);
  assert.ok(cut.length <= QUOTE_MAX, `${cut.length} characters`);
  assert.ok(words.startsWith(cut));
  assert.match(cut, /word\d+$/, 'ends on a whole word');
  const unbroken = 'x'.repeat(QUOTE_MAX + 50);
  assert.equal(normalizeQuote(unbroken).length, QUOTE_MAX, 'a passage with no spaces is cut at the cap');
});

test('pdfFindQuery joins words broken across lines, as PDF.js does with the page text', () => {
  assert.equal(pdfFindQuery('the deliv- ery was accepted'), 'the delivery was accepted');
  assert.equal(pdfFindQuery('deliv-\nery'), 'delivery');
  assert.equal(pdfFindQuery('a non‑breaking hyphen'), 'a non-breaking hyphen');
  assert.equal(pdfFindQuery('Harbor Labs- LLC'), 'Harbor Labs- LLC', 'a capital after the break is not a broken word');
  assert.equal(pdfFindQuery('well-known terms'), 'well-known terms', 'an ordinary hyphen stays');
});

test('locateQuote finds the first match and returns offsets into the original text', () => {
  const text = 'Intro.  The cafe’s   delivery slip lists ROE as recipient. The cafe’s delivery slip again.';
  const hit = locateQuote(text, "the cafe's delivery slip lists Roe");
  assert.ok(hit);
  assert.equal(text.slice(hit.start, hit.end), 'The cafe’s   delivery slip lists ROE');
  const second = locateQuote(text, 'delivery slip again');
  assert.ok(second);
  assert.equal(text.slice(second.start, second.end), 'delivery slip again');
});

test('locateQuote tolerates line breaks, soft hyphens and curly double quotes', () => {
  const text = 'He wrote “received” on the\ndeliv\u00adery slip.';
  const hit = locateQuote(text, 'wrote "received" on the delivery slip');
  assert.ok(hit);
  assert.equal(text.slice(hit.start, hit.end), 'wrote “received” on the\ndeliv\u00adery slip');
});

test('locateQuote returns null for an absent or empty passage', () => {
  assert.equal(locateQuote('Nothing here.', 'not present'), null);
  assert.equal(locateQuote('Nothing here.', '   '), null);
  assert.equal(locateQuote('', 'anything'), null);
});

test('locateQuote keeps offsets right after characters outside the basic plane', () => {
  const text = '\u{1F4C4} Exhibit A: the supply agreement';
  const hit = locateQuote(text, 'exhibit a');
  assert.ok(hit);
  assert.equal(text.slice(hit.start, hit.end), 'Exhibit A');
});

test('the deep-link hash carries a page and an optional passage', () => {
  assert.equal(pageFromHash('#page=3&q=the%20order'), 3);
  assert.equal(quoteFromHash('#page=3&q=the%20order'), 'the order');
  assert.equal(quoteFromHash('#q=%20%20spaced%0Aout%20'), 'spaced out');
  assert.equal(quoteFromHash('#page=3'), null);
  assert.equal(quoteFromHash('#page=3&q='), null);
  assert.equal(quoteFromHash('#page=3&q=%E0%A4%A'), null, 'malformed escapes are ignored, not thrown');
  assert.equal(pageFromHash('#q=page%3D9'), null, 'a page inside the passage is not the page');
});

test('docHref adds the passage only with a page, and docTarget reads it back', () => {
  assert.equal(docHref('d1'), '/doc/?id=d1');
  assert.equal(docHref('d1', 4), '/doc/?id=d1#page=4');
  assert.equal(docHref('d1', null, 'ignored without a page'), '/doc/?id=d1');
  const href = docHref('a b', 4, ' Roe  confirmed & signed ');
  assert.equal(href, '/doc/?id=a%20b#page=4&q=Roe%20confirmed%20%26%20signed');
  assert.deepEqual(docTarget(href), { id: 'a b', page: 4, quote: 'Roe confirmed & signed' });
  assert.deepEqual(docTarget('/doc/?id=d1'), { id: 'd1', page: null, quote: null });
  assert.deepEqual(docTarget('https://legallas.example/doc/?id=d2#page=7'), { id: 'd2', page: 7, quote: null });
  for (const other of ['/documents/?id=d1', '/doc/', '/doc/?x=1', 'http://[bad']) assert.equal(docTarget(other), null, other);
});

test('pageLabel and partyLine build the pane meta line', () => {
  assert.equal(pageLabel(3, 14), 'Page 3 of 14');
  assert.equal(pageLabel(20, 14), 'Page 14 of 14', 'never past the end');
  assert.equal(pageLabel(null, 1), '1 page');
  assert.equal(pageLabel(null, 14), '14 pages');
  assert.equal(pageLabel(2, null), 'Page 2');
  assert.equal(pageLabel(null, null), '');
  assert.equal(partyLine(['Acme Bank, N.A.'], ['Harbor Labs, Inc.']), 'Acme Bank, N.A. → Harbor Labs, Inc.');
  assert.equal(partyLine(['Doe', 'Roe'], []), 'From Doe, Roe');
  assert.equal(partyLine([], ['Court']), 'To Court');
  assert.equal(partyLine([], []), '');
});
