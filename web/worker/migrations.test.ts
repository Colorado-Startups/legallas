// SPDX-License-Identifier: Apache-2.0
// The migration rule as a test (pull request template: backward compatible with the code on main): a D1 migration never
// drops or renames a table or column and never rewrites rows in place, so the Worker on main keeps working while the new one
// rolls out. And a migration on main never changes, because D1 records only its name: an edit would make a new room differ
// from an existing one. The rest of backward compatibility stays with the reviewer: a trigger that aborts an insert, or a
// new UNIQUE index, can break the old Worker's writes, and no pattern over the text can tell.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

const DIR = join(import.meta.dirname, '..', 'migrations');

/** Every migration on main, pinned. The pull request that adds a migration pins it here. */
const PINNED: Readonly<Record<string, string>> = {
  '0023_notice_acks.sql': 'e190aed98f102021df56257b8b2161d521eb8898a97e2a40e84f41965187d4fd', // 0022 is #692's
  '0001_init.sql': '7e002620f3dee83d122ab3858923db0c35f970fffeab2784b3c07551987efb7a',
  '0002_sign_ins.sql': 'e3af6e5e88f8dddca0109ac13da1e03d525765b22bd0c4a7f67d9b60c34f1d0a',
  '0003_doc_numbers.sql': '2d2349220f70c13330dc54627aa77553c417473b54c655152b772ea2b785de26',
  '0004_ai_connections.sql': '27cde7f6b89f41308237124934638635e102488e32ac4f3832f51866105887fd',
  '0005_comment_threads.sql': '2b9edc19cbed63826404ef85dc04d85f58e12464706679caefb6d0be57345cdf',
  '0006_family_role.sql': 'a7f77c17c8b7e87cd051ffd5c2587d827e8441f6d6de1648e7e76d549e5848b7',
  '0007_spend_counters.sql': 'a8d3993f0aee5eab6877727f682acd077430299a63d16a2f26578fd99abcf768',
  '0008_member_seen.sql': 'd953fc53c620a8d042c9dce08de83683088e13c4a5cbf3a170ffef873ed71d05',
  '0009_page_fts.sql': '77ef1cce040b5d69a7842b7624f5d4b6af7d4ab167df1602dac60cd1a33daf33',
  '0010_members_no_family.sql': '7f81db843e0baba3c24abeca1cd6d72aee5108cf6b1fbe566f9b28790020e87e',
  '0011_spend_account_days.sql': 'd9352ed9aa32821272f77171d05cef8dab6855fe8bfb1e7e6f7cb2a9d417dee7',
  '0012_deal_rooms.sql': '6ceb1db7a801ad76942f77dc18159a4e58833b7d430e0f5ec9d135542458f2e4',
  '0013_proposals.sql': '5614d27eba9bab6ad5557febb5e6eeed4f317ecb56c70a541763a28882581793',
  '0014_record_checks.sql': '68cdb54986c4aefd805fb3ebb43127e8f5b4dc3f356dc7709c215444583e159a',
  '0015_sync_endpoints.sql': 'bf5116193404247900a6dd7019b6fbd4275ca1a8e43223ea3cd7ade5cd3e6135',
  '0016_checklist.sql': '69ec5937cc95e716e25c5dcf88093530072378d49ebead4080f16214720092f0',
  '0016_sync_upload_bytes.sql': 'ce3bc729f7a31827a98ea7e8103b6ff12117375051ff81cf4fc00ab46ccd7bc4',
  '0017_legal_hold.sql': '974d402f5e55e411115382e86f11be08fe71855913df8b91bb9aa6baa7965062',
  '0018_litigation_conversion.sql': 'bfce468bca06fa7ff69fc8013de5c9521fc070479102e35dfc073248cc5ce3ba',
  '0019_audit_append_only.sql': 'b369eca4bd1966f83db7fdafc2d4bf7fc402025a6c6508b19cad37675e98179a',
  '0019_hold_custodians.sql': 'b168a0292bc3879d873802a0fc98f494ee88370e13da6bf574cdf35cc473c6ed',
  '0020_document_history.sql': 'e79d93ae37ec19a8d6799f1ee61c2ed11476dfdc55c4d5641128f52e9ac853f3',
  '0021_sync_counted.sql': '61f550cb9fa7731d672cf908762a3ed923cbfaca26a8eba8bfe8df4fe0526c11',
  '0022_retention.sql': '595e2272b7055f89773ece1845e5c45ee8136e81507c2019b2edf0c1271a1504',
  '0024_checklist_events.sql': '690863ca7b9a4693c50f35f69ad644ad0d18752005175f875fad8d110f1766aa',
  '0025_sync_uploads.sql': '2090dab13c63110fae11d64199794ac0be56beee0a8f570f1e2a812d6a33b0b0',
  '0026_index_text.sql': '16c13909a8189f4967066cea7f7e5646321b035cf76406970e4b8162623e02a1',
  '0027_proposal_visuals.sql': 'ffe20d031032418aea6be27bb5260b0ddf20c0115b681afd3f4bdd14ec356e6a',
  '0028_d1_timestamp_checks.sql': '29992f48fd315ae40d1284b4e59df93455af9eed0ef0b5e709491a20c1146e24',
  '0029_rule_changes.sql': 'b7105f4c74aa1227eb63df58a08738ca1de39d4dd58fba7dafbe1ed85d8d4ba2',
  '0030_company_settings.sql': '6bd949ae35edb901cd06d1daf64e0e57627cb0330f678ad60ed66a8db96cd751',
};

/** Rebuilt a table before this rule existed. Pinned above, so they can't change; no other migration may do it. */
const REBUILT_BEFORE_THE_RULE: ReadonlySet<string> = new Set(['0003_doc_numbers.sql', '0004_ai_connections.sql', '0006_family_role.sql']);

/**
 * Rebuilt tables under this rule, each for its reason: rows copied aside to `<t>_old`, the table dropped and created again
 * under its own name, rows copied back. The rule lets through only `DROP TABLE <t>` and `DROP TABLE <t>_old` for the tables
 * listed, so any other unsafe statement in the file still fails, and the rebuild test below checks that every column, row,
 * index and trigger comes through.
 */
const REBUILT_UNDER_THE_RULE: Readonly<Record<string, { reason: string; tables: readonly string[]; seed: string }>> = {
  '0028_d1_timestamp_checks.sql': {
    reason:
      'D1 refuses a GLOB over 50 bytes, so every insert that set one of these timestamps failed on D1 (#847). The check is rewritten without a GLOB; nothing else changes',
    tables: ['audit_purges', 'matter_close', 'directors', 'conversions', 'legal_holds', 'room_members'],
    // Fictional rows, written before the rebuild: the test checks they come through, nullable timestamps left NULL included.
    seed: `
      INSERT INTO rooms (id, name, created_by) VALUES ('0a1b2c3d', 'Seed round', 'founder@example.test');
      INSERT INTO room_members (id, room_id, email, role, invited_by, invited_at, accept_by, expires_at, revoked_at, revoked_by) VALUES
        ('m1', '0a1b2c3d', 'investor@example.test', 'investor', 'founder@example.test', '2026-01-05T09:00:00.000Z', '2026-01-12T09:00:00.000Z', '2026-04-05T09:00:00.000Z', NULL, NULL),
        ('m2', '0a1b2c3d', 'angel@example.test', 'investor', 'founder@example.test', '2026-01-05T09:00:00.000Z', '2026-01-12T09:00:00.000Z', '2026-04-05T09:00:00.000Z', '2026-01-08T09:00:00.000Z', 'founder@example.test');
      INSERT INTO audit_log (email, action) VALUES ('founder@example.test', 'view');
      INSERT INTO audit_purges (ts, through_id, rows, chain, copy_key) VALUES
        ('2026-01-06T09:00:00.000Z', 1, 1, '${'a'.repeat(64)}', 'retention/audit-log/0001.jsonl');
      INSERT INTO legal_holds (started_at, started_by, case_number, released_at, released_by, release_reason) VALUES
        ('2026-01-05T09:00:00.000Z', 'founder@example.test', NULL, '2026-01-20T09:00:00.000Z', 'founder@example.test', 'Settled'),
        ('2026-02-05T09:00:00.000Z', 'founder@example.test', 'CV-0001', NULL, NULL, NULL);
      INSERT INTO hold_custodians (hold_id, email, added_by, added_at) VALUES (2, 'cfo@example.test', 'founder@example.test', '2026-02-05T09:00:00.000Z');
      INSERT INTO conversions (id, actor, started_at, finished_at, manifest_sha256, documents, comments, invitations, events_before, events_after, investors_out) VALUES
        ('c0ffee00', 'founder@example.test', '2026-01-05T09:00:00.000Z', '2026-01-05T09:05:00.000Z', '${'b'.repeat(64)}', 3, 1, 2, 10, 12, 1),
        ('c0ffee01', 'founder@example.test', '2026-02-05T09:00:00.000Z', NULL, '${'c'.repeat(64)}', 3, 1, 2, 12, NULL, NULL);
      INSERT INTO directors (email, named_by) VALUES ('director@example.test', 'founder@example.test');
      INSERT INTO matter_close (id, closed_at, closed_by) VALUES (1, '2026-03-05T09:00:00.000Z', 'founder@example.test');
    `,
  },
};

function rebuildStatements(tables: readonly string[]): RegExp {
  const t = tables.join('|');
  return new RegExp(String.raw`\bDROP\s+TABLE\s+(?:${t})(?:_old)?\b`, 'gi');
}

/** D1's cap on a LIKE or GLOB pattern (developers.cloudflare.com/d1/platform/limits/). node:sqlite allows 50,000. */
const D1_PATTERN_BYTES = 50;

/** Each GLOB or LIKE string literal longer than D1 takes, in the operator form (`x GLOB '…'`) or the function form (`glob('…', x)`). */
function longPatterns(sql: string): string[] {
  return [...sql.matchAll(/\b(?:GLOB|LIKE)\s*\(?\s*'((?:[^']|'')*)'/gi)]
    .map((m) => m[1].replace(/''/g, "'"))
    .filter((pattern) => Buffer.byteLength(pattern) > D1_PATTERN_BYTES);
}

/**
 * A trigger that updates rows only in a table its own migration creates. The Worker on main never reads that table, so nothing
 * changes under it. Each entry names the one table, so any other UPDATE in the file still fails.
 */
const UPDATES_ITS_OWN_TABLE: Readonly<Record<string, RegExp>> = {
  '0020_document_history.sql': /\bUPDATE\s+document_history\s+SET\b/gi,
};

/**
 * Statements that break the Worker on main or lose data: any drop but an index's (SQLite drops a column with or without the
 * COLUMN keyword, and the name may be quoted), a rename, and any UPDATE statement, with or without OR <conflict>, as an upsert's
 * DO UPDATE, or in a trigger's body: rows changing under the old Worker is a rewrite. UPDATE after ON, AFTER, BEFORE or OF is a
 * foreign key's action or a trigger's event, not a statement. Also DELETE and REPLACE INTO. A migration that needs one of these
 * takes another shape, or changes this rule in its own reviewed pull request.
 */
const UNSAFE = /\bDROP\b(?!\s+INDEX\b)|\bRENAME\b|(?<!\b(?:ON|AFTER|BEFORE|OF)\s+)\bUPDATE\b|\bDELETE\s+FROM\b|\bREPLACE\s+INTO\b/i;

/**
 * The SQL the rule reads: a comment becomes a space, so it can neither hide a statement nor join two words, and a string's
 * text is emptied, so a word inside it is not a statement. Strings are matched first, so `'--'` starts no comment.
 */
function statements(sql: string): string {
  return sql.replace(/'(?:[^']|'')*'|--.*$|\/\*[\s\S]*?\*\//gm, (m) => (m[0] === "'" ? "''" : ' '));
}

const read = (name: string) => readFileSync(join(DIR, name), 'utf8').replace(/\r\n/g, '\n');
const migrations = readdirSync(DIR)
  .filter((name) => name.endsWith('.sql'))
  .sort();

/** A database with the migrations `keep` takes, in name order, each in one transaction as D1 applies it. */
function migrated(keep: (name: string) => boolean): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  for (const name of migrations.filter(keep)) db.exec(`BEGIN;\n${read(name)}\nCOMMIT;`);
  return db;
}

/** Every table's columns and rows, and every index, trigger and view, in an order that doesn't depend on rowids. */
function snapshot(db: DatabaseSync) {
  const all = (sql: string) => db.prepare(sql).all().map((row) => JSON.stringify(row));
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all();
  return {
    objects: all("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE type <> 'table' ORDER BY name"),
    tables: Object.fromEntries(
      tables.map(({ name }) => [String(name), { columns: all(`PRAGMA table_xinfo("${name}")`), rows: all(`SELECT * FROM "${name}"`).sort() }]),
    ),
  };
}

test('every migration is pinned, and a pinned one never changes', () => {
  for (const name of migrations) assert.ok(Object.hasOwn(PINNED, name), `${name} is not pinned: add its sha256 to PINNED`);
  for (const [name, sha] of Object.entries(PINNED)) {
    assert.equal(createHash('sha256').update(read(name)).digest('hex'), sha, `${name} changed; add a new migration instead`);
  }
});

test('a migration only adds: no drop, rename or rewrite', () => {
  for (const name of migrations.filter((n) => !REBUILT_BEFORE_THE_RULE.has(n))) {
    const rebuilt = REBUILT_UNDER_THE_RULE[name];
    const sql = statements(read(name))
      .replace(UPDATES_ITS_OWN_TABLE[name] ?? /(?!)/g, ' ')
      .replace(rebuilt ? rebuildStatements(rebuilt.tables) : /(?!)/g, ' ');
    assert.doesNotMatch(sql, UNSAFE, `${name}: a migration may only add, backward compatible with the Worker on main (pull request template)`);
  }
});

test('the rule refuses each unsafe statement and passes additive ones', () => {
  const unsafe = [
    'DROP TABLE members',
    'DROP TABLE IF EXISTS members',
    'DROP/**/TABLE members',
    'ALTER TABLE members DROP COLUMN name',
    'ALTER TABLE members DROP name',
    'ALTER TABLE members DROP "name"',
    'ALTER TABLE members DROP [name]',
    'ALTER TABLE members DROP `name`',
    'DROP VIEW member_names',
    'ALTER TABLE members RENAME TO people',
    'ALTER TABLE members RENAME COLUMN name TO full_name',
    "UPDATE members SET role = 'owner'",
    "UPDATE OR REPLACE members SET role = 'owner'",
    "UPDATE members AS m SET role = 'owner'",
    "UPDATE members NOT INDEXED SET role = 'owner'",
    "UPDATE \"member list\" SET role = 'owner'",
    "INSERT INTO members (email) VALUES ('a') ON CONFLICT DO UPDATE SET role = 'owner'",
    'DELETE FROM members',
    'REPLACE INTO members VALUES (1)',
    'INSERT OR REPLACE INTO members VALUES (1)',
    "INSERT INTO notes VALUES ('--'); DROP TABLE members",
    '/* -- */ DROP TABLE members',
    "CREATE TRIGGER t AFTER INSERT ON notes BEGIN UPDATE members SET role = 'owner'; END",
  ];
  for (const sql of unsafe) assert.match(statements(sql), UNSAFE, sql);
  const additive = [
    'CREATE TABLE notes (id TEXT PRIMARY KEY, renamed_at TEXT, dropped INTEGER, updated_at TEXT)',
    'CREATE TABLE replies (note TEXT REFERENCES notes (id) ON UPDATE SET NULL ON DELETE CASCADE)',
    'ALTER TABLE members ADD COLUMN seen_at TEXT',
    'CREATE INDEX notes_id ON notes (id)',
    'DROP INDEX IF EXISTS notes_id',
    "INSERT INTO notes (id, body) VALUES ('1', 'please drop by and update us')",
    '-- DROP TABLE members is how an old migration rebuilt it\nCREATE TABLE notes2 (id TEXT)',
    'CREATE TRIGGER t BEFORE UPDATE OF body ON notes BEGIN SELECT 1; END',
    'CREATE TRIGGER t2 AFTER UPDATE ON notes BEGIN SELECT 1; END',
  ];
  for (const sql of additive) assert.doesNotMatch(statements(sql), UNSAFE, sql);
});

test('a rebuild under the rule passes only its own tables\' drops', () => {
  const rebuild = (sql: string) => statements(sql).replace(rebuildStatements(['legal_holds']), ' ');
  for (const sql of ['DROP TABLE legal_holds', 'DROP TABLE legal_holds_old']) assert.doesNotMatch(rebuild(sql), UNSAFE, sql);
  const still = [
    'DROP TABLE members',
    'DROP TABLE legal_holds_new',
    'DROP TABLE IF EXISTS hold_custodians',
    'ALTER TABLE legal_holds RENAME TO members',
    'ALTER TABLE legal_holds_old RENAME TO legal_holds',
    'ALTER TABLE legal_holds RENAME COLUMN started_at TO began_at',
    'ALTER TABLE legal_holds DROP COLUMN case_number',
    "UPDATE legal_holds SET released_at = NULL",
    'DELETE FROM legal_holds',
  ];
  for (const sql of still) assert.match(rebuild(sql), UNSAFE, sql);
});

test('a rebuild keeps every column, row, index and trigger', () => {
  for (const [name, { tables, seed }] of Object.entries(REBUILT_UNDER_THE_RULE)) {
    const db = migrated((n) => n < name);
    db.exec(seed);
    for (const table of tables) {
      const { n } = db.prepare(`SELECT count(*) AS n FROM "${table}"`).get() as { n: number };
      assert.ok(n > 0, `${name}: the seed writes no ${table} row, so the test can't see the copy`);
    }
    const before = snapshot(db);
    db.exec(`BEGIN;\n${read(name)}\nCOMMIT;`);
    assert.deepEqual(snapshot(db), before, `${name}: a rebuild changes only its tables' CHECKs`);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [], name);
  }
});

test('D1 takes every GLOB and LIKE pattern the schema holds', () => {
  const long = migrated(() => true)
    .prepare('SELECT name, sql FROM sqlite_master WHERE sql IS NOT NULL')
    .all()
    .flatMap(({ name, sql }) => longPatterns(String(sql)).map((p) => `${name}: ${Buffer.byteLength(p)} bytes`));
  assert.deepEqual(long, [], `D1 refuses a LIKE or GLOB pattern over ${D1_PATTERN_BYTES} bytes, and every insert that runs it fails (#847)`);
});

test('legal_holds holds no GLOB over D1\'s cap, so POST /api/hold can start a hold (#789)', () => {
  const holdSchema = (db: DatabaseSync) =>
    db.prepare("SELECT name, sql FROM sqlite_master WHERE tbl_name = 'legal_holds' AND sql IS NOT NULL").all() as { name: string; sql: string }[];
  const final = holdSchema(migrated(() => true));
  assert.ok(final.some(({ name, sql }) => name === 'legal_holds' && /^CREATE TABLE/i.test(sql)), 'the final schema creates legal_holds');
  assert.deepEqual(final.flatMap(({ name, sql }) => longPatterns(sql).map((p) => `${name}: ${Buffer.byteLength(p)} bytes`)), []);
  const before = holdSchema(migrated((name) => name < '0028_d1_timestamp_checks.sql'));
  assert.ok(before.some(({ sql }) => longPatterns(sql).length > 0), 'before 0028, its 92-byte timestamp GLOB is the bug this guards');
});

test('the pattern gate finds a long GLOB in either form and passes short ones', () => {
  const timestamp = `'${'[0-9]'.repeat(4)}-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'`;
  assert.equal(longPatterns(`CHECK (ts GLOB ${timestamp})`).length, 1);
  assert.equal(longPatterns(`CHECK (ts NOT glob ${timestamp})`).length, 1);
  assert.equal(longPatterns(`CHECK (glob(${timestamp}, ts))`).length, 1);
  assert.equal(longPatterns(`CHECK (note LIKE '${"it''s ".repeat(11)}')`).length, 1);
  const short = [
    `CHECK (id NOT GLOB '*[^0-9a-f-]*')`,
    `CHECK (email GLOB '?*@?*' AND email NOT GLOB '*[ :]*')`,
    `CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', ts) IS ts)`,
    `CHECK (key LIKE '${'x'.repeat(D1_PATTERN_BYTES)}')`,
    `CHECK (note LIKE '${"it''s ".repeat(10)}')`,
  ];
  for (const sql of short) assert.deepEqual(longPatterns(sql), [], sql);
});

test('a timestamp check takes toISOString() and refuses any other shape', () => {
  const hold = migrated(() => true).prepare("INSERT INTO legal_holds (started_at, started_by) VALUES (?, 'founder@example.test')");
  hold.run(new Date().toISOString());
  const bad = ['2026-11-06T20:26:40Z', '2026-11-06T20:26:40.000', '2026-11-06 20:26:40.000Z', '2026-11-06T20:26:40.000+00:00', '2026-13-01T00:00:00.000Z', '2026-02-30T00:00:00.000Z', 'x'];
  for (const value of bad) assert.throws(() => hold.run(value), /CHECK constraint failed/, value);
});
