// SPDX-License-Identifier: Apache-2.0
// The sync guard. It walks the source folder and decides what may leave the Mac.
//
// Anything that could pull in content from outside the curated folder ABORTS the whole run: a private
// segment, a symlink or junction, a hard link, a Finder alias or Windows shortcut, a bundle directory, a path that
// resolves outside the root, a special file, a name with control characters, or a file that opens as a private key
// (PEM, OpenSSH or PuTTY, whatever it is named: `server.key` reads as Keynote by its name). Every violation is collected before aborting so
// the owner can fix them in one pass. The walk never follows links and never descends into a private or
// skipped directory, so nothing outside the curated tree is ever opened. A Pages, Numbers or Keynote document saved as a
// folder is the one bundle that doesn't abort: it isn't synced, and is listed so its owner can save it as a single file.
//
// Harmless clutter is SKIPPED: dotfiles (.DS_Store, AppleDouble ._ files, .~lock, iCloud stubs), Office
// lock and temporary files (~$*, ~*.tmp), Finder's Icon\r, Explorer's desktop.ini and thumbnail caches, and *.icloud
// placeholders. Each folder's CLAUDE.md is kept: it is the folder guide for counsel.
import { execFile } from 'node:child_process';
import type { Stats } from 'node:fs';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';

export type SkipReason = 'dotfile' | 'lock-or-placeholder';

export type AbortReason =
  | 'private'
  | 'symlink'
  | 'hard-link'
  | 'alias'
  | 'bundle'
  | 'outside-root'
  | 'special-file'
  | 'control-character'
  | 'private-key'
  | 'duplicate-path'
  | 'unreadable';

export interface Violation {
  reason: AbortReason;
  /** Path relative to the source root, NFC, '/'-separated ('.' for the root itself). */
  rel: string;
}

export interface WalkedFile {
  /** Path relative to the source root, NFC, '/'-separated. This is documents.path. */
  rel: string;
  /** On-disk path exactly as readdir returned it (macOS names may be NFD). */
  abs: string;
  size: number;
  mtimeMs: number;
  dev: number;
  ino: number;
}

export interface WalkResult {
  root: string;
  files: WalkedFile[];
  skipped: Record<SkipReason, number>;
  /** Files that take up no space here: iCloud Drive or OneDrive holds them in the cloud, and reading them downloads them. */
  placeholders: number;
  /** Files older macOS has evicted to iCloud, by the path they'd have: a stub stands in for each, so the walk has no file. */
  evicted: string[];
  /** Pages, Numbers and Keynote documents saved as folders, not synced. One already in the room stays as it is. */
  iworkPackages: string[];
}

export class GuardAbort extends Error {
  readonly violations: Violation[];
  constructor(violations: Violation[]) {
    super(`Sync guard aborted the run (${violations.length} problem${violations.length === 1 ? '' : 's'}). Nothing was synced.`);
    this.violations = violations;
  }
}

/** Reads the com.apple.FinderInfo xattr (32 bytes) or null when it is absent. Injectable for tests. */
export type FinderInfoReader = (file: string) => Promise<Buffer | null>;

/** The stub older macOS leaves for an evicted file: `.Minutes.pdf.icloud` stands for `Minutes.pdf`. */
const ICLOUD_STUB = /^\.(.+)\.icloud$/i;
const PRIVATE_MARK = '_private';
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
// Directory packages that Finder shows as one document. Mirroring their insides file by file would be wrong.
const BUNDLE_EXTENSIONS = new Set([
  'key', 'pages', 'numbers', 'rtfd', 'app', 'bundle', 'pkg', 'mpkg', 'framework', 'plugin', 'kext',
  'photoslibrary', 'musiclibrary', 'imovielibrary', 'fcpbundle', 'logicx', 'band', 'scptd', 'xcodeproj',
  'xcworkspace', 'playground', 'sparsebundle', 'workflow', 'textbundle', 'graffle', 'pxm', 'abbu',
]);
const IWORK_PACKAGE = /\.(?:pages|numbers|key)$/i;
// A bookmark-based Finder alias starts with "book", four zero bytes, then "mark".
const ALIAS_MAGIC_LENGTH = 12;
// FinderInfo fdFlags live at bytes 8-9 (big-endian); kIsAlias is 0x8000.
const FINDER_FLAGS_OFFSET = 8;
const FINDER_IS_ALIAS = 0x8000;
// A Windows shortcut (.lnk) starts with its header's size, 0x4C, and the start of its class id ([MS-SHLLINK]).
const SHORTCUT_MAGIC = [0x4c, 0x00, 0x00, 0x00, 0x01, 0x14, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00];
/** Bytes read from each file's start: enough for the longest key header below. */
const HEAD_BYTES = 64;
/** A private key's first line, after an optional byte order mark and blank space. A public key or certificate doesn't match. */
const PRIVATE_KEY_HEAD = /^(?:\uFEFF)?\s*(?:-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----|PuTTY-User-Key-File-)/;
// Explorer's own files. Lowercase.
const EXPLORER_FILES = new Set(['desktop.ini', 'thumbs.db', 'ehthumbs.db', 'ehthumbs_vista.db']);

/**
 * True when a path segment is private: after NFC (and NFKC) normalization and case-folding it equals,
 * starts with or contains "_private". Containing is stricter than the plan's "starts with" on purpose:
 * "Copy of _PRIVATE-..." must not slip through.
 */
export function isPrivateSegment(name: string): boolean {
  return ['NFC', 'NFKC'].some((form) => name.normalize(form).toLowerCase().includes(PRIVATE_MARK));
}

/** Why a name is skipped, or null when it is kept. */
export function skipReason(name: string): SkipReason | null {
  if (name.startsWith('.')) return 'dotfile';
  const lower = name.toLowerCase();
  if (name.startsWith('~$') || name === 'Icon\r' || lower.endsWith('.icloud')) return 'lock-or-placeholder';
  if (EXPLORER_FILES.has(lower) || (name.startsWith('~') && lower.endsWith('.tmp'))) return 'lock-or-placeholder';
  return null;
}

export function isBundleName(name: string): boolean {
  const ext = path.extname(name).slice(1).normalize('NFC').toLowerCase();
  return ext !== '' && BUNDLE_EXTENSIONS.has(ext);
}

/** A real package holds its document's parts. A plain folder that is only named like one is an ordinary bundle, which aborts. */
async function holdsDocumentParts(dir: string): Promise<boolean> {
  const isFile = (file: string) => lstat(file).then((stats) => stats.isFile(), () => false);
  return (await isFile(path.join(dir, 'Index', 'Document.iwa'))) || isFile(path.join(dir, 'Index.zip'));
}

export function hasAliasMagic(head: Uint8Array): boolean {
  if (head.length < ALIAS_MAGIC_LENGTH) return false;
  const text = (from: number) => String.fromCharCode(head[from], head[from + 1], head[from + 2], head[from + 3]);
  const zeros = head[4] === 0 && head[5] === 0 && head[6] === 0 && head[7] === 0;
  return text(0) === 'book' && zeros && text(8) === 'mark';
}

/** True for a Windows shortcut, whatever it is named. Like an alias, it points somewhere outside the folder. */
export function hasShortcutMagic(head: Uint8Array): boolean {
  return head.length >= SHORTCUT_MAGIC.length && SHORTCUT_MAGIC.every((byte, i) => head[i] === byte);
}

/** True for a private key, whatever it is named: it never leaves the computer unless its owner moves it out of the folder. */
export function hasPrivateKeyHead(head: Uint8Array): boolean {
  return PRIVATE_KEY_HEAD.test(new TextDecoder().decode(head));
}

export function hasAliasFlag(finderInfo: Uint8Array | null): boolean {
  if (!finderInfo || finderInfo.length < FINDER_FLAGS_OFFSET + 2) return false;
  const flags = (finderInfo[FINDER_FLAGS_OFFSET] << 8) | finderInfo[FINDER_FLAGS_OFFSET + 1];
  return (flags & FINDER_IS_ALIAS) !== 0;
}

/** Default FinderInfo reader: `xattr -px com.apple.FinderInfo` (exits non-zero when the xattr is absent). macOS only. */
export const readFinderInfo: FinderInfoReader = (file) =>
  new Promise((resolve) => {
    if (process.platform !== 'darwin') return resolve(null);
    execFile('/usr/bin/xattr', ['-px', 'com.apple.FinderInfo', file], (error, stdout) => {
      if (error) return resolve(null);
      const hex = stdout.replace(/\s+/g, '');
      resolve(/^[0-9a-fA-F]*$/.test(hex) && hex.length > 0 ? Buffer.from(hex, 'hex') : null);
    });
  });

async function readHead(file: string): Promise<Uint8Array> {
  const handle = await open(file, 'r');
  try {
    const buffer = new Uint8Array(HEAD_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, HEAD_BYTES, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function isInside(real: string, realRoot: string): boolean {
  return real.startsWith(realRoot.endsWith(path.sep) ? realRoot : realRoot + path.sep);
}

interface WalkState {
  realRoot: string;
  files: WalkedFile[];
  violations: Violation[];
  skipped: Record<SkipReason, number>;
  evicted: string[];
  iworkPackages: string[];
  seen: Set<string>;
  finderInfo: FinderInfoReader;
  placeholders: number;
}

async function checkFile(state: WalkState, abs: string, rel: string, stats: Stats): Promise<void> {
  const flag = (reason: AbortReason): void => {
    state.violations.push({ reason, rel });
  };
  if (stats.nlink > 1) return flag('hard-link');
  // `stats` came before the read below, which downloads a file held in the cloud.
  if (stats.size > 0 && stats.blocks === 0) state.placeholders += 1;
  const head = await readHead(abs);
  if (hasAliasMagic(head) || hasShortcutMagic(head) || hasAliasFlag(await state.finderInfo(abs))) return flag('alias');
  if (!isInside(await realpath(abs), state.realRoot)) return flag('outside-root');
  if (hasPrivateKeyHead(head)) return flag('private-key');
  const folded = rel.toLowerCase();
  if (state.seen.has(folded)) return flag('duplicate-path');
  state.seen.add(folded);
  state.files.push({ rel, abs, size: stats.size, mtimeMs: stats.mtimeMs, dev: stats.dev, ino: stats.ino });
}

async function walkDir(state: WalkState, absDir: string, relDir: string): Promise<void> {
  let names: string[];
  try {
    names = await readdir(absDir);
  } catch {
    state.violations.push({ reason: 'unreadable', rel: relDir || '.' });
    return;
  }
  names.sort();
  for (const name of names) {
    const rel = (relDir ? `${relDir}/${name}` : name).normalize('NFC');
    const flag = (reason: AbortReason) => state.violations.push({ reason, rel });
    // The private check comes first: a private entry is never stat'ed, opened or entered.
    if (isPrivateSegment(name)) {
      flag('private');
      continue;
    }
    const abs = path.join(absDir, name);
    const stats = await lstat(abs).catch(() => null);
    if (!stats) {
      flag('unreadable');
      continue;
    }
    if (stats.isSymbolicLink()) {
      flag('symlink');
      continue;
    }
    const skip = skipReason(name);
    if (skip) {
      state.skipped[skip] += 1;
      const evicted = ICLOUD_STUB.exec(name)?.[1];
      if (evicted) state.evicted.push((relDir ? `${relDir}/${evicted}` : evicted).normalize('NFC'));
      continue;
    }
    if (CONTROL.test(name)) {
      flag('control-character');
      continue;
    }
    if (stats.isDirectory()) {
      if (IWORK_PACKAGE.test(name) && (await holdsDocumentParts(abs))) state.iworkPackages.push(rel);
      else if (isBundleName(name)) flag('bundle');
      else if (!isInside(await realpath(abs).catch(() => ''), state.realRoot)) flag('outside-root');
      else await walkDir(state, abs, rel);
    } else if (stats.isFile()) {
      await checkFile(state, abs, rel, stats).catch(() => flag('unreadable'));
    } else {
      flag('special-file');
    }
  }
}

/**
 * Walks `root` and returns every file that may be mirrored, sorted by path. Throws GuardAbort listing every
 * violation when anything is wrong. The root itself must be a real directory with no private segment.
 */
export async function guardWalk(root: string, finderInfo: FinderInfoReader = readFinderInfo): Promise<WalkResult> {
  const absRoot = path.resolve(root);
  const rootViolations: Violation[] = [];
  if (absRoot.split(path.sep).some((segment) => segment !== '' && isPrivateSegment(segment))) {
    rootViolations.push({ reason: 'private', rel: '.' });
  }
  const rootStats = await lstat(absRoot).catch(() => null);
  if (!rootStats) rootViolations.push({ reason: 'unreadable', rel: '.' });
  else if (rootStats.isSymbolicLink()) rootViolations.push({ reason: 'symlink', rel: '.' });
  else if (!rootStats.isDirectory()) rootViolations.push({ reason: 'special-file', rel: '.' });
  if (rootViolations.length > 0) throw new GuardAbort(rootViolations);

  const state: WalkState = {
    realRoot: await realpath(absRoot),
    files: [],
    violations: [],
    skipped: { dotfile: 0, 'lock-or-placeholder': 0 },
    evicted: [],
    iworkPackages: [],
    seen: new Set(),
    finderInfo,
    placeholders: 0,
  };
  await walkDir(state, absRoot, '');
  if (state.violations.length > 0) throw new GuardAbort(state.violations);
  state.files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  return { root: absRoot, files: state.files, skipped: state.skipped, placeholders: state.placeholders, evicted: state.evicted, iworkPackages: state.iworkPackages.sort() };
}
