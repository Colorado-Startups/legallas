// SPDX-License-Identifier: Apache-2.0
// Test fakes for the room backup (imported only by *.test.ts): an in-memory R2 bucket with R2's etags, SHA-256 check
// on write and list paging, and a D1 database over node:sqlite with foreign keys enforced, as D1 does. The fictional
// room is the fixture's own: Doe v. Harbor Labs, control prefix DOE. Every fact in it is invented.
import { createHash } from 'node:crypto';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { HashBody } from './r2.ts';
import { schemaDb, seed } from '../room-fixtures.ts';
import type { BackupEnv, Step, Tools } from './flow.ts';

interface Stored {
  bytes: Uint8Array;
  etag: string;
  httpMetadata?: R2HTTPMetadata;
  customMetadata?: Record<string, string>;
  sha256?: string;
}

const md5 = (bytes: Uint8Array) => createHash('md5').update(bytes).digest('hex');
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const buffer = (hexText: string) => Uint8Array.from(Buffer.from(hexText, 'hex')).buffer;

async function bytesOf(value: unknown): Promise<Uint8Array> {
  if (typeof value === 'string') return new TextEncoder().encode(value);
  if (value instanceof ReadableStream) return new Uint8Array(await new Response(value).arrayBuffer());
  if (value instanceof Uint8Array) return value;
  throw new Error('fake R2: unexpected value');
}

/** A bucket in memory. `readOnly` makes every write throw, to prove a run never writes to a room bucket. */
export class FakeBucket {
  readonly objects = new Map<string, Stored>();
  readOnly = false;
  puts = 0;
  /** Objects per list page: R2's is 1,000; the tests use fewer so every run crosses pages. */
  readonly pageSize: number;

  constructor(pageSize = 1000) {
    this.pageSize = pageSize;
  }

  /** Seeds an object as the room would have stored it; `etag` imitates a multipart upload's. */
  seed(key: string, text: string, contentType = 'application/pdf', etag?: string): void {
    const bytes = new TextEncoder().encode(text);
    this.objects.set(key, { bytes, etag: etag ?? md5(bytes), httpMetadata: { contentType }, customMetadata: { origin: 'fixture' } });
  }

  /** Changes an object's bytes and nothing else, as bit rot would. */
  corrupt(key: string): void {
    const stored = this.objects.get(key)!;
    stored.bytes = new TextEncoder().encode(`${new TextDecoder().decode(stored.bytes)} (changed)`);
  }

  private view(key: string, stored: Stored, body: boolean) {
    const base = {
      key,
      size: stored.bytes.length,
      etag: stored.etag,
      httpMetadata: stored.httpMetadata,
      customMetadata: stored.customMetadata,
      checksums: { md5: buffer(md5(stored.bytes)), ...(stored.sha256 ? { sha256: buffer(stored.sha256) } : {}) },
    };
    if (!body) return base;
    const bytes = stored.bytes;
    return {
      ...base,
      get body() {
        return new Blob([bytes]).stream();
      },
      text: async () => new TextDecoder().decode(bytes),
      json: async () => JSON.parse(new TextDecoder().decode(bytes)),
    };
  }

  async head(key: string) {
    const stored = this.objects.get(key);
    return stored ? this.view(key, stored, false) : null;
  }

  async get(key: string, options?: { onlyIf?: { etagMatches?: string } }) {
    const stored = this.objects.get(key);
    if (!stored) return null;
    const match = options?.onlyIf?.etagMatches;
    return this.view(key, stored, match === undefined || match === stored.etag);
  }

  async put(key: string, value: unknown, options: { sha256?: string; httpMetadata?: R2HTTPMetadata; customMetadata?: Record<string, string> } = {}) {
    if (this.readOnly) throw new Error('fake R2: this bucket is read-only in this test');
    const bytes = await bytesOf(value);
    if (options.sha256 !== undefined && sha256(bytes) !== options.sha256) throw new Error('fake R2: the SHA-256 given does not match the body');
    const stored: Stored = { bytes, etag: md5(bytes), httpMetadata: options.httpMetadata, customMetadata: options.customMetadata, sha256: options.sha256 };
    this.objects.set(key, stored);
    this.puts += 1;
    return this.view(key, stored, false);
  }

  async delete(keys: string | string[]) {
    if (this.readOnly) throw new Error('fake R2: this bucket is read-only in this test');
    for (const key of Array.isArray(keys) ? keys : [keys]) this.objects.delete(key);
  }

  /** R2's list: keys in order, `limit` per page (small here, to exercise paging), prefixes under a delimiter. */
  async list(options: { prefix?: string; cursor?: string; limit?: number; delimiter?: string } = {}) {
    const prefix = options.prefix ?? '';
    const limit = Math.min(options.limit ?? 1000, this.pageSize);
    const entries: { key?: string; prefix?: string }[] = [];
    const seen = new Set<string>();
    for (const key of [...this.objects.keys()].filter((k) => k.startsWith(prefix)).sort()) {
      const at = options.delimiter ? key.indexOf(options.delimiter, prefix.length) : -1;
      if (at >= 0) {
        const group = key.slice(0, at + 1);
        if (!seen.has(group)) entries.push({ prefix: group });
        seen.add(group);
      } else entries.push({ key });
    }
    const start = Number(options.cursor ?? 0);
    const page = entries.slice(start, start + limit);
    const truncated = start + limit < entries.length;
    return {
      objects: page.filter((entry) => entry.key !== undefined).map((entry) => this.view(entry.key!, this.objects.get(entry.key!)!, false)),
      delimitedPrefixes: page.filter((entry) => entry.prefix !== undefined).map((entry) => entry.prefix!),
      truncated,
      ...(truncated ? { cursor: String(start + limit) } : {}),
    };
  }

  get bucket(): R2Bucket {
    return this as unknown as R2Bucket;
  }
}

interface FakeStatement {
  sql: string;
  args: SQLInputValue[];
  bind(...values: unknown[]): FakeStatement;
  all(): Promise<{ results: Record<string, unknown>[] }>;
  first(): Promise<Record<string, unknown> | null>;
  run(): Promise<{ success: true }>;
  raw(): Promise<unknown[][]>;
}

/** A D1 database over node:sqlite: prepare, bind, all, first, run, raw and batch, with foreign keys on, as in D1. */
export function fakeD1(db: DatabaseSync): D1Database {
  db.exec('PRAGMA foreign_keys = ON');
  const statement = (sql: string, args: SQLInputValue[] = []): FakeStatement => ({
    sql,
    args,
    bind: (...values: unknown[]) => statement(sql, values.map((value) => (value instanceof ArrayBuffer ? new Uint8Array(value) : value)) as SQLInputValue[]),
    all: async () => ({ results: db.prepare(sql).all(...args).map((row) => ({ ...(row as Record<string, unknown>) })) }),
    first: async () => {
      const row = db.prepare(sql).get(...args);
      return row ? { ...(row as Record<string, unknown>) } : null;
    },
    run: async () => {
      db.prepare(sql).run(...args);
      return { success: true as const };
    },
    raw: async () => db.prepare(sql).all(...args).map((row) => Object.values(row as object)),
  });
  return {
    prepare: (sql: string) => statement(sql),
    batch: async (statements: FakeStatement[]) => {
      db.exec('BEGIN');
      try {
        for (const s of statements) db.prepare(s.sql).run(...s.args);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      return statements.map(() => ({ success: true }));
    },
  } as unknown as D1Database;
}

/** The fictional room: members, documents (and their history rows, from the triggers), comments with a reply, audit rows, page text. */
export function fixtureDb(): DatabaseSync {
  const db = schemaDb();
  seed(db, { 'owner@example.test': 'owner', 'counsel@example.test': 'counsel' });
  db.prepare("INSERT INTO comments (id, document_id, author_email, body) VALUES ('c-doe-1', 'doc-live-a', 'counsel@example.test', 'DOE-000001: please confirm the board vote date')").run();
  db.prepare("INSERT INTO comments (id, document_id, author_email, body, parent_id) VALUES ('c-doe-2', 'doc-live-a', 'owner@example.test', 'Confirmed: an invented date', 'c-doe-1')").run();
  for (let i = 0; i < 7; i += 1) db.prepare("INSERT INTO audit_log (email, action, document_id) VALUES ('counsel@example.test', 'view', 'doc-live-b')").run();
  db.prepare("INSERT INTO page_fts (rowid, text, doc_id, page) VALUES (1048576, 'Harbor Labs board minutes, fictional', 'doc-live-a', 1)").run();
  db.prepare("INSERT INTO page_fts_docs (seq, doc_id, fingerprint, rows, indexed_at) VALUES (1, 'doc-live-a', 'f', 1, 'then')").run();
  return db;
}

/** Words that must never appear in a run's output: the fixture's keys, file text and member emails. Long enough that a
 * random hash or run id can't hold one by chance (a bare `0b5c` did, now and then). */
export const SECRETS = ['owner@example.test', 'counsel@example.test', 'Harbor Labs', 'DOE-000', 'doc-live', 'd2e-0000-4000-8000', 'visual-ai/0b5c9d2e', 'Alpha memo'];

/** A fake room for the backup tests: its environment and fake buckets. */
export interface Room {
  env: BackupEnv;
  files: FakeBucket;
  index: FakeBucket;
  law: FakeBucket;
  backup: FakeBucket;
  scratch: FakeBucket;
  db: DatabaseSync;
  scratchDb: DatabaseSync;
}

/** A fictional room with three buckets across several list pages, a backup bucket and empty scratch copies. */
export function room(pageSize = 3): Room {
  const files = new FakeBucket(pageSize);
  const index = new FakeBucket(pageSize);
  const law = new FakeBucket(pageSize);
  for (let i = 1; i <= 7; i += 1) files.seed(`0b5c${i}d2e-0000-4000-8000-00000000000${i}`, `DOE-00000${i} Harbor Labs exhibit ${i}, fictional`);
  files.seed('meta/visual-ai/0b5c9d2e.png', 'fictional image bytes', 'image/png', '9f8e7d6c5b4a39281706f5e4d3c2b1a0-2');
  for (let i = 1; i <= 4; i += 1) index.seed(`text/0b5c${i}d2e-0000-4000-8000-00000000000${i}.p1.md`, `[[doc:doc-live-a p:${i}]] Harbor Labs page ${i}`, 'text/markdown');
  law.seed('catalog.json', '{"units":[]}', 'application/json');
  const backup = new FakeBucket(pageSize);
  const scratch = new FakeBucket(pageSize);
  const db = fixtureDb();
  const scratchDb = new DatabaseSync(':memory:');
  const env: BackupEnv = {
    DB: fakeD1(db),
    FILES: files.bucket,
    INDEX: index.bucket,
    LAW: law.bucket,
    BACKUP: backup.bucket,
    SCRATCH: scratch.bucket,
    SCRATCH_DB: fakeD1(scratchDb),
  };
  return { env, files, index, law, backup, scratch, db, scratchDb };
}

/** Runs each step at once, recording its name, as a Workflow would on its first try. */
export function steps(): Step & { names: string[] } {
  const names: string[] = [];
  return {
    names,
    do: async <T>(name: string, fn: () => Promise<T>) => {
      names.push(name);
      return JSON.parse(JSON.stringify(await fn())) as T;
    },
  };
}

/** A body hasher that uses Node's SHA-256. */
export const nodeHash: HashBody = async (body) => createHash('sha256').update(new Uint8Array(await new Response(body).arrayBuffer())).digest('hex');

/** Tools with a clock that moves a second per call, so runs measure time. */
export function tools(start = Date.parse('2026-11-05T07:00:00Z')): Tools {
  let now = start;
  return { hash: nodeHash, now: () => (now += 1000) };
}
