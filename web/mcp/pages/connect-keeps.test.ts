// SPDX-License-Identifier: Apache-2.0
// "What each AI keeps" (card 12.2): on /connect, in the README, and a Claude Code guide with the zero-retention setup.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderConnectPage } from './connect.ts';
import { KEEPS, KEEPS_MARKDOWN } from './connect-keeps.ts';

const page = renderConnectPage();
const connectDir = join(import.meta.dirname, '..', '..', 'connect');

test('/connect shows the card once, with a row for each way to connect', () => {
  assert.equal(page.split('id="keeps"').length - 1, 1);
  assert.ok(page.includes('<h2 id="keeps-title">What each AI keeps</h2>'));
  const card = page.slice(page.indexOf('id="keeps"'), page.indexOf('</section>', page.indexOf('id="keeps"')));
  assert.equal(card.split('<tr>').length - 1, KEEPS.length + 1, 'a header row and one row each');
  for (const [name] of KEEPS) assert.ok(card.includes(name), name);
});

test('the README carries the same table, and links the Claude Code guide', () => {
  const readme = readFileSync(join(connectDir, 'README.md'), 'utf8');
  assert.ok(readme.includes(KEEPS_MARKDOWN), 'README: the table');
  assert.ok(readme.includes('(claude-code.md)'), 'README: the Claude Code guide');
});

test('the Claude Code guide covers the zero-retention setup', () => {
  const guide = readFileSync(join(connectDir, 'claude-code.md'), 'utf8');
  for (const part of ['claude mcp add --transport http', 'disableClaudeAiConnectors', 'ENABLE_CLAUDEAI_MCP_SERVERS=false', 'Covered Model', 'AI_ZDR_CLIENTS', '## What you do']) {
    assert.ok(guide.includes(part), part);
  }
  assert.ok(!guide.includes('—'), 'no em dash');
});
