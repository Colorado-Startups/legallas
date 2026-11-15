// SPDX-License-Identifier: Apache-2.0
// The Worker entry for a room with pro (entry-pro.ts): the room's fetch handler from index.ts and the research chat's
// Durable Object class, under its bound name and its neutral one. index.ts itself must stay loadable under plain Node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test('entry-pro.ts exports the Durable Object class, so index.ts stays loadable under plain Node', async () => {
  const entry = readFileSync(join(import.meta.dirname, 'entry-pro.ts'), 'utf8');
  assert.match(entry, /^export \{ default \} from '\.\/index\.ts';$/m);
  assert.match(entry, /^export \{ LegallasResearch, LegallasResearch as ResearchAgent \} from '\.\/agent\/research\.ts';$/m);
  // Loading index.ts here, under Node, fails if anything it imports reaches cloudflare:workers or agents.
  const index = await import('./index.ts');
  const room = await import('./room.ts');
  assert.equal(index.handle, room.handle, 'pro serves through the core\'s gate');
});
