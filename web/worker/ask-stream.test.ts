// SPDX-License-Identifier: Apache-2.0
// SSE framing: the model's stream in, the room's stream out, and the browser's parser reading it back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sseParser, type SseEvent } from '../src/scripts/chat-sse.ts';
import { answerStream, degenerate, fixedText, modelDeltas, retryDegenerate, sseFrame } from './ask-stream.ts';
import { modelSse } from './room-fixtures.ts';

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

function bytes(text: string, size: number): ReadableStream<Uint8Array> {
  const all = new TextEncoder().encode(text);
  let at = 0;
  return new ReadableStream({
    pull(c) {
      if (at >= all.length) return c.close();
      c.enqueue(all.slice(at, at + size));
      at += size;
    },
  });
}

test('a frame is one event line and one data line, even when the text has newlines', () => {
  const frame = sseFrame({ event: 'delta', data: { text: 'a\nb\n\nevent: citations' } });
  assert.equal(frame.split('\n').length, 4);
  assert.match(frame, /^event: delta\ndata: \{.*\}\n\n$/);
});

test('model deltas parse across arbitrary byte splits, including inside multi-byte characters', async () => {
  const answer = 'Clé façade, naïve résumé [doc:a p:1]\nNext line.';
  for (const size of [1, 2, 3, 7, 64]) {
    assert.equal((await collect(modelDeltas(modelSse(answer, size)))).join(''), answer, `size ${size}`);
  }
});

test('reasoning, [DONE], comments, junk and classic `response` events', async () => {
  const raw =
    ': keep-alive\n\n' +
    'data: {"choices":[{"delta":{"reasoning_content":"secret"}}]}\n\n' +
    'data: not json\n\n' +
    'data: {"response":"classic "}\r\n\r\n' +
    'data: {"choices":[{"delta":{"content":"chat"}}]}\n\n' +
    'data: [DONE]\n\n';
  assert.deepEqual(await collect(modelDeltas(bytes(raw, 5))), ['classic ', 'chat']);
});

test('the room stream: deltas, then citations, then done, readable by the browser parser', async () => {
  const stream = answerStream(fixedText('Hello [doc:a p:1]'), (answer) => {
    assert.equal(answer, 'Hello [doc:a p:1]');
    return { citations: [{ id: 'a', page: 1, name: 'A.pdf', control_seq: 7, quote: null }], dontKnow: false };
  });
  const text = await new Response(stream).text();
  const parser = sseParser();
  const events = [];
  for (let i = 0; i < text.length; i += 3) events.push(...parser.push(text.slice(i, i + 3)));
  events.push(...parser.end());
  assert.deepEqual(events, [
    { event: 'delta', data: { text: 'Hello [doc:a p:1]' } },
    { event: 'citations', data: { citations: [{ id: 'a', page: 1, name: 'A.pdf', control_seq: 7, quote: null }] } },
    { event: 'done', data: { dontKnow: false } },
  ]);
});

test('a failure mid-stream ends with an error event and no citations', async () => {
  async function* broken() {
    yield 'partial ';
    throw new Error('upstream reset');
  }
  const original = console.error;
  const logged: unknown[][] = [];
  console.error = (...args: unknown[]) => logged.push(args);
  try {
    const parser = sseParser();
    const events = [...parser.push(await new Response(answerStream(broken(), () => ({ citations: [], dontKnow: false }))).text()), ...parser.end()];
    assert.deepEqual(events.map((e) => e.event), ['delta', 'error']);
    assert.deepEqual(events[1]!.data, { error: 'answer_failed' });
  } finally {
    console.error = original;
  }
  assert.deepEqual(logged, [['ask_stream_failed', 'Error']], 'logs the error type only, never text');
});

/** A start() for retryDegenerate that hands out these answers in order and counts its calls. */
function starts(...answers: string[]) {
  const calls = { n: 0 };
  return { calls, start: async () => modelSse(answers[calls.n++] ?? 'unexpected third call', 3) };
}

test('retryDegenerate passes a normal answer through with one model call', async () => {
  const { calls, start } = starts('READ: Fine [doc:a p:1]. Then more text.');
  assert.equal((await collect(retryDegenerate(start))).join(''), 'READ: Fine [doc:a p:1]. Then more text.');
  assert.equal(calls.n, 1);
});

/** Runs `work` with console.error captured; returns what it logged. */
async function logsOf(work: () => Promise<unknown>): Promise<unknown[][]> {
  const original = console.error;
  const logged: unknown[][] = [];
  console.error = (...args: unknown[]) => logged.push(args);
  try {
    await work();
  } finally {
    console.error = original;
  }
  return logged;
}

/** The room stream's events for these deltas, and whether `finish` was asked. */
async function roomEvents(deltas: AsyncIterable<string>) {
  let finished = false;
  const body = answerStream(deltas, () => ((finished = true), { citations: [], dontKnow: false }));
  const parser = sseParser();
  return { events: [...parser.push(await new Response(body).text()), ...parser.end()], finished: () => finished };
}

test('retryDegenerate passes a short answer through', async () => {
  const { calls, start } = starts('Ok!');
  assert.equal((await collect(retryDegenerate(start))).join(''), 'Ok!');
  assert.equal(calls.n, 1);
});

test('an answer with nothing visible is degenerate: empty, whitespace, zero-width characters', () => {
  for (const opening of ['', ' \n\t ', '​﻿', ' ​\n']) assert.equal(degenerate(opening), 'empty', JSON.stringify(opening));
  assert.equal(degenerate('!!! !'), 'bang');
  for (const opening of ['Ok!', 'I don’t know.', '​READ: x']) assert.equal(degenerate(opening), null, opening);
});

test('a stream of reasoning only (no answer text) is dropped and asked once more', async () => {
  // modelSse('') is what glm-5.3-flash sends when reasoning uses all of max_tokens: reasoning frames, then [DONE].
  const { calls, start } = starts('', 'READ: Second try [doc:a p:1].');
  let text = '';
  const logged = await logsOf(async () => (text = (await collect(retryDegenerate(start))).join('')));
  assert.equal(text, 'READ: Second try [doc:a p:1].');
  assert.equal(calls.n, 2);
  assert.deepEqual(logged, [['ask_answer_retried', 'empty']], 'logs the reason only, never text');
});

test('two empty streams end with an error event, never a blank answer marked done', async () => {
  const { calls, start } = starts('', '\n\n');
  let got: Awaited<ReturnType<typeof roomEvents>> | undefined;
  const logged = await logsOf(async () => (got = await roomEvents(retryDegenerate(start))));
  assert.deepEqual(got!.events, [{ event: 'error', data: { error: 'answer_failed' } }]);
  assert.equal(got!.finished(), false, 'no citations are validated for a blank answer');
  assert.equal(calls.n, 2);
  assert.deepEqual(logged, [['ask_answer_retried', 'empty'], ['ask_stream_failed', 'DegenerateAnswer']]);
});

test('answerStream refuses a blank answer from any source', async () => {
  async function* blank() {
    yield ' ';
    yield '​';
  }
  let got: Awaited<ReturnType<typeof roomEvents>> | undefined;
  const logged = await logsOf(async () => (got = await roomEvents(blank())));
  assert.deepEqual(got!.events.map((e) => e.event), ['delta', 'delta', 'error']);
  assert.equal(got!.finished(), false);
  assert.deepEqual(logged, [['ask_stream_failed', 'DegenerateAnswer']]);
});

test('retryDegenerate drops a "!!!!" stream unseen and asks once more', async () => {
  const { calls, start } = starts('!'.repeat(400), 'CONFIRMED: Real [doc:a p:2].');
  assert.equal((await collect(retryDegenerate(start))).join(''), 'CONFIRMED: Real [doc:a p:2].');
  assert.equal(calls.n, 2);
});

test('two "!!!!" streams end the answer with an error event, not exclamation marks', async () => {
  const { start } = starts('!'.repeat(64), ' !!! '.repeat(20));
  const out = sseParser().push(await new Response(answerStream(retryDegenerate(start), () => ({ citations: [], dontKnow: false }))).text());
  assert.deepEqual(out, [{ event: 'error', data: { error: 'answer_failed' } }]);
});

test('an opening event is framed before the first delta', async () => {
  const parser = sseParser();
  const body = answerStream(fixedText('hi'), () => ({ citations: [], dontKnow: false }), { event: 'reading', data: { documents: 3, pages: 5 } });
  const got = [...parser.push(await new Response(body).text()), ...parser.end()];
  assert.deepEqual(got.map((e) => e.event), ['reading', 'delta', 'citations', 'done']);
  assert.deepEqual(got[0]!.data, { documents: 3, pages: 5 });
});

/** Every delta and the generator's return value (the stop reason). */
async function drain<R>(it: AsyncGenerator<string, R>): Promise<{ text: string; stop: R }> {
  let text = '';
  for (let next = await it.next(); ; next = await it.next()) {
    if (next.done) return { text, stop: next.value };
    text += next.value;
  }
}

test('modelDeltas returns the stop reason; the closing empty `response` frame adds no text', async () => {
  for (const stop of ['length', 'stop']) {
    assert.deepEqual(await drain(modelDeltas(modelSse('READ: Half an ans', 4, stop))), { text: 'READ: Half an ans', stop }, stop);
  }
  assert.deepEqual(await drain(modelDeltas(modelSse('No ending frame', 4))), { text: 'No ending frame', stop: null });
});

test('gpt-oss sends finish_reason beside its last piece of content: both are read', async () => {
  const raw =
    'data: {"choices":[{"delta":{"reasoning":"r","reasoning_content":"r"},"finish_reason":null}]}\n\n' +
    'data: {"choices":[{"delta":{"content":"Cut her"},"finish_reason":null}]}\n\n' +
    'data: {"choices":[{"delta":{"content":"e"},"finish_reason":"length","stop_reason":null}]}\n\n' +
    'data: {"response":"","usage":{"completion_tokens":300}}\n\n' +
    'data: [DONE]\n\n';
  assert.deepEqual(await drain(modelDeltas(bytes(raw, 9))), { text: 'Cut here', stop: 'length' });
});

test('an answer cut at max_tokens ends with done truncated, its citations still validated, the reason logged alone', async () => {
  const cut = 'READ: The meeting happened [doc:a p:2]. Then the cooks vot';
  const cite = { id: 'a', page: 2, name: 'A.pdf', control_seq: 7, quote: null };
  let seen = '';
  const events: SseEvent[] = [];
  const logged = await logsOf(async () => {
    const parser = sseParser();
    const body = answerStream(retryDegenerate(async () => modelSse(cut, 3, 'length')), (answer) => ((seen = answer), { citations: [cite], dontKnow: false }));
    events.push(...parser.push(await new Response(body).text()), ...parser.end());
  });
  assert.equal(seen, cut, 'the text that arrived is what gets validated');
  assert.deepEqual(events.at(-2), { event: 'citations', data: { citations: [cite] } });
  assert.deepEqual(events.at(-1), { event: 'done', data: { dontKnow: false, truncated: true } });
  assert.doesNotMatch(JSON.stringify(events), /hidden reasoning/, 'reasoning is never forwarded');
  assert.deepEqual(logged, [['ask_answer_stopped', 'length']], 'logs the reason only, never text');
});

test('a finished answer keeps its done unchanged and logs nothing', async () => {
  let got: Awaited<ReturnType<typeof roomEvents>> | undefined;
  const logged = await logsOf(async () => (got = await roomEvents(retryDegenerate(async () => modelSse('READ: Whole [doc:a p:1].', 5, 'stop')))));
  assert.deepEqual(got!.events.at(-1), { event: 'done', data: { dontKnow: false } });
  assert.deepEqual(logged, []);
});

test('the retried stream decides: a blank first call cut at max_tokens, then a cut answer, ends truncated', async () => {
  const answers = [modelSse('', 3, 'length'), modelSse('CONFIRMED: Part [doc:a p:1]. And', 3, 'length')];
  let got: Awaited<ReturnType<typeof roomEvents>> | undefined;
  const logged = await logsOf(async () => (got = await roomEvents(retryDegenerate(async () => answers.shift()!))));
  assert.deepEqual(got!.events.at(-1), { event: 'done', data: { dontKnow: false, truncated: true } });
  assert.deepEqual(logged, [['ask_answer_retried', 'empty'], ['ask_answer_stopped', 'length']]);
});

test('any other stop reason is logged as its short word, or "other", and is not called truncated', async () => {
  for (const [stop, logs] of [['content_filter', 'content_filter'], ['Stop: see <text of the answer>', 'other']] as const) {
    let got: Awaited<ReturnType<typeof roomEvents>> | undefined;
    const logged = await logsOf(async () => (got = await roomEvents(modelDeltas(modelSse('Some text.', 4, stop)))));
    assert.deepEqual(got!.events.at(-1), { event: 'done', data: { dontKnow: false } }, stop);
    assert.deepEqual(logged, [['ask_answer_stopped', logs]], stop);
  }
});

test('a reader that leaves mid-answer closes the model stream, so its spend can settle (spend.ts tapUsage)', async () => {
  let cancelled = false;
  const source = modelSse('A long enough answer to leave half way through.', 6);
  const reader = source.getReader();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    cancel() {
      cancelled = true;
    },
  });
  const deltas = retryDegenerate(async () => stream);
  assert.equal((await deltas.next()).done, false);
  await deltas.return(null);
  assert.equal(cancelled, true);
});
