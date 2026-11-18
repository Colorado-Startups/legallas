// SPDX-License-Identifier: Apache-2.0
// Failed sign-ins: one email per step, code and host a day, at most 20, never for tests, refreshes or revocations.
// A fake KV and a recording EMAIL binding; no real email is sent.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN_CLIENTS_URL } from './alert.ts';
import {
  failureCode,
  failureHost,
  MAX_SIGNIN_FAILURES_PER_GROUP,
  METADATA_RESOLUTION_FAILED,
  recordSignInFailure,
  SIGNIN_FAILURE_FULL_TTL_SECONDS,
  SIGNIN_FAILURE_PREFIX,
  SIGNIN_FAILURE_TTL_SECONDS,
  type SignInFailure,
  type SignInFailureEnv,
} from './signin-failure.ts';

const NOW = new Date(Date.UTC(2026, 9, 21, 15, 0));
const CLAUDE_CB = 'https://claude.ai/api/mcp/auth_callback';
const TOKEN_FAILURE: SignInFailure = { where: 'token', code: 'invalid_grant', host: 'claude.ai', grantType: 'authorization_code' };

interface Put {
  key: string;
  ttl?: number;
}

function env(options: { fail?: boolean; alerts?: string } = {}) {
  const store = new Map<string, string>();
  const puts: Put[] = [];
  const sent: { subject: string; text: string }[] = [];
  const guard = () => {
    if (options.fail) throw new TypeError('kv down');
  };
  const kv = {
    async get(key: string) {
      guard();
      return store.get(key) ?? null;
    },
    async put(key: string, value: string, opts?: { expirationTtl?: number }) {
      guard();
      puts.push({ key, ttl: opts?.expirationTtl });
      store.set(key, value);
    },
    async list({ prefix = '', limit = 1000 }: { prefix?: string; limit?: number } = {}) {
      guard();
      const names = [...store.keys()].filter((k) => k.startsWith(prefix)).sort().slice(0, limit);
      return { keys: names.map((name) => ({ name })), list_complete: true };
    },
  };
  const e = {
    OAUTH_KV: kv,
    EMAIL: { send: async (m: { subject: string; text: string }) => void sent.push(m) },
    ALERTS_ENABLED: options.alerts ?? '1',
  } as unknown as SignInFailureEnv;
  return { env: e, store, puts, sent };
}

function quiet(t: TestContext) {
  return { warn: t.mock.method(console, 'warn', () => {}), error: t.mock.method(console, 'error', () => {}) };
}

test("the host is the callback's, else a metadata-document client_id's, else unknown", () => {
  assert.equal(failureHost(CLAUDE_CB, 'https://claude.ai/oauth/mcp-oauth-client-metadata'), 'claude.ai');
  assert.equal(failureHost('https://app.harvey.ai/oauth/callback', 'opaque-id'), 'app.harvey.ai');
  assert.equal(failureHost(null, 'https://claude.ai/oauth/mcp-oauth-client-metadata'), 'claude.ai');
  assert.equal(failureHost('not a url', 'https://connect.vendor.app/client.json'), 'connect.vendor.app');
  assert.equal(failureHost(undefined, 'opaque-id'), 'unknown');
  assert.equal(failureHost(undefined, 'http://plain.vendor.app/client.json'), 'unknown', 'only an https client_id is a metadata document');
  assert.equal(failureHost(42, null), 'unknown');
});

test("an error's code is its OAuth code, else the metadata-resolution reason, else its name", () => {
  assert.equal(failureCode(Object.assign(new Error('x'), { code: 'invalid_request' })), 'invalid_request');
  assert.equal(failureCode(Object.assign(new Error('CIMD fetch failed for https://a.example/c.json'), { name: 'CimdFetchError', reason: METADATA_RESOLUTION_FAILED })), METADATA_RESOLUTION_FAILED);
  assert.equal(failureCode(new RangeError('boom')), 'RangeError');
  assert.equal(failureCode('boom'), 'unknown');
  assert.equal(failureCode(null), 'unknown');
});

test('one email per step, code and host a day: the same again is suppressed, a new host emails', async (t) => {
  const { warn } = quiet(t);
  const { env: e, puts, sent } = env();
  await recordSignInFailure(e, TOKEN_FAILURE, NOW);
  await recordSignInFailure(e, TOKEN_FAILURE, NOW);
  assert.equal(sent.length, 1);
  assert.deepEqual(puts, [{ key: `${SIGNIN_FAILURE_PREFIX}public:token:invalid_grant:claude.ai`, ttl: SIGNIN_FAILURE_TTL_SECONDS }]);
  assert.equal(SIGNIN_FAILURE_TTL_SECONDS, 86_400);
  assert.equal(sent[0]?.subject, 'Legallas: an AI app sign-in failed');
  assert.ok(sent[0]?.text.includes(ADMIN_CLIENTS_URL));

  await recordSignInFailure(e, { ...TOKEN_FAILURE, host: 'app.harvey.ai' }, NOW);
  await recordSignInFailure(e, { ...TOKEN_FAILURE, code: 'invalid_client' }, NOW);
  await recordSignInFailure(e, { where: 'authorize', code: 'invalid_grant', host: 'claude.ai' }, NOW);
  assert.equal(sent.length, 4);
  assert.deepEqual(warn.mock.calls.map((call) => call.arguments), [
    ['mcp_signin_failure', 'token', 'invalid_grant', 'claude.ai'],
    ['mcp_signin_failure', 'token', 'invalid_grant', 'app.harvey.ai'],
    ['mcp_signin_failure', 'token', 'invalid_client', 'claude.ai'],
    ['mcp_signin_failure', 'authorize', 'invalid_grant', 'claude.ai'],
  ]);
});

test('test hosts, refreshes and revocations are never kept or emailed', async (t) => {
  const { warn } = quiet(t);
  const { env: e, puts, sent } = env();
  await recordSignInFailure(e, { ...TOKEN_FAILURE, host: 'cb.smoke.invalid' }, NOW);
  await recordSignInFailure(e, { where: 'register', code: 'invalid_client_metadata', host: 'localhost' }, NOW);
  await recordSignInFailure(e, { ...TOKEN_FAILURE, grantType: 'refresh_token' }, NOW);
  await recordSignInFailure(e, { where: 'token', code: 'invalid_request', host: 'claude.ai' }, NOW);
  assert.deepEqual(puts, []);
  assert.equal(sent.length, 0);
  assert.deepEqual(warn.mock.calls.map((call) => call.arguments), [
    ['mcp_signin_failure_skipped', 'test_host'],
    ['mcp_signin_failure_skipped', 'test_host'],
    ['mcp_signin_failure_skipped', 'grant_type'],
    ['mcp_signin_failure_skipped', 'grant_type'],
  ]);
});

test('bogus /token and /register posts use up only their own 10 a day; a member-gated failure still emails', async (t) => {
  const { warn } = quiet(t);
  const { env: e, store, sent } = env();
  assert.equal(MAX_SIGNIN_FAILURES_PER_GROUP, 10);
  for (let i = 0; i < MAX_SIGNIN_FAILURES_PER_GROUP; i++) {
    await recordSignInFailure(e, { where: i % 2 ? 'register' : 'token', code: 'invalid_client', host: `h${i}.scanner.app`, grantType: 'authorization_code' }, NOW);
  }
  store.set('legallas-admin:refused-redirect:x', '1');
  assert.equal(sent.length, MAX_SIGNIN_FAILURES_PER_GROUP);
  await recordSignInFailure(e, TOKEN_FAILURE, NOW);
  assert.equal(sent.length, MAX_SIGNIN_FAILURES_PER_GROUP, 'the 11th open-step failure is not emailed');
  assert.equal(store.has(`${SIGNIN_FAILURE_PREFIX}public:token:invalid_grant:claude.ai`), false);
  assert.deepEqual(warn.mock.calls.at(-1)?.arguments, ['mcp_signin_failure_skipped', 'full', 'public']);

  await recordSignInFailure(e, { where: 'consent', code: METADATA_RESOLUTION_FAILED, host: 'claude.ai' }, NOW);
  assert.equal(sent.length, MAX_SIGNIN_FAILURES_PER_GROUP + 1, "a lawyer's consent failure still emails");
  assert.ok(store.has(`${SIGNIN_FAILURE_PREFIX}member:consent:${METADATA_RESOLUTION_FAILED}:claude.ai`));
});

test('member-gated failures have their own 10 a day, and filling them leaves /token alerts alone', async (t) => {
  const { warn } = quiet(t);
  const { env: e, store, sent } = env();
  for (let i = 0; i < MAX_SIGNIN_FAILURES_PER_GROUP; i++) store.set(`${SIGNIN_FAILURE_PREFIX}member:authorize:invalid_request:h${i}.vendor.app`, '1');
  await recordSignInFailure(e, { where: 'authorize', code: 'invalid_request', host: 'claude.ai' }, NOW);
  assert.equal(sent.length, 0);
  assert.deepEqual(warn.mock.calls.at(-1)?.arguments, ['mcp_signin_failure_skipped', 'full', 'member']);
  await recordSignInFailure(e, TOKEN_FAILURE, NOW);
  assert.equal(sent.length, 1);
  assert.ok(store.has(`${SIGNIN_FAILURE_PREFIX}public:token:invalid_grant:claude.ai`));
});

test('a KV failure never throws and logs the error name only', async (t) => {
  const { error } = quiet(t);
  const { env: e, sent } = env({ fail: true });
  await assert.doesNotReject(recordSignInFailure(e, TOKEN_FAILURE, NOW));
  assert.equal(sent.length, 0);
  assert.deepEqual(error.mock.calls.map((call) => call.arguments), [['mcp_signin_failure_record_failed', 'TypeError']]);
});

test('odd codes and hosts become "unknown" in the key, the log and the email; ALERTS_ENABLED=0 keeps but sends nothing', async (t) => {
  const { warn } = quiet(t);
  const { env: e, puts, sent } = env();
  await recordSignInFailure(e, { ...TOKEN_FAILURE, code: 'bad code\r\nBcc: x@evil.example', host: 'A'.repeat(300) }, NOW);
  assert.deepEqual(puts.map((put) => put.key), [`${SIGNIN_FAILURE_PREFIX}public:token:unknown:unknown`]);
  assert.deepEqual(warn.mock.calls[0]?.arguments, ['mcp_signin_failure', 'token', 'unknown', 'unknown']);
  assert.doesNotMatch(sent[0]?.text ?? '', /evil|Bcc/);

  const off = env({ alerts: '0' });
  await recordSignInFailure(off.env, TOKEN_FAILURE, NOW);
  assert.equal(off.puts.length, 1);
  assert.equal(off.sent.length, 0);
});

test('once a group is full, 50 more failures from new hosts list KV once, not 50 times', async (t) => {
  quiet(t);
  const { env: e, store, puts, sent } = env();
  for (let i = 0; i < MAX_SIGNIN_FAILURES_PER_GROUP; i++) store.set(`${SIGNIN_FAILURE_PREFIX}public:token:invalid_grant:h${i}.dummy-app.net`, '1');
  const kv = e.OAUTH_KV as unknown as { list: (options: { prefix?: string; limit?: number }) => Promise<unknown> };
  const list = kv.list.bind(kv);
  let lists = 0;
  kv.list = async (options) => {
    lists++;
    return list(options);
  };
  for (let i = 0; i < 50; i++) {
    await recordSignInFailure(e, { where: 'token', code: 'invalid_grant', grantType: 'authorization_code', host: `n${i}.dummy-app.net` }, NOW);
  }
  assert.ok(lists <= MAX_SIGNIN_FAILURES_PER_GROUP + 1, `${lists} KV lists`);
  assert.equal(lists, 1);
  assert.equal(sent.length, 0);
  assert.equal([...store.keys()].filter((key) => key.startsWith(`${SIGNIN_FAILURE_PREFIX}public:`)).length, MAX_SIGNIN_FAILURES_PER_GROUP, 'no key added');
  assert.deepEqual(puts, [{ key: `${SIGNIN_FAILURE_PREFIX}public-full`, ttl: SIGNIN_FAILURE_FULL_TTL_SECONDS }]);
  // The marker expires (KV's TTL): the next failure lists again, and emails once a slot has freed.
  store.delete(`${SIGNIN_FAILURE_PREFIX}public-full`);
  store.delete(`${SIGNIN_FAILURE_PREFIX}public:token:invalid_grant:h0.dummy-app.net`);
  await recordSignInFailure(e, TOKEN_FAILURE, NOW);
  assert.equal(lists, 2);
  assert.equal(sent.length, 1);
});
