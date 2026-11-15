// SPDX-License-Identifier: Apache-2.0
// The visuals' AI side files on the sync side: the rendered-text cache, the plan of puts and deletes inside the
// fingerprint, the fixed-prefix writer, and the index reading a visual's rendered text instead of its markup.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isVisualAiKey, visualAiKey, VISUAL_PNG_MAX_BYTES } from '../worker/side-files.ts';
import type { SyncPlan } from './diff.ts';
import { directTextPages, renderVersion, VISUAL_RENDER_VERSION, VisualTextMissing } from './extract.ts';
import type { SnapshotFile } from './snapshot.ts';
import {
  applySideFiles, formatSidePlan, liveVisualShas, loadSideManifest, planSideFiles, readVisualEntry, saveSideManifest, sideFileArgs,
  sideFingerprintEntries, sideRefusal, visualTextSource, writeVisualEntry, type SideFileStore,
} from './visual-ai.ts';

const sha = (text: string) => createHash('sha256').update(text).digest('hex');
// The SSA's long-voided sample number, built at runtime so no scanner reads it as a literal.
const VOIDED = ['078', '05', '1120'].join('-');
/** A tiny PNG header (signature and IHDR, 10 by 10 pixels): enough for the side-file checks. */
const PNG = (() => {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 10, 0, 0, 0, 10]);
  return bytes;
})();

async function scratch() {
  const dir = await mkdtemp(path.join(tmpdir(), 'legallas-visual-ai-'));
  return { dir, done: () => rm(dir, { recursive: true, force: true }) };
}

test('the cache keeps text and a PNG under the HTML sha256, and ignores entries from another renderer', async () => {
  const { dir, done } = await scratch();
  try {
    const html = sha('<p>Doe</p>');
    await writeVisualEntry(dir, html, 'Copperline', PNG);
    assert.deepEqual(await readVisualEntry(dir, html), { version: VISUAL_RENDER_VERSION, sha256: html, text: 'Copperline', png: true });
    assert.deepEqual(await readFile(path.join(dir, 'visual-ai', `${html}.png`)), Buffer.from(PNG));
    assert.equal(await visualTextSource(dir)(html), 'Copperline');

    const big = sha('big');
    await writeVisualEntry(dir, big, 'Roe', new Uint8Array(VISUAL_PNG_MAX_BYTES + 1));
    assert.equal((await readVisualEntry(dir, big))?.png, false, 'a PNG over the embed limit is not kept');

    const old = sha('old');
    await writeFile(path.join(dir, 'visual-ai', `${old}.json`), JSON.stringify({ version: VISUAL_RENDER_VERSION + 1, sha256: old, text: 'x', png: false }));
    assert.equal(await readVisualEntry(dir, old), null);
    await writeFile(path.join(dir, 'visual-ai', `${old}.json`), '{not json');
    assert.equal(await readVisualEntry(dir, old), null);
    assert.equal(await readVisualEntry(dir, 'not-a-sha'), null);
  } finally {
    await done();
  }
});

test('a visual is indexed from its rendered text, found by the sha256 of its bytes, never from its markup', async () => {
  const { dir, done } = await scratch();
  try {
    const file = path.join(dir, 'map.html');
    const html = '<html><body><script>var x = 1;</script><h1>Doe deliveries</h1></body></html>';
    await writeFile(file, html);
    assert.equal(renderVersion('Visuals/map.html'), VISUAL_RENDER_VERSION);
    await assert.rejects(directTextPages(file, 'map.html'), VisualTextMissing, 'no cache given: never the markup');
    await assert.rejects(directTextPages(file, 'map.html', visualTextSource(dir)), VisualTextMissing, 'not rendered yet');
    await writeVisualEntry(dir, sha(html), '# Doe deliveries', null);
    assert.deepEqual(await directTextPages(file, 'map.html', visualTextSource(dir)), [{ n: 1, text: '# Doe deliveries', ocr: false, rendered: true }]);
    await writeFile(file, html.replace('Doe', 'Roe'));
    await assert.rejects(directTextPages(file, 'map.html', visualTextSource(dir)), VisualTextMissing, 'text never pairs with another version of the page');
  } finally {
    await done();
  }
});

function snap(rel: string, content: string): SnapshotFile {
  return { rel, size: content.length, sha256: sha(content), snapshot: `/snap/${rel}` } as SnapshotFile;
}

test('live visuals are every HTML file the index reads, once per distinct page', () => {
  const plan = {
    adds: [{ kind: 'visual', file: snap('Visuals/a.html', 'a') }, { kind: 'pdf', file: snap('A/b.pdf', 'b') }],
    changes: [{ kind: 'visual', file: snap('Visuals/c.htm', 'c') }],
    renames: [{ kind: 'visual', file: snap('Visuals/copy-of-a.html', 'a') }],
    removals: [],
    held: [],
    unchanged: [{ id: 'x', file: snap('Visuals/d.html', 'd') }, { id: 'y', file: snap('.claude/notes.html', 'e') }],
  } as unknown as SyncPlan<SnapshotFile>;
  assert.deepEqual(liveVisualShas(plan), [sha('a'), sha('c'), sha('d')].sort());
});

test('the side-file plan uploads changed text and PNGs, deletes side files of visuals no longer live, and keeps unrendered ones', async () => {
  const { dir, done } = await scratch();
  try {
    const [a, b, c, gone] = ['a', 'b', 'c', 'gone'].map(sha) as [string, string, string, string];
    await writeVisualEntry(dir, a, 'Doe text, changed', PNG);
    await writeVisualEntry(dir, b, 'Roe text', null);
    const manifest = {
      [visualAiKey(a, 'txt')]: sha('Doe text'),
      [visualAiKey(b, 'txt')]: sha('Roe text'),
      [visualAiKey(c, 'txt')]: sha('uploaded before the cache was cleared'),
      [visualAiKey(gone, 'txt')]: sha('x'),
      [visualAiKey(gone, 'png')]: sha('y'),
    };
    const plan = await planSideFiles([a, b, c], dir, manifest);
    assert.deepEqual(plan.puts.map((put) => put.key), [visualAiKey(a, 'png'), visualAiKey(a, 'txt')]);
    assert.deepEqual(plan.deletes, [visualAiKey(gone, 'png'), visualAiKey(gone, 'txt')]);
    assert.deepEqual([plan.visuals, plan.missing, plan.heldBack], [3, 1, []]);
    const pngHash = createHash('sha256').update(PNG).digest('hex');
    assert.deepEqual(sideFingerprintEntries(plan), [
      `visual-ai\0put\0${visualAiKey(a, 'png')}\0${pngHash}`,
      `visual-ai\0put\0${visualAiKey(a, 'txt')}\0${sha('Doe text, changed')}`,
      `visual-ai\0delete\0${visualAiKey(gone, 'png')}`,
      `visual-ai\0delete\0${visualAiKey(gone, 'txt')}`,
    ]);
    // Once applied, the same cache plans nothing, so the fingerprint is the plain sync's.
    const applied: Record<string, string> = { ...manifest, ...Object.fromEntries(plan.puts.map((put) => [put.key, put.hash])) };
    for (const key of plan.deletes) delete applied[key];
    assert.deepEqual(sideFingerprintEntries(await planSideFiles([a, b, c], dir, applied)), []);
  } finally {
    await done();
  }
});

test('a rendered text that still holds an SSN is held back and its old side files deleted, unless acknowledged', async () => {
  const { dir, done } = await scratch();
  try {
    const page = sha('w9 page');
    await writeVisualEntry(dir, page, `Taxpayer number ${VOIDED}`, null);
    const manifest = { [visualAiKey(page, 'txt')]: sha('older text') };
    const held = await planSideFiles([page], dir, manifest);
    assert.deepEqual([held.puts.length, held.heldBack, held.deletes], [0, [page], [visualAiKey(page, 'txt')]]);
    assert.match(sideRefusal(held) ?? '', /^1 visual pages show a Social Security number once rendered/);
    const report = formatSidePlan(held).join('\n');
    assert.ok(report.includes(page) && !report.includes(VOIDED), 'the report names the page by sha256, never the number');
    const acknowledged = await planSideFiles([page], dir, manifest, { known: null, acknowledged: new Set([page]) });
    assert.deepEqual([acknowledged.puts.length, acknowledged.heldBack, sideRefusal(acknowledged)], [1, [], null]);
  } finally {
    await done();
  }
});

test('an acknowledged page is uploaded once, and a later unchanged run neither re-checks nor refuses it', async () => {
  const { dir, done } = await scratch();
  try {
    const page = sha('w9 page');
    await writeVisualEntry(dir, page, `Taxpayer number ${VOIDED}`, null);
    const manifest: Record<string, string> = {};
    const store: SideFileStore = { put: async () => {}, delete: async () => {} };
    // Run 1: the raw page was flagged and acknowledged with --allow-pii, so the guard passes its sha256.
    const first = await planSideFiles([page], dir, manifest, { known: null, acknowledged: new Set([page]) });
    assert.deepEqual([first.puts.length, first.heldBack, sideRefusal(first)], [1, [], null]);
    await applySideFiles(first, store, manifest, 'remote', path.join(dir, 'work'), () => {});
    // Run 2: nothing changed, so the page is not among this run's targets and no acknowledgement is passed.
    const second = await planSideFiles([page], dir, manifest);
    assert.deepEqual([second.puts, second.deletes, second.heldBack, sideRefusal(second)], [[], [], [], null]);
    assert.deepEqual(sideFingerprintEntries(second), []);
    // A new rendering of the same page is a new upload, and is checked again.
    await writeVisualEntry(dir, page, `Taxpayer number ${VOIDED} (revised)`, null);
    assert.deepEqual((await planSideFiles([page], dir, manifest)).heldBack, [page]);
  } finally {
    await done();
  }
});

test('side-file writes name only legallas-files and meta/visual-ai/ keys', () => {
  const key = visualAiKey(sha('a'), 'txt');
  assert.deepEqual(sideFileArgs('remote', 'put', key, '/w/a.txt', 'text/plain; charset=utf-8'), [
    'r2', 'object', 'put', `legallas-files/${key}`, '--file', '/w/a.txt', '--content-type', 'text/plain; charset=utf-8', '--remote',
  ]);
  assert.deepEqual(sideFileArgs('local', 'delete', key), ['r2', 'object', 'delete', `legallas-files/${key}`, '--local']);
  for (const bad of ['meta/matter.json', '00000000-0000-4000-8000-000000000001', `meta/visual-ai/${sha('a')}.html`, `meta/visual-ai/../${sha('a')}.txt`]) {
    assert.throws(() => sideFileArgs('remote', 'put', bad, '/w/a', 'x'), /side-file key/, bad);
    assert.equal(isVisualAiKey(bad), false, bad);
  }
  assert.throws(() => sideFileArgs('production' as never, 'delete', key), /target/);
  assert.throws(() => visualAiKey('ABC', 'txt'), /bad sha256/);
});

test('applying the plan writes texts through the store, records each success and retries failures next run', async () => {
  const { dir, done } = await scratch();
  try {
    const [a, b, gone] = ['a', 'b', 'gone'].map(sha) as [string, string, string];
    await writeVisualEntry(dir, a, 'Doe text', null);
    await writeVisualEntry(dir, b, 'Roe text', null);
    const manifest: Record<string, string> = { [visualAiKey(gone, 'txt')]: sha('x') };
    const plan = await planSideFiles([a, b], dir, manifest);
    const calls: string[] = [];
    const store: SideFileStore = {
      async put(key, file, contentType) {
        if (key.includes(b)) throw new Error('R2 500');
        calls.push(`put ${key} ${contentType} ${await readFile(file, 'utf8')}`);
      },
      async delete(key) {
        calls.push(`delete ${key}`);
      },
    };
    const log: string[] = [];
    const done2 = await applySideFiles(plan, store, manifest, 'remote', path.join(dir, 'work'), (line) => log.push(line));
    assert.equal(done2, 2);
    assert.deepEqual(calls, [`put ${visualAiKey(a, 'txt')} text/plain; charset=utf-8 Doe text`, `delete ${visualAiKey(gone, 'txt')}`]);
    assert.deepEqual(manifest, { [visualAiKey(a, 'txt')]: sha('Doe text') });
    assert.deepEqual(log, ['  warning: 1 visual side-file operations failed; they will be retried next run']);
    await saveSideManifest(dir, 'remote', manifest);
    assert.deepEqual(await loadSideManifest(dir, 'remote'), manifest);
    assert.deepEqual(await loadSideManifest(dir, 'local'), {});
  } finally {
    await done();
  }
});
