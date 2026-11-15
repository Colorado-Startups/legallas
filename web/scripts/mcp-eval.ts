// SPDX-License-Identifier: Apache-2.0
// The legallas-mcp retrieval eval: for every known-answer item in the Ask eval set (scripts/ask-eval.ts), call
// legallas_search with the question and score whether an expected document is in the top N passages
// (scripts/mcp-eval-score.ts). It measures retrieval through the tool, not answers.
//
//   npm run eval:mcp                          # --local: <cacheDir>/ask-eval.json through `npm run mcp:dev`
//   npm run eval:mcp -- --example             # the dummy set (scripts/ask-eval.example.json), local only
//   npm run eval:mcp -- --replica             # production retrieval, no member session (scripts/mcp-replica.ts)
//   npm run eval:mcp -- --set <file> --top 5 --base http://localhost:8791
//
// --local takes a token through the same no-browser OAuth flow as the smoke (ALLOW_DEV_IDENTITY on localhost),
// so each question counts against the dev identity's local tool cap. --replica reads production: one SELECT on
// `documents`, the published meta/matter.json, and one AI Search REST call per question, on wrangler's OAuth
// token (`npx wrangler login`).
//
// After the score, a size probe prints the bytes of the first page of each legallas_case_overview section and of
// one 20-passage legallas_search result, against the roughly 60 KB response budget. With --replica it runs once per
// response profile (mcp/contract.ts v2) and checks each result, the first catalog page included, against that
// profile's budget (PROFILE_BUDGETS): a result over it fails the run. --profile picks the profile the questions are
// scored under (default standard); compact scoring follows each search's next_cursor up to --top passages.
//
// The questions are case content: they are never printed. Output is item ids, ranks, an aggregate score and sizes.
//
// A v2 set (items with a `category`, scripts/ask-eval-checks.ts) is scored on its `mcp: true` items by control
// number, at document and page level (scripts/mcp-eval-v2.ts); only the aggregate prints, and --out <dir> keeps the
// per-item ranks (mcp-eval-v2-*.json, mode 600).
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseEvalSet, type EvalItem } from './ask-eval-score.ts';
import { evaluateV2, formatV2Summary, summarizeV2, v2RetrievalItems } from './mcp-eval-v2.ts';
import { loadSyncConfig, DEFAULT_CONFIG_PATH } from './config.ts';
import { McpSession, LEGACY_VERSION, resultValue, summarizeTool, type ToolReply } from './mcp-client.ts';
import { MAX_SEARCH_RESULTS } from './mcp-constants.ts';
import { formatOutcome, passagesFrom, retrievalItems, scoreItem, summarize, type ItemOutcome } from './mcp-eval-score.ts';
import { formatReport, localGrant, localOptions, Report, type LocalOptions } from './mcp-flow.ts';
import { parseJson, type Fetch } from './mcp-oauth.ts';
import { wranglerTokens } from './law/replica.ts';
import { accountId, createReplica, publishedMatter, REPLICA_PROFILES, restSearch, type ReplicaProfile, type ReplicaTool } from './mcp-replica.ts';
import { cloudflareLease, SpendStop, type SpendLease } from './spend-guard.ts';
import { cliWrangler } from './wrangler.ts';

export const LOCAL_BASE = 'http://localhost:8790';
export const DEFAULT_TOP = 10;
const EXAMPLE_SET = path.join(import.meta.dirname, 'ask-eval.example.json');

export interface McpEvalArgs {
  mode: 'local' | 'replica';
  base: string;
  set: string | null;
  example: boolean;
  top: number;
  /** Replica only: a built matter.json to serve instead of the published one (for overview sizes before a publish). */
  matter: string | null;
  /** v2 sets: where the per-item ranks go; set only by --out. */
  out?: string;
  /** Replica only: the profile the questions are scored under; set only by --profile. */
  profile?: ReplicaProfile;
}

const USAGE =
  'usage: eval:mcp [--local [--base http://localhost:<port>] | --replica [--matter <built matter.json>] [--profile standard|compact]] [--example | --set <file>] [--top <1-20>] [--out <dir>]';

export function parseMcpEvalArgs(argv: readonly string[]): McpEvalArgs {
  const args: McpEvalArgs = { mode: 'local', base: LOCAL_BASE, set: null, example: false, top: DEFAULT_TOP, matter: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--local') args.mode = 'local';
    else if (arg === '--replica') args.mode = 'replica';
    else if (arg === '--example') args.example = true;
    else if (arg === '--base' && argv[i + 1]) args.base = argv[++i]!.replace(/\/+$/, '');
    else if (arg === '--set' && argv[i + 1]) args.set = argv[++i]!;
    else if (arg === '--top' && argv[i + 1]) args.top = Number(argv[++i]);
    else if (arg === '--matter' && argv[i + 1]) args.matter = path.resolve(argv[++i]!);
    else if (arg === '--out' && argv[i + 1]) args.out = path.resolve(argv[++i]!);
    else if (arg === '--profile' && (REPLICA_PROFILES as readonly string[]).includes(argv[i + 1] ?? '')) args.profile = argv[++i] as ReplicaProfile;
    else throw new Error(USAGE);
  }
  if (!Number.isInteger(args.top) || args.top < 1 || args.top > MAX_SEARCH_RESULTS) throw new Error(`--top must be 1 to ${MAX_SEARCH_RESULTS}`);
  const { protocol, hostname } = new URL(args.base);
  if (args.mode === 'local' && (protocol !== 'http:' || (hostname !== 'localhost' && hostname !== '127.0.0.1'))) {
    throw new Error('--local runs against http://localhost or http://127.0.0.1 only');
  }
  if (args.example && args.mode !== 'local') throw new Error('--example is dummy data for local dev only');
  if (args.matter && args.mode !== 'replica') throw new Error('--matter is for --replica');
  if (args.profile && args.mode !== 'replica') throw new Error('--profile is for --replica (a local server picks the profile from the client)');
  return args;
}

export type { ToolReply };

/** One call of any tool. */
export type ToolCall = (name: string, args: Record<string, unknown>) => Promise<ToolReply>;

/** One legallas_search call. */
export type SearchCall = (query: string, limit: number) => Promise<ToolReply>;

export function searchVia(call: ToolCall): SearchCall {
  return (query, limit) => call('legallas_search', { query, limit });
}

/** legallas_case_overview sections, in the order the tool lists them (mcp/tools/overview.ts). */
export const OVERVIEW_SECTIONS = ['summary', 'tracks', 'violations', 'events', 'people', 'orgs', 'claims', 'money', 'docs'] as const;

/** UTF-8 bytes of a tool result as it is serialized onto the wire. */
export function resultBytes(result: Record<string, unknown> | null): number {
  return result === null ? 0 : new TextEncoder().encode(JSON.stringify(result)).length;
}

/**
 * Response sizes against the roughly 60 KB budget: the first page of each overview section and one
 * MAX_SEARCH_RESULTS-passage search. Lines carry tool, section, counts, codes and bytes only.
 */
export async function probeSizes(call: ToolCall, query: string | null): Promise<string[]> {
  const line = (label: string, reply: ToolReply, extra = '') => {
    const summary = summarizeTool(reply.result);
    const outcome = reply.result === null ? reply.error : summary.isError ? `code ${summary.code}` : `${resultBytes(reply.result)} bytes${extra}`;
    return `SIZE  ${label.padEnd(40)}${outcome}`;
  };
  const lines: string[] = [];
  for (const section of OVERVIEW_SECTIONS) lines.push(line(`legallas_case_overview ${section}`, await call('legallas_case_overview', { section })));
  if (query !== null) {
    const reply = await call('legallas_search', { query, limit: MAX_SEARCH_RESULTS });
    lines.push(line(`legallas_search limit ${MAX_SEARCH_RESULTS}`, reply, `, ${passagesFrom(reply.result).length} passages`));
  }
  return lines;
}

/**
 * legallas_search following next_cursor until `limit` passages are in hand: how a compact client gets them. One
 * reply with every page's passages, or the first failing reply.
 */
export function pagedSearchVia(call: ToolCall): SearchCall {
  return async (query, limit) => {
    const results: unknown[] = [];
    let cursor: string | undefined;
    do {
      const reply = await call('legallas_search', cursor ? { query, limit, cursor } : { query, limit });
      if (reply.result === null || summarizeTool(reply.result).isError) return reply;
      const value = (resultValue(reply.result) ?? {}) as { results?: unknown[]; next_cursor?: unknown };
      results.push(...(value.results ?? []));
      cursor = typeof value.next_cursor === 'string' && results.length < limit ? value.next_cursor : undefined;
    } while (cursor);
    return { result: { content: [], structuredContent: { results } }, error: null };
  };
}

/**
 * Each response profile's budget on the text a model reads (mcp/contract.ts v2, D6): compact 9,000 characters and
 * 25 items with cursors; standard 60,000 characters, the largest standard per-call cap (legallas_read_pages).
 * scripts/mcp-eval-profile.test.ts keeps compact equal to the contract's COMPACT_LIMITS.
 */
export const PROFILE_BUDGETS: Record<ReplicaProfile, { maxChars: number; maxItems: number | null }> = {
  standard: { maxChars: 60_000, maxItems: null },
  compact: { maxChars: 9_000, maxItems: 25 },
};

/** The longest list in a result's object (structured content, or the compact text): its passages, documents, units or entries. */
export function resultItems(result: Record<string, unknown> | null): number {
  const value = resultValue(result);
  if (!value || typeof value !== 'object') return 0;
  return Math.max(0, ...Object.values(value).map((v) => (Array.isArray(v) ? v.length : 0)));
}

/** What a budget probe calls: each overview section, one MAX_SEARCH_RESULTS-passage search and the first catalog page. */
function budgetCalls(query: string | null): [label: string, name: string, args: Record<string, unknown>][] {
  return [
    ...OVERVIEW_SECTIONS.map((section): [string, string, Record<string, unknown>] => [`legallas_case_overview ${section}`, 'legallas_case_overview', { section }]),
    ...(query === null ? [] : [[`legallas_search limit ${MAX_SEARCH_RESULTS}`, 'legallas_search', { query, limit: MAX_SEARCH_RESULTS }] as [string, string, Record<string, unknown>]]),
    ['legallas_list_documents', 'legallas_list_documents', {}],
  ];
}

/**
 * Sizes under every response profile, each result checked against its profile's budget. Lines carry the profile,
 * tool, section, sizes, counts and codes only; `over` counts results past their budget (a coded error is not one).
 */
export async function probeBudgets(callFor: (profile: ReplicaProfile) => ToolCall, query: string | null): Promise<{ lines: string[]; over: number }> {
  const lines: string[] = [];
  let over = 0;
  for (const profile of REPLICA_PROFILES) {
    const budget = PROFILE_BUDGETS[profile];
    for (const [label, name, args] of budgetCalls(query)) {
      const reply = await callFor(profile)(name, args);
      const summary = summarizeTool(reply.result);
      const head = `SIZE  ${profile.padEnd(10)}${label.padEnd(40)}`;
      if (reply.result === null || summary.isError) {
        lines.push(`${head}${reply.result === null ? reply.error : `code ${summary.code}`}`);
        continue;
      }
      const items = resultItems(reply.result);
      const fits = summary.textLength <= budget.maxChars && (budget.maxItems === null || items <= budget.maxItems);
      if (!fits) over += 1;
      const limit = `OVER ${budget.maxChars} chars${budget.maxItems === null ? '' : ` or ${budget.maxItems} items`}`;
      lines.push(`${head}${summary.textLength} chars, ${items} items, ${resultBytes(reply.result)} bytes  ${fits ? 'ok' : limit}`);
    }
  }
  return { lines, over };
}

/** Codes after which further questions cannot succeed. */
const STOP_CODES: ReadonlySet<string> = new Set(['daily_limit', 'not_a_member', 'not_implemented', 'http_401']);

/** Runs every scorable item through `call` and scores it. Stops early on a code that dooms the rest. */
export async function evaluate(items: readonly EvalItem[], call: SearchCall, top: number, print: (line: string) => void = () => {}): Promise<ItemOutcome[]> {
  const outcomes: ItemOutcome[] = [];
  for (const item of retrievalItems(items)) {
    let outcome: ItemOutcome;
    try {
      const { result, error } = await call(item.question, top);
      const summary = summarizeTool(result);
      if (result === null || summary.isError) outcome = { id: item.id, status: 'error', rank: null, passages: 0, error: error ?? summary.code };
      else outcome = scoreItem(item, passagesFrom(result), top);
    } catch (error) {
      // Out of budget ends the run (scripts/spend-guard.ts); it is not an error to score.
      if (error instanceof SpendStop) throw error;
      outcome = { id: item.id, status: 'error', rank: null, passages: 0, error: error instanceof Error ? error.message.slice(0, 80) : 'error' };
    }
    outcomes.push(outcome);
    print(formatOutcome(outcome, top));
    if (outcome.error && STOP_CODES.has(outcome.error)) break;
  }
  return outcomes;
}

/** legallas_search through the local server, on a token from the no-browser flow. */
export async function localSearch(fetcher: Fetch, base: string, options: LocalOptions = {}): Promise<{ call: ToolCall | null; report: Report }> {
  const report = new Report();
  const grant = await localGrant(report, fetcher, base, options);
  if (!grant) return { call: null, report };
  const session = new McpSession(fetcher, `${base}/mcp`, grant.accessToken, LEGACY_VERSION);
  const opened = await session.open();
  if (!report.add('mcp_initialize_2025', opened.agreed !== null, `status ${opened.status}, ${opened.error ?? `agreed ${opened.agreed}`}`)) return { call: null, report };
  const call: ToolCall = async (name, args) => {
    const reply = await session.callTool(name, args);
    return { result: reply.result, error: reply.error };
  };
  return { call, report };
}

/** controlPrefix from legallas.config.json, when set (the tool formats control numbers with it). */
async function controlPrefix(): Promise<string | undefined> {
  const raw = (await readFile(DEFAULT_CONFIG_PATH, 'utf8').then(JSON.parse).catch(() => ({}))) as { controlPrefix?: unknown };
  return typeof raw.controlPrefix === 'string' ? raw.controlPrefix : undefined;
}

/** Which manifest the replica's overview serves. */
export type ManifestSource = 'published' | 'file' | 'none';

/**
 * Tools through the replica (production index, catalog and published manifest, read-only). Its AI Search queries run
 * under the returned spend lease (scripts/spend-guard.ts), which the caller closes.
 */
export async function replicaTools(fetcher: Fetch, matterFile: string | null): Promise<{ callFor: (profile: ReplicaProfile) => ToolCall; manifest: ManifestSource; lease: SpendLease }> {
  const tokens = wranglerTokens();
  const [account, token] = await Promise.all([accountId(), tokens.get()]);
  const lease = cloudflareLease(account, tokens, 'eval:mcp --replica');
  const rows = await cliWrangler('remote').d1Query('SELECT * FROM documents');
  const matter = matterFile ? await readFile(matterFile, 'utf8') : await publishedMatter().catch(() => null);
  const replica = await createReplica({ search: restSearch(lease.meter(fetcher as typeof fetch), account, token), rows, controlPrefix: await controlPrefix(), matter });
  const callFor = (profile: ReplicaProfile): ToolCall => async (name, args) => ({ result: await replica.callTool(name as ReplicaTool, args, profile), error: null });
  return { callFor, manifest: matterFile ? 'file' : matter === null ? 'none' : 'published', lease };
}

async function resolveSet(args: McpEvalArgs): Promise<string> {
  if (args.example) return EXAMPLE_SET;
  if (args.set) return path.resolve(args.set);
  const config = await loadSyncConfig().catch(() => null);
  if (!config) throw new Error('no legallas.config.json: pass --set <file> or --example');
  return path.join(config.cacheDir, 'ask-eval.json');
}

/** What a run scores with and how it sizes results. */
interface Runner {
  search: SearchCall;
  probe(query: string | null): Promise<{ lines: string[]; over: number }>;
  /** How the run is named in the output: the mode, and the scoring profile for the replica. */
  label: string;
}

/** A local server picks the profile from the client (the dev client is compact), so scoring follows cursors. */
export function localRunner(call: ToolCall): Runner {
  return { search: pagedSearchVia(call), probe: async (query) => ({ lines: await probeSizes(call, query), over: 0 }), label: 'local' };
}

/** The replica scores under one profile (compact follows cursors) and sizes results under both. */
export function replicaRunner(callFor: (profile: ReplicaProfile) => ToolCall, profile: ReplicaProfile = 'standard'): Runner {
  const search = profile === 'compact' ? pagedSearchVia(callFor('compact')) : searchVia(callFor('standard'));
  return { search, probe: (query) => probeBudgets(callFor, query), label: `replica, ${profile} profile` };
}

/** Prints the size probe; a result over its profile's budget fails the run. */
async function printProbe(runner: Runner, query: string | null): Promise<void> {
  const { lines, over } = await runner.probe(query);
  for (const line of lines) console.log(line);
  if (over > 0) {
    console.log(`${over} result${over === 1 ? '' : 's'} over the profile's budget.`);
    process.exitCode = 1;
  }
}

/** A v2 set: document and page recall by control number; aggregates print, per-item ranks go to --out. */
async function mainV2(items: readonly EvalItem[], runner: Runner, args: McpEvalArgs): Promise<void> {
  console.log(`Searching ${v2RetrievalItems(items).length} v2 items marked for MCP, ${runner.label}, top ${args.top}.`);
  const outcomes = await evaluateV2(items, runner.search, args.top);
  const s = summarizeV2(outcomes);
  console.log(formatV2Summary(s, args.top));
  if (args.out) {
    await mkdir(args.out, { recursive: true, mode: 0o700 });
    const file = path.join(args.out, `mcp-eval-v2-${args.mode}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    await writeFile(file, JSON.stringify({ at: new Date().toISOString(), mode: args.mode, profile: args.profile ?? null, top: args.top, summary: s, outcomes }, null, 1), { mode: 0o600 });
    console.log(`Per-item ranks (item ids, keep private): ${file}`);
  }
  process.exitCode = s.docHits < s.items ? 1 : 0;
  await printProbe(runner, null);
}

async function main(): Promise<void> {
  const args = parseMcpEvalArgs(process.argv.slice(2));
  const items = parseEvalSet(parseJson(await readFile(await resolveSet(args), 'utf8'), 'the eval set'));
  const v2 = items.some((item) => item.category !== undefined);
  const scorable = v2 ? v2RetrievalItems(items).length : retrievalItems(items).length;
  if (scorable === 0) {
    console.log(`No item names an expected document (${v2 ? 'mcp: true with expect.docs' : 'expect.citesAnyOf'}): nothing to score.`);
    process.exitCode = 1;
    return;
  }
  if (args.mode === 'replica') {
    const replica = await replicaTools(fetch, args.matter);
    try {
      await scoreAll(items, replicaRunner(replica.callFor, args.profile), replica.manifest, args, scorable, v2);
    } catch (error) {
      if (!(error instanceof SpendStop)) throw error;
      console.log(`\n${error.message}`);
      process.exitCode = 2;
    } finally {
      await replica.lease.close();
      console.log(replica.lease.summary());
    }
    return;
  }
  const local = await localSearch(fetch, args.base, await localOptions());
  if (!local.call) {
    console.log(formatReport(local.report));
    throw new Error('the local OAuth flow failed (run `npm run mcp:smoke` for the full table)');
  }
  await scoreAll(items, localRunner(local.call), null, args, scorable, v2);
}

async function scoreAll(items: readonly EvalItem[], runner: Runner, manifest: ManifestSource | null, args: McpEvalArgs, scorable: number, v2: boolean): Promise<void> {
  if (v2) {
    await mainV2(items, runner, args);
    return;
  }
  console.log(`Searching ${scorable} of ${items.length} items (the rest name no expected document), ${runner.label}, top ${args.top}.\n`);
  const outcomes = await evaluate(items, runner.search, args.top, (line) => console.log(line));
  const s = summarize(outcomes);
  console.log(`\n${s.hits} hit, ${s.misses} miss, ${s.errors} error of ${s.scored}: recall@${args.top} ${(s.recall * 100).toFixed(1)}%, MRR ${s.mrr.toFixed(3)}.\n`);
  if (manifest === 'none') console.log('Overview: no manifest is published in production (pass --matter <built matter.json> to size the sections).');
  if (manifest === 'file') console.log('Overview: sized from the built manifest given with --matter, not the published one.');
  process.exitCode = s.misses + s.errors > 0 || s.scored < scorable ? 1 : 0;
  await printProbe(runner, retrievalItems(items)[0]?.question ?? null);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  });
}
