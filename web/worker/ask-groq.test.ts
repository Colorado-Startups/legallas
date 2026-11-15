// SPDX-License-Identifier: Apache-2.0
// The Groq client (ask-groq.ts) against a fake fetch: never a live call. One request per answer, a 429 is a refusal that
// is never retried, errors carry the status only, and Groq's OpenAI-style stream reads like Workers AI's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelDeltas } from './ask-stream.ts';
import { groqSse } from './ask-groq-fixtures.ts';
import {
  GROQ_CHAT_URL,
  GROQ_LIMITS,
  GROQ_MAX_COMPLETION_TOKENS,
  GROQ_PROMPT_CHARS,
  GROQ_PROMPT_TOKENS,
  GROQ_TOKEN_MARGIN,
  groqChat,
  groqInput,
  GroqRefused,
  groqRequestTokens,
  GroqUnavailable,
  retryAfterSeconds,
  type Fetcher,
} from './ask-groq.ts';

const MESSAGES = [
  { role: 'system' as const, content: 'Rules.' },
  { role: 'user' as const, content: 'Question from counsel:\nWhen?' },
];

interface Call {
  url: string;
  init: RequestInit;
}

function fakeFetch(respond: () => Response | Promise<Response>): { fetcher: Fetcher; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    fetcher: async (url, init) => {
      calls.push({ url, init });
      return respond();
    },
  };
}

async function text(stream: ReadableStream<Uint8Array>): Promise<{ text: string; stop: string | null }> {
  let out = '';
  const deltas = modelDeltas(stream);
  for (let next = await deltas.next(); ; next = await deltas.next()) {
    if (next.done) return { text: out, stop: next.value };
    out += next.value;
  }
}

test("one request fits Groq's free minute: prompt budget, completion ceiling and margin add up to 8,000 tokens", () => {
  assert.equal(GROQ_LIMITS.tokensPerMinute, 8_000);
  assert.equal(GROQ_PROMPT_TOKENS + GROQ_MAX_COMPLETION_TOKENS + GROQ_TOKEN_MARGIN, GROQ_LIMITS.tokensPerMinute);
  const full = groqInput([
    { role: 'system', content: 'r'.repeat(GROQ_PROMPT_CHARS / 2) },
    { role: 'user', content: 'u'.repeat(GROQ_PROMPT_CHARS / 2) },
  ]);
  assert.ok(groqRequestTokens(full) <= GROQ_LIMITS.tokensPerMinute - GROQ_TOKEN_MARGIN);
});

test('the request body: the model, a stream, the completion ceiling, medium effort, and no reasoning sent back', () => {
  assert.deepEqual(groqInput(MESSAGES), {
    model: 'openai/gpt-oss-120b',
    messages: MESSAGES,
    stream: true,
    max_completion_tokens: 2_048,
    reasoning_effort: 'medium',
    include_reasoning: false,
  });
  // Only role and content travel: nothing else a message object may carry.
  const extra = [{ role: 'user' as const, content: 'q', name: 'x' } as (typeof MESSAGES)[number]];
  assert.deepEqual(groqInput(extra).messages, [{ role: 'user', content: 'q' }]);
  assert.equal('reasoning_effort' in groqInput(MESSAGES, { effort: null }), false);
  assert.equal(groqInput(MESSAGES, { effort: 'low', maxCompletionTokens: 900 }).max_completion_tokens, 900);
});

test('a call posts the body to the chat endpoint with the key as a bearer token, and hands back the stream', async () => {
  const { fetcher, calls } = fakeFetch(() => new Response(groqSse('- READ: It was Tuesday [doc:D1 p:2].'), { status: 200, headers: { 'content-type': 'text/event-stream' } }));
  const stream = await groqChat(fetcher, ' key-123 ', groqInput(MESSAGES));
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, GROQ_CHAT_URL);
  assert.equal(calls[0]!.url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(calls[0]!.init.method, 'POST');
  const headers = calls[0]!.init.headers as Record<string, string>;
  assert.equal(headers.Authorization, 'Bearer key-123');
  assert.equal(headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), groqInput(MESSAGES));
  assert.ok(calls[0]!.init.signal instanceof AbortSignal, 'every call has a time limit');
  assert.deepEqual(await text(stream), { text: '- READ: It was Tuesday [doc:D1 p:2].', stop: 'stop' });
});

test("Groq's stream reads like Workers AI's: a cut answer's finish_reason is the stop reason", async () => {
  const { fetcher } = fakeFetch(() => new Response(groqSse('partial', 'length'), { status: 200 }));
  assert.deepEqual(await text(await groqChat(fetcher, 'k', groqInput(MESSAGES))), { text: 'partial', stop: 'length' });
});

test('a 429 is a refusal with retry-after, made once and never retried', async () => {
  const { fetcher, calls } = fakeFetch(() => new Response('{"error":{"message":"Rate limit reached for model openai/gpt-oss-120b on tokens per minute"}}', { status: 429, headers: { 'retry-after': '7' } }));
  await assert.rejects(groqChat(fetcher, 'k', groqInput(MESSAGES)), (error: unknown) => {
    assert.ok(error instanceof GroqRefused);
    assert.equal(error.retryAfter, 7);
    assert.equal(error.message, 'groq_http_429');
    return true;
  });
  assert.equal(calls.length, 1);
});

test("any other failure carries the status only, never Groq's error body (it may quote the prompt)", async () => {
  for (const status of [400, 401, 403, 413, 500, 503]) {
    const { fetcher, calls } = fakeFetch(() => new Response('{"error":{"message":"the prompt said: secret case text"}}', { status }));
    await assert.rejects(groqChat(fetcher, 'k', groqInput(MESSAGES)), (error: unknown) => {
      assert.ok(error instanceof GroqUnavailable);
      assert.equal(error.message, `groq_http_${status}`);
      return true;
    });
    assert.equal(calls.length, 1);
  }
});

test("a fetch that throws becomes groq_fetch_failed, without the thrown error's text", async () => {
  const fetcher: Fetcher = async () => {
    throw new Error('connect ECONNREFUSED with the body: secret case text');
  };
  await assert.rejects(groqChat(fetcher, 'k', groqInput(MESSAGES)), (error: unknown) => error instanceof GroqUnavailable && error.message === 'groq_fetch_failed');
});

test('a 200 with no body is unavailable, not an empty answer', async () => {
  const { fetcher } = fakeFetch(() => new Response(null, { status: 200 }));
  await assert.rejects(groqChat(fetcher, 'k', groqInput(MESSAGES)), (error: unknown) => error instanceof GroqUnavailable && error.message === 'groq_http_200');
});

test('without a key nothing is sent', async () => {
  const { fetcher, calls } = fakeFetch(() => new Response(groqSse('x'), { status: 200 }));
  await assert.rejects(groqChat(fetcher, '  ', groqInput(MESSAGES)), (error: unknown) => error instanceof GroqUnavailable && error.message === 'groq_no_key');
  assert.equal(calls.length, 0);
});

test('retry-after is read as whole seconds, and anything else as absent', () => {
  assert.equal(retryAfterSeconds('7'), 7);
  assert.equal(retryAfterSeconds('2.2'), 3);
  assert.equal(retryAfterSeconds('0'), 1);
  assert.equal(retryAfterSeconds(null), null);
  assert.equal(retryAfterSeconds('Wed, 21 Oct 2026 07:28:00 GMT'), null);
});
