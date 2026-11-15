// SPDX-License-Identifier: Apache-2.0
// The replica's host lane (scripts/ask-replica-host.ts) against a fake fetch: never a live call. A run refuses before
// anything is read or sent unless ASK_HOST records zero data retention and a usable host and the key is set; a 429
// stops the run, never retried; other failures are the answer's error, by status only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { hostInput } from '../worker/ask-host.ts';
import { HOST_CHAT_URL, HOST_KEY, HOST_ON, hostSse } from '../worker/ask-host-fixtures.ts';
import { roomVar } from './ask-replica-groq.ts';
import { HOST_NO_KEY, HOST_NO_ZDR, HOST_STOP_429, HOST_UNUSABLE, HostHalt, HostStop, hostGenerate, hostRunTarget } from './ask-replica-host.ts';
import { parseReplicaArgs, replicaNeed, runLabel } from './ask-replica.ts';
import { streamAnswer } from './ask-replica-runs.ts';
import type { EvalItem } from './ask-eval-score.ts';

const env = { REPLICA_EVAL_HOST_API_KEY: ` ${HOST_KEY} ` };
const MESSAGES = [{ role: 'user' as const, content: 'Question from counsel:\nWhen?' }];

test('a host run needs zero data retention confirmed, a usable host and the key, but not enabled or eval runs', () => {
  const target = hostRunTarget(env, { ...HOST_ON, enabled: false, eval_runs: [] });
  assert.deepEqual(target, { url: HOST_CHAT_URL, model: HOST_ON.model, body: {}, apiKey: HOST_KEY });
  assert.throws(() => hostRunTarget(env, { ...HOST_ON, zdr_confirmed: false }), (error: unknown) => (error as Error).message === HOST_NO_ZDR);
  assert.throws(() => hostRunTarget(env, undefined), (error: unknown) => (error as Error).message === HOST_NO_ZDR);
  assert.throws(() => hostRunTarget(env, { ...HOST_ON, url: 'http://models.example.com/v1' }), (error: unknown) => (error as Error).message === HOST_UNUSABLE);
  assert.throws(() => hostRunTarget(env, { ...HOST_ON, model: '' }), (error: unknown) => (error as Error).message === HOST_UNUSABLE);
  assert.throws(() => hostRunTarget(env, { ...HOST_ON, body: { stream: false } }), (error: unknown) => (error as Error).message === HOST_UNUSABLE);
  assert.throws(() => hostRunTarget({}, HOST_ON), (error: unknown) => (error as Error).message === HOST_NO_KEY);
  assert.throws(() => hostRunTarget({ REPLICA_EVAL_HOST_API_KEY: '  ' }, HOST_ON), (error: unknown) => (error as Error).message === HOST_NO_KEY);
});

test("ASK_HOST is read from the commit's wrangler.jsonc, and the example ships with no host to evaluate", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ask-replica-host-'));
  try {
    const file = path.join(dir, 'wrangler.jsonc');
    await writeFile(file, `{\n  // a comment line\n  "vars": {\n    "ASK_HOST": ${JSON.stringify(HOST_ON)},\n  },\n}\n`);
    assert.deepEqual(roomVar('ASK_HOST', file), HOST_ON);
    assert.equal(roomVar('ASK_GROQ', file), undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  const example = roomVar('ASK_HOST', path.resolve(import.meta.dirname, '..', 'wrangler.example.jsonc'));
  assert.throws(() => hostRunTarget(env, example), (error: unknown) => (error as Error).message === HOST_NO_ZDR);
});

test('a call goes to the host with the key and hands back the stream and its copy', async () => {
  const calls: { url: string; body: unknown }[] = [];
  const generate = hostGenerate(async (url, init) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    return new Response(hostSse('- READ: x [doc:D1 p:1].'), { status: 200 });
  }, { url: HOST_CHAT_URL, apiKey: HOST_KEY }, new HostHalt());
  const input = hostInput({ url: HOST_CHAT_URL, model: HOST_ON.model, body: {} }, MESSAGES);
  const { stream, sse } = await generate(input);
  await stream.cancel();
  // The replica reads the host's stream as it reads Groq's: the answer text and why it stopped, reasoning left out.
  assert.deepEqual(streamAnswer(await sse), { text: '- READ: x [doc:D1 p:1].', finish: 'stop' });
  assert.deepEqual(calls, [{ url: HOST_CHAT_URL, body: input }]);
});

test("a 429 stops the run once and for all; other failures are the answer's error by status only", async () => {
  let calls = 0;
  const halt = new HostHalt();
  const refused = hostGenerate(async () => {
    calls++;
    return new Response('{}', { status: 429 });
  }, { url: HOST_CHAT_URL, apiKey: HOST_KEY }, halt);
  await assert.rejects(refused({}), (error: unknown) => error instanceof HostStop && error.message === HOST_STOP_429);
  await assert.rejects(refused({}), (error: unknown) => error === halt.stopped());
  assert.equal(calls, 1, 'nothing more is sent after a 429');
  const failed = hostGenerate(async () => new Response('the prompt said: secret case text', { status: 503 }), { url: HOST_CHAT_URL, apiKey: HOST_KEY }, new HostHalt());
  await assert.rejects(failed({}), (error: unknown) => !(error instanceof HostStop) && (error as Error).message === 'host_http_503');
});

test('--provider host takes its model from ASK_HOST: no --model, no --effort; it spends no neurons on answers', () => {
  const args = parseReplicaArgs(['--provider', 'host', '--reps', '1', '--plant']);
  assert.equal(args.provider, 'host');
  assert.equal(args.model, '');
  for (const argv of [['--provider', 'host', '--model', '@cf/a/b'], ['--provider', 'host', '--effort', 'low'], ['--provider', 'elsewhere']]) {
    assert.throws(() => parseReplicaArgs(argv), String(argv));
  }
  assert.equal(runLabel({ ...args, model: HOST_ON.model }).label, `host:${HOST_ON.model} effort=worker +plant`);
  const items = [{ id: 'doe-u', kind: 'unknown', question: 'q' }] as unknown as EvalItem[];
  assert.equal(replicaNeed(items, 1, '@cf/openai/gpt-oss-120b', 'host').neurons, 0);
});
