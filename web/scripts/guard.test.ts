// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { link, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  GuardAbort,
  guardWalk,
  hasAliasFlag,
  hasAliasMagic,
  hasPrivateKeyHead,
  isBundleName,
  isPrivateSegment,
  readFinderInfo,
  skipReason,
  type AbortReason,
  type FinderInfoReader,
} from './guard.ts';
import { diffSync } from './diff.ts';
import { indexWork } from './indexjob.ts';
import { formatReport } from './report.ts';
import type { SnapshotFile } from './snapshot.ts';

const noFinderInfo = async () => null;
// xattr and FinderInfo exist only on macOS; CI runs on Linux.
const MAC = process.platform === 'darwin';

/** A temp parent holding `root/` (the mirrored folder) and a sibling `_PRIVATE-Do-Not-Share/`. */
async function fixture(): Promise<{ parent: string; root: string; privateDir: string; done: () => Promise<void> }> {
  const parent = await mkdtemp(path.join(tmpdir(), 'legallas-guard-'));
  const root = path.join(parent, 'Shared');
  const privateDir = path.join(parent, '_PRIVATE-Do-Not-Share');
  await mkdir(path.join(root, 'Folder A'), { recursive: true });
  await mkdir(privateDir);
  await writeFile(path.join(privateDir, 'secret.txt'), 'never leaves the Mac');
  await writeFile(path.join(root, 'Folder A', 'brief.pdf'), '%PDF-1.7 dummy');
  await writeFile(path.join(root, 'CLAUDE.md'), '# Folder guide');
  return { parent, root, privateDir, done: () => rm(parent, { recursive: true, force: true }) };
}

async function abortReasons(root: string, finderInfo: FinderInfoReader = noFinderInfo): Promise<[AbortReason, string][]> {
  try {
    await guardWalk(root, finderInfo);
  } catch (error) {
    assert.ok(error instanceof GuardAbort, `expected GuardAbort, got ${String(error)}`);
    return error.violations.map((v) => [v.reason, v.rel]);
  }
  assert.fail('expected the guard to abort');
}

test('a clean tree passes, sorted, with folder guides kept', async () => {
  const f = await fixture();
  try {
    const result = await guardWalk(f.root, noFinderInfo);
    assert.deepEqual(result.files.map((file) => file.rel), ['CLAUDE.md', 'Folder A/brief.pdf']);
    assert.equal(result.files[1].size, 14);
  } finally {
    await f.done();
  }
});

test('a symlink to the sibling _PRIVATE folder aborts the whole run', async () => {
  const f = await fixture();
  try {
    await symlink(f.privateDir, path.join(f.root, 'Folder A', 'shortcut'));
    await symlink(path.join(f.privateDir, 'secret.txt'), path.join(f.root, 'innocent.txt'));
    assert.deepEqual(await abortReasons(f.root), [
      ['symlink', 'Folder A/shortcut'],
      ['symlink', 'innocent.txt'],
    ]);
  } finally {
    await f.done();
  }
});

test('a symlinked dotfile still aborts: links are checked before skip rules', async () => {
  const f = await fixture();
  try {
    await symlink(f.privateDir, path.join(f.root, '.hidden-link'));
    assert.deepEqual(await abortReasons(f.root), [['symlink', '.hidden-link']]);
  } finally {
    await f.done();
  }
});

test('hard links abort, inside or outside the root', async () => {
  const f = await fixture();
  try {
    await link(path.join(f.privateDir, 'secret.txt'), path.join(f.root, 'copy.txt'));
    assert.deepEqual(await abortReasons(f.root), [['hard-link', 'copy.txt']]);
  } finally {
    await f.done();
  }
});

test('a private key aborts whatever it is named, and a public key or certificate does not (#224)', async () => {
  // Headers built at run time, so the secret scan never sees a key-shaped block in this file.
  const pem = (label: string) => `-----${'BEGIN'} ${label}-----`;
  const key = ['PRIVATE', 'KEY'].join(' ');
  const head = (text: string) => new TextEncoder().encode(text);
  for (const first of [pem(key), pem(`RSA ${key}`), pem(`OPENSSH ${key}`), pem(`ENCRYPTED ${key}`), `\uFEFF\n${pem(`EC ${key}`)}`, 'PuTTY-User-Key-File-3: ssh-ed25519']) {
    assert.ok(hasPrivateKeyHead(head(`${first}\nINVENTED`)), first);
  }
  for (const first of [pem('PUBLIC KEY'), pem('CERTIFICATE'), `Notes on the ${key}-----`, '']) assert.ok(!hasPrivateKeyHead(head(first)), first);
  const f = await fixture();
  try {
    // Named like a Keynote file, which is how it slipped through.
    await writeFile(path.join(f.root, 'Folder A', 'server.key'), `${pem(key)}\nINVENTEDNOTAKEY\n`);
    await writeFile(path.join(f.root, 'Folder A', 'server.pub'), `${pem('PUBLIC KEY')}\nINVENTED\n`);
    assert.deepEqual(await abortReasons(f.root), [['private-key', 'Folder A/server.key']]);
  } finally {
    await f.done();
  }
});

test('Finder alias files abort: bookmark magic bytes', async () => {
  const f = await fixture();
  try {
    const magic = Buffer.concat([Buffer.from('book'), Buffer.alloc(4), Buffer.from('mark'), Buffer.from('rest of bookmark')]);
    await writeFile(path.join(f.root, 'Folder A', 'Alias to private'), magic);
    assert.deepEqual(await abortReasons(f.root), [['alias', 'Folder A/Alias to private']]);
  } finally {
    await f.done();
  }
});

test('Finder alias files abort: FinderInfo alias flag (real xattr)', { skip: !MAC && 'xattr is macOS only' }, async () => {
  const f = await fixture();
  try {
    const file = path.join(f.root, 'old-style alias');
    await writeFile(file, '');
    const finderInfo = '0000000000000000' + '8000' + '0'.repeat(44);
    execFileSync('/usr/bin/xattr', ['-wx', 'com.apple.FinderInfo', finderInfo, file]);
    assert.deepEqual(await abortReasons(f.root, readFinderInfo), [['alias', 'old-style alias']]);
  } finally {
    await f.done();
  }
});

test('the real FinderInfo reader returns null for ordinary files', async () => {
  const f = await fixture();
  try {
    assert.equal(await readFinderInfo(path.join(f.root, 'CLAUDE.md')), null);
    const result = await guardWalk(f.root);
    assert.equal(result.files.length, 2);
  } finally {
    await f.done();
  }
});

test('a private folder in mixed case aborts and is never entered', async () => {
  const f = await fixture();
  try {
    const inner = path.join(f.root, 'Folder A', '_Private-Do-Not-Share');
    await mkdir(inner);
    // If the walk entered this folder it would also report the symlink.
    await symlink(f.privateDir, path.join(inner, 'link'));
    assert.deepEqual(await abortReasons(f.root), [['private', 'Folder A/_Private-Do-Not-Share']]);
  } finally {
    await f.done();
  }
});

test('private files are caught too, including copies and compatibility forms', async () => {
  const f = await fixture();
  try {
    await writeFile(path.join(f.root, '_PRIVATE notes.md'), 'x');
    await writeFile(path.join(f.root, 'Copy of _private.pdf'), 'x');
    await writeFile(path.join(f.root, '＿PRIVATE wide.txt'), 'x');
    const reasons = await abortReasons(f.root);
    assert.equal(reasons.length, 3);
    assert.ok(reasons.every(([reason]) => reason === 'private'));
  } finally {
    await f.done();
  }
});

test('NFD names are walked and reported as NFC', async () => {
  const f = await fixture();
  try {
    const nfd = 'Résumé.pdf';
    await writeFile(path.join(f.root, nfd), 'x');
    const result = await guardWalk(f.root, noFinderInfo);
    const rels = result.files.map((file) => file.rel);
    assert.ok(rels.includes('Résumé.pdf'));
    assert.ok(rels.every((rel) => rel === rel.normalize('NFC')));
  } finally {
    await f.done();
  }
});

test('an NFD private name is still private', () => {
  // "_PRIVATE" with a decomposed accent elsewhere in the name, as macOS delivers it.
  assert.equal(isPrivateSegment('_PRIVATE-Vérifié'), true);
  assert.equal(isPrivateSegment('_pRiVaTe'), true);
  assert.equal(isPrivateSegment('Privileged'), false);
  assert.equal(isPrivateSegment('private-ish'), false);
});

test('lock files, placeholders and dotfiles are skipped, and dot folders are not entered', async () => {
  const f = await fixture();
  try {
    const names = ['~$brief.docx', 'Icon\r', 'big.pdf.icloud', '.DS_Store', '._brief.pdf', '.~lock.sheet.ods#', '.brief.pdf.icloud'];
    for (const name of names) await writeFile(path.join(f.root, name), 'x');
    await mkdir(path.join(f.root, '.git'));
    await writeFile(path.join(f.root, '.git', 'config'), 'x');
    const result = await guardWalk(f.root, noFinderInfo);
    assert.deepEqual(result.files.map((file) => file.rel), ['CLAUDE.md', 'Folder A/brief.pdf']);
    assert.deepEqual(result.skipped, { dotfile: 5, 'lock-or-placeholder': 3 });
  } finally {
    await f.done();
  }
});

test('bundle directories abort instead of being mirrored file by file', async () => {
  const f = await fixture();
  try {
    await mkdir(path.join(f.root, 'Notes.rtfd', 'Data'), { recursive: true });
    await mkdir(path.join(f.root, 'Folder A', 'Tool.APP'), { recursive: true });
    // A plain folder only named like a Numbers document: dropping it with advice about Numbers would be wrong.
    await mkdir(path.join(f.root, 'Exhibits.numbers'));
    await writeFile(path.join(f.root, 'Exhibits.numbers', 'exhibit-a.pdf'), 'x');
    // An empty Index isn't a document, and must not leave a real file beside it unsynced.
    await mkdir(path.join(f.root, 'Spoof.key', 'Index'), { recursive: true });
    await writeFile(path.join(f.root, 'Spoof.key', 'a.pdf'), 'x');
    assert.deepEqual(await abortReasons(f.root), [
      ['bundle', 'Exhibits.numbers'],
      ['bundle', 'Folder A/Tool.APP'],
      ['bundle', 'Notes.rtfd'],
      ['bundle', 'Spoof.key'],
    ]);
  } finally {
    await f.done();
  }
});

test('a Pages, Numbers or Keynote document saved as a folder is listed with the fix and stops nothing', async () => {
  const f = await fixture();
  try {
    await mkdir(path.join(f.root, 'Deck.key', 'Index'), { recursive: true });
    await writeFile(path.join(f.root, 'Deck.key', 'Index', 'Document.iwa'), 'inside');
    await mkdir(path.join(f.root, 'Folder A', 'Report.PAGES'), { recursive: true });
    await writeFile(path.join(f.root, 'Folder A', 'Report.PAGES', 'Index.zip'), 'inside');
    await writeFile(path.join(f.root, 'keep.txt'), 'kept');
    const walk = await guardWalk(f.root);
    assert.deepEqual(walk.iworkPackages, ['Deck.key', 'Folder A/Report.PAGES']);
    assert.ok(!walk.files.some((file) => /Deck\.key|Report\.PAGES/.test(file.rel)), 'nothing inside one is mirrored');
    assert.ok(walk.files.some((file) => file.rel === 'keep.txt'), 'the rest of the folder still syncs');
    const input = {
      plan: { adds: [], changes: [], renames: [], removals: [], unchanged: [], held: [] }, files: [], skipped: walk.skipped, iworkPackages: walk.iworkPackages,
      target: 'local', pendingPulls: 0, toIndex: { direct: 0, extracted: 0 }, extractor: 'ready', summary: false,
    };
    assert.match(formatReport(input), /Not synced: 2 saved as a folder, so any already in the room stay at their last synced version\. In the app, choose File > Advanced > Change File Type > Single File\.\n {2}Deck\.key\n {2}Folder A\/Report\.PAGES/);
    const summary = formatReport({ ...input, summary: true });
    assert.match(summary, /Not synced: 2/);
    assert.doesNotMatch(summary, /Deck\.key/, 'paths are case data: --summary keeps to counts');
    // The SSA's voided sample number, joined at run time.
    const number = ['078', '05', '1120'].join('-');
    assert.ok(!formatReport({ ...input, iworkPackages: [`${number} Plan.pages`] }).includes(number), 'a path holding an SSN prints masked, as in the table');
  } finally {
    await f.done();
  }
});

test('a room document re-saved as a folder keeps its file, its id and its search text', () => {
  const row = { id: 'doc-1', path: 'Folder A/Plan.pages', sha256: 'a'.repeat(64), size: 1, kind: 'file', pages: null, r2_key: 'key-1', source: 'mirror' };
  const plan = diffSync<SnapshotFile>([], [row], undefined, undefined, ['Folder A/Plan.pages']);
  assert.deepEqual(plan.removals, [], 'a removal would delete its file and bring it back under a new id');
  assert.deepEqual(plan.held, [row]);
  assert.deepEqual(indexWork(plan, { 'doc-1': { sha256: row.sha256, parts: 2 } }).drops, [], 'its index parts stay');
  assert.deepEqual(diffSync([], [row]).removals, [row], 'a document that is really gone is still removed');
});

test('control characters and special files abort', async () => {
  const f = await fixture();
  try {
    await writeFile(path.join(f.root, 'bad\nname.txt'), 'x');
    execFileSync('/usr/bin/mkfifo', [path.join(f.root, 'pipe')]);
    assert.deepEqual(await abortReasons(f.root), [
      ['control-character', 'bad\nname.txt'],
      ['special-file', 'pipe'],
    ]);
  } finally {
    await f.done();
  }
});

test('the root itself must be a real, non-private directory', async () => {
  const f = await fixture();
  try {
    assert.deepEqual(await abortReasons(f.privateDir), [['private', '.']]);
    const linked = path.join(f.parent, 'linked-root');
    await symlink(f.root, linked);
    assert.deepEqual(await abortReasons(linked), [['symlink', '.']]);
    assert.deepEqual(await abortReasons(path.join(f.parent, 'missing')), [['unreadable', '.']]);
  } finally {
    await f.done();
  }
});

test('rule helpers', () => {
  assert.equal(skipReason('CLAUDE.md'), null);
  assert.equal(skipReason('.DS_Store'), 'dotfile');
  assert.equal(skipReason('~$x.xlsx'), 'lock-or-placeholder');
  assert.equal(skipReason('Notes.ICLOUD'), 'lock-or-placeholder');
  assert.equal(isBundleName('Deck.numbers'), true);
  assert.equal(isBundleName('numbers.pdf'), false);
  assert.equal(isBundleName('no-extension'), false);
  assert.equal(hasAliasMagic(Buffer.from('book\0\0\0\0mark')), true);
  assert.equal(hasAliasMagic(Buffer.from('book\0\0\0\u0001mark')), false);
  assert.equal(hasAliasMagic(Buffer.from('%PDF-1.7')), false);
  assert.equal(hasAliasFlag(null), false);
  assert.equal(hasAliasFlag(Buffer.from('0000000000000000' + '0400' + '0'.repeat(44), 'hex')), false);
  assert.equal(hasAliasFlag(Buffer.from('0000000000000000' + '8400' + '0'.repeat(44), 'hex')), true);
});
