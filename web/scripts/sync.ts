// SPDX-License-Identifier: Apache-2.0
// Mirrors the owner's curated folder into the counsel room.
//
//   npm run sync                                   dry run against production (prints the plan, changes nothing)
//   npm run sync -- --apply --expect <fingerprint>  apply exactly the plan of an approved dry run
//   npm run sync -- --apply --yes                   apply without the interactive confirmation
//   --local      use the local D1 and R2 (wrangler dev state) instead of production
//   --summary    print aggregate counts only, no table of paths
//   --check-index  also extract and split every indexable document locally and print counts (no uploads)
//   --allow-pii <sha256>  acknowledge one document the SSN guard flagged (repeat per document; no blanket override)
//   --allow-active <sha256>  the same, for the active-content check
//   --config <file>  another legallas.config.json
//   --room       reach the room through its own sync endpoints with an Access service token (room-sync.ts), not Wrangler
//                with an account-wide one. ROOM_SYNC_CLIENT_ID and ROOM_SYNC_CLIENT_SECRET hold the token. The address is
//                ROOM_SYNC_ORIGIN, else the room config's host. Same dry run, fingerprint and guards.
//   --take-over  with --room: take the lease from another device that is syncing this room
//
// Guard, snapshot and re-hash: see guard.ts and snapshot.ts. Diff: diff.ts. Apply: apply.ts. The SSN guard, which
// reads the text of every document a run sends before the plan is printed: pii-scan.ts (rules in pii.ts). The
// visuals' side files (their rendered text and PNGs, meta/visual-ai/ in legallas-files): visual-ai.ts; their puts and
// deletes are counted in the dry run and are part of the plan fingerprint. Files that can run code: active-scan.ts.
import { formatSaveBack, saveBack, type Draft } from './saveback.ts';
import { randomUUID } from 'node:crypto';
import { mkdir, open, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { activeCheck, activeRefusal, saveActiveCleared } from './active-scan.ts';
import { applyPlan } from './apply.ts';
import { wranglerTokens } from './law/replica.ts';
import { cloudflareLease, holdIngestion } from './spend-guard.ts';
import { checkIndex, formatIndexCheck } from './checkindex.ts';
import { configuredRoomHost, DEFAULT_CONFIG_PATH, loadSyncConfig, type SyncConfig } from './config.ts';
import { diffSync, planIsEmpty, type DocumentRow, type SyncPlan } from './diff.ts';
import { cachedExtractor, directTextPages, extractorStatus, indexSource } from './extract.ts';
import { platformExtractor } from './extract-windows.ts';
import { cliSideFiles, formatSidePlan, liveVisualShas, loadSideManifest, planSideFiles, sideFingerprintEntries, sideRefusal, visualTextSource } from './visual-ai.ts';
import { GuardAbort, guardWalk } from './guard.ts';
import { indexWork, loadManifestFor, type IndexJob } from './indexjob.ts';
import { PiiInPart } from './indexparts.ts';
import { loadKnownHashes } from './pii-hash.ts';
import { maskPath } from './pii.ts';
import { formatPiiReport, loadCleared, piiFingerprintEntries, piiGate, piiRefusal, piiTargets, saveCleared, scanForPii, scanRead, unreadTargets, writePiiDetails } from './pii-scan.ts';
import { formatBytes, formatReport, planFingerprint } from './report.ts';
import { deviceName, roomOrigin, roomSync, type RoomSync, type RoomSyncOptions } from './room-sync.ts';
import { CLONES_ARE_FREE, createSnapshot, fillSnapshot, MidSyncChange, platformClone, removeSnapshot, snapshotDir, verifyOriginals, type Snapshot, type SnapshotFile } from './snapshot.ts';
import { MIRROR_ROWS_SQL, PENDING_PULLS_SQL } from './sqlplan.ts';
import { leavesPrivilege, MONTHLY_UPLOAD_GB, validSyncPath } from '../worker/sync-rules.ts';
import { localWrangler } from './local-r2.ts';
import { accountId, cliWrangler, type Target, type Wrangler } from './wrangler.ts';

export interface SyncOptions {
  apply: boolean;
  yes: boolean;
  target: Target;
  summary: boolean;
  checkIndex: boolean;
  expect: string | null;
  config: string;
  /** sha256s of flagged documents the owner acknowledged (--allow-pii, once per document). */
  allowPii: string[];
  /** As allowPii, for the active-content check. */
  allowActive: string[];
  /** Through the room's sync endpoints rather than Wrangler. */
  room: boolean;
  takeOver: boolean;
}

const USAGE =
  'usage: npm run sync -- [--apply] [--yes] [--expect <fingerprint>] [--local] [--summary] [--check-index] [--allow-pii <sha256>]... [--allow-active <sha256>]... [--config <file>] [--room [--take-over]]';

export function parseSyncArgs(args: readonly string[]): SyncOptions {
  const options: SyncOptions = { apply: false, yes: false, target: 'remote', summary: false, checkIndex: false, expect: null, config: DEFAULT_CONFIG_PATH, allowPii: [], allowActive: [], room: false, takeOver: false };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--apply') options.apply = true;
    else if (arg === '--yes') options.yes = true;
    else if (arg === '--local') options.target = 'local';
    else if (arg === '--summary') options.summary = true;
    else if (arg === '--check-index') options.checkIndex = true;
    else if (arg === '--expect' && /^[0-9a-f]{12}$/.test(args[i + 1] ?? '')) options.expect = args[++i];
    else if (arg === '--config' && args[i + 1]) options.config = path.resolve(args[++i]);
    else if (arg === '--allow-pii' && /^[0-9a-f]{64}$/.test(args[i + 1] ?? '')) options.allowPii.push(args[++i]);
    else if (arg === '--allow-active' && /^[0-9a-f]{64}$/.test(args[i + 1] ?? '')) options.allowActive.push(args[++i]);
    else if (arg === '--room') options.room = true;
    else if (arg === '--take-over') options.takeOver = true;
    else throw new Error(USAGE);
  }
  if ((options.yes || options.expect) && !options.apply) throw new Error(`--yes and --expect only make sense with --apply\n${USAGE}`);
  if (options.checkIndex && options.apply) throw new Error(`--check-index is a dry run; it cannot be combined with --apply\n${USAGE}`);
  if (options.room && options.target === 'local') throw new Error(`--room reaches a room over its address; for wrangler dev, set ROOM_SYNC_ORIGIN instead of --local\n${USAGE}`);
  if (options.takeOver && !options.room) throw new Error(`--take-over only makes sense with --room\n${USAGE}`);
  return options;
}

function toRow(raw: Record<string, unknown>): DocumentRow {
  const text = (key: string) => (typeof raw[key] === 'string' ? (raw[key] as string) : null);
  const id = text('id');
  const docPath = text('path');
  const key = text('r2_key');
  if (!id || !docPath || !key) throw new Error('Unexpected documents row from D1');
  return {
    id,
    path: docPath,
    sha256: text('sha256'),
    size: Number(raw.size ?? 0),
    kind: text('kind') ?? 'file',
    pages: typeof raw.pages === 'number' ? raw.pages : null,
    r2_key: key,
    source: text('source') ?? '',
    removed_at: text('removed_at'),
  };
}

async function confirm(target: Target): Promise<boolean> {
  if (!process.stdin.isTTY) throw new Error('Not a terminal: pass --yes to apply without the confirmation prompt.');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(`Apply this plan to the ${target} room? Type "apply" to continue: `)).trim() === 'apply';
  } finally {
    rl.close();
  }
}

/** One sync at a time per cache: a lock file, plus removal of snapshots left behind by a crashed run. */
async function acquireLock(cacheDir: string): Promise<() => Promise<void>> {
  const lock = path.join(cacheDir, 'sync.lock');
  const handle = await open(lock, 'wx', 0o600).catch(() => {
    throw new Error(`Another sync is running (or one crashed). If none is running, delete ${lock}`);
  });
  await handle.close();
  for (const name of await readdir(cacheDir)) {
    if (name.startsWith('snapshot-')) await rm(path.join(cacheDir, name), { recursive: true, force: true });
  }
  return () => rm(lock, { force: true });
}

/**
 * The SSN guard: the text of every document this run sends, read before the plan is printed (pii-scan.ts). Then the
 * visuals' side-file plan (visual-ai.ts), whose lines and fingerprint entries the report prints with the guard's.
 * Visuals are read from their rendered text in the cache, never their markup.
 */
export async function guardTexts(snapshot: Snapshot, plan: SyncPlan<SnapshotFile>, jobs: readonly IndexJob[], config: SyncConfig, options: SyncOptions, target: Target, runId: string, log: (line: string) => void) {
  const extractPdf = cachedExtractor(platformExtractor(), config.cacheDir);
  const visualText = visualTextSource(config.cacheDir);
  const readText = (file: string, name: string) => directTextPages(file, name, visualText);
  const known = await loadKnownHashes(options.config);
  const sent = piiTargets(plan, jobs);
  const targets = [...sent, ...unreadTargets(plan, sent, await loadCleared(config.cacheDir, target, known))];
  // Documents staying in the room are in no other step's list, and where clones cost something no copy of them exists yet.
  await fillSnapshot(snapshot, targets.filter((doc) => scanRead(doc.kind, doc.rel)).map((doc) => doc.file));
  if (targets.length > 0) log(`SSN guard: reading the text of ${targets.length} documents (PDF text is cached for --apply)...`);
  const scan = await scanForPii(targets, { extractPdf, readText, known });
  const gate = piiGate(scan, options.allowPii);
  const details = scan.flagged.length + scan.unscanned.length > 0 ? await writePiiDetails(config.cacheDir, runId, scan, gate, target) : null;
  const acknowledged = new Set(gate.acknowledged.map((doc) => doc.sha256));
  const side = await planSideFiles(liveVisualShas(plan), config.cacheDir, await loadSideManifest(config.cacheDir, target), { known, acknowledged });
  const piiLines = formatPiiReport(scan, gate, details, options.summary, known ? { size: known.size, hashed: known.hashed } : null);
  const pii = {
    lines: [...piiLines, ...(piiLines.length > 0 ? [''] : []), ...formatSidePlan(side)],
    fingerprint: [...piiFingerprintEntries(scan, options.allowPii), ...sideFingerprintEntries(side)],
  };
  return { extractPdf, readText, known, gate, acknowledged, side, pii };
}

/** The snapshot paths a run needs whatever the SSN guard finds: what it uploads and what it indexes. guardTexts adds what the guard also reads. */
export function filesToRead(plan: SyncPlan<SnapshotFile>, jobs: readonly IndexJob[]): string[] {
  return [...plan.adds, ...plan.changes, ...plan.renames].map((op) => op.file.snapshot).concat(jobs.map((job) => job.file));
}

/**
 * Holds this month's AI Search budget for the run, through Wrangler: a lease on the account's analytics. New index text
 * costs ingestion, so the remote room checks before any upload, then holds the built parts' tokens once they are known
 * (apply.ts). Local runs index nothing. Through the room's endpoints, the room counts each part as it is written.
 */
async function ingestionGuard(jobs: number): Promise<{ hold?: (chars: number) => Promise<unknown>; close: () => Promise<unknown> }> {
  if (jobs === 0) return { close: async () => undefined };
  const lease = cloudflareLease(await accountId(), wranglerTokens(), 'sync --apply');
  try {
    await lease.check({ search_ingest_tokens: 1 });
  } catch (error) {
    await lease.close();
    throw error;
  }
  return { hold: (chars) => holdIngestion(lease, chars), close: () => lease.close() };
}

/**
 * Why a run must stop before it plans: nothing is ever lost because a file isn't on this computer yet. A folder with no
 * files would remove every document, and a file evicted to iCloud would remove the document it stands for.
 */
export function folderRefusal(root: string, fileCount: number, rows: readonly DocumentRow[], evicted: readonly string[]): string | null {
  if (fileCount === 0 && rows.length > 0) {
    return `${root} holds no files, but the room has ${rows.length} documents. If iCloud Drive or OneDrive hasn't filled the folder yet, sync again when it has. Nothing was changed.`;
  }
  const away = rows.filter((row) => evicted.includes(row.path.normalize('NFC'))).map((row) => `  ${row.path}`);
  return away.length === 0 ? null : `These files are in iCloud, not on this computer. Download them, then sync again. Nothing was changed.\n${away.join('\n')}`;
}

/** Paths the room's record would refuse (sync-rules.ts), by name in the dry run, and not after a run has uploaded its files. */
export function pathRefusal(plan: SyncPlan): string | null {
  const bad = [...plan.adds, ...plan.changes, ...plan.renames].map((op) => op.path).filter((rel) => !validSyncPath(rel));
  return bad.length === 0 ? null : `The room can't hold files with these paths. Rename or move them, then sync again. Nothing was changed.\n${bad.map((rel) => `  ${rel}`).join('\n')}`;
}

/** A plan the room can't take in one month, which is better said in the dry run than after hours of uploads. */
export function uploadRefusal(plan: SyncPlan): string | null {
  const bytes = [...plan.adds, ...plan.changes].reduce((sum, op) => sum + op.size, 0);
  if (bytes <= MONTHLY_UPLOAD_GB * 1024 ** 3) return null;
  return `This sync would upload ${Math.ceil(bytes / 1024 ** 3)} GB, and a room takes ${MONTHLY_UPLOAD_GB} GB a month. Sync part of the folder now and the rest next month. Nothing was changed.`;
}

type Texts = Awaited<ReturnType<typeof guardTexts>>;
type Active = Awaited<ReturnType<typeof activeCheck>>;
type Walk = Awaited<ReturnType<typeof guardWalk>>;

/** What a run learns before it prints anything: the folder, its snapshot, the plan against the room, and the index work. */
interface Inspection {
  walk: Walk;
  snapshot: Snapshot;
  plan: SyncPlan<SnapshotFile>;
  work: ReturnType<typeof indexWork>;
  pending: number;
  drafts: Draft[];
}

/** Walks and snapshots the folder, then plans against what the room holds. Refuses a folder that looks unfilled. */
async function inspectFolder(config: SyncConfig, w: Wrangler, room: RoomSync | null, runId: string, snapshotRef: { current: Pick<Snapshot, 'dir'> | null }, log: (line: string) => void): Promise<Inspection> {
  const walk = await guardWalk(config.sourceRoot);
  log(`Guard passed: ${walk.files.length} files. Snapshotting and hashing...`);
  if (walk.placeholders > 0) log(`${walk.placeholders} of them are held in the cloud, and download to this computer as they are read.`);
  // Registered before cloning so a failure halfway still removes every clone.
  snapshotRef.current = { dir: snapshotDir(config.cacheDir, runId) };
  const snapshot = await createSnapshot(walk.files, config.cacheDir, runId, platformClone, !CLONES_ARE_FREE);

  const rows = (await w.d1Query(MIRROR_ROWS_SQL)).map(toRow);
  const refused = folderRefusal(config.sourceRoot, walk.files.length, rows, walk.evicted);
  if (refused) throw new Error(refused);
  const pending = (await w.d1Query(PENDING_PULLS_SQL)).length;
  const drafts = room ? await room.drafts() : [];
  // Through the room's endpoints, a document leaving a privileged path goes up as a removal and a new file (sync-rules.ts).
  const plan = diffSync(snapshot.files, rows, randomUUID, room ? (from, to) => !leavesPrivilege(from, to) : undefined, walk.iworkPackages);
  const planRefused = room ? (pathRefusal(plan) ?? uploadRefusal(plan)) : null;
  if (planRefused) throw new Error(planRefused);
  const records = await loadManifestFor(w, config.cacheDir, w.target);
  const work = indexWork(plan, records.manifest, records.room);
  await fillSnapshot(snapshot, filesToRead(plan, work.jobs));
  return { walk, snapshot, plan, work, pending, drafts };
}

/** The SSN guard's and the active-content check's report lines and fingerprint entries, as one block. */
function combineGuards(pii: Texts['pii'], active: Active) {
  return {
    lines: [...pii.lines, ...(pii.lines.length > 0 && active.lines.length > 0 ? [''] : []), ...active.lines],
    fingerprint: [...pii.fingerprint, ...active.fingerprint],
  };
}

/** Prints the dry-run report and the drafts waiting to be saved, then proves the originals are unchanged. */
async function printReport(options: SyncOptions, w: Wrangler, found: Inspection, texts: Texts, guards: ReturnType<typeof combineGuards>, log: (line: string) => void): Promise<void> {
  const { walk, snapshot, plan, work, pending, drafts } = found;
  const count = (source: string) => work.jobs.filter((job) => indexSource(job.kind, job.file) === source).length;
  log(
    formatReport({
      plan,
      files: snapshot.files.map((file) => ({ rel: file.rel, size: file.size, sha256: file.sha256 })),
      skipped: walk.skipped,
      iworkPackages: walk.iworkPackages,
      target: w.target,
      pendingPulls: pending,
      toIndex: { direct: count('direct'), extracted: count('extractor') },
      extractor: await extractorStatus(),
      summary: options.summary,
      pii: guards,
      known: texts.known,
    }),
  );
  for (const line of formatSaveBack(drafts)) log(line);
  await verifyOriginals(snapshot);
}

/** `--check-index`: extracts and splits every indexable document locally and prints counts. Uploads nothing. */
async function checkIndexText(found: Inspection, texts: Texts, log: (line: string) => void): Promise<void> {
  const { snapshot, plan } = found;
  // Every indexable live document, whatever the manifest says: this is a check, not an incremental run.
  const { jobs } = indexWork(plan, {});
  await fillSnapshot(snapshot, jobs.map((job) => job.file));
  log(`\nChecking index text for ${jobs.length} documents (builds LegallasExtract if needed)...`);
  const check = await checkIndex(jobs, {
    extractPdf: texts.extractPdf,
    readText: texts.readText,
    onProgress: (done, total) => {
      if (done % 50 === 0 || done === total) process.stderr.write(`  ${done}/${total}\n`);
    },
  });
  log(formatIndexCheck(check));
  await verifyOriginals(snapshot);
}

/**
 * The gates between a dry run and an apply: the guards, the approved fingerprint, the cleared lists and the owner's yes.
 * False when there is nothing to do or the owner said no.
 */
async function approveApply(options: SyncOptions, config: SyncConfig, w: Wrangler, found: Inspection, texts: Texts, active: Active, guards: ReturnType<typeof combineGuards>, log: (line: string) => void): Promise<boolean> {
  const { plan, work, pending, drafts } = found;
  const { known, gate, side } = texts;
  const refusal = piiRefusal(gate) ?? activeRefusal(active.gate) ?? sideRefusal(side);
  if (refusal) throw new Error(refusal);
  const fingerprint = planFingerprint(plan, guards.fingerprint);
  if (options.expect && options.expect !== fingerprint) {
    throw new Error(`The plan changed since the approved dry run (expected ${options.expect}, now ${fingerprint}). Nothing was changed.`);
  }
  await saveCleared(config.cacheDir, w.target, known, plan);
  await saveActiveCleared(config.cacheDir, plan);
  if (planIsEmpty(plan) && work.jobs.length + work.drops.length + side.puts.length + side.deletes.length === 0 && pending === 0 && drafts.length === 0) {
    log('\nNothing to do.');
    return false;
  }
  if (!options.yes && !(await confirm(w.target))) {
    log('Cancelled. Nothing was changed.');
    return false;
  }
  return true;
}

/** Takes the lease, applies the plan, says what was done, and saves approved drafts back into the folder. */
async function applyApproved(config: SyncConfig, w: Wrangler, room: RoomSync | null, found: Inspection, texts: Texts, now: string, log: (line: string) => void): Promise<void> {
  const { snapshot, plan, work, drafts } = found;
  const { extractPdf, readText, known, acknowledged, side } = texts;
  await room?.acquire();
  const spend = w.target === 'remote' && !room ? await ingestionGuard(work.jobs.length) : null;
  const summary = await applyPlan(plan, {
    wrangler: w,
    extractPdf,
    readText,
    verifyOriginals: () => verifyOriginals(snapshot),
    workDir: snapshot.dir,
    cacheDir: config.cacheDir,
    inboxDir: config.inboxDir,
    now,
    log,
    pii: { known, acknowledged },
    sideFiles: { plan: side, store: room ? room.sideFiles : cliSideFiles(w.target) },
    ...(spend?.hold ? { holdIngestion: spend.hold } : {}),
  }).finally(() => spend?.close());
  log(
    `\nDone: ${summary.uploaded} files uploaded (${formatBytes([...plan.adds, ...plan.changes].reduce((s, op) => s + op.size, 0))}), ` +
      `${summary.indexObjects} index objects written or removed, ${summary.sideFiles} visual side files written or removed, ` +
      `${summary.deleted} superseded objects deleted, ` +
      `${summary.pulled} counsel uploads pulled${summary.pullFailures ? ` (${summary.pullFailures} failed, retried next run)` : ''}.`,
  );
  if (summary.indexSkipped > 0) log(`${summary.indexSkipped} documents were not indexed this run; the next sync retries them.`);
  // After counsel's uploads come down, approved drafts go up into the folder, under the same lease (card 6.1).
  if (room && drafts.length > 0) {
    const saved = await saveBack(drafts, room.draftSource, config.sourceRoot, log);
    log(`${saved.saved} approved drafts saved to the folder${saved.failed ? ` (${saved.failed} failed, retried next run)` : ''}.`);
  }
}

async function run(options: SyncOptions, config: SyncConfig, w: Wrangler, room: RoomSync | null, snapshotRef: { current: Pick<Snapshot, 'dir'> | null }): Promise<void> {
  const log = (line: string) => process.stdout.write(`${line}\n`);
  const now = new Date().toISOString();
  const runId = `${now.replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;

  const found = await inspectFolder(config, w, room, runId, snapshotRef, log);
  const texts = await guardTexts(found.snapshot, found.plan, found.work.jobs, config, options, w.target, runId, log);
  const active = await activeCheck(found.snapshot, found.plan, config.cacheDir, options.allowActive, options.summary, (rel) => maskPath(rel, texts.known), log);
  const guards = combineGuards(texts.pii, active);
  await printReport(options, w, found, texts, guards, log);
  if (options.checkIndex) await checkIndexText(found, texts, log);
  if (!options.apply) {
    log('\nDry run only. Nothing was changed.');
    return;
  }
  if (!(await approveApply(options, config, w, found, texts, active, guards, log))) return;
  await applyApproved(config, w, room, found, texts, now, log);
}

function describeFailure(error: unknown): string {
  if (error instanceof GuardAbort) {
    return [error.message, ...error.violations.map((v) => `  ${v.reason.padEnd(17)} ${maskPath(v.rel)}`)].join('\n');
  }
  if (error instanceof MidSyncChange) return [error.message, ...error.changed.map((rel) => `  changed  ${maskPath(rel)}`)].join('\n');
  if (error instanceof PiiInPart) return `${error.message} The SSN guard did not stop it, so the sync stopped before D1 was written. Run the dry run again.`;
  return error instanceof Error ? error.message : String(error);
}

/** The room client for --room, from the environment. Refuses before any file is read when something is missing. */
export function roomSyncOptions(env: NodeJS.ProcessEnv, host: string | null, device: string, takeOver: boolean): RoomSyncOptions {
  const { ROOM_SYNC_CLIENT_ID: clientId, ROOM_SYNC_CLIENT_SECRET: clientSecret, ROOM_SYNC_ORIGIN: origin } = env;
  if (!clientId || !clientSecret) throw new Error('--room needs the service token in ROOM_SYNC_CLIENT_ID and ROOM_SYNC_CLIENT_SECRET.');
  const address = origin || host;
  if (!address) throw new Error('--room needs the room address: set ROOM_SYNC_ORIGIN, or host in the room config.');
  return { origin: roomOrigin(address), clientId, clientSecret, device, takeOver, log: (line) => process.stdout.write(`${line}\n`) };
}

async function main(): Promise<void> {
  const options = parseSyncArgs(process.argv.slice(2));
  const config = await loadSyncConfig(options.config);
  const snapshotRef: { current: Pick<Snapshot, 'dir'> | null } = { current: null };
  await mkdir(config.cacheDir, { recursive: true, mode: 0o700 });
  const room = options.room ? roomSync(roomSyncOptions(process.env, configuredRoomHost(options.config), deviceName(), options.takeOver)) : null;
  const release = await acquireLock(config.cacheDir);
  let w: Wrangler | null = null;
  const cleanup = async () => {
    try {
      if (snapshotRef.current) await removeSnapshot(snapshotRef.current);
      await room?.release();
      await release();
    } finally {
      // The emulator keeps the process alive, so it closes whatever else failed.
      await w?.close?.();
    }
  };
  process.once('SIGINT', () => {
    void cleanup().finally(() => process.exit(130));
  });
  try {
    w = room ?? (options.target === 'local' ? await localWrangler() : cliWrangler(options.target));
    await run(options, config, w, room, snapshotRef);
  } finally {
    await cleanup();
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    process.stderr.write(`${describeFailure(error)}\n`);
    process.exitCode = 1;
  });
}
