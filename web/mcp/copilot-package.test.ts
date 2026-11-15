// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { buildPackage, readPackage, resolvePlaceholders } from '../connect/copilot/build.ts';
import { bundledPackage, zipProblems } from '../connect/copilot/package.ts';
import { PACKAGE_VERSION } from '../connect/copilot/validate.ts';
import { readZipStore } from './zip.ts';
import { MCP_ORIGIN, type McpEnv } from './contract.ts';
import { AGENT_NOT_OFFERED, MAX_FORM_BYTES, agentConfigured, copilotPackage, legallasAgent } from './copilot-package.ts';
import { AGENT_ZIP_PATH } from './pages/connect-copilot.ts';
import { renderConnectPage } from './pages/connect.ts';
import { roomWords } from './room-words.ts';

const REFERENCE_ID = 'T0FBdXRoQ29uZmlnSWQ';
const URL_ = 'https://mcp.room.example.com/connect/copilot-package';
const env = {} as McpEnv;

function post(body: string, type = 'application/x-www-form-urlencoded'): Request {
  return new Request(URL_, { method: 'POST', headers: { 'content-type': type }, body });
}

/** Captures console output so a test can show the ID never reaches a log. */
function captureLogs(t: TestContext): string[] {
  const lines: string[] = [];
  for (const level of ['log', 'warn', 'error'] as const) {
    t.mock.method(console, level, (...args: unknown[]) => lines.push(args.map(String).join(' ')));
  }
  return lines;
}

test('a valid ID downloads the same ZIP the CLI builds, as an attachment', async (t) => {
  const logs = captureLogs(t);
  const response = await copilotPackage(post(`reference_id=${encodeURIComponent(`  ${REFERENCE_ID}\n`)}`), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/zip');
  assert.equal(response.headers.get('content-disposition'), 'attachment; filename="legallas-copilot-agent.zip"');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const zip = Buffer.from(await response.arrayBuffer());
  assert.deepEqual(zip, buildPackage(readPackage(), REFERENCE_ID), 'byte for byte what node build.ts writes');
  assert.deepEqual(zipProblems(zip), []);
  const expected = resolvePlaceholders(readPackage(), REFERENCE_ID);
  for (const entry of readZipStore(zip)) assert.deepEqual(Buffer.from(entry.data), Buffer.from(expected.get(entry.name)!), entry.name);
  const plugin = JSON.parse(new TextDecoder().decode(readZipStore(zip).find((e) => e.name === 'ai-plugin.json')!.data));
  assert.equal(plugin.runtimes[0].auth.reference_id, REFERENCE_ID);
  assert.deepEqual(logs, ['copilot_package_built']);
});

test('other fields in the form are ignored', async () => {
  const response = await copilotPackage(post(`firm=x&reference_id=${REFERENCE_ID}&extra=1`), env);
  assert.equal(response.status, 200);
});

test('bad IDs get a plain page saying what to paste and where it comes from, and are never logged', async (t) => {
  const logs = captureLogs(t);
  const bad = ['', '   ', 'has space', 'quote"d', "it's", '<script>', 'x'.repeat(257), '${{LEGALLAS_OAUTH_REFERENCE_ID}}'];
  for (const value of bad) {
    const response = await copilotPackage(post(`reference_id=${encodeURIComponent(value)}`), env);
    assert.equal(response.status, 400, JSON.stringify(value));
    assert.match(response.headers.get('content-type') ?? '', /^text\/html/);
    const html = await response.text();
    assert.match(html, /Check the registration ID/);
    assert.match(html, /Teams Developer Portal: Tools &gt; OAuth client registration/);
    assert.match(html, /registration ID/);
    if (value.trim().length > 3) assert.ok(!html.includes(value), 'the page does not echo the input');
  }
  assert.ok(logs.length === bad.length, logs.join('\n'));
  for (const line of logs) assert.match(line, /^copilot_package_refused (bad_id|invalid_package)$/);
});

test('a missing field, the wrong content type and an oversized body are refused', async (t) => {
  const logs = captureLogs(t);
  assert.equal((await copilotPackage(post('other=1'), env)).status, 400);
  assert.equal((await copilotPackage(post(JSON.stringify({ reference_id: REFERENCE_ID }), 'application/json'), env)).status, 400);
  const form = new FormData();
  form.set('reference_id', REFERENCE_ID);
  assert.equal((await copilotPackage(new Request(URL_, { method: 'POST', body: form }), env)).status, 400, 'multipart');
  const huge = `reference_id=${REFERENCE_ID}&pad=${'x'.repeat(MAX_FORM_BYTES)}`;
  assert.equal((await copilotPackage(post(huge), env)).status, 400);
  assert.deepEqual(logs, [
    'copilot_package_refused bad_id',
    'copilot_package_refused bad_type',
    'copilot_package_refused bad_type',
    'copilot_package_refused too_large',
  ]);
});

test('only POST is allowed', async () => {
  for (const method of ['GET', 'HEAD', 'PUT', 'DELETE']) {
    const response = await copilotPackage(new Request(`${URL_}?reference_id=${REFERENCE_ID}`, { method }), env);
    assert.equal(response.status, 405, method);
    assert.equal(response.headers.get('allow'), 'POST');
    assert.equal(await response.text(), '');
  }
});

// GET /connect/legallas-agent.zip: the shared agent, built with COPILOT_REFERENCE_ID.

const SHARED_ID = 'U2hhcmVkUmVnaXN0cmF0aW9uSWQ';
const AGENT_URL = `${MCP_ORIGIN}${AGENT_ZIP_PATH}`;

/** A rate-limit binding that records each key and answers `success` until `allow` calls are used up. */
function fakeLimit(allow = Infinity) {
  const keys: string[] = [];
  const binding = {
    async limit({ key }: { key: string }) {
      keys.push(key);
      return { success: keys.length <= allow };
    },
  } as RateLimit;
  return { keys, binding };
}

const agentEnv = (id: string | undefined, limit: RateLimit = fakeLimit().binding) =>
  ({ COPILOT_REFERENCE_ID: id, PACKAGE_LIMIT: limit }) as McpEnv;
const get = (method = 'GET', headers: Record<string, string> = {}) => new Request(AGENT_URL, { method, headers });

test('the shared agent downloads as legallas-agent.zip, built with the configured ID, which is never logged', async (t) => {
  const logs = captureLogs(t);
  const response = await legallasAgent(get(), agentEnv(`  ${SHARED_ID}\n`));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/zip');
  assert.equal(response.headers.get('content-disposition'), 'attachment; filename="legallas-agent.zip"');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  const zip = Buffer.from(await response.arrayBuffer());
  assert.deepEqual(zip, buildPackage(readPackage(), SHARED_ID), 'byte for byte what node build.ts writes');
  assert.deepEqual(zipProblems(zip), []);
  const file = (name: string) => JSON.parse(new TextDecoder().decode(readZipStore(zip).find((e) => e.name === name)!.data));
  assert.equal(file('ai-plugin.json').runtimes[0].auth.reference_id, SHARED_ID);
  assert.equal(file('manifest.json').version, PACKAGE_VERSION);
  assert.deepEqual(logs, ['copilot_agent_built']);
});

test('HEAD answers like GET without the bytes; other methods get a 405', async (t) => {
  captureLogs(t);
  const head = await legallasAgent(get('HEAD'), agentEnv(SHARED_ID));
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-disposition'), 'attachment; filename="legallas-agent.zip"');
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  for (const method of ['POST', 'PUT', 'DELETE']) {
    const response = await legallasAgent(new Request(AGENT_URL, { method }), agentEnv(SHARED_ID));
    assert.equal(response.status, 405, method);
    assert.equal(response.headers.get('allow'), 'GET, HEAD');
  }
});

test('unset, the download is a clear 404 page pointing at the per-firm steps', async (t) => {
  const logs = captureLogs(t);
  for (const id of [undefined, '', '   ']) {
    assert.equal(agentConfigured(agentEnv(id)), false, JSON.stringify(id));
    const response = await legallasAgent(get(), agentEnv(id));
    assert.equal(response.status, 404, JSON.stringify(id));
    assert.match(response.headers.get('content-type') ?? '', /^text\/html/);
    const html = await response.text();
    assert.match(html, /Not offered yet/);
    assert.ok(html.includes(`${MCP_ORIGIN}/connect#copilot-it`), 'names where the per-firm steps are');
  }
  assert.ok(AGENT_NOT_OFFERED.includes("your firm's own"));
  assert.deepEqual(logs, ['copilot_agent_unset', 'copilot_agent_unset', 'copilot_agent_unset']);
});

test('a malformed ID is a 404 too, flagged as bad config, and never echoed or logged', async (t) => {
  const logs = captureLogs(t);
  for (const id of ['has space', 'quote"d', 'x'.repeat(257), '${{LEGALLAS_OAUTH_REFERENCE_ID}}']) {
    const response = await legallasAgent(get(), agentEnv(id));
    assert.equal(response.status, 404, id);
    assert.ok(!(await response.text()).includes(id), 'not echoed');
  }
  for (const id of ['has space', '${{LEGALLAS_OAUTH_REFERENCE_ID}}']) assert.equal(agentConfigured(agentEnv(id)), false, `${id}: /connect keeps the form`);
  assert.equal(agentConfigured(agentEnv(` ${SHARED_ID} `)), true);
  assert.deepEqual(logs, Array(4).fill('copilot_agent_bad_config'));
});

test('PACKAGE_LIMIT limits the GET per client IP, with a page and Retry-After; a broken binding fails open', async (t) => {
  const logs = captureLogs(t);
  const limit = fakeLimit(1);
  const ip = { 'CF-Connecting-IP': '203.0.113.7' };
  assert.equal((await legallasAgent(get('GET', ip), agentEnv(SHARED_ID, limit.binding))).status, 200);
  const limited = await legallasAgent(get('GET', ip), agentEnv(SHARED_ID, limit.binding));
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '60');
  assert.match(await limited.text(), /Too many downloads/);
  assert.deepEqual(limit.keys, ['203.0.113.7', '203.0.113.7']);
  const unset = fakeLimit(0);
  assert.equal((await legallasAgent(get(), agentEnv('', unset.binding))).status, 429, 'every request counts, set up or not');
  assert.deepEqual(unset.keys, ['unknown']);
  const broken = { async limit() { throw new Error('down'); } } as unknown as RateLimit;
  assert.equal((await legallasAgent(get(), agentEnv(SHARED_ID, broken))).status, 200);
  assert.equal((await legallasAgent(get(), { COPILOT_REFERENCE_ID: SHARED_ID } as McpEnv)).status, 200, 'missing binding');
  assert.deepEqual(logs, [
    'copilot_agent_built',
    `mcp_rate_limited ${AGENT_ZIP_PATH}`,
    `mcp_rate_limited ${AGENT_ZIP_PATH}`,
    `mcp_ratelimit_error ${AGENT_ZIP_PATH}`,
    'copilot_agent_built',
    `mcp_ratelimit_error ${AGENT_ZIP_PATH}`,
    'copilot_agent_built',
  ]);
});

/** Every JSON key in a value, at any depth. */
function keys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keys);
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, child]) => [key, ...keys(child)]);
}

test('no secret can reach the ZIP: the route reads only the ID, the limit and the room\'s kind from env, and the package holds no credential', async (t) => {
  captureLogs(t);
  // Every other env value a secret could live in (ACCESS_AUD, CONTROL_PREFIX, the OAuth KV, ...) reads as a marker.
  const read = new Set<string>();
  const env = new Proxy({}, {
    get(_target, key) {
      if (typeof key !== 'string') return undefined;
      read.add(key);
      if (key === 'COPILOT_REFERENCE_ID') return SHARED_ID;
      if (key === 'PACKAGE_LIMIT') return fakeLimit().binding;
      return `SECRET-MARKER-${key}`;
    },
  }) as McpEnv;
  const zip = Buffer.from(await (await legallasAgent(get(), env)).arrayBuffer());
  // COMPANY_ROOM_ENABLED reads as a marker, not "1", so the room's FILES are never asked (worker/room-shape.ts).
  assert.deepEqual([...read].sort(), ['COMPANY_ROOM_ENABLED', 'COPILOT_REFERENCE_ID', 'PACKAGE_LIMIT']);
  assert.ok(!zip.includes('SECRET-MARKER'), 'no env value in the bytes');
  assert.deepEqual(zip, buildPackage(bundledPackage(), SHARED_ID), 'a function of the bundled files and the ID alone');
  const forbidden = /secret|password|client_?id|api_?key|token|bearer|credential/i;
  for (const entry of readZipStore(zip).filter((e) => e.name.endsWith('.json'))) {
    const found = keys(JSON.parse(new TextDecoder().decode(entry.data))).filter((key) => forbidden.test(key));
    assert.deepEqual(found, [], `${entry.name}: no credential field`);
  }
  const plugin = JSON.parse(new TextDecoder().decode(readZipStore(zip).find((e) => e.name === 'ai-plugin.json')!.data));
  assert.deepEqual(plugin.runtimes[0].auth, { type: 'OAuthPluginVault', reference_id: SHARED_ID }, 'the auth block is the ID only');
});

test('the agent IT uploads has the name the setup page tells members to choose: "Legallas company room" in a company room (#883)', async (t) => {
  captureLogs(t);
  /** A company-room setting, with or without a published matter (worker/room-shape.ts). */
  const room = (matter: boolean) =>
    ({ ...agentEnv(SHARED_ID), COMPANY_ROOM_ENABLED: '1', FILES: { head: async () => (matter ? {} : null) } }) as unknown as McpEnv;
  const names = async (response: Response) => {
    const zip = new Uint8Array(await response.arrayBuffer());
    assert.deepEqual(zipProblems(zip), [], 'the package still validates');
    const file = (name: string) => JSON.parse(new TextDecoder().decode(readZipStore(zip).find((e) => e.name === name)!.data));
    return { agent: file('declarativeAgent.json').name, full: file('manifest.json').name.full, json: readZipStore(zip).filter((e) => e.name.endsWith('.json')) };
  };
  // What mcp/index.ts serves at /connect: a company room's page through roomWords, a case room's as rendered.
  const pages = { company: roomWords(renderConnectPage({ copilotPackage: true }), true), matter: renderConnectPage({ copilotPackage: true }) };
  const shared = await names(await legallasAgent(get(), room(false)));
  const own = await names(await copilotPackage(post(`reference_id=${REFERENCE_ID}`), room(false)));
  for (const built of [shared, own]) {
    assert.equal(built.agent, 'Legallas company room');
    assert.equal(built.full, built.agent, 'the manifest names it the same');
    assert.ok(pages.company.includes(`and choose <strong>${built.agent}</strong>.`), 'the page names that agent');
    for (const entry of built.json) assert.ok(!new TextDecoder().decode(entry.data).includes('counsel room'), `${entry.name}: no counsel room`);
  }
  const matter = await names(await legallasAgent(get(), room(true)));
  assert.equal(matter.agent, 'Legallas counsel room', 'a published matter: a case room, as before');
  assert.ok(pages.matter.includes(`and choose <strong>${matter.agent}</strong>.`), 'and its page names that agent');
});
