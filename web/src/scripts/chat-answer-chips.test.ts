// SPDX-License-Identifier: Apache-2.0
// One chip per source in a claim, paragraph or list item; one Fact per surviving cite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answerView, dedupeChips, type AnswerPart } from './chat-answer.ts';

const CITES = [
  { id: 'doc-a', page: 1, name: 'Invoice.pdf', control_seq: 231, quote: null },
  { id: 'doc-b', page: 2, name: 'Email.pdf', control_seq: 232, quote: null },
];
const OPTS = { dontKnow: false, prefix: 'DOE' };
const chips = (part: AnswerPart) => (part.kind === 'claim' || part.kind === 'p' ? part.inline : part.kind === 'ul' ? part.items.flat() : []).filter((t) => t.kind === 'cite').length;

test('a page cited again in the same claim shows one chip; another page or another claim keeps its own', () => {
  const view = answerView(
    '- CONFIRMED: Roe confirmed the order [doc:doc-a p:1] [doc:doc-a p:1] and again [doc:doc-b p:2] [doc:doc-a p:1].\n- READ: Later [doc:doc-a p:1].',
    CITES,
    OPTS,
  );
  assert.deepEqual(view.body.map(chips), [2, 1]);
  const first = view.body[0] as Extract<AnswerPart, { kind: 'claim' }>;
  assert.equal(first.inline.map((t) => (t.kind === 'text' ? t.text : `<${t.kind}>`)).join(''), 'Roe confirmed the order <cite> and again <cite>.');
});

test('notes are never deduplicated, and a list keeps one chip per item', () => {
  const inline = dedupeChips([
    { kind: 'note', text: '[source pending]' },
    { kind: 'text', text: ' ' },
    { kind: 'note', text: '[source pending]' },
  ]);
  assert.equal(inline.length, 3);
  const view = answerView('- one [doc:doc-a p:1] [doc:doc-a p:1]\n- two [doc:doc-a p:1]', CITES, OPTS);
  assert.deepEqual(view.body.map(chips), [2]);
  const list = view.body[0] as Extract<AnswerPart, { kind: 'ul' }>;
  assert.deepEqual(list.items.map((item) => item.filter((t) => t.kind === 'cite').length), [1, 1]);
});

test('once the citations are in, a Fact whose cites were all dropped is shown as Read', () => {
  const view = answerView('- CONFIRMED: Roe confirmed the order [doc:doc-zzz p:1].', CITES, OPTS);
  assert.equal((view.body[0] as Extract<AnswerPart, { kind: 'claim' }>).claim, 'read');
  const streaming = answerView('- CONFIRMED: Roe confirmed the order [doc:doc-zzz p:1].', null, OPTS);
  assert.equal((streaming.body[0] as Extract<AnswerPart, { kind: 'claim' }>).claim, 'fact', 'not while streaming');
});
