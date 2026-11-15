// SPDX-License-Identifier: Apache-2.0
// The request gates with fake rate-limit bindings: routes and bindings, 429s, sign-in failing closed, the package
// failing open, and the /mcp Origin gate.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { COPILOT_PACKAGE_PATH, MCP_ORIGIN } from './contract.ts';
import { MCP_PATH, RETRY_AFTER_SECONDS, isAllowedOrigin, originGate, originHost, rateLimitGate, type GateEnv } from './gates.ts';

/** A rate-limit binding that records each key and answers `success` until `allow` calls are used up. */
function fakeLimit(allow = Infinity) {
  const keys: string[] = [];
  return {
    keys,
    binding: {
      async limit({ key }: { key: string }) {
        keys.push(key);
        return { success: keys.length <= allow };
      },
    } as RateLimit,
  };
}

function gateEnv(overrides: Partial<GateEnv> = {}) {
  const register = fakeLimit();
  const token = fakeLimit();
  const pkg = fakeLimit();
  const env: GateEnv = { REGISTER_LIMIT: register.binding, TOKEN_LIMIT: token.binding, PACKAGE_LIMIT: pkg.binding, ...overrides };
  return { env, register, token, pkg };
}

function post(path: string, headers: Record<string, string> = {}): Request {
  return new Request(new URL(path, MCP_ORIGIN), { method: 'POST', headers, body: 'x=1' });
}

/** Captures console.warn and console.error lines as joined strings. */
function captureLogs(t: TestContext): string[] {
  const lines: string[] = [];
  const record = (...args: unknown[]) => void lines.push(args.map(String).join(' '));
  t.mock.method(console, 'warn', record);
  t.mock.method(console, 'error', record);
  return lines;
}

test('each POST route uses its own binding, keyed by CF-Connecting-IP', async () => {
  const { env, register, token, pkg } = gateEnv();
  const ip = { 'CF-Connecting-IP': '203.0.113.7' };
  assert.equal(await rateLimitGate(post('/register', ip), env), null);
  assert.equal(await rateLimitGate(post('/token', ip), env), null);
  assert.equal(await rateLimitGate(post(COPILOT_PACKAGE_PATH, ip), env), null);
  assert.deepEqual([register.keys, token.keys, pkg.keys], [['203.0.113.7'], ['203.0.113.7'], ['203.0.113.7']]);
});

test("a request without CF-Connecting-IP shares the 'unknown' key", async () => {
  const { env, token } = gateEnv();
  await rateLimitGate(post('/token'), env);
  assert.deepEqual(token.keys, ['unknown']);
});

test('other routes and methods are never counted', async () => {
  const { env, register, token, pkg } = gateEnv();
  for (const request of [
    new Request(`${MCP_ORIGIN}/token`),
    new Request(`${MCP_ORIGIN}/register`, { method: 'OPTIONS' }),
    post('/authorize'),
    post('/mcp'),
    post('/token/'),
    post(`${COPILOT_PACKAGE_PATH}/x`),
    new Request(`${MCP_ORIGIN}${COPILOT_PACKAGE_PATH}`),
  ]) {
    assert.equal(await rateLimitGate(request, env), null, `${request.method} ${request.url}`);
  }
  assert.equal(register.keys.length + token.keys.length + pkg.keys.length, 0);
});

test('over the limit, /register and /token answer an OAuth-style 429 and log the code only', async (t) => {
  const logs = captureLogs(t);
  for (const path of ['/register', '/token']) {
    const env = gateEnv({ REGISTER_LIMIT: fakeLimit(0).binding, TOKEN_LIMIT: fakeLimit(0).binding }).env;
    const response = await rateLimitGate(post(path, { 'CF-Connecting-IP': '198.51.100.9' }), env);
    assert.ok(response, path);
    assert.equal(response.status, 429);
    assert.equal(response.headers.get('retry-after'), String(RETRY_AFTER_SECONDS));
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('content-type'), 'application/json');
    const body = (await response.json()) as Record<string, string>;
    assert.equal(body.error, 'rate_limited');
    assert.equal(typeof body.error_description, 'string');
  }
  assert.deepEqual(logs, ['mcp_rate_limited /register', 'mcp_rate_limited /token']);
  assert.ok(logs.every((line) => !line.includes('198.51.100.9')), 'the IP is never logged');
});

test('over the limit, the package route answers a plain 429', async (t) => {
  captureLogs(t);
  const { env } = gateEnv({ PACKAGE_LIMIT: fakeLimit(0).binding });
  const response = await rateLimitGate(post(COPILOT_PACKAGE_PATH), env);
  assert.equal(response?.status, 429);
  assert.deepEqual(await response?.json(), { error: 'rate_limited' });
});

test('the limit lets calls through until it is used up', async (t) => {
  captureLogs(t);
  const limit = fakeLimit(2);
  const { env } = gateEnv({ REGISTER_LIMIT: limit.binding });
  const statuses = [];
  for (let i = 0; i < 3; i++) statuses.push((await rateLimitGate(post('/register'), env))?.status ?? 'pass');
  assert.deepEqual(statuses, ['pass', 'pass', 429]);
});

test('/register and /token fail closed with a 503 and retry-after when their binding throws or is missing', async (t) => {
  const logs = captureLogs(t);
  const broken = { limit: async () => Promise.reject(new Error('binding down 203.0.113.7')) } as RateLimit;
  const missing = gateEnv().env as Partial<GateEnv>;
  delete missing.REGISTER_LIMIT;
  const responses = [
    await rateLimitGate(post('/token', { 'CF-Connecting-IP': '203.0.113.7' }), gateEnv({ TOKEN_LIMIT: broken }).env),
    await rateLimitGate(post('/register'), missing as GateEnv),
  ];
  for (const response of responses) {
    assert.ok(response);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('retry-after'), String(RETRY_AFTER_SECONDS));
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = (await response.json()) as Record<string, string>;
    assert.equal(body.error, 'temporarily_unavailable');
    assert.equal(typeof body.error_description, 'string');
  }
  assert.deepEqual(logs, ['mcp_ratelimit_error /token', 'mcp_ratelimit_error /register']);
  assert.ok(logs.every((line) => !line.includes('203.0.113.7')), 'neither the IP nor the error text is logged');
});

test('the Copilot package fails open when PACKAGE_LIMIT throws: public, nothing written, nothing secret', async (t) => {
  const logs = captureLogs(t);
  const broken = { limit: async () => Promise.reject(new Error('binding down')) } as RateLimit;
  assert.equal(await rateLimitGate(post(COPILOT_PACKAGE_PATH), gateEnv({ PACKAGE_LIMIT: broken }).env), null);
  assert.deepEqual(logs, [`mcp_ratelimit_error ${COPILOT_PACKAGE_PATH}`]);
});

test('ORIGIN_ALLOW: exact entries and host-plus-subdomain entries, https only', () => {
  for (const origin of [
    'https://claude.ai',
    'https://claude.com',
    'https://teams.microsoft.com',
    'https://microsoft.com',
    'https://copilot.cloud.microsoft',
    'https://m365.cloud.microsoft',
    'https://www.office.com',
    'https://global.consent.azure-apim.net',
    'https://app.harvey.ai',
    'https://harvey.ai',
  ]) {
    assert.equal(isAllowedOrigin(origin), true, origin);
  }
});

test('lookalike, downgraded and malformed origins are unlisted', () => {
  for (const origin of [
    'https://claude.ai.evil.com',
    'http://claude.ai',
    'https://evilmicrosoft.com',
    'https://microsoft.com.evil.com',
    'http://teams.microsoft.com',
    'https://evilharvey.ai',
    'https://www.claude.ai',
    'https://claude.ai:8443',
    'https://teams.microsoft.com:8443',
    'https://claude.ai/',
    'https://user@claude.ai',
    'https://CLAUDE.ai',
    'null',
    '',
    'not a url',
  ]) {
    assert.equal(isAllowedOrigin(origin), false, origin);
  }
});

test('originHost logs the host only, and invalid for anything unparseable', () => {
  assert.equal(originHost('https://claude.ai.evil.com'), 'claude.ai.evil.com');
  assert.equal(originHost('null'), 'invalid');
  assert.equal(originHost(''), 'invalid');
});

function mcpRequest(origin?: string, path = MCP_PATH): Request {
  return new Request(`${MCP_ORIGIN}${path}`, { method: 'POST', headers: origin === undefined ? {} : { Origin: origin } });
}

test('/mcp without an Origin always passes, even when enforcing', (t) => {
  const logs = captureLogs(t);
  assert.equal(originGate(mcpRequest(), gateEnv({ MCP_ORIGIN_ENFORCE: '1' }).env), null);
  assert.deepEqual(logs, []);
});

test('/mcp with a listed Origin passes without a log line', (t) => {
  const logs = captureLogs(t);
  assert.equal(originGate(mcpRequest('https://claude.ai'), gateEnv({ MCP_ORIGIN_ENFORCE: '1' }).env), null);
  assert.deepEqual(logs, []);
});

test('an unlisted Origin is only logged while MCP_ORIGIN_ENFORCE is not "1"', (t) => {
  const logs = captureLogs(t);
  for (const flag of [undefined, '0', 'true']) {
    assert.equal(originGate(mcpRequest('https://claude.ai.evil.com'), gateEnv({ MCP_ORIGIN_ENFORCE: flag }).env), null, String(flag));
  }
  assert.deepEqual(logs, Array(3).fill('mcp_origin_unlisted claude.ai.evil.com'));
});

test('MCP_ORIGIN_ENFORCE "1" refuses an unlisted Origin with 403, on /mcp and below it', async (t) => {
  const logs = captureLogs(t);
  const { env } = gateEnv({ MCP_ORIGIN_ENFORCE: '1' });
  for (const [origin, path] of [
    ['https://evilmicrosoft.com', MCP_PATH],
    ['http://claude.ai', `${MCP_PATH}/sse`],
  ]) {
    const response = originGate(mcpRequest(origin, path), env);
    assert.equal(response?.status, 403, origin);
    assert.equal(response?.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response?.json(), { error: 'forbidden_origin' });
  }
  assert.deepEqual(logs, ['mcp_origin_unlisted evilmicrosoft.com', 'mcp_origin_unlisted claude.ai']);
});

test('the Origin gate ignores every path outside /mcp', (t) => {
  const logs = captureLogs(t);
  const { env } = gateEnv({ MCP_ORIGIN_ENFORCE: '1' });
  for (const path of ['/authorize', '/token', '/connections', '/mcpx', '/connect']) {
    assert.equal(originGate(mcpRequest('https://evil.example', path), env), null, path);
  }
  assert.deepEqual(logs, []);
});
