// SPDX-License-Identifier: Apache-2.0
// Pulls counsel uploads down to the computer (inboxDir). Names come from counsel, so they are sanitized and
// de-duplicated, files are never overwritten, and each is marked as a download so the operating system treats it like
// any other: the com.apple.quarantine xattr on macOS (Gatekeeper), the Zone.Identifier stream on Windows (SmartScreen,
// Office's Protected View).
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, link, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PENDING_PULLS_SQL, pulledSql } from './sqlplan.ts';
import { FILES_BUCKET, type Wrangler } from './wrangler.ts';

const MAX_NAME_BYTES = 200;
// C0 and C1 controls, DEL, and bidi overrides that can disguise an extension ("invoice‮fdp.exe").
const UNSAFE = /[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g;
const encoder = new TextEncoder();
// What Windows and OneDrive refuse in a name, and the names Windows keeps for devices, with or without an extension.
const WINDOWS_FORBIDDEN = /[<>"|?*]/g;
const WINDOWS_DEVICE = /^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/i;

function truncateBytes(text: string, max: number): string {
  let out = '';
  for (const char of text) {
    if (encoder.encode(out + char).length > max) break;
    out += char;
  }
  return out;
}

/**
 * A safe filename for the inbox: no path separators (/, \ and the Finder's :), no "..", no control or bidi
 * characters, no leading dots or spaces, at most 200 UTF-8 bytes with the extension kept, and unique
 * case-insensitively against `taken` (APFS is case-insensitive). The chosen name is added to `taken`.
 */
export function sanitizeFilename(raw: string, taken: Set<string>, platform: NodeJS.Platform = process.platform): string {
  const windows = platform === 'win32';
  const clean = raw.normalize('NFC').replace(UNSAFE, '');
  const segments = (windows ? clean.replace(WINDOWS_FORBIDDEN, '_') : clean).split(/[/\\:]/);
  let name = segments.filter((segment) => !/^[\s.]*$/.test(segment)).join('_').replace(/\.{2,}/g, '.');
  name = name.replace(/^[\s.]+/, '').replace(/[\s.]+$/, '');
  if (windows && WINDOWS_DEVICE.test(name)) name = `_${name}`;
  if (!name) name = 'upload';
  const dot = name.lastIndexOf('.');
  let stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? truncateBytes(name.slice(dot), 20) : '';
  stem = truncateBytes(stem, MAX_NAME_BYTES - encoder.encode(ext).length - 8) || 'upload';
  // Cut short, it may end in a space or a dot, which Windows drops, so the name wouldn't be the one chosen.
  if (windows) stem = stem.replace(/[\s.]+$/, '') || 'upload';
  let candidate = `${stem}${ext}`;
  for (let n = 2; taken.has(candidate.toLowerCase()); n += 1) candidate = `${stem} (${n})${ext}`;
  taken.add(candidate.toLowerCase());
  return candidate;
}

/** Quarantine value: flags;hex seconds;agent;uuid. 0081 marks a download that Gatekeeper should check. */
export function quarantineValue(nowMs: number, uuid: string = randomUUID()): string {
  return `0081;${Math.floor(nowMs / 1000).toString(16)};Legallas sync;${uuid.toUpperCase()}`;
}

export type Quarantiner = (file: string) => Promise<void>;

/** The mark of the web: an NTFS stream on the file, as a browser writes for a download. ZoneId 3 is the internet. */
export const ZONE_IDENTIFIER = '[ZoneTransfer]\r\nZoneId=3\r\n';

/** Writes the mark. A volume with no streams, such as exFAT, has nowhere to hold one, and that doesn't stop the download. */
export function markOfTheWeb(file: string, write: typeof writeFile = writeFile): Promise<void> {
  return write(`${file}:Zone.Identifier`, ZONE_IDENTIFIER).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT' && error.code !== 'EINVAL' && error.code !== 'ENOTSUP') throw error;
  });
}

export const setQuarantine: Quarantiner = (file) => {
  if (process.platform === 'win32') return markOfTheWeb(file);
  if (process.platform !== 'darwin') return Promise.resolve();
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/xattr', ['-w', 'com.apple.quarantine', quarantineValue(Date.now()), file], (error) =>
      error ? reject(new Error('Could not set the quarantine xattr')) : resolve(),
    );
  });
};

/**
 * Puts the finished file at its name, never over another: a link where the folder's file system has them, an exclusive
 * copy where it doesn't, such as exFAT. False when the name is taken.
 */
export async function placeExclusively(partial: string, destination: string, linkFile: typeof link = link): Promise<boolean> {
  try {
    await linkFile(partial, destination);
    return true;
  } catch (error) {
    const { code } = error as NodeJS.ErrnoException;
    if (code === 'EEXIST') return false;
    if (code !== 'EPERM' && code !== 'ENOSYS' && code !== 'ENOTSUP' && code !== 'EXDEV') throw error;
  }
  return copyFile(partial, destination, constants.COPYFILE_EXCL).then(() => true, (error: NodeJS.ErrnoException) => {
    if (error.code === 'EEXIST') return false;
    throw error;
  });
}

export interface PullResult {
  pulled: number;
  failed: number;
  /** SQL that marks the pulled rows; empty when nothing was pulled. */
  sql: string;
  /** The pulled rows, for a room that takes them without SQL (room-sync.ts). */
  ids?: string[];
}

interface PendingRow {
  id: string;
  name: string;
  r2_key: string;
}

function asPending(row: Record<string, unknown>): PendingRow | null {
  const { id, name, r2_key: key } = row;
  return typeof id === 'string' && typeof name === 'string' && typeof key === 'string' ? { id, name, r2_key: key } : null;
}

/** Downloads each pending counsel upload into inboxDir. Failures are counted and retried on the next run. */
export async function pullCounselUploads(
  wrangler: Wrangler,
  inboxDir: string,
  now: string,
  log: (line: string) => void,
  quarantine: Quarantiner = setQuarantine,
): Promise<PullResult> {
  const rows = (await wrangler.d1Query(PENDING_PULLS_SQL)).map(asPending).filter((row): row is PendingRow => row !== null);
  if (rows.length === 0) return { pulled: 0, failed: 0, sql: '' };
  await mkdir(inboxDir, { recursive: true, mode: 0o700 });
  const taken = new Set((await readdir(inboxDir)).map((name) => name.normalize('NFC').toLowerCase()));
  const pulled: string[] = [];
  let failed = 0;
  for (const row of rows) {
    const partial = path.join(inboxDir, `.legallas-pull-${randomUUID()}`);
    try {
      await wrangler.r2Get(FILES_BUCKET, row.r2_key, partial);
      await quarantine(partial);
      // A file already in the inbox is never overwritten.
      while (!(await placeExclusively(partial, path.join(inboxDir, sanitizeFilename(row.name, taken))))) {
        // That name came up taken after all: sanitizeFilename has noted it, and gives another.
      }
      pulled.push(row.id);
    } catch (error) {
      failed += 1;
      log(`  pull failed for one upload (${row.id}): ${error instanceof Error ? error.message.split('\n')[0] : 'unknown error'}`);
    } finally {
      await rm(partial, { force: true });
    }
  }
  return { pulled: pulled.length, failed, sql: pulledSql(pulled, now), ids: pulled };
}
