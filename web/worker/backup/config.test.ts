// SPDX-License-Identifier: Apache-2.0
// Guards on wrangler.backup.jsonc, or the example when a checkout has no room file (wrangler-config.ts): the backup
// Worker binds the room's own buckets and database, its backup and scratch copies are neither, nothing reaches it from
// the internet, and its schedule ships off.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readWranglerConfig } from '../wrangler-config.ts';
import { backupConfigProblems, WORKFLOW_CLASS, WORKFLOW_NAME, type WranglerShape } from './config-rules.ts';

const backup = readWranglerConfig('wrangler.backup');
const room = readWranglerConfig('wrangler', backup.example);

test('the backup config passes every rule npm run backup checks', () => {
  assert.deepEqual(backupConfigProblems(backup.config, room.config), []);
});

test('the Worker is only the Workflow: its entry exports the class the config names', () => {
  assert.equal(backup.config.main, './worker/backup/entry.ts');
  const entry = readFileSync(join(import.meta.dirname, 'entry.ts'), 'utf8');
  assert.match(entry, new RegExp(`^export class ${WORKFLOW_CLASS} extends WorkflowEntrypoint<`, 'm'));
  assert.deepEqual(backup.config.workflows.map((w: { name: string }) => w.name), [WORKFLOW_NAME]);
});

test('the example ships with no schedule: the owner turns daily backups on', { skip: !backup.example && "a room's own config may schedule them" }, () => {
  for (const flow of backup.config.workflows) assert.equal(flow.schedules, undefined);
});

test('the rules catch a scratch or backup copy pointed at the room, and a reachable Worker', () => {
  const swap = (field: 'r2_buckets' | 'd1_databases', binding: string, change: Record<string, string>): WranglerShape => ({
    ...backup.config,
    [field]: backup.config[field].map((b: { binding: string }) => (b.binding === binding ? { ...b, ...change } : b)),
  });
  const files = backup.config.r2_buckets.find((b: { binding: string }) => b.binding === 'FILES').bucket_name;
  const db = backup.config.d1_databases.find((d: { binding: string }) => d.binding === 'DB');
  assert.ok(backupConfigProblems(swap('r2_buckets', 'SCRATCH', { bucket_name: files }), room.config).includes("SCRATCH is one of the room's buckets"));
  assert.ok(backupConfigProblems(swap('r2_buckets', 'BACKUP', { bucket_name: files }), room.config).includes("BACKUP is one of the room's buckets"));
  assert.ok(backupConfigProblems(swap('d1_databases', 'SCRATCH_DB', { database_id: db.database_id }), room.config).includes("SCRATCH_DB is the room's database"));
  assert.ok(backupConfigProblems(swap('r2_buckets', 'FILES', { bucket_name: 'another-bucket' }), room.config).includes("FILES is not the room's FILES bucket"));
  assert.ok(backupConfigProblems({ ...backup.config, workers_dev: true }, room.config).includes('workers.dev and preview URLs must be off'));
  assert.ok(backupConfigProblems({ ...backup.config, routes: [{ pattern: 'backup.example.com' }] }, room.config).includes('the backup Worker takes no route'));
  assert.ok(backupConfigProblems({ ...backup.config, observability: { traces: { enabled: true }, logs: { invocation_logs: false } } }, room.config).length > 0);
});

test('problems name bindings, never a bucket name or database id', () => {
  const problems = backupConfigProblems({ r2_buckets: [{ binding: 'BACKUP', bucket_name: 'secret-bucket-name' }], d1_databases: [{ binding: 'DB', database_id: 'secret-id' }] }, room.config);
  assert.ok(problems.length > 0);
  for (const problem of problems) assert.doesNotMatch(problem, /secret/);
});
