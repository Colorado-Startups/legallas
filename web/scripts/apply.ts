// SPDX-License-Identifier: Apache-2.0
// `npm run sync -- --apply`: the steps after the dry run, in an order that keeps D1 truthful.
//   1. Upload originals from the snapshot to new opaque keys (6 at a time remote, 1 local). Live rows
//      still point at the old objects, so the room keeps working during the upload.
//   2. Extract text and build index parts locally, then hold their AI Search ingestion tokens against this month's
//      spend budget (scripts/spend-guard.ts): with no room, the run stops here like a mid-sync change.
//   3. Re-hash the originals. If anything changed mid-sync, delete this run's uploads and stop: D1 is untouched.
//   4. Apply the one idempotent SQL file.
//   5. Upload index parts; delete stale parts, removed documents' parts, and superseded R2 objects but those version
//      history keeps (worker/sync-rules.ts), and kept ones it no longer keeps once past their time. Then the visuals'
//      side files (meta/visual-ai/, scripts/visual-ai.ts): their texts and PNGs, and those of visuals no longer live.
//   6. Ask AI Search to re-index (or print the manual step).
//   7. Pull new counsel uploads into the inbox and mark them pulled.
// Through the room's sync endpoints (room-sync.ts) steps 4 and 7 send a plan instead of SQL, and step 5 deletes no
// original: the room keeps what a sync replaced for a time, because the laptop's token must not be able to destroy it.
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { SyncPlan } from './diff.ts';
import type { ExtractedPage } from './extract.ts';
import { buildIndex, indexWork, loadManifestFor, saveManifest, syncIndex, type BuildDeps } from './indexjob.ts';
import { mapLimit } from './pool.ts';
import { pullCounselUploads, type Quarantiner } from './pull.ts';
import type { SnapshotFile } from './snapshot.ts';
import { syncSql } from './sqlplan.ts';
import { PURGEABLE_SQL, RETAIN_DAYS } from '../worker/sync-rules.ts';
import { sqlLiteral } from '../worker/sql.ts';
import { fileChars } from './spend-guard.ts';
import { applySideFiles, loadSideManifest, saveSideManifest, type SideFileStore, type SidePlan } from './visual-ai.ts';
import { AI_SEARCH_INSTANCE, FILES_BUCKET, r2Concurrency, type Wrangler } from './wrangler.ts';

/** Keys per query when reading or purging sync_retired. */
const RETIRED_BATCH = 100;

export interface ApplyDeps {
  wrangler: Wrangler;
  extractPdf: (file: string, sha256: string) => Promise<ExtractedPage[]>;
  /** `name` is the document's file name: snapshot files have opaque names, and a Form D needs its own. */
  readText: (file: string, name: string) => Promise<ExtractedPage[]>;
  /** Re-hashes the originals; throws MidSyncChange. */
  verifyOriginals: () => Promise<void>;
  /** The snapshot directory: SQL and part files are written here and removed with it. */
  workDir: string;
  cacheDir: string;
  inboxDir: string;
  now: string;
  log: (line: string) => void;
  quarantine?: Quarantiner;
  /** The SSN guard's known hashes and acknowledged sha256s, for the index's last check (indexparts.ts). */
  pii?: BuildDeps['pii'];
  /**
   * Holds the ingestion the built parts can cost (characters of text); throws SpendStop when the month has no room.
   * sync.ts passes scripts/spend-guard.ts holdIngestion for the remote room; local runs index nothing.
   */
  holdIngestion?: (chars: number) => Promise<unknown>;
  /**
   * The visuals' side files: the plan sync.ts made (inside its fingerprint) and the store that writes them. Never
   * documents rows; only meta/visual-ai/ keys in legallas-files. Absent, no side file is touched.
   */
  sideFiles?: { plan: SidePlan; store: SideFileStore };
}

export interface ApplySummary {
  uploaded: number;
  indexObjects: number;
  /** Visual side files written or removed. */
  sideFiles: number;
  indexSkipped: number;
  deleted: number;
  pulled: number;
  pullFailures: number;
}

async function deleteObjects(w: Wrangler, keys: readonly string[], log: (line: string) => void): Promise<number> {
  let deleted = 0;
  await mapLimit(keys, r2Concurrency(w.target), async (key) => {
    try {
      await w.r2Delete(FILES_BUCKET, key);
      deleted += 1;
    } catch {
      log('  warning: could not delete one superseded object; it is unreferenced and safe to remove later');
    }
  });
  return deleted;
}

/** Which of `keys` sync_retired holds: originals version history keeps (sqlplan.ts), never deleted here. */
async function retiredKeys(w: Wrangler, keys: readonly string[]): Promise<Set<string>> {
  const kept = new Set<string>();
  for (let i = 0; i < keys.length; i += RETIRED_BATCH) {
    const chunk = keys.slice(i, i + RETIRED_BATCH).map(sqlLiteral).join(', ');
    for (const row of await w.d1Query(`SELECT r2_key FROM sync_retired WHERE r2_key IN (${chunk})`)) if (typeof row.r2_key === 'string') kept.add(row.r2_key);
  }
  return kept;
}

/** worker/sync.ts purgeRetired for this path: originals past RETAIN_DAYS that version history no longer keeps. */
async function purgeRetired(w: Wrangler, deps: Pick<ApplyDeps, 'now' | 'workDir'>, log: (line: string) => void): Promise<number> {
  const cutoff = sqlLiteral(new Date(Date.parse(deps.now) - RETAIN_DAYS * 86_400_000).toISOString());
  const purgeable = PURGEABLE_SQL.replace('?1', cutoff).replace('?2', String(RETIRED_BATCH));
  // As the Worker's: never a key a live row uses.
  const rows = await w.d1Query(`SELECT r2_key FROM (${purgeable}) p WHERE NOT EXISTS (SELECT 1 FROM documents WHERE r2_key = p.r2_key AND removed_at IS NULL)`);
  const keys = rows.flatMap((row) => (typeof row.r2_key === 'string' ? [row.r2_key] : []));
  if (keys.length === 0) return 0;
  const deleted = await deleteObjects(w, keys, log);
  await applySql(w, path.join(deps.workDir, 'purged.sql'), `${keys.map((key) => `DELETE FROM sync_retired WHERE r2_key = ${sqlLiteral(key)};`).join('\n')}\n`);
  return deleted;
}

async function triggerReindex(w: Wrangler, log: (line: string) => void): Promise<void> {
  if (w.target === 'local') {
    log('AI Search has no local mode; skipped re-indexing.');
    return;
  }
  if (await w.aiSearchJobsAvailable()) {
    // D1 and the index are already updated, so a failure here (for example before the AI Search instance
    // exists) must not abort the run and skip the counsel pulls. The index is picked up by the next job.
    try {
      await w.aiSearchJobCreate(AI_SEARCH_INSTANCE);
      log(`Started an AI Search indexing job for "${AI_SEARCH_INSTANCE}".`);
    } catch {
      log(
        `MANUAL STEP: could not start an AI Search job for "${AI_SEARCH_INSTANCE}" (does the instance exist yet?). ` +
          'The text is in legallas-index; start a sync in the dashboard once the instance is set up.',
      );
    }
  } else {
    log(
      'MANUAL STEP: this wrangler has no `ai-search jobs create`. In the Cloudflare dashboard open ' +
        `AI > AI Search > ${AI_SEARCH_INSTANCE} and start a sync so the new text is indexed.`,
    );
  }
}

async function applySql(w: Wrangler, file: string, sql: string): Promise<void> {
  await writeFile(file, sql, { mode: 0o600 });
  try {
    await w.d1File(file);
  } catch {
    // Every statement is idempotent, so one retry is safe after a partial apply.
    await w.d1File(file);
  }
}

/** Step 5's side files, after D1 names the live visuals; the local manifest is saved even when one fails. */
async function syncSideFiles(deps: ApplyDeps, side: NonNullable<ApplyDeps['sideFiles']>): Promise<number> {
  const target = deps.wrangler.target;
  const manifest = await loadSideManifest(deps.cacheDir, target);
  try {
    return await applySideFiles(side.plan, side.store, manifest, target, deps.workDir, deps.log);
  } finally {
    await saveSideManifest(deps.cacheDir, target, manifest);
  }
}

export async function applyPlan(plan: SyncPlan<SnapshotFile>, deps: ApplyDeps): Promise<ApplySummary> {
  const { wrangler: w, log } = deps;
  const summary: ApplySummary = { uploaded: 0, indexObjects: 0, sideFiles: 0, indexSkipped: 0, deleted: 0, pulled: 0, pullFailures: 0 };

  // 1-3: nothing below touches D1 until the originals are proven unchanged.
  const uploads = [...plan.adds, ...plan.changes];
  const uploadedKeys: string[] = [];
  const { manifest, room } = await loadManifestFor(w, deps.cacheDir, w.target);
  const work = indexWork(plan, manifest, room);
  let built;
  try {
    log(`Uploading ${uploads.length} files to ${FILES_BUCKET}...`);
    await mapLimit(uploads, r2Concurrency(w.target), async (op) => {
      await w.r2Put(FILES_BUCKET, op.r2Key, op.file.snapshot, op.contentType);
      uploadedKeys.push(op.r2Key);
    });
    summary.uploaded = uploadedKeys.length;
    log(`Extracting text for ${work.jobs.length} documents...`);
    built = await buildIndex(work.jobs, { extractPdf: deps.extractPdf, readText: deps.readText, workDir: deps.workDir, log, pii: deps.pii });
    summary.indexSkipped = built.skipped;
    if (deps.holdIngestion) await deps.holdIngestion(await fileChars([...built.parts.values()].flat()));
    await deps.verifyOriginals();
  } catch (error) {
    if (uploadedKeys.length > 0) {
      log(`Stopping: removing the ${uploadedKeys.length} objects uploaded by this run.`);
      await deleteObjects(w, uploadedKeys, log);
    }
    throw error;
  }

  // 4
  if (w.record) {
    log('Writing the record...');
    await w.record.apply(plan, deps.now, built.pages);
  } else {
    const sql = syncSql(plan, deps.now, built.pages);
    if (sql) {
      log('Applying the D1 changes...');
      await applySql(w, path.join(deps.workDir, 'sync.sql'), sql);
    }
  }

  // 5
  try {
    summary.indexObjects = await syncIndex(w, work.jobs, built, work.drops, manifest, log);
  } finally {
    await saveManifest(deps.cacheDir, w.target, manifest);
  }
  if (!w.record) {
    const superseded = [...plan.changes.map((op) => op.oldR2Key), ...plan.removals.map((row) => row.r2_key)];
    const kept = await retiredKeys(w, superseded);
    summary.deleted = await deleteObjects(w, superseded.filter((key) => !kept.has(key)), log);
    summary.deleted += await purgeRetired(w, deps, log);
  }
  if (deps.sideFiles) summary.sideFiles = await syncSideFiles(deps, deps.sideFiles);

  // 6
  if (summary.indexObjects > 0) await triggerReindex(w, log);

  // 7
  const pulls = await pullCounselUploads(w, deps.inboxDir, deps.now, log, deps.quarantine);
  if (w.record) await w.record.markPulled(pulls.ids ?? [], deps.now);
  else if (pulls.sql) await applySql(w, path.join(deps.workDir, 'pulled.sql'), pulls.sql);
  summary.pulled = pulls.pulled;
  summary.pullFailures = pulls.failed;
  return summary;
}
