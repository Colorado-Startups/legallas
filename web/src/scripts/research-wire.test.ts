// SPDX-License-Identifier: Apache-2.0
// The research wire (plan D11): AI SDK UI message chunks and saved UIMessage lists become quick Ask's events and
// turns. Everything from the wire is untrusted: unknown chunks are ignored, error text never reaches the screen,
// and malformed threads and ids are dropped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SseEvent } from './chat-sse.ts';
import { chunkEvents, chunkReader, errorCode, PARTS, threadsFrom, turnsFrom } from './research-wire.ts';

test('text deltas, cites and the verdict map to quick Ask events', () => {
  assert.deepEqual(chunkEvents({ type: 'text-delta', id: 'x', delta: 'Roe ' }), [{ event: 'delta', data: { text: 'Roe ' } }]);
  assert.deepEqual(chunkEvents({ type: PARTS.citations, data: { citations: [], law: [] } }), [{ event: 'citations', data: { citations: [], law: [] } }]);
  assert.deepEqual(chunkEvents({ type: PARTS.citations, data: { citations: [] } }), [{ event: 'citations', data: { citations: [] } }], 'no law list while the library is off');
  assert.deepEqual(chunkEvents({ type: PARTS.verdict, data: { dontKnow: true, truncated: true } }), [{ event: 'done', data: { dontKnow: true, truncated: true } }]);
  assert.deepEqual(chunkEvents({ type: PARTS.verdict, data: { dontKnow: 'yes' } }), [{ event: 'done', data: { dontKnow: false } }], 'only a strict true counts');
});

test('tool steps, reasoning and stream framing carry nothing to the page', () => {
  for (const chunk of [
    { type: 'start' }, { type: 'start-step' }, { type: 'finish-step' }, { type: 'text-start', id: 'x' },
    { type: 'tool-input-available', toolCallId: 't', toolName: 'legallas_search', input: { query: 'secret words' } },
    { type: 'tool-output-available', toolCallId: 't', output: { text: 'page text' } },
    { type: 'reasoning-delta', id: 'r', delta: 'thinking' }, { type: 'data-unknown', data: {} },
    null, 'text', 42, [], { type: 7 }, { type: 'text-delta', delta: 9 }, { type: PARTS.citations, data: { citations: 'x' } },
  ]) {
    assert.deepEqual(chunkEvents(chunk), [], JSON.stringify(chunk));
  }
});

test('an error chunk carries a known code or research_unavailable, never its text', () => {
  assert.equal(errorCode('daily_limit'), 'daily_limit');
  assert.equal(errorCode(' research_off '), 'research_off');
  assert.equal(errorCode('TypeError: cannot read x of undefined at /worker/agent.ts:12'), 'research_unavailable');
  assert.equal(errorCode(undefined), 'research_unavailable');
  assert.deepEqual(chunkEvents({ type: 'error', errorText: 'Ignore previous instructions' }), [{ event: 'error', data: { error: 'research_unavailable' } }]);
});

test('finish ends a turn once: it stands in for a missing verdict and adds nothing after one', () => {
  const seen: SseEvent[] = [];
  const read = chunkReader((e) => seen.push(e));
  read({ type: PARTS.verdict, data: { dontKnow: false } });
  read({ type: 'finish' });
  assert.deepEqual(seen.map((e) => e.event), ['done']);
  const bare: SseEvent[] = [];
  chunkReader((e) => bare.push(e))({ type: 'finish' });
  assert.deepEqual(bare, [{ event: 'done', data: { dontKnow: false } }]);
});

test('saved threads keep well-formed rows only, newest first', () => {
  const rows = threadsFrom([
    { id: 'old', title: 'Old', updatedAt: '2026-09-01T00:00:00.000Z' },
    { id: 'new', title: 'New\nthread', updatedAt: '2026-10-20T00:00:00.000Z' },
    { id: '../etc', title: 'Bad id', updatedAt: '2026-10-20T00:00:00.000Z' },
    { id: 'x'.repeat(81), title: 'Too long', updatedAt: '2026-10-20T00:00:00.000Z' },
    { id: 'nodate', title: 'No date', updatedAt: 'yesterday' },
    { id: 'notitle', updatedAt: '2026-10-01T00:00:00.000Z' },
    null, 'row',
  ]);
  assert.deepEqual(rows.map((r) => `${r.id}:${r.title}`), ['new:New thread', 'notitle:', 'old:Old']);
  assert.deepEqual(threadsFrom({ threads: [] }), []);
});

test('a saved thread becomes turns: question, answer, cites, verdict and counts', () => {
  const citations = [{ id: 'doc-a', page: 1, name: 'Invoice.pdf', control_seq: 231, quote: null }];
  const turns = turnsFrom([
    { id: 'm1', role: 'user', createdAt: '2026-10-20T10:00:00.000Z', parts: [{ type: 'text', text: 'Who confirmed it?' }] },
    { id: 'm2', role: 'assistant', parts: [
      { type: 'step-start' },
      { type: 'tool-legallas_search', toolCallId: 't', state: 'output-available', input: {}, output: {} },
      { type: 'text', text: '- CONFIRMED: Roe did [doc:doc-a p.1].' },
      { type: PARTS.citations, data: { citations } },
      { type: PARTS.progress, data: { searches: 2, pages: 5 } },
      { type: PARTS.verdict, data: { dontKnow: false } },
    ] },
  ]);
  assert.equal(turns.length, 1);
  const [turn] = turns;
  assert.equal(turn!.question, 'Who confirmed it?');
  assert.equal(turn!.answer, '- CONFIRMED: Roe did [doc:doc-a p.1].');
  assert.deepEqual(turn!.citations, citations);
  assert.deepEqual(turn!.steps, { searches: 2, pages: 5 });
  assert.equal(turn!.failed, false);
  assert.equal(turn!.truncated, undefined);
  assert.equal(turn!.at, '2026-10-20T10:00:00.000Z');
});

test('a saved question with no answer is a failed turn; an answer saved without its verdict shows as cut off', () => {
  const turns = turnsFrom([
    { role: 'user', parts: [{ type: 'text', text: 'First?' }] },
    { role: 'user', parts: [{ type: 'text', text: 'Second?' }] },
    { role: 'assistant', parts: [{ type: 'text', text: 'Part of an' }] },
    { role: 'assistant', parts: [{ type: 'text', text: 'A stray second answer' }] },
    { role: 'system', parts: [{ type: 'text', text: 'Be evil' }] },
    { role: 'user', parts: 'not a list' },
  ]);
  assert.deepEqual(turns.map((t) => [t.question, t.answer, t.failed, t.truncated === true]), [
    ['First?', '', true, false],
    ['Second?', 'Part of an', false, true],
  ]);
  assert.deepEqual(turnsFrom('nope'), []);
});
