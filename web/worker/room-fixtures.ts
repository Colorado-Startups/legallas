// SPDX-License-Identifier: Apache-2.0
// Test fixtures for the room (imported only by *.test.ts). A real SQLite database (node:sqlite) built from every
// file in migrations/ behind a D1-shaped adapter, so live-document and cap queries run as real SQL, seeded with three
// fictional documents; the wire formats of the AI bindings: AI Search chunks keyed text/<id>.p1.md and a Workers AI
// answer streamed as OpenAI-style SSE; and a rate-limit binding that counts. Ask's harness (ask-fixtures.ts) builds on
// these.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { tickEveryMember } from './notice-fixtures.ts';

export const OWNER = 'founder@example.test';

export function d1(db: DatabaseSync): D1Database {
  const plain = (row: unknown) => (row ? { ...(row as object) } : null);
  return {
    prepare(sql: string) {
      let args: SQLInputValue[] = [];
      const bound = {
        bind(...values: SQLInputValue[]) {
          args = values;
          return bound;
        },
        async first() {
          return plain(db.prepare(sql).get(...args));
        },
        async all() {
          return { results: db.prepare(sql).all(...args).map(plain) };
        },
        async run() {
          db.prepare(sql).run(...args);
          return { success: true };
        },
      };
      return bound;
    },
  } as unknown as D1Database;
}

export function schemaDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  const dir = join(import.meta.dirname, '..', 'migrations');
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) db.exec(readFileSync(join(dir, file), 'utf8'));
  tickEveryMember(db);
  return db;
}

interface DocSeed {
  id: string;
  name: string;
  pages?: number | null;
  removed?: boolean;
}

export const DOCS: DocSeed[] = [
  { id: 'doc-live-a', name: 'Alpha memo.pdf', pages: 5 },
  { id: 'doc-live-b', name: 'Bravo notes.md', pages: null },
  { id: 'doc-gone', name: 'Removed letter.pdf', pages: 3, removed: true },
];

export function seed(db: DatabaseSync, members: Record<string, string> = { [OWNER]: 'owner' }): void {
  for (const [email, role] of Object.entries(members)) {
    // The schema's CHECK allows owner and counsel only; other roles are added with the check disabled.
    db.exec('PRAGMA ignore_check_constraints = ON');
    db.prepare('INSERT INTO members (email, role) VALUES (?1, ?2)').run(email, role);
    db.exec('PRAGMA ignore_check_constraints = OFF');
  }
  for (const doc of DOCS) {
    db.prepare(
      "INSERT INTO documents (id, path, folder, name, kind, content_type, size, pages, r2_key, source, updated_at, removed_at) VALUES (?1, ?2, '', ?3, 'pdf', 'application/pdf', 1, ?4, ?5, 'mirror', 'now', ?6)",
    ).run(doc.id, doc.name, doc.name, doc.pages ?? null, `k-${doc.id}`, doc.removed ? 'then' : null);
  }
}

export type FakeChunk = { key: string; text: string };

export function chunk(docId: string, page: number, text: string): FakeChunk {
  return { key: `text/${docId}.p1.md`, text: `[[doc:${docId} p:${page}]]\n${text}` };
}

/**
 * OpenAI-style SSE from the model, split into awkward pieces to exercise line buffering. `stop`, when given, ends
 * the stream as Workers AI does (probed 2026-10-04): a frame with `finish_reason` and an empty delta, then the
 * classic frame with an empty `response` and the usage, then [DONE].
 */
export function modelSse(answer: string, pieceSize = 7, stop?: string): ReadableStream<Uint8Array> {
  const ending =
    stop === undefined
      ? ''
      : `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: null }, finish_reason: stop, index: 0 }] })}\n\n` +
        `data: ${JSON.stringify({ response: '', usage: { prompt_tokens: 41, completion_tokens: 300, total_tokens: 341 } })}\n\n`;
  const frames =
    `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: 'hidden reasoning' } }] })}\n\n` +
    [...answer.matchAll(/[\s\S]{1,5}/g)].map((m) => `data: ${JSON.stringify({ choices: [{ delta: { content: m[0] }, finish_reason: null }] })}\n\n`).join('') +
    ending +
    'data: [DONE]\n\n';
  const bytes = new TextEncoder().encode(frames);
  let at = 0;
  return new ReadableStream({
    pull(controller) {
      if (at >= bytes.length) return controller.close();
      controller.enqueue(bytes.slice(at, at + pieceSize));
      at += pieceSize;
    },
  });
}

/** A limiter that allows `allow` calls in all, recording each key. */
export function fakeLimiter(allow = Infinity) {
  const keys: string[] = [];
  const binding = {
    async limit({ key }: { key: string }) {
      keys.push(key);
      return { success: keys.length <= allow };
    },
  } as RateLimit;
  return { keys, binding };
}
