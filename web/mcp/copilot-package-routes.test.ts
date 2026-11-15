// SPDX-License-Identifier: Apache-2.0
// The Copilot package pages and the /connect offer that pro adds to the remote MCP server (mcp/pro.ts), through
// oauth.ts route() as clients reach them. The handlers themselves: copilot-package.test.ts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CONNECT_PATH, MCP_ORIGIN, type McpEnv } from './contract.ts';
import { route } from './oauth.ts';
import { fakeEnv, fakeOAuth } from './oauth-fakes.ts';
import { AGENT_ZIP_PATH } from './pages/connect-copilot.ts';
import { renderConnectPage } from './pages/connect.ts';
import './pro.ts';

test('through oauth.ts route(), the shared agent route pro adds: a 404 page by default, the ZIP once COPILOT_REFERENCE_ID is set', async (t) => {
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'warn', () => {});
  const limit = { async limit() { return { success: true }; } } as RateLimit;
  const url = `${MCP_ORIGIN}${AGENT_ZIP_PATH}`;
  const unset = await route(new Request(url), fakeEnv(fakeOAuth(), { PACKAGE_LIMIT: limit }));
  assert.equal(unset.status, 404);
  assert.match(await unset.text(), /Not offered yet/);
  const env = fakeEnv(fakeOAuth(), { PACKAGE_LIMIT: limit, COPILOT_REFERENCE_ID: 'U2hhcmVkUmVnaXN0cmF0aW9uSWQ' });
  const zip = await route(new Request(url), env);
  assert.equal(zip.status, 200);
  assert.equal(zip.headers.get('content-type'), 'application/zip');
  assert.ok((await zip.arrayBuffer()).byteLength > 0);
  const head = await route(new Request(url, { method: 'HEAD' }), env);
  assert.equal(head.status, 200);
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  for (const method of ['POST', 'PUT', 'DELETE']) {
    const refused = await route(new Request(url, { method }), env);
    assert.equal(refused.status, 405, method);
    assert.equal(refused.headers.get('allow'), 'GET, HEAD');
  }
});

test('/connect with pro: a shared registration ID shows in the connector steps, trimmed, and the page offers the download', async () => {
  const on = await route(new Request(`${MCP_ORIGIN}${CONNECT_PATH}`), { COPILOT_REFERENCE_ID: ' test-registration-id\n' } as McpEnv);
  assert.equal(await on.text(), renderConnectPage({ claudePlugin: true, copilotPackage: true, copilotReferenceId: 'test-registration-id' }));
  const off = await route(new Request(`${MCP_ORIGIN}${CONNECT_PATH}`), {} as McpEnv);
  assert.equal(await off.text(), renderConnectPage({ claudePlugin: true }), 'the Claude plugin is always offered');
});
