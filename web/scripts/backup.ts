// SPDX-License-Identifier: Apache-2.0
// The owner's backup command. It starts the legallas-backup Workflow (worker/backup/, wrangler.backup.jsonc) in the
// room's own Cloudflare account, waits, and prints what the run returned: counts, bytes and SHA-256 hashes. The copying
// happens inside Cloudflare, bucket to bucket; no file, key, name or row reaches this computer or this terminal.
//
//   npm run backup                                    copy the room into the backup bucket
//   npm run backup -- --drill [--run <run>]           restore the newest (or named) run into the scratch copies, check
//                                                     every count and hash, then empty the scratch copies
//   npm run backup -- --restore <run> --only <parts> --yes
//                                                     restore into the room's own buckets or database; each must be
//                                                     empty (made again after a loss). parts: files,index,law,d1
//   --no-wait   start the run and print its id; the Cloudflare dashboard shows the rest
//
// Before it starts anything it checks wrangler.backup.jsonc against the room's wrangler.jsonc (config-rules.ts) and
// that the backup bucket sits in another location than the room's files.
import { setTimeout as sleep } from 'node:timers/promises';
import { readWranglerConfig, hasRoomConfig } from '../worker/wrangler-config.ts';
import { backupConfigProblems, bucketName, WORKFLOW_NAME, type WranglerShape } from '../worker/backup/config-rules.ts';
import { BACKUP_ERROR_CODES, PARTS, RUN_ID, SOURCES, type Part } from '../worker/backup/layout.ts';
import { wranglerTokens } from './law/replica.ts';
import { accountId } from './wrangler.ts';

const API = 'https://api.cloudflare.com/client/v4';
const USAGE = 'usage: npm run backup -- [--drill [--run <run>] | --restore <run> --only files,index,law,d1 --yes] [--no-wait]';
const POLL_MS = 10_000;

export type Params = { action: 'backup' } | { action: 'drill'; run?: string } | { action: 'restore'; run: string; only: Part[] };

export interface Options {
  params: Params;
  wait: boolean;
}

export function parseArgs(args: readonly string[]): Options {
  let action: Params['action'] = 'backup';
  let run: string | undefined;
  let only: Part[] | undefined;
  let yes = false;
  let wait = true;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const value = args[i + 1];
    if (arg === '--drill' && action === 'backup') action = 'drill';
    else if (arg === '--restore' && action === 'backup' && value && RUN_ID.test(value)) [action, run] = ['restore', args[++i]!];
    else if (arg === '--run' && value && RUN_ID.test(value)) run = args[++i];
    else if (arg === '--only' && value) {
      only = [...new Set(args[++i]!.split(','))] as Part[];
      if (!only.every((part) => (PARTS as readonly string[]).includes(part))) throw new Error(USAGE);
    } else if (arg === '--yes') yes = true;
    else if (arg === '--no-wait') wait = false;
    else throw new Error(USAGE);
  }
  if (action === 'backup' && (run || only || yes)) throw new Error(USAGE);
  if (action === 'drill' && (only || yes)) throw new Error(USAGE);
  if (action === 'restore') {
    if (!only || !yes) throw new Error(`a restore writes into the room's own buckets or database: name them with --only and confirm with --yes\n${USAGE}`);
    return { params: { action, run: run!, only }, wait };
  }
  if (action === 'drill') return { params: run ? { action: 'drill', run } : { action: 'drill' }, wait };
  return { params: { action: 'backup' }, wait };
}

/** A Cloudflare API call. Failures carry the HTTP status and Cloudflare's error codes, never the path or body. */
export type Api = (method: 'GET' | 'POST', path: string, body?: unknown) => Promise<unknown>;

export function cloudflareApi(token: () => Promise<string>, fetchImpl: typeof fetch = fetch): Api {
  return async (method, path, body) => {
    const response = await fetchImpl(`${API}${path}`, {
      method,
      headers: { authorization: `Bearer ${await token()}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const parsed = (await response.json().catch(() => null)) as { success?: boolean; result?: unknown; errors?: { code?: unknown }[] } | null;
    if (!response.ok || !parsed?.success) {
      const codes = (parsed?.errors ?? []).map((error) => error.code).filter((code) => typeof code === 'number');
      throw new Error(`Cloudflare API ${method} answered ${response.status}${codes.length ? ` (codes ${codes.join(', ')})` : ''}`);
    }
    return parsed.result;
  };
}

/** Both configs, checked. Throws with every problem when a run must not start. */
export function checkedConfigs(read = readWranglerConfig, own = hasRoomConfig): { backup: WranglerShape; room: WranglerShape } {
  if (!own('wrangler.backup')) throw new Error('No wrangler.backup.jsonc: copy wrangler.backup.example.jsonc and fill in its database IDs (README.md, "Backup and restore").');
  if (!own('wrangler')) throw new Error("No wrangler.jsonc: the backup checks its bindings against the room's own.");
  const backup = read('wrangler.backup', false).config as WranglerShape;
  const room = read('wrangler', false).config as WranglerShape;
  const problems = backupConfigProblems(backup, room);
  if (problems.length > 0) throw new Error(`wrangler.backup.jsonc is not safe to run:\n- ${problems.join('\n- ')}`);
  return { backup, room };
}

/** Refuses a backup bucket in the same location as the room's files: the second copy must be elsewhere. */
export async function checkLocations(api: Api, account: string, backup: WranglerShape): Promise<string> {
  const where = async (binding: string) => {
    const result = (await api('GET', `/accounts/${account}/r2/buckets/${encodeURIComponent(bucketName(backup, binding)!)}`)) as { location?: unknown };
    return typeof result?.location === 'string' ? result.location.toUpperCase() : '';
  };
  const [files, copy] = await Promise.all([where('FILES'), where('BACKUP')]);
  if (!files || !copy) throw new Error('Cloudflare did not say where the buckets are; check the backup bucket exists.');
  if (files === copy) throw new Error(`The backup bucket is in ${copy}, the same location as the room's files. Create it with another --location (README.md, "Backup and restore").`);
  return `room files in ${files}, backup in ${copy}`;
}

interface Instance {
  status?: unknown;
  output?: unknown;
  error?: { name?: unknown; message?: unknown } | null;
}

const DONE = new Set(['complete', 'errored', 'terminated']);

export async function startRun(api: Api, account: string, params: Params): Promise<string> {
  const result = (await api('POST', `/accounts/${account}/workflows/${WORKFLOW_NAME}/instances`, { params })) as { id?: unknown };
  if (typeof result?.id !== 'string') throw new Error('Cloudflare did not return the run id');
  return result.id;
}

export async function waitFor(api: Api, account: string, id: string, pause: (ms: number) => Promise<unknown> = sleep, log: (line: string) => void = console.log): Promise<Instance> {
  let polls = 0;
  for (;;) {
    const instance = (await api('GET', `/accounts/${account}/workflows/${WORKFLOW_NAME}/instances/${encodeURIComponent(id)}`)) as Instance;
    if (typeof instance?.status === 'string' && DONE.has(instance.status)) return instance;
    polls += 1;
    if (polls % 6 === 0) log(`still running (${polls * (POLL_MS / 1000)} s)`);
    await pause(POLL_MS);
  }
}

// Only these shapes are printed: a number, a 64-hex hash, a run id, a table name. Anything else prints as "?".
const num = (value: unknown): string => (typeof value === 'number' && Number.isFinite(value) ? String(value) : '?');
const hash = (value: unknown): string => (typeof value === 'string' && /^[0-9a-f]{64}$/.test(value) ? value : '?');
const runId = (value: unknown): string => (typeof value === 'string' && RUN_ID.test(value) ? value : '?');
const tableName = (value: unknown): string => (typeof value === 'string' && /^[A-Za-z0-9_]{1,64}$/.test(value) ? value : '?');
const field = (value: unknown, key: string): unknown => (value !== null && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined);
const gb = (bytes: unknown): string => (typeof bytes === 'number' ? `${(bytes / 1e9).toFixed(2)} GB` : '?');

/** What a finished run returned, as lines for the terminal, read field by field so nothing else can print. */
export function formatOutput(output: unknown): string[] {
  const action = field(output, 'action');
  const ok = field(output, 'ok') === true;
  const sources = field(output, 'sources');
  const d1 = field(output, 'd1');
  if (action === 'backup') {
    const lines = [`Backup ${runId(field(output, 'run'))}: done in ${num(field(output, 'seconds'))} s.`];
    for (const source of SOURCES) {
      const s = field(sources, source);
      lines.push(`  ${source.padEnd(6)} ${num(field(s, 'objects'))} objects, ${num(field(s, 'bytes'))} bytes; ${num(field(s, 'copied'))} new (${num(field(s, 'copiedBytes'))} bytes), ${num(field(s, 'skipped'))} changed mid-run; sha256 ${hash(field(s, 'hash'))}`);
    }
    lines.push(`  d1     ${num(field(d1, 'tables'))} tables, ${num(field(d1, 'rows'))} rows (${num(field(d1, 'derived'))} page-text tables rebuilt by the indexer after a restore); sha256 ${hash(field(d1, 'hash'))}`);
    const storage = field(output, 'storage');
    lines.push(`  R2 storage the run sees: ${gb(field(storage, 'usedBytes'))} of the ${gb(field(storage, 'capBytes'))} cap. Old run folders pruned: ${num(field(output, 'pruned'))}.`);
    return lines;
  }
  if (action === 'drill' || action === 'restore') {
    const time = field(output, 'seconds');
    const verdict = ok ? 'PASSED' : 'FAILED';
    const lines = [`${action === 'drill' ? 'Drill' : 'Restore'} of ${runId(field(output, 'run'))}: ${verdict}. Restored in ${num(field(time, 'restore'))} s, ${num(field(time, 'total'))} s in all.`];
    for (const source of SOURCES) {
      const s = field(sources, source);
      if (s === undefined) continue;
      const want = field(s, 'expected');
      const got = field(s, 'restored');
      const same = field(want, 'hash') === field(got, 'hash') && field(want, 'objects') === field(got, 'objects') && field(s, 'failed') === 0;
      lines.push(`  ${source.padEnd(6)} ${num(field(got, 'objects'))}/${num(field(want, 'objects'))} objects, ${num(field(got, 'bytes'))}/${num(field(want, 'bytes'))} bytes, ${num(field(s, 'failed'))} failed the SHA-256 check; manifest sha256 ${same ? 'matches' : 'DIFFERS'} ${hash(field(got, 'hash'))}`);
    }
    if (d1 !== undefined && d1 !== null) {
      const mismatched = field(d1, 'mismatched');
      const names = Array.isArray(mismatched) ? mismatched.map(tableName) : [];
      lines.push(`  d1     ${num(field(d1, 'tables'))} tables, ${num(field(d1, 'restoredRows'))}/${num(field(d1, 'expectedRows'))} rows; sha256 ${field(d1, 'expectedHash') === field(d1, 'restoredHash') ? 'matches' : 'DIFFERS'} ${hash(field(d1, 'restoredHash'))}${names.length ? `; differing tables: ${names.join(', ')}` : ''}`);
    }
    if (action === 'drill') lines.push(`  scratch copies emptied: ${field(output, 'cleanedUp') === true ? 'yes' : 'NO'}. Dated record: drills/ in the backup bucket.`);
    else lines.push('  Next: point wrangler.jsonc at any database made again, deploy, and run the page-text indexer (README.md, "Backup and restore").');
    return lines;
  }
  return ['The run returned nothing this command reads.'];
}

const OWN_ERROR = /^(?:\w*Error: )?([a-z0-9-]+): ([\w ,.;'()-]{1,200})$/;

/**
 * A failed run's reason. The backup's own errors (layout.ts BackupError) carry counts only and print; anything else
 * (the runtime's, R2's or D1's own text, which can name a key) points at the dashboard instead.
 */
export function formatError(instance: Instance): string {
  const message = field(instance.error, 'message');
  const own = typeof message === 'string' ? OWN_ERROR.exec(message) : null;
  const status = typeof instance.status === 'string' ? instance.status : 'stopped';
  if (own && (BACKUP_ERROR_CODES as readonly string[]).includes(own[1]!)) return `The run ${status}: ${own[1]}: ${own[2]}`;
  return `The run ${status}. Its steps and error are in the Cloudflare dashboard: Workers & Pages, Workflows, ${WORKFLOW_NAME}.`;
}

export interface Deps {
  api: Api;
  account: string;
  backup: WranglerShape;
  log: (line: string) => void;
  pause?: (ms: number) => Promise<unknown>;
}

/** Checks, starts, waits, prints. True when the run finished and, for a drill or restore, every check passed. */
export async function backupCommand(options: Options, deps: Deps): Promise<boolean> {
  deps.log(`Locations: ${await checkLocations(deps.api, deps.account, deps.backup)}.`);
  const id = await startRun(deps.api, deps.account, options.params);
  deps.log(`Started ${options.params.action} run ${id} in your Cloudflare account.`);
  if (!options.wait) return true;
  const instance = await waitFor(deps.api, deps.account, id, deps.pause, deps.log);
  if (instance.status !== 'complete') {
    deps.log(formatError(instance));
    return false;
  }
  for (const line of formatOutput(instance.output)) deps.log(line);
  return field(instance.output, 'ok') === true;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const { backup } = checkedConfigs();
  const account = await accountId();
  const tokens = wranglerTokens();
  const ok = await backupCommand(options, { api: cloudflareApi(() => tokens.get()), account, backup, log: (line) => console.log(line) });
  if (!ok) process.exitCode = 1;
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(`Backup failed: ${error instanceof Error ? error.message.slice(0, 600) : 'error'}`);
    process.exitCode = 1;
  });
}
