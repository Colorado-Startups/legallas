// SPDX-License-Identifier: Apache-2.0
// /activity/ is the owner's ledger. Counsel get its no-access state from /api/me's can.viewActivity,
// without the page asking /api/activity for a 403 (which the browser logs as an error). A Worker that predates
// viewActivity leaves the decision to the API, as before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { meCan } from './room-me.ts';

const source = readFileSync(join(import.meta.dirname, 'activity.ts'), 'utf8');

/** meCan('viewActivity') against one /api/me answer, on a fresh window (loadMe keeps one request per page). */
async function canViewActivity(me: unknown): Promise<boolean> {
  const g = globalThis as { window?: unknown };
  const had = 'window' in g;
  const before = g.window;
  const original = globalThis.fetch;
  g.window = {};
  globalThis.fetch = (async () => Response.json(me)) as typeof fetch;
  try {
    return await meCan('viewActivity');
  } finally {
    globalThis.fetch = original;
    if (had) g.window = before;
    else delete g.window;
  }
}

test('/api/me decides: the owner may view activity; counsel may not', async () => {
  assert.equal(await canViewActivity({ email: 'o@example.test', role: 'owner', name: null, can: { viewActivity: true } }), true);
  assert.equal(await canViewActivity({ email: 'c@example.test', role: 'counsel', name: null, can: { viewActivity: false } }), false);
});

test('a Worker that does not report viewActivity leaves it to the API (unknown counts as yes)', async () => {
  assert.equal(await canViewActivity({ email: 'c@example.test', role: 'counsel', name: null, can: { comment: true } }), true);
});

test('the page asks /api/me before it requests /api/activity, and shows the no-access state when refused', () => {
  const start = source.slice(source.indexOf('async function start()'));
  assert.match(start, /^async function start\(\): Promise<void> \{\s*if \(!\(await meCan\('viewActivity'\)\)\) return showDenied\(\);\s*await load\(null\);/);
  assert.match(source, /\nvoid start\(\);\n/);
  assert.doesNotMatch(source, /\nvoid load\(null\);/, 'nothing requests the ledger before the check');
  assert.equal(source.match(/fetch\(`\/api\/activity/g)?.length, 1, 'one request site, inside load()');
});
