// SPDX-License-Identifier: Apache-2.0
// Pure diff between the guarded walk and the live mirror rows in D1. Counsel uploads (source = 'counsel')
// are never part of the comparison: they can never be changed, renamed or removed by sync.
import { randomUUID } from 'node:crypto';
import { kindOf, splitPath, type KindInfo } from '../worker/doc-kinds.ts';

export type { Kind, KindInfo } from '../worker/doc-kinds.ts';
export { kindOf, splitPath } from '../worker/doc-kinds.ts';

export interface LocalFile {
  rel: string;
  size: number;
  sha256: string;
}

/** A documents row as read from D1. Only the columns sync needs. */
export interface DocumentRow {
  id: string;
  path: string;
  sha256: string | null;
  size: number;
  kind: string;
  pages: number | null;
  r2_key: string;
  source: string;
  removed_at?: string | null;
}

interface Target extends KindInfo {
  path: string;
  folder: string;
  name: string;
  size: number;
  sha256: string;
}

export interface AddOp<F> extends Target { id: string; r2Key: string; file: F }
export interface ChangeOp<F> extends Target { id: string; r2Key: string; oldR2Key: string; old: DocumentRow; file: F }
export interface RenameOp<F> extends Target { id: string; fromPath: string; old: DocumentRow; file: F }
export interface KeptDoc<F> { id: string; row: DocumentRow; file: F }

export interface SyncPlan<F extends LocalFile = LocalFile> {
  adds: AddOp<F>[];
  changes: ChangeOp<F>[];
  renames: RenameOp<F>[];
  removals: DocumentRow[];
  /** Live mirror rows whose content is unchanged (still candidates for re-indexing). */
  unchanged: KeptDoc<F>[];
  /** Live mirror rows whose document is now saved as a folder: left as they are, in the room and the index. */
  held: DocumentRow[];
}

function target(file: LocalFile): Target {
  const rel = file.rel.normalize('NFC');
  return { path: rel, ...splitPath(rel), ...kindOf(rel), size: file.size, sha256: file.sha256 };
}

function groupBy<T>(items: readonly T[], key: (item: T) => string | null): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    if (k === null) continue;
    groups.set(k, [...(groups.get(k) ?? []), item]);
  }
  return groups;
}

/**
 * Classifies the walk against D1. Only rows with source = 'mirror' and no removed_at take part; anything
 * else passed in is ignored. A rename is a one-to-one match: exactly one removed row and exactly one added
 * file share a sha256. Duplicated content on either side stays a plain add and remove, and so does a move `mayRename`
 * refuses. A row at a path in `held` is never a removal: deleting it would take the document's file, and bring it back
 * under a new id once re-saved.
 */
export function diffSync<F extends LocalFile>(
  files: readonly F[],
  rows: readonly DocumentRow[],
  newId: () => string = randomUUID,
  mayRename: (from: string, to: string) => boolean = () => true,
  held: readonly string[] = [],
): SyncPlan<F> {
  const live = rows.filter((row) => row.source === 'mirror' && !row.removed_at);
  const byPath = new Map(live.map((row) => [row.path.normalize('NFC'), row]));
  const present = new Set<string>();
  const plan: SyncPlan<F> = { adds: [], changes: [], renames: [], removals: [], unchanged: [], held: [] };
  const heldPaths = new Set(held.map((rel) => rel.normalize('NFC')));
  const added: F[] = [];

  for (const file of files) {
    const rel = file.rel.normalize('NFC');
    const row = byPath.get(rel);
    if (!row) {
      added.push(file);
      continue;
    }
    present.add(rel);
    if (row.sha256 === file.sha256) plan.unchanged.push({ id: row.id, row, file });
    else plan.changes.push({ ...target(file), id: row.id, r2Key: newId(), oldR2Key: row.r2_key, old: row, file });
  }
  const gone = live.filter((row) => !present.has(row.path.normalize('NFC')));
  plan.held = gone.filter((row) => heldPaths.has(row.path.normalize('NFC')));
  const removed = gone.filter((row) => !heldPaths.has(row.path.normalize('NFC')));

  const removedBySha = groupBy(removed, (row) => row.sha256);
  const addedBySha = groupBy(added, (file) => file.sha256);
  const renamedRows = new Set<DocumentRow>();
  const renamedFiles = new Set<F>();
  for (const [sha, group] of addedBySha) {
    const candidates = removedBySha.get(sha);
    if (group.length !== 1 || candidates?.length !== 1) continue;
    const [file] = group;
    const [row] = candidates;
    if (!mayRename(row.path, file.rel.normalize('NFC'))) continue;
    renamedRows.add(row);
    renamedFiles.add(file);
    plan.renames.push({ ...target(file), id: row.id, fromPath: row.path, old: row, file });
  }
  for (const file of added) {
    if (!renamedFiles.has(file)) plan.adds.push({ ...target(file), id: newId(), r2Key: newId(), file });
  }
  plan.removals = removed.filter((row) => !renamedRows.has(row));
  return plan;
}

export function planIsEmpty(plan: SyncPlan<LocalFile>): boolean {
  return plan.adds.length + plan.changes.length + plan.renames.length + plan.removals.length === 0;
}
