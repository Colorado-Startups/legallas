// SPDX-License-Identifier: Apache-2.0
// npm test. `node --test` gives every test file a process of its own, which loads and compiles the file's modules again,
// once per file. Here test files share a process (--test-isolation=none), so a module loads once per process, unless a
// file, or a project file it imports, changes what another file would see: a global, the console, the clock, timers, a
// hook outside any test (SHARED_STATE), or process listeners, exit code or environment (PROCESS_STATE). Such a file runs
// alone, as before. A module that fills a registry when it loads (REGISTERS: mcp/pro.ts, worker/index.ts) changes what
// every file in its process sees, so a file that loads one shares only with files that load the same ones. The slowest
// files start first, alone, so none is left for last.
//
//   node scripts/run-tests.ts [--test-concurrency=4] [other node --test flags] <globs>
//
// --test-concurrency is how many processes run at once. Each process's report prints when it ends; a reporter
// destination file gets one part per process, joined in order at the end. The testing lab (quality-speed/pages/testing)
// still runs each risk's tests alone, so a test that passes only beside others is caught there.
import { spawn } from 'node:child_process';
import { existsSync, globSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import path from 'node:path';

/** The slowest files in the testing lab's suite runs (7 Nov): each starts first, in a process of its own. */
export const FIRST: readonly string[] = ['scripts/iwork.test.ts', 'scripts/room-sync.test.ts', 'mcp/tools/overview-profile.test.ts'];

/** Code that changes what another file in the same process sees. A file with any of these, or importing one, runs alone. */
export const SHARED_STATE: readonly RegExp[] = [
  // A global, or a built-in's method, set or mocked: directly, through a cast, through an alias, or by Object.assign.
  /\bglobalThis(?:\.\w+|\[[^\]]+\])\s*(?:\?\?|\|\||&&)?=(?!=)/,
  /\(\s*globalThis\s+as\b[^;\n]*?\)(?:\.\w+|\[[^\]]+\])\s*(?:\?\?|\|\||&&)?=(?!=)/,
  /=\s*globalThis\s+as\b/,
  /\bObject\.assign\(\s*globalThis\b/,
  /(?<!:\s*)\b(?:console|Date|Math|JSON|Intl|crypto|performance|navigator)\.\w+\s*=(?!=)/,
  /\bmock\.(?:method|getter|setter|property)\(\s*(?:globalThis|console|process|Date|Math|JSON|Intl|crypto|performance|navigator)\b/,
  /\bdefineProperty\(\s*(?:globalThis|console|process)\b/,
  // node:test's own `mock` and its timers: not restored when a test ends.
  /\bmock\.timers\b/,
  /^import\b[^;]*\bmock\b[^;]*from\s*['"]node:test['"]/m,
  // A hook outside any test: in a shared process it runs around every file's tests.
  /^(?:before|after|beforeEach|afterEach)\(/m,
];

/** The same for the process. Checked in the test file only: a script's CLI sets them when run, not when a test imports it. */
export const PROCESS_STATE: readonly RegExp[] = [
  /\bprocess\.(?:on|once|addListener|prependListener|chdir|exit|exitCode|umask)\b/,
  /\bprocess\.env(?:\.\w+|\[[^\]]+\])\s*(?:\?\?|\|\||&&)?=(?!=)|\bdelete\s+process\.env\b|\bprocess\.env\s*=(?!=)/,
];

/** A module that fills a registry when it loads: a call at column 0 to extend…() or register…() (mcp/extensions.ts, worker/extensions.ts). */
export const REGISTERS = /^(?:await\s+)?\w*(?:extend|register)\w*\(/m;

/** The project files `file` loads by a relative path: by import or export … from (not `import type`, erased at run time), or by import(). */
function imports(file: string, text: string): { loaded: string[]; later: string[] } {
  const at = (m: RegExpMatchArray) => path.join(path.dirname(file), m.at(-1)!);
  const loaded = [
    ...[...text.matchAll(/^\s*(?:import|export)\s+(type\s)?[^;]*?\bfrom\s*['"](\.\.?\/[^'"]+)['"]/gm)].filter((m) => !m[1]),
    ...text.matchAll(/^\s*import\s*['"](\.\.?\/[^'"]+)['"]/gm),
  ].map(at);
  return { loaded, later: [...text.matchAll(/\bimport\(\s*['"](\.\.?\/[^'"]+)['"]/g)].map(at) };
}

/**
 * Where `file` must run. `read` gives a file's text, or null. Null: alone. Otherwise a pool of files that may share a
 * process: '' for the files that load no REGISTERS module, else the modules they load, at any depth.
 */
export function pool(file: string, read: (file: string) => string | null): string | null {
  const own = read(file) ?? '';
  const matches = (text: string, list: readonly RegExp[]) => list.some((re) => re.test(text));
  if (matches(own, [...SHARED_STATE, ...PROCESS_STATE, REGISTERS])) return null;
  const { loaded, later: dynamic } = imports(file, own);
  if ([...loaded, ...dynamic].some((f) => matches(read(f) ?? '', SHARED_STATE))) return null;
  const registers = new Set<string>();
  let later = false;
  const seen = new Set<string>();
  const walk = (f: string, dynamic: boolean): void => {
    if (seen.has(f)) return;
    seen.add(f);
    const text = read(f);
    if (text === null) return;
    if (f !== file && REGISTERS.test(text)) {
      if (dynamic) later = true;
      registers.add(f);
    }
    const next = imports(f, text);
    for (const g of next.loaded) walk(g, dynamic);
    for (const g of next.later) walk(g, true);
  };
  walk(file, false);
  // Loaded inside a test, a registration changes the state partway through the file: alone, as before.
  return later ? null : [...registers].sort().join(' ');
}

export interface Job {
  files: string[];
  /** One file in a process of its own, as `node --test` runs it. */
  alone: boolean;
}

/**
 * The processes to run, in the order they start: each of FIRST alone, then the shared processes (about `shared` of
 * them, each a run of neighbouring files from one pool, which load the same modules), then every file that runs alone.
 */
export function plan(files: readonly string[], poolOf: (file: string) => string | null, shared: number): Job[] {
  const sorted = [...new Set(files)].sort();
  const first = FIRST.filter((f) => sorted.includes(f));
  const lone: string[] = [];
  const pools = new Map<string, string[]>([['', []]]);
  for (const f of sorted.filter((f) => !first.includes(f))) {
    const key = poolOf(f);
    if (key === null) lone.push(f);
    else pools.set(key, [...(pools.get(key) ?? []), f]);
  }
  const size = Math.max(1, Math.ceil([...pools.values()].reduce((n, list) => n + list.length, 0) / shared));
  const jobs: Job[] = first.map((f) => ({ files: [f], alone: true }));
  for (const list of pools.values()) {
    const chunks = Math.ceil(list.length / size);
    for (let i = 0; i < chunks; i++) jobs.push({ files: list.slice(Math.floor((i * list.length) / chunks), Math.floor(((i + 1) * list.length) / chunks)), alone: false });
  }
  return [...jobs, ...lone.map((f) => ({ files: [f], alone: true }))];
}

export interface Args {
  concurrency: number;
  /** Reporter and destination flags, in order, as node --test pairs them. */
  reporters: string[];
  destinations: string[];
  /** Every other flag, passed to each process. */
  flags: string[];
  globs: string[];
}

export function parse(argv: readonly string[]): Args {
  const args: Args = { concurrency: availableParallelism(), reporters: [], destinations: [], flags: [], globs: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const [name, inline] = arg.startsWith('--') ? [arg.split('=')[0]!, arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : undefined] : [arg, undefined];
    const value = () => inline ?? argv[++i] ?? '';
    if (name === '--test-concurrency') args.concurrency = Math.max(1, Number(value()) || 1);
    else if (name === '--test-reporter') args.reporters.push(value());
    else if (name === '--test-reporter-destination') args.destinations.push(value());
    else if (name === '--test-isolation') value();
    else if (arg.startsWith('-')) args.flags.push(arg);
    else args.globs.push(arg);
  }
  return args;
}

/** A process's destination for each reporter: its own part of each file, so processes never write one file at once. */
export const part = (destination: string, job: number) => (destination === 'stdout' || destination === 'stderr' ? destination : `${destination}.${job}`);

function run(job: Job, index: number, args: Args): Promise<{ code: number; output: string; ms: number }> {
  const started = Date.now();
  const argv = [
    '--test',
    `--test-isolation=${job.alone ? 'process' : 'none'}`,
    ...args.reporters.map((r) => `--test-reporter=${r}`),
    ...args.destinations.map((d) => `--test-reporter-destination=${part(d, index)}`),
    ...args.flags,
    ...job.files,
  ];
  return new Promise((resolve) => {
    const child = spawn(process.execPath, argv, { env: { ...process.env, ...(process.stdout.isTTY ? { FORCE_COLOR: '1' } : {}) } });
    const chunks: Buffer[] = [];
    child.stdout.on('data', (b: Buffer) => chunks.push(b));
    child.stderr.on('data', (b: Buffer) => chunks.push(b));
    child.on('close', (code) => resolve({ code: code ?? 1, output: Buffer.concat(chunks).toString(), ms: Date.now() - started }));
  });
}

async function main(): Promise<void> {
  const args = parse(process.argv.slice(2));
  const files = args.globs.flatMap((g) => globSync(g, { exclude: (f) => path.basename(f) === 'node_modules' }));
  if (files.length === 0) {
    console.error(`run-tests: no test file matches ${args.globs.join(' ')}`);
    process.exit(1);
  }
  const texts = new Map<string, string | null>();
  const read = (f: string) => {
    if (!texts.has(f)) texts.set(f, existsSync(f) ? readFileSync(f, 'utf8') : null);
    return texts.get(f)!;
  };
  const jobs = plan(files, (f) => pool(f, read), 2 * args.concurrency);
  const started = Date.now();
  const failed: Job[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(args.concurrency, jobs.length) }, async () => {
    while (next < jobs.length) {
      const index = next++;
      const job = jobs[index]!;
      const { code, output, ms } = await run(job, index, args);
      if (code !== 0) failed.push(job);
      const what = job.files.length === 1 ? job.files[0] : `${job.files.length} files, ${job.files[0]} to ${job.files.at(-1)}`;
      process.stdout.write(`${output}\nrun-tests: ${what}: ${code === 0 ? 'passed' : `failed (exit ${code})`}, ${(ms / 1000).toFixed(1)} s\n\n`);
    }
  }));
  // Each reporter's destination: its parts, joined in the order the processes started.
  for (const d of args.destinations.filter((d) => d !== 'stdout' && d !== 'stderr')) {
    writeFileSync(d, jobs.map((_, i) => (existsSync(part(d, i)) ? readFileSync(part(d, i), 'utf8') : '')).join(''));
    jobs.forEach((_, i) => rmSync(part(d, i), { force: true }));
  }
  const alone = jobs.filter((j) => j.alone).length;
  console.log(`run-tests: ${files.length} files in ${jobs.length} processes (${alone} alone, ${jobs.length - alone} shared), ${failed.length} failed, ${((Date.now() - started) / 1000).toFixed(1)} s`);
  for (const job of failed) console.log(`run-tests: failed: ${job.files.join(' ')}`);
  process.exitCode = failed.length ? 1 : 0;
}

if (import.meta.main) await main();
