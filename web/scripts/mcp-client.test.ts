// SPDX-License-Identifier: Apache-2.0
// The MCP client half of the legallas-mcp smoke: reply parsing (JSON and SSE), both protocol revisions against
// the real server handler (mcp/server.ts, run in-process on a SQLite D1), result summaries, and the mirrored
// contract constants. mcp/ and worker/ modules are loaded at runtime because their Workers types are outside
// the scripts tsconfig (see scripts/mcp-constants.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstId, LEGACY_VERSION, McpSession, MODERN_VERSION, replyFrom, resultValue, summarizeTool, toolCallOk } from './mcp-client.ts';
import * as constants from './mcp-constants.ts';
import { loadModule } from './load-module.ts';

test('replies are found by id in a JSON body, a JSON batch or an SSE stream', () => {
  const sse = 'event: message\ndata: {"jsonrpc":"2.0","method":"notifications/x"}\n\nevent: message\ndata: {"jsonrpc":"2.0","id":7,"result":{"ok":1}}\n\n';
  assert.deepEqual(replyFrom(200, 'text/event-stream', sse, 7), { status: 200, result: { ok: 1 }, error: null });
  assert.deepEqual(replyFrom(200, 'application/json', '[{"id":1,"result":{}},{"id":2,"result":{"b":2}}]', 2).result, { b: 2 });
  assert.equal(replyFrom(400, 'application/json', '{"jsonrpc":"2.0","id":3,"error":{"code":-32602,"message":"secret text"}}', 3).error, 'rpc_-32602');
  assert.equal(replyFrom(401, 'text/plain', 'Unauthorized', 4).error, 'http_401');
  assert.equal(replyFrom(200, 'application/json', '{"id":9,"result":{}}', 4).error, 'no_reply');
});

test('tool results are summarized as flags, codes and lengths, never their text', () => {
  const coded = summarizeTool({ isError: true, content: [{ type: 'text', text: 'not_found: Secret document name' }] });
  assert.deepEqual(coded, { isError: true, code: 'not_found', textLength: 31, structured: false });
  assert.equal(toolCallOk(coded), true);
  assert.equal(toolCallOk(summarizeTool({ isError: true, content: [{ type: 'text', text: 'internal_error: x' }] })), false);
  assert.equal(toolCallOk(summarizeTool({ isError: true, content: [{ type: 'text', text: 'Something broke' }] })), false, 'an uncoded error fails');
  assert.equal(toolCallOk(summarizeTool({ content: [{ type: 'text', text: '{}' }], structuredContent: {} })), true);
  assert.doesNotMatch(JSON.stringify(coded), /Secret/);
});

test('firstId finds the first string id depth-first', () => {
  assert.equal(firstId({ total: 2, documents: [{ name: 'a', id: 'doc-1' }, { id: 'doc-2' }] }), 'doc-1');
  assert.equal(firstId({ id: 'top' }), 'top');
  assert.equal(firstId({ rows: [{ id: 3 }] }), null);
  assert.equal(firstId(null), null);
});

test('resultValue reads structured content, or the JSON text a compact result sends', () => {
  assert.deepEqual(resultValue({ structuredContent: { a: 1 }, content: [{ type: 'text', text: '{"a":2}' }] }), { a: 1 });
  assert.deepEqual(resultValue({ content: [{ type: 'text', text: '{"a":2}' }] }), { a: 2 });
  for (const result of [null, undefined, {}, { content: [{ type: 'text', text: 'daily_limit: wait' }] }, { content: [{ type: 'text', text: '[1]' }] }, { content: [{ type: 'image', data: 'x' }] }]) {
    assert.equal(resultValue(result as Record<string, unknown> | null), null, JSON.stringify(result));
  }
});

test('the mirrored constants equal mcp/contract.ts', async () => {
  const contract = await loadModule<Record<string, unknown>>('mcp/contract.ts');
  for (const key of ['MCP_ORIGIN', 'MCP_RESOURCE', 'SCOPE_READ', 'MAX_SEARCH_RESULTS', 'SMOKE_CLIENT_NAME', 'TOOL_NAMES', 'LAW_TOOL_NAME', 'READ_ONLY_ANNOTATIONS'] as const) {
    assert.deepEqual(constants[key], contract[key], key);
  }
});

/** The real MCP handler as a fetch function, for one member, with the tool stubs or handlers on main. */
async function realServer(): Promise<(input: string | URL | Request, init?: RequestInit) => Promise<Response>> {
  const { testDb } = await loadModule<{ testDb(): { db: unknown; sqlite: { prepare(sql: string): { run(...a: unknown[]): unknown } } } }>('worker/sqlite-d1.ts');
  const { serveMcp } = await loadModule<{ serveMcp(r: Request, env: unknown, props: unknown): Promise<Response> }>('mcp/server.ts');
  const { db, sqlite } = testDb();
  sqlite.prepare("INSERT INTO members (email, role, name) VALUES (?, 'counsel', 'Counsel')").run('counsel@example.test');
  const props = { email: 'counsel@example.test', role: 'counsel', clientId: 'c', clientName: 'Smoke' };
  return async (input, init) => serveMcp(new Request(input, init), { DB: db, TEAM_DOMAIN: '', ACCESS_AUD: '' }, props);
}

/** What that server lists: the core's tools (pro's, mcp/pro.ts, are not loaded here), contract tools in contract order. */
async function listedNames(): Promise<string[]> {
  const { listedTools } = await loadModule<{ listedTools(): readonly { name: string }[] }>('mcp/tools/index.ts');
  const names = listedTools().map((tool) => tool.name);
  assert.deepEqual(names, constants.TOOL_NAMES.filter((name) => names.includes(name)));
  return names;
}

test('2025-11-25 against the real handler: initialize, then tools/list shows the five read-only tools', async () => {
  const session = new McpSession(await realServer(), 'https://mcp.example.test/mcp', 'token', LEGACY_VERSION);
  const opened = await session.open();
  assert.equal(opened.agreed, LEGACY_VERSION);
  const list = await session.listTools();
  const tools = list.result!.tools as { name: string; annotations: Record<string, unknown> }[];
  assert.deepEqual(tools.map((t) => t.name), await listedNames());
  for (const tool of tools) assert.equal(tool.annotations.readOnlyHint, true);
});

test('2026-07-28 against the real handler: server/discover, tools/list and a tools/call with the envelope', async () => {
  const session = new McpSession(await realServer(), 'https://mcp.example.test/mcp', 'token', MODERN_VERSION);
  const opened = await session.open();
  assert.equal(opened.error, null);
  assert.equal(opened.agreed, MODERN_VERSION);
  assert.deepEqual(((await session.listTools()).result!.tools as { name: string }[]).map((tool) => tool.name), await listedNames());
  const call = await session.callTool('legallas_get_document', { id: 'no-such-doc' });
  assert.equal(call.error, null, 'the envelope and Mcp-Name header are accepted');
  assert.equal(typeof summarizeTool(call.result).isError, 'boolean');
  const prompt = await session.request('prompts/get', { name: 'matter_briefing', arguments: {} });
  assert.equal(prompt.error, null, 'prompts/get needs Mcp-Name too (SEP-2243), else -32020');
  assert.ok(Array.isArray(prompt.result?.messages));
});
