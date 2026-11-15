// SPDX-License-Identifier: Apache-2.0
// Refused sign-in callbacks: kept for the owner (14 days, at most 20), one alert per new host, then allowed,
// dismissed or removed on /admin/clients, and loaded back into MCP_REDIRECT_ALLOW. No real email is sent.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { ALERT_TO, alertSignature } from '../worker/signins.ts';
import { ADMIN_CLIENTS_URL, refusedRedirectEmail } from './alert.ts';
import { ALLOWED_REDIRECT_PREFIX, REFUSED_REDIRECT_PREFIX, type McpEnv } from './contract.ts';
import { checkRegistration } from './oauth.ts';
import {
  allowRefusedRedirect,
  dismissRefusedRedirect,
  isAllowedRedirect,
  isReservedTestHost,
  isStorableRedirect,
  loadAllowedRedirects,
  MAX_STORED_REDIRECTS,
  mergeRedirectAllow,
  recordRefusedRedirect,
  refusedRedirects,
  REFUSED_TTL_SECONDS,
  removeAllowedRedirect,
} from './redirects.ts';

const CB = 'https://connect.vendor.app/oauth/callback';
const NOW = new Date(Date.UTC(2026, 9, 6, 16, 0));

interface Put {
  key: string;
  options?: { expirationTtl?: number; metadata?: unknown };
}

/** A KV that keeps metadata and records put options; `fail` makes every call throw. */
function kv(options: { fail?: boolean } = {}) {
  const store = new Map<string, { value: string; metadata?: unknown }>();
  const puts: Put[] = [];
  const guard = () => {
    if (options.fail) throw new TypeError('kv down');
  };
  const namespace = {
    async get(key: string) {
      guard();
      return store.get(key)?.value ?? null;
    },
    async put(key: string, value: string, opts?: Put['options']) {
      guard();
      puts.push({ key, options: opts });
      store.set(key, { value, metadata: opts?.metadata });
    },
    async delete(key: string) {
      guard();
      store.delete(key);
    },
    async list({ prefix = '', limit = 1000 }: { prefix?: string; limit?: number } = {}) {
      guard();
      const names = [...store.keys()].filter((k) => k.startsWith(prefix)).sort().slice(0, limit);
      return { keys: names.map((name) => ({ name, metadata: store.get(name)?.metadata })), list_complete: true };
    },
  };
  return { store, puts, namespace: namespace as unknown as KVNamespace };
}

function env(options: { fail?: boolean; alerts?: string } = {}) {
  const k = kv(options);
  const sent: { subject: string; text: string }[] = [];
  const e = {
    OAUTH_KV: k.namespace,
    EMAIL: { send: async (m: { subject: string; text: string }) => void sent.push(m) },
    ALERTS_ENABLED: options.alerts ?? '1',
  } as unknown as Pick<McpEnv, 'OAUTH_KV' | 'EMAIL' | 'ALERTS_ENABLED'>;
  return { env: e, kv: k, sent };
}

const refusedKey = (uri: string) => `${REFUSED_REDIRECT_PREFIX}${encodeURIComponent(uri)}`;
const allowedKey = (uri: string) => `${ALLOWED_REDIRECT_PREFIX}${encodeURIComponent(uri)}`;

test('only canonical https URIs without userinfo, fragment or comma, at most 512 characters, are storable', () => {
  assert.equal(isStorableRedirect(CB), true);
  assert.equal(isStorableRedirect(`https://a.example/${'x'.repeat(200)}`), true);
  for (const uri of [
    'http://connect.vendor.example/cb',
    'https://user@connect.vendor.example/cb',
    'https://connect.vendor.example/cb#x',
    'https://connect.vendor.example/cb?a=1,2',
    'https://Connect.vendor.example/cb',
    'https://connect.vendor.example:443/cb',
    'https://connect.vendor.example:8443/cb',
    `https://a.example/${'x'.repeat(500)}`,
    'https://a.example/%2F'.padEnd(400, '/'),
    'not a url',
    42,
    undefined,
  ]) {
    assert.equal(isStorableRedirect(uri), false, String(uri));
  }
});

test('a refused URI is kept 14 days with its time, and the owner gets one email per new host', async (t: TestContext) => {
  t.mock.method(console, 'warn', () => {});
  const { env: e, kv: k, sent } = env();
  await recordRefusedRedirect(e, CB, NOW);
  assert.deepEqual(k.puts, [{ key: refusedKey(CB), options: { expirationTtl: REFUSED_TTL_SECONDS, metadata: { at: NOW.getTime() / 1000 } } }]);
  assert.equal(REFUSED_TTL_SECONDS, 14 * 86_400);
  assert.equal(sent.length, 1);
  const expected = refusedRedirectEmail(CB);
  assert.deepEqual({ subject: sent[0]?.subject, text: sent[0]?.text }, { ...expected, text: expected.text + alertSignature({}).text });
  assert.equal((sent[0] as unknown as { to: string }).to, ALERT_TO);

  await recordRefusedRedirect(e, CB, NOW);
  await recordRefusedRedirect(e, 'https://connect.vendor.app/oauth/other', NOW);
  assert.equal(k.puts.length, 2, 'the same URI is kept once');
  assert.equal(sent.length, 1, 'no second email for a host already waiting');
  await recordRefusedRedirect(e, 'https://login.other.app/cb', NOW);
  assert.equal(sent.length, 2);
  assert.deepEqual((await refusedRedirects(e)).map((r) => r.uri).sort(), [CB, 'https://connect.vendor.app/oauth/other', 'https://login.other.app/cb'].sort());
});

test("an unsupported AI's callback is never kept for the owner or emailed", async (t: TestContext) => {
  t.mock.method(console, 'warn', () => {});
  const { env: e, kv: k, sent } = env();
  await recordRefusedRedirect(e, 'https://chatgpt.com/connector_platform_oauth_redirect', NOW);
  await recordRefusedRedirect(e, 'https://vertexaisearch.cloud.google.com/oauth-redirect', NOW);
  assert.deepEqual(k.puts, []);
  assert.equal(sent.length, 0);
});

test('the email names the callback in full and links /admin/clients', () => {
  const mail = refusedRedirectEmail(CB);
  assert.equal(mail.text, `An AI app tried to connect with a sign-in callback that is not on the list: ${CB}. If this is Harvey (or another app you expect), allow it at https://mcp.room.example.com/admin/clients.\n`);
  assert.equal(ADMIN_CLIENTS_URL, 'https://mcp.room.example.com/admin/clients');
  assert.ok(!mail.subject.includes('\n'));
});

test('nothing is kept for unstorable URIs or past 20, ALERTS_ENABLED=0 stores without email, and KV errors never throw', async (t: TestContext) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const error = t.mock.method(console, 'error', () => {});
  const full = env();
  for (let i = 0; i < MAX_STORED_REDIRECTS; i++) full.kv.store.set(refusedKey(`https://h${i}.example/cb`), { value: '1' });
  await recordRefusedRedirect(full.env, CB, NOW);
  await recordRefusedRedirect(full.env, 'http://plain.example/cb', NOW);
  assert.equal(full.kv.puts.length, 0);
  assert.equal(full.sent.length, 0);
  assert.deepEqual(warn.mock.calls.map((c) => c.arguments), [['mcp_redirect_capture_skipped', 'full'], ['mcp_redirect_capture_skipped', 'unstorable']]);

  const quiet = env({ alerts: '0' });
  await recordRefusedRedirect(quiet.env, CB, NOW);
  assert.equal(quiet.kv.puts.length, 1);
  assert.equal(quiet.sent.length, 0);

  await recordRefusedRedirect(env({ fail: true }).env, CB, NOW);
  assert.deepEqual(error.mock.calls.at(-1)?.arguments, ['mcp_redirect_capture_failed', 'TypeError']);
});

test('Allow moves a waiting URI to the allowed list, which then lets it register and authorize, exactly', async (t: TestContext) => {
  t.mock.method(console, 'warn', () => {});
  const { env: e, kv: k } = env();
  const slash = 'https://connect.vendor.app/oauth/';
  assert.equal(await allowRefusedRedirect(e, CB, NOW), 'missing', 'only a waiting URI can be allowed');
  await recordRefusedRedirect(e, CB, NOW);
  await recordRefusedRedirect(e, slash, NOW);
  assert.equal(await allowRefusedRedirect(e, CB, NOW), 'allowed');
  assert.equal(await allowRefusedRedirect(e, slash, NOW), 'allowed');
  assert.equal(k.store.has(refusedKey(CB)), false);
  assert.equal(k.store.has(allowedKey(CB)), true);
  assert.equal(k.puts.at(-1)?.options?.expirationTtl, undefined, 'an allowed URI does not expire');

  const loaded = await loadAllowedRedirects(e);
  const allow = { MCP_REDIRECT_ALLOW: mergeRedirectAllow('https://extra.example/cb', loaded) };
  for (const uri of [CB, slash, 'https://extra.example/cb']) assert.equal(isAllowedRedirect(uri, allow), true, uri);
  for (const uri of [`${CB}/x`, `${slash}x`, 'https://connect.vendor.app/oauth']) assert.equal(isAllowedRedirect(uri, allow), false, uri);
  assert.equal(checkRegistration({ redirect_uris: [CB] }, allow.MCP_REDIRECT_ALLOW), undefined);
  assert.equal(mergeRedirectAllow(undefined, ''), undefined);
  assert.equal(mergeRedirectAllow(undefined, loaded), loaded);
});

test('Allow stops at 20 allowed URIs; Dismiss and Remove delete; unstorable input changes nothing', async (t: TestContext) => {
  t.mock.method(console, 'warn', () => {});
  const { env: e, kv: k } = env();
  await recordRefusedRedirect(e, CB, NOW);
  for (let i = 0; i < MAX_STORED_REDIRECTS; i++) k.store.set(allowedKey(`https://h${i}.example/cb`), { value: '1' });
  assert.equal(await allowRefusedRedirect(e, CB, NOW), 'full');
  assert.equal(k.store.has(refusedKey(CB)), true);
  assert.equal(await dismissRefusedRedirect(e, CB), true);
  assert.equal(k.store.has(refusedKey(CB)), false);
  assert.equal(await removeAllowedRedirect(e, 'https://h0.example/cb'), true);
  assert.equal(k.store.has(allowedKey('https://h0.example/cb')), false);
  const before = k.store.size;
  assert.equal(await dismissRefusedRedirect(e, 'http://h1.example/cb'), false);
  assert.equal(await removeAllowedRedirect(e, 42), false);
  assert.equal(k.store.size, before);
});

test('loadAllowedRedirects skips undecodable keys and returns "" when KV fails', async (t: TestContext) => {
  const error = t.mock.method(console, 'error', () => {});
  const { env: e, kv: k } = env();
  k.store.set(`${ALLOWED_REDIRECT_PREFIX}%E0%A4%A`, { value: '1' });
  k.store.set(allowedKey('http://plain.example/cb'), { value: '1' });
  k.store.set(allowedKey(CB), { value: '1' });
  assert.equal(await loadAllowedRedirects(e), `=${CB}`);
  assert.equal(await loadAllowedRedirects(env({ fail: true }).env), '');
  assert.deepEqual(error.mock.calls.at(-1)?.arguments, ['mcp_allowed_redirects_failed', 'TypeError']);
});

test('checkRegistration hands the first refused URI to onRefusedRedirect, and nothing else', (t: TestContext) => {
  t.mock.method(console, 'warn', () => {});
  const error = t.mock.method(console, 'error', () => {});
  const seen: string[] = [];
  const hook = (uri: string) => void seen.push(uri);
  const claude = 'https://claude.ai/api/mcp/auth_callback';
  assert.equal(checkRegistration({ redirect_uris: [claude] }, undefined, '1', hook), undefined);
  assert.equal(checkRegistration({ redirect_uris: ['https://app.harvey.ai/oauth/callback'] }, undefined, '1', hook), undefined);
  checkRegistration({ redirect_uris: [claude, CB, 'https://b.example/cb'] }, undefined, '1', hook);
  checkRegistration({ redirect_uris: [42] }, undefined, '1', hook);
  checkRegistration({ redirect_uris: [] }, undefined, '1', hook);
  checkRegistration({ redirect_uris: [CB] }, undefined, '0', hook);
  assert.deepEqual(seen, [CB]);
  const result = checkRegistration({ redirect_uris: [CB] }, undefined, '1', () => {
    throw new RangeError('boom');
  });
  assert.equal(result?.code, 'invalid_redirect_uri');
  assert.deepEqual(error.mock.calls.at(-1)?.arguments, ['mcp_redirect_capture_failed', 'RangeError']);
});

test('refusals for .invalid hosts, which the smoke test uses, are never kept or emailed', async (t: TestContext) => {
  const e = env({});
  t.mock.method(console, 'warn', () => {});
  await recordRefusedRedirect(e.env, 'https://evil.invalid/cb', NOW);
  await recordRefusedRedirect(e.env, 'https://harvey.ai.invalid/cb', NOW);
  assert.equal(e.kv.store.size, 0);
  assert.equal(e.sent.length, 0);
});

test('refusals for every RFC 2606 and RFC 6761 test name are never kept or emailed', async (t: TestContext) => {
  const e = env({});
  const warn = t.mock.method(console, 'warn', () => {});
  const reserved = [
    'https://app.example/cb',
    'https://example/cb',
    'https://client.test/cb',
    'https://deep.client.test/oauth/callback',
    'https://localhost/cb',
    'https://app.localhost/cb',
    'https://example.com/cb',
    'https://www.example.com/oauth/callback',
    'https://example.net/cb',
    'https://a.b.example.org/cb',
    'https://example.com./cb',
  ];
  for (const uri of reserved) {
    assert.equal(isStorableRedirect(uri), true, `${uri} is skipped as a test host, not as unstorable`);
    await recordRefusedRedirect(e.env, uri, NOW);
  }
  assert.equal(e.kv.store.size, 0);
  assert.equal(e.sent.length, 0);
  assert.ok(warn.mock.calls.every((c) => c.arguments[1] === 'test_host'));
  assert.equal(warn.mock.callCount(), reserved.length);
});

test('names that only look like test names are still kept and emailed, one email per host', async (t: TestContext) => {
  const e = env({});
  t.mock.method(console, 'warn', () => {});
  const real = [
    'https://myexample.com/cb',
    'https://example.com.vendor.app/cb',
    'https://example.co/cb',
    'https://test.vendor.app/cb',
    'https://localhost.vendor.app/cb',
    'https://contest/cb',
    'https://examples.org/cb',
  ];
  for (const uri of real) await recordRefusedRedirect(e.env, uri, NOW);
  assert.equal(e.kv.store.size, real.length);
  assert.equal(e.sent.length, real.length);
});

test('isReservedTestHost matches whole labels, any case, with or without a trailing dot', () => {
  for (const host of ['invalid', 'x.invalid', 'example', 'EXAMPLE', 'a.test', 'localhost', 'a.localhost', 'Example.COM', 'example.org.', 'a.example.net'])
    assert.equal(isReservedTestHost(host), true, host);
  for (const host of ['', 'claude.ai', 'app.harvey.ai', 'myexample.com', 'example.com.evil.app', 'testing', 'mylocalhost', 'example.co'])
    assert.equal(isReservedTestHost(host), false, host);
});
