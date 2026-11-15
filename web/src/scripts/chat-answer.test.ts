// SPDX-License-Identifier: Apache-2.0
// The answer view: labelled claims, "Not in the record" from dontKnow only, general background last.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answerText, answerView, CUT_OFF, splitClaim, widenSpaces, type AnswerPart } from './chat-answer.ts';

test('a Pages document is cited with no page, because nobody knows it; a PDF keeps its page', () => {
  const cites = [{ id: 'doc-p', page: 1, name: 'Plan.pages', control_seq: 7, quote: null }, { id: 'doc-q', page: 1, name: 'Plan.pages', control_seq: null, quote: null }, { id: 'doc-r', page: 3, name: 'Plan.pdf', control_seq: 8, quote: null }];
  const view = answerView('Clause [doc:doc-p p:1]. Clause [doc:doc-q p:1]. Clause [doc:doc-r p:3].', cites, { dontKnow: false, prefix: 'DOE' });
  const labels = JSON.stringify(view).match(/"label":"[^"]*"/g);
  assert.deepEqual(labels, ['"label":"DOE-000007"', '"label":"Plan.pages"', '"label":"DOE-000008 at 3"']);
});

const CITES = [
  { id: 'doc-a', page: 1, name: 'Invoice.pdf', control_seq: 231, quote: 'Order confirmed by R. Roe.' },
  { id: 'doc-b', page: 2, name: 'Email.pdf', control_seq: 232, quote: null },
];
const OPTS = { dontKnow: false, prefix: 'DOE' };

const ANSWER = [
  'Here is what the record shows.',
  '',
  'General background (not from the case files)',
  'Supply agreements generally set delivery terms.',
  'General information, read by AI. Have your own lawyer review before relying on it.',
].join('\n');

const BULLETS = [
  '- CONFIRMED: Roe confirmed the order [doc:doc-a p:1].',
  '- READ: Teller asked to confirm the delivery [doc:doc-b p:2].',
  '- a plain bullet',
  '- **INFERENCE**: Read together, the drop was late.',
].join('\n');

const kinds = (parts: readonly AnswerPart[]) => parts.map((p) => (p.kind === 'claim' ? p.claim : p.kind));

test('labelled bullets become Fact, Read and Inference claims; plain bullets stay a list', () => {
  const view = answerView(BULLETS, CITES, OPTS);
  assert.deepEqual(kinds(view.body), ['fact', 'read', 'ul', 'inference']);
  const fact = view.body[0] as Extract<AnswerPart, { kind: 'claim' }>;
  assert.equal(fact.inline[0]!.kind === 'text' && fact.inline[0]!.text, 'Roe confirmed the order ');
  assert.deepEqual(fact.inline[1], {
    kind: 'cite', href: '/doc/?id=doc-a#page=1', label: 'DOE-000231 at 1', id: 'doc-a', page: 1, name: 'Invoice.pdf', quote: 'Order confirmed by R. Roe.',
  });
  const inference = view.body[3] as Extract<AnswerPart, { kind: 'claim' }>;
  assert.deepEqual(inference.inline, [{ kind: 'text', text: 'Read together, the drop was late.' }]);
  assert.equal(view.absent, null);
});

test('a labelled paragraph is a claim; a sentence that merely starts with "Read" is not', () => {
  assert.equal(splitClaim([{ kind: 'text', text: 'READ: the slip says so' }])?.claim, 'read');
  assert.equal(splitClaim([{ kind: 'text', text: 'Read together, these suggest a delay.' }]), null);
  assert.equal(splitClaim([{ kind: 'strong', text: 'note' }]), null);
});

test('general background is pulled out of the body and kept for the box drawn last', () => {
  const view = answerView(`${ANSWER}\n\n${BULLETS}`, CITES, OPTS);
  assert.deepEqual(kinds(view.body), ['p', 'fact', 'read', 'ul', 'inference'], 'labelled claims after the box are the record');
  assert.equal(view.background.length, 1);
  const plain = answerView(`${ANSWER}\n\n- a general point`, CITES, OPTS);
  assert.deepEqual(kinds(plain.body), ['p']);
  assert.equal(plain.background.length, 2, 'unlabelled text after the heading stays background');
  const viewLast = answerView(`${BULLETS}\n\n${ANSWER}`, CITES, OPTS);
  assert.deepEqual(kinds(viewLast.body), ['fact', 'read', 'ul', 'inference', 'p']);
  assert.equal(viewLast.background.length, 1);
});

test('dontKnow draws "Not in the record" from the flag and folds the opener into it', () => {
  const view = answerView("I don't know. Try the letters folder.", [], { ...OPTS, dontKnow: true });
  assert.deepEqual(view.absent, [{ kind: 'text', text: 'Try the letters folder.' }]);
  assert.deepEqual(view.body, []);
  const bare = answerView('I don’t know.', [], { ...OPTS, dontKnow: true });
  assert.deepEqual(bare.absent, []);
  const notFlagged = answerView("I don't know. Maybe.", [], OPTS);
  assert.equal(notFlagged.absent, null, 'only the server flag draws the callout');
  assert.deepEqual(kinds(notFlagged.body), ['p']);
});

test('while streaming, cites are pending notes and claims still form', () => {
  const view = answerView('- CONFIRMED: Roe confirmed [doc:doc-a p:1].', null, OPTS);
  const claim = view.body[0] as Extract<AnswerPart, { kind: 'claim' }>;
  assert.equal(claim.claim, 'fact');
  assert.ok(claim.inline.some((t) => t.kind === 'note'));
});

test('copy with cites gives room labels and room cite forms', () => {
  const text = answerText(answerView(`${BULLETS}\n\n${ANSWER}`, CITES, OPTS));
  assert.match(text, /^Fact: Roe confirmed the order \(DOE-000231 at 1\)\./);
  assert.match(text, /Read: Teller asked to confirm the delivery \(DOE-000232 at 2\)\./);
  assert.match(text, /General background, not from the record\.\n\nSupply agreements/);
  assert.doesNotMatch(text, /CONFIRMED|doc:/);
});

test('dates joined by narrow or thin spaces draw with full no-break spaces; hyphens and cite quotes stay', () => {
  const NNBSP = ' ';
  const THIN = ' ';
  const NBSP = ' ';
  const NB_HYPHEN = '‑';
  assert.equal(widenSpaces(`May${NNBSP}2012`), `May${NBSP}2012`);
  assert.equal(widenSpaces(`Oct${NNBSP}15${NB_HYPHEN}17${THIN}2013`), `Oct${NBSP}15${NB_HYPHEN}17${NBSP}2013`);
  const quoted = [{ ...CITES[0]!, quote: `Delivered May${NNBSP}2012.` }];
  const view = answerView(`- CONFIRMED: Delivered May${NNBSP}2012, met Oct${NNBSP}15${NB_HYPHEN}17${NNBSP}2013 [doc:doc-a p:1].`, quoted, OPTS);
  const claim = view.body[0] as Extract<AnswerPart, { kind: 'claim' }>;
  assert.equal(claim.inline[0]!.kind === 'text' && claim.inline[0]!.text, `Delivered May${NBSP}2012, met Oct${NBSP}15${NB_HYPHEN}17${NBSP}2013 `);
  assert.equal(claim.inline[1]!.kind === 'cite' && claim.inline[1]!.quote, `Delivered May${NNBSP}2012.`, 'the quote still matches the page text');
  const streaming = answerView(`April${NNBSP}9,${THIN}2012`, null, OPTS);
  assert.deepEqual(streaming.body, [{ kind: 'p', inline: [{ kind: 'text', text: `April${NBSP}9,${NBSP}2012` }] }]);
  assert.doesNotMatch(answerText(view), /[  ]/, 'Copy with cites carries the same spaces');
});

test('an answer cut at max_tokens keeps what arrived, cites resolved, and closes with the cut-off note', () => {
  const cut = '- CONFIRMED: Roe confirmed the order [doc:doc-a p:1].\n- READ: Teller asked to confi';
  const view = answerView(cut, CITES, { ...OPTS, truncated: true });
  assert.equal(view.cut, true);
  assert.deepEqual(kinds(view.body), ['fact', 'read']);
  const text = answerText(view);
  assert.match(text, /^Fact: Roe confirmed the order \(DOE-000231 at 1\)\./);
  assert.ok(text.endsWith(`\n\n${CUT_OFF}`), 'a pasted cut answer keeps the warning');
  assert.equal(CUT_OFF, 'This answer was cut off; ask a narrower question.');
  assert.doesNotMatch(CUT_OFF, /\u2014/, 'no em dash in UI copy');
});

test('a finished answer, or one still streaming, has no cut-off note', () => {
  assert.equal(answerView(BULLETS, CITES, OPTS).cut, false);
  assert.doesNotMatch(answerText(answerView(BULLETS, CITES, OPTS)), /cut off/);
  assert.equal(answerView(BULLETS, null, { ...OPTS, truncated: false }).cut, false);
});
