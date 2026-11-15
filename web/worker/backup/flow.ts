// SPDX-License-Identifier: Apache-2.0
// The room backup's three runs, as steps of a Cloudflare Workflow (entry.ts):
//   backup   copy every R2 object and every D1 row into the backup bucket (layout.ts), then prune old run folders
//   drill    restore the newest finished run into the scratch bucket and scratch database, check every count and hash
//            against what the run recorded, empty both scratch copies, and keep the dated result in the backup bucket
//   restore  the same restore into the room's own buckets or database, only when each target is empty (a lost bucket
//            or database the owner has created again), and nothing is cleaned up
// Each step's result is persisted by the Workflow, so a failed step retries alone. Results hold counts, bytes, hashes,
// list cursors and table plans, never a key or a row.
import { BackupError, DRILL, drillKey, drillRecordKey, DRILLS, KEEP_DAYS, KEEP_RUNS, MAX_WRITES_PER_RUN, OBJECTS, PARTS, rollUp, RUN_ID, runPrefix, RUNS, runStarted, schemaKey, SOURCES, STORAGE_CAP_BYTES, summaryKey, tablePageKey, type Part, type RunSummary, type Source, type SourceRecord, type TableRecord } from './layout.ts';
import { copyPage, deleteUnder, isEmpty, measure, onlyUnder, restorePage, type HashBody } from './r2.ts';
import { createRest, createTables, dropAll, dumpTable, MARKER_TABLE, readSchema, restoreRows, userTables, type Schema, type TablePlan } from './d1.ts';

/** The bindings a backup run needs, including the room's database. */
export interface BackupEnv {
  /** The room's database: read by a backup, written only by a restore into an empty database. */
  DB: D1Database;
  /** The room's buckets: read by a backup, written only by a restore into an empty bucket. */
  FILES: R2Bucket;
  INDEX: R2Bucket;
  LAW: R2Bucket;
  /** The second copy, created with another location hint. */
  BACKUP: R2Bucket;
  /** Empty except while a drill runs. */
  SCRATCH: R2Bucket;
  SCRATCH_DB: D1Database;
}

/** One durable step: the Workflow's step.do in entry.ts, a direct call in tests. */
export interface Step {
  do<T>(name: string, fn: () => Promise<T>): Promise<T>;
}

/** The helpers a run takes: a body hasher and a clock. */
export interface Tools {
  hash: HashBody;
  now: () => number;
}

/** What the owner asked for: a backup, a drill or a restore. */
export type Params = { action: 'backup' } | { action: 'drill'; run?: string } | { action: 'restore'; run: string; only: Part[] };

/** What the owner asked for. A scheduled run brings no params and is a backup. Anything else is refused. */
export function parseParams(payload: unknown): Params {
  if (payload === undefined || payload === null) return { action: 'backup' };
  if (typeof payload !== 'object' || Array.isArray(payload)) throw new BackupError('bad-params', 'params must be an object');
  const { action, run, only, ...rest } = payload as Record<string, unknown>;
  if (Object.keys(rest).length > 0) throw new BackupError('bad-params', 'unknown params');
  if (run !== undefined && (typeof run !== 'string' || !RUN_ID.test(run))) throw new BackupError('bad-params', 'run is not a run id');
  if (action === undefined || action === 'backup') {
    if (run !== undefined || only !== undefined) throw new BackupError('bad-params', 'a backup takes no run or parts');
    return { action: 'backup' };
  }
  if (action === 'drill') {
    if (only !== undefined) throw new BackupError('bad-params', 'a drill restores every part');
    return run === undefined ? { action } : { action, run };
  }
  if (action === 'restore') {
    if (typeof run !== 'string') throw new BackupError('bad-params', 'a restore names its run');
    if (!Array.isArray(only) || only.length === 0 || !only.every((part) => (PARTS as readonly unknown[]).includes(part))) {
      throw new BackupError('bad-params', `only lists the parts to restore: ${PARTS.join(', ')}`);
    }
    return { action, run, only: [...new Set(only as Part[])] };
  }
  throw new BackupError('bad-params', 'action is backup, drill or restore');
}

const BUCKET: Record<Source, 'FILES' | 'INDEX' | 'LAW'> = { files: 'FILES', index: 'INDEX', law: 'LAW' };
const seconds = (from: number, to: number): number => Math.round((to - from) / 1000);

/** What a backup run reports. */
export interface BackupOutput {
  action: 'backup';
  run: string;
  ok: true;
  sources: Record<Source, SourceRecord & { copied: number; copiedBytes: number; skipped: number }>;
  d1: { tables: number; rows: number; derived: number; hash: string };
  storage: { usedBytes: number; capBytes: number };
  pruned: number;
  seconds: number;
}

/** Runs a backup of the room's buckets and database. */
export async function runBackup(env: BackupEnv, step: Step, run: string, tools: Tools): Promise<BackupOutput> {
  const started = await step.do('start', async () => tools.now());
  const check = await step.do('check the backup bucket and storage', async () => {
    await onlyUnder(env.BACKUP, [OBJECTS, RUNS, DRILLS], 'backup-bucket-not-ours');
    const sizes = await Promise.all([env.BACKUP, env.SCRATCH, ...SOURCES.map((source) => env[BUCKET[source]])].map((bucket) => measure(bucket)));
    const used = sizes.reduce((sum, size) => sum + size.bytes, 0);
    if (used > STORAGE_CAP_BYTES) throw new BackupError('storage-cap', `the buckets hold ${used} bytes, past the ${STORAGE_CAP_BYTES}-byte free-tier cap`);
    return { used };
  });

  let used = check.used;
  let writes = 0;
  const sources = {} as BackupOutput['sources'];
  for (const source of SOURCES) {
    const hashes: string[] = [];
    const total = { objects: 0, bytes: 0, copied: 0, copiedBytes: 0, skipped: 0 };
    let cursor: string | undefined;
    do {
      const page = hashes.length;
      const budget = { bytes: STORAGE_CAP_BYTES - used, writes: MAX_WRITES_PER_RUN - writes };
      const done = await step.do(`copy ${source} page ${page}`, () => copyPage(env[BUCKET[source]], env.BACKUP, source, run, page, cursor, tools.hash, budget));
      used += done.copiedBytes;
      writes += done.copied + 1;
      hashes.push(done.hash);
      for (const field of ['objects', 'bytes', 'copied', 'copiedBytes', 'skipped'] as const) total[field] += done[field];
      cursor = done.cursor ?? undefined;
    } while (cursor);
    sources[source] = { ...total, pages: hashes.length, hash: await rollUp(hashes) };
  }

  const schema = await step.do('copy the database schema', async () => {
    const read = await readSchema(env.DB);
    await env.BACKUP.put(schemaKey(run), JSON.stringify(read), { httpMetadata: { contentType: 'application/json' } });
    return read.tables;
  });
  const tables: TableRecord[] = [];
  for (const plan of schema.filter((table) => !table.derived)) {
    const dumped = await step.do(`copy table ${plan.name}`, () =>
      dumpTable(env.DB, plan, async (text, page) => {
        await env.BACKUP.put(tablePageKey(run, plan.name, page), text, { httpMetadata: { contentType: 'application/x-ndjson' } });
      }),
    );
    tables.push({ name: plan.name, ...dumped });
  }

  const summary: RunSummary = { version: 1, run, sources: Object.fromEntries(SOURCES.map((s) => [s, { objects: sources[s].objects, bytes: sources[s].bytes, pages: sources[s].pages, hash: sources[s].hash }])) as Record<Source, SourceRecord>, tables };
  await step.do('write the summary', async () => {
    await env.BACKUP.put(summaryKey(run), JSON.stringify(summary), { httpMetadata: { contentType: 'application/json' } });
    return true;
  });
  const pruned = await step.do('prune old runs', () => pruneRuns(env.BACKUP, run));
  const finished = await step.do('finish', async () => tools.now());
  return {
    action: 'backup',
    run,
    ok: true,
    sources,
    d1: { tables: tables.length, rows: tables.reduce((sum, table) => sum + table.rows, 0), derived: schema.length - tables.length, hash: await rollUp(tables.map((table) => table.hash)) },
    storage: { usedBytes: used, capBytes: STORAGE_CAP_BYTES },
    pruned,
    seconds: seconds(started, finished),
  };
}

/** Run ids in the backup bucket, newest first. */
async function runIds(backup: R2Bucket): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const listed = await backup.list({ prefix: RUNS, delimiter: '/', cursor });
    for (const prefix of listed.delimitedPrefixes) {
      const id = prefix.slice(RUNS.length, -1);
      if (RUN_ID.test(id)) ids.push(id);
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
  return ids.sort().reverse();
}

/**
 * Deletes run folders (manifests and database copies) older than KEEP_DAYS, keeping the newest KEEP_RUNS finished runs
 * and the current one. The object copies under objects/ are never pruned: a file removed from the room stays here.
 */
export async function pruneRuns(backup: R2Bucket, current: string, now = runStarted(current).getTime()): Promise<number> {
  const ids = await runIds(backup);
  const finished = new Set<string>();
  for (const id of ids) if (finished.size < KEEP_RUNS && (await backup.head(summaryKey(id)))) finished.add(id);
  let pruned = 0;
  for (const id of ids) {
    if (id === current || finished.has(id) || now - runStarted(id).getTime() < KEEP_DAYS * 86_400_000) continue;
    await deleteUnder(backup, runPrefix(id));
    pruned += 1;
  }
  return pruned;
}

/** The run to restore and what it recorded: the one named, or the newest finished run. */
async function chooseRun(backup: R2Bucket, wanted?: string): Promise<RunSummary> {
  for (const id of wanted ? [wanted] : await runIds(backup)) {
    const summary = await backup.get(summaryKey(id));
    if (summary) return summary.json<RunSummary>();
  }
  throw new BackupError('no-run', wanted ? 'that run did not finish or was pruned' : 'the backup bucket holds no finished run');
}

interface Target {
  bucket: R2Bucket;
  key: (key: string) => string;
}

interface Targets {
  buckets: Partial<Record<Source, Target>>;
  db: D1Database | null;
}

/** What a drill or a restore reports. */
export interface RestoreOutput {
  action: 'drill' | 'restore';
  run: string;
  ok: boolean;
  sources: Partial<Record<Source, { expected: SourceRecord; restored: { objects: number; bytes: number; hash: string }; failed: number }>>;
  d1: { tables: number; expectedRows: number; restoredRows: number; mismatched: string[]; derived: number; expectedHash: string; restoredHash: string } | null;
  seconds: { restore: number; total: number };
  cleanedUp: boolean;
}

/** Restores each source's pages into its target bucket, and totals what came back. */
async function restoreBuckets(env: BackupEnv, step: Step, summary: RunSummary, targets: Targets): Promise<RestoreOutput['sources']> {
  const run = summary.run;
  const sources: RestoreOutput['sources'] = {};
  for (const source of SOURCES) {
    const target = targets.buckets[source];
    if (!target) continue;
    const expected = summary.sources[source];
    const hashes: string[] = [];
    const restored = { objects: 0, bytes: 0 };
    let failed = 0;
    for (let page = 0; page < expected.pages; page += 1) {
      const done = await step.do(`restore ${source} page ${page}`, () => restorePage(env.BACKUP, target.bucket, target.key, source, run, page));
      restored.objects += done.objects;
      restored.bytes += done.bytes;
      failed += done.failed;
      hashes.push(done.hash);
    }
    sources[source] = { expected, restored: { ...restored, hash: await rollUp(hashes) }, failed };
  }
  return sources;
}

/** The run's schema, read back from the backup bucket. */
async function schemaOf(env: BackupEnv, run: string): Promise<Schema> {
  const object = await env.BACKUP.get(schemaKey(run));
  if (!object) throw new BackupError('schema-missing', "the run's database schema is missing");
  return object.json<Schema>();
}

/** Restores each copied table's pages into `db`. */
async function restoreTables(env: BackupEnv, step: Step, summary: RunSummary, db: D1Database, copied: readonly TablePlan[]): Promise<void> {
  const recorded = new Map(summary.tables.map((table) => [table.name, table]));
  for (const plan of copied) {
    const pages = recorded.get(plan.name)?.pages ?? 0;
    for (let page = 0; page < pages; page += 1) {
      await step.do(`restore table ${plan.name} page ${page}`, async () => {
        const object = await env.BACKUP.get(tablePageKey(summary.run, plan.name, page));
        if (!object) throw new BackupError('rows-missing', `page ${page} of a copied table is missing`);
        return restoreRows(db, plan, await object.text());
      });
    }
  }
}

/** Restores the schema, the copied tables and the rest into `db`, then reads every table back against what the run recorded. */
async function restoreDatabase(env: BackupEnv, step: Step, summary: RunSummary, db: D1Database): Promise<NonNullable<RestoreOutput['d1']>> {
  const run = summary.run;
  const tables = await step.do('restore the database schema', async () => {
    const schema = await schemaOf(env, run);
    await createTables(db, schema.entries);
    return schema.tables;
  });
  const recorded = new Map(summary.tables.map((table) => [table.name, table]));
  const copied = tables.filter((plan) => !plan.derived) as TablePlan[];
  await restoreTables(env, step, summary, db, copied);
  await step.do('restore indexes, triggers and views', async () => {
    await createRest(db, (await schemaOf(env, run)).entries);
    return true;
  });
  const read: { name: string; rows: number; hash: string }[] = [];
  for (const plan of copied) read.push({ name: plan.name, ...(await step.do(`read back table ${plan.name}`, () => dumpTable(db, plan))) });
  const mismatched = copied
    .filter((plan, index) => {
      const want = recorded.get(plan.name);
      return !want || want.rows !== read[index]!.rows || want.hash !== read[index]!.hash;
    })
    .map((plan) => plan.name);
  return {
    tables: read.length,
    expectedRows: summary.tables.reduce((sum, table) => sum + table.rows, 0),
    restoredRows: read.reduce((sum, table) => sum + table.rows, 0),
    mismatched,
    derived: tables.length - copied.length,
    expectedHash: await rollUp(summary.tables.map((table) => table.hash)),
    restoredHash: await rollUp(read.map((table) => table.hash)),
  };
}

/** Restores `summary`'s run into `targets` and reads every restored table back. Shared by the drill and a restore. */
async function restoreInto(env: BackupEnv, step: Step, summary: RunSummary, targets: Targets, tools: Tools): Promise<Omit<RestoreOutput, 'action' | 'seconds' | 'cleanedUp'> & { restoredAt: number }> {
  const run = summary.run;
  const sources = await restoreBuckets(env, step, summary, targets);
  const d1: RestoreOutput['d1'] = targets.db ? await restoreDatabase(env, step, summary, targets.db) : null;
  const restoredAt = await step.do('restored', async () => tools.now());
  const sourcesOk = SOURCES.every((source) => {
    const s = sources[source];
    if (!targets.buckets[source]) return true;
    return s !== undefined && s.failed === 0 && s.restored.objects === s.expected.objects && s.restored.bytes === s.expected.bytes && s.restored.hash === s.expected.hash;
  });
  const d1Ok = d1 === null || (d1.mismatched.length === 0 && d1.tables === summary.tables.length && d1.expectedHash === d1.restoredHash);
  return { run, ok: sourcesOk && d1Ok, sources, d1, restoredAt };
}

/** Runs a restore drill from the chosen backup run. */
export async function runDrill(env: BackupEnv, step: Step, wanted: string | undefined, tools: Tools): Promise<RestoreOutput> {
  const started = await step.do('start', async () => tools.now());
  const summary = await step.do('choose the run', () => chooseRun(env.BACKUP, wanted));
  await step.do('prepare the scratch copies', async () => {
    await onlyUnder(env.SCRATCH, [DRILL], 'scratch-bucket-not-ours');
    const objects = SOURCES.reduce((sum, source) => sum + summary.sources[source].objects, 0);
    const bytes = SOURCES.reduce((sum, source) => sum + summary.sources[source].bytes, 0);
    const sizes = await Promise.all([env.BACKUP, ...SOURCES.map((source) => env[BUCKET[source]])].map((bucket) => measure(bucket)));
    const used = sizes.reduce((sum, size) => sum + size.bytes, 0);
    if (used + bytes > STORAGE_CAP_BYTES) throw new BackupError('storage-cap', `restoring ${bytes} bytes beside the ${used} stored would pass the free-tier storage cap`);
    if (objects > MAX_WRITES_PER_RUN) throw new BackupError('write-cap', `restoring ${objects} objects would pass the write cap`);
    const tables = await userTables(env.SCRATCH_DB);
    if (tables.length > 0 && !tables.includes(MARKER_TABLE)) throw new BackupError('scratch-database-not-ours', `the scratch database holds ${tables.length} tables and no drill marker`);
    await deleteUnder(env.SCRATCH, DRILL);
    await dropAll(env.SCRATCH_DB);
    await env.SCRATCH_DB.prepare(`CREATE TABLE ${MARKER_TABLE} (run TEXT NOT NULL)`).run();
    return true;
  });
  const buckets = Object.fromEntries(SOURCES.map((source) => [source, { bucket: env.SCRATCH, key: (key: string) => drillKey(source, key) }])) as Record<Source, Target>;
  const result = await restoreInto(env, step, summary, { buckets, db: env.SCRATCH_DB }, tools);
  const cleanedUp = await step.do('empty the scratch copies', async () => {
    await deleteUnder(env.SCRATCH, DRILL);
    await dropAll(env.SCRATCH_DB);
    return (await isEmpty(env.SCRATCH)) && (await userTables(env.SCRATCH_DB)).length === 0;
  });
  const finished = await step.do('finish', async () => tools.now());
  const { restoredAt, ...rest } = result;
  const output: RestoreOutput = { action: 'drill', ...rest, ok: rest.ok && cleanedUp, seconds: { restore: seconds(started, restoredAt), total: seconds(started, finished) }, cleanedUp };
  await step.do('record the drill', async () => {
    await env.BACKUP.put(drillRecordKey(finished), JSON.stringify({ finished: new Date(finished).toISOString(), ...output }), { httpMetadata: { contentType: 'application/json' } });
    return true;
  });
  return output;
}

/** Restores the chosen parts from the chosen backup run. */
export async function runRestore(env: BackupEnv, step: Step, wanted: string, only: readonly Part[], tools: Tools): Promise<RestoreOutput> {
  const started = await step.do('start', async () => tools.now());
  const summary = await step.do('choose the run', () => chooseRun(env.BACKUP, wanted));
  await step.do('check every target is empty', async () => {
    for (const source of SOURCES) if (only.includes(source) && !(await isEmpty(env[BUCKET[source]]))) throw new BackupError('target-not-empty', `the ${source} bucket is not empty; a restore only fills an empty one`);
    if (only.includes('d1') && (await userTables(env.DB)).length > 0) throw new BackupError('target-not-empty', 'the database is not empty; a restore only fills an empty one');
    return true;
  });
  const buckets = Object.fromEntries(SOURCES.filter((source) => only.includes(source)).map((source) => [source, { bucket: env[BUCKET[source]], key: (key: string) => key }]));
  const result = await restoreInto(env, step, summary, { buckets, db: only.includes('d1') ? env.DB : null }, tools);
  const finished = await step.do('finish', async () => tools.now());
  const { restoredAt, ...rest } = result;
  return { action: 'restore', ...rest, seconds: { restore: seconds(started, restoredAt), total: seconds(started, finished) }, cleanedUp: false };
}

/** Runs the backup, drill or restore that the params ask for. */
export function runWorkflow(env: BackupEnv, step: Step, params: Params, run: string, tools: Tools): Promise<BackupOutput | RestoreOutput> {
  if (params.action === 'drill') return runDrill(env, step, params.run, tools);
  if (params.action === 'restore') return runRestore(env, step, params.run, params.only, tools);
  return runBackup(env, step, run, tools);
}
