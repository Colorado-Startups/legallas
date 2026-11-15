// SPDX-License-Identifier: Apache-2.0
// Test support only (never imported by the Worker): a D1Database backed by Node's built-in SQLite,
// with every file in migrations/ applied. Tests then exercise the real SQL, constraints and indexes
// instead of a fake that pattern-matches query strings.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { tickEveryMember } from './notice-fixtures.ts';

const MIGRATIONS = join(import.meta.dirname, '..', 'migrations');

type Value = string | number | null;

class Statement {
  private readonly db: DatabaseSync;
  readonly sql: string;
  private readonly args: Value[];

  constructor(db: DatabaseSync, sql: string, args: Value[] = []) {
    this.db = db;
    this.sql = sql;
    this.args = args;
  }

  bind(...args: unknown[]): Statement {
    // D1 rejects undefined; keep tests honest by doing the same.
    for (const arg of args) if (arg === undefined) throw new TypeError('D1_TYPE_ERROR: undefined bind value');
    return new Statement(this.db, this.sql, args as Value[]);
  }

  async first<T>(column?: string): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...(this.args as SQLInputValue[])) as Record<string, unknown> | undefined;
    if (!row) return null;
    return (column ? row[column] : { ...row }) as T;
  }

  async all<T>(): Promise<{ results: T[]; success: true; meta: Record<string, unknown> }> {
    const rows = this.db.prepare(this.sql).all(...(this.args as SQLInputValue[])) as Record<string, unknown>[];
    return { results: rows.map((row) => ({ ...row }) as T), success: true, meta: {} };
  }

  async run(): Promise<{ success: true; meta: { changes: number; last_row_id: number } }> {
    const result = this.db.prepare(this.sql).run(...(this.args as SQLInputValue[]));
    return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
  }
}

export interface TestDb {
  db: D1Database;
  sqlite: DatabaseSync;
}

/** A fresh in-memory database with all migrations applied. */
export function testDb(): TestDb {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(join(MIGRATIONS, file), 'utf8'));
  }
  tickEveryMember(sqlite);
  const db = {
    prepare: (sql: string) => new Statement(sqlite, sql),
    // D1 runs a batch as one transaction.
    async batch(statements: Statement[]) {
      sqlite.exec('BEGIN');
      try {
        const out = [];
        for (const statement of statements) out.push(await statement.run());
        sqlite.exec('COMMIT');
        return out;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return { db: db as unknown as D1Database, sqlite };
}
