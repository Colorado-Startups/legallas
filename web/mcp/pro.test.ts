// SPDX-License-Identifier: Apache-2.0
// Pro on the remote MCP server (pro.ts): its two tools at their old places, so clients list the nine contract tools
// in contract order, and its Copilot package pages and /connect options in the registry (extensions.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testDb } from '../worker/sqlite-d1.ts';
import { CLAUDE_PLUGIN_PATH, claudePlugin } from './claude-plugin.ts';
import { COPILOT_PACKAGE_PATH, TOOL_NAMES, type McpEnv, type Props } from './contract.ts';
import { copilotPackage, legallasAgent } from './copilot-package.ts';
import { addedPage, connectOptions } from './extensions.ts';
import { AGENT_ZIP_PATH } from './pages/connect-copilot.ts';
import './pro.ts';
import { serveMcp } from './server.ts';
import { listedTools } from './tools/index.ts';

const PROPS: Props = { email: 'counsel@example.test', role: 'counsel', clientId: 'client-1', clientName: 'Claude' };

test('with pro, the server lists the nine contract tools in contract order', async () => {
  assert.deepEqual(listedTools().map((tool) => tool.name), [...TOOL_NAMES]);
  const { db, sqlite } = testDb();
  sqlite.prepare("INSERT INTO members (email, role, name) VALUES (?, 'counsel', 'Counsel')").run(PROPS.email);
  const request = new Request('https://mcp.example.test/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-11-25' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });
  const text = await (await serveMcp(request, { DB: db, TEAM_DOMAIN: '', ACCESS_AUD: '' } as unknown as McpEnv, PROPS)).text();
  const data = text.split('\n').find((line) => line.startsWith('data: '));
  assert.ok(data, text.slice(0, 200));
  const listed = (JSON.parse(data.slice('data: '.length)).result.tools as { name: string }[]).map((tool) => tool.name);
  assert.deepEqual(listed, [...TOOL_NAMES]);
});

test('pro adds the Copilot package pages and the Claude plugin, and offers the shared agent on /connect once its ID is set', () => {
  assert.equal(addedPage(COPILOT_PACKAGE_PATH), copilotPackage);
  assert.equal(addedPage(AGENT_ZIP_PATH), legallasAgent);
  assert.equal(addedPage(CLAUDE_PLUGIN_PATH), claudePlugin);
  assert.equal(addedPage('/connect/other'), undefined);
  assert.deepEqual(connectOptions({} as never), { claudePlugin: true });
  assert.deepEqual(connectOptions({ COPILOT_REFERENCE_ID: ' id-1 ' } as never), { claudePlugin: true, copilotPackage: true, copilotReferenceId: 'id-1' });
});
