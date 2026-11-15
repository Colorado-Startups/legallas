// SPDX-License-Identifier: Apache-2.0
// The room's own model host (ask-host.ts) against a fake fetch: never a live call. ASK_HOST is read strictly, the shared
// gate (ask-gate.ts) keeps it closed until every condition holds, OpenRouter always gets its zero-data-retention routing,
// and a failed host carries its status only, never its URL, its error body or the key.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_TOKENS } from './ask.ts';
import { modelDeltas } from './ask-stream.ts';
import { ChatRefused, ChatUnavailable, type Fetcher } from './ask-chat.ts';
import {
  chatUrl,
  HOST_BODY_CHARS,
  HOST_MAX_TOKENS,
  hostChat,
  hostConfig,
  hostGate,
  hostInput,
  isOpenRouter,
  openrouterZdr,
  RESERVED,
} from './ask-host.ts';
import { HOST_CHAT_URL, HOST_KEY, HOST_ON, hostSse } from './ask-host-fixtures.ts';
import { readWranglerConfig } from './wrangler-config.ts';

const MESSAGES = [
  { role: 'system' as const, content: 'Rules.' },
  { role: 'user' as const, content: 'Question from counsel:\nWhen?' },
];
const TARGET = { url: HOST_CHAT_URL, model: HOST_ON.model, body: {} };

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

// --- The room config -----------------------------------------------------------------------------------------

test('ASK_HOST is read strictly: the shared fields as for Groq, an https URL, a model name and optional extra fields', () => {
  assert.deepEqual(hostConfig(HOST_ON), { ...HOST_ON, url: HOST_CHAT_URL, body: {} });
  assert.deepEqual(hostConfig(JSON.stringify(HOST_ON)), { ...HOST_ON, url: HOST_CHAT_URL, body: {} }, 'a JSON string, as a dashboard var would be');
  const loose = hostConfig({ ...HOST_ON, enabled: 'true', zdr_confirmed: 1, eval_runs: ['10000000002', 'abc'] });
  assert.deepEqual([loose.enabled, loose.zdr_confirmed, loose.eval_runs], [false, false, ['10000000002']]);
  for (const bad of [undefined, null, '', '{', [], 42]) {
    assert.deepEqual(hostConfig(bad), { enabled: false, zdr_confirmed: false, eval_runs: [], url: null, model: null, body: {} }, String(bad));
  }
});

test('the URL: https only, a base URL or a whole chat completions URL, never credentials, a query or a fragment', () => {
  assert.equal(chatUrl('https://models.example.com/v1'), HOST_CHAT_URL);
  assert.equal(chatUrl(' https://models.example.com/v1/ '), HOST_CHAT_URL);
  assert.equal(chatUrl('https://models.example.com/v1/chat/completions'), HOST_CHAT_URL);
  assert.equal(chatUrl('https://models.example.com'), 'https://models.example.com/chat/completions');
  for (const bad of ['', 'models.example.com/v1', 'http://models.example.com/v1', 'https://user:pass@models.example.com/v1', 'https://models.example.com/v1?key=x', 'https://models.example.com/v1#x', 'ftp://models.example.com', 42, null]) {
    assert.equal(chatUrl(bad), null, String(bad));
  }
});

test('the model name and extra fields: anything unusable is null, which keeps the gate closed', () => {
  assert.equal(hostConfig({ ...HOST_ON, model: 'meta-llama/llama-4-scout:nitro' }).model, 'meta-llama/llama-4-scout:nitro');
  assert.equal(hostConfig({ ...HOST_ON, model: 'accounts/example/models/open-model-70b' }).model, 'accounts/example/models/open-model-70b');
  for (const model of ['', '   ', 'a b', '<script>', 'https://models.example.com/v1', 'x'.repeat(201), 7]) assert.equal(hostConfig({ ...HOST_ON, model }).model, null, String(model));
  assert.deepEqual(hostConfig({ ...HOST_ON, body: { provider: { only: ['example-provider'] } } }).body, { provider: { only: ['example-provider'] } });
  for (const body of [null, 'x', [], { provider: 'x'.repeat(HOST_BODY_CHARS) }, ...RESERVED.map((field) => ({ [field]: 1 }))]) {
    assert.equal(hostConfig({ ...HOST_ON, body }).body, null, JSON.stringify(body)?.slice(0, 40));
  }
});

// --- The gate --------------------------------------------------------------------------------------------------

test('the shared gate: the host opens only when enabled, ZDR confirmed, an eval run named, usable, not local, and keyed', () => {
  const key = { LEGALLAS_ASK_HOST_API_KEY: HOST_KEY };
  assert.deepEqual(hostGate({ ...key }), { open: false, reason: 'off' });
  assert.deepEqual(hostGate({ ...key, ASK_HOST: { ...HOST_ON, enabled: false } }), { open: false, reason: 'off' });
  assert.deepEqual(hostGate({ ...key, ASK_HOST: { ...HOST_ON, zdr_confirmed: false } }), { open: false, reason: 'zdr_unconfirmed' });
  assert.deepEqual(hostGate({ ...key, ASK_HOST: { ...HOST_ON, eval_runs: [] } }), { open: false, reason: 'no_eval' }, 'a backend that has not passed its release gate stays closed');
  assert.deepEqual(hostGate({ ...key, ASK_HOST: { ...HOST_ON, eval_runs: ['not-a-run'] } }), { open: false, reason: 'no_eval' });
  assert.deepEqual(hostGate({ ...key, ASK_HOST: { ...HOST_ON, url: 'http://models.example.com/v1' } }), { open: false, reason: 'bad_host' });
  assert.deepEqual(hostGate({ ...key, ASK_HOST: { ...HOST_ON, model: '' } }), { open: false, reason: 'bad_host' });
  assert.deepEqual(hostGate({ ...key, ASK_HOST: { ...HOST_ON, body: { model: 'other' } } }), { open: false, reason: 'bad_host' });
  assert.deepEqual(hostGate({ ...key, ASK_HOST: HOST_ON }, { local: true }), { open: false, reason: 'local' });
  assert.deepEqual(hostGate({ ASK_HOST: HOST_ON }), { open: false, reason: 'no_key' }, 'a missing key keeps it closed');
  assert.deepEqual(hostGate({ ASK_HOST: HOST_ON, LEGALLAS_ASK_HOST_API_KEY: '  ' }), { open: false, reason: 'no_key' });
  // Groq's key never opens the host.
  assert.deepEqual(hostGate({ ASK_HOST: HOST_ON, LEGALLAS_ASK_GROQ_API_KEY: 'groq-key' } as never), { open: false, reason: 'no_key' });
  assert.deepEqual(hostGate({ ASK_HOST: HOST_ON, LEGALLAS_ASK_HOST_API_KEY: ` ${HOST_KEY} ` }), { open: true, apiKey: HOST_KEY, url: HOST_CHAT_URL, model: HOST_ON.model, body: {} });
});

test('the config ships the host off: Ask runs on Workers AI until a room describes, confirms and evaluates a host', () => {
  const { raw, config } = readWranglerConfig('wrangler');
  assert.equal(raw.includes('LEGALLAS_ASK_HOST_API_KEY"'), false, 'the key is a secret, never a var');
  // A room's own file may not list ASK_HOST (off), or may have turned a host on: the gate opens only with every condition.
  const value = config.vars.ASK_HOST;
  const host = hostConfig(value);
  const gate = hostGate({ ASK_HOST: value, LEGALLAS_ASK_HOST_API_KEY: 'k' });
  const usable = host.url !== null && host.model !== null && host.body !== null;
  assert.equal(gate.open, host.enabled && host.zdr_confirmed && host.eval_runs.length > 0 && usable);
  if (!host.enabled) assert.deepEqual(gate, { open: false, reason: 'off' });
  // The example a new room copies ships it off and empty.
  const example = readWranglerConfig('wrangler', true).config.vars.ASK_HOST;
  assert.deepEqual(example, { enabled: false, zdr_confirmed: false, eval_runs: [], url: '', model: '' });
  assert.deepEqual(hostGate({ ASK_HOST: example, LEGALLAS_ASK_HOST_API_KEY: 'k' }), { open: false, reason: 'off' });
});

// --- The request -----------------------------------------------------------------------------------------------

test("the request body: the room's model, the messages, a stream and Ask's own completion ceiling", () => {
  assert.equal(HOST_MAX_TOKENS, MAX_TOKENS);
  assert.deepEqual(hostInput(TARGET, MESSAGES), { model: HOST_ON.model, messages: MESSAGES, stream: true, max_tokens: 16_384 });
  const extra = [{ role: 'user' as const, content: 'q', name: 'x' } as (typeof MESSAGES)[number]];
  assert.deepEqual(hostInput(TARGET, extra).messages, [{ role: 'user', content: 'q' }], 'only role and content travel');
  assert.equal(hostInput(TARGET, MESSAGES, { maxTokens: 900 }).max_tokens, 900);
  // Extra fields travel, and nothing is added for a host that is not OpenRouter.
  assert.deepEqual(hostInput({ ...TARGET, body: { temperature: 0.2 } }, MESSAGES), { temperature: 0.2, model: HOST_ON.model, messages: MESSAGES, stream: true, max_tokens: 16_384 });
});

test('on OpenRouter the request always asks for zero-data-retention endpoints only, whatever the room wrote', () => {
  const url = 'https://openrouter.ai/api/v1/chat/completions';
  assert.equal(isOpenRouter(url), true);
  assert.equal(isOpenRouter('https://eu.openrouter.ai/api/v1/chat/completions'), true);
  assert.equal(isOpenRouter('https://openrouter.ai.example.com/v1/chat/completions'), false);
  assert.deepEqual(hostInput({ url, model: 'example-org/open-model-70b', body: {} }, MESSAGES).provider, { zdr: true, data_collection: 'deny' });
  const pinned = hostInput({ url, model: 'm', body: { provider: { only: ['example-provider'], allow_fallbacks: false, zdr: false, data_collection: 'allow' } } }, MESSAGES);
  assert.deepEqual(pinned.provider, { only: ['example-provider'], allow_fallbacks: false, zdr: true, data_collection: 'deny' });
  assert.deepEqual(openrouterZdr('x'), { zdr: true, data_collection: 'deny' });
});

test('a call posts the body to the chat URL with the key as a bearer token; reasoning and comment lines never show', async () => {
  const { fetcher, calls } = fakeFetch(() => new Response(hostSse('- READ: It was Tuesday [doc:D1 p:2].'), { status: 200, headers: { 'content-type': 'text/event-stream' } }));
  const stream = await hostChat(fetcher, { url: HOST_CHAT_URL, apiKey: ` ${HOST_KEY} ` }, hostInput(TARGET, MESSAGES));
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, HOST_CHAT_URL);
  assert.equal(calls[0]!.init.method, 'POST');
  assert.equal((calls[0]!.init.headers as Record<string, string>).Authorization, `Bearer ${HOST_KEY}`);
  assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), hostInput(TARGET, MESSAGES));
  assert.ok(calls[0]!.init.signal instanceof AbortSignal, 'every call has a time limit');
  assert.deepEqual(await text(stream), { text: '- READ: It was Tuesday [doc:D1 p:2].', stop: 'stop' });
});

test('a failed host carries its status only: never its error body, its URL or the key', async () => {
  for (const status of [400, 401, 402, 403, 404, 413, 500, 502, 503]) {
    const { fetcher, calls } = fakeFetch(() => new Response(`{"error":{"message":"the prompt said: secret case text, key ${HOST_KEY}"}}`, { status }));
    await assert.rejects(hostChat(fetcher, { url: HOST_CHAT_URL, apiKey: HOST_KEY }, hostInput(TARGET, MESSAGES)), (error: unknown) => {
      assert.ok(error instanceof ChatUnavailable);
      assert.equal(error.message, `host_http_${status}`);
      return true;
    });
    assert.equal(calls.length, 1);
  }
  const refused = fakeFetch(() => new Response('{}', { status: 429, headers: { 'retry-after': '5' } }));
  await assert.rejects(hostChat(refused.fetcher, { url: HOST_CHAT_URL, apiKey: HOST_KEY }, hostInput(TARGET, MESSAGES)), (error: unknown) => error instanceof ChatRefused && error.message === 'host_http_429' && error.retryAfter === 5);
  assert.equal(refused.calls.length, 1, 'a 429 is never retried');
  const down: Fetcher = async () => {
    throw new Error(`getaddrinfo ENOTFOUND models.example.com with ${HOST_KEY}`);
  };
  await assert.rejects(hostChat(down, { url: HOST_CHAT_URL, apiKey: HOST_KEY }, hostInput(TARGET, MESSAGES)), (error: unknown) => error instanceof ChatUnavailable && error.message === 'host_fetch_failed');
});

test('without a key nothing is sent', async () => {
  const { fetcher, calls } = fakeFetch(() => new Response(hostSse('x'), { status: 200 }));
  await assert.rejects(hostChat(fetcher, { url: HOST_CHAT_URL, apiKey: ' ' }, hostInput(TARGET, MESSAGES)), (error: unknown) => error instanceof ChatUnavailable && error.message === 'host_no_key');
  assert.equal(calls.length, 0);
});
