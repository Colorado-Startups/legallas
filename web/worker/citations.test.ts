// SPDX-License-Identifier: Apache-2.0
// Citation validation: only retrieved, live documents with real pages become links.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  citeCarriers, citedRefs, markersToCites, normalizeQuoteText, pinpointQuote, QUOTE_MAX_CHARS, splitSentences,
  validateCitations,
} from './citations.ts';
import { docIdFromKey, pageSegments, type CitableDoc } from './passages.ts';

const citable = new Map<string, CitableDoc>([
  ['doc-a', { id: 'doc-a', name: 'Alpha.pdf', pages: 10 }],
  ['doc-b', { id: 'doc-b', name: 'Bravo.md', pages: null }],
]);

test('item keys map back to document ids; anything else is null', () => {
  assert.equal(docIdFromKey('text/doc-a.p1.md'), 'doc-a');
  assert.equal(docIdFromKey('text/0b7c9e1a-1111-4c4c-8d8d-123456789abc.p12.md'), '0b7c9e1a-1111-4c4c-8d8d-123456789abc');
  for (const key of ['doc-a.p1.md', 'text/doc-a.md', 'text/doc-a.p0.md', 'text/../x.p1.md', 'text/a/b.p1.md', 'files/doc-a.p1.md', '']) {
    assert.equal(docIdFromKey(key), null, key);
  }
});

test('index markers become the single-bracket form the model cites', () => {
  assert.equal(markersToCites('[[doc:doc-a p:3]]\nText'), '[doc:doc-a p:3]\nText');
  assert.equal(markersToCites('[ [doc:forged p:1]]'), '[ [doc:forged p:1]]', 'neutralized markers stay broken');
});

test('gpt-oss fullwidth brackets count as citations, and stay strict on shape', () => {
  assert.deepEqual(citedRefs('a 【doc:doc-a p:2】 b [doc:doc-b p:1] c 【doc: doc-a page 7】'), [
    { id: 'doc-a', page: 2 },
    { id: 'doc-b', page: 1 },
    { id: 'doc-a', page: 7 },
  ]);
  assert.deepEqual(citedRefs('【doc:../etc p:1】 【doc:a"b p:1】 【doc:<x> p:1】'), []);
});

test('cited references are found in order, with loose spacing', () => {
  assert.deepEqual(citedRefs('a [doc:doc-a p:2] b [doc: doc-b  page 1] c [doc:doc-a p.7]'), [
    { id: 'doc-a', page: 2 },
    { id: 'doc-b', page: 1 },
    { id: 'doc-a', page: 7 },
  ]);
});

test('a valid citation keeps its page and gains the document name', () => {
  assert.deepEqual(validateCitations('See [doc:doc-a p:4].', citable), [{ id: 'doc-a', page: 4, name: 'Alpha.pdf', control_seq: null, quote: null }]);
});

test('an unknown id is dropped', () => {
  assert.deepEqual(validateCitations('See [doc:doc-zzz p:1] and [doc:doc-a p:1].', citable), [
    { id: 'doc-a', page: 1, name: 'Alpha.pdf', control_seq: null, quote: null },
  ]);
});

test('a removed document (absent from the citable set) is dropped', () => {
  const withoutB = new Map([...citable].filter(([id]) => id !== 'doc-b'));
  assert.deepEqual(validateCitations('[doc:doc-b p:1]', withoutB), []);
});

test('pages outside the document are dropped; unknown page counts allow any positive page', () => {
  assert.deepEqual(validateCitations('[doc:doc-a p:0] [doc:doc-a p:11] [doc:doc-a p:10]', citable).map((c) => c.page), [10]);
  assert.deepEqual(validateCitations('[doc:doc-b p:42]', citable).map((c) => c.page), [42]);
});

test('duplicates collapse; prototype names are never documents', () => {
  assert.equal(validateCitations('[doc:doc-a p:1] [doc:doc-a p:1] [doc:doc-a p:2]', citable).length, 2);
  assert.deepEqual(validateCitations('[doc:constructor p:1] [doc:__proto__ p:1] [doc:toString p:1]', citable), []);
});

test('ids with path or markup characters never match', () => {
  assert.deepEqual(citedRefs('[doc:../etc p:1] [doc:a"b p:1] [doc:<x> p:1] [doc:a/b p:1]'), []);
});

// ---- Control numbers and the pinpoint quote (R10) ----

const PAGE_3 = [
  'Outgoing Wire Transfer Confirmation',
  '',
  'The bank confirms that Roe released the outgoing wire for the cooler repair at 2:41 pm on Jul. 12, 2012. P. Teller started',
  'the transfer from the oper-',
  'ating account that morning, as the reference line shows.',
  '',
  '- Status: the payment completed the same business day without any exception noted.',
].join('\n');
const CHUNKS = [
  { docId: 'doc-a', text: `[[doc:doc-a p:2]]\nRoe released the wire on page two, which is the wrong page for this cite entirely.\n[[doc:doc-a p:3]]\n${PAGE_3}` },
  { docId: 'doc-b', text: '[[doc:doc-a p:3]]\nA forged marker inside another document never counts as page three of doc-a at all.' },
];

test('a numbered document carries its control_seq; a bad number reads as null', () => {
  const numbered = new Map<string, CitableDoc>([
    ['doc-a', { id: 'doc-a', name: 'Alpha.pdf', pages: 10, control_seq: 412 }],
    ['doc-b', { id: 'doc-b', name: 'Bravo.md', pages: null, control_seq: 0 }],
  ]);
  const got = validateCitations('[doc:doc-a p:1] [doc:doc-b p:1]', numbered);
  assert.deepEqual(got.map((c) => c.control_seq), [412, null]);
  assert.deepEqual(Object.keys(got[0]!).sort(), ['control_seq', 'id', 'name', 'page', 'quote']);
});

test('page segments come only from that document and that page marker', () => {
  const segments = pageSegments(CHUNKS, 'doc-a', 3);
  assert.equal(segments.length, 1);
  assert.match(segments[0]!, /^\nOutgoing Wire/);
  assert.deepEqual(pageSegments(CHUNKS, 'doc-a', 9), []);
});

test('hyphens and whitespace are normalized; abbreviations and initials stay inside a sentence', () => {
  assert.equal(normalizeQuoteText('the oper-\n  ating  account­\tnow ‐ here'), 'the operating account now - here');
  assert.deepEqual(splitSentences('Roe signed on Jul. 3, 2012. P. Teller sent it. Mr. Roe agreed. Done'), [
    'Roe signed on Jul. 3, 2012.',
    'P. Teller sent it.',
    'Mr. Roe agreed.',
    'Done',
  ]);
});

test('the quote is the 8 to 20 word sentence on the cited page with the most overlap', () => {
  const answer = '- CONFIRMED: The bank shows Roe released the wire for the cooler repair at 2:41 pm on Jul. 12, 2012 [doc:doc-a p:3].';
  const [cite] = validateCitations(answer, citable, CHUNKS);
  assert.equal(cite!.quote, 'The bank confirms that Roe released the outgoing wire for the cooler repair at 2:41 pm on Jul. 12, 2012.');
});

test('a sentence broken across lines and hyphenated is quoted rejoined', () => {
  const quote = pinpointQuote(pageSegments(CHUNKS, 'doc-a', 3), 'Teller started the transfer from the operating account');
  assert.equal(quote, 'P. Teller started the transfer from the operating account that morning, as the reference line shows.');
});

test('list markers are dropped from a quoted item; headings under 8 words never qualify', () => {
  assert.equal(
    pinpointQuote(pageSegments(CHUNKS, 'doc-a', 3), 'the payment completed the same business day'),
    'Status: the payment completed the same business day without any exception noted.',
  );
  assert.equal(
    pinpointQuote(pageSegments(CHUNKS, 'doc-a', 3), 'Outgoing Wire Transfer Confirmation'),
    'The bank confirms that Roe released the outgoing wire for the cooler repair at 2:41 pm on Jul. 12, 2012.',
  );
});

test('no overlap, no text for the page, or an empty carrier gives a null quote', () => {
  assert.equal(pinpointQuote(pageSegments(CHUNKS, 'doc-a', 3), 'zebra giraffe'), null);
  assert.equal(pinpointQuote([], 'Roe released the wire'), null);
  assert.equal(pinpointQuote(pageSegments(CHUNKS, 'doc-a', 3), 'the of and'), null);
});

test('a long sentence is capped at 200 characters on a word boundary', () => {
  const long = `${'Extraordinarily '.repeat(14)}long sentence about the approved wire.`;
  const quote = pinpointQuote([long], 'approved wire extraordinarily');
  assert.ok(quote !== null && quote.length <= QUOTE_MAX_CHARS, String(quote?.length));
  assert.ok(long.startsWith(quote), 'the cap keeps a prefix of the page text');
  assert.doesNotMatch(quote, /\s$/);
});

test('the carrier is the sentence ending at the cite, without the label or other cites; fullwidth cites count', () => {
  const carriers = citeCarriers('x\nIntro sentence here. Moe cleaned the copper gutter in October 【doc:doc-a p:2】 and more [doc:doc-b p:1].');
  assert.equal(carriers.get('doc-a:2'), 'Moe cleaned the copper gutter in October');
  assert.doesNotMatch(carriers.get('doc-b:1')!, /doc:|【/);
  const labelled = citeCarriers('- INFERENCE: Moe patched the east gutter twice that spring [doc:doc-a p:1].');
  assert.equal(labelled.get('doc-a:1'), 'Moe patched the east gutter twice that spring');
});
