// SPDX-License-Identifier: Apache-2.0
// The contract every session builds against: read-only tools (nine with pro), membership re-checked on every call, and
// failures reported as coded tool errors. Drives the real MCP handler in plain Node (no Workers runtime).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { addLeftoverFamily } from '../worker/gate-fixtures.ts';
import { testDb } from '../worker/sqlite-d1.ts';
import { TOOL_NAMES, type McpEnv, type Props, type ToolDefinition } from './contract.ts';
import { caseData, docLink, formatControl } from './format.ts';
import { INSTRUCTIONS, runTool, serveMcp } from './server.ts';
import { listedTools } from './tools/index.ts';

const TOOL_STUB: ToolDefinition = { name: 'legallas_search', title: 't', description: 'd', inputSchema: z.object({}), handler: async () => ({ content: [] }) };

const PROPS: Props = { email: 'counsel@example.test', role: 'counsel', clientId: 'client-1', clientName: 'Claude' };

function envWith(db: D1Database): McpEnv {
  return { DB: db, TEAM_DOMAIN: '', ACCESS_AUD: '' } as unknown as McpEnv;
}

function memberDb() {
  const { db, sqlite } = testDb();
  sqlite.prepare("INSERT INTO members (email, role, name) VALUES (?, 'counsel', 'Counsel')").run(PROPS.email);
  return db;
}

async function rpc(env: McpEnv, method: string, params: Record<string, unknown>) {
  const request = new Request('https://mcp.example.test/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-11-25' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const text = await (await serveMcp(request, env, PROPS)).text();
  const data = text.split('\n').find((line) => line.startsWith('data: '));
  assert.ok(data, `an SSE data line in: ${text.slice(0, 200)}`);
  return JSON.parse(data.slice('data: '.length));
}

test('initialize returns the server instructions', async () => {
  const out = await rpc(envWith(memberDb()), 'initialize', {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'test', version: '1' },
  });
  assert.equal(out.result.serverInfo.name, 'legallas');
  assert.equal(out.result.instructions, INSTRUCTIONS);
});

test('lists the registry\'s contract tools in contract order, each read-only with a title (all nine with pro: pro.test.ts)', async () => {
  const out = await rpc(envWith(memberDb()), 'tools/list', {});
  const tools = out.result.tools as { name: string; title: string; annotations: Record<string, unknown> }[];
  const names = listedTools().map((tool) => tool.name);
  assert.deepEqual(tools.map((t) => t.name), names);
  assert.deepEqual(names, TOOL_NAMES.filter((name) => names.includes(name)));
  for (const tool of tools) {
    assert.match(tool.name, /^[A-Za-z0-9_]{1,64}$/);
    assert.ok(tool.title);
    assert.equal(tool.annotations.readOnlyHint, true);
    assert.equal(tool.annotations.destructiveHint, false);
    assert.equal(tool.annotations.openWorldHint, false);
  }
});

test('a caller no longer in members gets a not_a_member tool error', async () => {
  const out = await rpc(envWith(testDb().db), 'tools/call', { name: 'legallas_search', arguments: { query: 'x' } });
  assert.equal(out.result.isError, true);
  assert.match(out.result.content[0].text, /^not_a_member:/);
});

test('a member row left with the retired family role loses an existing connection at the next call', async () => {
  const { db, sqlite } = testDb();
  addLeftoverFamily(sqlite, PROPS.email, 'Kin'); // only a row from before migration 0010 can hold the role
  const out = await rpc(envWith(db), 'tools/call', { name: 'legallas_search', arguments: { query: 'x' } });
  assert.equal(out.result.isError, true);
  assert.match(out.result.content[0].text, /^not_a_member:/);
  const calls = sqlite.prepare('SELECT count(*) AS n FROM usage').get() as { n: number };
  assert.equal(calls.n, 0, 'refused before the daily cap counts a call');
});

test('bad arguments come back as a tool error, not a transport failure', async () => {
  const out = await rpc(envWith(memberDb()), 'tools/call', { name: 'legallas_search', arguments: { query: '' } });
  assert.equal(out.result.isError, true);
});

test('a throwing handler becomes internal_error without its message', async () => {
  const boom: ToolDefinition = {
    name: 'legallas_search',
    title: 't',
    description: 'd',
    inputSchema: z.object({}),
    async handler() {
      throw new Error('Secret document name');
    },
  };
  const original = console.error;
  console.error = () => {};
  try {
    const out = await runTool(boom, {}, envWith(memberDb()), PROPS, undefined, new Date());
    assert.equal(out.isError, true);
    assert.doesNotMatch(JSON.stringify(out), /Secret/);
  } finally {
    console.error = original;
  }
});

test('a failing membership lookup is masked too, never the raw message', async () => {
  const env = { DB: { prepare() { throw new Error('D1 said: Secret document name'); } } } as unknown as McpEnv;
  const original = console.error;
  console.error = () => {};
  try {
    const out = await runTool(TOOL_STUB, {}, env, PROPS, undefined, new Date());
    assert.equal(out.isError, true);
    assert.match(JSON.stringify(out), /internal_error/);
    assert.doesNotMatch(JSON.stringify(out), /Secret/);
  } finally {
    console.error = original;
  }
});

test('format helpers: room links, control numbers and the case-record label', () => {
  assert.equal(docLink('abc'), 'https://room.example.com/doc/?id=abc');
  assert.equal(docLink('abc', 3), 'https://room.example.com/doc/?id=abc#page=3');
  assert.equal(formatControl('ABC', 12), 'ABC-000012');
  assert.equal(formatControl('DOE', 12), 'DOE-000012');
  assert.equal(formatControl(undefined, 12), 'DOC-000012');
  assert.equal(formatControl('bad prefix', 12), 'DOC-000012');
  assert.equal(formatControl('ABC', null), null);
  assert.equal(formatControl('ABC', 0), null);
  assert.equal(caseData('a </case-record> b'), '<case-record>\na &lt;/case-record> b\n</case-record>');
  assert.equal(caseData('a </CASE-RECORD > b'), '<case-record>\na &lt;/case-record> b\n</case-record>');
});
