// SPDX-License-Identifier: Apache-2.0
// Saves agreements the owner approved in the room back to the company folder (#65). Each comes down as one new file in
// Drafts/ inside sourceRoot, the way counsel's uploads come down to the inbox (pull.ts), and nothing else in the folder
// is touched: a file is only ever placed where no file is, a taken name gets a new name, and nothing is overwritten,
// renamed, moved or deleted.
//
//   - A draft is written whole to a hidden temporary file first, then placed at its name in one step (pull.ts
//     placeExclusively), so a stopped run never leaves part of a file under a real name.
//   - A name iCloud holds only in the cloud (".X.md.icloud") counts as taken, so a draft never lands on top of one.
//   - A title the guard would refuse or skip (a "_private" segment, a "~$" lock-file name) is saved under a plain name.
//   - The room marks a draft saved only after its file is placed. A draft whose exact bytes are already in Drafts/ is
//     marked without writing again, so a repeated or interrupted run never writes it twice.
//
// A run saves back last, after its record is written, so the new file flows into the room on the next sync as one add.
// The room offers drafts through its sync endpoints only while PROPOSALS_ENABLED is "1" and SAVE_BACK_SINCE is set
// (worker/sync.ts draftsEnabled): `drafts` in GET /api/sync/state, GET /api/sync/drafts/:id and POST /api/sync/drafts.
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isPrivateSegment, skipReason } from './guard.ts';
import { placeExclusively, sanitizeFilename } from './pull.ts';

/** The folder inside sourceRoot that approved drafts land in (docs/design/propose-and-approve.md, "Next"). */
export const DRAFTS_FOLDER = 'Drafts';

/** A hidden file in Drafts/ that only save-back writes, and the guard skips as a dotfile. */
const TEMP_PREFIX = '.legallas-save-';
/** iCloud's placeholder for a file held only in the cloud. */
const ICLOUD_PLACEHOLDER = /^\.(.+)\.icloud$/i;
/** Characters the fallback name drops: path and Windows separators, and the lock-file marks. */
const UNPLAIN = /[/\\:<>"|?*~$]/;

/** One approved draft the room has not had saved yet: `drafts` in GET /api/sync/state. */
export interface Draft {
  id: string;
  name: string;
}

/** The two calls save-back makes, beyond the state. */
export interface DraftSource {
  read(id: string): Promise<Uint8Array>;
  markSaved(ids: string[]): Promise<void>;
}

/** The room's sync endpoints as a DraftSource. `request` sends one request with the token and the lease. */
export function roomDrafts(request: (method: string, route: string, body?: unknown) => Promise<Response>): DraftSource {
  const ok = async (response: Promise<Response>) => {
    const answer = await response;
    if (!answer.ok) throw new Error(`the room answered ${answer.status}`);
    return answer;
  };
  return {
    read: async (id) => new Uint8Array(await (await ok(request('GET', `/api/sync/drafts/${encodeURIComponent(id)}`))).arrayBuffer()),
    markSaved: async (ids) => {
      await ok(request('POST', '/api/sync/drafts', { ids }));
    },
  };
}

/** The dry run's lines: what a run would save back. */
export function formatSaveBack(drafts: readonly Draft[]): string[] {
  if (drafts.length === 0) return [];
  return [`Save back ${drafts.length} approved draft${drafts.length === 1 ? '' : 's'} to ${DRAFTS_FOLDER}/ as new files:`, ...drafts.map((draft) => `  save back  ${draft.name}`)];
}

/**
 * A free name for a draft that the guard takes as an ordinary file. A title that reads as a private segment would stop
 * every later run, and one that reads as a lock file would never come in, so those fall back to a plain form.
 */
function folderName(raw: string, taken: Set<string>): string {
  const ordinary = (name: string) => !isPrivateSegment(name) && skipReason(name) === null;
  const name = sanitizeFilename(raw, taken);
  if (ordinary(name)) return name;
  const plain = sanitizeFilename([...raw].map((char) => (char.normalize('NFKC') === '_' || UNPLAIN.test(char) ? ' ' : char)).join(''), taken);
  return ordinary(plain) ? plain : sanitizeFilename('Approved draft.md', taken);
}

/** Whether a file in `dir` already holds exactly these bytes. Reads only files of the same size. */
async function alreadyThere(dir: string, names: readonly string[], bytes: Uint8Array): Promise<boolean> {
  for (const name of names) {
    const file = path.join(dir, name);
    const stat = await lstat(file);
    if (stat.isFile() && stat.size === bytes.byteLength && Buffer.from(bytes).equals(await readFile(file))) return true;
  }
  return false;
}

/** Writes each draft into sourceRoot/Drafts/ as a new file, then has the room mark them saved. Failures are retried next run. */
export async function saveBack(drafts: readonly Draft[], source: DraftSource, sourceRoot: string, log: (line: string) => void): Promise<{ saved: number; failed: number }> {
  if (drafts.length === 0) return { saved: 0, failed: 0 };
  const dir = path.join(sourceRoot, DRAFTS_FOLDER);
  await mkdir(dir, { recursive: true });
  // Never through a link: the guard stops a run on one, and this holds even if one appeared since the walk.
  if (!(await lstat(dir)).isDirectory()) throw new Error(`${DRAFTS_FOLDER} in the folder is not a folder, so nothing was saved back`);
  const listed = await readdir(dir);
  // A stopped run's temporary files are save-back's own: nothing else writes that name.
  for (const name of listed.filter((entry) => entry.startsWith(TEMP_PREFIX))) await rm(path.join(dir, name), { force: true });
  const names = listed.filter((entry) => !entry.startsWith(TEMP_PREFIX));
  const taken = new Set(names.flatMap((name) => [name, ICLOUD_PLACEHOLDER.exec(name)?.[1] ?? name]).map((name) => name.normalize('NFC').toLowerCase()));
  const saved: string[] = [];
  let failed = 0;
  for (const draft of drafts) {
    const temp = path.join(dir, `${TEMP_PREFIX}${randomUUID()}`);
    try {
      const bytes = await source.read(draft.id);
      if (!(await alreadyThere(dir, names, bytes))) {
        await writeFile(temp, bytes, { flag: 'wx' });
        let name = folderName(draft.name, taken);
        // Placed only where no file is: a name that turns out to be taken gets the next one.
        while (!(await placeExclusively(temp, path.join(dir, name)))) name = folderName(draft.name, taken);
        names.push(name);
      }
      saved.push(draft.id);
    } catch (error) {
      failed += 1;
      log(`  save-back failed for one draft (${draft.id}): ${error instanceof Error ? error.message.split('\n')[0] : 'unknown error'}`);
    } finally {
      await rm(temp, { force: true });
    }
  }
  if (saved.length > 0) await source.markSaved(saved);
  return { saved: saved.length, failed };
}
