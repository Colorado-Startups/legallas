// SPDX-License-Identifier: Apache-2.0
// Card Q1: the Ask status line announces once per answer (WCAG 4.1.3), never per streamed word.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answerStatus, applyEvent, ERRORS, newTurn, questionToRestore, READING_STATUS } from './chat-client.ts';

const cite = { docId: 'd1', page: 1 } as never;

test("with no <html> attributes, Ask's budget error names today's room (room-names.ts)", () => {
  assert.equal(ERRORS.ai_budget, "Legallas has used today's AI allowance, which resets at midnight UTC; ask again then.");
});

test('a finished answer is announced once, with its cite count', () => {
  const turn = { ...newTurn('When?'), answer: 'On May 1, 2012.', citations: [cite, cite] };
  assert.equal(answerStatus(turn), 'Answer ready, 2 cites.');
  assert.equal(answerStatus({ ...turn, citations: [cite] }), 'Answer ready, 1 cite.');
  assert.equal(answerStatus({ ...turn, citations: [] }), 'Answer ready, 0 cites.');
});

test('an answer the record does not hold says so', () => {
  const turn = { ...newTurn('Who?'), answer: "I don't know.", dontKnow: true };
  assert.equal(answerStatus(turn), 'Answer ready: not in the record.');
});

test('a failed or empty turn adds nothing, so its error message stands', () => {
  assert.equal(answerStatus({ ...newTurn('Why?'), answer: 'Part of an', failed: true }), '');
  assert.equal(answerStatus(newTurn('Why?')), '');
});

test('a refused or dropped question goes back in the box, unless the reader typed a new one', () => {
  const refused = { ...newTurn('When was it delivered?'), failed: true };
  assert.equal(questionToRestore(refused, ''), 'When was it delivered?');
  assert.equal(questionToRestore(refused, '  \n'), 'When was it delivered?', 'whitespace is not a new question');
  assert.equal(questionToRestore(refused, 'Who signed it?'), null, 'a new draft is kept');
  assert.equal(questionToRestore({ ...refused, answer: 'Part of an' }, ''), null, 'a cut answer stays on screen');
  assert.equal(questionToRestore(newTurn('When?'), ''), null, 'a turn that did not fail');
});

test('the reading line is one short sentence', () => {
  assert.match(READING_STATUS, /^[A-Z][^.!]*\.$/);
});

test('a reading event with law on makes the turn read law tags as pending; the citations event fills them (T21)', () => {
  const turn = newTurn('What notice must a supplier give?');
  applyEvent({ event: 'reading', data: { documents: 1, pages: 1 } }, turn, {});
  assert.equal(turn.law, undefined, 'law off: the turn stays as before');
  applyEvent({ event: 'reading', data: { documents: 1, pages: 1, law: true } }, turn, {});
  assert.deepEqual(turn.law, []);
  const law = [{ id: 'crs-7-80-714', cite: 'C.R.S. § 7-80-714', title: 't', url: 'https://www.ecfr.gov/x', track: 'civil' }];
  applyEvent({ event: 'citations', data: { citations: [], law } }, turn, {});
  assert.deepEqual(turn.law, law);
});

test('done with truncated marks the turn cut off and keeps its text and cites; the status says so', () => {
  const turn = newTurn('List every delivery.');
  applyEvent({ event: 'delta', data: { text: 'READ: The first delivery [doc:d1 p:1]. The sec' } }, turn, {});
  applyEvent({ event: 'citations', data: { citations: [cite] } }, turn, {});
  assert.equal(applyEvent({ event: 'done', data: { dontKnow: false, truncated: true } }, turn, {}), true);
  assert.equal(turn.truncated, true);
  assert.equal(turn.failed, false, 'a cut answer is shown, not failed');
  assert.equal(turn.answer, 'READ: The first delivery [doc:d1 p:1]. The sec');
  assert.equal(answerStatus(turn), 'Answer cut off, 1 cite.');
});

test('a done without truncated, as every finished answer and older server sends, leaves the turn whole', () => {
  const turn = { ...newTurn('When?'), answer: 'On May 1, 2012.' };
  applyEvent({ event: 'done', data: { dontKnow: false } }, turn, {});
  assert.equal(turn.truncated, undefined);
  assert.equal(answerStatus(turn), 'Answer ready, 0 cites.');
  applyEvent({ event: 'done', data: { dontKnow: false, truncated: 'yes' } }, turn, {});
  assert.equal(turn.truncated, undefined, 'only the boolean true counts');
});
