// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { crc32, inflateRawSync } from 'node:zlib';
import { bannerOf, describeFailure, formatPackReport, parseCounselPackArgs } from './counsel-pack.ts';
import type { PackReport } from './counsel-pack-build.ts';
import { csvField, indexCsv, isSafeRel, mirrorRow, parseManifest, serializeManifest } from './counsel-pack-plan.ts';
import { dosDateTime, listZip, writeZip, zipFits } from './counsel-pack-zip.ts';
import { GuardAbort } from './guard.ts';

const SHA = 'a'.repeat(64);

test('the banner comes from the config, with the room fallback', () => {
  assert.equal(bannerOf({ banner: ' Work Product / Attorney Eyes Only. ' }), 'Work Product / Attorney Eyes Only.');
  assert.equal(bannerOf({ banner: 'line\nbreak' }), 'Attorney work product.');
  assert.equal(bannerOf({}), 'Attorney work product.');
});

test('CSV fields are quoted when needed and formulas are neutralized', () => {
  assert.equal(csvField('Copperline.pdf'), 'Copperline.pdf');
  assert.equal(csvField('Roe, Richard "Dick".pdf'), '"Roe, Richard ""Dick"".pdf"');
  assert.equal(csvField('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
  assert.equal(csvField('-1'), "'-1");
  assert.equal(csvField(null), '');
  assert.equal(csvField(12), '12');
});

test('only plain relative paths are safe to write', () => {
  assert.ok(isSafeRel('01-Contracts/Service-Contract__20110809__Tally-Payroll.pdf'));
  for (const bad of ['', '/abs.pdf', '../up.pdf', 'a/../b.pdf', 'a//b.pdf', 'a\\b.pdf', './a.pdf', 'Notes/_PRIVATE copy/x.pdf', 'tab\there.pdf']) {
    assert.equal(isSafeRel(bad), false, bad);
  }
});

test('mirror rows drop hidden, reserved, unsafe and malformed rows', () => {
  const base = { id: 'd1', path: '01/Doe.pdf', name: 'Doe.pdf', sha256: SHA, size: 3, pages: 1, control_seq: 4 };
  assert.equal(mirrorRow(base)?.rel, '01/Doe.pdf');
  assert.equal(mirrorRow({ ...base, path: 'legallas-matter.json', name: 'legallas-matter.json' }), null);
  assert.equal(mirrorRow({ ...base, path: 'index.csv', name: 'index.csv' }), null);
  assert.equal(mirrorRow({ ...base, path: '../Doe.pdf' }), null);
  assert.equal(mirrorRow({ ...base, sha256: null }), null);
  assert.equal(mirrorRow({ ...base, size: -1 }), null);
});

test('a manifest keeps only safe, well-formed entries', () => {
  const entry = { id: 'd1', sha256: SHA, size: 3, mtimeMs: 1 };
  const json = JSON.stringify({ version: 1, files: { 'a/b.pdf': entry, '../escape.pdf': entry, 'INDEX.csv': entry, 'c.pdf': { id: 'x' } } });
  const manifest = parseManifest(json);
  assert.deepEqual(Object.keys(manifest.files), ['a/b.pdf']);
  assert.deepEqual(parseManifest(serializeManifest(manifest)), manifest);
  assert.throws(() => parseManifest(JSON.stringify({ version: 2, files: {} })), /manifest/);
  const zipped = { version: 1, files: {}, zip: { size: 10, mtimeMs: 2 } };
  assert.deepEqual(parseManifest(serializeManifest(zipped)), zipped);
});

test('a damaged manifest is reported without echoing any of its contents', () => {
  assert.throws(
    () => parseManifest('{"version":1,"files":{"01/Service-Contract__20110809__Tally-Payroll.pdf": nope'),
    (error: Error) => /damaged/.test(error.message) && !/Supply|Doe|nope/.test(error.message),
  );
});

test('INDEX.csv starts with a UTF-8 byte order mark for Excel', () => {
  assert.equal(indexCsv([], 'DOE'), '\uFEFFcontrol_number,title,path,pages,sha256,room_link\r\n');
});

test('failures print reason counts and codes, and paths only with --verbose', () => {
  const guard = new GuardAbort([{ reason: 'private', rel: '03-Kitchen-Records/_private' }, { reason: 'symlink', rel: '04/Roe link.pdf' }]);
  const quiet = describeFailure(guard, false);
  assert.match(quiet, /private\s+1/);
  assert.match(quiet, /Nothing was packed/);
  assert.doesNotMatch(quiet, /Kitchen|Roe/);
  assert.match(describeFailure(guard, true), /symlink\s+04\/Roe link\.pdf/);
  const fsError = Object.assign(new Error("ENOSPC: no space left on device, copyfile '/Users/x/Copperline.pdf'"), { code: 'ENOSPC', syscall: 'copyfile' });
  assert.equal(describeFailure(fsError, false), 'File system error: ENOSPC (copyfile)');
});

test('zip limits are checked before anything is written', () => {
  assert.ok(zipFits([{ name: 'a.pdf', size: 1000 }]));
  assert.equal(zipFits([{ name: 'a.pdf', size: 0xffffffff }]), false);
  assert.equal(zipFits([{ name: 'a.pdf', size: 0x7fffffff }, { name: 'b.pdf', size: 0x7fffffff }]), false);
  assert.equal(zipFits(Array.from({ length: 0xffff }, (_, i) => ({ name: `${i}.txt`, size: 1 }))), false);
  assert.ok(zipFits(Array.from({ length: 0xfffe }, (_, i) => ({ name: `${i}.txt`, size: 1 }))));
});

test('arguments: --out is required, --target takes remote or local', () => {
  assert.throws(() => parseCounselPackArgs([]), /--out is required/);
  assert.throws(() => parseCounselPackArgs(['--out', '/tmp/p', '--target', 'prod']), /usage/);
  const options = parseCounselPackArgs(['--out', '/tmp/p', '--zip', '--target', 'local', '--include-uploads']);
  assert.deepEqual([options.out, options.zip, options.target, options.includeUploads, options.verbose], ['/tmp/p', true, 'local', true, false]);
});

test('the summary prints counts and sizes, and paths only with --verbose', () => {
  const report: PackReport = {
    dryRun: false,
    outcomes: { copied: 2, unchanged: 1, missing: 1, changed: 0, conflict: 0, unavailable: 0, failed: 0 },
    iworkPackages: [], staleLocal: 0, replacedEdits: 0, ignored: 0, removed: 1, removedBytes: 10, left: 0, packedBytes: 3072, copiedBytes: 2048, zip: null, sweptTemps: 0,
    details: [{ outcome: 'missing', rel: '01/Service-Contract__20110809__Tally-Payroll.pdf' }],
  };
  const quiet = formatPackReport(report, false);
  const withPackage = { ...report, iworkPackages: ['01/Deck.key'] };
  assert.match(formatPackReport(withPackage, false), /Not synced: 1 saved as a folder/, 'a person relying on the pack can see it');
  assert.doesNotMatch(formatPackReport(withPackage, false), /Deck\.key/, 'paths are case data: only --verbose names them');
  assert.match(formatPackReport(withPackage, true), /Not synced: 1 saved as a folder[^\n]*\n {2}01\/Deck\.key/);
  assert.match(quiet, /Pack: 3 documents \(3\.0 KB\); 2 copied/);
  assert.match(quiet, /Skipped 1: 1 missing/);
  assert.doesNotMatch(quiet, /Doe/);
  assert.match(formatPackReport(report, true), /missing\s+01\/Service-Contract__20110809__Tally-Payroll\.pdf/);
});

test('DOS timestamps pack the local date and time', () => {
  const { time, date } = dosDateTime(new Date(2026, 9, 1, 13, 45, 31));
  assert.deepEqual([time >> 11, (time >> 5) & 63, (time & 31) * 2], [13, 45, 30]);
  assert.deepEqual([(date >> 9) + 1980, (date >> 5) & 15, date & 31], [2026, 10, 1]);
});

test('the zip round-trips: stored and deflated entries carry the right bytes and CRCs', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'legallas-zip-'));
  try {
    const text = 'Copperline, delivery log line\r\n'.repeat(200);
    const binary = Buffer.from('%PDF-1.7 Doe é invoice');
    await writeFile(path.join(dir, 'a.csv'), text);
    await writeFile(path.join(dir, 'b.pdf'), binary);
    const target = path.join(dir, 'pack.zip');
    const inputs = [{ name: 'INDEX.csv', file: path.join(dir, 'a.csv') }, { name: '01/Café menu.pdf', file: path.join(dir, 'b.pdf') }];
    await writeZip(target, inputs, new Date(2026, 9, 1));
    const listing = await listZip(target);
    assert.deepEqual(listing.map((e) => [e.name, e.method]), [['INDEX.csv', 8], ['01/Café menu.pdf', 0]]);
    const bytes = await readFile(target);
    let at = 0;
    for (const [i, expected] of [Buffer.from(text), binary].entries()) {
      const nameLength = bytes.readUInt16LE(at + 26);
      const start = at + 30 + nameLength;
      const raw = bytes.subarray(start, start + listing[i].compressedSize);
      const data = listing[i].method === 8 ? inflateRawSync(raw) : raw;
      assert.deepEqual(data, expected);
      assert.equal(crc32(data), listing[i].crc32);
      at = start + listing[i].compressedSize;
    }
    if (existsSync('/usr/bin/unzip')) assert.match(execFileSync('/usr/bin/unzip', ['-t', target], { encoding: 'utf8' }), /No errors detected/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a failed zip leaves nothing behind', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'legallas-zip-'));
  try {
    const target = path.join(dir, 'pack.zip');
    await assert.rejects(writeZip(target, [{ name: 'gone.pdf', file: path.join(dir, 'gone.pdf') }], new Date()));
    assert.equal(existsSync(target), false);
    assert.deepEqual(await readdir(dir), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
