// SPDX-License-Identifier: Apache-2.0
// Retrieval recall for Ask Legallas: whether the documents and pages an eval item expects reach the model, per
// retrieval plan, with no model call. Each question runs through the worktree's own retrieve() (worker/retrieval.ts)
// against an AI Search instance over its REST search endpoint (read-only, wrangler's token), with one in-memory
// copy of the room's `documents` table (one remote SELECT, never written to disk).
//
//   npm run eval:recall -- [--plans main,k30] [--instance legallas | --local v1|v2] [--set <file>] [--out <dir>]
//                          [--cache <name>] [--fresh]
//
// Plans share one search cache (<out>/search-<instance>-<cache>.json, mode 600): two plans that send the same
// request read the same answer and differ only in what they make of it, so a comparison is paired and AI Search's
// run-to-run drift does not count. --fresh starts the cache empty (a new sample); --cache names another one.
// --local searches a local index built by `npm run index:v2` (scripts/index-replica.ts) instead of an instance.
// Only item ids, ranks and figures print; the cache and the per-item file are case content and stay in --out.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadSyncConfig } from './config.ts';
import { wranglerTokens, type TokenSource } from './law/replica.ts';
import { accountId, documentsDb, loadModule, restSearch, wranglerToken, type SearchResponse } from './mcp-replica.ts';
import { ANSWERABLE, scoreItem, summarize, type ItemRecall, type Passage, type RecallItem, type RecallSummary } from './retrieval-recall-score.ts';
import { cloudflareLease, SpendStop, type SpendLease } from './spend-guard.ts';
import { cliWrangler } from './wrangler.ts';

/** worker/retrieval.ts RetrievalPlan, as this script names it. */
type Plan = Partial<{ k: number; candidates: number }>;

/**
 * Named plans: changes from worker/retrieval.ts RETRIEVAL ("main" is RETRIEVAL itself). A c<N>k<M> plan asks for N
 * candidates and keeps M, so it pairs with every other plan asking for N.
 */
export const PLANS: Readonly<Record<string, Plan>> = {
  main: {},
  k12: { k: 12, candidates: 12 },
  k30: { k: 30, candidates: 30 },
  k40: { k: 40, candidates: 40 },
  k50: { k: 50, candidates: 50 },
  c30k20: { k: 20, candidates: 30 },
  c50k20: { k: 20, candidates: 50 },
  c50k30: { k: 30, candidates: 50 },
  c50k40: { k: 40, candidates: 50 },
};

export interface RecallArgs {
  plans: string[];
  instance: string;
  set: string | null;
  out: string | null;
  cache: string;
  fresh: boolean;
  /** Search a local index (scripts/index-replica.ts) in this format instead of an instance. */
  local: 'v1' | 'v2' | null;
}

const USAGE =
  'usage: retrieval-recall [--plans a,b] [--instance <name> | --local v1|v2] [--set <file>] [--out <dir>] [--cache <name>] [--fresh]';

export function parseRecallArgs(argv: readonly string[]): RecallArgs {
  const args: RecallArgs = { plans: ['main'], instance: 'legallas', set: null, out: null, cache: 'a', fresh: false, local: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = argv[i + 1];
    if (arg === '--fresh') args.fresh = true;
    else if (arg === '--local' && (value === 'v1' || value === 'v2')) (args.local = value), i++;
    else if (arg === '--plans' && value) (args.plans = value.split(',')), i++;
    else if (arg === '--instance' && value && /^[a-z0-9][a-z0-9-]{0,31}$/.test(value)) (args.instance = value), i++;
    else if (arg === '--set' && value) (args.set = value), i++;
    else if (arg === '--out' && value) (args.out = value), i++;
    else if (arg === '--cache' && value && /^[a-z0-9-]{1,32}$/.test(value)) (args.cache = value), i++;
    else throw new Error(USAGE);
  }
  const unknown = args.plans.filter((name) => !Object.hasOwn(PLANS, name));
  if (unknown.length > 0) throw new Error(`unknown plan ${unknown.join(', ')}; known: ${Object.keys(PLANS).join(', ')}`);
  return args;
}

/** Eval set v2 items that expect documents. Other items (law only, silent) have nothing to recall. */
export function recallItems(raw: unknown): RecallItem[] {
  if (!Array.isArray(raw)) throw new Error('the eval set must be a JSON array');
  return raw.flatMap((entry: unknown) => {
    const item = (entry ?? {}) as { id?: unknown; category?: unknown; question?: unknown; expect?: { docs?: unknown } };
    const docs = Array.isArray(item.expect?.docs) ? (item.expect.docs as { control?: unknown; pages?: unknown }[]) : [];
    if (typeof item.id !== 'string' || typeof item.question !== 'string' || docs.length === 0) return [];
    return [
      {
        id: item.id,
        category: typeof item.category === 'string' ? item.category : 'other',
        question: item.question,
        docs: docs
          .filter((d) => typeof d.control === 'string')
          .map((d) => ({ control: d.control as string, pages: Array.isArray(d.pages) ? d.pages.filter((p): p is number => Number.isInteger(p)) : [] })),
      },
    ];
  });
}

type Search = { search(request: unknown): Promise<SearchResponse> };

/**
 * restSearch on wrangler's OAuth token, renewed once after a 401: the token lasts about an hour, and another
 * wrangler process refreshing it ends the old one early, so a long run would otherwise stop half way.
 */
export function renewingSearch(fetcher: typeof fetch, account: string, token: string, instance?: string, renew: () => Promise<string> = () => wranglerToken()): Search {
  let current = restSearch(fetcher, account, token, instance);
  return {
    async search(request) {
      try {
        return await current.search(request);
      } catch (error) {
        if (!(error instanceof Error) || error.message !== 'search_http_401') throw error;
        current = restSearch(fetcher, account, await renew(), instance);
        return current.search(request);
      }
    },
  };
}

/** Counts of what AI Search sent back: calls made, answers from the cache, and hybrid answers with no vector side. */
export interface SearchStats {
  calls: number;
  cached: number;
  keywordOnly: number;
}

const requestKey = (request: unknown) => createHash('sha256').update(JSON.stringify(request)).digest('hex').slice(0, 24);

/**
 * Searches that answer a request seen before from `cache` (filled as it goes). Each call of the returned function
 * opens a scope for one retrieve(): the n-th time a scope sends the same request it reads the n-th answer, so
 * retrieve's second ask after a keyword-only answer is a second sample, as it is in production.
 */
export function cachingSearch(inner: Search, cache: Map<string, SearchResponse>, stats: SearchStats): () => Search {
  return () => {
    const asked = new Map<string, number>();
    return {
      search: async (request) => {
        const base = requestKey(request);
        const n = asked.get(base) ?? 0;
        asked.set(base, n + 1);
        return answer(`${base}#${n}`, request);
      },
    };
  };
  async function answer(key: string, request: unknown): Promise<SearchResponse> {
    const hit = cache.get(key);
    if (hit) {
      stats.cached += 1;
      return hit;
    }
    const result = await inner.search(request);
    stats.calls += 1;
    const hybrid = (request as { ai_search_options?: { retrieval?: { retrieval_type?: string } } }).ai_search_options?.retrieval?.retrieval_type === 'hybrid';
    const details = result.chunks.map((c) => (c as { scoring_details?: { vector_score?: unknown } }).scoring_details);
    if (hybrid && result.chunks.length > 0 && details.every((d) => d !== undefined && typeof d.vector_score !== 'number')) stats.keywordOnly += 1;
    cache.set(key, result);
    return result;
  }
}

interface WorkerRetrieval {
  RETRIEVAL: Required<Plan>;
  retrieve(search: Search, db: unknown, question: string, role: 'owner', plan?: Required<Plan>): Promise<{ chunks: Passage[] }>;
}

const pct = (v: number) => `${Math.round(v * 100)}`.padStart(4);

/** One line of the table: n and recall as whole percents, then the prompt's size. */
export function row(label: string, s: RecallSummary): string {
  return (
    `${label.padEnd(24)} ${String(s.n).padStart(3)} ${pct(s.doc5)} ${pct(s.doc10)} ${pct(s.doc)} ${pct(s.page5)} ${pct(s.page10)} ${pct(s.page)} ${pct(s.covered)}` +
    ` ${s.passages.toFixed(1).padStart(5)} ${s.maxPerDocument.toFixed(1).padStart(4)} ${String(Math.round(s.charsP50 / 1000)).padStart(4)}k ${String(Math.round(s.charsP95 / 1000)).padStart(4)}k ${pct(s.unpaged)}`
  );
}

export const HEADER = `${'plan / category'.padEnd(24)}   n doc5 doc10 doc pg5 pg10  pg  cov  pass  max  p50ch  p95ch unpg`;

/** Table rows for one plan: every item, the answerable ones, then each category. */
export function planRows(name: string, rows: readonly ItemRecall[]): string[] {
  const categories = [...new Set(rows.map((r) => r.category))].sort();
  return [
    row(`${name} all`, summarize(rows)),
    row(`${name} answerable`, summarize(rows.filter((r) => ANSWERABLE.has(r.category)))),
    ...categories.map((c) => row(`  ${c}`, summarize(rows.filter((r) => r.category === c)))),
  ];
}

/** Items whose expected page reached the model under one plan and not the other (ids only). */
export function flips(base: readonly ItemRecall[], other: readonly ItemRecall[]): { gained: string[]; lost: string[] } {
  const before = new Map(base.map((r) => [r.id, r.pageRank !== null]));
  const gained: string[] = [];
  const lost: string[] = [];
  for (const r of other) {
    const was = before.get(r.id);
    if (was === undefined || was === (r.pageRank !== null)) continue;
    (was ? lost : gained).push(r.id);
  }
  return { gained, lost };
}

async function pool<T, R>(values: readonly T[], size: number, work: (value: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(values.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, values.length) }, async () => {
      while (next < values.length) {
        const i = next++;
        out[i] = await work(values[i]!);
      }
    }),
  );
  return out;
}

/** A local index (scripts/index-replica.ts) over the parts index:v2 built, embedded through Workers AI under `lease`. */
async function localSearchOf(format: 'v1' | 'v2', config: { cacheDir: string; sourceRoot: string }, rows: readonly Record<string, unknown>[], account: string, tokens: TokenSource, lease: SpendLease) {
  const [{ localIndex }, { toRow }, { restEmbed }] = await Promise.all([import('./index-replica.ts'), import('./index-v2.ts'), import('./law/replica.ts')]);
  const live = rows.filter((r) => r.removed_at === null || r.removed_at === undefined).map(toRow);
  return localIndex(format, path.join(config.cacheDir, 'index-v2'), live, config, restEmbed(account, tokens, lease), (line) => console.log(line));
}

async function main(): Promise<void> {
  const args = parseRecallArgs(process.argv.slice(2));
  const config = await loadSyncConfig().catch(() => null);
  const set = args.set ? path.resolve(args.set) : config ? path.join(config.cacheDir, 'ask-eval-v2.json') : null;
  const dir = args.out ? path.resolve(args.out) : config ? path.join(config.cacheDir, 'retrieval-recall') : null;
  if (!set || !dir) throw new Error('no legallas.config.json: pass --set <file> and --out <dir>');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const items = recallItems(JSON.parse(await readFile(set, 'utf8')));

  const rows = await cliWrangler('remote').d1Query('SELECT * FROM documents');
  const seqOf = new Map(rows.map((r) => [String(r.id), typeof r.control_seq === 'number' ? r.control_seq : null]));
  const db = await documentsDb(rows);

  const source = args.local ? `local-${args.local}` : args.instance;
  const cacheFile = path.join(dir, `search-${source}-${args.cache}.json`);
  const stored: Record<string, SearchResponse> = args.fresh || args.local ? {} : await readFile(cacheFile, 'utf8').then(JSON.parse).catch(() => ({}));
  const cache = new Map(Object.entries(stored));
  const stats: SearchStats = { calls: 0, cached: 0, keywordOnly: 0 };
  const account = await accountId();
  // Every AI Search query and embedding counts against the spend budget (scripts/spend-guard.ts).
  const tokens = wranglerTokens();
  const lease = cloudflareLease(account, tokens, 'eval:recall');
  try {
    await recall(args, { config, items, rows, seqOf, db, source, cacheFile, cache, stats, account, tokens, lease, dir });
  } catch (error) {
    if (!(error instanceof SpendStop)) throw error;
    console.log(`\n${error.message}`);
    process.exitCode = 2;
  } finally {
    await lease.close();
    console.log(lease.summary());
  }
}

interface RecallRun {
  config: { cacheDir: string; sourceRoot: string } | null;
  items: ReturnType<typeof recallItems>;
  rows: Record<string, unknown>[];
  seqOf: Map<string, number | null>;
  db: unknown;
  source: string;
  cacheFile: string;
  cache: Map<string, SearchResponse>;
  stats: SearchStats;
  account: string;
  tokens: TokenSource;
  lease: SpendLease;
  dir: string;
}

async function recall(args: ReturnType<typeof parseRecallArgs>, r: RecallRun): Promise<void> {
  const { config, items, rows, seqOf, db, source, cacheFile, cache, stats, account, tokens, lease, dir } = r;
  // A search resumes a paused instance's sync (Cloudflare's activity check): legallas-v2 is paused on purpose.
  if (!args.local && args.instance !== 'legallas') {
    console.log(`Note: searching ${args.instance} resumes its sync if it is paused; pause it again afterwards.`);
  }
  const remote = args.local ? null : renewingSearch(lease.meter(fetch), account, await tokens.get(), args.instance);
  if (args.local && !config) throw new Error('--local reads the text cache: it needs legallas.config.json');
  const local = args.local && config ? await localSearchOf(args.local, config, rows, account, tokens, lease) : null;
  const scope = local ? () => local as unknown as Search : cachingSearch(remote!, cache, stats); // safe: remote is set unless local
  const retrieval = await loadModule<WorkerRetrieval>('worker/retrieval.ts');

  const results = new Map<string, ItemRecall[]>();
  console.log(`${items.length} items with expected documents; source ${source}; cache ${args.cache}\n${HEADER}`);
  for (const name of args.plans) {
    const plan = { ...retrieval.RETRIEVAL, ...PLANS[name] } as Required<Plan>;
    const scored = await pool(items, 3, async (item) => scoreItem(item, (await retrieval.retrieve(scope(), db, item.question, 'owner', plan)).chunks, seqOf));
    results.set(name, scored);
    for (const line of planRows(name, scored)) console.log(line);
    if (!local) await writeFile(cacheFile, JSON.stringify(Object.fromEntries(cache)), { mode: 0o600 });
  }
  const base = results.get(args.plans[0]!)!; // safe: plans has at least one entry
  for (const [name, scored] of results) {
    if (scored === base) continue;
    const { gained, lost } = flips(base, scored);
    console.log(`${name} vs ${args.plans[0]}: page gained ${gained.length} [${gained.join(' ')}], lost ${lost.length} [${lost.join(' ')}]`);
  }
  console.log(`search calls ${stats.calls}, from cache ${stats.cached}, hybrid answers with no vector side ${stats.keywordOnly}`);
  const out = path.join(dir, `recall-${source}-${args.cache}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  await writeFile(out, JSON.stringify({ args, stats, results: Object.fromEntries(results) }, null, 1), { mode: 0o600 });
  console.log(`Per-item ranks: ${out}`);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  });
}
