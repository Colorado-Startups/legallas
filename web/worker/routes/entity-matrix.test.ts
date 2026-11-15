// SPDX-License-Identifier: Apache-2.0
// GET /api/entity-matrix (worker/routes/entity-matrix.ts) through the real gate in room.ts: the law library off, on with an
// empty bucket, and on with a catalog. room-route-walk.test.ts checks who may reach it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matrixCites, type ResolvedMatrix } from '../entity-matrix.ts';
import type { Env } from '../env.ts';
import { resetLawCatalog } from '../law.ts';
import { bucket, ENTRY } from '../law-fixtures.ts';
import { handle } from '../room.ts';
import { testDb } from '../sqlite-d1.ts';

const HOST = 'http://localhost:8789';
const ME = 'counsel@example.test';

/** A LAW bucket that holds no catalog.json yet. */
const EMPTY_LAW = { get: async () => null } as unknown as R2Bucket;

async function matrix(settings: Partial<Env>): Promise<ResolvedMatrix> {
  resetLawCatalog();
  const { db, sqlite } = testDb();
  sqlite.prepare("INSERT INTO members (email, role, name) VALUES (?, 'counsel', NULL)").run(ME);
  const env = { ASSETS: { fetch: async () => new Response('shell') }, DB: db, TEAM_DOMAIN: '', ACCESS_AUD: '', ALLOW_DEV_IDENTITY: '1', DEV_IDENTITY_EMAIL: ME, ...settings } as unknown as Env;
  const response = await handle(new Request(`${HOST}/api/entity-matrix`), env, {} as ExecutionContext);
  assert.equal(response.status, 200);
  return (await response.json()) as ResolvedMatrix;
}

test('the law library off: every statute shows, none dated', async () => {
  const view = await matrix({});
  assert.deepEqual([view.law, view.cited, view.total], ['off', 0, matrixCites().length]);
  assert.deepEqual(view.forms.map((form) => form.id), ['co-llc', 'co-corp', 'de-corp']);
  assert.ok(view.factors.every((factor) => view.forms.every((form) => factor.cells[form.id].cites.length > 0)));
});

test('on with no catalog yet: empty, none dated', async () => {
  const view = await matrix({ LAW_LIBRARY: '1', LAW: EMPTY_LAW });
  assert.deepEqual([view.law, view.cited], ['empty', 0]);
});

test('on: a held statute carries its official link and as-of date', async () => {
  const entries = [ENTRY('del-8-228', 'civil', { retrieved: '2026-10-30' }), ENTRY('crs-7-90-501', 'civil', { retrieved: '2026-10-29' })];
  const view = await matrix({ LAW_LIBRARY: '1', LAW: bucket(entries).r2 });
  assert.deepEqual([view.law, view.cited], ['on', 2]);
  const consent = view.factors.find((factor) => factor.id === 'consent')!;
  assert.deepEqual(consent.cells['de-corp'].cites, [{ cite: '8 Del. C. § 228', law: { title: entries[0]!.title, url: entries[0]!.url, retrieved: '2026-10-30', source: entries[0]!.source } }]);
  assert.equal(consent.cells['co-llc'].cites[0]!.law, null);
});
