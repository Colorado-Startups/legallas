// SPDX-License-Identifier: Apache-2.0
// One fallback control prefix for the room's pages, its scripts and the MCP server, and never the fixture's (#217).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CONTROL_PREFIX_FALLBACK } from './control-prefix.ts';
import { CONTROL_PREFIX_FALLBACK as MCP_FALLBACK } from '../../mcp/contract.ts';
import { CONTROL_PREFIX_FALLBACK as SCRIPTS_FALLBACK } from '../../scripts/config.ts';

test('a room with no control prefix never numbers its documents as the fictional fixture does', () => {
  assert.match(CONTROL_PREFIX_FALLBACK, /^[A-Z]{2,6}$/, 'the shape Room.astro accepts');
  assert.notEqual(CONTROL_PREFIX_FALLBACK, 'DOE');
});

test('the page, the sync scripts and the MCP server share one fallback, so cites match everywhere', () => {
  assert.equal(MCP_FALLBACK, CONTROL_PREFIX_FALLBACK);
  assert.equal(SCRIPTS_FALLBACK, CONTROL_PREFIX_FALLBACK);
});

test('Room.astro takes the shared fallback, not a literal of its own', () => {
  const layout = readFileSync(new URL('../layouts/Room.astro', import.meta.url), 'utf8');
  const line = layout.split('\n').find((l) => l.startsWith('const controlPrefix ='));
  assert.ok(line, 'Room.astro sets controlPrefix');
  assert.match(line, /: CONTROL_PREFIX_FALLBACK;$/);
});
