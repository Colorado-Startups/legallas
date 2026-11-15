// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildPack } from './counsel-pack-build.ts';
import { MANIFEST_NAME } from './counsel-pack-plan.ts';
import { FILES, fixture, rowFor, sha } from './counsel-pack-testkit.ts';
import { listZip } from './counsel-pack-zip.ts';
import { GuardAbort } from './guard.ts';

test('copies the tree, writes INDEX.csv and README.txt, and leaves hidden rows out', async () => {
  const f = await fixture();
  try {
    f.rows.push({ ...rowFor('legallas-visuals.json', '{}', 9) });
    const report = await buildPack(f.options(), f.deps);
    assert.equal(report.outcomes.copied, 4);
    assert.equal(report.ignored, 1);
    for (const [rel, content] of Object.entries(FILES)) assert.equal(await readFile(path.join(f.out, rel), 'utf8'), content);
    const index = (await readFile(path.join(f.out, 'INDEX.csv'), 'utf8')).split('\r\n');
    assert.equal(index[0], '\uFEFFcontrol_number,title,path,pages,sha256,room_link');
    assert.equal(
      index[2],
      `DOE-000002,Service-Contract__20110809__Tally-Payroll.pdf,01-Contracts/Service-Contract__20110809__Tally-Payroll.pdf,2,${sha(FILES['01-Contracts/Service-Contract__20110809__Tally-Payroll.pdf'])},` +
        'https://room.example.com/doc/?id=00000000-0000-4000-8000-000000000002',
    );
    assert.equal(index.length, 6, 'header, four documents and the final newline');
    const readme = await readFile(path.join(f.out, 'README.txt'), 'utf8');
    assert.match(readme, /CONFIDENTIAL\. Work Product\./);
    assert.match(readme, /snapshot of the 4 documents .* as of 2026-10-01/);
    assert.match(readme, /Harvey/);
    assert.match(readme, /SharePoint/);
    assert.equal(await stat(path.join(f.out, 'legallas-visuals.json')).catch(() => null), null);
  } finally {
    await f.done();
  }
});

test('a second run copies nothing that is unchanged', async () => {
  const f = await fixture();
  try {
    await buildPack(f.options(), f.deps);
    const file = path.join(f.out, '01-Contracts/Job-Schedule__20110914__Tally-Payroll.pdf');
    const before = (await stat(file)).mtimeMs;
    const report = await buildPack(f.options(), f.deps);
    assert.deepEqual([report.outcomes.copied, report.outcomes.unchanged], [0, 4]);
    assert.equal((await stat(file)).mtimeMs, before);
  } finally {
    await f.done();
  }
});

test('removes only files the pack wrote and that are unchanged since', async () => {
  const f = await fixture();
  try {
    await buildPack(f.options(), f.deps);
    await writeFile(path.join(f.out, 'my-notes.txt'), 'counsel notes');
    await writeFile(path.join(f.out, '04-Letters/Letter__20120903__Acme-Mutual.txt'), 'edited by counsel');
    f.rows.splice(0, f.rows.length, ...f.rows.filter((row) => !String(row.path).startsWith('04-') && row.path !== '01-Contracts/Job-Schedule__20110914__Tally-Payroll.pdf'));
    const report = await buildPack(f.options(), f.deps);
    assert.equal(report.removed, 1);
    assert.equal(report.left, 1);
    assert.equal(await stat(path.join(f.out, '01-Contracts/Job-Schedule__20110914__Tally-Payroll.pdf')).catch(() => null), null);
    assert.equal(await readFile(path.join(f.out, 'my-notes.txt'), 'utf8'), 'counsel notes');
    assert.equal(await readFile(path.join(f.out, '04-Letters/Letter__20120903__Acme-Mutual.txt'), 'utf8'), 'edited by counsel');
    const manifest = JSON.parse(await readFile(path.join(f.out, MANIFEST_NAME), 'utf8')) as { files: Record<string, unknown> };
    assert.deepEqual(Object.keys(manifest.files).sort(), ['01-Contracts/Service-Contract__20110809__Tally-Payroll.pdf', 'CLAUDE.md']);
  } finally {
    await f.done();
  }
});

test('a _private folder aborts the run before anything is written', async () => {
  const f = await fixture();
  try {
    await mkdir(path.join(f.root, '03-Kitchen-Records', '_private'), { recursive: true });
    await writeFile(path.join(f.root, '03-Kitchen-Records', '_private', 'strategy.txt'), 'never leaves the Mac');
    await assert.rejects(buildPack(f.options(), f.deps), (error) => error instanceof GuardAbort && error.violations[0].reason === 'private');
    assert.equal(await stat(f.out).catch(() => null), null);
  } finally {
    await f.done();
  }
});

test('a file missing or changed on the Mac is reported and skipped, never guessed', async () => {
  const f = await fixture();
  try {
    await writeFile(path.join(f.root, '01-Contracts/Job-Schedule__20110914__Tally-Payroll.pdf'), '%PDF-1.7 a newer, unsynced job schedule');
    await rm(path.join(f.root, '04-Letters/Letter__20120903__Acme-Mutual.txt'));
    const report = await buildPack(f.options(), f.deps);
    assert.deepEqual([report.outcomes.copied, report.outcomes.changed, report.outcomes.missing], [2, 1, 1]);
    assert.equal(await stat(path.join(f.out, '01-Contracts/Job-Schedule__20110914__Tally-Payroll.pdf')).catch(() => null), null);
    const index = await readFile(path.join(f.out, 'INDEX.csv'), 'utf8');
    assert.doesNotMatch(index, /Job-Schedule__|Letter__20120903/);
  } finally {
    await f.done();
  }
});

test('a pack copy that still matches D1 is kept when the Mac copy changed later', async () => {
  const f = await fixture();
  try {
    await buildPack(f.options(), f.deps);
    await writeFile(path.join(f.root, '01-Contracts/Job-Schedule__20110914__Tally-Payroll.pdf'), '%PDF-1.7 edited after the last sync');
    const report = await buildPack(f.options(), f.deps);
    assert.deepEqual([report.outcomes.unchanged, report.staleLocal], [4, 1]);
    assert.equal(await readFile(path.join(f.out, '01-Contracts/Job-Schedule__20110914__Tally-Payroll.pdf'), 'utf8'), FILES['01-Contracts/Job-Schedule__20110914__Tally-Payroll.pdf']);
  } finally {
    await f.done();
  }
});

test('refuses an --out inside the source folder, around it, inside a repository, or non-empty without a manifest', async () => {
  const f = await fixture();
  try {
    await assert.rejects(buildPack(f.options({ out: path.join(f.root, 'pack') }), f.deps), /outside the source folder/);
    await assert.rejects(buildPack(f.options({ out: f.parent }), f.deps), /outside the source folder/);
    await assert.rejects(buildPack(f.options({ out: path.join(f.deps.repoRoot ?? '', 'pack') }), f.deps), /outside every git repository/);
    await mkdir(path.join(f.parent, 'other', '.git'), { recursive: true });
    await assert.rejects(buildPack(f.options({ out: path.join(f.parent, 'other', 'pack') }), f.deps), /outside every git repository/);
    await mkdir(f.out);
    await writeFile(path.join(f.out, 'unrelated.txt'), 'x');
    await assert.rejects(buildPack(f.options(), f.deps), /not empty/);
    assert.equal(await stat(path.join(f.root, 'pack')).catch(() => null), null);
  } finally {
    await f.done();
  }
});

test('does not overwrite a file in --out the pack did not write', async () => {
  const f = await fixture();
  try {
    await buildPack(f.options(), f.deps);
    const manifestFile = path.join(f.out, MANIFEST_NAME);
    const manifest = JSON.parse(await readFile(manifestFile, 'utf8')) as { files: Record<string, unknown> };
    delete manifest.files['CLAUDE.md'];
    await writeFile(manifestFile, JSON.stringify(manifest));
    await writeFile(path.join(f.out, 'CLAUDE.md'), 'counsel owns this one now');
    const report = await buildPack(f.options(), f.deps);
    assert.equal(report.outcomes.conflict, 1);
    assert.equal(await readFile(path.join(f.out, 'CLAUDE.md'), 'utf8'), 'counsel owns this one now');
  } finally {
    await f.done();
  }
});

test('--include-uploads adds counsel uploads under from-counsel with safe, stable names', async () => {
  const f = await fixture();
  try {
    f.uploads.push({ id: 'up-1', name: '../Freezer quote.pdf', size: 9, pages: 1, control_seq: 10, etag: 'e1', r2_key: 'uploads/up-1' });
    f.uploads.push({ id: 'up-2', name: 'gone.pdf', size: 4, pages: null, control_seq: 11, etag: 'e2', r2_key: 'uploads/up-2' });
    f.r2.set('uploads/up-1', '%PDF-fqt!');
    const first = await buildPack(f.options({ includeUploads: true }), f.deps);
    assert.deepEqual([first.outcomes.copied, first.outcomes.unavailable], [5, 1]);
    assert.equal(await readFile(path.join(f.out, 'from-counsel', 'Freezer quote.pdf'), 'utf8'), '%PDF-fqt!');
    assert.match(await readFile(path.join(f.out, 'INDEX.csv'), 'utf8'), /DOE-000010,\.\.\/Freezer quote\.pdf,from-counsel\/Freezer quote\.pdf,1,/);
    const second = await buildPack(f.options({ includeUploads: true }), f.deps);
    assert.equal(second.outcomes.unchanged, 5);
    const without = await buildPack(f.options(), f.deps);
    assert.equal(without.removed, 1);
  } finally {
    await f.done();
  }
});

test('--zip writes <out>.zip holding the index, the readme and every document', async () => {
  const f = await fixture();
  try {
    const report = await buildPack(f.options({ zip: true }), f.deps);
    assert.deepEqual(report.zip?.entries, 6);
    const listing = await listZip(`${f.out}.zip`);
    assert.deepEqual(
      listing.map((entry) => entry.name),
      ['INDEX.csv', 'README.txt', '01-Contracts/Job-Schedule__20110914__Tally-Payroll.pdf', '01-Contracts/Service-Contract__20110809__Tally-Payroll.pdf', '04-Letters/Letter__20120903__Acme-Mutual.txt', 'CLAUDE.md'],
    );
    const letter = listing.find((entry) => entry.name === '04-Letters/Letter__20120903__Acme-Mutual.txt');
    assert.equal(letter?.size, Buffer.byteLength(FILES['04-Letters/Letter__20120903__Acme-Mutual.txt']));
    assert.ok(!listing.some((entry) => entry.name === MANIFEST_NAME));
  } finally {
    await f.done();
  }
});
