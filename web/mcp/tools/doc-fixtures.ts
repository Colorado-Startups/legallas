// SPDX-License-Identifier: Apache-2.0
// Test support only (never imported by the Worker): a catalog in testDb, a fake legallas-index bucket and a
// ToolContext, shared by the document and page tool tests. Fixtures use made-up Roe names; the room's own fixture is Doe v. Harbor Labs.
import { testDb } from '../../worker/sqlite-d1.ts';
import type { Role } from '../../worker/env.ts';
import type { McpEnv, ToolContext } from '../contract.ts';
import { buildParts, type PageText } from '../../scripts/indexparts.ts';

/** A fixture document for the tool tests: its id and path. */
export interface DocSeed {
  id: string;
  path: string;
  name?: string;
  kind?: string;
  pages?: number | null;
  source?: 'mirror' | 'counsel';
  controlSeq?: number | null;
  keyAt?: string | null;
  removedAt?: string | null;
}

/** A catalog with the given rows. Storage columns get recognisable values so a leak shows in a test. */
export function catalogDb(seeds: readonly DocSeed[]) {
  const { db, sqlite } = testDb();
  const insert = sqlite.prepare(
    'INSERT INTO documents (id, path, folder, name, kind, content_type, size, sha256, etag, pages, r2_key, source, updated_at, control_seq, key_at, removed_at) ' +
      "VALUES (?, ?, ?, ?, ?, 'application/pdf', 10, 'SHA-LEAK', 'ETAG-LEAK', ?, ?, ?, '2026-09-30T12:00:00Z', ?, ?, ?)",
  );
  for (const seed of seeds) {
    const slash = seed.path.lastIndexOf('/');
    insert.run(
      seed.id,
      seed.path,
      slash === -1 ? '' : seed.path.slice(0, slash),
      seed.name ?? seed.path.slice(slash + 1),
      seed.kind ?? 'pdf',
      seed.pages === undefined ? 3 : seed.pages,
      `R2-LEAK-${seed.id}`,
      seed.source ?? 'mirror',
      seed.controlSeq ?? null,
      seed.keyAt ?? null,
      seed.removedAt ?? null,
    );
  }
  return { db, sqlite };
}

/** A fake R2 bucket with list (paged, `pageSize` keys per call, cursor as an offset) and get. */
export function fakeIndex(objects: ReadonlyMap<string, string>, pageSize = 1000) {
  const calls = { list: 0, get: [] as string[] };
  const bucket = {
    async list(options?: R2ListOptions) {
      calls.list += 1;
      const keys = [...objects.keys()].filter((key) => key.startsWith(options?.prefix ?? '')).sort();
      const start = options?.cursor ? Number(options.cursor) : 0;
      const truncated = start + pageSize < keys.length;
      const page = keys.slice(start, start + pageSize).map((key) => ({ key }));
      return { objects: page, delimitedPrefixes: [], truncated, cursor: truncated ? String(start + pageSize) : undefined };
    },
    async get(key: string) {
      calls.get.push(key);
      const body = objects.get(key);
      return body === undefined ? null : { text: async () => body };
    },
  };
  return { calls, bucket: bucket as unknown as R2Bucket };
}

/** Index parts for one document, written exactly as the sync writes them. */
export function partsFor(id: string, pages: readonly PageText[], maxBytes?: number): Map<string, string> {
  return new Map(buildParts(id, pages, maxBytes).map((part) => [part.key, part.body]));
}

/** `count` distinct words, so reassembled text can be compared exactly. */
export function words(tag: string, count: number): string {
  return Array.from({ length: count }, (_, i) => `${tag}w${i}`).join(' ');
}

/** A ToolContext over the given database and bucket, recording audits. */
export function toolCtx(db: D1Database, index?: R2Bucket, role: Role = 'counsel') {
  const audits: { action: string; documentId: string | null }[] = [];
  const env = { DB: db, INDEX: index, CONTROL_PREFIX: 'DOE', TEAM_DOMAIN: '', ACCESS_AUD: '' } as unknown as McpEnv;
  const ctx: ToolContext = {
    env,
    props: { email: 'counsel@example.test', role: 'owner', clientId: 'c1', clientName: 'Claude' },
    member: { email: 'counsel@example.test', role, name: 'Counsel' },
    now: new Date('2026-10-01T12:00:00Z'),
    clientKind: 'claude',
    profile: 'standard',
    audit: async (action, documentId) => {
      audits.push({ action, documentId });
    },
  };
  return { ctx, audits };
}

/** The structured content of a successful result. */
export function body(result: { structuredContent?: unknown; isError?: boolean }): Record<string, any> {
  if (result.isError) throw new Error('expected a successful result');
  return result.structuredContent as Record<string, any>;
}
