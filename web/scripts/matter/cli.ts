// SPDX-License-Identifier: Apache-2.0
// Card F4. The matter build: the room's case picture, built from the catalog and the drafting fragments.
//
//   npm run matter -- build      resolve, validate and write <cacheDir>/matter/build/matter.json (+ .sha256)
//   npm run matter -- check      the same in memory; fails on unresolved cites, problems or R5 exclusions
//   npm run matter -- diff       counts added/removed/changed per list versus the published manifest
//   npm run matter -- report     write <cacheDir>/matter/build/report.html for the owner's GATE 1 review
//   npm run matter -- publish --expect <sha256>   upload the reviewed build to legallas-files at meta/matter.json
//   --local   use the local D1 and R2 (wrangler dev state) instead of production
//   --config <file>  another legallas.config.json
//
// Output goes only under <cacheDir>/matter/ (never the repo or the case folder), and the terminal gets counts
// only: names, titles, paths and ids stay in the files, which are mode 600.
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import type { Matter } from '../../worker/matter-types.ts';
import { configuredInternalNotes, DEFAULT_CONFIG_PATH, loadSyncConfig, type SyncConfig } from '../config.ts';
import { cliWrangler, FILES_BUCKET, r2PutMatter, type Target, type WranglerRun } from '../wrangler.ts';
import { MATTER_KEY } from '../../worker/matter-types.ts';
import { buildFromDisk, serialize, type BuildInfo, type Built } from './build.ts';
import type { CatalogNote, InternalNote } from './catalog.ts';
import { exclusions, tally } from './checks.ts';
import { diffMatter, formatDiff } from './diff.ts';
import { assertSafeOutput, matterPaths, readBuilt, sha256, writePrivate } from './paths.ts';
import { renderReport } from './report.ts';
import { loadResolver } from './resolve.ts';
import { validateMatter } from './validate.ts';

/** The commands the matter tool runs. */
export const COMMANDS = ['build', 'check', 'diff', 'report', 'publish'] as const;
/** One command of the matter tool. */
export type Command = (typeof COMMANDS)[number];

/** The parsed arguments of the matter tool: the command and its target. */
export interface MatterOptions {
  command: Command;
  target: Target;
  expect: string | null;
  config: string;
}

const USAGE = 'usage: npm run matter -- <build|check|diff|report|publish --expect <sha256>> [--local] [--config <file>]';

/** Parses the matter tool's arguments; throws the usage text for an unknown command. */
export function parseMatterArgs(args: readonly string[]): MatterOptions {
  const [command, ...rest] = args;
  if (!(COMMANDS as readonly string[]).includes(command ?? '')) throw new Error(USAGE);
  const options: MatterOptions = { command: command as Command, target: 'remote', expect: null, config: DEFAULT_CONFIG_PATH };
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === '--local') options.target = 'local';
    else if (arg === '--expect' && /^[0-9a-f]{64}$/.test(rest[i + 1] ?? '')) options.expect = rest[++i];
    else if (arg === '--config' && rest[i + 1]) options.config = path.resolve(rest[++i]);
    else throw new Error(USAGE);
  }
  if (options.command === 'publish' && !options.expect) throw new Error(`publish needs --expect <sha256> from the reviewed build\n${USAGE}`);
  if (options.command !== 'publish' && options.expect) throw new Error(`--expect only applies to publish\n${USAGE}`);
  return options;
}

/** "2 rows (not yet summarized 1, rename or move 2)": a count of rows and of each note, never a path. */
function catalogNoteCounts(notes: readonly CatalogNote[]): string {
  if (notes.length === 0) return 'none';
  const rows = new Set(notes.map((n) => n.path)).size;
  const kinds = [...tally(notes, (n) => n.note)].map(([k, v]) => `${k} ${v}`).join(', ');
  return `${rows} ${rows === 1 ? 'row' : 'rows'} (${kinds})`;
}

/** The counts a run prints. Locations and text stay in the report. */
export function formatSummary(info: BuildInfo): string {
  const counts = Object.entries(info.counts).map(([k, v]) => `${k} ${v}`).join(', ');
  const flags = [...tally(info.flags, (f) => f.keyword)].map(([k, v]) => `${k} ${v}`).join(', ') || 'none';
  const rules = [...tally(info.exclusions, (e) => e.rule)].map(([k, v]) => `${k} ${v}`).join(', ') || 'none';
  const catalog = info.catalog ? `catalog rows ${info.catalog.rows} (not in the room ${info.catalog.notInRoom}, skipped ${info.catalog.skipped})` : 'no catalog';
  return [
    `Entries: ${counts}`,
    `Sources: ${catalog}`,
    `Unresolved cites: ${info.unresolved.length}; unresolved doc entries: ${info.unresolvedDocs.length}; problems: ${info.problems.length}`,
    `Validation: ${info.validation === null ? 'passes' : `refused: ${info.validation}`}`,
    `Exclusions: ${rules}`,
    `Keyword flags: ${flags}`,
    `Catalog internal notes (flagged only): ${catalogNoteCounts(info.catalogNotes)}`,
  ].join('\n');
}

/** True when the build may go to the owner: nothing unresolved, no problems, no excluded kinds. */
export function passes(info: BuildInfo): boolean {
  return (
    info.validation === null && info.unresolved.length === 0 && info.unresolvedDocs.length === 0 &&
    info.problems.length === 0 && info.exclusions.length === 0
  );
}

/** What the matter commands depend on: the sync config and the room's internal notes. */
export interface Deps {
  config: SyncConfig;
  /** The room config's internalNotes. */
  internalNotes?: readonly InternalNote[];
  /** Reads the live mirror rows. */
  d1Query: (sql: string) => Promise<Record<string, unknown>[]>;
  r2Get: (bucket: string, key: string, file: string) => Promise<void>;
  run?: WranglerRun;
  now: () => Date;
  log: (line: string) => void;
}

async function assemble(deps: Deps): Promise<Built> {
  const resolver = await loadResolver({ d1Query: deps.d1Query }, deps.config.sourceRoot);
  return buildFromDisk(deps.config.sourceRoot, deps.config.cacheDir, resolver, deps.now(), deps.internalNotes);
}

type StoredInfo = BuildInfo & { sha256: string | null };

async function readInfo(file: string): Promise<StoredInfo> {
  try {
    const stored = JSON.parse(await readFile(file, 'utf8')) as Omit<StoredInfo, 'catalogNotes'> & { catalogNotes?: CatalogNote[] };
    // Builds from before catalogNotes existed read as having none.
    return { ...stored, catalogNotes: stored.catalogNotes ?? [] };
  } catch {
    throw new Error('No build info yet: run `npm run matter -- build` first');
  }
}

async function build(deps: Deps): Promise<number> {
  const paths = matterPaths(deps.config.cacheDir);
  const { matter, info } = await assemble(deps);
  if (!matter) {
    // Nothing valid to publish: drop any earlier build so it cannot be mistaken for this one.
    await Promise.all([paths.matter, paths.sha].map((file) => rm(file, { force: true })));
    await writePrivate(paths.info, `${JSON.stringify({ ...info, sha256: null }, null, 2)}\n`);
    deps.log('Build refused: no matter.json written. `npm run matter -- report` lists the issues.');
    deps.log(formatSummary(info));
    return 1;
  }
  const text = serialize(matter);
  const sha = sha256(text);
  await writePrivate(paths.matter, text);
  await writePrivate(paths.sha, `${sha}  matter.json\n`);
  await writePrivate(paths.info, `${JSON.stringify({ ...info, sha256: sha }, null, 2)}\n`);
  deps.log(`Built matter.json (${Buffer.byteLength(text)} bytes), sha256 ${sha}`);
  deps.log(formatSummary(info));
  deps.log(passes(info) ? 'Check: passes.' : 'Check: FAILS. See `npm run matter -- report`.');
  return 0;
}

async function check(deps: Deps): Promise<number> {
  const { info } = await assemble(deps);
  deps.log(formatSummary(info));
  deps.log(passes(info) ? 'Check: passes.' : 'Check: FAILS. Run build and report for the locations.');
  return passes(info) ? 0 : 1;
}

async function report(deps: Deps): Promise<number> {
  const paths = matterPaths(deps.config.cacheDir);
  const info = await readInfo(paths.info);
  let matter: Matter | null = null;
  if (info.sha256 !== null) {
    const built = await readBuilt(paths);
    if (info.sha256 !== built.sha) throw new Error('matter.json changed since it was built: run build again');
    matter = JSON.parse(built.text) as Matter;
  }
  await writePrivate(paths.report, renderReport(matter, info, info.sha256));
  deps.log(matter ? `Wrote report.html for build ${info.sha256}` : 'Wrote report.html with the issues of a refused build');
  deps.log(formatSummary(info));
  return 0;
}

const NOT_FOUND = /not.?found|does not exist|NoSuchKey|\b404\b|10007/i;

async function fetchPublished(deps: Deps): Promise<Matter | null> {
  const paths = matterPaths(deps.config.cacheDir);
  const temp = path.join(paths.build, 'published.json');
  try {
    await deps.r2Get(FILES_BUCKET, MATTER_KEY, temp);
    return JSON.parse(await readFile(temp, 'utf8')) as Matter;
  } catch (error) {
    if (NOT_FOUND.test((error as Error).message)) return null;
    throw error;
  } finally {
    await rm(temp, { force: true });
  }
}

async function diff(deps: Deps): Promise<number> {
  const built = JSON.parse((await readBuilt(matterPaths(deps.config.cacheDir))).text) as Matter;
  const published = await fetchPublished(deps);
  deps.log(formatDiff(diffMatter(published, built), published !== null));
  return 0;
}

async function publish(deps: Deps, target: Target, expect: string): Promise<number> {
  const paths = matterPaths(deps.config.cacheDir);
  const built = await readBuilt(paths);
  if (built.sha !== expect) throw new Error('The built manifest does not match --expect: rebuild and review the report again');
  const { matter, error } = validateMatter(JSON.parse(built.text), deps.now());
  if (!matter) throw new Error(`The built manifest no longer validates: ${error}`);
  const info = await readInfo(paths.info);
  if (info.sha256 !== built.sha) throw new Error('Build info does not match matter.json: run build again');
  if (exclusions(matter, new Map(Object.entries(info.paths))).length > 0 || !passes(info)) {
    throw new Error('This build does not pass check: fix it before publishing');
  }
  await r2PutMatter(target, paths.matter, deps.run);
  deps.log(`Published ${built.sha} to the ${target} room (${Buffer.byteLength(built.text)} bytes).`);
  return 0;
}

/** Runs one subcommand after the output guard. Returns the exit code. */
export async function runMatter(options: MatterOptions, deps: Deps): Promise<number> {
  await assertSafeOutput(matterPaths(deps.config.cacheDir).build, deps.config.sourceRoot);
  switch (options.command) {
    case 'build': return build(deps);
    case 'check': return check(deps);
    case 'report': return report(deps);
    case 'diff': return diff(deps);
    case 'publish': return publish(deps, options.target, options.expect ?? '');
  }
}

async function main(): Promise<void> {
  const options = parseMatterArgs(process.argv.slice(2));
  const config = await loadSyncConfig(options.config);
  const w = cliWrangler(options.target);
  const deps: Deps = {
    config,
    internalNotes: configuredInternalNotes(options.config),
    d1Query: (sql) => w.d1Query(sql),
    r2Get: (bucket, key, file) => w.r2Get(bucket, key, file),
    now: () => new Date(),
    log: (line) => process.stdout.write(`${line}\n`),
  };
  process.exitCode = await runMatter(options, deps);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
