// SPDX-License-Identifier: Apache-2.0
// scripts/fts-index.ts end to end on real SQLite (every migration applied): a fake legallas-index built by the real
// indexparts.ts, a fake wrangler whose d1File runs each SQL file as one transaction, and MATCH queries over what the
// runs wrote (worker/fts.test.ts searches the same rows through ftsSearch). Fictional DOE text only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  estimateRowsWritten,
  ftsPlan,
  localSource,
  MAX_ROWS_WRITTEN,
  parseFtsArgs,
  partRef,
  planFingerprint,
  remoteSource,
  runFtsIndex,
  type FtsIndexOptions,
  type PartRef,
  type PartSource,
} from './fts-index.ts';
import { dropStatements } from './fts-rows.ts';
import { buildParts, type PageText } from './indexparts.ts';
import { errorTail } from './wrangler.ts';

const LOCAL: FtsIndexOptions = { apply: true, target: 'local', expect: null, maxDocs: Number.POSITIVE_INFINITY };

/** legallas-index in memory: parts by key, with md5 etags as R2 gives a single upload, and a count of reads. */
class FakeIndex implements PartSource {
  parts = new Map<string, string>();
  reads: string[] = [];
  put(docId: string, pages: PageText[]): void {
    for (const key of [...this.parts.keys()]) if (key.startsWith(`text/${docId}.`)) this.parts.delete(key);
    for (const part of buildParts(docId, pages, 1_500)) this.parts.set(part.key, part.body);
  }
  async list(): Promise<PartRef[]> {
    return [...this.parts].map(([key, body]) => partRef(key, createHash('md5').update(body).digest('hex'), body.length)!);
  }
  async read(ref: PartRef): Promise<string> {
    this.reads.push(ref.docId);
    return this.parts.get(ref.key)!;
  }
}

/** The room's schema, every migration applied (as dev-seed.test.ts builds it). */
function schemaDb(): { sqlite: DatabaseSync } {
  const sqlite = new DatabaseSync(':memory:');
  const dir = path.join(import.meta.dirname, '..', 'migrations');
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) sqlite.exec(readFileSync(path.join(dir, file), 'utf8'));
  return { sqlite };
}

interface Harness {
  t: { sqlite: DatabaseSync };
  index: FakeIndex;
  workDir: string;
  files: number;
  failAt: number | null;
  logs: string[];
  run(options?: Partial<FtsIndexOptions>): ReturnType<typeof runFtsIndex>;
}

async function harness(): Promise<Harness> {
  const t = schemaDb();
  for (const id of ['doc-gutter', 'doc-notice', 'doc-log']) {
    t.sqlite
      .prepare("INSERT INTO documents (id, path, folder, name, kind, content_type, size, r2_key, source, updated_at) VALUES (?1, ?2, '', ?2, 'pdf', 'application/pdf', 1, ?3, 'mirror', 'now')")
      .run(id, `${id}.pdf`, `k-${id}`);
  }
  const workDir = await mkdtemp(path.join(tmpdir(), 'fts-index-test-'));
  const h: Harness = {
    t,
    index: new FakeIndex(),
    workDir,
    files: 0,
    failAt: null,
    logs: [],
    run: (options = {}) => {
      const w = {
        target: options.target ?? 'local',
        d1Query: async (sql: string) => t.sqlite.prepare(sql).all() as Record<string, unknown>[],
        d1File: async (file: string) => {
          h.files += 1;
          if (h.files === h.failAt) throw new Error('wrangler d1 execute failed');
          const sql = await readFile(file, 'utf8');
          t.sqlite.exec(`BEGIN;\n${sql}\nCOMMIT;`);
        },
      };
      return runFtsIndex({ ...LOCAL, ...options }, { w, source: h.index, workDir, now: '2026-10-20T00:00:00Z', log: (line) => h.logs.push(line) });
    },
  };
  h.index.put('doc-gutter', [{ n: 1, text: 'Cover page.' }, { n: 2, text: 'Jane Doe booked the payroll setup with Tally Payroll.' }]);
  h.index.put('doc-notice', [{ n: 1, text: 'Harbor Labs sent a notice of entry to Jane Doe.' }]);
  h.index.put('doc-log', [{ n: 1, text: 'The walk-in cooler read 52 degrees.' }]);
  return h;
}

/** Pages matching an FTS5 expression (the test's own, so raw MATCH is fine here). */
const found = async (h: Harness, expression: string) =>
  h.t.sqlite.prepare('SELECT doc_id, page FROM page_fts WHERE page_fts MATCH ?').all(expression).map((r) => `${r.doc_id} p${r.page}`).sort();
const rowids = (h: Harness, docId: string) => h.t.sqlite.prepare('SELECT rowid FROM page_fts WHERE doc_id = ?').all(docId).map((r) => Number(r.rowid));

test('a first run indexes every document page by page, and its search finds them', async () => {
  const h = await harness();
  assert.deepEqual(await h.run(), { indexed: 3, dropped: 0, rows: 4 });
  assert.deepEqual(await found(h, 'Jane Doe'), ['doc-gutter p2', 'doc-notice p1']);
  assert.deepEqual(await found(h, 'cooler'), ['doc-log p1']);
  const docs = h.t.sqlite.prepare('SELECT doc_id, seq, rows, length(fingerprint) AS f FROM page_fts_docs ORDER BY doc_id').all();
  assert.deepEqual(docs.map((d) => [d.doc_id, d.rows, d.f]), [['doc-gutter', 2, 32], ['doc-log', 1, 32], ['doc-notice', 1, 32]]);
  for (const doc of docs) for (const rowid of rowids(h, String(doc.doc_id))) assert.equal(Math.floor(rowid / 1_048_576), doc.seq, 'rows sit in the block');
  assert.deepEqual(await readdir(h.workDir), [], 'no SQL file with page text is left behind');
  const plan = h.t.sqlite.prepare(`EXPLAIN QUERY PLAN ${dropStatements('doc-gutter')[0]!.replace(/;$/, '')}`).all() as { detail: string }[];
  assert.match(plan[0]!.detail, /^SCAN page_fts VIRTUAL TABLE INDEX 0:></, 'a document is cleared by rowid range, not by reading every row');
});

test('a second run with nothing changed reads no part and writes nothing (idempotent)', async () => {
  const h = await harness();
  await h.run();
  const [reads, files] = [h.index.reads.length, h.files];
  assert.deepEqual(await h.run(), { indexed: 0, dropped: 0, rows: 0 });
  assert.equal(h.index.reads.length, reads);
  assert.equal(h.files, files);
  assert.ok(h.logs.includes('\nNothing to do.'));
  assert.deepEqual(await found(h, 'Jane Doe'), ['doc-gutter p2', 'doc-notice p1'], 'no duplicate rows');
});

test('only a changed document is rewritten; a shrunk one loses its old pages; a gone one is dropped', async () => {
  const h = await harness();
  await h.run();
  const [notice, log] = [rowids(h, 'doc-notice'), rowids(h, 'doc-log')];
  h.index.put('doc-gutter', [{ n: 1, text: 'The gutter plan was amended in writing.' }]);
  h.index.put('doc-notice', []);
  h.index.reads = [];
  assert.deepEqual(await h.run(), { indexed: 1, dropped: 1, rows: 1 });
  assert.deepEqual([...new Set(h.index.reads)], ['doc-gutter'], 'only the changed document was read');
  assert.deepEqual(await found(h, 'amended'), ['doc-gutter p1']);
  assert.deepEqual(await found(h, 'payroll'), [], 'the old page 2 is gone');
  assert.deepEqual(rowids(h, 'doc-notice'), [], 'dropped rows');
  assert.equal(h.t.sqlite.prepare("SELECT COUNT(*) AS n FROM page_fts_docs WHERE doc_id = 'doc-notice'").get()!.n, 0);
  assert.deepEqual(rowids(h, 'doc-log'), log, 'an unchanged document is not touched');
  assert.notDeepEqual(notice, []);
});

test('a run that stops halfway leaves its documents pending, and the next run finishes them without duplicates', async () => {
  const h = await harness();
  h.index.put('doc-log', Array.from({ length: 700 }, (_, i) => ({ n: i + 1, text: `Temp reading ${i}.` })));
  h.failAt = 2;
  await assert.rejects(h.run(), /wrangler d1 execute failed/);
  const pending = h.t.sqlite.prepare("SELECT doc_id FROM page_fts_docs WHERE fingerprint = ''").all().map((r) => r.doc_id);
  assert.ok(pending.length > 0, 'pending documents are marked');
  h.failAt = null;
  await h.run();
  assert.equal(h.t.sqlite.prepare("SELECT COUNT(*) AS n FROM page_fts_docs WHERE fingerprint = ''").get()!.n, 0);
  assert.equal(rowids(h, 'doc-log').length, 700);
  assert.deepEqual(await found(h, '"Temp reading 699"'), ['doc-log p700']);
});

test('the plan: sorted, fingerprinted, --max-docs defers, and the estimate bounds a run', async () => {
  const h = await harness();
  const refs = await h.index.list();
  const plan = ftsPlan(refs, new Map());
  assert.deepEqual(plan.index.map((job) => job.docId), ['doc-gutter', 'doc-log', 'doc-notice']);
  assert.equal(planFingerprint(plan), planFingerprint(ftsPlan([...refs].reverse(), new Map())), 'order of the listing does not matter');
  const two = ftsPlan(refs, new Map(), 2);
  assert.deepEqual([two.index.length, two.deferred], [2, 1]);
  assert.notEqual(planFingerprint(two), planFingerprint(plan));
  const huge = ftsPlan([partRef('text/doc-big.p1.md', 'e', 400_000_000)!], new Map());
  assert.ok(estimateRowsWritten(huge, new Map()) > MAX_ROWS_WRITTEN);
  await h.run({ maxDocs: 2 });
  assert.equal(h.t.sqlite.prepare('SELECT COUNT(*) AS n FROM page_fts_docs').get()!.n, 2);
  assert.ok(h.logs.some((line) => /later +1 changed documents/.test(line)));
});

test('apply refuses a changed plan or an oversized one, before writing anything', async () => {
  const h = await harness();
  await assert.rejects(h.run({ target: 'remote', expect: '000000000000' }), /plan changed since the approved dry run/);
  assert.equal(h.files, 0);
  await h.run({ apply: false });
  const fingerprint = /Plan fingerprint: ([0-9a-f]{12})/.exec(h.logs.join('\n'))![1]!;
  assert.ok(h.logs.includes('\nDry run only. Nothing was changed.'));
  assert.equal(h.files, 0, 'a dry run writes nothing');
  assert.deepEqual(await h.run({ target: 'remote', expect: fingerprint }), { indexed: 3, dropped: 0, rows: 4 });
  const big = await harness();
  big.index.list = async () => [partRef('text/doc-big.p1.md', 'e', 400_000_000)!];
  await assert.rejects(big.run(), /more D1 rows than one run may/);
  assert.deepEqual([big.files, big.index.reads.length], [0, 0], 'refused before reading or writing');
});

test('parseFtsArgs: a remote apply needs --expect; local does not', () => {
  assert.deepEqual(parseFtsArgs([]), { apply: false, target: 'remote', expect: null, maxDocs: Number.POSITIVE_INFINITY });
  assert.throws(() => parseFtsArgs(['--apply']), /needs --expect/);
  assert.equal(parseFtsArgs(['--apply', '--expect', 'abcdef012345']).expect, 'abcdef012345');
  assert.equal(parseFtsArgs(['--local', '--apply']).target, 'local');
  assert.equal(parseFtsArgs(['--max-docs', '25']).maxDocs, 25);
  for (const bad of [['--expect', 'abc'], ['--expect', 'abcdef012345'], ['--max-docs', '0'], ['--remote'], ['--yes']]) assert.throws(() => parseFtsArgs(bad), /usage|only makes sense/);
});

test('remoteSource: a paginated listing of text/ parts with etags, and raw reads by key', async () => {
  const resources: string[] = [];
  const pages: Record<string, unknown>[] = [
    { result: [{ key: 'text/doc-a.p1.md', etag: 'e1', size: 10 }, { key: 'meta/visual-ai/x.txt', etag: 'e9', size: 1 }], result_info: { is_truncated: true, cursor: 'c/1' } },
    { result: [{ key: 'text/doc-a.p2.md', etag: 'e2', size: 20 }, { key: 'text/doc-b.p1.md', size: 5 }], result_info: { is_truncated: false } },
  ];
  const source = remoteSource(
    async (resource) => (resources.push(resource), pages[resources.length - 1]!),
    async (resource) => `body of ${resource}`,
  );
  assert.deepEqual((await source.list()).map((ref) => `${ref.key}:${ref.etag}`), ['text/doc-a.p1.md:e1', 'text/doc-a.p2.md:e2']);
  assert.deepEqual(resources, ['r2/buckets/legallas-index/objects?prefix=text%2F&per_page=1000', 'r2/buckets/legallas-index/objects?prefix=text%2F&per_page=1000&cursor=c%2F1']);
  assert.equal(await source.read(partRef('text/doc-a.p2.md', 'e2', 20)!), 'body of r2/buckets/legallas-index/objects/text/doc-a.p2.md');
});

/** A failed `wrangler r2 object get` as scripts/wrangler.ts reports it, from wrangler's own stderr. */
const wranglerFailure = (stderr: string) => new Error(`wrangler r2 object get failed:\n${errorTail(stderr, '')}`);

test('parseFtsArgs: --manifest is for the local room only', () => {
  assert.equal(parseFtsArgs(['--local', '--manifest', '/m.json']).manifest, '/m.json');
  assert.throws(() => parseFtsArgs(['--manifest', '/m.json']), /--manifest is for --local/);
  assert.throws(() => parseFtsArgs(['--local', '--manifest']), /usage/);
});

test('localSource: a known part count reads only those parts, and a document it does not know is read until one is missing', async () => {
  const stored = new Map([['text/doc-a.p1.md', 'a1'], ['text/doc-a.p2.md', 'a2'], ['text/doc-b.p1.md', 'b1']]);
  const reads: string[] = [];
  const w = {
    d1Query: async () => [{ id: 'doc-a' }, { id: 'doc-b' }, { id: 'doc-none' }],
    r2Get: async (_bucket: string, key: string, file: string) => {
      reads.push(key);
      const body = stored.get(key);
      if (body === undefined) throw new Error('The specified key does not exist.');
      await writeFile(file, body);
    },
  };
  const dir = await mkdtemp(path.join(tmpdir(), 'fts-known-'));
  try {
    const refs = await localSource(w as never, dir, { 'doc-a': { parts: 2 }, 'doc-none': { parts: 0 } }).list();
    assert.deepEqual(refs.map((ref) => ref.key), ['text/doc-a.p1.md', 'text/doc-a.p2.md', 'text/doc-b.p1.md']);
    assert.deepEqual(reads, ['text/doc-a.p1.md', 'text/doc-a.p2.md', 'text/doc-b.p1.md', 'text/doc-b.p2.md']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('localSource: reads p1, p2, ... of every live or indexed document until one is missing', async () => {
  const workDir = await mkdtemp(path.join(tmpdir(), 'fts-local-test-'));
  const stored = new Map([['text/doc-a.p1.md', 'A1'], ['text/doc-a.p2.md', 'A2'], ['text/doc-c.p1.md', 'C1']]);
  const gets: string[] = [];
  const w = {
    d1Query: async () => [{ id: 'doc-a' }, { id: 'doc-b' }, { id: 'doc-c' }, { id: 'not an id' }],
    r2Get: async (bucket: string, key: string, file: string) => {
      gets.push(`${bucket}/${key}`);
      if (!stored.has(key)) throw wranglerFailure('\u2718 [ERROR] The specified key does not exist.\n\nIf you think this is a bug then please create an issue\n');
      await writeFile(file, stored.get(key)!);
    },
  };
  const source = localSource(w, workDir);
  const refs = await source.list();
  assert.deepEqual(refs.map((ref) => ref.key), ['text/doc-a.p1.md', 'text/doc-a.p2.md', 'text/doc-c.p1.md']);
  assert.equal(refs[0]!.etag, createHash('md5').update('A1').digest('hex'));
  assert.equal(gets.length, 6, 'one miss ends each document');
  assert.equal(await source.read(refs[1]!), 'A2', 'read from what the listing fetched');
  assert.deepEqual(await readdir(workDir), [], 'no part left on disk');
});

test('localSource: any failure but a missing part stops the run, so a broken local R2 never drops the index', async () => {
  const workDir = await mkdtemp(path.join(tmpdir(), 'fts-local-fail-'));
  for (const failure of [
    wranglerFailure('sh: wrangler: command not found\n'),
    wranglerFailure('\u2718 [ERROR] Could not resolve the local R2 bucket\n'),
    new Error('spawn npx ENOENT'),
  ]) {
    const w = { d1Query: async () => [{ id: 'doc-a' }], r2Get: async () => Promise.reject(failure) };
    await assert.rejects(localSource(w, workDir).list(), (error) => error === failure, failure.message);
  }
  const h = await harness();
  await h.run();
  h.index.list = () => localSource({ d1Query: async () => [{ id: 'doc-gutter' }], r2Get: async () => Promise.reject(wranglerFailure('fetch failed\n')) }, workDir).list();
  await assert.rejects(h.run(), /fetch failed/);
  assert.equal(h.t.sqlite.prepare('SELECT COUNT(*) AS n FROM page_fts_docs').get()!.n, 3, 'nothing was dropped');
});

test('partRef: only index part keys with an etag', () => {
  assert.deepEqual(partRef('text/doc-a.p2.md', 'e1', 10), { docId: 'doc-a', part: 2, key: 'text/doc-a.p2.md', etag: 'e1', size: 10 });
  for (const key of ['text/doc-a.p0.md', 'meta/visual-ai/x.txt', 'text/../x.p1.md', 'text/doc a.p1.md', 'doc-a.p1.md', 42]) assert.equal(partRef(key, 'e', 1), null, String(key));
  assert.equal(partRef('text/doc-a.p1.md', '', 1), null);
});
