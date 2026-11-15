// SPDX-License-Identifier: Apache-2.0
// Every Cloudflare call sync makes goes through this interface, so the apply logic can be tested with a
// fake. The real implementation shells out to `npx wrangler` (no shell, arguments as an array) in web/.
// It also reads wrangler's own login: the OAuth token and the account id that REST calls need.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { MATTER_KEY } from '../worker/matter-types.ts';
import type { LocalFile, SyncPlan } from './diff.ts';
import { parseJson } from './mcp-oauth.ts';
import { STORED_NAME } from '../worker/stored-name.ts';

export type Target = 'local' | 'remote';

export const DATABASE = STORED_NAME;
export const FILES_BUCKET = `${STORED_NAME}-files`;
export const INDEX_BUCKET = `${STORED_NAME}-index`;
export const AI_SEARCH_INSTANCE = STORED_NAME;

const REMOTE_R2_CONCURRENCY = 6;

/**
 * How many R2 calls sync keeps in flight. The local R2 emulator (seen with wrangler 4.145.0) answers
 * concurrent `r2 object put --local` calls with intermittent 500s, so local runs go one at a time.
 */
export function r2Concurrency(target: Target): number {
  return target === 'local' ? 1 : REMOTE_R2_CONCURRENCY;
}

/** What an index part's text was built from: its file and the reader's version. */
export interface IndexText {
  sha256: string;
  stamp: { extractor?: number; render?: number; text?: number };
}

export interface Wrangler {
  readonly target: Target;
  /** Runs one read-only statement and returns its rows. */
  d1Query(sql: string): Promise<Record<string, unknown>[]>;
  /** Applies a SQL file. */
  d1File(file: string): Promise<void>;
  /** `text` names the document text an index part belongs to, which the room records (room-sync.ts); SQL targets ignore it. */
  r2Put(bucket: string, key: string, file: string, contentType: string, text?: IndexText): Promise<void>;
  r2Get(bucket: string, key: string, file: string): Promise<void>;
  r2Delete(bucket: string, key: string): Promise<void>;
  /** True when the installed wrangler has `ai-search jobs create`. */
  aiSearchJobsAvailable(): Promise<boolean>;
  aiSearchJobCreate(instance: string): Promise<void>;
  /** The room's record of each live document's text, where the room keeps one (room-sync.ts). */
  indexRecord?(): Promise<Record<string, { sha256: string; parts: number; extractor?: number; render?: number; text?: number }>>;
  /**
   * Present when the room takes a sync's record as a plan, through its endpoints (room-sync.ts), never SQL. The room
   * then keeps what a sync replaces, so apply.ts deletes no original.
   */
  record?: SyncRecordWriter;
  /** Stops anything this wrangler keeps running (local-r2.ts). */
  close?(): Promise<void>;
}

/** Writes a sync's record without SQL. */
export interface SyncRecordWriter {
  apply(plan: SyncPlan<LocalFile>, now: string, pages: ReadonlyMap<string, number>): Promise<void>;
  markPulled(ids: readonly string[], now: string): Promise<void>;
}

// R2 keys sync writes are random UUIDs or text/<uuid>.p<n>.md. Anything else is refused.
const KEY = /^(?:text\/)?[0-9a-f-]{36}(?:\.p[1-9][0-9]*\.md)?$/;
const WEB_DIR = path.resolve(import.meta.dirname, '..');
const MAX_OUTPUT = 256 * 1024 * 1024;

export function assertKey(key: string): string {
  if (!KEY.test(key)) throw new Error('Refusing an R2 key that sync did not generate');
  return key;
}

// Counsel uploads get their keys from the Worker; pulls accept any plain, opaque-looking key.
const READ_KEY = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$/;

export function assertReadKey(key: string): string {
  if (!READ_KEY.test(key) || key.includes('..')) throw new Error('Refusing an unexpected R2 key');
  return key;
}

/** Extracts the result rows from `wrangler d1 execute --json` output. */
export function parseD1Json(stdout: string): Record<string, unknown>[] {
  const start = stdout.indexOf('[');
  if (start < 0) throw new Error('wrangler d1 execute returned no JSON');
  const parsed: unknown = JSON.parse(stdout.slice(start));
  const first = Array.isArray(parsed) ? (parsed[0] as { results?: unknown; success?: unknown }) : null;
  if (!first || first.success === false || !Array.isArray(first.results)) throw new Error('wrangler d1 execute did not succeed');
  return first.results as Record<string, unknown>[];
}

const TAIL_LINES = 4;
const TAIL_LINE_CHARS = 240;
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;
// Wrangler's own footers (the bug-report prompts and the pointer to its log file, a local path) and npx's
// `npm notice run 'wrangler' ...` lines, which echo the whole command, SQL and file arguments included.
const BOILERPLATE = /If you think this is a bug|Would you like to report this error|Logs were written to|^npm (?:notice|warn)\b/i;
// `[code: N]` ends the line under wrangler's `✘ [ERROR]` headline that says what the Cloudflare API refused.
const ERRORISH = /error|statusCode|CF-R2-Error|failed|✘|\[code: \d+\]/i;
// An absolute or home-relative path that starts a word or a quoted string. URLs (`https://`) and
// bucket/key pairs (`legallas-files/<uuid>`) do not start that way, so they are left alone.
const LOCAL_PATH = /(^|[\s'"(=])~?\/[^\s'"()]+/g;

/**
 * The few lines of a failed wrangler run that explain it, for the error sync shows. Lines that look like
 * errors win over progress lines; with none, the last non-blank lines are kept. Local paths are masked and
 * long lines cut, so neither file names nor file contents leave this function.
 */
export function errorTail(stderr: string, stdout: string): string {
  const lines = `${stderr}\n${stdout}`
    .replace(ANSI, '')
    .split(/\r?\n/)
    .map((line) => line.trim().replace(LOCAL_PATH, '$1<path>').slice(0, TAIL_LINE_CHARS))
    .filter((line) => line !== '' && !BOILERPLATE.test(line));
  const unique = [...new Set(lines)];
  const errors = unique.filter((line) => ERRORISH.test(line));
  return (errors.length > 0 ? errors.slice(0, TAIL_LINES) : unique.slice(-TAIL_LINES)).join('\n');
}

export type WranglerRun = (args: string[]) => Promise<string>;

const INSTALLED = path.join(WEB_DIR, 'node_modules', '.bin', 'wrangler');

/**
 * How to start wrangler here, with no shell. On Windows `npx` is a batch file, which Node won't start without one, and
 * arguments that hold SQL or a path must never meet a shell, so node runs wrangler's own script. Elsewhere it is the installed
 * CLI itself, because a local seed makes hundreds of calls and npx adds its own start-up to each, or npx where the install has
 * no such file. Either way it is the lockfile's wrangler.
 */
export function wranglerCommand(args: readonly string[], platform: NodeJS.Platform = process.platform, installed = existsSync(INSTALLED)): [string, string[]] {
  if (platform === 'win32') return [process.execPath, [path.win32.join(WEB_DIR, 'node_modules', 'wrangler', 'bin', 'wrangler.js'), ...args]];
  return installed ? [INSTALLED, [...args]] : ['npx', ['wrangler', ...args]];
}

export function wrangler(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const [command, commandArgs] = wranglerCommand(args);
    execFile(command, commandArgs, { cwd: WEB_DIR, maxBuffer: MAX_OUTPUT, encoding: 'utf8' }, (error, stdout, stderr) => {
      if (!error) return resolve(stdout);
      // Only the command verb and the lines of wrangler's own message that explain it: never file contents.
      reject(new Error(`wrangler ${args.slice(0, 3).join(' ')} failed:\n${errorTail(stderr, stdout)}`));
    });
  });
}

/** Wrangler in web/, stdout only. Failures name the verb, never output (which may hold a token). */
export const runWrangler: WranglerRun = (args) =>
  new Promise((resolve, reject) => {
    const [command, commandArgs] = wranglerCommand(args);
    execFile(command, commandArgs, { cwd: WEB_DIR, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }, (error, stdout) => {
      if (error) reject(new Error(`wrangler ${args.slice(0, 2).join(' ')} failed`));
      else resolve(stdout);
    });
  });

function jsonFrom(stdout: string): unknown {
  const start = stdout.search(/[[{]/);
  if (start < 0) throw new Error('wrangler returned no JSON');
  return parseJson(stdout.slice(start), 'wrangler output');
}

/** Wrangler's current OAuth (or API) token, from `wrangler auth token --json`. */
export async function wranglerToken(run: WranglerRun = runWrangler): Promise<string> {
  const parsed = jsonFrom(await run(['auth', 'token', '--json'])) as { token?: unknown };
  if (typeof parsed.token !== 'string' || !parsed.token) throw new Error('wrangler auth token returned no token (run `npx wrangler login`)');
  return parsed.token;
}

/** CLOUDFLARE_ACCOUNT_ID, else the only account `wrangler whoami --json` lists. */
export async function accountId(env: NodeJS.ProcessEnv = process.env, run: WranglerRun = runWrangler): Promise<string> {
  if (env.CLOUDFLARE_ACCOUNT_ID) return env.CLOUDFLARE_ACCOUNT_ID;
  const parsed = jsonFrom(await run(['whoami', '--json'])) as { accounts?: { id?: unknown }[] };
  const ids = (parsed.accounts ?? []).map((a) => a.id).filter((id): id is string => typeof id === 'string');
  if (ids.length !== 1) throw new Error('set CLOUDFLARE_ACCOUNT_ID (wrangler lists more or fewer than one account)');
  return ids[0]!;
}

/**
 * The arguments of the one R2 write the matter build makes: the built manifest (an absolute path to a file
 * named matter.json) to legallas-files at MATTER_KEY. Never legallas-index, which AI Search reads; the bucket
 * and key are fixed here, so no caller can redirect the write. assertKey stays UUID-only for sync.
 */
export function matterPutArgs(target: Target, file: string): string[] {
  if (target !== 'local' && target !== 'remote') throw new Error('Refusing an unknown wrangler target');
  if (!path.isAbsolute(file) || path.basename(file) !== 'matter.json') throw new Error('Refusing to publish anything but a built matter.json');
  return ['r2', 'object', 'put', `${FILES_BUCKET}/${MATTER_KEY}`, '--file', file, '--content-type', 'application/json', `--${target}`];
}

/** Uploads the built manifest. `run` is injectable for tests. */
export async function r2PutMatter(target: Target, file: string, run: WranglerRun = wrangler): Promise<void> {
  await run(matterPutArgs(target, file));
}

export function cliWrangler(target: Target): Wrangler {
  const where = `--${target}`;
  let jobs: Promise<boolean> | null = null;
  return {
    target,
    async d1Query(sql) {
      return parseD1Json(await wrangler(['d1', 'execute', DATABASE, where, '--json', '--command', sql]));
    },
    async d1File(file) {
      await wrangler(['d1', 'execute', DATABASE, where, '--yes', '--file', file]);
    },
    async r2Put(bucket, key, file, contentType) {
      await wrangler(['r2', 'object', 'put', `${bucket}/${assertKey(key)}`, '--file', file, '--content-type', contentType, where]);
    },
    async r2Get(bucket, key, file) {
      await wrangler(['r2', 'object', 'get', `${bucket}/${assertReadKey(key)}`, '--file', file, where]);
    },
    async r2Delete(bucket, key) {
      await wrangler(['r2', 'object', 'delete', `${bucket}/${assertKey(key)}`, where]);
    },
    aiSearchJobsAvailable() {
      jobs ??= wrangler(['ai-search', 'jobs', '--help']).then(
        (help) => /jobs create/.test(help),
        () => false,
      );
      return jobs;
    },
    async aiSearchJobCreate(instance) {
      await wrangler(['ai-search', 'jobs', 'create', instance]);
    },
  };
}
