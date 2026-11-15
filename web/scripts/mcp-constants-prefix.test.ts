// SPDX-License-Identifier: Apache-2.0
// The connector test calls a room's own tool names when the room sets a prefix (#58). node --test runs this file in its
// own process, so the setting below is in place before mcp-constants.ts first loads.
import { test } from 'node:test';
import assert from 'node:assert/strict';

test("tool names carry the room's prefix, and a malformed one falls back as the Workers do", async () => {
  (globalThis as Record<string, unknown>).ROOM_TOOL_PREFIX = 'acme_';
  const constants = await import('./mcp-constants.ts');
  const kinds = await import('./connect-e2e-kinds.ts');
  assert.equal(constants.TOOL_PREFIX, 'acme_');
  assert.ok(constants.TOOL_NAMES.every((name) => name.startsWith('acme_')), constants.TOOL_NAMES.join(', '));
  assert.equal(constants.LAW_TOOL_NAME, 'acme_search_law');
  assert.ok(kinds.CONNECT_PLAN.every((call) => call.tool.startsWith('acme_')), 'every planned call');
  const { roomNames } = await import('../worker/room-names.ts');
  for (const raw of ['acme_', ' acme_ ', 'Bad Prefix', 'acme', '_acme_', 'a'.repeat(17) + '_', '', undefined, 7]) {
    assert.equal(constants.toolPrefixOf(raw), roomNames({ toolPrefix: raw }).toolPrefix, `the Workers' rule for ${String(raw)}`);
  }
});
