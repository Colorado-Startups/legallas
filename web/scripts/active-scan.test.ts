// SPDX-License-Identifier: Apache-2.0
// The sync's active-content check, on tiny files written here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  ACTIVE_RULES_VERSION,
  activeFingerprintEntries,
  activeGate,
  activeRefusal,
  activeTargets,
  formatActiveReport,
  loadActiveCleared,
  saveActiveCleared,
  scanFile,
  scanForActive,
  type ActiveScan,
} from './active-scan.ts';
import type { SyncPlan } from './diff.ts';
import { planFingerprint } from './report.ts';
import type { SnapshotFile } from './snapshot.ts';
import { parseSyncArgs } from './sync.ts';

const sha = (c: string) => c.repeat(64);
const file = (rel: string, c: string) => ({ rel, sha256: sha(c), snapshot: `/snap/${c}` }) as SnapshotFile;
const plan = (): SyncPlan<SnapshotFile> =>
  ({
    adds: [{ file: file('b/new.pdf', 'a') }],
    changes: [{ file: file('a/changed.docx', 'b') }],
    renames: [{ file: file('c/moved.pdf', 'c') }],
    unchanged: [{ file: file('d/kept.pdf', 'd') }],
    removals: [],
    held: [],
  }) as unknown as SyncPlan<SnapshotFile>;

test('every document the room will hold is read unless its sha256 is cleared, in path order', () => {
  assert.deepEqual(activeTargets(plan(), new Set()).map((t) => t.rel), ['a/changed.docx', 'b/new.pdf', 'c/moved.pdf', 'd/kept.pdf']);
  assert.deepEqual(activeTargets(plan(), new Set([sha('d'), sha('a')])).map((t) => t.file), ['/snap/b', '/snap/c']);
});

test('files are read by name, then by their bytes; one that cannot be read is unchecked', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'active-scan-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const put = async (rel: string, body: string | Uint8Array) => {
    await mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
    await writeFile(path.join(dir, rel), body);
    return path.join(dir, rel);
  };
  const scan = async (rel: string, body: string | Uint8Array) => scanFile(await put(rel, body), rel);
  assert.equal(await scan('memo.pdf', '%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n'), null);
  assert.equal(await scan('form.pdf', '%PDF-1.7\n1 0 obj\n<< /AA << /K << /S /JavaScript /JS (AFNumber_Format\\(2\\)) >> >> >>\nendobj\n'), 'pdf-javascript');
  assert.equal(await scan('Budget.XLSM', 'not even a zip'), 'office-macros', 'by name alone');
  assert.equal(await scan('tools/setup.exe', 'MZ'), 'runnable');
  const name = new TextEncoder().encode('word/vbaProject.bin');
  assert.equal(await scan('letter.docx', Uint8Array.of(0x50, 0x4b, 3, 4, 20, ...new Array(21).fill(0), name.length, 0, 0, 0, ...name)), 'office-macros');
  assert.equal(await scan('activeX/notes.txt', 'a folder name says nothing about its files'), null);
  assert.equal(await scanFile(path.join(dir, 'missing.pdf'), 'missing.pdf'), 'unchecked');
});

const flaggedScan = (): ActiveScan => ({
  scanned: 3,
  flagged: [
    { path: 'forms/intake.pdf', sha256: sha('a'), rule: 'pdf-javascript' },
    { path: 'old/model.xlsm', sha256: sha('b'), rule: 'office-macros' },
  ],
});

test('scanForActive keeps each finding with its path and sha256', async () => {
  const targets = activeTargets(plan(), new Set());
  const scan = await scanForActive(targets, async (_file, rel) => (rel.endsWith('.docx') ? 'office-macros' : null));
  assert.deepEqual(scan, { scanned: 4, flagged: [{ path: 'a/changed.docx', sha256: sha('b'), rule: 'office-macros' }] });
});

test('--apply refuses while a flag is open, and on an --allow-active that matches nothing', () => {
  const scan = flaggedScan();
  assert.match(activeRefusal(activeGate(scan, []))!, /2 can run code.*--allow-active <sha256>.*Nothing was changed\.$/);
  assert.match(activeRefusal(activeGate(scan, [sha('a')]))!, /^Active-content check: 1 can run code/);
  assert.equal(activeRefusal(activeGate(scan, [sha('a'), sha('b')])), null);
  assert.match(activeRefusal(activeGate(scan, [sha('a'), sha('b'), sha('f')]))!, /1 --allow-active values match no flagged document/);
  assert.equal(activeRefusal(activeGate({ scanned: 9, flagged: [] }, [])), null);
});

test('flags and acknowledgements are part of the plan fingerprint', () => {
  const base = planFingerprint(plan());
  assert.equal(planFingerprint(plan(), activeFingerprintEntries({ scanned: 4, flagged: [] }, [])), base, 'nothing flagged changes nothing');
  const open = planFingerprint(plan(), activeFingerprintEntries(flaggedScan(), []));
  const allowed = planFingerprint(plan(), activeFingerprintEntries(flaggedScan(), [sha('a')]));
  assert.notEqual(open, base);
  assert.notEqual(allowed, open);
  assert.equal(planFingerprint(plan(), activeFingerprintEntries(flaggedScan(), [sha('a'), sha('a')])), allowed, 'repeating one changes nothing');
});

test('the report lists each flag with its status and sha256, through the masking printer, and --summary leaves paths out', () => {
  const scan = flaggedScan();
  const gate = activeGate(scan, [sha('b')]);
  const lines = formatActiveReport(scan, gate, false, (rel) => rel.replace(/\d/g, '#'));
  assert.equal(lines[0], 'Active-content check: 3 documents read (any these rules have not cleared).');
  assert.ok(lines.some((line) => line.includes(`open         ${sha('a')}  forms/intake.pdf  (a PDF with JavaScript)`)));
  assert.ok(lines.some((line) => line.includes(`acknowledged ${sha('b')}  old/model.xlsm  (Office macros)`)));
  assert.ok(lines.some((line) => line.includes('--allow-active <sha256>')));
  const summary = formatActiveReport(scan, gate, true, (rel) => rel).join('\n');
  assert.doesNotMatch(summary, /intake|model/);
  assert.deepEqual(formatActiveReport({ scanned: 0, flagged: [] }, activeGate({ scanned: 0, flagged: [] }, []), false, String), []);
});

test('cleared sha256s are saved after a run and read back only under the same rules', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'active-cleared-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  assert.equal((await loadActiveCleared(dir)).size, 0, 'none yet');
  await saveActiveCleared(dir, plan());
  assert.deepEqual([...(await loadActiveCleared(dir))], [sha('a'), sha('b'), sha('c'), sha('d')]);
  await writeFile(path.join(dir, 'active-cleared.json'), JSON.stringify({ rules: ACTIVE_RULES_VERSION + 1, sha256s: [sha('a')] }));
  assert.equal((await loadActiveCleared(dir)).size, 0, 'newer rules read everything again');
  await writeFile(path.join(dir, 'active-cleared.json'), 'not json');
  assert.equal((await loadActiveCleared(dir)).size, 0);
});

test('sync takes --allow-active <sha256>, once per document', () => {
  assert.deepEqual(parseSyncArgs([]).allowActive, []);
  assert.deepEqual(parseSyncArgs(['--allow-active', sha('a'), '--allow-active', sha('b')]).allowActive, [sha('a'), sha('b')]);
  for (const bad of [['--allow-active'], ['--allow-active', 'all'], ['--allow-active', sha('A')]]) assert.throws(() => parseSyncArgs(bad), /usage/);
});
