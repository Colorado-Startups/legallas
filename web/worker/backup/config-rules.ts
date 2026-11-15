// SPDX-License-Identifier: Apache-2.0
// The rules for the backup Worker's config (wrangler.backup.jsonc): what it must bind, and what it must never confuse.
// worker/backup/config.test.ts holds the example and a room's own file to them; `npm run backup` checks them again
// before it starts a run. Problems name bindings, never a bucket name, database id or hostname.

/** The Workflow `npm run backup` starts, and the class it runs (worker/backup/entry.ts). */
export const WORKFLOW_NAME = 'legallas-backup';
/** The class name of the backup Workflow. */
export const WORKFLOW_CLASS = 'RoomBackup';

const ROOM_BUCKETS = ['FILES', 'INDEX', 'LAW'] as const;
const OWN_BUCKETS = ['BACKUP', 'SCRATCH'] as const;

interface BucketBinding {
  binding?: string;
  bucket_name?: string;
}

interface DatabaseBinding {
  binding?: string;
  database_name?: string;
  database_id?: string;
}

/** The fields the rules read from a Wrangler config. */
export interface WranglerShape {
  workers_dev?: boolean;
  preview_urls?: boolean;
  route?: unknown;
  routes?: unknown[];
  triggers?: { crons?: unknown[] };
  r2_buckets?: BucketBinding[];
  d1_databases?: DatabaseBinding[];
  workflows?: { name?: string; class_name?: string }[];
  observability?: { traces?: { enabled?: boolean }; logs?: { invocation_logs?: boolean } };
}

/** What is wrong with `backup`, given the room Worker's own config `room`. Empty when a run may start. */
export function backupConfigProblems(backup: WranglerShape, room: WranglerShape): string[] {
  const problems: string[] = [];
  const buckets = new Map((backup.r2_buckets ?? []).map((b) => [b.binding, b.bucket_name]));
  const databases = new Map((backup.d1_databases ?? []).map((d) => [d.binding, d]));
  const roomBuckets = new Map((room.r2_buckets ?? []).map((b) => [b.binding, b.bucket_name]));
  const roomDb = (room.d1_databases ?? []).find((d) => d.binding === 'DB');

  for (const name of [...ROOM_BUCKETS, ...OWN_BUCKETS]) if (!buckets.get(name)) problems.push(`no ${name} bucket`);
  for (const name of ['DB', 'SCRATCH_DB']) if (!databases.get(name)?.database_id) problems.push(`no ${name} database`);
  for (const name of ROOM_BUCKETS) if (buckets.get(name) && buckets.get(name) !== roomBuckets.get(name)) problems.push(`${name} is not the room's ${name} bucket`);
  if (!roomDb || databases.get('DB')?.database_id !== roomDb.database_id) problems.push("DB is not the room's database");

  const roomNames = new Set([...roomBuckets.values(), ...ROOM_BUCKETS.map((name) => buckets.get(name))].filter(Boolean));
  for (const name of OWN_BUCKETS) if (roomNames.has(buckets.get(name))) problems.push(`${name} is one of the room's buckets`);
  if (buckets.get('BACKUP') && buckets.get('BACKUP') === buckets.get('SCRATCH')) problems.push('BACKUP and SCRATCH are the same bucket');
  const db = databases.get('DB');
  const scratch = databases.get('SCRATCH_DB');
  if (db && scratch && (db.database_id === scratch.database_id || db.database_name === scratch.database_name)) problems.push("SCRATCH_DB is the room's database");

  if (backup.workers_dev !== false || backup.preview_urls !== false) problems.push('workers.dev and preview URLs must be off');
  if (backup.route !== undefined || (backup.routes ?? []).length > 0) problems.push('the backup Worker takes no route');
  if ((backup.triggers?.crons ?? []).length > 0) problems.push("a schedule goes on the Workflow (workflows[].schedules), not on a cron trigger");
  const flow = (backup.workflows ?? []).find((w) => w.class_name === WORKFLOW_CLASS);
  if (!flow || flow.name !== WORKFLOW_NAME) problems.push(`no ${WORKFLOW_NAME} Workflow running ${WORKFLOW_CLASS}`);
  if (backup.observability?.traces?.enabled !== false) problems.push('traces stay off: spans can record R2 keys');
  if (backup.observability?.logs?.invocation_logs !== false) problems.push('invocation logs stay off');
  return problems;
}

/** The bucket name a config binds as `binding`. */
export function bucketName(config: WranglerShape, binding: string): string | undefined {
  return (config.r2_buckets ?? []).find((b) => b.binding === binding)?.bucket_name;
}
