// SPDX-License-Identifier: Apache-2.0
// Card 11.5: every citation in an answer is marked checked or not checked, and an answer naming a deadline flags it
// (docs/legal/product-notices.md A1, A4, A6). Fictional fixture data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answerSources, answerText, answerView, NOT_CHECKED_NOTE, sourceCheck, type AnswerPart } from './chat-answer.ts';
import { DEADLINE_FLAG, deadlineFlags } from './answer-deadlines.ts';
import { DROPPED_NOTE, type Inline } from './sanitize.ts';
import { ELECTION_83B, FORM_D, NOT_CHECKED } from '../../worker/product-notices.ts';

const CITES = [{ id: 'doc-a', page: 1, name: 'Fixture memo.pdf', control_seq: 12, quote: null }];
const LAW = [
  {
    id: 'crs-7-80-714',
    cite: 'C.R.S. § 7-80-714(1)',
    title: 'Derivative proceeding - demand',
    url: 'https://content.leg.colorado.gov/sites/default/files/images/olls/crs2024-title-07.pdf',
    retrieved: '2026-10-01',
    track: 'civil',
    kind: 'statute',
    source: 'Fixture compilation, not the official text',
  },
];
const OPTS = { dontKnow: false, prefix: 'DOE', law: LAW, at: '2026-11-06T12:00:00.000Z' };

const ANSWER = [
  '- CONFIRMED: The fixture memo mentions a demand [doc:doc-a p:1].',
  '- READ: A page never retrieved [doc:doc-z p:9].',
  '',
  'Law (from the law library)',
  '- LAW: Under C.R.S. § 7-80-714 a member makes a written demand first [law:crs-7-80-714].',
  '- LAW: 15 U.S.C. § 80b-6 bars fraud by advisers.',
  '- LAW: Never retrieved [law:crs-7-80-999].',
  '',
  'General background (not from the case files)',
  'Rule 10b-5 reaches statements made in connection with a sale.',
].join('\n');

const tokens = (parts: readonly AnswerPart[]): Inline[] =>
  parts.flatMap((p) => (p.kind === 'claim' || p.kind === 'p' ? p.inline : p.kind === 'ul' ? p.items.flat() : []));
const notes = (parts: readonly AnswerPart[]) => tokens(parts).flatMap((t) => (t.kind === 'note' ? [t.text] : []));
const prose = (parts: readonly AnswerPart[]) => tokens(parts).map((t) => (t.kind === 'cite' || t.kind === 'law' ? `(${t.label})` : t.text)).join('');

test('every source is marked: checked against its source on a date, or not checked', () => {
  const view = answerView(ANSWER, CITES, OPTS);
  const { record, law, unchecked } = answerSources(view);
  assert.deepEqual(record.map((s) => sourceCheck(s, view.checkedOn)), ['Checked against Fixture memo.pdf, p. 1 on 2026-11-06']);
  assert.deepEqual(law.map((s) => sourceCheck(s, view.checkedOn)), ['Checked against Fixture compilation, not the official text on 2026-10-01']);
  assert.deepEqual(unchecked, ['15 U.S.C. § 80b-6', '17 C.F.R. § 240.10b-5']);
});

test('a law cite in the text is marked not checked unless a validated tag names the same law', () => {
  const view = answerView(ANSWER, CITES, OPTS);
  assert.match(prose(view.law), /Under C\.R\.S\. § 7-80-714 a member/, 'a validated tag names it: no mark');
  assert.match(prose(view.law), /15 U\.S\.C\. § 80b-6 \[not checked\] bars fraud/);
  assert.deepEqual(notes(view.law), [NOT_CHECKED_NOTE, DROPPED_NOTE]);
  assert.deepEqual(notes(view.body), [DROPPED_NOTE], 'a record cite the room could not match');
  assert.match(prose(view.background as AnswerPart[]), /^Rule 10b-5 \[not checked\] reaches/);
});

test('with the law library off, every law cite in the text is not checked', () => {
  const view = answerView('- READ: The memo names 26 U.S.C. § 83(b) [doc:doc-a p:1].', CITES, { dontKnow: false, prefix: 'DOE', at: OPTS.at });
  assert.deepEqual(answerSources(view).unchecked, ['26 U.S.C. § 83(b)']);
  assert.deepEqual(notes(view.body), [NOT_CHECKED_NOTE]);
});

test('while streaming nothing is marked yet', () => {
  const view = answerView(ANSWER, null, OPTS);
  assert.equal(notes([...view.body, ...view.law]).includes(NOT_CHECKED_NOTE), false);
  assert.deepEqual(answerSources(view), { record: [], law: [], unchecked: [] });
});

test('copy with cites carries each source and how it was checked', () => {
  const text = answerText(answerView(ANSWER, CITES, OPTS));
  assert.ok(
    text.includes(
      [
        'Sources.',
        '- DOE-000012 at 1: Checked against Fixture memo.pdf, p. 1 on 2026-11-06.',
        '- C.R.S. § 7-80-714(1): Checked against Fixture compilation, not the official text on 2026-10-01.',
        '- 15 U.S.C. § 80b-6: not checked.',
        '- 17 C.F.R. § 240.10b-5: not checked.',
      ].join('\n'),
    ),
    text,
  );
});

test('the marks say checked, never verified (A1)', () => {
  for (const note of [NOT_CHECKED_NOTE, DROPPED_NOTE]) assert.doesNotMatch(note, /verif/i);
  assert.equal(DROPPED_NOTE, `[${NOT_CHECKED}: source removed]`);
  const view = answerView(ANSWER, CITES, { ...OPTS, at: undefined });
  assert.deepEqual(answerSources(view).record.map((s) => sourceCheck(s, view.checkedOn)), ['Checked against Fixture memo.pdf, p. 1']);
});

test('an answer naming a deadline flags it, in the A6 words', () => {
  const [election] = deadlineFlags('File the Section 83(b) election within 30 days.');
  assert.equal(election?.title, ELECTION_83B.title);
  assert.equal(
    election?.body,
    'It must be filed no later than 30 days after the transfer date. You sign under penalties of perjury and mail it yourself. Mail it early, keep proof of mailing, and give the company a copy.',
  );
  assert.deepEqual(deadlineFlags('A Form D notice follows the first sale.').map((f) => [f.name, f.title, f.body]), [['Form D', FORM_D.title, FORM_D.body]]);
  assert.deepEqual(deadlineFlags('Form D and the 83(b) election both apply.').map((f) => f.name), ['83(b) election', 'Form D']);
  for (const text of ['Notice is due within 10 days.', 'The deadline is in the agreement.', 'Reply no later than Friday.']) {
    assert.deepEqual(deadlineFlags(text), [DEADLINE_FLAG], text);
  }
  assert.deepEqual(deadlineFlags('The board met on Tuesday and approved the plan.'), []);
});

test('the flag shows on the answer and goes with a copied one', () => {
  const view = answerView('- READ: The founder mailed the 83(b) election [doc:doc-a p:1].', CITES, OPTS);
  assert.deepEqual(view.deadlines.map((f) => f.name), ['83(b) election']);
  assert.match(answerText(view), /^Deadline\. 83\(b\) election: This can't be fixed later\. It must be filed no later than 30 days after the transfer date\./);
  assert.deepEqual(answerView('- READ: The board met [doc:doc-a p:1].', CITES, OPTS).deadlines, []);
});
