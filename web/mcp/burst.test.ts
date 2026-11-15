// SPDX-License-Identifier: Apache-2.0
// The per-member tool-call burst limit (TOOL_LIMIT, worker/burst.ts) in front of the daily cap.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { testDb } from '../worker/sqlite-d1.ts';
import type { McpEnv, Props, ToolDefinition } from './contract.ts';
import { runTool } from './server.ts';

const PROPS: Props = { email: 'counsel@example.test', role: 'counsel', clientId: 'client-1', clientName: 'Claude' };

function setup(limit: RateLimit | undefined) {
  const { db, sqlite } = testDb();
  sqlite.prepare("INSERT INTO members (email, role, name) VALUES (?, 'counsel', 'Counsel')").run(PROPS.email);
  const env = { DB: db, TEAM_DOMAIN: '', ACCESS_AUD: '', TOOL_LIMIT: limit } as unknown as McpEnv;
  let calls = 0;
  const tool: ToolDefinition = {
    name: 'legallas_search',
    title: 't',
    description: 'd',
    inputSchema: z.object({}),
    handler: async () => {
      calls++;
      return { content: [{ type: 'text', text: 'ok' }] };
    },
  };
  return { env, sqlite, tool, calls: () => calls };
}

test('over TOOL_LIMIT a call is a coded rate_limited error, keyed by member, and the daily cap is not spent', async () => {
  const keys: string[] = [];
  const limit = { async limit({ key }: { key: string }) { keys.push(key); return { success: keys.length <= 1 }; } } as RateLimit;
  const s = setup(limit);
  assert.equal((await runTool(s.tool, {}, s.env, PROPS, undefined, new Date())).isError, undefined);
  const out = await runTool(s.tool, {}, s.env, PROPS, undefined, new Date());
  assert.equal(out.isError, true);
  assert.match(JSON.stringify(out), /rate_limited/);
  assert.deepEqual(keys, [PROPS.email, PROPS.email]);
  assert.equal(s.calls(), 1);
  assert.equal((s.sqlite.prepare('SELECT tool_calls FROM usage').get() as { tool_calls: number }).tool_calls, 1);
});

test('a missing or broken TOOL_LIMIT fails open', async () => {
  const unset = setup(undefined);
  assert.equal((await runTool(unset.tool, {}, unset.env, PROPS, undefined, new Date())).isError, undefined);
  const broken = setup({ async limit() { throw new Error('down'); } } as unknown as RateLimit);
  const original = console.error;
  console.error = () => {};
  try {
    assert.equal((await runTool(broken.tool, {}, broken.env, PROPS, undefined, new Date())).isError, undefined);
  } finally {
    console.error = original;
  }
  assert.equal(broken.calls(), 1);
});
