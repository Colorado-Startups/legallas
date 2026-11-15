// SPDX-License-Identifier: Apache-2.0
// ASK_MOCK is a local-development switch only: localhost AND ASK_MOCK=1, and never in wrangler.jsonc.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sseParser } from '../src/scripts/chat-sse.ts';
import { askBindings, askMockEnabled, MOCK_FAKE_ID, MOCK_GONE_ID } from './ask-mock.ts';
import { askRequest, harness } from './ask-fixtures.ts';
import { handle } from './index.ts';
import { readWranglerConfig } from './wrangler-config.ts';

const at = (url: string) => new Request(url);

test('the mock is on only for ASK_MOCK=1 on a localhost host', () => {
  const on = { ASK_MOCK: '1' };
  assert.equal(askMockEnabled(at('http://localhost:8789/api/ask'), on), true);
  assert.equal(askMockEnabled(at('http://127.0.0.1:8789/api/ask'), on), true);
  assert.equal(askMockEnabled(at('http://[::1]:8789/api/ask'), on), true);
  assert.equal(askMockEnabled(at('https://room.example.com/api/ask'), on), false, 'ignored on the real host');
  assert.equal(askMockEnabled(at('http://localhost.evil.example/api/ask'), on), false);
  assert.equal(askMockEnabled(at('http://localhost:8789/api/ask'), { ASK_MOCK: 'true' }), false, 'only the exact value 1');
  assert.equal(askMockEnabled(at('http://localhost:8789/api/ask'), {}), false);
});

test('off localhost the real bindings are used even with ASK_MOCK=1', () => {
  const { env } = harness({ extraVars: { ASK_MOCK: '1' } });
  const real = askBindings(at('https://room.example.com/api/ask'), env);
  assert.equal(real.AI, env.AI);
  assert.equal(real.SEARCH, env.SEARCH);
  const local = askBindings(at('http://localhost:8789/api/ask'), env);
  assert.notEqual(local.AI, env.AI);
  assert.notEqual(local.SEARCH, env.SEARCH);
});

test('ASK_MOCK is never configured for production', () => {
  const { raw } = readWranglerConfig('wrangler');
  assert.equal(raw.includes('"ASK_MOCK"'), false);
  assert.equal(/ASK_MOCK\s*"?\s*:/.test(raw), false);
});

test('the mock never calls the real bindings and still runs the real filters', async () => {
  const h = harness({ extraVars: { ASK_MOCK: '1' } });
  const text = await (await handle(askRequest({ question: 'What happened?' }), h.env, {} as ExecutionContext)).text();
  assert.equal(h.searches.length, 0);
  assert.equal(h.runs.length, 0);
  const parser = sseParser();
  const events = [...parser.push(text), ...parser.end()];
  const ids = (events.find((e) => e.event === 'citations')!.data as { citations: { id: string }[] }).citations.map((c) => c.id);
  assert.ok(ids.length > 0);
  assert.equal(ids.includes(MOCK_GONE_ID), false, 'a chunk from a removed document is filtered');
  assert.equal(ids.includes(MOCK_FAKE_ID), false, 'a citation that was never retrieved is dropped');
});

test('a mock question containing "cut off" stops halfway at max_tokens, so the room shows the cut-off note locally', async () => {
  const h = harness({ extraVars: { ASK_MOCK: '1' } });
  const ask = async (question: string) => {
    const parser = sseParser();
    const original = console.error;
    console.error = () => undefined;
    try {
      return [...parser.push(await (await handle(askRequest({ question }), h.env, {} as ExecutionContext)).text()), ...parser.end()];
    } finally {
      console.error = original;
    }
  };
  const cut = await ask('Show me an answer that gets cut off.');
  assert.deepEqual(cut.at(-1), { event: 'done', data: { dontKnow: false, truncated: true } });
  assert.ok(cut.some((e) => e.event === 'citations'), 'the text that arrived still gets its citations');
  assert.deepEqual((await ask('What happened?')).at(-1), { event: 'done', data: { dontKnow: false } });
});
