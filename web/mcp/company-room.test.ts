// SPDX-License-Identifier: Apache-2.0
// A room with no published matter never hears "counsel room" from the MCP server (card 12.1); a case room hears it as before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testDb } from '../worker/sqlite-d1.ts';
import type { McpEnv, Props } from './contract.ts';
import { roomWords } from './room-words.ts';
import { serveMcp } from './server.ts';

const PROPS: Props = { email: 'founder@example.test', role: 'counsel', clientId: 'client-1', clientName: 'Claude' };
const INIT = { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } };

/** `matter`: whether the room has published one (the manifest is in R2). */
function envFor(matter: boolean, member = true): McpEnv {
  const { db, sqlite } = testDb();
  if (member) sqlite.prepare("INSERT INTO members (email, role, name) VALUES (?, 'counsel', 'Founder')").run(PROPS.email);
  const FILES = { head: async () => (matter ? {} : null) };
  return { DB: db, TEAM_DOMAIN: '', ACCESS_AUD: '', COMPANY_ROOM_ENABLED: '1', FILES } as unknown as McpEnv;
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

async function surface(env: McpEnv) {
  return JSON.stringify([
    (await rpc(env, 'initialize', INIT)).result,
    (await rpc(env, 'tools/list', {})).result,
    (await rpc(env, 'prompts/get', { name: 'matter_briefing', arguments: {} })).result,
    (await rpc(env, 'prompts/get', { name: 'topic_chronology', arguments: { topic: 'the lease' } })).result,
  ]);
}

test('roomWords renames the room only for a company room', () => {
  assert.equal(roomWords('the Acme counsel room, a litigation counsel room', false), 'the Acme counsel room, a litigation counsel room');
  assert.equal(roomWords('the Acme counsel room, a litigation counsel room', true), 'the Acme company room, a company room');
});

test('a room with no matter: title, instructions, tools and prompts never say "counsel room"', async () => {
  const written = await surface(envFor(false));
  assert.doesNotMatch(written, /counsel room/);
  assert.match(written, /Legallas company room/);
});

test('a room with no matter: a refused call says "company room"', async () => {
  const out = await rpc(envFor(false, false), 'tools/call', { name: 'legallas_search', arguments: { query: 'lease' } });
  assert.equal(out.result.isError, true);
  assert.doesNotMatch(out.result.content[0].text, /counsel room/);
  assert.match(out.result.content[0].text, /company room/);
});

test('a room with a matter keeps "counsel room"', async () => {
  assert.match(await surface(envFor(true)), /Legallas counsel room/);
});
