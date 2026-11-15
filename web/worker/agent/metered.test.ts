// SPDX-License-Identifier: Apache-2.0
// The metered AI binding's call rules (worker/spend.ts, plan D10), as the research agent drives it through createAI
// (model.ts): only @cf/ models, never an AI Gateway option, and only an abort signal forwarded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAI, type ProviderGatewaySettings } from 'agents/models/ai-sdk';
import { generateText } from 'ai';
import { used } from '../spend.ts';
import { forwardedOptions, meteredAi, ModelRefused } from '../spend.ts';
import { testDb } from '../sqlite-d1.ts';
import { directBinding, directOptions, rawAnswer, stepModel } from './model.ts';

const GLM = '@cf/zai-org/glm-5.3-flash';
const NOV = new Date('2026-11-05T12:00:00Z');

/** A binding that records each call's arguments and answers like Workers AI's chat models. */
function recordingAi() {
  const calls: { model: string; input: Record<string, unknown>; args: number; options: unknown }[] = [];
  const ai = {
    async run(model: string, input: Record<string, unknown>, ...rest: unknown[]) {
      calls.push({ model, input, args: 2 + rest.length, options: rest[0] });
      return { choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 2 } };
    },
  };
  return { calls, ai: ai as unknown as Ai };
}

test('only an abort signal is forwarded; no signal keeps the two-argument call quick Ask pins', () => {
  const signal = new AbortController().signal;
  assert.deepEqual(forwardedOptions(GLM, { gateway: undefined, signal }), { signal });
  assert.equal(forwardedOptions(GLM, { gateway: undefined, signal: undefined }), undefined);
  assert.equal(forwardedOptions(GLM), undefined);
  // Anything else a caller adds (tags, headers, raw responses) never reaches the binding.
  const kept = forwardedOptions(GLM, { signal, tags: ['x'], extraHeaders: { a: 'b' }, returnRawResponse: true, prefix: 'p' });
  assert.deepEqual(kept, { signal });
});

test('a gateway value or a model outside Workers AI is refused before anything is held', async () => {
  const { db } = testDb();
  const { calls, ai } = recordingAi();
  const metered = meteredAi(ai, db, () => NOV);
  const run = metered.run as unknown as (model: string, input: unknown, options?: unknown) => Promise<unknown>;
  for (const gateway of [{ id: 'legallas' }, 'legallas', null, false, 0]) {
    await assert.rejects(run(GLM, { messages: [] }, { gateway }), ModelRefused, JSON.stringify(gateway));
  }
  for (const model of ['openai/gpt-5', 'anthropic/claude', '@hf/thebloke/x', 'cf/zai-org/glm-5.3-flash', ' @cf/x']) {
    await assert.rejects(run(model, { messages: [] }), ModelRefused, model);
  }
  await assert.rejects(run(GLM, { messages: [] }, 'options'), ModelRefused);
  assert.equal(calls.length, 0, 'nothing reached the binding');
  assert.equal(await used(db, 'neurons', '2026-11-05'), 0, 'and nothing was held');
});

test('createAI over the metered binding: the model is a provider object and the binding sees only a signal', async () => {
  const { db } = testDb();
  const { calls, ai } = recordingAi();
  const model = stepModel(meteredAi(ai, db, () => NOV), GLM);
  const controller = new AbortController();
  const result = await generateText({ model, prompt: 'q', maxOutputTokens: 64, maxRetries: 0, abortSignal: controller.signal });
  assert.equal(result.text, 'ok');
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.model, GLM);
  assert.equal(calls[0]!.args, 3);
  assert.deepEqual(Object.keys(calls[0]!.options as object), ['signal']);
  assert.equal(calls[0]!.input.max_tokens, 64, 'maxOutputTokens arrives as max_tokens, which the meter reads');
  assert.ok((await used(db, 'neurons', '2026-11-05')) > 0, 'the call was metered');

  // Without an abort signal createAI passes `{ gateway: { id: 'default' }, returnRawResponse: true, signal: undefined }`:
  // a plain call.
  await generateText({ model, prompt: 'q', maxOutputTokens: 64, maxRetries: 0 });
  assert.equal(calls[1]!.args, 2);
});

test("createAI's own default gateway is dropped; any other gateway setting is refused, never silently stripped", async () => {
  const signal = new AbortController().signal;
  assert.deepEqual(directOptions({ gateway: { id: 'default' }, returnRawResponse: true, signal }), { signal });
  assert.equal(directOptions({ gateway: { id: 'default' }, returnRawResponse: true, signal: undefined }), undefined);
  assert.equal(directOptions(undefined), undefined);
  for (const gateway of [{ id: 'legallas' }, { id: 'default', collectLog: true }, { id: 'default', cacheTtl: 60 }, 'default', {}, null, false, 0]) {
    assert.throws(() => directOptions({ gateway, signal }), ModelRefused, JSON.stringify(gateway));
  }
  assert.throws(() => directOptions('options'), ModelRefused);

  const { db } = testDb();
  const { calls, ai } = recordingAi();
  const settings: ProviderGatewaySettings[] = [
    { id: 'legallas' },
    { gateway: 'legallas' },
    { gateway: { id: 'default', collectLog: true } },
    { cacheTtl: 60 },
    { metadata: { a: 'b' } },
  ];
  for (const setting of settings) {
    const model = createAI({ binding: directBinding(meteredAi(ai, db, () => NOV)), ...setting })(GLM);
    await assert.rejects(generateText({ model, prompt: 'q', maxOutputTokens: 64, maxRetries: 0 }), (error: unknown) => {
      // createAI wraps it in a CloudflareAIError whose cause is ours.
      const text = error instanceof Error ? `${error.name} ${error.message} ${String((error as { cause?: unknown }).cause)}` : String(error);
      return /ModelRefused/.test(text);
    }, JSON.stringify(setting));
  }
  assert.equal(calls.length, 0);
  assert.equal(await used(db, 'neurons', '2026-11-05'), 0, 'and nothing was held');
});

test('an answer goes back to createAI as the raw Response it asks for: JSON, or a stream as server-sent events', async () => {
  const json = rawAnswer({ choices: [], usage: { prompt_tokens: 1 } });
  assert.equal(json.headers.get('content-type'), 'application/json');
  assert.deepEqual(await json.json(), { choices: [], usage: { prompt_tokens: 1 } });
  const stream = rawAnswer(new Response('data: [DONE]\n\n').body);
  assert.equal(stream.headers.get('content-type'), 'text/event-stream');
  assert.equal(await stream.text(), 'data: [DONE]\n\n');
});
