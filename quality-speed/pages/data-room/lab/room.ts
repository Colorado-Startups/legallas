// SPDX-License-Identifier: Apache-2.0
// Brings the fictional room up on a Linux CI runner: settings from the examples, the committed extract cache, dev:seed,
// the local keyword index, the build, then legallas-mcp and the room under `wrangler dev --local`. Every wrangler call is
// local and the settings are the examples', so nothing here can reach a real room.
//
// Keyword search with no change to the product: the local month's AI Search allowance is marked spent, which is the state
// a room reaches in production when its month runs out. Ask then runs the real keyword search over page_fts
// (worker/routes/ask.ts spendGate, worker/retrieval.ts), and ASK_MOCK only replaces the model's answer. legallas-mcp gets
// there with MCP_SEARCH_MOCK=keyword (mcp/dev-search.ts).
import { spawn, type ChildProcess } from 'node:child_process';
import { copyFile, mkdir, open, readFile, stat, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import path from 'node:path';
import { startEdge } from './edge.ts';
import { CACHE_DIR, coverage, coverageProblem, installCache, recordFiles, syncExpectation, textlessEntries } from './extract-cache.ts';
import { seedResult, type SeedResult } from './report.ts';
import { devSeed, indexJob, wrangler } from './web.ts';

const { seedPaths } = devSeed;
const { loadManifest } = indexJob;
const { cliWrangler } = wrangler;

export const WEB_DIR = path.resolve(import.meta.dirname, '..', '..', '..', '..', 'web');
/** MCP_DEV_ORIGIN in .dev.vars.example names this port, and mcp:smoke's default base. */
export const MCP_PORT = 8790;
export const ROOM_PORT = 8789;
/** The room's Worker, behind the lab's edge (edge.ts) on ROOM_PORT. */
export const WORKER_PORT = 8788;
const SERVER_WAIT_S = 90;

/** The pages the lab times read the case picture, which comes with pro's routes, so the settings must run pro's entry. */
export function fullProduct(example: string): string {
  if (!/^\s*"main":\s*"[^"]*entry-pro\.ts"/m.test(example)) throw new Error('The example settings no longer run pro\'s entry');
  return example;
}

/** The months to mark spent: this one and the next, so a run across midnight UTC stays on keyword search. */
export function spentMonthSql(now: Date): string {
  const month = (offset: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1)).toISOString().slice(0, 7);
  const row = (period: string) => `('search_semantic', '${period}', 1000000000)`;
  return `INSERT OR REPLACE INTO spend_counters (meter, period, used) VALUES ${row(month(0))}, ${row(month(1))};`;
}

/** The example's vars, with legallas-mcp on the real keyword index in place of its local scan (mcp/dev-search.ts). */
export function labDevVars(example: string): string {
  for (const line of [/^ASK_MOCK=1$/m, /^MCP_SEARCH_MOCK=1$/m, /^ALLOW_DEV_IDENTITY=1$/m]) if (!line.test(example)) throw new Error('.dev.vars.example changed what the lab relies on');
  return example.replace(/^MCP_SEARCH_MOCK=1$/m, 'MCP_SEARCH_MOCK=keyword');
}

/** Path to control number, as the room shows them, from the rows the seed left (dev-seed.ts fixes the prefix). */
export function controlsMap(rows: readonly Record<string, unknown>[]): Record<string, string> {
  const entries = rows.flatMap((row) => (typeof row.control_seq === 'number' ? [[String(row.path), `DOE-${String(row.control_seq).padStart(6, '0')}`] as const] : []));
  return Object.fromEntries(entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

const exists = (file: string) => stat(file).then(() => true, () => false);

/** Stops beside a room's settings: they are in no commit, so overwriting them loses them. */
export async function refuseRoomSettings(): Promise<void> {
  for (const name of ['wrangler.jsonc', 'wrangler.mcp.jsonc', '.dev.vars', 'legallas.config.json', 'room.config.json']) {
    if (await exists(path.join(WEB_DIR, name))) throw new Error(`web/${name} exists: this runs only on a clean checkout, never beside a room's settings`);
  }
}

/** Writes the settings from the examples. */
async function writeSettings(): Promise<void> {
  await refuseRoomSettings();
  await writeFile(path.join(WEB_DIR, '.dev.vars'), labDevVars(await readFile(path.join(WEB_DIR, '.dev.vars.example'), 'utf8')));
  await writeFile(path.join(WEB_DIR, 'wrangler.jsonc'), fullProduct(await readFile(path.join(WEB_DIR, 'wrangler.example.jsonc'), 'utf8')));
  await writeFile(path.join(WEB_DIR, 'wrangler.mcp.jsonc'), fullProduct(await readFile(path.join(WEB_DIR, 'wrangler.mcp.example.jsonc'), 'utf8')));
}

function run(command: string, args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    spawn(command, args, { cwd: WEB_DIR, stdio: 'inherit' })
      .on('error', reject)
      .on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${command} ${args.slice(0, 2).join(' ')} exited ${code}`))));
  });
}

/** Runs `work` and records its seconds under `name`, so a slow step shows on the Actions page. */
export async function timed<T>(seconds: Record<string, number>, name: string, work: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try {
    return await work();
  } finally {
    seconds[name] = Math.round((performance.now() - start) / 100) / 10;
  }
}

/** Compares what the seed left with what the plan says it should. Counts only. */
async function verifySeed(root: string, source?: string): Promise<SeedResult> {
  const expected = syncExpectation(await recordFiles(source));
  const manifest = await loadManifest(seedPaths(root).cache, 'local');
  // A document that failed has no entry at all; one with no text has an entry with no parts.
  const remaining = [...expected.indexed];
  let indexed = 0;
  for (const { sha256: sha } of Object.values(manifest)) {
    const at = remaining.indexOf(sha);
    if (at >= 0) {
      remaining.splice(at, 1);
      indexed += 1;
    }
  }
  const textless = await textlessEntries(CACHE_DIR);
  const [row] = await cliWrangler('local').d1Query(
    "SELECT (SELECT COUNT(*) FROM documents WHERE removed_at IS NULL AND source = 'mirror') AS documents, " +
      "(SELECT COUNT(*) FROM page_fts_docs WHERE fingerprint <> '') AS keyword",
  );
  return seedResult({
    documentsExpected: expected.documents,
    documents: Number(row?.documents ?? 0),
    indexedExpected: expected.indexed.length,
    indexed,
    keywordExpected: expected.indexed.filter((sha) => !textless.has(sha)).length,
    keywordDocuments: Number(row?.keyword ?? 0),
  });
}

/** A folder of invented documents already built, and the manifest that goes with it. Neither means the dev fixture. */
export interface BuiltRecord {
  source?: string;
  inputs?: string;
}

/** The room type whose folder keeps every fixture document, so its case picture resolves. The others have none. */
export const hasMatter = (room: string) => room === 'dispute';

/** Gives the seed's matter step the manifest exactly as build.ts wrote it, under the name it reads in a fixtures folder. */
export async function copyManifest(inputs: string): Promise<void> {
  await copyFile(path.join(inputs, 'matter.json'), path.join(inputs, 'matter.example.json'));
}

/** Builds one room of the invented record under `root`. */
export async function buildRecord(room: string, root: string): Promise<BuiltRecord> {
  const built = { source: path.join(root, 'record'), inputs: path.join(root, 'record-inputs') };
  await run('node', [path.resolve(WEB_DIR, '..', 'quality-speed', 'pages', 'data-room', 'gold', 'build.ts'), '--room', room, '--out', built.source, '--inputs', built.inputs]);
  if (!hasMatter(room)) return { source: built.source };
  await copyManifest(built.inputs);
  return built;
}

/** Everything before the servers. Fails at once when the cache does not cover the fixture, before any Mac-only step is tried. */
export async function seedRoom(root: string, seconds: Record<string, number>, built: BuiltRecord = {}): Promise<SeedResult> {
  const { source, inputs } = built;
  // An entry this room does not use may belong to another room.
  const problem = coverageProblem({ ...(await coverage(await recordFiles(source), CACHE_DIR)), stale: [] });
  if (problem) throw new Error(problem);
  await writeSettings();
  const paths = seedPaths(root);
  await mkdir(paths.cache, { recursive: true, mode: 0o700 });
  process.stdout.write(`Extract cache: ${await installCache(CACHE_DIR, paths.cache)} entries installed.\n`);
  const record = [...(source ? ['--source', source] : []), ...(inputs ? ['--inputs', inputs] : [])];
  await timed(seconds, 'seed', () => run('npm', ['run', 'dev:seed', '--', '--out', root, ...record]));
  await timed(seconds, 'keywordIndex', () => run('node', ['scripts/fts-index.ts', '--local', '--apply', '--manifest', path.join(paths.cache, 'index-manifest.local.json')]));
  await cliWrangler('local').d1Query(spentMonthSql(new Date()));
  return verifySeed(root, source);
}

export interface Servers {
  stop(): Promise<void>;
}

async function serve(name: string, port: number, inspector: number, logs: string, extra: readonly string[]): Promise<ChildProcess> {
  const log = await open(path.join(logs, `${name}.log`), 'w');
  const args = ['wrangler', 'dev', ...extra, '--local', '--port', String(port), '--inspector-port', String(inspector), '--show-interactive-dev-session=false'];
  // Its own process group, so stopping it also stops the workerd it starts.
  const child = spawn('npx', args, { cwd: WEB_DIR, stdio: ['ignore', log.fd, log.fd], detached: true, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
  // The child has its own copy of the descriptor.
  await log.close();
  for (let second = 0; second < SERVER_WAIT_S; second += 1) {
    if (child.exitCode !== null) throw new Error(`${name} exited ${child.exitCode} before it answered: see logs/${name}.log`);
    const up = await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(2000), redirect: 'manual' }).then(() => true, () => false);
    if (up) {
      process.stdout.write(`${name} answers on localhost:${port} after ${second} s\n`);
      return child;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`${name} did not answer on localhost:${port} after ${SERVER_WAIT_S} s: see logs/${name}.log`);
}

/** One after the other, legallas-mcp first: the room's MCP_GRANTS binding calls it, and two starting at once can pick the same port for the socket that links them. */
export async function startServers(logs: string): Promise<Servers> {
  await mkdir(logs, { recursive: true });
  const started: ChildProcess[] = [];
  let edge: Server | null = null;
  const stop = async () => {
    edge?.close();
    for (const child of started) {
      if (child.pid === undefined || child.exitCode !== null) continue;
      const gone = new Promise((resolve) => child.once('exit', resolve));
      process.kill(-child.pid, 'SIGTERM');
      await Promise.race([gone, new Promise((resolve) => setTimeout(resolve, 5000))]);
    }
  };
  try {
    started.push(await serve('mcp', MCP_PORT, 9230, logs, ['-c', 'wrangler.mcp.jsonc']));
    // request.url keeps localhost:ROOM_PORT, so the room's same-origin write check still matches the browser's Origin.
    started.push(await serve('room', WORKER_PORT, 9229, logs, ['--local-upstream', `localhost:${ROOM_PORT}`]));
    edge = await startEdge(ROOM_PORT, WORKER_PORT);
    process.stdout.write(`edge answers on localhost:${ROOM_PORT}, gzip as Cloudflare's defaults\n`);
  } catch (error) {
    await stop();
    throw error;
  }
  return { stop };
}

export const buildRoom = () => run('npm', ['run', 'build']);

/** For a run with nothing installed yet. No install scripts, as in ci.yml's checks. */
export const installWeb = () => run('npm', ['ci', '--ignore-scripts']);
