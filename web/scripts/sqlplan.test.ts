// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { diffSync, kindOf, type DocumentRow, type LocalFile } from './diff.ts';
import { pulledSql, syncSql, SYNC_EMAIL } from './sqlplan.ts';

const MIGRATIONS = path.join(import.meta.dirname, '..', 'migrations');
const NOW = '2026-09-30T12:00:00.000Z';
const LATER = '2026-09-30T13:00:00.000Z';

function database(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) db.exec(readFileSync(path.join(MIGRATIONS, file), 'utf8'));
  return db;
}

function rows(db: DatabaseSync, sql: string): Record<string, unknown>[] {
  return db.prepare(sql).all().map((row) => ({ ...row }));
}

function liveRows(db: DatabaseSync): DocumentRow[] {
  return rows(db, "SELECT id, path, sha256, size, kind, pages, r2_key, source, removed_at FROM documents WHERE source = 'mirror' AND removed_at IS NULL") as unknown as DocumentRow[];
}

function ids() {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
}

const HOSTILE = [
  "O'Brien's notes.pdf",
  "x'); DROP TABLE documents; --.md",
  'semi;colon; "double" `back`.txt',
  'Résumé 文件 📄.csv',
  'Résumé NFD.pdf',
  "Folder 'quoted'/inner ' file.json",
];

test('hostile filenames round-trip exactly through the SQL file', () => {
  const db = database();
  const files: LocalFile[] = HOSTILE.map((rel, i) => ({ rel, sha256: `${i}`.padStart(64, 'a'), size: 100 + i }));
  const sql = syncSql(diffSync(files, [], ids()), NOW);
  db.exec(sql);
  const stored = rows(db, 'SELECT path, folder, name, kind FROM documents ORDER BY size');
  assert.deepEqual(stored.map((r) => r.path), HOSTILE.map((rel) => rel.normalize('NFC')));
  assert.equal(stored[5].folder, "Folder 'quoted'");
  assert.equal(stored[5].name, "inner ' file.json");
  assert.equal(rows(db, "SELECT name FROM sqlite_master WHERE name = 'documents'").length, 1);
  assert.equal(rows(db, "SELECT count(*) AS n FROM audit_log WHERE action = 'sync_added'")[0].n, HOSTILE.length);
});

test('control characters in a filename are refused, never written', () => {
  const plan = diffSync([{ rel: 'bad\u0007name.pdf', sha256: 'a'.repeat(64), size: 1 }], [], ids());
  assert.throws(() => syncSql(plan, NOW), /control characters/);
});

test('the SQL file is idempotent: applying it twice equals applying it once', () => {
  const db = database();
  const newId = ids();
  db.exec(syncSql(diffSync([{ rel: 'a.pdf', sha256: '1'.repeat(64), size: 1 }, { rel: 'b.md', sha256: '2'.repeat(64), size: 2 }], [], newId), NOW));
  const plan = diffSync(
    [{ rel: 'a.pdf', sha256: '9'.repeat(64), size: 3 }, { rel: 'moved/b.md', sha256: '2'.repeat(64), size: 2 }, { rel: 'c.txt', sha256: '3'.repeat(64), size: 4 }],
    liveRows(db),
    newId,
  );
  assert.deepEqual([plan.adds.length, plan.changes.length, plan.renames.length, plan.removals.length], [1, 1, 1, 0]);
  const sql = syncSql(plan, LATER, new Map([[plan.changes[0].id, 12]]));
  db.exec(sql);
  const once = rows(db, 'SELECT * FROM documents ORDER BY id');
  const auditOnce = rows(db, 'SELECT ts, email, action, document_id FROM audit_log ORDER BY id');
  db.exec(sql);
  assert.deepEqual(rows(db, 'SELECT * FROM documents ORDER BY id'), once);
  assert.deepEqual(rows(db, 'SELECT ts, email, action, document_id FROM audit_log ORDER BY id'), auditOnce);
  const a = once.find((r) => r.path === 'a.pdf');
  assert.deepEqual([a?.sha256, a?.pages, a?.r2_key], ['9'.repeat(64), 12, plan.changes[0].r2Key]);
  assert.deepEqual(auditOnce.map((r) => r.action).sort(), ['sync_added', 'sync_added', 'sync_added', 'sync_changed', 'sync_changed']);
  assert.ok(auditOnce.every((r) => r.email === SYNC_EMAIL));
});

test('a partially applied file finishes cleanly when applied again', () => {
  const db = database();
  const files: LocalFile[] = ['a.pdf', 'b.pdf', 'c.pdf'].map((rel, i) => ({ rel, sha256: `${i}`.repeat(64), size: i }));
  const sql = syncSql(diffSync(files, [], ids()), NOW);
  const statements = sql.trim().split('\n');
  db.exec(statements.slice(0, 3).join('\n'));
  db.exec(sql);
  assert.equal(rows(db, 'SELECT count(*) AS n FROM documents')[0].n, 3);
  assert.equal(rows(db, 'SELECT count(*) AS n FROM audit_log')[0].n, 3);
});

test('removals keep the row and its comments, and set removed_at once', () => {
  const db = database();
  db.exec(syncSql(diffSync([{ rel: 'old.pdf', sha256: 'f'.repeat(64), size: 5 }], [], ids()), NOW));
  const [doc] = liveRows(db);
  db.exec(`INSERT INTO comments (id, document_id, author_email, body) VALUES ('c1', '${doc.id}', 'a@b.co', 'note');`);
  const sql = syncSql(diffSync([], liveRows(db), ids()), LATER);
  db.exec(sql);
  db.exec(sql);
  const [stored] = rows(db, 'SELECT removed_at FROM documents');
  assert.equal(stored.removed_at, LATER);
  assert.equal(rows(db, 'SELECT count(*) AS n FROM comments')[0].n, 1);
  assert.equal(rows(db, "SELECT count(*) AS n FROM audit_log WHERE action = 'sync_removed'")[0].n, 1);
});

test('counsel rows are never changed by the sync SQL', () => {
  const db = database();
  db.exec(
    "INSERT INTO documents (id, path, folder, name, kind, content_type, size, r2_key, source, uploaded_by, updated_at, control_seq) VALUES " +
      "('c1', 'from-counsel/c1/memo.pdf', 'from-counsel/c1', 'memo.pdf', 'pdf', 'application/pdf', 9, 'counsel-key', 'counsel', 'x@firm.example', 't', 1);",
  );
  const before = rows(db, "SELECT * FROM documents WHERE source = 'counsel'");
  // Even a hand-made plan aimed at the counsel row's id must not reach it: every statement is mirror-scoped.
  const counselRow = { id: 'c1', path: 'from-counsel/c1/memo.pdf', sha256: null, size: 9, kind: 'pdf', pages: null, r2_key: 'counsel-key', source: 'mirror' };
  const plan = diffSync([{ rel: 'from-counsel/c1/memo.pdf', sha256: 'e'.repeat(64), size: 1 }], [counselRow], ids());
  plan.removals.push(counselRow);
  db.exec(syncSql(plan, NOW, new Map([['c1', 4]])));
  assert.deepEqual(rows(db, "SELECT * FROM documents WHERE source = 'counsel'"), before);
  assert.equal(rows(db, "SELECT count(*) AS n FROM audit_log WHERE document_id = 'c1'")[0].n, 0);
});

test('pulledSql marks only counsel rows, once', () => {
  const db = database();
  db.exec(
    "INSERT INTO documents (id, path, folder, name, kind, content_type, size, r2_key, source, updated_at) VALUES " +
      "('c1', 'p1', '', 'n', 'pdf', 'application/pdf', 1, 'k1', 'counsel', 't'), ('m1', 'p2', '', 'n', 'pdf', 'application/pdf', 1, 'k2', 'mirror', 't');",
  );
  db.exec(pulledSql(['c1', 'm1'], NOW));
  db.exec(pulledSql(['c1'], LATER));
  assert.deepEqual(rows(db, 'SELECT id, pulled_at FROM documents ORDER BY id'), [
    { id: 'c1', pulled_at: NOW },
    { id: 'm1', pulled_at: null },
  ]);
  assert.equal(pulledSql([], NOW), '');
});

test('an empty plan produces no SQL', () => {
  assert.equal(syncSql(diffSync([], []), NOW), '');
  assert.equal(kindOf('x.pdf').kind, 'pdf');
});

// Control numbers (card F3, decision R3).

function numbers(db: DatabaseSync): Record<string, unknown>[] {
  return rows(db, 'SELECT path, control_seq FROM documents ORDER BY control_seq');
}

test('adds are numbered MAX + 1 in plan order, and applying again changes no number', () => {
  const db = database();
  const files: LocalFile[] = ['b.pdf', 'a.pdf', 'c/d.md'].map((rel, i) => ({ rel, sha256: `${i}`.repeat(64), size: i }));
  const sql = syncSql(diffSync(files, [], ids()), NOW);
  db.exec(sql);
  const first = numbers(db);
  assert.deepEqual(first.map((r) => r.control_seq), [1, 2, 3]);
  db.exec(sql);
  assert.deepEqual(numbers(db), first);
});

test('a number is never reused: removed rows keep theirs and the next add follows the highest', () => {
  const db = database();
  const newId = ids();
  db.exec(syncSql(diffSync([{ rel: 'a.pdf', sha256: '1'.repeat(64), size: 1 }, { rel: 'b.pdf', sha256: '2'.repeat(64), size: 2 }], [], newId), NOW));
  // b.pdf is removed (it was numbered last); a new file arrives in the same run.
  db.exec(syncSql(diffSync([{ rel: 'a.pdf', sha256: '1'.repeat(64), size: 1 }, { rel: 'n.pdf', sha256: '3'.repeat(64), size: 3 }], liveRows(db), newId), LATER));
  assert.deepEqual(rows(db, 'SELECT path, control_seq, removed_at IS NOT NULL AS removed FROM documents ORDER BY control_seq'), [
    { path: 'a.pdf', control_seq: 1, removed: 0 },
    { path: 'b.pdf', control_seq: 2, removed: 1 },
    { path: 'n.pdf', control_seq: 3, removed: 0 },
  ]);
});

test('renames and changes keep the number; it hangs off the row id', () => {
  const db = database();
  const newId = ids();
  db.exec(syncSql(diffSync([{ rel: 'a.pdf', sha256: '1'.repeat(64), size: 1 }, { rel: 'b.md', sha256: '2'.repeat(64), size: 2 }], [], newId), NOW));
  const before = rows(db, 'SELECT id, control_seq FROM documents ORDER BY id');
  const plan = diffSync([{ rel: 'a.pdf', sha256: '9'.repeat(64), size: 4 }, { rel: 'moved/b.md', sha256: '2'.repeat(64), size: 2 }], liveRows(db), newId);
  assert.deepEqual([plan.changes.length, plan.renames.length], [1, 1]);
  db.exec(syncSql(plan, LATER));
  assert.deepEqual(rows(db, 'SELECT id, control_seq FROM documents ORDER BY id'), before);
});

test('duplicate files (same sha256) get their own numbers', () => {
  const db = database();
  db.exec(syncSql(diffSync([{ rel: 'one.pdf', sha256: '7'.repeat(64), size: 1 }, { rel: 'copy/one.pdf', sha256: '7'.repeat(64), size: 1 }], [], ids()), NOW));
  assert.deepEqual(numbers(db).map((r) => r.control_seq), [1, 2]);
});

test('a sync first numbers rows left unnumbered (path order), then numbers its adds after them', () => {
  const db = database();
  db.exec(
    "INSERT INTO documents (id, path, folder, name, kind, content_type, size, r2_key, source, updated_at, control_seq) VALUES " +
      "('m1', 'kept.pdf', '', 'kept.pdf', 'pdf', 'application/pdf', 1, 'k1', 'mirror', 't', 5), " +
      "('c2', 'from-counsel/c2/z.pdf', 'from-counsel/c2', 'z.pdf', 'pdf', 'application/pdf', 1, 'k2', 'counsel', 't', NULL), " +
      "('c1', 'from-counsel/c1/y.pdf', 'from-counsel/c1', 'y.pdf', 'pdf', 'application/pdf', 1, 'k3', 'counsel', 't', NULL);",
  );
  const sql = syncSql(diffSync([{ rel: 'new.pdf', sha256: '1'.repeat(64), size: 1 }], [], ids()), NOW);
  assert.match(sql.split('\n')[0]!, /^UPDATE documents SET control_seq = .* control_seq IS NULL/, 'the sweep runs first');
  db.exec(sql);
  db.exec(sql);
  assert.deepEqual(rows(db, 'SELECT id, control_seq FROM documents ORDER BY control_seq').map((r) => [r.id, r.control_seq]).slice(0, 3), [
    ['m1', 5],
    ['c1', 6],
    ['c2', 7],
  ]);
  assert.equal(rows(db, "SELECT control_seq FROM documents WHERE path = 'new.pdf'")[0]!.control_seq, 8);
});

test('pulledSql also numbers unnumbered rows, and nothing else changes them', () => {
  const db = database();
  db.exec(
    "INSERT INTO documents (id, path, folder, name, kind, content_type, size, r2_key, source, updated_at, control_seq) VALUES " +
      "('c1', 'p1', '', 'n', 'pdf', 'application/pdf', 1, 'k1', 'counsel', 't', NULL), ('m1', 'p2', '', 'n', 'pdf', 'application/pdf', 1, 'k2', 'mirror', 't', 1);",
  );
  db.exec(pulledSql(['c1'], NOW));
  db.exec(pulledSql(['c1'], LATER));
  assert.deepEqual(rows(db, 'SELECT id, control_seq FROM documents ORDER BY id'), [
    { id: 'c1', control_seq: 2 },
    { id: 'm1', control_seq: 1 },
  ]);
});

test('the unique index refuses a duplicate number', () => {
  const db = database();
  const insert = (id: string) =>
    `INSERT INTO documents (id, path, folder, name, kind, content_type, size, r2_key, source, updated_at, control_seq) VALUES ('${id}', '${id}', '', 'n', 'pdf', 'application/pdf', 1, 'k${id}', 'mirror', 't', 1);`;
  db.exec(insert('a'));
  assert.throws(() => db.exec(insert('b')), /UNIQUE constraint failed: documents.control_seq/);
});
