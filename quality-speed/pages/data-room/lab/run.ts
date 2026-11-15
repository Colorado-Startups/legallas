// SPDX-License-Identifier: Apache-2.0
// The lab: brings up the fictional room on a CI runner, drives it, and writes report.json with one frame per journey. No key,
// no cost, no Mac: PDF text comes from the committed extract cache. Every number is a lab number (report.ts says what that
// means). Run it through the "Sample room lab" workflow; it refuses to run outside CI.
//
//   node quality-speed/pages/data-room/lab/run.ts --out <dir> --room <scratch dir> [--install] [--record <room type>] [--only <ids>] [--samples 20] [--questions <file>]
//
// --install runs `npm ci` in web/ first, for a job that has only checked out and set up Node. --record seeds one room type of
// the invented record (../gold, forming, raising-angel, raising-vc or dispute) with its question set, instead of the dev
// fixture with the smoke questions. One room per run, so one per job. --room holds the room's files and the wrangler caches;
// only --out is worth keeping. --only runs just these journeys (comma-separated ids), since a throttled run is long and a lane need
// only pay for what it reads. Asking for citation-to-page also asks, because the citation comes from an answer.
//
// The exit code is non-zero when report.failed is true, and report.json is written either way, so a short seed shows on the
// Data room page as a failed run rather than as numbers from half a room.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { goldQuestions } from './gold-set.ts';
import { askAndCite, connector, filterDocuments, Lab, loadQuestions, openDocument, pageLoad, THROTTLE, type QuestionSet } from './journeys.ts';
import { REPORT_SCHEMA, runFailed, type JourneyResult, type LabReport } from './report.ts';
import { mcpFlow, mcpSmoke, wrangler } from './web.ts';
import { buildRecord, buildRoom, controlsMap, hasMatter, installWeb, MCP_PORT, ROOM_PORT, seedRoom, startServers, timed } from './room.ts';

/** The routes timed as cold loads. Chronology shows the case picture, so it counts only in a room that has one. */
export function loadRoutes(record?: string): readonly [string, string][] {
  const always: [string, string][] = [['load-overview', '/'], ['load-documents', '/documents/']];
  return !record || hasMatter(record) ? [...always, ['load-chronology', '/chronology/']] : always;
}

const USAGE = 'usage: node run.ts --out <dir> --room <scratch dir> [--install] [--record <room type>] [--only <ids>] [--samples <n>] [--questions <file>]';

export interface RunOptions {
  out: string;
  room: string;
  samples: number;
  questions: string;
  install: boolean;
  record?: string;
  /** Journey ids to run; every journey when absent. */
  only?: string[];
}

export function parseRunArgs(args: readonly string[]): RunOptions {
  const options: RunOptions = {
    out: '', room: '', samples: 20, questions: path.join(import.meta.dirname, 'smoke-questions.json'), install: false,
  };
  for (let i = 0; i < args.length; i += 2) {
    if (args[i] === '--install') {
      options.install = true;
      i -= 1;
      continue;
    }
    const value = args[i + 1];
    if (!value) throw new Error(USAGE);
    if (args[i] === '--out') options.out = path.resolve(value);
    else if (args[i] === '--room') options.room = path.resolve(value);
    else if (args[i] === '--questions') options.questions = path.resolve(value);
    else if (args[i] === '--record' && /^[a-z-]{1,20}$/.test(value)) options.record = value;
    else if (args[i] === '--only' && /^[a-z-]+(,[a-z-]+)*$/.test(value)) options.only = value.split(',');
    else if (args[i] === '--samples' && /^[1-9][0-9]?$/.test(value)) options.samples = Number(value);
    else throw new Error(USAGE);
  }
  if (!options.out || !options.room) throw new Error(USAGE);
  return options;
}

/** path -> document id, from the room the seed just made. Writes controls.json on the way: path -> control number, for the question sets. */
async function documentIds(out: string): Promise<Map<string, string>> {
  const rows = await wrangler.cliWrangler('local').d1Query('SELECT id, path, control_seq FROM documents WHERE removed_at IS NULL');
  await writeFile(path.join(out, 'controls.json'), `${JSON.stringify(controlsMap(rows), null, 1)}\n`);
  return new Map(rows.map((row) => [String(row.path), String(row.id)]));
}

function idOf(ids: ReadonlyMap<string, string>, rel: string): string {
  const id = ids.get(rel);
  if (!id) throw new Error(`The question set names a document the room does not have: ${rel}`);
  return id;
}

async function drive(options: RunOptions, set: QuestionSet, ids: ReadonlyMap<string, string>, report: LabReport): Promise<void> {
  const lab = await Lab.open(process.env.CHROME_PATH || 'google-chrome', `http://localhost:${ROOM_PORT}`, options.out);
  const journeys: JourneyResult[] = report.journeys;
  const wanted = (...journey: string[]) => !options.only || journey.some((id) => options.only!.includes(id)); // safe: checked just before
  const documentId = idOf(ids, set.documents[0]!.path); // safe: the set's documents are checked in main
  try {
    // First, so its one client registration is over a minute old by the time the smoke needs the room's registration limit.
    if (wanted('connector-search', 'connector-read-page')) journeys.push(...(await connector(`http://localhost:${MCP_PORT}`, set.questions, ids, documentId, options.samples)));
    for (const [id, route] of loadRoutes(options.record)) if (wanted(id)) journeys.push(await pageLoad(lab, id, route, options.samples));
    if (wanted('filter-documents')) journeys.push(await filterDocuments(lab, set.filter, idOf(ids, set.filter.path), options.samples));
    for (const doc of set.documents) if (wanted(doc.id)) journeys.push(await openDocument(lab, doc.id, idOf(ids, doc.path), doc.page, options.samples));
    if (wanted('ask', 'citation-to-page')) journeys.push(...(await askAndCite(lab, set.questions, options.samples)));
  } finally {
    const { console: errors, csp, httpErrors, external } = lab.record;
    report.browser = { requests: lab.requests, console: errors.length, csp: csp.length, httpErrors: httpErrors.length, external: external.length };
    for (const url of external) process.stdout.write(`OFF LOCALHOST ${url}\n`);
    await lab.close();
  }
}

/** The MCP smoke's checks as counts, last because it registers and revokes clients. Its failures are recorded, not fatal. */
async function connectorSmoke(): Promise<LabReport['connector']> {
  const { runLocal } = await mcpSmoke();
  const smoke = await runLocal(fetch, `http://localhost:${MCP_PORT}`, undefined, await mcpFlow.localOptions());
  const count = (outcome: string) => smoke.checks.filter((check) => check.outcome === outcome).length;
  for (const check of smoke.checks) if (check.outcome === 'fail') process.stdout.write(`connector smoke: ${check.name} failed\n`);
  return { pass: count('pass'), fail: count('fail'), skip: count('skip') };
}

export function emptyReport(env: NodeJS.ProcessEnv, now: Date): LabReport {
  return {
    schema: REPORT_SCHEMA, stage: 'lab', retrieval: 'keyword', commit: env.GITHUB_SHA ?? null, runId: env.GITHUB_RUN_ID ?? null, measuredAt: now.toISOString(),
    runner: { os: process.platform, arch: process.arch, node: process.version }, throttle: { cpu: THROTTLE.cpuRate, network: 'lighthouse-slow-4g' }, seconds: {},
    seed: { status: 'failed', documentsExpected: 0, documents: 0, indexedExpected: 0, indexed: 0, keywordExpected: 0, keywordDocuments: 0, problems: ['not_seeded'] },
    journeys: [], browser: { requests: 0, console: 0, csp: 0, httpErrors: 0, external: 0 }, connector: null, failed: true,
  };
}

async function main(): Promise<void> {
  if (process.env.CI !== 'true') throw new Error('The lab runs in CI, never on a laptop: use the "Sample room lab" workflow.');
  const options = parseRunArgs(process.argv.slice(2));
  await mkdir(options.out, { recursive: true });
  const set = options.record ? await goldQuestions(options.record) : await loadQuestions(options.questions);
  if (set.documents.length === 0 || set.questions.length === 0) throw new Error('The question set needs documents and questions');
  process.env.WRANGLER_SEND_METRICS = 'false';
  const report = emptyReport(process.env, new Date());
  let servers: Awaited<ReturnType<typeof startServers>> | null = null;
  let threw = false;
  try {
    if (options.install) await timed(report.seconds, 'install', installWeb);
    const built = options.record ? await buildRecord(options.record, options.room) : {};
    report.seed = await seedRoom(options.room, report.seconds, built);
    process.stdout.write(`Seed: ${JSON.stringify(report.seed)}\n`);
    if (report.seed.status === 'ok') {
      await timed(report.seconds, 'build', buildRoom);
      servers = await timed(report.seconds, 'serversUp', () => startServers(path.join(options.out, 'logs')));
      const ids = await documentIds(options.out);
      await timed(report.seconds, 'journeys', () => drive(options, set, ids, report));
      report.connector = await connectorSmoke();
    }
  } catch (error) {
    threw = true;
    throw error;
  } finally {
    await servers?.stop();
    report.failed = threw || runFailed(report);
    await writeFile(path.join(options.out, 'report.json'), `${JSON.stringify(report, null, 1)}\n`);
    process.stdout.write(`Report: ${path.join(options.out, 'report.json')}${report.failed ? ' (failed)' : ''}\n`);
  }
  if (report.failed) process.exitCode = 1;
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
