// SPDX-License-Identifier: Apache-2.0
// Who changed the checklist (migration 0024): every match made, changed or removed, and every "doesn't apply" and "applies
// again", with who and when, in the owner's Activity feed. Ids and codes only. Real gate, real SQLite, invented fixture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Env } from './env.ts';
import { handle } from './room.ts';
import { testDb } from './sqlite-d1.ts';

const HOST = 'http://localhost:8789';
const OWNER = 'founder@example.test';

function room(checklist = '1') {
  const { db, sqlite } = testDb();
  sqlite.exec(`
    INSERT INTO members (email, role, name) VALUES ('${OWNER}', 'owner', 'Founder');
    INSERT INTO documents (id, path, folder, name, kind, content_type, size, r2_key, source, updated_at) VALUES
      ('doc-1', 'Company/DOE-bylaws.pdf', 'Company', 'DOE-bylaws.pdf', 'pdf', 'application/pdf', 1, 'k1', 'mirror', '2026-03-01T00:00:00.000Z');
  `);
  const env = { ASSETS: { fetch: async () => new Response('shell') }, DB: db, TEAM_DOMAIN: '', ACCESS_AUD: '', ALLOW_DEV_IDENTITY: '1', DEV_IDENTITY_EMAIL: OWNER, CHECKLIST_ENABLED: checklist } as unknown as Env;
  const call = (method: string, path: string, body?: unknown) =>
    handle(
      new Request(`${HOST}${path}`, {
        method,
        headers: method === 'GET' ? {} : { Origin: HOST, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      env,
      {} as ExecutionContext,
    );
  const events = () => sqlite.prepare('SELECT email, action, item_id, document_id FROM checklist_events ORDER BY id').all().map((row) => ({ ...row }));
  return { call, events, sqlite };
}

const MATCH = { itemId: 'formation.bylaws', documentId: 'doc-1' };

test('each change records who, what and when, and a no-op records nothing', async () => {
  const { call, events, sqlite } = room();
  await call('POST', '/api/checklist/matches', MATCH);
  await call('POST', '/api/checklist/matches', { ...MATCH, date: '2011-06-09', parties: 'Harbor Labs, Inc.' });
  await call('PUT', '/api/checklist/items/formation.bank-account/applies', { applies: false });
  await call('PUT', '/api/checklist/items/formation.bank-account/applies', { applies: true });
  await call('PUT', '/api/checklist/items/formation.bank-account/applies', { applies: true });
  const id = (sqlite.prepare('SELECT id FROM checklist_matches').get() as { id: string }).id;
  await call('DELETE', `/api/checklist/matches/${id}`);
  await call('DELETE', `/api/checklist/matches/${id}`);
  const by = (action: string, item_id: string, document_id: string | null) => ({ email: OWNER, action, item_id, document_id });
  assert.deepEqual(events(), [
    by('matched', 'formation.bylaws', 'doc-1'),
    by('match_changed', 'formation.bylaws', 'doc-1'),
    by('not_applicable', 'formation.bank-account', null),
    by('applies', 'formation.bank-account', null),
    by('unmatched', 'formation.bylaws', 'doc-1'),
  ]);
});

test('the owner sees them in Activity, with the item id and never a fact', async () => {
  const { call } = room();
  await call('POST', '/api/checklist/matches', { ...MATCH, parties: 'Harbor Labs, Inc.', amount: '$400' });
  const body = (await (await call('GET', '/api/activity')).json()) as { rows: { action: string; via: string | null; document_name: string | null; email: string }[] };
  const row = body.rows.find((r) => r.action === 'checklist_matched');
  assert.deepEqual(row && { via: row.via, document_name: row.document_name, email: row.email }, { via: 'formation.bylaws', document_name: 'DOE-bylaws.pdf', email: OWNER });
  assert.doesNotMatch(JSON.stringify(body), /Harbor Labs|\$400/);
});

test('with the checklist off, Activity shows none of it', async () => {
  const { call, sqlite } = room('0');
  sqlite.exec(`INSERT INTO checklist_events (email, action, item_id) VALUES ('${OWNER}', 'not_applicable', 'formation.bank-account')`);
  const body = (await (await call('GET', '/api/activity')).json()) as { rows: { action: string }[] };
  assert.equal(body.rows.some((r) => r.action.startsWith('checklist_')), false);
});

test('the record is append-only', () => {
  const { sqlite } = room();
  sqlite.exec(`INSERT INTO checklist_events (email, action, item_id) VALUES ('${OWNER}', 'matched', 'formation.bylaws')`);
  assert.throws(() => sqlite.exec("UPDATE checklist_events SET email = 'x@example.test'"), /append-only/);
  assert.throws(() => sqlite.exec('DELETE FROM checklist_events'), /append-only/);
});
