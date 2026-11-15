// SPDX-License-Identifier: Apache-2.0
// The MCP server's names (worker/room-names.ts, mcp/tool-prefix.ts). With nothing set, or with today's values set,
// the server says exactly what it did before: the same tool names, descriptions, instructions, title and prompts.
// A room that sets MCP_TOOL_PREFIX and INSTANCE_NAME gets them everywhere the server writes a tool or room name, and
// nowhere else. Drives the real MCP handler in plain Node, like server.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testDb } from '../worker/sqlite-d1.ts';
import { SERVER_TITLE, type McpEnv, type Props } from './contract.ts';
import { INSTRUCTIONS, serveMcp, serverTitle } from './server.ts';
import { withToolPrefix } from './tool-prefix.ts';
import { listedTools } from './tools/index.ts';
import { searchLawTool } from './tools/search-law.ts';

const PROPS: Props = { email: 'counsel@example.test', role: 'counsel', clientId: 'client-1', clientName: 'Claude' };
/** Every tool the server lists here, the law search last: the core's, and pro's when it is loaded (pro.test.ts). */
const LISTED = [...listedTools(), searchLawTool];
/**
 * Every tool name the server listed before the prefix was configurable, in order, the law search last; pro's two
 * (mcp/pro.ts) only when pro is loaded.
 */
const TODAY_NAMES = [
  'legallas_search',
  'legallas_case_overview',
  'legallas_list_documents',
  'legallas_get_document',
  'legallas_read_pages',
  'legallas_view_visual',
  'legallas_get_comments',
  'legallas_get_file',
  'legallas_template',
  'legallas_search_law',
].filter((name) => LISTED.some((tool) => tool.name === name));
const LAW_ON = { LAW_LIBRARY: '1', LAW: {}, LAW_SEARCH: {} } as unknown as Partial<McpEnv>;
const ACME = { INSTANCE_NAME: 'Acme', MCP_TOOL_PREFIX: 'acme_' };

function envWith(extra: Partial<McpEnv> = {}): McpEnv {
  const { db, sqlite } = testDb();
  sqlite.prepare("INSERT INTO members (email, role, name) VALUES (?, 'counsel', 'Counsel')").run(PROPS.email);
  return { DB: db, TEAM_DOMAIN: '', ACCESS_AUD: '', ...LAW_ON, ...extra } as unknown as McpEnv;
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

const INIT = { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } };

/** What a client sees: initialize, the tool list, the prompt list and each prompt's text. */
async function surface(env: McpEnv) {
  return {
    init: (await rpc(env, 'initialize', INIT)).result,
    tools: (await rpc(env, 'tools/list', {})).result,
    prompts: (await rpc(env, 'prompts/list', {})).result,
    violation: (await rpc(env, 'prompts/get', { name: 'violation_proof', arguments: { violation: 'A' } })).result,
    chronology: (await rpc(env, 'prompts/get', { name: 'topic_chronology', arguments: { topic: 'the cooler repair' } })).result,
  };
}

test("with nothing set, the server lists today's names, descriptions, instructions and title", async () => {
  const { init, tools } = await surface(envWith());
  assert.equal(init.serverInfo.title, 'Legallas counsel room');
  assert.equal(init.serverInfo.title, SERVER_TITLE);
  assert.equal(init.instructions, INSTRUCTIONS);
  const listed = tools.tools as { name: string; description: string }[];
  assert.deepEqual(listed.map((t) => t.name), TODAY_NAMES);
  assert.deepEqual(listed.map((t) => t.description), LISTED.map((t) => t.description));
});

test("today's values set explicitly change nothing a client sees", async () => {
  const unset = await surface(envWith());
  const explicit = await surface(envWith({ INSTANCE_NAME: 'Legallas', MCP_TOOL_PREFIX: 'legallas_' }));
  assert.equal(JSON.stringify(explicit), JSON.stringify(unset));
});

test('a malformed prefix or name falls back to the defaults', async () => {
  const unset = await surface(envWith());
  const bad = await surface(envWith({ INSTANCE_NAME: '<b>Acme</b>', MCP_TOOL_PREFIX: 'Acme-' }));
  assert.equal(JSON.stringify(bad), JSON.stringify(unset));
});

test("a renamed room's server names every tool by its prefix and itself by its name", async () => {
  const { init, tools, prompts, violation, chronology } = await surface(envWith(ACME));
  assert.equal(init.serverInfo.title, 'Acme counsel room');
  const listed = tools.tools as { name: string; description: string }[];
  assert.deepEqual(listed.map((t) => t.name), TODAY_NAMES.map((name) => name.replace('legallas_', 'acme_')));
  const written = JSON.stringify({ instructions: init.instructions, tools: listed, prompts, violation, chronology });
  assert.doesNotMatch(written, /legallas_/, 'no default tool name is left');
  assert.match(init.instructions, /acme_case_overview for the room's picture/);
  assert.match(violation.messages[0].content.text, /from the Acme counsel room/);
  assert.match(violation.messages[0].content.text, /Call acme_case_overview with section "violations"/);
  assert.match(chronology.messages[0].content.text, /^Build a chronology on the topic below from the Acme counsel room\./);
});

test("a renamed room's tools answer to the prefixed names only", async () => {
  const env = envWith(ACME);
  const renamed = await rpc(env, 'tools/call', { name: 'acme_list_documents', arguments: { cursor: 'not-a-cursor' } });
  assert.equal(renamed.result.isError, true);
  assert.equal(renamed.result.content[0].text, 'bad_cursor: Call acme_list_documents again without a cursor to start from the first page.');
  const old = await rpc(env, 'tools/call', { name: 'legallas_list_documents', arguments: {} });
  assert.ok(old.error || old.result?.isError, 'the default name is not listed, so it is not callable');
});

test("a tool's hint keeps today's wording with nothing set", async () => {
  const out = await rpc(envWith(), 'tools/call', { name: 'legallas_list_documents', arguments: { cursor: 'not-a-cursor' } });
  assert.equal(out.result.content[0].text, 'bad_cursor: Call legallas_list_documents again without a cursor to start from the first page.');
});

test('withToolPrefix renames whole tool names only, and only for a prefix other than the default', () => {
  const text = 'Use legallas_search, then legallas_search_law; legallas_read_pages reads legallas-index and legallas_files.';
  assert.equal(withToolPrefix(text, undefined), text);
  assert.equal(withToolPrefix(text, 'legallas_'), text);
  assert.equal(withToolPrefix(text, 'acme_'), 'Use acme_search, then acme_search_law; acme_read_pages reads legallas-index and legallas_files.');
  assert.equal(serverTitle({ instanceName: 'Legallas' }), SERVER_TITLE);
});
