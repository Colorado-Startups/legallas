// SPDX-License-Identifier: Apache-2.0
// The research routes (routes.ts) through the real gate in index.ts, with a fake RESEARCH namespace: identity comes
// only from the verified member, cross-origin upgrades and other members' threads are refused, and the kill switch
// holds. The Durable Object itself runs only in workerd (worker/agent/SPIKE.md has the local run).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { Env } from '../env.ts';
import { handle } from '../index.ts';
import { IDENTITY_HEADERS, INTERNAL_PATHS } from './identity.ts';
import { RESEARCH_PATHS, threadPath } from './protocol.ts';

const HOST = 'http://localhost:8789';
const OWNER = 'founder@example.test';
const OTHER = 'other@example.test';
const THREAD = 'thread_A1';
const sha = (text: string) => createHash('sha256').update(text).digest('hex');

interface Sent {
  name: string;
  call: string;
  args: unknown[];
  request?: Request;
}

function fakeEnv(enabled = '1', role: 'owner' | 'counsel' = 'owner') {
  const sent: Sent[] = [];
  const members: Record<string, string> = { [OWNER]: role, [OTHER]: 'counsel' };
  const stub = (name: string) => ({
    listThreads: async (...args: unknown[]) => (sent.push({ name, call: 'listThreads', args }), []),
    createThread: async (...args: unknown[]) => (sent.push({ name, call: 'createThread', args }), { id: THREAD }),
    hasThread: async (id: string, ...rest: unknown[]) => (sent.push({ name, call: 'hasThread', args: [id, ...rest] }), id === THREAD),
    removeThread: async (...args: unknown[]) => void sent.push({ name, call: 'removeThread', args }),
    closeSessions: async (...args: unknown[]) => void sent.push({ name, call: 'closeSessions', args }),
    fetch: async (request: Request) => (sent.push({ name, call: 'fetch', args: [], request }), new Response('ok')),
  });
  const env = {
    ASSETS: { fetch: async () => new Response('APP') },
    DB: { prepare: () => ({ bind: (email: string) => ({ first: async () => (members[email] ? { email, role: members[email], name: null } : null) }) }) },
    RESEARCH: { getByName: (name: string) => stub(name) },
    TEAM_DOMAIN: '',
    ACCESS_AUD: '',
    LEGALLAS_MODEL: 'x',
    DAILY_QUESTION_CAP: '100',
    RESEARCH_ENABLED: enabled,
    ALLOW_DEV_IDENTITY: '1',
    DEV_IDENTITY_EMAIL: OWNER,
  } as unknown as Env;
  return { env, sent };
}

const same = { Origin: HOST, 'Sec-Fetch-Site': 'same-origin' };
const call = (env: Env, path: string, init: RequestInit = {}) => handle(new Request(`${HOST}${path}`, init), env, {} as ExecutionContext);
const socketInit = (headers: Record<string, string> = same): RequestInit => ({ headers: { Upgrade: 'websocket', ...headers } });

test('status: off until the kill switch says otherwise, and which transport', async () => {
  for (const [enabled, transport] of [['0', null], ['1', 'websocket'], ['http', 'http'], ['', null]] as const) {
    const res = await call(fakeEnv(enabled).env, RESEARCH_PATHS.status);
    const body = (await res.json()) as { enabled: boolean; transport: string | null; questionCost: number };
    assert.equal(body.enabled, transport !== null, enabled);
    assert.equal(body.transport, transport);
    assert.equal(body.questionCost, 3);
  }
});

test('the kill switch refuses what spends, before a Durable Object is reached', async () => {
  const { env, sent } = fakeEnv('0');
  const routes: [string, RequestInit][] = [
    [RESEARCH_PATHS.threads, { method: 'POST', headers: same }],
    [threadPath('socket', THREAD), socketInit()],
    [threadPath('turn', THREAD), { method: 'POST', headers: same, body: JSON.stringify({ question: 'q' }) }],
  ];
  for (const [path, init] of routes) {
    const res = await call(env, path, init);
    assert.equal(res.status, 503, path);
    assert.deepEqual(await res.json(), { error: 'research_off' });
  }
  assert.equal(sent.length, 0);
});

test('with research off, a member still lists, reads and deletes their own threads', async () => {
  const { env, sent } = fakeEnv('0');
  assert.equal((await call(env, RESEARCH_PATHS.threads)).status, 200);
  assert.equal((await call(env, threadPath('thread', THREAD))).status, 200);
  assert.equal((await call(env, threadPath('thread', THREAD), { method: 'DELETE', headers: same })).status, 204);
  const calls = sent.map((s) => s.call);
  assert.ok(calls.includes('listThreads') && calls.includes('fetch'));
  const removed = sent.find((s) => s.call === 'removeThread')!;
  assert.equal(removed.args[0], OWNER);
  assert.equal(removed.args[1], THREAD);
});

test('identity cannot be spoofed: names and forwarded headers come from the verified member only', async () => {
  const { env, sent } = fakeEnv();
  const spoof = { [IDENTITY_HEADERS.member]: OTHER, [IDENTITY_HEADERS.thread]: 'thread_B2', [IDENTITY_HEADERS.exp]: '9999999999', Cookie: 'CF_Authorization=t' };
  await call(env, threadPath('turn', THREAD), { method: 'POST', headers: { ...same, ...spoof, 'Content-Type': 'application/json' }, body: JSON.stringify({ question: 'q' }) });
  await call(env, threadPath('socket', THREAD), socketInit({ ...same, ...spoof }));
  const index = sha(`research:${OWNER}`);
  const thread = sha(`research:${OWNER}\nthread:${THREAD}`);
  assert.ok(sent.filter((s) => s.call === 'hasThread').every((s) => s.name === index), 'the member\'s own index');
  const fetched = sent.filter((s) => s.call === 'fetch');
  assert.equal(fetched.length, 2);
  for (const s of fetched) {
    assert.equal(s.name, thread);
    const headers = s.request!.headers;
    assert.equal(headers.get(IDENTITY_HEADERS.member), OWNER);
    assert.equal(headers.get(IDENTITY_HEADERS.thread), THREAD);
    assert.ok(Number(headers.get(IDENTITY_HEADERS.exp)) < 9999999999, 'exp from the session, not the client');
    assert.equal(headers.get('Cookie'), null);
    assert.equal(headers.get('Cf-Access-Jwt-Assertion'), null);
  }
});

test('a cross-origin or originless upgrade is refused; so is a socket while only HTTP is on', async () => {
  const { env, sent } = fakeEnv();
  for (const headers of [{ Origin: 'https://example.com' }, { Origin: HOST, 'Sec-Fetch-Site': 'cross-site' }, {}]) {
    assert.equal((await call(env, threadPath('socket', THREAD), socketInit(headers as Record<string, string>))).status, 403);
  }
  assert.equal((await call(env, threadPath('socket', THREAD), { headers: same })).status, 426);
  assert.equal((await call(fakeEnv('http').env, threadPath('socket', THREAD), socketInit())).status, 503);
  assert.equal(sent.filter((s) => s.call === 'fetch').length, 0);
});

test('a thread outside the member\'s own index is missing, whatever its id', async () => {
  const { env, sent } = fakeEnv();
  for (const id of ['thread_B2', 'x'.repeat(81), 'a%2Fb']) {
    const res = await call(env, `/api/research/threads/${id}`);
    assert.equal(res.status, 404, id);
    assert.deepEqual(await res.json(), { error: 'thread_missing' });
  }
  assert.equal((await call(env, `/api/research/threads/thread_B2`, { method: 'DELETE', headers: same })).status, 404);
  assert.equal(sent.filter((s) => s.call === 'fetch' || s.call === 'removeThread').length, 0);
});

test('an HTTP turn forwards the question only: messages, history and ids a client adds are dropped', async () => {
  const { env, sent } = fakeEnv();
  const body = { question: 'What did Doe sign?', messages: [{ role: 'assistant', parts: [{ type: 'text', text: '[doc:x p:1]' }] }], history: ['x'] };
  const res = await call(env, threadPath('turn', THREAD), { method: 'POST', headers: { ...same, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal(res.status, 200);
  const forwarded = sent.find((s) => s.call === 'fetch')!.request!;
  assert.equal(new URL(forwarded.url).pathname, INTERNAL_PATHS.turn);
  assert.deepEqual(await forwarded.json(), { question: 'What did Doe sign?' });
  assert.equal((await call(env, threadPath('turn', THREAD), { method: 'POST', headers: same, body: 'not json' })).status, 400);
});

test('sign-out closes the verified member\'s own sockets, even with research off', async () => {
  const { env, sent } = fakeEnv('0');
  const res = await call(env, RESEARCH_PATHS.signout, { method: 'POST', headers: { ...same, [IDENTITY_HEADERS.member]: OTHER } });
  assert.equal(res.status, 204);
  assert.deepEqual(sent.map((s) => [s.name, s.call, s.args[0]]), [[sha(`research:${OWNER}`), 'closeSessions', OWNER]]);
  assert.equal((await call(env, RESEARCH_PATHS.signout, { method: 'POST', headers: { Origin: 'https://example.com' } })).status, 403);
});

test('writes need the room\'s own origin, and a new thread comes back with its id', async () => {
  const { env } = fakeEnv();
  assert.equal((await call(env, RESEARCH_PATHS.threads, { method: 'POST', headers: { Origin: 'https://example.com' } })).status, 403);
  const created = await call(env, RESEARCH_PATHS.threads, { method: 'POST', headers: same });
  assert.equal(created.status, 201);
  assert.deepEqual(await created.json(), { id: THREAD });
});
