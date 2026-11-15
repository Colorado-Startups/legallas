// SPDX-License-Identifier: Apache-2.0
// Research mode (plan D10 to D12): a research answer is a quick Ask turn plus step counts, its cites are quick
// Ask's validated citations, and every failure is one plain sentence. Runs against the mock transport.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answerView } from './chat-answer.ts';
import { ERRORS, FALLBACK_ERROR } from './chat-client.ts';
import {
  askResearch, cleanTitle, progressText, RESEARCH_ERRORS, researchMessage, stepsOf, threadDate, touchThread,
  type ResearchSteps,
} from './research-client.ts';
import { MOCK_CITATIONS, mockTransport } from './research-mock.ts';
import { PARTS } from './research-wire.ts';

test('the counts line says what the agent did in counts only', () => {
  assert.equal(progressText({ searches: 3, pages: 12 }), 'Searched 3 times, read 12 pages');
  assert.equal(progressText({ searches: 1, pages: 1 }), 'Searched once, read 1 page');
  assert.equal(progressText({ searches: 2, pages: 0 }), 'Searched 2 times');
  assert.equal(progressText({ searches: 0, pages: 4 }), 'Read 4 pages');
  assert.equal(progressText({ searches: 0, pages: 0 }), '', 'nothing before the first step');
  assert.equal(progressText(undefined), '');
});

test('step counts from the wire must be whole numbers in range', () => {
  assert.deepEqual(stepsOf({ searches: 2, pages: 9 }), { searches: 2, pages: 9 });
  for (const bad of [{ searches: -1, pages: 0 }, { searches: 1.5, pages: 0 }, { searches: '2', pages: 0 }, { searches: 1 }, null, { searches: 1, pages: 10_001 }]) {
    assert.equal(stepsOf(bad), null, JSON.stringify(bad));
  }
});

test('a new thread streams its steps, then a cited answer, and names itself', async () => {
  const transport = mockTransport();
  const progress: ResearchSteps[] = [];
  const named: string[] = [];
  let deltas = 0;
  const { turn, threadId } = await askResearch(transport, null, 'Who confirmed the order?', {
    progress: (s) => progress.push({ ...s }),
    thread: (t) => named.push(`${t.id}:${t.title}`),
    delta: () => deltas++,
  });
  assert.equal(threadId, 't1');
  assert.deepEqual(named, ['t1:Who confirmed the order?']);
  assert.deepEqual(progress, [{ searches: 1, pages: 0 }, { searches: 1, pages: 4 }, { searches: 2, pages: 7 }]);
  assert.equal(deltas, 2);
  assert.equal(turn.failed, false);
  assert.equal(turn.dontKnow, false);
  assert.deepEqual(turn.citations, MOCK_CITATIONS);
  assert.deepEqual(turn.steps, { searches: 2, pages: 7 });
  assert.equal(progressText(turn.steps), 'Searched 2 times, read 7 pages');
});

test('a research answer draws as quick Ask does: Fact and Read claims with cites that open the exhibit pane', async () => {
  const { turn } = await askResearch(mockTransport(), null, 'Who confirmed the order?');
  const view = answerView(turn.answer, turn.citations, { dontKnow: turn.dontKnow, prefix: 'DOE', law: turn.law });
  const claims = view.body.filter((p) => p.kind === 'claim');
  assert.deepEqual(claims.map((c) => c.kind === 'claim' && c.claim), ['fact', 'read']);
  const cites = claims.flatMap((c) => (c.kind === 'claim' ? c.inline : [])).filter((i) => i.kind === 'cite');
  assert.deepEqual(cites.map((c) => c.kind === 'cite' && [c.href, c.label]), [
    ['/doc/?id=doc-a#page=1', 'DOE-000231 at 1'],
    ['/doc/?id=doc-b#page=2', 'DOE-000232 at 2'],
  ]);
});

test('a follow-up stays in its thread and the thread keeps both turns', async () => {
  const transport = mockTransport();
  const first = await askResearch(transport, null, 'Who confirmed the order?');
  const second = await askResearch(transport, first.threadId, 'And when?');
  assert.equal(second.threadId, 't1');
  const turns = await transport.open('t1');
  assert.deepEqual(turns.map((t) => t.question), ['Who confirmed the order?', 'And when?']);
  assert.deepEqual(turns[1]!.steps, { searches: 2, pages: 7 }, 'the last counts are saved with the answer');
  assert.deepEqual(turns[1]!.citations, MOCK_CITATIONS);
});

test('a refusal is one sentence from the code, never the raw error', async () => {
  const errors: string[] = [];
  const { turn, threadId } = await askResearch(mockTransport({ refuse: 'research_off' }), null, 'Q?', { error: (m) => errors.push(m) });
  assert.equal(turn.failed, true);
  assert.equal(turn.answer, '');
  assert.equal(threadId, null);
  assert.deepEqual(errors, [RESEARCH_ERRORS.research_off]);
  assert.equal(researchMessage('daily_limit'), ERRORS.daily_limit);
  assert.equal(researchMessage('<b>stack trace</b>'), FALLBACK_ERROR);
});

test('an error chunk mid-stream fails the turn once and keeps the text that arrived', async () => {
  const errors: string[] = [];
  const script = () => [
    { type: 'text-delta', id: 'x', delta: 'Part of an' },
    { type: 'error', errorText: 'ai_budget' },
    { type: 'finish' },
  ];
  const { turn } = await askResearch(mockTransport({ script }), null, 'Q?', { error: (m) => errors.push(m) });
  assert.equal(turn.failed, true);
  assert.equal(turn.answer, 'Part of an');
  assert.deepEqual(errors, [ERRORS.ai_budget]);
});

test('a stream that ends with no verdict and no finish is cut off, said once', async () => {
  const errors: string[] = [];
  const script = () => [{ type: 'text-delta', id: 'x', delta: 'Part of an' }];
  const { turn } = await askResearch(mockTransport({ script }), null, 'Q?', { error: (m) => errors.push(m) });
  assert.equal(turn.failed, true);
  assert.deepEqual(errors, [ERRORS.answer_failed]);
});

test('"Not in the record" comes from the verdict only', async () => {
  const script = () => [
    { type: 'text-delta', id: 'x', delta: "I don't know." },
    { type: PARTS.citations, data: { citations: [] } },
    { type: PARTS.verdict, data: { dontKnow: true } },
    { type: 'finish' },
  ];
  const { turn } = await askResearch(mockTransport({ script }), null, 'Q?');
  assert.equal(turn.dontKnow, true);
  assert.equal(turn.failed, false);
});

test('thread titles are plain, short text and dates are ISO days', () => {
  assert.equal(cleanTitle('  Who\u0000 confirmed\n the   order?  '), 'Who confirmed the order?');
  assert.equal([...cleanTitle('x'.repeat(500))].length, 200);
  assert.equal(cleanTitle(42), '');
  assert.match(threadDate('2026-10-20T12:00:00.000Z'), /^2026-10-(19|20|21)$/);
  assert.equal(threadDate('not a date'), '');
});

test('asking moves the thread to the top of the list and keeps its title', () => {
  const list = [
    { id: 'a', title: 'First', updatedAt: '2026-10-01T00:00:00.000Z' },
    { id: 'b', title: 'Second', updatedAt: '2026-09-01T00:00:00.000Z' },
  ];
  assert.deepEqual(touchThread(list, { id: 'b', title: '', updatedAt: '2026-10-20T00:00:00.000Z' }).map((t) => `${t.id}:${t.title}`), ['b:Second', 'a:First']);
  assert.deepEqual(touchThread(list, { id: 'c', title: 'New', updatedAt: '2026-10-20T00:00:00.000Z' }).map((t) => t.id), ['c', 'a', 'b']);
});

test('deleting a thread removes it; opening it after says it is gone', async () => {
  const transport = mockTransport();
  await askResearch(transport, null, 'Q?');
  assert.equal((await transport.threads()).length, 1);
  await transport.remove('t1');
  assert.deepEqual(await transport.threads(), []);
  await assert.rejects(transport.open('t1'), { code: 'thread_missing' });
  await assert.rejects(transport.open('../t1'), { code: 'thread_missing' }, 'a malformed id is refused, never looked up');
});

test('every research message is one plain sentence with no em dash', () => {
  for (const message of Object.values(RESEARCH_ERRORS)) {
    assert.match(message, /^[A-Z][^!\u2014]*\.$/, message);
  }
});

test('a research turn the room could not finish (answer_failed) gets its own plain line, not a stack trace', async () => {
  const errors: string[] = [];
  const script = () => [{ type: 'text-delta', id: 'x', delta: 'Part' }, { type: 'error', errorText: 'answer_failed' }];
  const { turn } = await askResearch(mockTransport({ script }), null, 'Q?', { error: (m) => errors.push(m) });
  assert.equal(turn.failed, true);
  assert.deepEqual(errors, [RESEARCH_ERRORS.answer_failed]);
  assert.equal(researchMessage('answer_failed'), 'The research stopped before its answer was finished; ask again in a minute.');
});
