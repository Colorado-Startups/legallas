// SPDX-License-Identifier: Apache-2.0
// The research client's room requests and HTTP fallback (worker/agent/protocol.ts): same-origin /api/research paths
// only, a new thread made and named before its first turn, the SSE stream read as UI message chunks, and every
// refusal turned into a known code. fetch is stubbed; nothing leaves the process.
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RESEARCH_PATHS } from '../../worker/agent/protocol.ts';
import type { SseEvent } from './chat-sse.ts';
import { askResearch, ResearchError } from './research-client.ts';
import { httpTurn, offTurn, roomTransport } from './research-transport.ts';
import { closeCode, PARTS } from './research-wire.ts';

type Call = { url: string; method: string; body: string | null; headers: Record<string, string> };
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Stubs fetch with `answer` per call and records each request. */
function stub(answer: (call: Call) => Response): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    const call = { url, method: init.method ?? 'GET', body: (init.body as string | undefined) ?? null, headers: init.headers as Record<string, string> };
    calls.push(call);
    return answer(call);
  }) as typeof fetch;
  return calls;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const sse = (chunks: unknown[]) => new Response(`${chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('')}data: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });

const ANSWER = [
  { type: 'start' },
  { type: PARTS.progress, data: { steps: 2, searches: 1, documents: 2, pages: 5 } },
  { type: 'text-delta', id: 'x', delta: '- CONFIRMED: Roe confirmed the order [doc:doc-a p.1].' },
  { type: PARTS.thread, data: { id: 'th1', title: 'Who confirmed the order?' } },
  { type: PARTS.citations, data: { citations: [{ id: 'doc-a', page: 1, name: 'Invoice.pdf', control_seq: 231, quote: null }] } },
  { type: PARTS.verdict, data: { dontKnow: false } },
  { type: 'finish' },
];

test('a first question makes a thread, names it, then streams the HTTP fallback turn', async () => {
  const calls = stub((call) => (call.method === 'POST' && call.url === RESEARCH_PATHS.threads ? json({ id: 'th1' }, 201) : sse(ANSWER)));
  const named: string[] = [];
  const { turn, threadId } = await askResearch(roomTransport(httpTurn), null, 'Who confirmed the order?', {
    thread: (t) => named.push(`${t.id}:${t.title}`),
  });
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), ['POST /api/research/threads', 'POST /api/research/threads/th1/turn']);
  assert.equal(calls[1]!.body, JSON.stringify({ question: 'Who confirmed the order?' }), 'only the question travels, never history');
  assert.equal(calls[1]!.headers['X-Requested-With'], 'XMLHttpRequest', 'an ended sign-in answers 401, not a login page');
  assert.equal(threadId, 'th1');
  assert.deepEqual(named, ['th1:', 'th1:Who confirmed the order?']);
  assert.equal(turn.failed, false);
  assert.deepEqual(turn.steps, { searches: 1, pages: 5 });
  assert.equal(turn.citations.length, 1);
});

test('a follow-up goes straight to its thread', async () => {
  const calls = stub(() => sse(ANSWER));
  await askResearch(roomTransport(httpTurn), 'th1', 'And when?');
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), ['POST /api/research/threads/th1/turn']);
});

test('a refusal before the stream is its code; a 404 thread is missing; a 401 ends the session', async () => {
  const errors: string[] = [];
  stub(() => json({ error: 'daily_limit' }, 429));
  await askResearch(roomTransport(httpTurn), 'th1', 'Q?', { error: (m) => errors.push(m) });
  assert.match(errors[0]!, /question limit/);
  stub(() => json({ error: 'nope' }, 404));
  await assert.rejects(roomTransport(httpTurn).open('th1'), { code: 'thread_missing' });
  stub(() => new Response(null, { status: 401 }));
  await assert.rejects(roomTransport(httpTurn).threads(), { code: 'session_ended' });
  stub(() => json({ error: '<script>alert(1)</script>' }, 500));
  await assert.rejects(roomTransport(httpTurn).remove('th1'), { code: 'research_unavailable' });
  globalThis.fetch = (async () => {
    throw new TypeError('network');
  }) as typeof fetch;
  await assert.rejects(roomTransport(httpTurn).threads(), (err) => err instanceof ResearchError && err.code === 'connection_lost');
});

test('the list, a thread and delete use the protocol paths', async () => {
  const calls = stub((call) => {
    if (call.method === 'DELETE') return new Response(null, { status: 204 });
    if (call.url === RESEARCH_PATHS.threads) {
      return json([{ id: 'th1', title: 'First', updatedAt: '2026-10-20T00:00:00.000Z', expiresAt: '2027-01-18T00:00:00.000Z' }]);
    }
    return json([{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'Q?' }] }]);
  });
  const transport = roomTransport(httpTurn);
  assert.deepEqual(await transport.threads(), [{ id: 'th1', title: 'First', updatedAt: '2026-10-20T00:00:00.000Z', expiresAt: '2027-01-18T00:00:00.000Z' }]);
  assert.deepEqual((await transport.open('th1')).map((t) => t.question), ['Q?']);
  await transport.remove('th1');
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), ['GET /api/research/threads', 'GET /api/research/threads/th1', 'DELETE /api/research/threads/th1']);
  await assert.rejects(transport.open('../admin'), RangeError, 'no path is built from a malformed id');
  assert.equal(calls.length, 3, 'and nothing was fetched for it');
});

test('a create that returns a malformed id never reaches a path', async () => {
  stub(() => json({ id: '../../x' }, 201));
  const errors: string[] = [];
  const { turn } = await askResearch(roomTransport(httpTurn), null, 'Q?', { error: (m) => errors.push(m) });
  assert.equal(turn.failed, true);
  assert.equal(errors.length, 1);
});

test('the room closing a socket with its own codes is final and says why', () => {
  assert.equal(closeCode(4401), 'session_ended');
  assert.equal(closeCode(4403), 'forbidden');
  assert.equal(closeCode(4503), 'research_off');
  assert.equal(closeCode(4999), 'research_unavailable');
  assert.equal(closeCode(1000), null);
  assert.equal(closeCode(1006), null, 'a dropped connection may reconnect');
});

test('the agents client loads only for a WebSocket turn, never with the transport or the panel', () => {
  const read = (rel: string) => readFileSync(join(import.meta.dirname, rel), 'utf8');
  const statics = (source: string) => [...source.matchAll(/^import\s+(?!type\b)[^;]*?from\s+'([^']+)'/gm)].map((m) => m[1]);
  for (const file of ['research-transport.ts', 'research-panel.ts', 'research-client.ts', 'research-wire.ts', 'research-mode.ts', 'chat.ts', 'chat-drawer.ts']) {
    for (const spec of statics(read(file))) assert.doesNotMatch(spec!, /^agents|^ai$|research-socket/, `${file} imports ${spec} up front`);
  }
  assert.match(read('research-transport.ts'), /await import\('\.\/research-socket\.ts'\)/);
  assert.deepEqual(statics(read('research-socket.ts')).filter((s) => /^agents/.test(s!)), ['agents/chat/transport', 'agents/client']);
});

test('events from a stream reach the turn in order', async () => {
  stub(() => sse(ANSWER));
  const seen: SseEvent['event'][] = [];
  await roomTransport(httpTurn).ask('th1', 'Q?', (e) => seen.push(e.event));
  assert.deepEqual(seen, ['progress', 'delta', 'thread', 'citations', 'done']);
});

test('while research is off, saved threads stay readable and deletable and a question is refused before any request', async () => {
  const calls = stub((call) => (call.method === 'DELETE' ? new Response(null, { status: 204 }) : json([])));
  const transport = roomTransport(offTurn);
  assert.equal(transport.readOnly, true);
  const errors: string[] = [];
  const { turn } = await askResearch(transport, null, 'Q?', { error: (m) => errors.push(m) });
  assert.equal(turn.failed, true);
  assert.match(errors[0]!, /^Research is off in this room; saved threads can still be opened and deleted/);
  assert.equal(calls.length, 0, 'no thread is made and no turn is sent');
  await transport.threads();
  await transport.remove('th1');
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), ['GET /api/research/threads', 'DELETE /api/research/threads/th1']);
  assert.equal(roomTransport(httpTurn).readOnly, undefined);
});
