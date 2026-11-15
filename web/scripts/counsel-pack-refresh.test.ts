// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFile, readdir, readFile, rename, stat, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildPack } from './counsel-pack-build.ts';
import { cloneOrCopy } from './counsel-pack-copy.ts';
import { MANIFEST_NAME } from './counsel-pack-plan.ts';
import { FILES, fixture, sha, type Fixture } from './counsel-pack-testkit.ts';

const LETTER = '04-Letters/Letter__20120903__Acme-Mutual.txt';

/** Moves the pack's 04-Letters folder outside --out and leaves a link to it in its place. */
async function plantLetterLink(f: Fixture): Promise<string> {
  const outside = path.join(f.parent, 'Elsewhere');
  await rename(path.join(f.out, '04-Letters'), outside);
  await symlink(outside, path.join(f.out, '04-Letters'));
  return outside;
}

test('a copy that fails mid-run costs only that file, and the next run recovers', async () => {
  const f = await fixture();
  try {
    const failing = async (source: string, destination: string) => {
      if (source.endsWith('Job-Schedule__20110914__Tally-Payroll.pdf')) throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' });
      await cloneOrCopy(source, destination);
    };
    const first = await buildPack(f.options(), { ...f.deps, copy: failing });
    assert.deepEqual([first.outcomes.copied, first.outcomes.failed], [3, 1]);
    const manifest = JSON.parse(await readFile(path.join(f.out, MANIFEST_NAME), 'utf8')) as { files: Record<string, unknown> };
    assert.equal(Object.keys(manifest.files).length, 3);
    assert.deepEqual((await readdir(path.join(f.out, '01-Contracts'))).sort(), ['Service-Contract__20110809__Tally-Payroll.pdf']);
    const second = await buildPack(f.options(), f.deps);
    assert.deepEqual([second.outcomes.copied, second.outcomes.unchanged, second.outcomes.conflict], [1, 3, 0]);
  } finally {
    await f.done();
  }
});

test('removal never follows a folder link planted inside --out', async () => {
  const f = await fixture();
  try {
    await buildPack(f.options(), f.deps);
    const outside = await plantLetterLink(f);
    f.rows.splice(f.rows.findIndex((row) => row.path === LETTER), 1);
    const report = await buildPack(f.options(), f.deps);
    assert.deepEqual([report.removed, report.left], [0, 1]);
    assert.equal(await readFile(path.join(outside, 'Letter__20120903__Acme-Mutual.txt'), 'utf8'), FILES[LETTER]);
  } finally {
    await f.done();
  }
});

test('a copy never lands outside --out through a planted folder link', async () => {
  const f = await fixture();
  try {
    await buildPack(f.options(), f.deps);
    const outside = await plantLetterLink(f);
    const newer = 'Dear Mr. Moe, please confirm the 212 feet we patched on June 13, 2012.';
    await writeFile(path.join(f.root, LETTER), newer);
    Object.assign(f.rows.find((row) => row.path === LETTER) ?? {}, { sha256: sha(newer), size: Buffer.byteLength(newer) });
    const report = await buildPack(f.options(), f.deps);
    assert.equal(report.outcomes.failed, 1);
    assert.equal(await readFile(path.join(outside, 'Letter__20120903__Acme-Mutual.txt'), 'utf8'), FILES[LETTER]);
    assert.deepEqual(await readdir(outside), ['Letter__20120903__Acme-Mutual.txt']);
  } finally {
    await f.done();
  }
});

test('a folder renamed only in case is replaced, not reported as a conflict', async () => {
  const f = await fixture();
  try {
    await buildPack(f.options(), f.deps);
    await rename(path.join(f.root, '01-Contracts'), path.join(f.root, 'tmp-rename'));
    await rename(path.join(f.root, 'tmp-rename'), path.join(f.root, '01-contracts'));
    for (const row of f.rows) row.path = String(row.path).replace('01-Contracts/', '01-contracts/');
    const report = await buildPack(f.options(), f.deps);
    assert.deepEqual([report.removed, report.outcomes.copied, report.outcomes.conflict], [2, 2, 0]);
    assert.ok((await readdir(f.out)).includes('01-contracts'));
    assert.equal(await readFile(path.join(f.out, '01-contracts', 'Job-Schedule__20110914__Tally-Payroll.pdf'), 'utf8'), FILES['01-Contracts/Job-Schedule__20110914__Tally-Payroll.pdf']);
  } finally {
    await f.done();
  }
});

test('a refresh replaces a pack file someone edited with the room version', async () => {
  const f = await fixture();
  try {
    await buildPack(f.options(), f.deps);
    await writeFile(path.join(f.out, 'CLAUDE.md'), 'notes typed into the pack copy');
    const report = await buildPack(f.options(), f.deps);
    assert.deepEqual([report.outcomes.copied, report.replacedEdits], [1, 1]);
    assert.equal(await readFile(path.join(f.out, 'CLAUDE.md'), 'utf8'), FILES['CLAUDE.md']);
  } finally {
    await f.done();
  }
});

test('--zip never overwrites a zip the pack did not write', async () => {
  const f = await fixture();
  try {
    const zip = `${f.out}.zip`;
    await writeFile(zip, 'someone else');
    await assert.rejects(buildPack(f.options({ zip: true }), f.deps), /did not write it/);
    assert.equal(await readFile(zip, 'utf8'), 'someone else');
    await rename(zip, `${zip}.bak`);
    await buildPack(f.options({ zip: true }), f.deps);
    const again = await buildPack(f.options({ zip: true }), f.deps);
    assert.equal(again.zip?.entries, 6);
    await appendFile(zip, 'x');
    await assert.rejects(buildPack(f.options({ zip: true }), f.deps), /did not write it/);
    assert.ok((await stat(zip)).size > 0);
  } finally {
    await f.done();
  }
});

test('an upload whose bytes do not match its MD5 etag is skipped', async () => {
  const f = await fixture();
  try {
    const md5 = (text: string) => createHash('md5').update(text).digest('hex');
    f.uploads.push({ id: 'up-1', name: 'Freezer receipt.pdf', size: 8, pages: 1, control_seq: 10, etag: md5('%PDF-ok!'), r2_key: 'uploads/up-1' });
    f.uploads.push({ id: 'up-2', name: 'Freezer invoice.pdf', size: 8, pages: 1, control_seq: 11, etag: `"${md5('%PDF-bad')}"`, r2_key: 'uploads/up-2' });
    f.r2.set('uploads/up-1', '%PDF-ok!');
    f.r2.set('uploads/up-2', '%PDF-odd');
    const report = await buildPack(f.options({ includeUploads: true }), f.deps);
    assert.deepEqual([report.outcomes.copied, report.outcomes.changed], [5, 1]);
    assert.deepEqual(await readdir(path.join(f.out, 'from-counsel')), ['Freezer receipt.pdf']);
  } finally {
    await f.done();
  }
});
