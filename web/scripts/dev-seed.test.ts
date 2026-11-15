// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { COUNSEL_EMAIL, configJson, devIdentity, LOCAL_STATE, migrationHint, parseSeedArgs, seedPaths, seedSql, UPLOAD } from './dev-seed.ts';
import { parseSyncConfig } from './config.ts';

const OWNER = 'dev-owner@example.test';

test('dev:seed refuses --remote in any form and takes only --out, --reset and --fixture', () => {
  for (const args of [['--remote'], ['--out', '/x', '--remote'], ['--remote=1'], ['--reset', '--remote']]) assert.throws(() => parseSeedArgs(args, '/d'), /refuses --remote/);
  assert.deepEqual(parseSeedArgs([], '/d'), { root: '/d', reset: false, fixture: 'case' });
  assert.deepEqual(parseSeedArgs(['--out', '/scratch/dev']), { root: '/scratch/dev', reset: false, fixture: 'case' });
  assert.deepEqual(parseSeedArgs(['--reset', '--out', '/scratch/dev']), { root: '/scratch/dev', reset: true, fixture: 'case' });
  assert.equal(parseSeedArgs(['--fixture', 'company'], '/d').fixture, 'company');
  for (const bad of [['--local'], ['--out'], ['--reset', 'x'], ['--fixture'], ['--fixture', 'deal']]) assert.throws(() => parseSeedArgs(bad, '/d'), /usage/, bad.join(' '));
});

test('dev:seed takes a folder already built with --source, and its inputs with --inputs', () => {
  assert.deepEqual(parseSeedArgs(['--out', '/scratch/dev', '--source', '/scratch/built', '--inputs', '/scratch/in']), { root: '/scratch/dev', reset: false, fixture: 'case', source: '/scratch/built', inputs: '/scratch/in' });
  assert.throws(() => parseSeedArgs(['--source'], '/d'), /usage/);
  assert.throws(() => parseSeedArgs(['--inputs'], '/d'), /usage/);
  const paths = seedPaths('/scratch/dev');
  assert.equal((JSON.parse(configJson({ ...paths, source: '/scratch/built' })) as { sourceRoot: string }).sourceRoot, '/scratch/built');
});

test('a migration that re-adds an existing column points at --reset; other failures pass through', () => {
  assert.match(migrationHint('ERROR duplicate column name: parent_id: SQLITE_ERROR') ?? '', /dev:seed -- --reset/);
  assert.match(migrationHint('index comments_document_parent already exists') ?? '', /renumbered/);
  assert.equal(migrationHint('Could not find a wrangler config'), null);
  assert.ok(LOCAL_STATE.endsWith(path.join('web', '.wrangler', 'state')));
});

test('the scratch config keeps source, cache and inbox apart and passes the sync config check', () => {
  const paths = seedPaths('/scratch/dev');
  const config = parseSyncConfig(JSON.parse(configJson(paths)));
  assert.deepEqual(config, { sourceRoot: '/scratch/dev/source', inboxDir: '/scratch/dev/inbox', cacheDir: '/scratch/dev/cache' });
});

test('devIdentity needs the dev identity switched on and returns its email', () => {
  assert.equal(devIdentity('ALLOW_DEV_IDENTITY=1\nDEV_IDENTITY_EMAIL=Dev-Owner@Example.test\n'), OWNER);
  assert.throws(() => devIdentity('DEV_IDENTITY_EMAIL=a@b.test\n'), /ALLOW_DEV_IDENTITY/);
  assert.throws(() => devIdentity('ALLOW_DEV_IDENTITY=1\n'), /DEV_IDENTITY_EMAIL/);
});

function schemaDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  const dir = path.join(import.meta.dirname, '..', 'migrations');
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) db.exec(readFileSync(path.join(dir, file), 'utf8'));
  return db;
}

test('seedSql adds one numbered upload, five comments (a reply, page anchors) and two Key flags; a second run adds nothing', () => {
  const db = schemaDb();
  const mirror = ['09-Discovery/Deposition__20130814__Mark-Moe.pdf', '01-Corporate-Records/Bylaws__20110609__Harbor-Labs.pdf', '06-Cap-Table/Bank-Statement__201207__Acme-Bank.pdf'];
  mirror.forEach((p, i) =>
    db.prepare("INSERT INTO documents (id, path, folder, name, kind, content_type, size, r2_key, source, updated_at, control_seq) VALUES (?, ?, '', ?, 'pdf', 'application/pdf', 1, ?, 'mirror', 'now', ?)")
      .run(randomUUID(), p, path.basename(p), randomUUID(), i + 1));
  const sql = seedSql(OWNER, 1234, 'abc');
  db.exec(sql);
  db.exec(sql);
  const count = (q: string) => (db.prepare(q).get() as { n: number }).n;
  assert.equal(count("SELECT COUNT(*) AS n FROM documents WHERE source = 'counsel'"), 1);
  assert.equal(count(`SELECT control_seq AS n FROM documents WHERE id = '${UPLOAD.id}'`), 4);
  assert.equal(count('SELECT COUNT(*) AS n FROM comments'), 5);
  assert.equal(count('SELECT COUNT(*) AS n FROM comments WHERE resolved_at IS NOT NULL'), 1);
  assert.equal(count(`SELECT COUNT(*) AS n FROM comments WHERE author_email = '${COUNSEL_EMAIL}'`), 3);
  assert.equal(count('SELECT COUNT(*) AS n FROM comments c JOIN comments p ON c.parent_id = p.id AND c.document_id = p.document_id AND p.parent_id IS NULL'), 1);
  assert.equal(count('SELECT COUNT(*) AS n FROM comments WHERE page IS NOT NULL'), 3);
  assert.equal(count("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'comment'"), 5);
  assert.equal(count("SELECT COUNT(*) AS n FROM audit_log WHERE action IN ('upload', 'resolve')"), 2);
  assert.equal(count('SELECT COUNT(*) AS n FROM documents WHERE key_at IS NOT NULL AND key_by IS NOT NULL'), 2);
  assert.equal(count("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'key'"), 2);
  assert.equal(count('SELECT COUNT(*) AS n FROM comments WHERE created_at > strftime(\'%Y-%m-%dT%H:%M:%fZ\', \'now\')'), 0);
});

test('seedSql skips comments whose document is not in the room yet', () => {
  const db = schemaDb();
  db.exec(seedSql(OWNER, 10, 'e'));
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM comments').get() as { n: number }).n, 1, 'only the comment on the upload');
});
