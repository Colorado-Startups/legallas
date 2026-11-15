// SPDX-License-Identifier: Apache-2.0
// npm run law: builds the law library (public law for Ask and legallas_search_law) and plans its upload.
//
//   npm run law                          fetch (cached), parse, chunk, write <lawDir>/out, print the plan (dry run)
//   npm run law -- --refresh             the same, downloading every source again
//   npm run law -- --list                every unit a pack names, its source and when it was fetched; downloads nothing
//   npm run law -- --only a,b            those units of the default pack only, to prove a small fetch; writes nothing
//   npm run law -- --only a,b --local    the same, then puts them and their catalog in the local legallas-law bucket
//                                        (wrangler dev's files under web/.wrangler, never Cloudflare): a local room
//                                        and legallas-mcp search them with LAW_LIBRARY "1" (mcp/dev-search.ts)
//   npm run law -- --apply --expect <fp> upload exactly the reviewed plan to R2 legallas-law, then start indexing
//
// <lawDir> is ~/Library/Caches/legallas-sync/law (LEGALLAS_LAW_DIR overrides): raw/ downloads, out/ the built
// parts and catalog.json, state/uploaded.json what the bucket holds. Nothing here reads the room, the record or
// legallas.config.json, and every URL is fixed in sources.ts or a law pack (pack.ts). --apply writes to Cloudflare: run it only with
// the owner's OK for that fingerprint (web/README.md, "Cloudflare and Claude"). Before it uploads, --apply holds the parts' ingestion tokens against
// this month's AI Search budget (scripts/spend-guard.ts) and refuses when the month has no room.
import path from 'node:path';
import { lawFromKey, lawKey, unitOf } from '../../worker/law-cite.ts';
import { cloudflareLease, fileChars, holdIngestion, SpendStop, type SpendLease } from '../spend-guard.ts';
import { localLawBucket } from '../local-r2.ts';
import { accountId, wrangler } from '../wrangler.ts';
import { buildAll } from './build.ts';
import { chunkUnit } from './chunk.ts';
import { RawCache } from './fetch.ts';
import { putLocal } from './local.ts';
import { allowedHosts, loadLawPacks, type LawPack } from './pack.ts';
import { applyPlan, builtDate, CATALOG_KEY, deletionLines, lawDir, loadUploaded, planUpload, stagePlan, writeOutput, type LawPlan, type LawStage } from './plan.ts';
import { wranglerTokens } from './replica.ts';
import type { BuiltChunk, LawUnit } from './types.ts';

const USAGE = 'usage: npm run law -- [--list] [--only <unit,unit> [--local]] [--refresh] [--apply --expect <fingerprint>]';

/** The parsed command-line arguments of the law build. */
export interface LawArgs {
  refresh: boolean;
  apply: boolean;
  expect: string | null;
  list: boolean;
  only: string[] | null;
  /** Put an --only build in the local legallas-law bucket. */
  local: boolean;
}

/** Parses the law build's command-line arguments. */
export function parseLawArgs(argv: readonly string[]): LawArgs {
  const args: LawArgs = { refresh: false, apply: false, expect: null, list: false, only: null, local: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--refresh') args.refresh = true;
    else if (arg === '--apply') args.apply = true;
    else if (arg === '--expect' && /^[0-9a-f]{12}$/.test(argv[i + 1] ?? '')) args.expect = argv[++i]!;
    else if (arg === '--list') args.list = true;
    else if (arg === '--local') args.local = true;
    else if (arg === '--only' && /^[a-z0-9-]+(?:,[a-z0-9-]+)*$/.test(argv[i + 1] ?? '')) args.only = argv[++i]!.split(',');
    else throw new Error(USAGE);
  }
  if (args.apply && !args.expect) throw new Error(`--apply needs --expect <fingerprint> from a dry run\n${USAGE}`);
  if (args.expect && !args.apply) throw new Error(`--expect only makes sense with --apply\n${USAGE}`);
  if (args.only && (args.apply || args.list)) throw new Error(`--only proves a small fetch: it can't upload or list\n${USAGE}`);
  if (args.list && (args.apply || args.refresh)) throw new Error(`--list downloads and uploads nothing\n${USAGE}`);
  if (args.local && !args.only) throw new Error(`--local fills a local bucket from a small run: name its units with --only\n${USAGE}`);
  return args;
}

/** Counts for the report: units and parts by kind and track, characters and a rough token count. */
export function stats(units: readonly LawUnit[], chunks: readonly BuiltChunk[]): string[] {
  const by = (key: (c: BuiltChunk) => string) => {
    const counts = new Map<string, number>();
    for (const chunk of chunks) counts.set(key(chunk), (counts.get(key(chunk)) ?? 0) + 1);
    return [...counts].map(([k, n]) => `${k} ${n}`).join(', ');
  };
  const chars = chunks.reduce((n, c) => n + c.text.length, 0);
  return [
    `${units.length} units, ${chunks.length} parts, ${chars.toLocaleString('en-US')} characters (about ${Math.round(chars / 4).toLocaleString('en-US')} tokens)`,
    `parts by kind: ${by((c) => c.kind)}`,
    `parts by track: ${by((c) => c.track)}`,
    `largest part: ${Math.max(...chunks.map((c) => c.text.length))} characters`,
  ];
}

function printPlan(plan: LawPlan): void {
  console.log(`Plan: ${plan.put.length} to upload, ${plan.remove.length} to delete, ${plan.unchanged} unchanged.`);
  for (const line of deletionLines(plan.remove)) console.log(line);
  console.log(`Fingerprint: ${plan.fingerprint}`);
}

async function printReports(packs: readonly LawPack[], cache: RawCache): Promise<void> {
  for (const pack of packs) {
    for (const line of (await pack.report?.(cache)) ?? []) console.log(line);
  }
}

/** The acts this month's AI Search allowance can hold, in build order; the rest wait for a later run. */
async function holdStage(lease: SpendLease, plan: LawPlan, order: readonly string[], uploaded: Readonly<Record<string, string>>, actOf: (key: string) => string, dir: string): Promise<LawStage> {
  let held = 0;
  const stage = await stagePlan(
    plan,
    order,
    uploaded,
    actOf,
    (keys) => fileChars(keys.map((key) => path.join(dir, 'out', key))),
    async (chars) => {
      try {
        held += await holdIngestion(lease, chars);
        return true;
      } catch (error) {
        if (error instanceof SpendStop) return false;
        throw error;
      }
    },
  );
  console.log(`Spend: holding about ${held.toLocaleString('en-US')} AI Search ingestion tokens for this upload.`);
  return stage;
}

/** `--only`: a small build to prove a fetch. It writes nothing, or under --local fills the local legallas-law bucket. */
async function partialRun(args: LawArgs, units: readonly LawUnit[], chunks: readonly BuiltChunk[]): Promise<void> {
  for (const line of stats(units, chunks)) console.log(line);
  if (args.local) {
    const { bucket, close } = await localLawBucket();
    try {
      await putLocal(bucket, chunks, builtDate(chunks));
    } finally {
      await close();
    }
    console.log(`Local: ${chunks.length} parts and catalog.json in the local legallas-law bucket. Nothing went to Cloudflare.`);
    return;
  }
  console.log('Partial run: nothing was written and there is no plan. A partial library must never be uploaded.');
}

/** Holds the upload's ingestion tokens against this month's AI Search budget. A staged pack uploads as much as the month holds. */
async function holdUpload(plan: LawPlan, chunks: readonly BuiltChunk[], uploaded: Readonly<Record<string, string>>, dir: string, staged: LawPack | undefined): Promise<LawStage> {
  // The instance excludes catalog.json (exclude_items), so only the parts are ingested.
  const lease = cloudflareLease(await accountId(), wranglerTokens(), 'npm run law -- --apply');
  try {
    if (staged?.stagedUpload) {
      const actOfUnit = staged.stagedUpload;
      const actOf = (key: string) => {
        const id = lawFromKey(key)?.id;
        return (id && actOfUnit(unitOf(id))) ?? 'another pack';
      };
      return await holdStage(lease, plan, chunks.map((chunk) => lawKey(chunk)), uploaded, actOf, dir);
    }
    const tokens = await holdIngestion(lease, await fileChars(plan.put.filter((key) => key !== CATALOG_KEY).map((key) => path.join(dir, 'out', key))));
    console.log(`Spend: holding about ${tokens.toLocaleString('en-US')} AI Search ingestion tokens for this upload.`);
    return { plan, later: [], laterActs: [] };
  } finally {
    await lease.close();
  }
}

/** What an apply did: all of the plan, or the part this month's allowance reached. */
function reportApplied(plan: LawPlan, stage: LawStage): void {
  if (stage.later.length > 0) {
    console.log(`Applied part of ${plan.fingerprint}; an indexing job for legallas-law was started.`);
    console.log(`Not in the library yet, for lack of this month's AI Search allowance: ${stage.laterActs.join(', ')} (${stage.later.length} parts). Run npm run law again on or after the 1st; what's uploaded is searchable meanwhile.`);
  } else {
    console.log(`Applied ${plan.fingerprint}; an indexing job for legallas-law was started.`);
  }
}

async function main(): Promise<void> {
  const args = parseLawArgs(process.argv.slice(2));
  const dir = lawDir();
  const packs = await loadLawPacks();
  const cache = new RawCache(path.join(dir, 'raw'), fetch, undefined, allowedHosts(packs));
  if (args.list) {
    await printReports(packs, cache);
    return;
  }
  if (args.only && !packs.some((pack) => pack.report)) throw new Error('--only names units of the default law pack, and this room lists its own packs');
  const units = await buildAll(cache, { refresh: args.refresh, log: (line) => console.log(line), packs, ...(args.only ? { only: new Set(args.only) } : {}) });
  const chunks = units.flatMap((unit) => chunkUnit(unit));
  await printReports(packs, cache);
  if (args.only) return partialRun(args, units, chunks);
  const built = await writeOutput(dir, chunks, builtDate(chunks));
  for (const line of stats(units, chunks)) console.log(line);
  console.log(`Output: ${path.join(dir, 'out')}`);
  const uploaded = await loadUploaded(dir);
  const plan = planUpload(built, uploaded);
  printPlan(plan);
  const staged = packs.find((pack) => pack.stagedUpload);
  if (staged) console.log('An upload goes one whole act at a time, in the order above, as far as the month\'s AI Search allowance reaches. Changes to law already in the library go first, or nothing does.');
  if (!args.apply) {
    console.log(`Dry run. To upload exactly this plan: npm run law -- --apply --expect ${plan.fingerprint}`);
    return;
  }
  if (plan.fingerprint !== args.expect) throw new Error(`the plan changed since the dry run (now ${plan.fingerprint}); review it again`);
  const stage = await holdUpload(plan, chunks, uploaded, dir, staged);
  await applyPlan(dir, stage.plan, built, wrangler, (line) => console.log(line));
  reportApplied(plan, stage);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
