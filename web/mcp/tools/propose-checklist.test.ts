// SPDX-License-Identifier: Apache-2.0
// legallas_propose_checklist (mcp/tools/propose-checklist.ts) through the real MCP handler on real SQLite: listed only
// with proposals and the checklist both on, on a connection that may propose; an unknown item id is refused; a call
// stores one pending checklist_update and changes no checklist row. The fixture is invented (Doe v. Harbor Labs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testDb } from '../../worker/sqlite-d1.ts';
import { PROPOSE_CHECKLIST_TOOL_NAME, PROPOSE_TOOL_NAME, type McpEnv, type Props } from '../contract.ts';
import { serveMcp } from '../server.ts';

const READ_ONLY: Props = { email: 'ada@firm.example', role: 'counsel', clientId: 'client-1', clientName: 'Claude' };
const COUNSEL: Props = { ...READ_ONLY, propose: true };
const ON = { PROPOSALS_ENABLED: '1', CHECKLIST_ENABLED: '1' };

function room(vars: Record<string, string> = ON) {
  const { db, sqlite } = testDb();
  sqlite.exec(`INSERT INTO members (email, role, name) VALUES ('founder@example.test', 'owner', 'Founder'), ('${COUNSEL.email}', 'counsel', NULL);`);
  return { sqlite, env: { DB: db, TEAM_DOMAIN: '', ACCESS_AUD: '', ...vars } as unknown as McpEnv };
}

async function rpc(env: McpEnv, method: string, params: Record<string, unknown>, props: Props = COUNSEL) {
  const request = new Request('https://mcp.example.test/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-11-25' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const text = await (await serveMcp(request, env, props)).text();
  const data = text.split('\n').find((line) => line.startsWith('data: '));
  assert.ok(data, `an SSE data line in: ${text.slice(0, 200)}`);
  return JSON.parse(data.slice('data: '.length));
}

async function names(env: McpEnv, props: Props = COUNSEL): Promise<string[]> {
  return ((await rpc(env, 'tools/list', {}, props)).result.tools as { name: string }[]).map((tool) => tool.name);
}

const call = (env: McpEnv, args: Record<string, unknown>) => rpc(env, 'tools/call', { name: PROPOSE_CHECKLIST_TOOL_NAME, arguments: args });
const ARGS = { item_id: 'formation.bylaws', applies: false, why: 'Harbor Labs is an LLC, so it has no bylaws.' };

test('listed after the draft tool only with proposals and the checklist both on, on a connection that may propose', async () => {
  assert.deepEqual((await names(room().env)).slice(-2), [PROPOSE_TOOL_NAME, PROPOSE_CHECKLIST_TOOL_NAME]);
  const offs: Record<string, string>[] = [{ PROPOSALS_ENABLED: '1' }, { CHECKLIST_ENABLED: '1' }, {}];
  for (const vars of offs) {
    assert.ok(!(await names(room(vars).env)).includes(PROPOSE_CHECKLIST_TOOL_NAME), JSON.stringify(vars));
  }
  assert.ok(!(await names(room().env, READ_ONLY)).includes(PROPOSE_CHECKLIST_TOOL_NAME), 'a read-only connection');
});

test('a call stores one pending checklist_update and changes no checklist row; an unknown id or an extra field stores nothing', async () => {
  const { env, sqlite } = room();
  for (const args of [{ ...ARGS, item_id: 'formation.nope' }, { ...ARGS, item_id: '../x' }, { ...ARGS, status: 'approved' }, { ...ARGS, applies: 'no' }]) {
    const out = await call(env, args);
    assert.equal(out.result?.isError ?? Boolean(out.error), true, JSON.stringify(args));
  }
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM proposals').get()?.n, 0);
  const out = await call(env, ARGS);
  assert.equal(out.result.isError, undefined, JSON.stringify(out.result));
  assert.deepEqual(sqlite.prepare('SELECT kind, status, proposed_by FROM proposals').all().map((row) => ({ ...row })), [
    { kind: 'checklist_update', status: 'pending', proposed_by: COUNSEL.email },
  ]);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM checklist_not_applicable').get()?.n, 0);
});
