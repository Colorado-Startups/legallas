// SPDX-License-Identifier: Apache-2.0
// AI output stays apart from the record (quality-speed/pages/data-room/research/litigation.md, U4): an Ask answer and an
// AI's approved draft are never a documents row, take no control number and leave the next number where it was. On
// real SQLite with every migration applied; the fixture is invented (Doe v. Harbor Labs). The Data room page
// (quality-speed/pages/data-room/list.ts) reads this test by name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DatabaseSync } from 'node:sqlite';
import { askRequest, harness } from './ask-fixtures.ts';
import type { Member } from './env.ts';
import { NEXT_CONTROL_SEQ_SQL, NUMBER_UNNUMBERED_SQL } from './files-catalog.ts';
import { handle } from './index.ts';
import { approvedDraft, approveProposal } from './proposal-review.ts';
import { createDraftProposal } from './proposals.ts';
import { chunk } from './room-fixtures.ts';

const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined } as unknown as ExecutionContext;
const NOW = new Date('2026-11-01T12:00:00.000Z');
const COUNSEL: Member = { email: 'ada@firm.example', role: 'counsel', name: null };
const ANSWER = 'ZEBRA-ANSWER-7731: the Harbor Labs term sheet names a 2026 closing.';
const DRAFT = { title: 'ZEBRA-DRAFT-4410 amendment', why: 'Extends the Doe advisor agreement.', body: 'ZEBRA-DRAFT-4410: the term runs to 2027-03-01.' };
const CONTROL = /\bDOE-\d{6}\b/;

/** Every documents row, and the number the next document would take. */
function record(db: DatabaseSync) {
  return {
    documents: db.prepare('SELECT * FROM documents ORDER BY id').all().map((r) => ({ ...r })),
    next: (db.prepare(`SELECT ${NEXT_CONTROL_SEQ_SQL} AS n`).get() as { n: number }).n,
  };
}

/** The tables any cell of which holds `text`. */
function tablesHolding(db: DatabaseSync, text: string): string[] {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[];
  return tables
    .filter(({ name }) => db.prepare(`SELECT * FROM "${name}"`).all().some((row) => Object.values(row).some((cell) => typeof cell === 'string' && cell.includes(text))))
    .map(({ name }) => name);
}

test('an AI answer is never stored as a record and carries no control number', async () => {
  const h = harness({ chunks: [chunk('doc-live-a', 2, 'The term sheet names a 2026 closing.')], answer: ANSWER, members: { 'founder@example.test': 'owner', [COUNSEL.email]: 'counsel' } });
  h.db.exec(NUMBER_UNNUMBERED_SQL);
  const before = record(h.db);
  assert.ok(before.documents.length > 0 && before.next > 1);

  // Ask: the answer streams to the member and is kept nowhere.
  const res = await handle(askRequest({ question: 'When does the round close?' }), h.env, ctx);
  assert.equal(res.status, 200);
  assert.ok((await res.text()).includes('ZEBRA-ANSWER-7731'), 'the answer reached the member');
  assert.deepEqual(record(h.db), before, 'no documents row, and the next number has not moved');
  assert.deepEqual(tablesHolding(h.db, 'ZEBRA-ANSWER'), []);

  // An AI's draft, approved by a person, stays a proposal: not a documents row, and its file has no number of its own.
  // The harness's adapter has no batch; D1 runs one as a transaction.
  const db = {
    prepare: h.env.DB.prepare,
    async batch(statements: D1PreparedStatement[]) {
      h.db.exec('BEGIN');
      for (const statement of statements) await statement.run();
      h.db.exec('COMMIT');
      return [];
    },
  } as unknown as D1Database;
  const made = await createDraftProposal(db, { member: COUNSEL, via: 'Claude', clientKind: 'claude' }, { ...DRAFT, sources: [{ documentId: 'doc-live-a', page: 2 }] }, NOW);
  assert.ok(made.ok, JSON.stringify(made));
  const client = { ip: '192.0.2.10', userAgent: 'test-agent' };
  assert.deepEqual(await approveProposal(db, COUNSEL, made.id, { title: null, body: null }, NOW, client), { ok: true, status: 'approved', edited: false });
  const file = await approvedDraft(db, COUNSEL, made.id, NOW, client);
  assert.ok(file && file.text.includes('ZEBRA-DRAFT-4410'));
  assert.doesNotMatch(`${file.filename}\n${file.text}`, CONTROL);
  assert.deepEqual(record(h.db), before, 'approving a draft adds no documents row and uses no number');
  assert.deepEqual(tablesHolding(h.db, 'ZEBRA-DRAFT'), ['proposals']);
  const columns = (h.db.prepare("SELECT name FROM pragma_table_info('proposals')").all() as { name: string }[]).map((c) => c.name);
  assert.ok(!columns.some((name) => /control|seq/.test(name)), 'a proposal has no number column');
});
