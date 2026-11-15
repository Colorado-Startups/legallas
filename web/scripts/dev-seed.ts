// SPDX-License-Identifier: Apache-2.0
// Card F9. One command that fills the LOCAL room with the Doe v. Harbor Labs fixture:
//
//   npm run dev:seed [-- --fixture case|company] [--out <dir>] [--reset] [--source <dir> [--inputs <dir>]]
//
//   1. applies the local D1 migrations
//   2. adds the dev owner (DEV_IDENTITY_EMAIL from .dev.vars) and one counsel
//   3. writes the fixture folder and a scratch legallas.config.json (source, cache and inbox outside the repo)
//   4. runs `sync --local --apply --yes` against that config
//   5. when the matter builder is in this checkout (scripts/matter/dev-seed.ts), turns web/fixtures/matter.example.json
//      into a fragment (fixture ids -> paths), then `matter build --local` and `matter publish --local --expect <sha>`
//      (paths -> the ids sync just made)
//   6. seeds one counsel upload and a few comments (open and resolved) with their audit rows
//
// --fixture company builds the same company with no matter instead (dev-fixture-company.ts): steps 1 to 4 on its own
// files, and no 5 or 6. It always starts with --reset, because the two share one local D1 and R2 and a case room's manifest
// and comments would otherwise stay.
//
// --source seeds a folder already built, such as the Data room page's invented record, in place of step 3's fixture.
// --inputs names the doc-ids.json and matter.json step 5 reads, in place of web/fixtures. A folder without them has no
// step 5: the room is one with no case picture, because web/fixtures cites documents such a folder may not hold.
//
// Every wrangler call carries --local; there is no flag for remote and `--remote` is refused. Safe to rerun:
// unchanged files sync as "Nothing to do", members upsert, seeded rows use fixed ids.
//
// --reset first deletes this worktree's local wrangler state (web/.wrangler/state: D1 and R2) and the scratch folder,
// all but cache/text/ (the extracted text), so the fresh R2 is indexed again. Use it when a local migration fails, for
// example after a migration was renumbered on main. Stop `wrangler dev` first.
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { NEXT_CONTROL_SEQ_SQL } from '../worker/files-catalog.ts';
import { NOTICE_VERSION } from '../worker/full-notice.ts';
import { sqlLiteral } from '../worker/sql.ts';
import { assertScratchFolder, defaultDevRoot, makeFixture, MARKER, WEB_DIR, type FixtureKind } from './dev-fixture.ts';
import { pdfBytes } from './dev-pdf.ts';
import { loadModule } from './load-module.ts';
import { memberSql } from './member.ts';
import { cliWrangler, FILES_BUCKET } from './wrangler.ts';

export const COUNSEL_EMAIL = 'dev-counsel@example.test';
const COUNSEL_NAME = 'Dana Counsel';
/** Fixed ids, so a rerun finds the rows it seeded before. */
export const UPLOAD = { id: 'de5eed00-0000-4000-8000-000000000001', key: 'de5eed00-0000-4000-8000-0000000000f1', name: 'Bylaws-questions.pdf' };
const COMMENT_ID = (n: number) => `de5eed00-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`;

export interface SeedPaths {
  root: string;
  source: string;
  cache: string;
  inbox: string;
  config: string;
  upload: string;
}

export function seedPaths(root: string): SeedPaths {
  return {
    root,
    source: path.join(root, 'source'),
    cache: path.join(root, 'cache'),
    inbox: path.join(root, 'inbox'),
    config: path.join(root, 'legallas.config.json'),
    upload: path.join(root, 'upload', UPLOAD.name),
  };
}

const USAGE = 'usage: npm run dev:seed [-- --fixture case|company] [--out <dir>] [--reset] [--source <dir> [--inputs <dir>]]   (always local; there is no remote mode)';

export interface SeedArgs {
  root: string;
  reset: boolean;
  fixture: FixtureKind;
  source?: string;
  inputs?: string;
}

export function parseSeedArgs(args: readonly string[], fallback = defaultDevRoot()): SeedArgs {
  if (args.some((arg) => /^--remote\b/.test(arg))) throw new Error(`dev:seed refuses --remote: it only ever seeds the local dev state.\n${USAGE}`);
  const options: SeedArgs = { root: fallback, reset: false, fixture: 'case' };
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--reset') options.reset = true;
    else if (args[i] === '--out' && args[i + 1]) options.root = path.resolve(args[++i]);
    else if (args[i] === '--fixture' && (args[i + 1] === 'case' || args[i + 1] === 'company')) options.fixture = args[++i] as FixtureKind;
    else if (args[i] === '--source' && args[i + 1]) options.source = path.resolve(args[++i]);
    else if (args[i] === '--inputs' && args[i + 1]) options.inputs = path.resolve(args[++i]);
    else throw new Error(USAGE);
  }
  return options;
}

/** The local wrangler state (D1 and R2) of this worktree. Never remote: nothing else lives here. */
export const LOCAL_STATE = path.join(WEB_DIR, '.wrangler', 'state');

/**
 * Why a local migration failed, when the cause is a local D1 that applied a migration under another name
 * (a renumbered migration re-runs its ALTER TABLE). Null for anything else, which is reported as is.
 */
export function migrationHint(message: string): string | null {
  if (!/duplicate column name|already exists/i.test(message)) return null;
  return (
    'The local D1 already has this schema change under another migration name (a migration was probably renumbered on main).\n' +
    'Stop `wrangler dev`, then reset the local state and seed again: npm run dev:seed -- --reset'
  );
}

/**
 * Deletes the local wrangler state and the scratch folder (only one dev-fixture made, or one holding only extracted
 * text). The extracted text (cache/text/<sha256>.json) stays: it is keyed by content, and fixture-room.yml installs it
 * before the seed. The rest of the cache goes, the index manifest above all, so the fresh R2 is indexed again.
 */
async function resetLocal(paths: SeedPaths, log: (line: string) => void): Promise<void> {
  await assertScratchFolder(paths.source);
  const cache = path.basename(paths.cache);
  const names = await readdir(paths.root).catch(() => [] as string[]);
  const cached = names.includes(cache) ? await readdir(paths.cache).catch(() => [] as string[]) : [];
  const onlyText = names.every((name) => name === cache) && cached.every((name) => name === 'text');
  const ours = onlyText || (await readdir(paths.source).catch(() => [] as string[])).includes(MARKER);
  if (!ours) throw new Error(`${paths.root} was not made by dev:seed; not deleting it`);
  await rm(LOCAL_STATE, { recursive: true, force: true });
  for (const name of names) if (name !== cache) await rm(path.join(paths.root, name), { recursive: true, force: true });
  for (const name of cached) if (name !== 'text') await rm(path.join(paths.cache, name), { recursive: true, force: true });
  log(`Reset: deleted the local D1 and R2 state (${path.relative(WEB_DIR, LOCAL_STATE)}) and ${paths.root}, all but ${cache}/text/.`);
}

/** The scratch config sync and matter read. Paths only; the room's banner and prefix stay in web/legallas.config.json. */
export function configJson(paths: SeedPaths): string {
  const config = { sourceRoot: paths.source, inboxDir: paths.inbox, cacheDir: paths.cache, matterTitle: 'Doe v. Harbor Labs, Inc.', controlPrefix: 'DOE' };
  return `${JSON.stringify(config, null, 2)}\n`;
}


interface SeedComment {
  n: number;
  path: string;
  author: 'owner' | 'counsel';
  body: string;
  ago: string;
  /** The page the comment is about (migration 0005), or null for the whole document. */
  page: number | null;
  /** The top-level comment this one replies to. */
  parent?: number;
  resolved?: boolean;
}

const COMMENTS: readonly SeedComment[] = [
  { n: 1, path: '09-Discovery/Deposition__20130814__Mark-Moe.pdf', author: 'counsel', ago: '-2 days', page: 38, body: 'This page reads differently from the interrogatory answer on the notice dates. Worth a follow-up question.' },
  { n: 2, path: '01-Corporate-Records/Bylaws__20110609__Harbor-Labs.pdf', author: 'owner', ago: '-1 days', page: 1, body: 'This clause is the ten-day notice rule. The notice log in the board minutes folder is what to hold it against.' },
  { n: 3, path: '01-Corporate-Records/Bylaws__20110609__Harbor-Labs.pdf', author: 'counsel', ago: '-20 hours', page: null, parent: 2, body: 'Thanks. Please send the board calendar too, so we can match the notices to the meetings.' },
  { n: 4, path: '06-Cap-Table/Bank-Statement__201207__Acme-Bank.pdf', author: 'counsel', ago: '-6 days', page: 2, body: 'Can you confirm which account the bridge top-up went to?', resolved: true },
  { n: 5, path: `from-counsel/${UPLOAD.id}/${UPLOAD.name}`, author: 'owner', ago: '-3 hours', page: null, body: 'Thanks. I added two dates to the timeline notes.' },
];

/** Documents marked Key (migration 0003), so the Overview's Key panel has rows. */
const KEY_PATHS = ['01-Corporate-Records/Bylaws__20110609__Harbor-Labs.pdf', '06-Cap-Table/Bank-Statement__201207__Acme-Bank.pdf'];

const docBy = (docPath: string) => `(SELECT id FROM documents WHERE path = ${sqlLiteral(docPath)} AND removed_at IS NULL)`;
const at = (ago: string) => `strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ${sqlLiteral(ago)})`;

/** Audit rows are append-only with integer ids, so each seeded one is guarded by NOT EXISTS on its fields. */
function auditOnce(email: string, action: string, doc: string, ago: string): string {
  return (
    `INSERT INTO audit_log (ts, email, action, document_id) SELECT ${at(ago)}, ${sqlLiteral(email)}, ${sqlLiteral(action)}, ${doc} ` +
    `WHERE ${doc} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM audit_log WHERE email = ${sqlLiteral(email)} AND action = ${sqlLiteral(action)} AND document_id = ${doc});`
  );
}

/** The counsel upload row, the comments (needs the comment-threads migration), two Key flags and their audit rows. Idempotent: fixed ids and guarded inserts. */
export function seedSql(owner: string, size: number, etag: string): string {
  const email = (who: SeedComment['author']) => (who === 'owner' ? owner : COUNSEL_EMAIL);
  const upload =
    'INSERT OR IGNORE INTO documents (id, path, folder, name, kind, content_type, size, sha256, etag, pages, r2_key, source, uploaded_by, updated_at, control_seq) VALUES (' +
    [UPLOAD.id, `from-counsel/${UPLOAD.id}/${UPLOAD.name}`, `from-counsel/${UPLOAD.id}`, UPLOAD.name, 'pdf', 'application/pdf'].map(sqlLiteral).join(', ') +
    `, ${size}, NULL, ${sqlLiteral(etag)}, 1, ${sqlLiteral(UPLOAD.key)}, 'counsel', ${sqlLiteral(COUNSEL_EMAIL)}, ${at('-5 hours')}, ${NEXT_CONTROL_SEQ_SQL});`;
  const lines = [upload, auditOnce(COUNSEL_EMAIL, 'upload', sqlLiteral(UPLOAD.id), '-5 hours')];
  for (const c of COMMENTS) {
    const doc = docBy(c.path);
    lines.push(
      'INSERT OR IGNORE INTO comments (id, document_id, author_email, body, created_at, page, parent_id, resolved_at, resolved_by) ' +
        `SELECT ${sqlLiteral(COMMENT_ID(c.n))}, ${doc}, ${sqlLiteral(email(c.author))}, ${sqlLiteral(c.body)}, ${at(c.ago)}, ` +
        `${c.page ?? 'NULL'}, ${c.parent ? sqlLiteral(COMMENT_ID(c.parent)) : 'NULL'}, ` +
        `${c.resolved ? `${at('-4 days')}, ${sqlLiteral(owner)}` : 'NULL, NULL'} WHERE ${doc} IS NOT NULL;`,
      auditOnce(email(c.author), 'comment', doc, c.ago),
    );
    if (c.resolved) lines.push(auditOnce(owner, 'resolve', doc, '-4 days'));
  }
  for (const keyPath of KEY_PATHS) {
    lines.push(
      `UPDATE documents SET key_at = ${at('-2 days')}, key_by = ${sqlLiteral(COUNSEL_EMAIL)} WHERE path = ${sqlLiteral(keyPath)} AND removed_at IS NULL AND key_at IS NULL;`,
      auditOnce(COUNSEL_EMAIL, 'key', docBy(keyPath), '-2 days'),
    );
  }
  return `${lines.join('\n')}\n`;
}

/** DEV_IDENTITY_EMAIL from .dev.vars (copied from the example when missing). Refuses without the dev identity. */
export function devIdentity(vars: string): string {
  if (!/^ALLOW_DEV_IDENTITY=1\s*$/m.test(vars)) throw new Error('.dev.vars must set ALLOW_DEV_IDENTITY=1 for local dev');
  const email = /^DEV_IDENTITY_EMAIL=(\S+)\s*$/m.exec(vars)?.[1];
  if (!email) throw new Error('.dev.vars must set DEV_IDENTITY_EMAIL');
  return email.toLowerCase();
}

async function readDevVars(): Promise<string> {
  const file = path.join(WEB_DIR, '.dev.vars');
  const text = await readFile(file, 'utf8').catch(() => null);
  if (text !== null) return text;
  await copyFile(path.join(WEB_DIR, '.dev.vars.example'), file);
  return readFile(file, 'utf8');
}

/** Runs a command in web/. `show` streams its output; otherwise the output is returned (and shown on failure). */
function run(cmd: string, args: string[], show = false): Promise<string> {
  if (show) {
    return new Promise((resolve, reject) => {
      spawn(cmd, args, { cwd: WEB_DIR, stdio: 'inherit' }).on('exit', (code) => (code === 0 ? resolve('') : reject(new Error(`${cmd} ${args.slice(0, 3).join(' ')} exited ${code}`))));
    });
  }
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd: WEB_DIR, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' }, (error, stdout, stderr) =>
      error ? reject(new Error(`${cmd} ${args.slice(0, 3).join(' ')} failed:\n${`${stdout}\n${stderr}`.trim().split('\n').slice(-8).join('\n')}`)) : resolve(stdout));
  });
}

/** The matter builder's own seed step, run only when this checkout has the builder. */
export const MATTER_STEP = 'scripts/matter/dev-seed.ts';

/** What MATTER_STEP exports, as far as dev:seed calls it. */
interface MatterStep {
  seedMatter(cacheDir: string, config: string, run: (cmd: string, args: string[]) => Promise<string>, log: (line: string) => void, inputs?: string): Promise<string>;
}

async function seedMatter(paths: SeedPaths, log: (line: string) => void, inputs?: string): Promise<void> {
  if (!existsSync(path.join(WEB_DIR, MATTER_STEP))) {
    log('Matter: no matter builder in this checkout, so the room has no case manifest.');
    return;
  }
  const step = await loadModule<MatterStep>(MATTER_STEP);
  await step.seedMatter(paths.cache, paths.config, (cmd, args) => run(cmd, args), log, inputs);
}

async function seedActivity(paths: SeedPaths, owner: string, log: (line: string) => void): Promise<void> {
  const w = cliWrangler('local');
  const bytes = pdfBytes([['DOE v. HARBOR LABS, INC.', 'Questions on the bylaws', 'Page 1 of 1', '', 'Dummy counsel upload for local development.', 'Two questions on the bank statement, and a note on the bylaws.']]);
  await mkdir(path.dirname(paths.upload), { recursive: true });
  await writeFile(paths.upload, bytes);
  await w.r2Put(FILES_BUCKET, UPLOAD.key, paths.upload, 'application/pdf');
  const sqlFile = path.join(paths.root, 'seed.sql');
  await writeFile(sqlFile, seedSql(owner, bytes.length, createHash('md5').update(bytes).digest('hex')));
  await w.d1File(sqlFile);
  log(`Activity: one counsel upload and ${COMMENTS.length} comments (${COMMENTS.filter((c) => c.parent).length} reply, ${COMMENTS.filter((c) => c.resolved).length} resolved), ${KEY_PATHS.length} Key documents, with audit rows.`);
}

/** A few checklist matches on the company fixture's documents: invented facts, so the sample room shows statuses and dates. */
export function checklistSeedSql(owner: string): string {
  const rows = [
    "('formation.bylaws', '01-Corporate-Records/Bylaws__20110609__Harbor-Labs.pdf', 'yes', '2011-06-09', 'Harbor Labs, Inc.', NULL)",
    "('founders.stock-purchase-agreement', '01-Corporate-Records/Stock-Agreement__20110607__Harbor-Labs.pdf', 'yes', '2011-06-07', 'Jane Doe; Harbor Labs, Inc.', '$400')",
    "('financing.voting-agreement', '03-Investor-Agreements/Voting-Agreement__20110621__Alder-Peak.pdf', NULL, '2011-06-21', 'Harbor Labs, Inc.; Alder Peak', NULL)",
    "('equity.capitalization-table', '06-Cap-Table/Cap-Table__20111231__Ledger-and-Co.pdf', 'not_needed', '2011-12-31', NULL, NULL)",
  ];
  return (
    'INSERT INTO checklist_matches (id, item_id, document_id, signed, doc_date, parties, amount, matched_by, matched_at) ' +
    `WITH seed (item, path, signed, doc_date, parties, amount) AS (VALUES ${rows.join(', ')}) ` +
    `SELECT 'seed-' || seed.item, seed.item, d.id, seed.signed, seed.doc_date, seed.parties, seed.amount, '${owner.replaceAll("'", "''")}', '2011-12-31T00:00:00.000Z' ` +
    'FROM seed JOIN documents d ON d.path = seed.path;'
  );
}

async function report(log: (line: string) => void): Promise<void> {
  const [row] = await cliWrangler('local').d1Query(
    "SELECT (SELECT COUNT(*) FROM members) AS members, (SELECT COUNT(*) FROM documents WHERE removed_at IS NULL AND source = 'mirror') AS mirror, " +
      "(SELECT COUNT(*) FROM documents WHERE removed_at IS NULL AND source = 'counsel') AS counsel, (SELECT COUNT(*) FROM comments) AS comments, " +
      '(SELECT COUNT(*) FROM comments WHERE resolved_at IS NOT NULL) AS resolved, (SELECT COUNT(*) FROM documents WHERE control_seq IS NULL) AS unnumbered',
  );
  log(`Local room: ${row.members} members, ${row.mirror} mirrored and ${row.counsel} counsel documents (${row.unnumbered} unnumbered), ${row.comments} comments (${row.resolved} resolved).`);
}

async function main(): Promise<void> {
  const { root, reset, fixture: kind, source, inputs } = parseSeedArgs(process.argv.slice(2));
  const paths = seedPaths(root);
  const log = (line: string) => process.stdout.write(`${line}\n`);
  const owner = devIdentity(await readDevVars());

  if (reset || kind === 'company') await resetLocal(paths, log);
  await run('npx', ['wrangler', 'd1', 'migrations', 'apply', 'legallas', '--local']).catch((error: Error) => {
    const hint = migrationHint(error.message);
    throw hint ? new Error(`${error.message}\n\n${hint}`) : error;
  });
  log('Migrations: local D1 is up to date.');
  const w = cliWrangler('local');
  await w.d1Query(memberSql({ kind: 'add', email: owner, role: 'owner', name: 'Dev Owner' }));
  await w.d1Query(memberSql({ kind: 'add', email: COUNSEL_EMAIL, role: 'counsel', name: COUNSEL_NAME }));
  // Both have ticked the full notice (worker/notice-gate.ts), so the local room and its screenshots open on the room;
  // /notice/ still shows it.
  await w.d1Query(
    `INSERT OR IGNORE INTO notice_acks (email, version) VALUES (${sqlLiteral(owner)}, ${sqlLiteral(NOTICE_VERSION)}), (${sqlLiteral(COUNSEL_EMAIL)}, ${sqlLiteral(NOTICE_VERSION)})`,
  );
  log(`Members: ${owner} (owner), ${COUNSEL_EMAIL} (counsel).`);

  if (source) log(`Fixture: the folder already built at ${source}.`);
  else {
    const fixture = await makeFixture(paths.source, kind);
    log(`Fixture: ${fixture.files} files in ${fixture.out} (${fixture.written} written, ${fixture.unchanged} unchanged, ${fixture.removed} removed).`);
  }
  await mkdir(paths.inbox, { recursive: true, mode: 0o700 });
  await mkdir(paths.cache, { recursive: true, mode: 0o700 });
  await writeFile(paths.config, configJson(source ? { ...paths, source } : paths));
  log(`Config: ${paths.config}`);

  log('Sync: local apply (the first run builds LegallasExtract for the PDF text)...');
  await run('node', ['scripts/sync.ts', '--local', '--apply', '--yes', '--summary', '--config', paths.config], true);
  if (kind === 'case') {
    if (source && !inputs) log('Matter: none for this folder, so the room has no case manifest.');
    else await seedMatter(paths, log, inputs);
    await seedActivity(paths, owner, log);
  } else {
    log('Matter: none, so the room has no published matter.');
    await w.d1Query(checklistSeedSql(owner));
    log('Checklist: a few matches on the company documents.');
  }
  await report(log);
  log('Next: npm run build && npx wrangler dev --local --port <port>, then npm run dev:shoot -- --port <port> /');
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
