// SPDX-License-Identifier: Apache-2.0
// The sync engine on a founder's computer that isn't a Mac: the Windows runner runs this (CI's sync-windows job), and so
// does every other computer, because what it covers must hold on each. A folder of invented files goes through the real
// guard, snapshot, diff, SSN guard and apply, with Cloudflare faked at the Wrangler interface as in apply.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, realpathSync } from 'node:fs';
import { copyFile, link, lstat, mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { applyPlan } from './apply.ts';
import { defaultCacheDir, parseSyncConfig, resolveConfigPath } from './config.ts';
import { zipStored } from './dev-pdf.ts';
import { diffSync } from './diff.ts';
import { directTextPages } from './extract.ts';
import { GuardAbort, guardWalk, hasShortcutMagic, skipReason } from './guard.ts';
import { indexWork, loadManifest } from './indexjob.ts';
import { markOfTheWeb, placeExclusively, pullCounselUploads, sanitizeFilename, setQuarantine, ZONE_IDENTIFIER } from './pull.ts';
import { piiGate, piiTargets, scanForPii } from './pii-scan.ts';
import { CLONES_ARE_FREE, createSnapshot, fillSnapshot, platformClone, verifyOriginals, MidSyncChange } from './snapshot.ts';
import { PENDING_PULLS_SQL } from './sqlplan.ts';
import { filesToRead, guardTexts, parseSyncArgs } from './sync.ts';
import { wranglerCommand, type Wrangler } from './wrangler.ts';

const WINDOWS = process.platform === 'win32';
/** A shell link's header, from [MS-SHLLINK], and a bit more. */
const SHORTCUT = Buffer.from([0x4c, 0, 0, 0, 0x01, 0x14, 0x02, 0, 0, 0, 0, 0, 0xc0, 0, 0, 0, 0, 0, 0, 0x46, 1, 2, 3]);

const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const docx = (text: string) =>
  zipStored([
    { name: '[Content_Types].xml', data: Buffer.from('<Types><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>') },
    { name: 'word/document.xml', data: Buffer.from(`<w:document xmlns:w="${WORD_NS}"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`) },
  ]);

async function inTemp<T>(work: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), 'legallas-sync-win-'));
  try {
    return await work(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** A fake room, as apply.test.ts has it. */
function fakeRoom(pending: Record<string, unknown>[] = []) {
  const calls: string[] = [];
  const sql: string[] = [];
  const room: Wrangler = {
    target: 'remote',
    async d1Query(query) {
      return query === PENDING_PULLS_SQL ? pending : [];
    },
    async d1File(file) {
      sql.push(await readFile(file, 'utf8'));
    },
    async r2Put(bucket, key) {
      calls.push(`put ${bucket}/${key}`);
    },
    async r2Get(_bucket, _key, file) {
      await writeFile(file, 'from counsel');
    },
    async r2Delete(bucket, key) {
      calls.push(`delete ${bucket}/${key}`);
    },
    async aiSearchJobsAvailable() {
      return false;
    },
    async aiSearchJobCreate() {},
  };
  return { room, calls, sql };
}

test('a shortcut stops the run like an alias, whatever it is named, and a link or a junction does too', async () => {
  await inTemp(async (dir) => {
    const root = path.join(dir, 'Company');
    await mkdir(root);
    await writeFile(path.join(root, 'plain.pdf'), '%PDF-1.7 invented');
    assert.equal(hasShortcutMagic(SHORTCUT), true);
    assert.equal(hasShortcutMagic(Buffer.from('%PDF-1.7 invented text')), false);

    await writeFile(path.join(root, 'Financials.lnk'), SHORTCUT);
    await assert.rejects(guardWalk(root), (error: unknown) => {
      assert.ok(error instanceof GuardAbort);
      assert.deepEqual(error.violations, [{ reason: 'alias', rel: 'Financials.lnk' }]);
      return true;
    });
    await rm(path.join(root, 'Financials.lnk'));

    await writeFile(path.join(dir, 'outside.pdf'), 'outside');
    await link(path.join(dir, 'outside.pdf'), path.join(root, 'hard.pdf'));
    await assert.rejects(guardWalk(root), (error: GuardAbort) => error.violations.some((v) => v.reason === 'hard-link'));
    await rm(path.join(root, 'hard.pdf'));

    await mkdir(path.join(dir, 'outside'));
    // A junction needs no privilege on Windows, and elsewhere this is a plain symbolic link.
    await symlink(path.join(dir, 'outside'), path.join(root, 'linked'), WINDOWS ? 'junction' : 'dir');
    await assert.rejects(guardWalk(root), (error: GuardAbort) => error.violations.some((v) => v.reason === 'symlink'));
  });
});

test('what Explorer and Office leave in a folder is skipped, and a real document is not', () => {
  for (const name of ['desktop.ini', 'Desktop.ini', 'Thumbs.db', 'ehthumbs.db', '~$Offer.docx', '~WRD0001.tmp', 'Notes.icloud']) {
    assert.equal(skipReason(name), 'lock-or-placeholder', name);
  }
  for (const name of ['Offer.docx', 'tmp.pdf', 'Thumbs.db.pdf', '~notes.pdf', 'budget.tmp']) assert.equal(skipReason(name), null, name);
});

test('a file with no space here counts as held in the cloud, and nothing else does', async () => {
  await inTemp(async (dir) => {
    const root = path.join(dir, 'Company');
    await mkdir(root);
    await writeFile(path.join(root, 'here.txt'), 'x'.repeat(10_000));
    const walked = await guardWalk(root);
    const here = await stat(path.join(root, 'here.txt'));
    // A placeholder shows as a file with no blocks, so this count needs the platform to report them.
    assert.equal(typeof here.blocks, 'number');
    assert.equal(walked.placeholders, here.blocks === 0 ? 1 : 0);
    await writeFile(path.join(root, 'sparse.bin'), '');
    await truncate(path.join(root, 'sparse.bin'), 1024 * 1024);
    const expected = (await stat(path.join(root, 'sparse.bin'))).blocks === 0 ? 1 : 0;
    assert.equal((await guardWalk(root)).placeholders, expected + walked.placeholders);
  });
});

test('a name counsel chose becomes one Windows and OneDrive take', () => {
  const on = (name: string) => sanitizeFilename(name, new Set(), 'win32');
  assert.equal(on('Letter: "final" <v2>?.pdf'), 'Letter_ _final_ _v2__.pdf');
  assert.equal(on('a|b*c.pdf'), 'a_b_c.pdf');
  assert.equal(on('CON'), '_CON');
  assert.equal(on('nul.pdf'), '_nul.pdf');
  assert.equal(on('COM1.docx'), '_COM1.docx');
  for (const name of ['aux.pdf', 'PRN', 'lpt1.txt']) assert.equal(on(name), `_${name}`);
  assert.doesNotMatch(on('a b '.repeat(100)), /[\s.]$/, 'cut short, a name still ends where Windows keeps it');
  assert.equal(on('console.pdf'), 'console.pdf');
  assert.equal(on('trailing dots. . '), 'trailing dots');
  // A Mac keeps today's names.
  assert.equal(sanitizeFilename('Letter "final"?.pdf', new Set(), 'darwin'), 'Letter "final"?.pdf');
});

test('the cache goes in this computer\'s own place, and a path can start with either separator', () => {
  assert.equal(defaultCacheDir('win32', { LOCALAPPDATA: 'C:\\Users\\Founder\\AppData\\Local' }, 'C:\\Users\\Founder'), 'C:\\Users\\Founder\\AppData\\Local\\legallas-sync');
  assert.equal(defaultCacheDir('win32', {}, 'C:\\Users\\Founder'), 'C:\\Users\\Founder\\AppData\\Local\\legallas-sync');
  assert.equal(defaultCacheDir('darwin', {}, '/Users/founder'), path.posix.join('/Users/founder', 'Library', 'Caches', 'legallas-sync'));
  assert.equal(defaultCacheDir('linux', { XDG_CACHE_HOME: '/x' }, '/home/f'), path.posix.join('/x', 'legallas-sync'));
  assert.equal(defaultCacheDir('linux', {}, '/home/f'), path.posix.join('/home/f', '.cache', 'legallas-sync'));
  assert.equal(defaultCacheDir('linux', { XDG_CACHE_HOME: 'relative' }, '/home/f'), path.posix.join('/home/f', '.cache', 'legallas-sync'));
  assert.equal(defaultCacheDir('win32', { LOCALAPPDATA: 'relative' }, 'C:\\Users\\Founder'), 'C:\\Users\\Founder\\AppData\\Local\\legallas-sync');
  const home = path.resolve('home-of-founder');
  assert.equal(resolveConfigPath('~\\cache', 'cacheDir', home), path.join(home, 'cache'));
  const left = parseSyncConfig({ sourceRoot: path.resolve('a', 'Company'), inboxDir: path.resolve('a', 'inbox') }, home);
  assert.equal(left.cacheDir, defaultCacheDir(process.platform, process.env, home));
});

test('the cache and inbox stay out of the folder, whatever letter case, link or name leads there', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'legallas-inside-'));
  try {
    const root = path.join(dir, 'Company');
    await mkdir(path.join(root, 'Founders'), { recursive: true });
    const withInbox = (inboxDir: string) => parseSyncConfig({ sourceRoot: root, inboxDir, cacheDir: path.join(dir, 'cache') });
    const outside = /inboxDir must be outside sourceRoot/;

    assert.equal(withInbox(path.join(dir, 'From counsel')).inboxDir, path.join(dir, 'From counsel'));
    assert.throws(() => withInbox(path.join(root, 'inbox')), outside);
    assert.throws(() => withInbox(path.join(root, '..inbox')), outside);

    await symlink(path.join(root, 'Founders'), path.join(dir, 'looks elsewhere'), 'junction');
    assert.throws(() => withInbox(path.join(dir, 'looks elsewhere')), outside);
    assert.throws(() => withInbox(path.join(dir, 'looks elsewhere', 'not made yet', 'inbox')), outside);

    // Only where the disk treats these as one folder, as macOS and Windows do by default.
    const shouted = path.join(dir, 'COMPANY');
    if (existsSync(shouted)) assert.throws(() => withInbox(path.join(shouted, 'inbox')), outside);

    // macOS reaches every folder through this path too, and no link says so. On other computers this path doesn't exist.
    const firm = path.join('/System/Volumes/Data', realpathSync(root));
    if (existsSync(firm)) assert.throws(() => withInbox(path.join(firm, 'inbox')), outside);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the guard reads a document staying in the room, where clones cost something and no other step reads it', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'legallas-unread-'));
  try {
    const root = path.join(dir, 'Company');
    const cache = path.join(dir, 'cache');
    await mkdir(root);
    await writeFile(path.join(root, 'clean.md'), '# Invented notes');
    // The SSA's voided sample number, joined at run time.
    await writeFile(path.join(root, 'number.md'), `Founder: ${['078', '05', '1120'].join('-')}`);
    await copyFile(path.resolve(import.meta.dirname, '..', 'fixtures', 'iwork', 'notes.pages'), path.join(root, 'notes.pages'));
    await writeFile(path.join(root, 'clip.mp4'), 'an invented video');
    const snapshot = await createSnapshot((await guardWalk(root)).files, cache, 'r1', platformClone, true);
    const rows = snapshot.files.map((file) => ({ id: `id-${file.rel}`, path: file.rel, sha256: file.sha256, size: file.size, kind: 'text', pages: null, r2_key: `key-${file.rel}`, source: 'mirror' }));
    const plan = diffSync(snapshot.files, rows);
    assert.equal(plan.unchanged.length, 4);
    assert.deepEqual(filesToRead(plan, []), []);

    const raw = { sourceRoot: root, inboxDir: path.join(dir, 'From counsel'), cacheDir: cache };
    await writeFile(path.join(dir, 'room.config.json'), JSON.stringify(raw));
    const options = parseSyncArgs(['--config', path.join(dir, 'room.config.json')]);
    const { gate } = await guardTexts(snapshot, plan, [], parseSyncConfig(raw), options, 'remote', 'r1', () => undefined);
    // Unread, both would be open as failed reads. Read, only the file with a number is.
    assert.deepEqual(gate.open.map((doc) => doc.path), ['number.md']);
    assert.deepEqual(gate.failed, []);
    assert.ok(gate.open[0]!.hits.length > 0);
    // What the guard can't read isn't copied, which on OneDrive would download it for nothing.
    assert.equal(existsSync(snapshot.files.find((file) => file.rel === 'clip.mp4')!.snapshot), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('wrangler starts with no shell, so an argument never meets one', () => {
  assert.deepEqual(wranglerCommand(['d1', 'execute'], 'darwin', false), ['npx', ['wrangler', 'd1', 'execute']]);
  const [command, args] = wranglerCommand(['d1', 'execute'], 'win32');
  assert.equal(command, process.execPath);
  assert.match(args[0]!, /node_modules[\\/]wrangler[\\/]bin[\\/]wrangler\.js$/);
  assert.deepEqual(args.slice(1), ['d1', 'execute']);
});

test('a snapshot where clones cost something copies only what the run will read, and notices a change', async () => {
  await inTemp(async (dir) => {
    const root = path.join(dir, 'Company');
    const cache = path.join(dir, 'cache');
    await mkdir(root);
    await writeFile(path.join(root, 'kept.txt'), 'kept');
    await writeFile(path.join(root, 'new.txt'), 'new');
    const { files } = await guardWalk(root, async () => null);
    const snapshot = await createSnapshot(files, cache, 'r1', platformClone, true);
    assert.equal(snapshot.files.every((file) => file.sha256.length === 64), true);
    assert.deepEqual(await readdir(snapshot.dir), [], 'nothing copied yet');

    const [kept, added] = snapshot.files;
    const rows = [{ id: 'k', path: 'kept.txt', sha256: kept!.sha256, size: 4, kind: 'text', pages: null, r2_key: 'r', source: 'mirror' }];
    const plan = diffSync(snapshot.files, rows);
    assert.deepEqual(plan.adds.map((op) => op.path), ['new.txt']);
    await fillSnapshot(snapshot, filesToRead(plan, []));
    assert.deepEqual(await readdir(snapshot.dir), [path.basename(added!.snapshot)]);
    // What a run reads: everything it uploads or the guard scans, and everything it indexes.
    const renamed = { ...plan, adds: [], renames: [{ file: added! }] } as unknown as typeof plan;
    assert.deepEqual(filesToRead(renamed, []), [added!.snapshot]);
    assert.deepEqual(filesToRead({ ...plan, adds: [] }, [{ file: kept!.snapshot }] as never), [kept!.snapshot]);
    assert.equal(await readFile(added!.snapshot, 'utf8'), 'new');
    await fillSnapshot(snapshot, filesToRead(plan, []));

    await writeFile(path.join(root, 'kept.txt'), 'changed since the hash');
    await assert.rejects(fillSnapshot(snapshot, [kept!.snapshot]), MidSyncChange);
    await assert.rejects(verifyOriginals(snapshot), MidSyncChange);
  });
});

test('a whole sync: Word files are read and guarded, uploaded and recorded, and counsel\'s upload comes down', async () => {
  await inTemp(async (dir) => {
    const root = path.join(dir, 'OneDrive - Harbor Labs', 'Company Documents');
    const cache = path.join(dir, 'cache');
    await mkdir(path.join(root, 'Founders'), { recursive: true });
    await writeFile(path.join(root, 'Founders', 'Founder Stock Agreement.docx'), docx('Founder stock for Jane Doe.'));
    await writeFile(path.join(root, 'Founders', 'Résumé.rtf'), Buffer.from('{\\rtf1 Jane Doe, founder.\\par}', 'latin1'));
    await writeFile(path.join(root, 'notes.md'), '# Notes\n\nInvented notes.');
    await writeFile(path.join(root, 'desktop.ini'), '[.ShellClassInfo]');
    await writeFile(path.join(root, 'Founders', '~$under Stock Agreement.docx'), 'lock');

    const walk = await guardWalk(root);
    assert.deepEqual(walk.files.map((file) => file.rel), ['Founders/Founder Stock Agreement.docx', 'Founders/Résumé.rtf', 'notes.md']);
    assert.equal(walk.skipped['lock-or-placeholder'], 2);

    const snapshot = await createSnapshot(walk.files, cache, 'r1', platformClone, !CLONES_ARE_FREE);
    const plan = diffSync(snapshot.files, []);
    const work = indexWork(plan, await loadManifest(cache, 'remote'));
    await fillSnapshot(snapshot, filesToRead(plan, work.jobs));

    // The SSN guard reads each file's text as the index will.
    const scan = await scanForPii(piiTargets(plan, work.jobs), { extractPdf: async () => [], readText: directTextPages, known: null });
    assert.equal(scan.flagged.length, 0);
    assert.equal(scan.unscanned.length, 0);
    assert.equal(scan.scanned, 3);
    assert.deepEqual(piiGate(scan, []).open, []);

    const { room, calls, sql } = fakeRoom([{ id: 'c1', name: 'Reply: "signed"?.pdf', r2_key: 'k1' }]);
    const summary = await applyPlan(plan, {
      wrangler: room,
      extractPdf: async () => [],
      readText: directTextPages,
      verifyOriginals: () => verifyOriginals(snapshot),
      workDir: snapshot.dir,
      cacheDir: cache,
      inboxDir: path.join(dir, 'From counsel'),
      now: '2026-11-01T12:00:00.000Z',
      log: () => undefined,
    });
    assert.equal(summary.uploaded, 3);
    assert.equal(calls.filter((call) => call.startsWith('put legallas-files/')).length, 3);
    assert.equal(calls.filter((call) => call.startsWith('put legallas-index/')).length, 3);
    assert.match(sql[0]!, /Founders\/Founder Stock Agreement\.docx/);
    assert.equal(summary.pulled, 1);

    const inbox = await readdir(path.join(dir, 'From counsel'));
    assert.equal(inbox.length, 1);
    assert.equal(await readFile(path.join(dir, 'From counsel', inbox[0]!), 'utf8'), 'from counsel');
    if (WINDOWS) {
      assert.equal(inbox[0], 'Reply_ _signed__.pdf');
      assert.equal(await readFile(path.join(dir, 'From counsel', `${inbox[0]}:Zone.Identifier`), 'utf8'), ZONE_IDENTIFIER);
    }
  });
});

test('a path longer than Windows\'s old limit syncs like any other', async () => {
  await inTemp(async (dir) => {
    const deep = path.join(dir, 'Company', 'a'.repeat(80), 'b'.repeat(80), 'c'.repeat(80), 'd'.repeat(80));
    await mkdir(deep, { recursive: true });
    await writeFile(path.join(deep, 'Deep Agreement.docx'), docx('Deep text.'));
    const root = path.join(dir, 'Company');
    const { files } = await guardWalk(root);
    assert.ok(files[0]!.abs.length > 260);
    const snapshot = await createSnapshot(files, path.join(dir, 'cache'), 'r1', platformClone);
    assert.equal((await lstat(snapshot.files[0]!.snapshot)).isFile(), true);
    await verifyOriginals(snapshot);
  });
});

test('a download is marked as one on this computer', async () => {
  await inTemp(async (dir) => {
    const file = path.join(dir, 'from counsel.pdf');
    await writeFile(file, 'x');
    await setQuarantine(file);
    if (WINDOWS) assert.equal(await readFile(`${file}:Zone.Identifier`, 'utf8'), ZONE_IDENTIFIER);
    assert.equal(await readFile(file, 'utf8'), 'x', 'the file itself is unchanged');
  });
});

test('a volume with no streams has no mark, and still takes the download', async () => {
  const failing = (code: string) => (async () => {
    throw Object.assign(new Error('no streams here'), { code });
  }) as never;
  for (const code of ['ENOENT', 'EINVAL', 'ENOTSUP']) await markOfTheWeb('C:\\inbox\\x.pdf', failing(code));
  // Anything else is a real failure, and that upload is retried next run.
  await assert.rejects(markOfTheWeb('C:\\inbox\\x.pdf', failing('EACCES')), /no streams here/);
});

test('where a folder has no hard links, the copy still never overwrites what is there', async () => {
  await inTemp(async (dir) => {
    const noLinks = (async () => {
      throw Object.assign(new Error('no links here'), { code: 'EPERM' });
    }) as never;
    const partial = path.join(dir, 'partial');
    await writeFile(partial, 'from counsel');
    const taken = path.join(dir, 'memo.pdf');
    await writeFile(taken, 'already here');
    assert.equal(await placeExclusively(partial, taken, noLinks), false);
    assert.equal(await readFile(taken, 'utf8'), 'already here');
    const free = path.join(dir, 'other.pdf');
    assert.equal(await placeExclusively(partial, free, noLinks), true);
    assert.equal(await readFile(free, 'utf8'), 'from counsel');
  });
});

test('pulls never overwrite what is in the inbox', async () => {
  await inTemp(async (dir) => {
    const inbox = path.join(dir, 'inbox');
    await mkdir(inbox);
    await writeFile(path.join(inbox, 'memo.pdf'), 'already here');
    const { room } = fakeRoom([{ id: 'c1', name: 'memo.pdf', r2_key: 'k1' }]);
    const result = await pullCounselUploads(room, inbox, '2026-11-01T12:00:00.000Z', () => undefined, async () => undefined);
    assert.equal(result.pulled, 1);
    assert.deepEqual((await readdir(inbox)).sort(), ['memo (2).pdf', 'memo.pdf']);
    assert.equal(await readFile(path.join(inbox, 'memo.pdf'), 'utf8'), 'already here');
  });
});
