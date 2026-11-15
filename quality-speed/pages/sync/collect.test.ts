// SPDX-License-Identifier: Apache-2.0
// The sync collector on Linux, with a portable clone step and a stand-in PDF reader: the gate's fingerprint catches
// every kind of change, a full Mac run writes valid records, and an engine that can't run reads 0, never good news.
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { chmod, copyFile, mkdtemp, readFile, rename, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { joinMetrics, validateManifest, validateRecords } from '../../contract/validate.ts';
import { scoreMetrics } from '../../core/score.ts';
import { collect, fingerprint, sameTree, type Engine } from './collect.ts';

const RUN = 'https://github.com/Colorado-Startups/legallas/actions/runs/1001';
const manifest = validateManifest(JSON.parse(await readFile(new URL('manifest.json', import.meta.url), 'utf8')), 'sync').value;

/** Reads the text the PDF writer puts in `(...) Tj`, and refuses a file with no end, as a cut PDF is. */
const engine: Engine = {
  clone: (source, destination) => copyFile(source, destination),
  extract: async (file) => {
    const pdf = await readFile(file, 'latin1');
    if (!pdf.includes('%%EOF')) throw new Error('LegallasExtract failed: unreadable');
    return [{ n: 1, text: [...pdf.matchAll(/\((.*?)\) Tj/g)].map((m) => m[1]).join('\n'), ocr: false }];
  },
};

test('the fingerprint catches new bytes, a new time, a rename, a delete, a new file and one written and removed, a chmod, dotfiles included', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'qs-sync-test-'));
  try {
    const file = path.join(dir, '.notes');
    await writeFile(file, 'one');
    const changes = [
      () => writeFile(file, 'two'),
      () => utimes(file, new Date(0), new Date(0)),
      () => rename(file, path.join(dir, '.moved')),
      () => rm(path.join(dir, '.moved')),
      () => writeFile(path.join(dir, 'new.txt'), ''),
      // Seen only through the folder's own times, which some filesystems keep to the second: wait past one first.
      () => sleep(1100).then(() => writeFile(path.join(dir, 'gone.txt'), '')).then(() => rm(path.join(dir, 'gone.txt'))),
      () => writeFile(path.join(dir, 'kept.txt'), 'same'),
      () => chmod(path.join(dir, 'kept.txt'), 0o600),
    ];
    for (const change of changes) {
      const before = await fingerprint(dir);
      assert.ok(sameTree(before, await fingerprint(dir)));
      await change();
      assert.ok(!sameTree(before, await fingerprint(dir)));
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a Mac run writes a valid record for each of its metrics', async () => {
  assert.ok(manifest);
  const records = await collect('mac', engine, { recordingBytes: 1024, sourceUrl: RUN });
  assert.deepEqual(validateRecords(records, manifest).errors, []);
  const value = Object.fromEntries(records.map((r) => [r.id, r.value]));
  assert.equal(records.length, 3);
  // Word, Excel, PowerPoint and PDF read, and the cut PDF, the broken Pages file and the Keynote package named: 11 of 17.
  // Pages, Numbers and Keynote have no samples until #66, so they count as six files not read.
  assert.equal(value.mac_files_read, 64.7);
  assert.equal(records.find((r) => r.id === 'mac_files_read')?.sample_size, 17);
  assert.equal(value.mac_folder_unchanged, 1);
  assert.equal(typeof value.mac_change_to_index_text_max, 'number');
});

test('an engine that cannot run reads 0, its speed is missing, and its gate reads missing, never a pass', async () => {
  assert.ok(manifest);
  const records = await collect('windows', { ...engine, clone: () => Promise.reject(new Error('no clone')) }, { recordingBytes: 1024, sourceUrl: RUN });
  assert.deepEqual(validateRecords(records, manifest).errors, []);
  const value = Object.fromEntries(records.map((r) => [r.id, r.value]));
  assert.equal(value.windows_files_read, 0);
  assert.equal(value.windows_change_to_index_text_max, null);
  const gate = records.find((r) => r.id === 'windows_folder_unchanged');
  assert.deepEqual([gate?.status, gate?.value, gate?.sample_size], ['missing', null, null]);
  assert.equal(scoreMetrics(joinMetrics({ ...manifest, signoff_comment: 1 }, records), new Date()).find((m) => m.id === 'windows_folder_unchanged')?.reading, 'missing');
});
