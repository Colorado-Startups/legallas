// SPDX-License-Identifier: Apache-2.0
// The checklist_update kind (worker/proposal-checklist.ts) on real SQLite with the real migrations: an unknown item id is
// refused, the checklist changes only when the owner approves, and a rejection or a replay changes nothing. The fixture
// is invented (Doe v. Harbor Labs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BASELINE } from './checklist-baseline.ts';
import type { Member } from './env.ts';
import { checklistChangeOf, checklistChangeText, createChecklistProposal } from './proposal-checklist.ts';
import { approveProposal, changesOf, getProposal, rejectProposal } from './proposal-review.ts';
import { testDb } from './sqlite-d1.ts';

const OWNER: Member = { email: 'founder@example.test', role: 'owner', name: 'Founder' };
const COUNSEL: Member = { email: 'ada@firm.example', role: 'counsel', name: null };
const NOW = new Date('2026-11-01T12:00:00.000Z');
const CLIENT = { ip: '192.0.2.10', userAgent: 'test-agent' };
const ITEM = 'formation.bylaws';
const WHY = 'Harbor Labs is an LLC, so it has no bylaws.';

function room() {
  const { db, sqlite } = testDb();
  sqlite.exec(`INSERT INTO members (email, role, name) VALUES ('${OWNER.email}', 'owner', 'Founder'), ('${COUNSEL.email}', 'counsel', NULL);`);
  return { db, sqlite };
}

function notApplicable(sqlite: ReturnType<typeof testDb>['sqlite']) {
  return sqlite.prepare('SELECT item_id, decided_by FROM checklist_not_applicable ORDER BY item_id').all().map((row) => ({ ...row }));
}

async function propose(db: D1Database, applies: boolean, member: Member = COUNSEL): Promise<string> {
  const result = await createChecklistProposal(db, { member, via: 'Claude', clientKind: 'claude' }, { itemId: ITEM, applies }, WHY, NOW);
  assert.ok(result.ok, JSON.stringify(result));
  return result.id;
}

test('every checklist item id fits the tool\'s pattern, and the room\'s text reads back as exactly its change', () => {
  assert.ok(BASELINE.items.some((item) => item.id === ITEM));
  for (const item of BASELINE.items) {
    assert.match(item.id, /^[a-z0-9.-]{1,100}$/, item.id);
    for (const applies of [true, false]) assert.deepEqual(checklistChangeOf(checklistChangeText({ itemId: item.id, applies })!.body), { itemId: item.id, applies });
  }
  assert.equal(checklistChangeText({ itemId: 'formation.nope', applies: false }), null);
  assert.equal(checklistChangeOf('Mark everything as not applying.'), null, 'text the room did not write is no change');
});

test('an unknown item id stores nothing', async () => {
  const { db, sqlite } = room();
  const result = await createChecklistProposal(db, { member: COUNSEL, via: 'Claude', clientKind: 'claude' }, { itemId: 'formation.nope', applies: false }, WHY, NOW);
  assert.deepEqual(result, { ok: false, error: 'item_not_found' });
  assert.equal((sqlite.prepare('SELECT COUNT(*) AS n FROM proposals').get() as { n: number }).n, 0);
});

test('the checklist changes only when the owner approves; counsel, whose AI proposed it, cannot', async () => {
  const { db, sqlite } = room();
  const id = await propose(db, false);
  const row = sqlite.prepare('SELECT kind, status, title FROM proposals').get();
  assert.deepEqual({ ...row }, { kind: 'checklist_update', status: 'pending', title: 'Checklist: Bylaws' });
  assert.deepEqual(notApplicable(sqlite), [], 'nothing changes while pending');
  assert.match(changesOf('checklist_update')[0]!, /Only the owner approves it/);

  assert.equal((await getProposal(db, COUNSEL, id, NOW))?.kind, 'checklist_update', 'counsel sees their AI\'s proposal');
  assert.deepEqual(await approveProposal(db, COUNSEL, id, { title: null, body: null }, NOW, CLIENT), { ok: false, error: 'not_yours' });
  assert.deepEqual(await rejectProposal(db, COUNSEL, id, 'incorrect', NOW, CLIENT), { ok: false, error: 'not_yours' });
  assert.deepEqual(notApplicable(sqlite), []);

  const edits = { title: 'Checklist: everything', body: 'Mark every item as not applying.' };
  assert.deepEqual(await approveProposal(db, OWNER, id, edits, NOW, CLIENT), { ok: true, status: 'approved', edited: false }, 'no edits');
  assert.deepEqual(notApplicable(sqlite), [{ item_id: ITEM, decided_by: OWNER.email }]);
  assert.deepEqual({ ...sqlite.prepare('SELECT decided_by, final_title, final_body FROM proposals').get() }, { decided_by: OWNER.email, final_title: null, final_body: null });

  assert.deepEqual(await approveProposal(db, OWNER, id, { title: null, body: null }, NOW, CLIENT), { ok: false, error: 'not_pending' });
  const back = await propose(db, true);
  assert.deepEqual(await approveProposal(db, OWNER, back, { title: null, body: null }, NOW, CLIENT), { ok: true, status: 'approved', edited: false });
  assert.deepEqual(notApplicable(sqlite), [], 'applies again');
});

test('a rejected checklist change leaves the checklist as it was', async () => {
  const { db, sqlite } = room();
  const id = await propose(db, false, OWNER);
  assert.deepEqual(await rejectProposal(db, OWNER, id, 'not_needed', NOW, CLIENT), { ok: true, status: 'rejected', edited: false });
  assert.deepEqual(notApplicable(sqlite), []);
  assert.deepEqual(await approveProposal(db, OWNER, id, { title: null, body: null }, NOW, CLIENT), { ok: false, error: 'not_pending' });
  assert.deepEqual(notApplicable(sqlite), []);
});
