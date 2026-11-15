// SPDX-License-Identifier: Apache-2.0
// The coverage audit: is every document of the room folder on disk, in D1, in legallas-files and in the index,
// and can Ask find it? One row per file (coverage-table.ts), read from every place it should be (coverage-sources.ts).
//
//   npm run coverage                   the table: hashes, one SELECT each on documents and audit_log, the R2 and
//                                      AI Search listings and the local caches
//   npm run coverage -- --probe        also the self-retrieval probe (coverage-probe.ts): two searches per indexed
//                                      document against production, about 3 a second
//   --rate <n>       probe searches per second (default 3, at most 10)
//   --config <file>  another legallas.config.json
//
// Read-only: nothing is written to Cloudflare, the case folder or the sync caches, and neither sync nor the cached
// extractor runs. Output: <cacheDir>/audit/coverage-<UTC time>.json and .md, mode 600, which hold paths, queries
// and ranks (case content). The terminal shows counts only.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { controlPrefixOf, DEFAULT_CONFIG_PATH, loadSyncConfig, type SyncConfig } from './config.ts';
import { kindOf } from './diff.ts';
import { GuardAbort, guardWalk, type WalkedFile } from './guard.ts';
import { iworkPackageLines } from './report.ts';
import { loadManifest } from './indexjob.ts';
import { restGetter, wranglerTokens } from './law/replica.ts';
import { CATALOG_REL } from './matter/catalog.ts';
import { matterPaths, writePrivate } from './matter/paths.ts';
import { accountId, documentsDb, loadModule, restSearch } from './mcp-replica.ts';
import { mapLimit } from './pool.ts';
import { AI_SEARCH_INSTANCE, cliWrangler, FILES_BUCKET, INDEX_BUCKET } from './wrangler.ts';
import { buildCoverage, indexability, textStats, type CoverageInputs, type RoomFile, type TextStats } from './coverage-table.ts';
import { pacedSearchFetch, pacer, probeTargets, runProbe } from './coverage-probe.ts';
import { formatCounts, renderMarkdown, summarize } from './coverage-report.ts';
import { cloudflareLease } from './spend-guard.ts';
import {
  AUDIT_COUNTS_SQL, auditCounts, catalogEntries, citeCounts, DOCUMENTS_SQL, hashRoom, listAiItems, listR2Keys, retrievalFiles,
  retrievedCounts, roomText, scanCaseFolder, toDocRow,
} from './coverage-sources.ts';

export interface CoverageOptions {
  probe: boolean;
  rate: number;
  config: string;
}

const USAGE = 'usage: npm run coverage -- [--probe] [--rate <searches per second>] [--config <file>]';
const MAX_RATE = 10;

export function parseCoverageArgs(args: readonly string[]): CoverageOptions {
  const options: CoverageOptions = { probe: false, rate: 3, config: DEFAULT_CONFIG_PATH };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const value = args[i + 1];
    if (arg === '--probe') options.probe = true;
    else if (arg === '--rate' && value && Number(value) > 0 && Number(value) <= MAX_RATE) (options.rate = Number(value)), (i += 1);
    else if (arg === '--config' && value) (options.config = path.resolve(value)), (i += 1);
    else throw new Error(USAGE);
  }
  return options;
}

const log = (line: string) => process.stdout.write(`${line}\n`);

/** Text statistics for every indexable room file, and its text for the probe's passages. */
async function gatherText(walked: readonly WalkedFile[], room: readonly RoomFile[], cacheDir: string) {
  const abs = new Map(walked.map((file) => [file.rel, file.abs]));
  const stats = new Map<string, TextStats>();
  const texts = new Map<string, string>();
  const indexable = room.filter((file) => indexability(file.rel, kindOf(path.posix.basename(file.rel)).kind) === true);
  await mapLimit(indexable, 8, async (file) => {
    const got = await roomText({ rel: file.rel, abs: abs.get(file.rel) ?? '', sha256: file.sha256 }, cacheDir).catch(() => null);
    if (!got) return;
    stats.set(file.rel, textStats(got.pages, got.version));
    texts.set(file.rel, got.pages.map((page) => page.text).join('\n'));
  });
  return { stats, texts };
}

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, 'utf8')) as unknown;
}

async function gather(config: SyncConfig, prefix: string) {
  const walk = await guardWalk(config.sourceRoot);
  log(`Guard passed: ${walk.files.length} room files. Hashing...`);
  if (walk.iworkPackages.length > 0) log(iworkPackageLines(walk.iworkPackages, false).join('\n'));
  const room = await hashRoom(walk.files);
  const caseFolder = await scanCaseFolder(path.dirname(config.sourceRoot), config.sourceRoot);
  log(`Case folder: ${caseFolder.outside.length} root files, ${caseFolder.privateFiles} private files hashed, ${caseFolder.foldersNotRead} other folders not read.`);
  const w = cliWrangler('remote');
  const rawRows = await w.d1Query(DOCUMENTS_SQL);
  const rows = rawRows.map(toDocRow).filter((row) => row !== null);
  const audit = auditCounts(await w.d1Query(AUDIT_COUNTS_SQL));
  const tokens = wranglerTokens();
  const account = await accountId();
  const get = restGetter(account, tokens);
  const [filesKeys, indexKeys, aiItems] = await Promise.all([listR2Keys(get, FILES_BUCKET), listR2Keys(get, INDEX_BUCKET), listAiItems(get, AI_SEARCH_INSTANCE)]);
  log(`D1: ${rows.length} rows. R2: ${filesKeys.length} file keys, ${indexKeys.length} index keys. AI Search: ${aiItems.size} items.`);
  const { stats, texts } = await gatherText(walk.files, room, config.cacheDir);
  const catalog = catalogEntries(await readFile(path.join(config.sourceRoot, CATALOG_REL), 'utf8'), config.sourceRoot);
  const matter = await readJson(matterPaths(config.cacheDir).matter).catch(() => null);
  const retrievals = await retrievalFiles(config.cacheDir);
  const caches = await Promise.all(retrievals.map((file) => readJson(file).catch(() => null)));
  const inputs: CoverageInputs = {
    prefix, room, outside: caseFolder.outside, privateShas: caseFolder.privateShas, rows, filesKeys: new Set(filesKeys), indexKeys, aiItems,
    manifest: await loadManifest(config.cacheDir, 'remote'), text: stats, catalog, audit, cites: citeCounts(matter), retrieved: retrievedCounts(caches),
  };
  const extras = {
    rows, filesKeys: inputs.filesKeys, indexKeys, aiItems, manifest: inputs.manifest, privateFiles: caseFolder.privateFiles,
    foldersNotRead: caseFolder.foldersNotRead, retrievalFiles: retrievals.length,
  };
  return { inputs, extras, texts, rawRows, tokens, account, matterFound: matter !== null, iworkPackages: walk.iworkPackages };
}

interface WorkerRetrieval {
  retrieve(search: unknown, db: unknown, question: string, role: 'owner'): Promise<{ chunks: { docId: string }[] }>;
}

async function main(): Promise<void> {
  const options = parseCoverageArgs(process.argv.slice(2));
  const config = await loadSyncConfig(options.config);
  const prefix = controlPrefixOf(await readJson(options.config));
  const { inputs, extras, texts, rawRows, tokens, account, matterFound, iworkPackages } = await gather(config, prefix);
  if (!matterFound) log('No built case picture in the cache: every document counts as not cited.');
  let rows = buildCoverage(inputs);
  if (options.probe) {
    const summaries = new Map([...inputs.catalog].map(([docPath, entry]) => [docPath, entry.summary]));
    const targets = probeTargets(rows, texts, summaries);
    log(`Probe: ${targets.length} indexed documents, up to ${targets.length * 2} searches at ${options.rate} a second...`);
    const retrieval = await loadModule<WorkerRetrieval>('worker/retrieval.ts');
    const db = await documentsDb(rawRows);
    // restSearch's own token is replaced on every request by pacedSearchFetch, which renews it as it expires. Every
    // query counts against the AI Search budget (scripts/spend-guard.ts); out of room, the probe stops with nothing written.
    const lease = cloudflareLease(account, tokens, 'coverage --probe');
    const search = restSearch(lease.meter(pacedSearchFetch(tokens, pacer(options.rate))), account, 'replaced-per-request');
    try {
      const results = await runProbe(targets, {
        // As the owner reads the room, privileged folders included (worker/privilege.ts).
        retrieve: async (question) => (await retrieval.retrieve(search, db, question, 'owner')).chunks,
        onProgress: (done, total) => {
          if (done % 50 === 0 || done === total) process.stderr.write(`  ${done}/${total}\n`);
        },
      });
      rows = buildCoverage({ ...inputs, probe: results });
    } finally {
      await lease.close();
      log(lease.summary());
    }
  }
  const summary = summarize(rows, extras);
  const generatedAt = new Date().toISOString();
  const base = path.join(config.cacheDir, 'audit', `coverage-${generatedAt.replace(/[:.]/g, '-')}`);
  await writePrivate(`${base}.json`, JSON.stringify({ generatedAt, probe: options.probe, summary, rows, iworkPackages }, null, 1));
  const notSynced = iworkPackages.length > 0 ? `\n${iworkPackageLines(iworkPackages, true).join('\n')}\n` : '';
  await writePrivate(`${base}.md`, `${renderMarkdown(rows, summary, generatedAt)}${notSynced}`);
  log(`\n${formatCounts(summary)}\n\nWrote ${base}.json and .md (mode 600).`);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    // Guard violations name paths; only their count and reasons are printed here.
    const message = error instanceof GuardAbort ? `${error.message} Reasons: ${[...new Set(error.violations.map((v) => v.reason))].join(', ')}` : error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
