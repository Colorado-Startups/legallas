// SPDX-License-Identifier: Apache-2.0
// A DOE visual through a whole sync: snapshot, plan, apply. Its text is indexed under its own document id from the
// rendered text in the cache (never its markup), its side files go to meta/visual-ai/ through the side-file store,
// and they never become documents rows, take a control number or pass through the documents' R2 path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { visualAiKey } from '../worker/visuals.ts';
import { applyPlan } from './apply.ts';
import { diffSync } from './diff.ts';
import { directTextPages, ExtractorUnavailable, VISUAL_RENDER_VERSION } from './extract.ts';
import { guardWalk } from './guard.ts';
import { indexWork, loadManifest } from './indexjob.ts';
import { cloneWithCp, createSnapshot, verifyOriginals, type Cloner } from './snapshot.ts';
import { liveVisualShas, loadSideManifest, planSideFiles, visualTextSource, writeVisualEntry, type SideFileStore } from './visual-ai.ts';
import type { Wrangler } from './wrangler.ts';

// `cp -c` is macOS only; CI runs on Linux, where a plain copy stands in for the APFS clone.
const clone: Cloner = process.platform === 'darwin' ? cloneWithCp : (source, destination) => copyFile(source, destination);
const sha = (text: string | Uint8Array) => createHash('sha256').update(text).digest('hex');

const HTML = '<html><body><script>var drawn = ["Harbor Labs"];</script><h1>Doe weekly deliveries</h1><svg id="chart"></svg></body></html>';
const RENDERED = '# Doe weekly deliveries\n\nFigure: Meals delivered by week\nWeek 1; Week 2; Harbor Labs 212 meals';
/** A tiny PNG header (signature and IHDR, 10 by 10 pixels): enough for the side-file checks. */
const PNG = (() => {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 10, 0, 0, 0, 10]);
  return bytes;
})();

function fakeWrangler() {
  const calls: string[] = [];
  const sql: string[] = [];
  const parts = new Map<string, string>();
  const w: Wrangler = {
    target: 'local',
    async d1Query() {
      return [];
    },
    async d1File(file) {
      sql.push(await readFile(file, 'utf8'));
    },
    async r2Put(bucket, key, file) {
      calls.push(`put ${bucket}/${key}`);
      if (bucket === 'legallas-index') parts.set(key, await readFile(file, 'utf8'));
    },
    async r2Get() {},
    async r2Delete(bucket, key) {
      calls.push(`delete ${bucket}/${key}`);
    },
    async aiSearchJobsAvailable() {
      return false;
    },
    async aiSearchJobCreate() {},
  };
  return { w, calls, sql, parts };
}

/** Syncs a room folder holding one DOE visual, its binder manifest and a note, with the visual's text rendered. */
async function syncDoeVisual(parent: string) {
  const root = path.join(parent, 'Shared');
  const cache = path.join(parent, 'cache');
  await mkdir(path.join(root, 'Visuals'), { recursive: true });
  await writeFile(path.join(root, 'Visuals', 'doe-map.html'), HTML);
  await writeFile(path.join(root, 'Visuals', 'legallas-visuals.json'), '{"version":1,"sections":[],"visuals":[]}');
  await writeFile(path.join(root, 'notes.md'), '# Doe notes');
  await writeVisualEntry(cache, sha(HTML), RENDERED, PNG);

  const snapshot = await createSnapshot((await guardWalk(root, async () => null)).files, cache, 'r1', clone);
  const plan = diffSync(snapshot.files, []);
  const side = await planSideFiles(liveVisualShas(plan), cache, await loadSideManifest(cache, 'local'));
  const stored: string[] = [];
  const store: SideFileStore = {
    async put(key, file) {
      stored.push(`${key} ${key.endsWith('.txt') ? await readFile(file, 'utf8') : 'png'}`);
    },
    async delete(key) {
      stored.push(`delete ${key}`);
    },
  };
  const fake = fakeWrangler();
  const summary = await applyPlan(plan, {
    wrangler: fake.w,
    extractPdf: async () => {
      throw new ExtractorUnavailable('extractor not built');
    },
    readText: (file, name) => directTextPages(file, name, visualTextSource(cache)),
    verifyOriginals: () => verifyOriginals(snapshot),
    workDir: snapshot.dir,
    cacheDir: cache,
    inboxDir: path.join(parent, 'inbox'),
    now: '2026-10-20T12:00:00.000Z',
    log: () => {},
    quarantine: async () => {},
    sideFiles: { plan: side, store },
  });
  return { cache, snapshot, plan, stored, fake, summary };
}

test('a synced visual is indexed from its rendered text under its own id, and its side files are not documents', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'legallas-visual-sync-'));
  try {
    const { cache, snapshot, plan, stored, fake, summary } = await syncDoeVisual(parent);
    const visual = plan.adds.find((op) => op.path === 'Visuals/doe-map.html')!;

    // Indexed under the visual's own id, from the rendered text, never the markup.
    const part = fake.parts.get(`text/${visual.id}.p1.md`) ?? '';
    assert.match(part, new RegExp(`\\[\\[doc:${visual.id} p:1\\]\\]`));
    assert.ok(part.includes('Figure: Meals delivered by week') && part.includes('Harbor Labs 212 meals'));
    assert.ok(!part.includes('<script') && !part.includes('var drawn') && !part.includes('<svg'));
    assert.deepEqual((await loadManifest(cache, 'local'))[visual.id], { sha256: sha(HTML), parts: 1, render: VISUAL_RENDER_VERSION });

    // Side files went through the store only, keyed by the page's sha256.
    assert.deepEqual(stored.sort(), [`${visualAiKey(sha(HTML), 'png')} png`, `${visualAiKey(sha(HTML), 'txt')} ${RENDERED}`]);
    assert.equal(summary.sideFiles, 2);
    assert.ok(fake.calls.every((call) => !call.includes('meta/')), 'no side file on the documents R2 path');

    // Three files, three documents rows and three control numbers: the side files take none.
    const sqlText = fake.sql.join('\n');
    assert.equal(sqlText.match(/INSERT INTO documents/g)?.length, 3);
    assert.ok(!sqlText.includes('visual-ai'));

    // A second run with nothing changed has no visual work left.
    const rows = plan.adds.map((op) => ({ id: op.id, path: op.path, sha256: op.sha256, size: op.size, kind: op.kind, pages: null, r2_key: op.r2Key, source: 'mirror', removed_at: null }));
    const again = diffSync(snapshot.files, rows);
    assert.deepEqual(indexWork(again, await loadManifest(cache, 'local')).jobs.map((job) => job.id), []);
    const sideAgain = await planSideFiles(liveVisualShas(again), cache, await loadSideManifest(cache, 'local'));
    assert.deepEqual([sideAgain.puts.length, sideAgain.deletes.length], [0, 0]);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
