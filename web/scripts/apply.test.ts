// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { applyPlan, type ApplyDeps } from './apply.ts';
import { diffSync, type DocumentRow } from './diff.ts';
import { directTextPages, EXTRACTOR_VERSION, ExtractorUnavailable } from './extract.ts';
import { guardWalk } from './guard.ts';
import { indexWork, loadManifest, saveManifest } from './indexjob.ts';
import { cloneWithCp, createSnapshot, MidSyncChange, verifyOriginals, type Cloner, type Snapshot } from './snapshot.ts';
import { SpendStop } from './spend-guard.ts';

// `cp -c` is macOS only; CI runs on Linux, where a plain copy stands in for the APFS clone.
const clone: Cloner = process.platform === 'darwin' ? cloneWithCp : (source, destination) => copyFile(source, destination);
import type { Target, Wrangler } from './wrangler.ts';

interface Fake extends Wrangler {
  calls: string[];
  sql: string[];
  /** The most R2 puts and deletes that were in flight at once. */
  peak: () => number;
}

function fakeWrangler(target: Target, opts: { jobs?: boolean; pending?: Record<string, unknown>[] } = {}): Fake {
  const calls: string[] = [];
  const sql: string[] = [];
  let inFlight = 0;
  let peak = 0;
  // Yields mid-call so overlapping calls are visible, as they are with the real wrangler.
  const r2 = async (call: string) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setImmediate(resolve));
    calls.push(call);
    inFlight -= 1;
  };
  return {
    target,
    calls,
    sql,
    peak: () => peak,
    async d1Query(sql) {
      calls.push('d1Query');
      // Reads of kept originals (worker/sync-rules.ts) find none; every other read is the pull's.
      return sql.includes('sync_retired') ? [] : (opts.pending ?? []);
    },
    async d1File(file) {
      calls.push('d1File');
      sql.push(await readFile(file, 'utf8'));
    },
    async r2Put(bucket, key) {
      await r2(`put ${bucket}/${key}`);
    },
    async r2Get(_bucket, _key, file) {
      await writeFile(file, 'upload');
    },
    async r2Delete(bucket, key) {
      await r2(`delete ${bucket}/${key}`);
    },
    async aiSearchJobsAvailable() {
      return opts.jobs ?? false;
    },
    async aiSearchJobCreate(name) {
      calls.push(`ai-search ${name}`);
    },
  };
}

async function fixture() {
  const parent = await mkdtemp(path.join(tmpdir(), 'legallas-apply-'));
  const root = path.join(parent, 'Shared');
  const cache = path.join(parent, 'cache');
  await mkdir(path.join(root, 'A'), { recursive: true });
  await writeFile(path.join(root, 'A', 'brief.pdf'), '%PDF-1.7 dummy');
  await writeFile(path.join(root, 'guide.md'), `# Guide\n\n${'word '.repeat(200)}`);
  await writeFile(path.join(root, 'photo.png'), 'png');
  const snap = async (runId: string) => createSnapshot((await guardWalk(root, async () => null)).files, cache, runId, clone);
  return { parent, root, cache, snap, done: () => rm(parent, { recursive: true, force: true }) };
}

function deps(w: Wrangler, snapshot: Snapshot, cache: string, parent: string, log: string[], extra: Partial<ApplyDeps> = {}): ApplyDeps {
  return {
    wrangler: w,
    extractPdf: async () => {
      throw new ExtractorUnavailable('extractor not built');
    },
    readText: directTextPages,
    verifyOriginals: () => verifyOriginals(snapshot),
    workDir: snapshot.dir,
    cacheDir: cache,
    inboxDir: path.join(parent, 'inbox'),
    now: '2026-09-30T12:00:00.000Z',
    log: (line) => log.push(line),
    quarantine: async () => {},
    ...extra,
  };
}

test('first sync: uploads, then D1, then index; PDFs and images wait for the extractor', async () => {
  const f = await fixture();
  try {
    const snapshot = await f.snap('r1');
    const plan = diffSync(snapshot.files, []);
    const w = fakeWrangler('remote');
    const log: string[] = [];
    const summary = await applyPlan(plan, deps(w, snapshot, f.cache, f.parent, log));
    const firstD1 = w.calls.indexOf('d1File');
    const filePuts = w.calls.filter((c) => c.startsWith('put legallas-files/'));
    const indexPuts = w.calls.filter((c) => c.startsWith('put legallas-index/'));
    assert.equal(filePuts.length, 3);
    assert.ok(w.calls.lastIndexOf(filePuts[2]) < firstD1, 'originals are uploaded before D1 changes');
    assert.ok(w.calls.indexOf(indexPuts[0]) > firstD1, 'index parts go up after D1');
    const guide = plan.adds.find((op) => op.path === 'guide.md');
    assert.deepEqual(indexPuts, [`put legallas-index/text/${guide?.id}.p1.md`]);
    assert.equal(summary.indexSkipped, 2, 'the PDF and the PNG both wait for the extractor');
    assert.ok(log.some((line) => line.includes('extractor not built')));
    assert.ok(log.some((line) => line.startsWith('MANUAL STEP')));
    assert.match(w.sql[0], /INSERT INTO documents/);
    const manifest = await loadManifest(f.cache, 'remote');
    assert.deepEqual(Object.keys(manifest), [guide?.id]);
    // The PDF and the image are retried next run, and the markdown is not re-indexed.
    const again = indexWork(diffSync(snapshot.files, plan.adds.map((op): DocumentRow => ({ id: op.id, path: op.path, sha256: op.sha256, size: op.size, kind: op.kind, pages: null, r2_key: op.r2Key, source: 'mirror' }))), manifest);
    assert.deepEqual(again.jobs.map((job) => job.kind).sort(), ['image', 'pdf']);
  } finally {
    await f.done();
  }
});

test('a newer extractor re-indexes extracted documents whose sha256 has not changed', async () => {
  const f = await fixture();
  try {
    const snapshot = await f.snap('r1v');
    const plan = diffSync(snapshot.files, []);
    const w = fakeWrangler('remote');
    const extractPdf: ApplyDeps['extractPdf'] = async () => [{ n: 1, text: 'extracted text', ocr: true }];
    await applyPlan(plan, deps(w, snapshot, f.cache, f.parent, [], { extractPdf }));
    const manifest = await loadManifest(f.cache, 'remote');
    const rows = plan.adds.map((op): DocumentRow => ({ id: op.id, path: op.path, sha256: op.sha256, size: op.size, kind: op.kind, pages: null, r2_key: op.r2Key, source: 'mirror' }));
    const extracted = plan.adds.filter((op) => op.kind === 'pdf' || op.kind === 'image').map((op) => op.id);
    for (const id of extracted) assert.equal(manifest[id]?.extractor, EXTRACTOR_VERSION, 'extracted text records its extractor version');
    const guide = plan.adds.find((op) => op.path === 'guide.md');
    assert.equal(manifest[guide?.id ?? '']?.extractor, undefined, 'directly read text records no extractor version');
    assert.deepEqual(indexWork(diffSync(snapshot.files, rows), manifest).jobs, [], 'nothing changed, nothing to re-index');
    // Text from an older extractor, or from before versions were recorded, is extracted and indexed again.
    const older = structuredClone(manifest);
    older[extracted[0]].extractor = EXTRACTOR_VERSION - 1;
    delete older[extracted[1]].extractor;
    const again = indexWork(diffSync(snapshot.files, rows), older);
    assert.deepEqual(again.jobs.map((job) => job.id).sort(), [...extracted].sort());
    assert.ok(again.jobs.every((job) => job.staleParts === manifest[job.id].parts), 'old parts are cleaned up by count');
  } finally {
    await f.done();
  }
});

test('a file edited mid-sync stops the run before D1 and removes this run\'s uploads', async () => {
  const f = await fixture();
  try {
    const snapshot = await f.snap('r2');
    const plan = diffSync(snapshot.files, []);
    const w = fakeWrangler('remote');
    const edit: ApplyDeps['readText'] = async (file, name) => {
      await appendFile(path.join(f.root, 'guide.md'), 'late edit');
      return directTextPages(file, name);
    };
    await assert.rejects(applyPlan(plan, deps(w, snapshot, f.cache, f.parent, [], { readText: edit })), MidSyncChange);
    assert.equal(w.calls.includes('d1File'), false);
    const deleted = w.calls.filter((c) => c.startsWith('delete legallas-files/')).map((c) => c.slice(7)).sort();
    assert.deepEqual(deleted, plan.adds.map((op) => `legallas-files/${op.r2Key}`).sort());
  } finally {
    await f.done();
  }
});

test('the spend budget holds the built parts\' ingestion before D1; a refusal removes this run\'s uploads', async () => {
  const f = await fixture();
  try {
    const snapshot = await f.snap('r2s');
    const plan = diffSync(snapshot.files, []);
    const w = fakeWrangler('remote');
    const held: number[] = [];
    const refuse = async (chars: number) => {
      held.push(chars);
      throw new SpendStop('search_ingest_tokens', 'Stopped by the spend budget: test');
    };
    await assert.rejects(applyPlan(plan, deps(w, snapshot, f.cache, f.parent, [], { holdIngestion: refuse })), SpendStop);
    assert.equal(held.length, 1);
    assert.ok(held[0]! >= 'word '.repeat(200).length, 'the guide\'s part, at least its text');
    assert.equal(w.calls.includes('d1File'), false);
    assert.equal(w.calls.some((c) => c.startsWith('put legallas-index/')), false, 'no index part went up');
    const deleted = w.calls.filter((c) => c.startsWith('delete legallas-files/')).length;
    assert.equal(deleted, plan.adds.length);
  } finally {
    await f.done();
  }
});

test('changes and removals delete superseded objects and stale index parts after D1', async () => {
  const f = await fixture();
  try {
    const snapshot = await f.snap('r3');
    const guide = snapshot.files.find((file) => file.rel === 'guide.md');
    const oldGuideId = '00000000-0000-4000-8000-00000000000a';
    const goneId = '00000000-0000-4000-8000-00000000000b';
    const rows: DocumentRow[] = [
      { id: oldGuideId, path: 'guide.md', sha256: 'old', size: 10, kind: 'markdown', pages: null, r2_key: '00000000-0000-4000-8000-0000000000aa', source: 'mirror' },
      { id: goneId, path: 'gone.md', sha256: 'g', size: 10, kind: 'markdown', pages: null, r2_key: '00000000-0000-4000-8000-0000000000bb', source: 'mirror' },
    ];
    await saveManifest(f.cache, 'remote', { [oldGuideId]: { sha256: 'old', parts: 3 }, [goneId]: { sha256: 'g', parts: 2 } });
    const plan = diffSync(snapshot.files, rows);
    assert.ok(guide);
    const w = fakeWrangler('remote', { jobs: true });
    await applyPlan(plan, deps(w, snapshot, f.cache, f.parent, []));
    const firstD1 = w.calls.indexOf('d1File');
    const deletes = w.calls.filter((c) => c.startsWith('delete '));
    assert.ok(deletes.every((c) => w.calls.indexOf(c) > firstD1), 'nothing is deleted before D1 is updated');
    assert.deepEqual(deletes.sort(), [
      'delete legallas-files/00000000-0000-4000-8000-0000000000aa',
      'delete legallas-files/00000000-0000-4000-8000-0000000000bb',
      `delete legallas-index/text/${oldGuideId}.p2.md`,
      `delete legallas-index/text/${oldGuideId}.p3.md`,
      `delete legallas-index/text/${goneId}.p1.md`,
      `delete legallas-index/text/${goneId}.p2.md`,
    ]);
    assert.ok(w.calls.includes('ai-search legallas'));
    assert.deepEqual(Object.keys(await loadManifest(f.cache, 'remote')), [oldGuideId]);
  } finally {
    await f.done();
  }
});

test('local runs never call AI Search and still pull counsel uploads', async () => {
  const f = await fixture();
  try {
    const snapshot = await f.snap('r4');
    const w = fakeWrangler('local', { jobs: true, pending: [{ id: 'c1', name: 'reply.pdf', r2_key: 'k1' }] });
    const log: string[] = [];
    const summary = await applyPlan(diffSync(snapshot.files, []), deps(w, snapshot, f.cache, f.parent, log));
    assert.equal(w.calls.some((c) => c.startsWith('ai-search')), false);
    assert.ok(log.some((line) => line.includes('no local mode')));
    assert.equal(summary.pulled, 1);
    assert.match(w.sql[1], /pulled_at/);
  } finally {
    await f.done();
  }
});

test('local runs make one R2 call at a time; remote runs overlap them', async () => {
  const f = await fixture();
  try {
    const remote = fakeWrangler('remote');
    const remoteSnapshot = await f.snap('r5');
    await applyPlan(diffSync(remoteSnapshot.files, []), deps(remote, remoteSnapshot, f.cache, f.parent, []));
    assert.ok(remote.peak() > 1, 'the fake can observe overlapping calls');

    // A mid-sync edit makes the local run upload every original, then delete them all again.
    const local = fakeWrangler('local');
    const localSnapshot = await f.snap('r6');
    const plan = diffSync(localSnapshot.files, []);
    const edit: ApplyDeps['readText'] = async (file, name) => {
      await appendFile(path.join(f.root, 'guide.md'), 'late edit');
      return directTextPages(file, name);
    };
    await assert.rejects(applyPlan(plan, deps(local, localSnapshot, f.cache, f.parent, [], { readText: edit })), MidSyncChange);
    assert.equal(local.calls.filter((c) => c.startsWith('put legallas-files/')).length, plan.adds.length);
    assert.equal(local.calls.filter((c) => c.startsWith('delete legallas-files/')).length, plan.adds.length);
    assert.equal(local.peak(), 1);

    // A clean local run also uploads index parts one at a time.
    const clean = fakeWrangler('local');
    const cleanSnapshot = await f.snap('r7');
    await applyPlan(diffSync(cleanSnapshot.files, []), deps(clean, cleanSnapshot, f.cache, f.parent, []));
    assert.ok(clean.calls.some((c) => c.startsWith('put legallas-index/')));
    assert.equal(clean.peak(), 1);
  } finally {
    await f.done();
  }
});

test('a failed AI Search job is a manual step, not a failed run: pulls still happen', async () => {
  const f = await fixture();
  try {
    const snapshot = await f.snap('r6');
    const w = fakeWrangler('remote', { jobs: true, pending: [{ id: 'c1', name: 'reply.pdf', r2_key: 'k1' }] });
    w.aiSearchJobCreate = async () => {
      throw new Error('instance not found');
    };
    const log: string[] = [];
    const summary = await applyPlan(diffSync(snapshot.files, []), deps(w, snapshot, f.cache, f.parent, log));
    assert.ok(log.some((line) => line.startsWith('MANUAL STEP: could not start')));
    assert.equal(summary.pulled, 1);
  } finally {
    await f.done();
  }
});
