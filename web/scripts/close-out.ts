// SPDX-License-Identifier: Apache-2.0
// The end of a matter (web/README.md, "Retention and close-out"). The room's owner runs it on their own machine, with their
// own wrangler login, against their own room. Dry run by default. It prints counts and hashes only: never a name, an
// email or a document's text.
//
//   npm run close-out                               what the room holds; changes nothing
//   npm run close-out -- --revoke                   close the matter: no member, invitation, sync token or AI connection keeps access
//   npm run close-out -- --export <dir>             every table's rows but sign-ins, the audit log's chained copy and hashes, to <dir>
//   npm run close-out -- --delete --export <dir>    export, then delete the room's data
//
// Combined, the steps run in that order. --revoke and --delete each ask for a typed phrase, and each refuses while a legal
// hold is on (the refusal is a hold_events row). --delete needs --revoke done first (no member left), always exports in
// the same run, and refuses if any table's row count changed after that export, so nothing goes without its copy. The
// export holds the room's records (names, comments, drafts), so the owner keeps it as carefully as the room.
//
// | --delete removes | How |
// |---|---|
// | The AI Search instance: the record's text index | wrangler ai-search delete |
// | Every object in the files and index buckets, then both buckets | Cloudflare API |
// | With room backup (wrangler.backup.jsonc): the scratch bucket, then the backup bucket's lock rules, objects and bucket | Cloudflare API |
// | The OAuth namespace: AI connections and app registrations | Cloudflare API |
// | The scratch database, then the room's D1 database, every table, append-only ones included | Cloudflare API. Cloudflare can undelete either for 7 days |
//
// Kept: the law library's bucket and index (public law, no case data). Left for the owner, and printed at the end: the
// Workers (their secrets go with them) and the Access applications.
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { chainLines, verifyCopy, FIELDS, type AuditCopyRow } from '../worker/audit-chain-core.ts';
import { sqlLiteral } from '../worker/sql.ts';
import { NO_HOLD_SQL } from '../worker/sync-rules.ts';
import { hasRoomConfig, readWranglerConfig } from '../worker/wrangler-config.ts';
import { cliHost } from './close-out-host.ts';
import { mapLimit } from './pool.ts';

const USAGE = 'usage: npm run close-out [-- --revoke] [--export <dir>] [--delete]   (--delete needs --export <dir>)';
/** audit_log.via, access_events.actor, room_members.revoked_by and hold_events.actor for this command's rows. */
export const ACTOR = 'close-out';
/** Where the daily sweep keeps the audit log's purged rows (worker/data-retention.ts AUDIT_COPY_PREFIX). */
export const AUDIT_COPY_PREFIX = 'retention/audit-log/';
const AUDIT_PAGE = 5000;
const DELETE_CONCURRENCY = 8;
const KV_BULK = 10_000;

export interface CloseOutArgs {
  revoke: boolean;
  exportDir: string | null;
  delete: boolean;
}

/** Parses argv (without node and the script). Throws the usage line on anything else. */
export function parseCloseOutArgs(argv: readonly string[]): CloseOutArgs {
  const args: CloseOutArgs = { revoke: false, exportDir: null, delete: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--revoke') args.revoke = true;
    else if (arg === '--delete') args.delete = true;
    else if (arg === '--export' && next && !next.startsWith('--')) args.exportDir = argv[++i] ?? null;
    else throw new Error(USAGE);
  }
  if (args.delete && args.exportDir === null) throw new Error(`--delete exports first: add --export <dir>. ${USAGE}`);
  return args;
}

/** The room's resources, read from its own wrangler.jsonc and wrangler.mcp.jsonc. */
export interface RoomResources {
  database: string;
  databaseId: string;
  filesBucket: string;
  indexBucket: string;
  searchInstance: string;
  /** The MCP Worker's OAUTH_KV namespace id; null for a room without the MCP server. */
  oauthKv: string | null;
  /** Room backup's buckets and scratch database (wrangler.backup.jsonc); null for a room without backup. */
  backupBucket: string | null;
  scratchBucket: string | null;
  scratchDatabase: { name: string; id: string } | null;
  /** The bucket and index that are kept: public law, no case data. */
  kept: string[];
  workers: string[];
}

type Config = { name?: string; d1_databases?: { binding?: string; database_name?: string; database_id?: string }[]; r2_buckets?: { binding?: string; bucket_name?: string }[]; ai_search?: { binding?: string; instance_name?: string }[]; kv_namespaces?: { binding?: string; id?: string }[] };

export function roomResources(web: Config, mcp: Config | null, backup: Config | null = null): RoomResources {
  const db = web.d1_databases?.find((d) => d.binding === 'DB');
  const bucket = (binding: string) => web.r2_buckets?.find((b) => b.binding === binding)?.bucket_name;
  const files = bucket('FILES');
  const index = bucket('INDEX');
  const search = web.ai_search?.find((s) => s.binding === 'SEARCH')?.instance_name;
  if (!db?.database_name || !db.database_id || !files || !index || !search) throw new Error('wrangler.jsonc lacks the DB, FILES, INDEX or SEARCH binding');
  const law = [bucket('LAW'), web.ai_search?.find((s) => s.binding === 'LAW_SEARCH')?.instance_name].filter((name): name is string => typeof name === 'string');
  const backupBucket = (binding: string) => backup?.r2_buckets?.find((b) => b.binding === binding)?.bucket_name ?? null;
  const scratch = backup?.d1_databases?.find((d) => d.binding === 'SCRATCH_DB');
  const scratchDatabase = scratch?.database_name && scratch.database_id ? { name: scratch.database_name, id: scratch.database_id } : null;
  // Never the room's own stores under another name: the backup Worker's config check refuses that too (worker/backup/config-rules.ts).
  const own = new Set([files, index, ...law]);
  if ([backupBucket('BACKUP'), backupBucket('SCRATCH')].some((name) => name !== null && own.has(name)) || scratchDatabase?.id === db.database_id) {
    throw new Error("wrangler.backup.jsonc names one of the room's own buckets or its database as backup or scratch");
  }
  return {
    database: db.database_name,
    databaseId: db.database_id,
    filesBucket: files,
    indexBucket: index,
    searchInstance: search,
    oauthKv: mcp?.kv_namespaces?.find((k) => k.binding === 'OAUTH_KV')?.id ?? null,
    backupBucket: backupBucket('BACKUP'),
    scratchBucket: backupBucket('SCRATCH'),
    scratchDatabase,
    kept: law,
    workers: [web.name, mcp?.name, backup?.name].filter((name): name is string => typeof name === 'string'),
  };
}

/** Every bucket --delete empties and removes, in that order: the room's, then backup's scratch, then the backup itself. */
export function roomBuckets(room: RoomResources): string[] {
  return [room.indexBucket, room.filesBucket, room.scratchBucket, room.backupBucket].filter((name): name is string => name !== null);
}

export interface R2Entry {
  key: string;
  size: number;
}

/** Everything the command does to the room. The real one is wrangler and the Cloudflare API; tests pass a fake. */
export interface CloseOutHost {
  /** One read-only statement's rows. */
  query(sql: string): Promise<Record<string, unknown>[]>;
  /** Statements in order. Each one carries its own hold check. */
  execute(statements: readonly string[]): Promise<void>;
  /** Every object, or null when the bucket doesn't exist. */
  listObjects(bucket: string, prefix?: string): Promise<R2Entry[] | null>;
  readObject(bucket: string, key: string): Promise<string>;
  deleteObject(bucket: string, key: string): Promise<void>;
  deleteBucket(bucket: string): Promise<void>;
  /** How many bucket lock rules a bucket has (room backup locks its objects for 30 days). */
  lockRules(bucket: string): Promise<number>;
  /** Removes every lock rule, so the objects can be deleted. */
  clearLockRules(bucket: string): Promise<void>;
  /** Every key name, or null when the namespace doesn't exist. */
  listKeys(namespace: string): Promise<string[] | null>;
  deleteKeys(namespace: string, keys: readonly string[]): Promise<void>;
  deleteNamespace(namespace: string): Promise<void>;
  searchExists(instance: string): Promise<boolean>;
  deleteSearch(instance: string): Promise<void>;
  deleteDatabase(id: string): Promise<void>;
}

export interface Io {
  out(line: string): void;
  /** One typed line. */
  ask(prompt: string): Promise<string>;
  now(): Date;
}

/** A refusal: the command stops and changes nothing more. */
export class Refused extends Error {
  override name = 'Refused';
}

const TABLE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const n = (value: unknown) => Number(value ?? 0);
const thousands = (value: number) => value.toLocaleString('en-US');
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/** Each table and its rows, by name (no row content). */
export async function tableCounts(host: CloseOutHost): Promise<Map<string, number>> {
  const names = (await host.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%' ORDER BY name"))
    .map((row) => String(row.name))
    .filter((name) => TABLE.test(name));
  if (names.length === 0) return new Map();
  const rows = await host.query(names.map((name) => `SELECT '${name}' AS t, COUNT(*) AS n FROM "${name}"`).join(' UNION ALL '));
  return new Map(rows.map((row) => [String(row.t), n(row.n)]));
}

/** FTS5's own storage behind a virtual table, rebuilt from that table's rows, which are exported. */
const FTS5_SHADOWS = ['_data', '_idx', '_content', '_docsize', '_config'];
/** Sign-in records (email, IP, browser) have their own retention setting; the export leaves them out. */
export const NOT_EXPORTED = 'sign_ins';
const TABLE_PAGE = 1000;

/** The tables --export writes in full: every table but sign-ins and FTS5's shadow tables. */
export async function exportedTables(host: CloseOutHost): Promise<string[]> {
  const rows = await host.query("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%' ORDER BY name");
  const shadows = new Set(rows.filter((row) => /^CREATE VIRTUAL TABLE/i.test(String(row.sql ?? ''))).flatMap((row) => FTS5_SHADOWS.map((suffix) => `${String(row.name)}${suffix}`)));
  return rows.map((row) => String(row.name)).filter((name) => TABLE.test(name) && name !== NOT_EXPORTED && !shadows.has(name));
}

/** One JSON line per row of `table`, in rowid order. */
async function tableLines(host: CloseOutHost, table: string): Promise<string[]> {
  const lines: string[] = [];
  for (let after: number | null = null; ; ) {
    const where = after === null ? '' : ` WHERE rowid > ${after}`;
    const rows = await host.query(`SELECT rowid AS _rowid_, * FROM "${table}"${where} ORDER BY rowid LIMIT ${TABLE_PAGE}`);
    for (const { _rowid_: _, ...row } of rows) lines.push(JSON.stringify(row));
    if (rows.length < TABLE_PAGE) return lines;
    after = n(rows.at(-1)?._rowid_);
  }
}

interface Hold {
  id: number;
  since: string;
}

async function activeHold(host: CloseOutHost): Promise<Hold | null> {
  const [row] = await host.query('SELECT id, started_at FROM legal_holds WHERE released_at IS NULL ORDER BY id LIMIT 1');
  return row ? { id: n(row.id), since: String(row.started_at).slice(0, 10) } : null;
}

/** Refuses `step` while a hold is on, recording the refusal on the hold (hold_events, migration 0017). */
async function refuseUnderHold(host: CloseOutHost, step: 'revoke' | 'delete'): Promise<void> {
  const hold = await activeHold(host);
  if (!hold) return;
  await host.execute([`INSERT INTO hold_events (hold_id, actor, action, detail_code) VALUES (${hold.id}, ${sqlLiteral(ACTOR)}, 'removal_refused', ${sqlLiteral(`close_out_${step}`)});`]);
  throw new Refused(`A legal hold is on since ${hold.since}. Nothing was changed. Release the hold first, when the duty to preserve has ended.`);
}

async function confirm(io: Io, phrase: string, what: string): Promise<void> {
  io.out(`\n${what}\nType "${phrase}" to continue, anything else to stop:`);
  if ((await io.ask('> ')).trim() !== phrase) throw new Refused('Stopped: the phrase did not match. Nothing was changed.');
}

/** OAuth grants by user (keys grant:<user>:<grant>, mcp/sweep.ts) and the token keys that go with them. */
export function oauthKeys(keys: readonly string[]): { grants: { key: string; user: string }[]; tokens: string[]; clients: number } {
  const grants: { key: string; user: string }[] = [];
  const tokens: string[] = [];
  let clients = 0;
  for (const key of keys) {
    const user = /^grant:([^:]+):[^:]+$/.exec(key)?.[1];
    if (user) grants.push({ key, user });
    else if (key.startsWith('token:')) tokens.push(key);
    else if (key.startsWith('client:')) clients++;
  }
  return { grants, tokens, clients };
}

/** What --revoke writes, every statement guarded by NO_HOLD_SQL: the close, one ai_disconnect row per grant, then access ends. */
export function revokeStatements(now: Date, grantUsers: readonly string[]): string[] {
  const ts = sqlLiteral(now.toISOString());
  const actor = sqlLiteral(ACTOR);
  return [
    `INSERT INTO matter_close (id, closed_at, closed_by) SELECT 1, ${ts}, ${actor} WHERE NOT EXISTS (SELECT 1 FROM matter_close) AND ${NO_HOLD_SQL};`,
    ...grantUsers.map((user) => `INSERT INTO audit_log (email, action, via) SELECT ${sqlLiteral(user)}, 'ai_disconnect', ${actor} WHERE ${NO_HOLD_SQL};`),
    `INSERT INTO access_events (actor, action, room_id, grant_id, subject_email) SELECT ${actor}, 'grant_revoked', room_id, id, email FROM room_members WHERE revoked_at IS NULL AND ${NO_HOLD_SQL};`,
    `UPDATE room_members SET revoked_at = ${ts}, revoked_by = ${actor} WHERE revoked_at IS NULL AND ${NO_HOLD_SQL};`,
    `UPDATE sync_tokens SET revoked_at = ${ts} WHERE revoked_at IS NULL AND ${NO_HOLD_SQL};`,
    `DELETE FROM members WHERE ${NO_HOLD_SQL};`,
  ];
}

async function accessCounts(host: CloseOutHost): Promise<{ members: number; invitations: number; syncTokens: number }> {
  const [row] = await host.query(
    'SELECT (SELECT COUNT(*) FROM members) AS members, (SELECT COUNT(*) FROM room_members WHERE revoked_at IS NULL) AS invitations, ' +
      '(SELECT COUNT(*) FROM sync_tokens WHERE revoked_at IS NULL) AS sync_tokens',
  );
  return { members: n(row?.members), invitations: n(row?.invitations), syncTokens: n(row?.sync_tokens) };
}

/** The dry run: what the room holds, counts only. */
export async function survey(host: CloseOutHost, room: RoomResources, io: Io): Promise<void> {
  const hold = await activeHold(host);
  const [close] = await host.query('SELECT closed_at FROM matter_close WHERE id = 1');
  const access = await accessCounts(host);
  const kv = room.oauthKv ? await host.listKeys(room.oauthKv) : null;
  const oauth = oauthKeys(kv ?? []);
  io.out(`Close-out for "${room.database}": dry run, nothing changes.\n`);
  io.out('| | |\n|---|---|');
  io.out(`| Legal hold | ${hold ? `on since ${hold.since}: every step refuses` : 'off'} |`);
  io.out(`| Matter | ${close?.closed_at ? `closed ${String(close.closed_at).slice(0, 10)}` : 'open'} |`);
  io.out(`| Members | ${access.members} |`);
  io.out(`| Open invitations | ${access.invitations} |`);
  io.out(`| Sync tokens | ${access.syncTokens} |`);
  io.out(`| AI connections | ${kv === null ? 'no OAuth namespace' : `${oauth.grants.length} grants, ${oauth.tokens.length} tokens, ${oauth.clients} app registrations`} |`);
  io.out(`\n| Table in ${room.database} | Rows |\n|---|---|`);
  for (const [name, rows] of await tableCounts(host)) io.out(`| ${name} | ${thousands(rows)} |`);
  io.out('\n| Bucket | Objects | Bytes | Lock rules |\n|---|---|---|---|');
  for (const bucket of roomBuckets(room)) {
    const objects = await host.listObjects(bucket);
    const locks = objects === null ? '' : String(await host.lockRules(bucket));
    io.out(objects === null ? `| ${bucket} | gone | | |` : `| ${bucket} | ${thousands(objects.length)} | ${thousands(objects.reduce((sum, o) => sum + o.size, 0))} | ${locks} |`);
  }
  if (room.scratchDatabase) io.out(`Scratch database ${room.scratchDatabase.name}: deleted by --delete with the room's own.`);
  io.out(`\nAI Search ${room.searchInstance}: ${(await host.searchExists(room.searchInstance)) ? 'present' : 'gone'}`);
  if (room.kept.length > 0) io.out(`Kept by every step: ${room.kept.join(', ')} (public law, no case data).`);
  io.out('\nNext: npm run close-out -- --revoke, then npm run close-out -- --delete --export <dir>.');
}

/** --revoke: closes the matter and ends every way in. Re-runnable: each statement does only what is left. */
export async function revoke(host: CloseOutHost, room: RoomResources, io: Io): Promise<void> {
  await refuseUnderHold(host, 'revoke');
  const before = await accessCounts(host);
  const keys = room.oauthKv ? ((await host.listKeys(room.oauthKv)) ?? []) : [];
  const oauth = oauthKeys(keys);
  await confirm(
    io,
    `revoke ${room.database}`,
    `This closes the matter and removes ${before.members} members, ${before.invitations} invitations, ${before.syncTokens} sync tokens and ${oauth.grants.length} AI connections. It can't be undone; members can be added again.`,
  );
  await refuseUnderHold(host, 'revoke');
  // The database first: every request and tool call re-reads members, so access ends here. Then the AI connections' tokens.
  await host.execute(revokeStatements(io.now(), oauth.grants.map((grant) => grant.user)));
  const after = await accessCounts(host);
  if (after.members > 0) throw new Refused('A legal hold started during the run: members were kept. Nothing else was changed.');
  const oauthGone = [...oauth.grants.map((grant) => grant.key), ...oauth.tokens];
  if (room.oauthKv) for (let i = 0; i < oauthGone.length; i += KV_BULK) await host.deleteKeys(room.oauthKv, oauthGone.slice(i, i + KV_BULK)); // oauthGone is empty without a namespace
  io.out(`\nMatter closed. Removed ${before.members} members, ended ${before.invitations} invitations, revoked ${before.syncTokens} sync tokens, ended ${oauth.grants.length} AI connections (${oauth.tokens.length} tokens).`);
  io.out('Still yours to do: in Cloudflare Zero Trust, empty the Access policies of both applications and revoke every session (Users, Revoke sessions).');
}

export interface ExportManifest {
  database: string;
  exportedAt: string;
  audit: { rows: number; purgedRows: number; firstId: number | null; lastId: number | null; chain: string };
  files: Record<string, { sha256: string; bytes: number }>;
  tables: Record<string, number>;
  buckets: Record<string, { objects: number; bytes: number }>;
}

/** The audit log from its first row: the sweep's purged copies in order, then the live rows chained on from the last one. */
async function auditCopy(host: CloseOutHost, room: RoomResources): Promise<{ text: string; rows: number; purgedRows: number; firstId: number | null; lastId: number | null; chain: string }> {
  const copies = ((await host.listObjects(room.filesBucket, AUDIT_COPY_PREFIX)) ?? []).map((o) => o.key).sort();
  let text = '';
  for (const key of copies) text += await host.readObject(room.filesBucket, key);
  const purgedLines = text.split('\n').filter((line) => line !== '');
  const [purge] = await host.query('SELECT chain FROM audit_purges ORDER BY id DESC LIMIT 1');
  let previous = purge ? String(purge.chain) : '';
  const lines: string[] = [];
  let firstId: number | null = null;
  let lastId: number | null = null;
  for (let after = 0; ; ) {
    const rows = (await host.query(`SELECT ${FIELDS.join(', ')} FROM audit_log WHERE id > ${after} ORDER BY id LIMIT ${AUDIT_PAGE}`)) as AuditCopyRow[];
    const page = await chainLines(rows, previous);
    lines.push(...page.lines);
    previous = page.last;
    const first = rows[0];
    const last = rows.at(-1);
    if (!first || !last) break;
    firstId ??= n(first.id);
    lastId = n(last.id);
    if (rows.length < AUDIT_PAGE) break;
    after = lastId;
  }
  text += lines.map((line) => `${line}\n`).join('');
  const verdict = await verifyCopy(text);
  if (!verdict.ok) throw new Refused(`The audit log's chain doesn't verify at line ${verdict.line}: a purged copy is missing or changed. Nothing was deleted.`);
  return { text, rows: lines.length + purgedLines.length, purgedRows: purgedLines.length, firstId, lastId, chain: previous };
}

/** --export: writes the audit log, a documents index and an objects index to `dir`, and a manifest with their hashes. */
export async function exportRoom(host: CloseOutHost, room: RoomResources, io: Io, dir: string, write = writeFile): Promise<ExportManifest> {
  const audit = await auditCopy(host, room);
  const documents = await host.query('SELECT id, kind, source, size, sha256, r2_key, updated_at, removed_at FROM documents ORDER BY id');
  const buckets: ExportManifest['buckets'] = {};
  const objectLines: string[] = [];
  for (const bucket of [room.filesBucket, room.indexBucket]) {
    const objects = (await host.listObjects(bucket)) ?? [];
    buckets[bucket] = { objects: objects.length, bytes: objects.reduce((sum, o) => sum + o.size, 0) };
    for (const object of objects) objectLines.push(JSON.stringify({ bucket, key: object.key, size: object.size }));
  }
  const files: Record<string, string> = {
    'audit-log.jsonl': audit.text,
    'documents.jsonl': documents.map((row) => `${JSON.stringify(row)}\n`).join(''),
    'objects.jsonl': objectLines.map((line) => `${line}\n`).join(''),
  };
  const counts = await tableCounts(host);
  for (const table of await exportedTables(host)) {
    const lines = await tableLines(host, table);
    if (lines.length !== counts.get(table)) throw new Refused(`${table} changed during the export. Run the command again. Nothing was deleted.`);
    files[`tables/${table}.jsonl`] = lines.map((line) => `${line}\n`).join('');
  }
  await mkdir(path.join(dir, 'tables'), { recursive: true });
  const manifest: ExportManifest = {
    database: room.database,
    exportedAt: io.now().toISOString(),
    audit: { rows: audit.rows, purgedRows: audit.purgedRows, firstId: audit.firstId, lastId: audit.lastId, chain: audit.chain },
    files: {},
    tables: Object.fromEntries(counts),
    buckets,
  };
  for (const [name, text] of Object.entries(files)) {
    await write(path.join(dir, name), text);
    manifest.files[name] = { sha256: sha256(text), bytes: Buffer.byteLength(text) };
  }
  await write(path.join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const tables = Object.keys(files).filter((name) => name.startsWith('tables/')).length;
  io.out(`\nExported to the folder you named: ${tables} tables, every one but ${NOT_EXPORTED}. Audit log: ${thousands(audit.rows)} rows (${thousands(audit.purgedRows)} from purged copies), chain ${audit.chain || '(empty)'}.`);
  io.out('| File | Bytes | SHA-256 |\n|---|---|---|');
  for (const [name, file] of Object.entries(manifest.files)) io.out(`| ${name} | ${thousands(file.bytes)} | ${file.sha256} |`);
  return manifest;
}

/** --delete: after --revoke and a fresh export, removes the room's data store by store. Re-runnable: gone stores are skipped. */
export async function deleteRoom(host: CloseOutHost, room: RoomResources, io: Io, manifest: ExportManifest): Promise<void> {
  await refuseUnderHold(host, 'delete');
  const access = await accessCounts(host);
  if (access.members > 0 || access.invitations > 0 || access.syncTokens > 0) throw new Refused('People still have access. Run npm run close-out -- --revoke first. Nothing was deleted.');
  await confirm(
    io,
    `delete ${room.database}`,
    `This deletes the AI Search instance ${room.searchInstance}, every object in ${roomBuckets(room).join(', ')} and the buckets${room.backupBucket ? ` (the backup's lock rules removed first)` : ''}, the OAuth namespace and the database ${room.database}${room.scratchDatabase ? ` and ${room.scratchDatabase.name}` : ''}. Cloudflare can undelete a database for 7 days; nothing else comes back. The export's audit chain is ${manifest.audit.chain || '(empty)'}.`,
  );
  await refuseUnderHold(host, 'delete');
  const [now] = await host.query('SELECT COUNT(*) AS rows, MAX(id) AS last FROM audit_log');
  if (n(now?.rows) !== manifest.audit.rows - manifest.audit.purgedRows || (now?.last ?? null) !== manifest.audit.lastId) {
    throw new Refused('The audit log changed after the export. Run the command again. Nothing was deleted.');
  }
  const live = await tableCounts(host);
  const exported = new Map(Object.entries(manifest.tables));
  for (const name of new Set([...live.keys(), ...exported.keys()])) {
    if (live.get(name) !== exported.get(name)) throw new Refused(`The room changed after the export (${name}). Run the command again. Nothing was deleted.`);
  }
  if (await host.searchExists(room.searchInstance)) {
    await host.deleteSearch(room.searchInstance);
    io.out(`Deleted AI Search ${room.searchInstance}.`);
  }
  for (const bucket of roomBuckets(room)) {
    const objects = await host.listObjects(bucket);
    if (objects === null) continue;
    const locks = await host.lockRules(bucket);
    if (locks > 0) {
      await host.clearLockRules(bucket);
      io.out(`Removed ${locks} lock rules from ${bucket}.`);
    }
    await mapLimit(objects, DELETE_CONCURRENCY, (object) => host.deleteObject(bucket, object.key));
    await host.deleteBucket(bucket);
    io.out(`Deleted ${thousands(objects.length)} objects and the bucket ${bucket}.`);
  }
  if (room.oauthKv && (await host.listKeys(room.oauthKv)) !== null) {
    await host.deleteNamespace(room.oauthKv);
    io.out('Deleted the OAuth namespace.');
  }
  if (room.scratchDatabase) {
    await host.deleteDatabase(room.scratchDatabase.id);
    io.out(`Deleted the scratch database ${room.scratchDatabase.name}.`);
  }
  await host.deleteDatabase(room.databaseId);
  io.out(`Deleted the database ${room.database} (${thousands(Object.values(manifest.tables).reduce((sum, rows) => sum + rows, 0))} rows at export).`);
  io.out(`\nLeft for you: delete the Workers ${room.workers.join(' and ')} (npx wrangler delete --name <worker>; their secrets go with them) and the Access applications. Keep the export folder for as long as your own schedule says.`);
}

/** Runs the steps args names, in order. */
export async function closeOut(args: CloseOutArgs, host: CloseOutHost, room: RoomResources, io: Io, write = writeFile): Promise<void> {
  const [migrated] = await host.query("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name IN ('matter_close', 'audit_purges')");
  if (n(migrated?.n) !== 2) throw new Refused('This database lacks migration 0022 (retention). Run npm run db:migrate first. Nothing was changed.');
  if (!args.revoke && !args.exportDir && !args.delete) return survey(host, room, io);
  if (args.revoke) await revoke(host, room, io);
  const manifest = args.exportDir ? await exportRoom(host, room, io, args.exportDir, write) : null;
  if (args.delete && manifest) await deleteRoom(host, room, io, manifest); // parseCloseOutArgs requires --export with --delete
}

function terminalIo(): Io {
  const lines = createInterface({ input: process.stdin, terminal: false });
  const pending: string[] = [];
  const waiting: ((line: string) => void)[] = [];
  lines.on('line', (line) => {
    const next = waiting.shift();
    if (next) next(line);
    else pending.push(line);
  });
  lines.on('close', () => waiting.splice(0).forEach((resolve) => resolve('')));
  return {
    out: (line) => process.stdout.write(`${line}\n`),
    ask(prompt) {
      process.stdout.write(prompt);
      const line = pending.shift();
      return line !== undefined ? Promise.resolve(line) : new Promise((resolve) => waiting.push(resolve));
    },
    now: () => new Date(),
  };
}

if (import.meta.main) {
  const io = terminalIo();
  try {
    const args = parseCloseOutArgs(process.argv.slice(2));
    if (!hasRoomConfig('wrangler')) throw new Refused('No wrangler.jsonc here: run this in the room checkout, beside its own config.');
    const optional = (base: 'wrangler.mcp' | 'wrangler.backup') => (hasRoomConfig(base) ? readWranglerConfig(base).config : null);
    const room = roomResources(readWranglerConfig('wrangler').config, optional('wrangler.mcp'), optional('wrangler.backup'));
    await closeOut(args, await cliHost(room), room, io);
    process.exit(0);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}

