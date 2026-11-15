// SPDX-License-Identifier: Apache-2.0
// The room backup's D1 half (layout.ts): read the database's schema, copy each table a page at a time in rowid order,
// rebuild the tables in another database, and hash a table the same way at both ends, so the drill can compare.
// `wrangler d1 export` refuses a database that holds a virtual table (migrations/0009_page_fts.sql), so this reads
// rows through the Worker's binding instead.
import { BackupError, linesText, PAGE, rollUp, sha256Hex } from './layout.ts';

/** A table, index, trigger or view, in the order the database created it. */
export interface SchemaEntry {
  type: string;
  name: string;
  table: string;
  sql: string;
}

/** How one table is backed up: its name and columns. */
export interface TablePlan {
  name: string;
  columns: string[];
  /** The INTEGER PRIMARY KEY column that is the rowid, if any; otherwise the rowid is copied as its own value. */
  rowidAlias: string | null;
  /** Rows are rebuilt from the backed-up index after a restore, never copied. */
  derived: boolean;
}

/** The database schema: its entries, and its tables with parents before the tables that point at them. */
export interface Schema {
  entries: SchemaEntry[];
  /** Every table, parents before the tables whose foreign keys point at them. */
  tables: TablePlan[];
}

/**
 * Tables filled from legallas-index by scripts/fts-index.ts. A restore creates them empty, and the owner runs the
 * indexer again (migrations/0009_page_fts.sql). A virtual table missing here stops the backup, so a new one gets a rule.
 */
export const DERIVED_TABLES: readonly string[] = ['page_fts', 'page_fts_docs'];
/** The drill's table in the scratch database: it marks the database as one a drill may empty. */
export const MARKER_TABLE = 'legallas_scratch';
/** Tables FTS5 creates beside each of its virtual tables (sqlite.org/fts5.html). They come back with the virtual table. */
const FTS5_SHADOWS = ['_data', '_idx', '_content', '_docsize', '_config'];
/** D1 binds at most 100 parameters per query (D1 limits page, read 2026-11-06). */
const MAX_PARAMS = 100;
const BATCH = 50;

interface MasterRow {
  type: string;
  name: string;
  tbl_name: string;
  sql: string | null;
}

const quote = (name: string): string => `"${name.replace(/"/g, '""')}"`;
const internal = (name: string): boolean => name.startsWith('_cf_') || name.startsWith('sqlite_');
const isVirtual = (sql: string): boolean => /^\s*CREATE\s+VIRTUAL\s+TABLE/i.test(sql);

async function master(db: D1Database): Promise<MasterRow[]> {
  return (await db.prepare('SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY rowid').all<MasterRow>()).results;
}

function shadowsOf(rows: readonly MasterRow[]): Set<string> {
  const virtual = rows.filter((row) => row.type === 'table' && row.sql !== null && isVirtual(row.sql));
  return new Set(virtual.flatMap((row) => FTS5_SHADOWS.map((suffix) => `${row.name}${suffix}`)));
}

/** What the database holds that is not D1's or SQLite's own, nor an FTS5 shadow table. */
async function ownEntries(db: D1Database): Promise<SchemaEntry[]> {
  const rows = await master(db);
  const shadows = shadowsOf(rows);
  return rows
    .filter((row) => row.sql !== null && !internal(row.name) && !internal(row.tbl_name) && !shadows.has(row.name))
    .map((row) => ({ type: row.type, name: row.name, table: row.tbl_name, sql: row.sql! }));
}

async function parentsOf(db: D1Database, table: string): Promise<string[]> {
  const { results } = await db.prepare('SELECT DISTINCT "table" AS parent FROM pragma_foreign_key_list(?1)').bind(table).all<{ parent: string }>();
  return results.map((row) => row.parent);
}

/** Names with each table after the tables it references, otherwise in the order given. */
function parentsFirst(names: readonly string[], parents: ReadonlyMap<string, readonly string[]>): string[] {
  const byLower = new Map(names.map((name) => [name.toLowerCase(), name]));
  const ordered: string[] = [];
  const placed = new Set<string>();
  const visit = (name: string, path: Set<string>): void => {
    if (placed.has(name) || path.has(name)) return;
    path.add(name);
    for (const parent of parents.get(name) ?? []) {
      const known = byLower.get(parent.toLowerCase());
      if (known && known !== name) visit(known, path);
    }
    placed.add(name);
    ordered.push(name);
  };
  for (const name of names) visit(name, new Set());
  return ordered;
}

/** Reads the database's own schema, leaving out the marker table. */
export async function readSchema(db: D1Database): Promise<Schema> {
  const entries = (await ownEntries(db)).filter((entry) => entry.name !== MARKER_TABLE);
  const plans = new Map<string, TablePlan>();
  const parents = new Map<string, string[]>();
  for (const table of entries.filter((entry) => entry.type === 'table')) {
    if (/WITHOUT\s+ROWID/i.test(table.sql)) throw new BackupError('without-rowid', 'a table has no rowid, which the backup pages by');
    const virtual = isVirtual(table.sql);
    if (virtual && !DERIVED_TABLES.includes(table.name)) throw new BackupError('unknown-virtual-table', 'a virtual table has no backup rule (DERIVED_TABLES)');
    const derived = DERIVED_TABLES.includes(table.name);
    if (derived) {
      plans.set(table.name, { name: table.name, columns: [], rowidAlias: null, derived });
      continue;
    }
    const { results: info } = await db.prepare('SELECT name, type, pk FROM pragma_table_info(?1)').bind(table.name).all<{ name: string; type: string; pk: number }>();
    const keys = info.filter((column) => column.pk > 0);
    const rowidAlias = keys.length === 1 && keys[0]!.type.toUpperCase() === 'INTEGER' ? keys[0]!.name : null;
    plans.set(table.name, { name: table.name, columns: info.map((column) => column.name), rowidAlias, derived });
    parents.set(table.name, await parentsOf(db, table.name));
  }
  return { entries, tables: parentsFirst([...plans.keys()], parents).map((name) => plans.get(name)!) };
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** A column value as JSON: a BLOB becomes {"$b": base64}. */
export function encodeValue(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'number') return value;
  if (value instanceof ArrayBuffer) return { $b: toBase64(new Uint8Array(value)) };
  if (ArrayBuffer.isView(value)) return { $b: toBase64(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)) };
  if (Array.isArray(value)) return { $b: toBase64(Uint8Array.from(value as number[])) };
  throw new BackupError('unknown-value', 'a column holds a value the backup cannot copy');
}

/** Decodes a value read from a backup page. */
export function decodeValue(value: unknown): unknown {
  if (value !== null && typeof value === 'object') {
    const blob = (value as { $b?: unknown }).$b;
    if (typeof blob !== 'string') throw new BackupError('bad-row', 'a copied row holds an unknown value');
    return Uint8Array.from(atob(blob), (char) => char.charCodeAt(0));
  }
  return value;
}

/** The counts of rows and pages dumped for a table. */
export interface Dumped {
  rows: number;
  pages: number;
  hash: string;
}

/**
 * Reads a table in rowid order, PAGE rows at a time: the rowid, then every column. Each page is one JSON array per line;
 * the table's hash rolls up the pages' hashes. The drill reads the restored table the same way and must get the same hash.
 */
export async function dumpTable(db: D1Database, plan: TablePlan, onPage?: (text: string, page: number) => Promise<void>): Promise<Dumped> {
  if (plan.derived) throw new BackupError('derived-table', 'a derived table is rebuilt, never copied');
  const select = `SELECT rowid AS "__rowid", ${plan.columns.map(quote).join(', ')} FROM ${quote(plan.name)}`;
  const hashes: string[] = [];
  let rows = 0;
  let last: number | null = null;
  for (;;) {
    const statement: D1PreparedStatement =
      last === null ? db.prepare(`${select} ORDER BY rowid LIMIT ${PAGE}`) : db.prepare(`${select} WHERE rowid > ?1 ORDER BY rowid LIMIT ${PAGE}`).bind(last);
    const got = await statement.raw<unknown[]>();
    if (got.length === 0) break;
    const text = linesText(got.map((row) => row.map(encodeValue)));
    hashes.push(await sha256Hex(text));
    await onPage?.(text, hashes.length - 1);
    rows += got.length;
    last = Number(got[got.length - 1]![0]);
    if (got.length < PAGE) break;
  }
  return { rows, pages: hashes.length, hash: await rollUp(hashes) };
}

/** Creates every table in creation order, empty. Indexes, triggers and views wait for createRest, after the rows. */
export async function createTables(db: D1Database, entries: readonly SchemaEntry[]): Promise<void> {
  const tables = entries.filter((entry) => entry.type === 'table');
  for (let i = 0; i < tables.length; i += BATCH) await db.batch(tables.slice(i, i + BATCH).map((entry) => db.prepare(entry.sql)));
}

/** Indexes, triggers and views, once the rows are in, so no trigger fires on a restored row. */
export async function createRest(db: D1Database, entries: readonly SchemaEntry[]): Promise<void> {
  const rest = entries.filter((entry) => entry.type !== 'table');
  for (let i = 0; i < rest.length; i += BATCH) await db.batch(rest.slice(i, i + BATCH).map((entry) => db.prepare(entry.sql)));
}

/** Inserts one copied page, its rowids kept, in batches that defer foreign keys to each batch's end. */
export async function restoreRows(db: D1Database, plan: TablePlan, text: string): Promise<number> {
  const rows = text
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => (JSON.parse(line) as unknown[]).map(decodeValue));
  const columns = plan.rowidAlias ? plan.columns : ['rowid', ...plan.columns];
  const perStatement = Math.floor(MAX_PARAMS / columns.length);
  if (perStatement < 1) throw new BackupError('too-many-columns', 'a table has more columns than one D1 query can bind');
  const statements: D1PreparedStatement[] = [];
  for (let i = 0; i < rows.length; i += perStatement) {
    const chunk = rows.slice(i, i + perStatement);
    const tuple = `(${columns.map(() => '?').join(', ')})`;
    const values = chunk.flatMap((row) => {
      if (row.length !== plan.columns.length + 1) throw new BackupError('bad-row', 'a copied row has the wrong number of values');
      return plan.rowidAlias ? row.slice(1) : row;
    });
    statements.push(db.prepare(`INSERT INTO ${quote(plan.name)} (${columns.map(quote).join(', ')}) VALUES ${chunk.map(() => tuple).join(', ')}`).bind(...values));
  }
  for (let i = 0; i < statements.length; i += BATCH) await db.batch([db.prepare('PRAGMA defer_foreign_keys = true'), ...statements.slice(i, i + BATCH)]);
  return rows.length;
}

/** The names of everything in the database that is not D1's or SQLite's own. */
export async function userTables(db: D1Database): Promise<string[]> {
  const rows = await master(db);
  return rows.filter((row) => row.type === 'table' && !internal(row.name)).map((row) => row.name);
}

/** Drops every view and table that is not D1's or SQLite's own, children first. Returns how many tables. */
export async function dropAll(db: D1Database): Promise<number> {
  const rows = (await master(db)).filter((row) => !internal(row.name));
  const shadows = shadowsOf(rows);
  const tables = rows.filter((row) => row.type === 'table' && !shadows.has(row.name)).map((row) => row.name);
  const parents = new Map<string, string[]>();
  for (const table of tables) {
    const row = rows.find((candidate) => candidate.name === table)!;
    if (row.sql === null || !isVirtual(row.sql)) parents.set(table, await parentsOf(db, table));
  }
  const statements = [
    db.prepare('PRAGMA defer_foreign_keys = true'),
    ...rows.filter((row) => row.type === 'view').map((row) => db.prepare(`DROP VIEW IF EXISTS ${quote(row.name)}`)),
    ...parentsFirst(tables, parents)
      .reverse()
      .map((table) => db.prepare(`DROP TABLE IF EXISTS ${quote(table)}`)),
  ];
  if (statements.length > 1) await db.batch(statements);
  return tables.length;
}
