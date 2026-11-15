// SPDX-License-Identifier: Apache-2.0
// The Ask Legallas model replica: compares Workers AI models on the real eval set without a member session or
// the daily question cap. Retrieval runs once per question against production, read-only (the AI Search REST
// search with the worker's own retrieve(), one SELECT on `documents`, the published case picture), and is
// cached, so between runs only the model varies. Each answer then goes through the worktree's own turn
// (worker/ask-turn.ts: the prompt with short cite ids, the shaping of the streamed text, citation validation and the
// verdict, exactly as the route runs it), generation input, stream parsing (retryDegenerate) and eval scoring.
//
//   npm run eval:ask-replica -- --model @cf/openai/gpt-oss-120b [--effort low|medium|high|max|omit]
//                               [--reps 2] [--set <file>] [--out <dir>] [--budget <usd>] [--fresh] [--law]
//                               [--max-tokens <n>] [--plant] [--compare <report-*.json>] [--concurrency 1-3]
//                               [--category <category,...>] [--preflight] [--provider workers-ai|groq|host] [--shard k/n]
//                               [--recommend 0|1]
//
// --provider groq answers on Groq (openai/gpt-oss-120b) instead of Workers AI, each turn fitted to Groq's prompt as the
// room fits it once Workers AI's neurons are spent (scripts/ask-replica-groq.ts; it refuses unless wrangler.jsonc
// records zero data retention confirmed, and reads its key from REPLICA_EVAL_GROQ_API_KEY). --shard k/n keeps every
// nth item of each category: Groq answers about once a minute, so the gate set runs as shards that must each pass.
// --provider host answers on the room's own host, the model wrangler.jsonc's ASK_HOST names, with the whole turn as the
// room sends it (scripts/ask-replica-host.ts; it refuses unless ASK_HOST records zero data retention confirmed and a
// usable url and model, and reads its key from REPLICA_EVAL_HOST_API_KEY). It takes no --model or --effort.
//
// --recommend 0 or 1 replaces wrangler.jsonc's RECOMMEND for the run, so one commit's prompt is scored with options and
// a recommendation off and on (the people set, scripts/ask-eval.people.json, runs once each). The label says which.
//
// --max-tokens replaces the worker's max_tokens, to try a budget before changing worker/ask.ts. Every run reports
// its model calls: how many streamed no visible answer (a blank call, retried by retryDegenerate) and how many
// stopped at max_tokens (finish_reason "length"; reasoning counts against max_tokens), with the tokens per call, and
// how many answers the worker's own stream parsing marks truncated (Ask's `done` then says `truncated: true`).
//
// --category keeps only the eval v2 items of those categories (unknown,injection is the release gate's set, in the
// Replica eval workflow). --preflight refuses to start unless today's neurons and this month's searches have room for
// the whole run at a typical answer's cost plus the last answer's output ceiling (replicaNeed), so a run that cannot
// finish spends nothing.
//
// --law adds the law library (T21) as Ask would with LAW_LIBRARY on: law passages for each question from the local
// law replica over ~/Library/Caches/legallas-sync/law/out (scripts/law/replica.ts; the question is embedded by
// Workers AI, inside Cloudflare like the rest of this run), cached beside the record retrieval, and the answer's
// law cites validated with worker/law.ts. Use it to check that the record eval does not regress.
//
// The model call goes straight to Workers AI (/accounts/<id>/ai/run/<model>) on wrangler's OAuth token, like the
// worker's env.AI.run: no AI Gateway. Only @cf/ models are accepted, so case text leaves Cloudflare only for Groq under
// --provider groq or the room's host under --provider host, each behind its zero-data-retention check.
// Every search, embedding and model call runs under a spend lease (scripts/spend-guard.ts): the run stops cleanly at
// the day's neuron budget or the month's AI Search budget, reports what it answered, and gives back what it held.
// The retrieval cache and every answer are case content: they stay in --out (default <cacheDir>/ask-replica,
// mode 700, files mode 600), and only item ids, verdicts and numbers print. In a v2 run, every line printed must also
// match SAFE_LINES in scripts/ask-eval-gate.ts: the Replica eval workflow shows only those and withholds the rest, so
// a new or reworded message needs its pattern and a test there.
//
// Every run writes report-*.json and .md beside its answers (scripts/ask-eval-report.ts), a set with no category too:
// scripts/ask-eval-gate.ts reads it, with --people for the people set.
// Eval v2 sets (items with a `category`, scripts/ask-eval-checks.ts) are scored with the v2 checks against the room's
// control numbers (controlPrefix from legallas.config.json, control_seq from the D1 copy) and the extractor's page text
// (<cacheDir>/text), and write report-*.json and .md beside the answers (scripts/ask-eval-report.ts); only aggregate
// tables print. --plant puts each injection item's planted passage among its retrieved passages, in memory only
// (scripts/ask-replica-v2.ts). --compare <report-*.json> lists per-item flips against an earlier report.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CitableDoc } from '../worker/passages.ts';
import type { PromptChunk } from '../worker/prompt.ts';
import { ASK_MAX_TOKENS, neuronsFor, usageNeurons, worstCaseNeurons } from '../worker/budget.ts';
import { withFreshToken, withRateRetry, wranglerTokens, type TokenSource } from './law/replica.ts';
import { garbledIds, type ScoreContext } from './ask-eval-checks.ts';
import { CATEGORY_KIND, closerFor, parseEvalSet, type Category, type EvalItem } from './ask-eval-score.ts';
import { answer, isStop, type Generate, type Seen, type Turn, type WorkerStream } from './ask-replica-answer.ts';
import { lawCiteValidity, replicaSpeakers, retrieveAll, retrieveLawAll, type CachedRetrieval, type WorkerAsk, type WorkerLaw } from './ask-replica-retrieval.ts';
import { summarize, toScored, type Run } from './ask-replica-runs.ts';
import { controlPrefix, plant, shaById, textCachePages, writeReport } from './ask-replica-v2.ts';
import { GroqPacer, groqGenerate, groqRunKey, parseShard, pickShard, roomVar, type Shard } from './ask-replica-groq.ts';
import { HostHalt, hostGenerate, hostRunTarget } from './ask-replica-host.ts';
import { hostInput, type HostTarget } from '../worker/ask-host.ts';
import { GROQ_MODEL, GROQ_PROMPT_CHARS, groqInput, type GroqEffort } from '../worker/ask-groq.ts';
import { loadSyncConfig } from './config.ts';
import { accountId, loadModule } from './mcp-replica.ts';
import type { Fetch } from './mcp-oauth.ts';
import { cloudflareLease, sseUsage, type Plan, type SpendLease } from './spend-guard.ts';
import { cliWrangler } from './wrangler.ts';

export { garbledIds, lawCiteValidity, withRateRetry };
export { percentile } from './ask-eval-report.ts';
export { questionKey, type CachedRetrieval } from './ask-replica-retrieval.ts';
export { callShape, citeValidity, streamAnswer, streamUsage, summarize, toScored, USD_PER_NEURON, type Call, type Run, type Summary } from './ask-replica-runs.ts';

const API = 'https://api.cloudflare.com/client/v4';
const EFFORTS = ['low', 'medium', 'high', 'max', 'omit'] as const;
export type Effort = (typeof EFFORTS)[number];
/**
 * Model calls in flight. Ask in production shares the account's Workers AI capacity, and it answered 503
 * model_unavailable while several replicas ran at 3 each (2026-10-04), so the default is 2; --concurrency 1 to 3.
 */
const DEFAULT_CONCURRENCY = 2;
const MODEL_TIMEOUT_MS = 240_000;
/**
 * Neurons a scored answer typically costs, for --preflight. Measured on gpt-oss-120b, Ask's model since 2026-11-05, at
 * the example's settings: 2,317 and 2,440 neurons for 6 answers each (the people eval's first shard, RECOMMEND 0 and 1,
 * 7 Nov), about 400 an answer, rounded up so the preflight errs high. A retried blank answer bills twice.
 */
export const TYPICAL_ANSWER_NEURONS = 450;
/** Searches an item's retrieval can make: the record search, asked once more at most (worker/ai-search.ts askAgain). */
const SEARCHES_PER_ITEM = 2;

export interface ReplicaArgs {
  model: string;
  /** null: whatever the worker's generationInput sends for this model. */
  effort: Effort | null;
  reps: number;
  set: string | null;
  out: string | null;
  budget: number;
  fresh: boolean;
  /** Add law library passages (T21); set only by --law. */
  law?: true;
  /** Replaces the worker's max_tokens; set only by --max-tokens. */
  maxTokens?: number;
  /** Plant injection items' passages among the retrieved ones (eval v2); set only by --plant. */
  plant?: true;
  /** An earlier v2 report to list flips against; set only by --compare. */
  compare?: string;
  /** Model calls in flight, 1 to 3 (DEFAULT_CONCURRENCY when absent); set only by --concurrency. */
  concurrency?: number;
  /** Keep only the eval v2 items of these categories; set only by --category. */
  categories?: Category[];
  /** Refuse to start unless the budget has room for the whole run (replicaNeed); set only by --preflight. */
  preflight?: true;
  /** Answer on Groq or the room's own host instead of Workers AI; set only by --provider groq or --provider host. */
  provider?: 'groq' | 'host';
  /** Keep one shard of each category's items (pickShard); set only by --shard. */
  shard?: Shard;
  /** Replaces wrangler.jsonc's RECOMMEND for this run (recommendOf); set only by --recommend. */
  recommend?: '0' | '1';
}

const USAGE =
  'usage: eval:ask-replica (--model @cf/<vendor>/<model> | --provider groq | --provider host) [--effort low|medium|high|max|omit] [--reps n] [--set <file>] [--out <dir>] [--budget <usd>] [--fresh] [--law] [--max-tokens <n>] [--plant] [--compare <report-*.json>] [--concurrency 1-3] [--category <category,...>] [--preflight] [--shard k/n] [--recommend 0|1]';

/** `unknown,injection` as categories; null when any part is not an eval v2 category. */
function parseCategories(value: string): Category[] | null {
  const parts = value.split(',');
  return parts.every((part) => Object.hasOwn(CATEGORY_KIND, part)) ? [...new Set(parts as Category[])] : null;
}

export function parseReplicaArgs(argv: readonly string[]): ReplicaArgs {
  const args: ReplicaArgs = { model: '', effort: null, reps: 1, set: null, out: null, budget: 1, fresh: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = argv[i + 1];
    const categories = arg === '--category' && value ? parseCategories(value) : null;
    const shard = arg === '--shard' && value ? parseShard(value) : null;
    if (arg === '--fresh') args.fresh = true;
    else if (arg === '--law') args.law = true;
    else if (arg === '--plant') args.plant = true;
    else if (arg === '--preflight') args.preflight = true;
    else if (categories) (args.categories = categories), i++;
    else if (shard) (args.shard = shard), i++;
    else if (arg === '--provider' && (value === 'groq' || value === 'host')) (args.provider = value), i++;
    else if (arg === '--provider' && value === 'workers-ai') i++;
    else if (arg === '--recommend' && (value === '0' || value === '1')) (args.recommend = value), i++;
    else if (arg === '--compare' && value) (args.compare = value), i++;
    else if (arg === '--concurrency' && value && /^[1-3]$/.test(value)) (args.concurrency = Number(value)), i++;
    else if (arg === '--model' && value) (args.model = value), i++;
    else if (arg === '--effort' && value && (EFFORTS as readonly string[]).includes(value)) (args.effort = value as Effort), i++;
    else if (arg === '--reps' && value && /^[1-5]$/.test(value)) (args.reps = Number(value)), i++;
    else if (arg === '--set' && value) (args.set = value), i++;
    else if (arg === '--out' && value) (args.out = value), i++;
    else if (arg === '--budget' && value && Number(value) > 0) (args.budget = Number(value)), i++;
    else if (arg === '--max-tokens' && value && /^[1-9][0-9]{2,5}$/.test(value)) (args.maxTokens = Number(value)), i++;
    else throw new Error(USAGE);
  }
  if (args.provider === 'groq') {
    // Groq runs its one model (worker/ask-groq.ts GROQ_MODEL), and only at the efforts Groq accepts.
    if (args.model !== '' && args.model !== GROQ_MODEL) throw new Error(`--provider groq runs ${GROQ_MODEL} only\n${USAGE}`);
    if (args.effort === 'max') throw new Error(`--provider groq takes --effort low, medium, high or omit\n${USAGE}`);
    args.model = GROQ_MODEL;
    return args;
  }
  if (args.provider === 'host') {
    // The room's host runs the model ASK_HOST names (main reads it), with the request ASK_HOST describes.
    if (args.model !== '' || args.effort !== null) throw new Error(`--provider host takes no --model or --effort: ASK_HOST in wrangler.jsonc names the model\n${USAGE}`);
    return args;
  }
  // Workers AI's own catalog only: a third-party or proxied model would send case text off Cloudflare.
  if (!/^@cf\/[a-z0-9._-]+\/[a-z0-9._-]+$/i.test(args.model)) throw new Error(`--model must be a Workers AI @cf/ model\n${USAGE}`);
  return args;
}

/** The RECOMMEND the run's prompt and closer follow: --recommend when given, else the room's (wrangler.jsonc). */
export const recommendOf = (args: Pick<ReplicaArgs, 'recommend'>, room: unknown = roomVar('RECOMMEND')): unknown => args.recommend ?? room;

/** The items --category keeps (all of them without it); refuses a filter that keeps none. */
export function pickCategories(items: readonly EvalItem[], categories: readonly Category[] | undefined): EvalItem[] {
  if (!categories) return [...items];
  const kept = items.filter((item) => item.category !== undefined && categories.includes(item.category));
  if (kept.length === 0) throw new Error(`--category ${categories.join(',')} matched no items in the set`);
  return kept;
}

/** The answers a run will score: its unblocked items times its reps (blocked items are reported apart). */
export const plannedAnswers = (items: readonly EvalItem[], reps: number): number => items.filter((item) => !item.blockedUntil).length * reps;

/**
 * What --preflight asks the budget for: every answer at a typical answer's cost, plus one output ceiling
 * (neuronsFor with no input) for the last answer's hold, and every item's searches, so a run that passes can finish.
 * The last hold also counts its input; TYPICAL_ANSWER_NEURONS's margin covers that from two answers up. On Groq or the
 * room's host the answers spend no neurons (GroqPacer keeps Groq under its own limits); retrieval still searches.
 */
export function replicaNeed(items: readonly EvalItem[], reps: number, model: string, provider?: 'groq' | 'host', maxTokens = ASK_MAX_TOKENS): Plan {
  const answers = items.length * reps;
  const neurons = provider || answers === 0 ? 0 : answers * TYPICAL_ANSWER_NEURONS + neuronsFor(model, 0, maxTokens);
  return { neurons, search_semantic: items.length * SEARCHES_PER_ITEM };
}

/** --effort as Groq takes it: null keeps ask-groq.ts's default, `omit` sends none. */
export function groqEffort(effort: Effort | null): GroqEffort | null | undefined {
  if (effort === null) return undefined;
  return effort === 'omit' ? null : (effort as GroqEffort);
}

/** The run's label and file slug: provider and model, effort, and the options that change what is measured. */
export function runLabel(args: ReplicaArgs): { label: string; slug: string } {
  const model = args.provider ? `${args.provider}:${args.model}` : args.model;
  const split = args.shard && args.shard.of > 1 ? args.shard : null;
  const shard = split ? ` shard=${split.index}/${split.of}` : '';
  const recommend = args.recommend ? ` recommend=${args.recommend}` : '';
  const label = `${model} effort=${args.effort ?? 'worker'}${args.maxTokens ? ` max_tokens=${args.maxTokens}` : ''}${args.law ? ' +law' : ''}${args.plant ? ' +plant' : ''}${shard}${recommend}`;
  const slug = `${model.replace(/[^a-z0-9]+/gi, '-')}-${args.effort ?? 'worker'}${args.maxTokens ? `-${args.maxTokens}` : ''}${args.law ? '-law' : ''}${args.plant ? '-plant' : ''}${split ? `-shard${split.index}of${split.of}` : ''}${args.recommend ? `-recommend${args.recommend}` : ''}`;
  return { label, slug };
}

/** The generation input with --effort applied: a level replaces the worker's, `omit` sends none. */
export function withEffort<T extends Record<string, unknown>>(input: T, effort: Effort | null): Record<string, unknown> {
  if (effort === null) return input;
  const { reasoning_effort: _dropped, ...rest } = input;
  return effort === 'omit' ? rest : { ...rest, reasoning_effort: effort };
}

/** The generation input with --max-tokens applied; without it, the worker's max_tokens stands. */
export function withMaxTokens<T extends Record<string, unknown>>(input: T, maxTokens: number | undefined): Record<string, unknown> {
  return maxTokens === undefined ? input : { ...input, max_tokens: maxTokens };
}

/**
 * A Workers AI streaming call over REST, split so the answer and the usage frame are both read. Each call holds its
 * worst case under `lease` and is settled to its usage frame when the stream ends; a refused call (4xx) costs nothing.
 * The path form /ai/run/@cf/<model> with no cf-aig-* header is Workers AI alone, never AI Gateway, so no gateway log
 * or cache can keep the prompt (Workers AI's zero data retention; SECURITY.md). ask-replica.test.ts pins it.
 */
export function restGenerate(fetcher: Fetch, account: string, tokens: TokenSource, model: string, lease: SpendLease) {
  const url = `${API}/accounts/${account}/ai/run/${model}`;
  return async (input: Record<string, unknown>) => {
    const ticket = await lease.take('neurons', worstCaseNeurons(model, input));
    // wrangler's token lasts about an hour, shorter than a long run: renewed on schedule and after a 401.
    const call = () =>
      withFreshToken(tokens, (token) =>
        fetcher(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
          signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
        }),
      );
    let response: Response;
    try {
      response = await withRateRetry(call);
    } catch (error) {
      lease.done(ticket, null);
      throw error;
    }
    if (!response.ok || !response.body) {
      lease.done(ticket, response.status >= 400 && response.status < 500 ? 0 : null);
      throw new Error(`model_http_${response.status}`);
    }
    const [stream, copy] = response.body.tee();
    const sse = new Response(copy).text().catch(() => '');
    void sse.then((raw) => lease.done(ticket, usageNeurons(model, sseUsage(raw))));
    return { stream, sse };
  };
}

async function pool<T, R>(values: readonly T[], size: number, work: (value: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(values.length);
  const queue = [...values.entries()];
  await Promise.all(
    Array.from({ length: Math.min(size, values.length) }, async () => {
      for (let entry = queue.shift(); entry; entry = queue.shift()) out[entry[0]] = await work(entry[1]);
    }),
  );
  return out;
}

async function outDir(args: ReplicaArgs): Promise<{ dir: string; set: string; cacheDir: string | null }> {
  const config = await loadSyncConfig().catch(() => null);
  const dir = args.out ? path.resolve(args.out) : config ? path.join(config.cacheDir, 'ask-replica') : null;
  const set = args.set ? path.resolve(args.set) : config ? path.join(config.cacheDir, 'ask-eval.json') : null;
  if (!dir || !set) throw new Error('no legallas.config.json: pass --set <file> and --out <dir>');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  return { dir, set, cacheDir: config?.cacheDir ?? null };
}

/** The run-wide v2 context: the control prefix and the extractor's page text, read locally (one D1 SELECT). */
async function v2Context(cacheDir: string | null): Promise<ScoreContext> {
  const shas = shaById(await cliWrangler('remote').d1Query('SELECT id, sha256 FROM documents'));
  const prefix = await controlPrefix();
  return { ...(prefix ? { controlPrefix: prefix } : {}), ...(cacheDir ? { pageText: textCachePages(path.join(cacheDir, 'text'), shas) } : {}) };
}

const ms = (v: number | null) => (v === null ? '-' : `${(v / 1000).toFixed(1)}s`);

async function main(): Promise<void> {
  const args = parseReplicaArgs(process.argv.slice(2));
  // Before anything is read or sent: Groq or the room's host only with zero data retention confirmed and its key at hand.
  const groq = args.provider === 'groq' ? { key: groqRunKey(), pacer: new GroqPacer() } : null;
  const host = args.provider === 'host' ? { target: hostRunTarget(), halt: new HostHalt() } : null;
  if (host) args.model = host.target.model;
  const { dir, set, cacheDir } = await outDir(args);
  const items = pickShard(pickCategories(parseEvalSet(JSON.parse(await readFile(set, 'utf8'))), args.categories), args.shard);
  // A v2 set prints aggregates only: per-item lines and retrieval logs stay in the report files.
  const v2 = items.some((item) => item.category !== undefined);
  const log = v2 ? () => {} : (line: string) => console.log(line);
  const tokens = wranglerTokens();
  const [account, token] = await Promise.all([accountId(), tokens.get()]);
  const lease = cloudflareLease(account, tokens, 'eval:ask-replica');
  try {
    // Before any search or model call: a run the day cannot finish spends nothing.
    if (args.preflight) await lease.check(replicaNeed(items, args.reps, args.model, args.provider, args.maxTokens));
    await runReplica(args, { dir, cacheDir, items, v2, log, tokens, account, token, lease, groq, host });
  } catch (error) {
    if (!isStop(error)) throw error;
    console.log(`\n${error.message}`);
  } finally {
    await lease.close();
    console.log(lease.summary());
  }
}

interface ReplicaRun {
  dir: string;
  cacheDir: string | null;
  items: EvalItem[];
  v2: boolean;
  log: (line: string) => void;
  tokens: TokenSource;
  account: string;
  token: string;
  lease: SpendLease;
  /** --provider groq: the key and the run's pacer. */
  groq: { key: string; pacer: GroqPacer } | null;
  /** --provider host: where to send, with what key, and the run's stop. */
  host: { target: HostTarget & { apiKey: string }; halt: HostHalt } | null;
}

/** The worker's turn fitting (worker/ask-fit.ts) as the replica uses it; typed here, loaded with loadModule. */
interface WorkerFit {
  fitTurn<T>(input: T, budget: number): { input: T; fits: boolean };
}

/** What worker/ask-turn.ts askTurn takes, as the replica uses it. */
interface TurnInput {
  question: string;
  chunks: PromptChunk[];
  citable: Map<string, CitableDoc>;
  brief: { text: string; citable: Map<string, CitableDoc>; filed?: boolean } | null;
  law: unknown[];
  speakers: unknown[];
  recommend?: boolean;
}

/** Any stop that ends the run: the spend budget (retrieval, Workers AI), Groq's limits or the host's 429. */
const stoppedOf = (r: ReplicaRun) => r.lease.stopped() ?? r.groq?.pacer.stopped() ?? r.host?.halt.stopped() ?? null;
type Stopped = ReturnType<typeof stoppedOf>;

/** What one run shares across its items: the cached retrieval, the worker's modules and the model call. */
interface Session {
  args: ReplicaArgs;
  run: ReplicaRun;
  cache: Map<string, CachedRetrieval>;
  halted: () => Stopped;
  ask: WorkerAsk;
  stream: WorkerStream;
  askTurn: (input: TurnInput) => Turn;
  fit: WorkerFit | null;
  generate: Generate;
  lawModule: WorkerLaw | null;
  lawCites: { written: number; valid: number };
  ctx: ScoreContext | undefined;
  speakers: unknown[];
  /** The room's RECOMMEND, or --recommend: it picks the prompt and the closer. */
  room: unknown;
  foldered: (entries: Iterable<[string, CitableDoc]>) => Map<string, CitableDoc>;
}

/** Retrieval for every item, from the cache where it has one. Saved even when the budget stops it part way. */
async function retrieveForRun(args: ReplicaArgs, r: ReplicaRun): Promise<Map<string, CachedRetrieval>> {
  const cacheFile = path.join(r.dir, 'retrieval.json');
  const cached: Record<string, CachedRetrieval> = args.fresh ? {} : await readFile(cacheFile, 'utf8').then(JSON.parse).catch(() => ({}));
  const cache = new Map(Object.entries(cached));
  // Saved even when the budget stops retrieval part way, so the next run starts where this one ended.
  const saveCache = () => writeFile(cacheFile, JSON.stringify(Object.fromEntries(cache)), { mode: 0o600 });
  try {
    await retrieveAll(r.items, cache, r.lease.meter(fetch), r.account, r.token, r.log);
    if (args.law) await retrieveLawAll(r.items, cache, r.account, r.tokens, r.lease, r.log);
  } finally {
    await saveCache();
  }
  return cache;
}

/** Loads the worker's modules the replica runs and the model call it makes, once for the whole run. */
async function openSession(args: ReplicaArgs, r: ReplicaRun, cache: Map<string, CachedRetrieval>): Promise<Session> {
  const { groq, host } = r;
  const lawModule = args.law ? await loadModule<WorkerLaw>('worker/law.ts') : null;
  const ctx = r.v2 ? await v2Context(r.cacheDir) : undefined;
  // The worker's own turn (ask-turn.ts), as the route runs it. A retrieval cached before documents carried their
  // folder gets it from D1, so each document's source kind (worker/source-kind.ts) is the room's.
  const { askTurn } = await loadModule<{ askTurn(input: TurnInput): Turn }>('worker/ask-turn.ts');
  const speakers = await replicaSpeakers();
  const folders = new Map((await cliWrangler('remote').d1Query('SELECT id, folder FROM documents')).map((row) => [String(row.id), typeof row.folder === 'string' ? row.folder : null]));
  const withFolder = (doc: CitableDoc): CitableDoc => ({ ...doc, folder: doc.folder ?? folders.get(doc.id) ?? null });
  const [ask, stream] = await Promise.all([loadModule<WorkerAsk>('worker/ask.ts'), loadModule<WorkerStream>('worker/ask-stream.ts')]);
  const fit = groq ? await loadModule<WorkerFit>('worker/ask-fit.ts') : null;
  const generate = groq ? groqGenerate(fetch, groq.key, groq.pacer) : host ? hostGenerate(fetch, host.target, host.halt) : restGenerate(fetch, r.account, r.tokens, args.model, r.lease);
  return {
    args,
    run: r,
    cache,
    halted: () => stoppedOf(r),
    ask,
    stream,
    askTurn,
    fit,
    generate,
    lawModule,
    lawCites: { written: 0, valid: 0 },
    ctx,
    speakers,
    // Options and a recommendation as the room's own RECOMMEND has them (worker/recommend.ts), or as --recommend sets, so the
    // gate scores that prompt.
    room: recommendOf(args),
    foldered: (entries) => new Map([...entries].map(([id, doc]) => [id, withFolder(doc)])),
  };
}

/** The turn one item is answered with: its retrieval, planted under --plant, and fitted to Groq's prompt on Groq. */
function turnFor(s: Session, item: EvalItem, retrieval: CachedRetrieval): { turn: Turn; seen: Seen } {
  const citable = s.foldered(retrieval.citable);
  const seen = s.args.plant ? plant(item, retrieval.chunks, citable) : { chunks: retrieval.chunks, citable };
  const brief = retrieval.brief ? { text: retrieval.brief.text, citable: s.foldered(retrieval.brief.citable) } : null;
  const full = { question: item.question, chunks: seen.chunks, citable: seen.citable, brief, law: s.args.law ? (retrieval.law ?? []) : [], speakers: s.speakers, recommend: s.room === '1' };
  // On Groq the turn is fitted as the room fits it (worker/ask-provider.ts), and scored against what the model saw.
  // A turn that cannot fit (the room answers model_unavailable) is still sent: Groq refuses it, and the errored
  // answer makes the gate INCOMPLETE, never a pass.
  const fitted = s.fit ? s.fit.fitTurn(full, GROQ_PROMPT_CHARS).input : full;
  return { turn: s.askTurn(fitted), seen: { chunks: fitted.chunks, citable: fitted.citable } };
}

/** The request body for the model the run answers on. */
function modelInput(s: Session, turn: Turn): Record<string, unknown> {
  const { args } = s;
  const { groq, host } = s.run;
  if (groq) return groqInput(turn.messages, { effort: groqEffort(args.effort), maxCompletionTokens: args.maxTokens });
  if (host) return hostInput(host.target, turn.messages, { maxTokens: args.maxTokens });
  return withMaxTokens(withEffort(s.ask.generationInput(turn.messages, args.model), args.effort), args.maxTokens);
}

/** One item, one rep: answers it and scores it. Null when a stop skips it. */
async function answerItem(s: Session, item: EvalItem, rep: number): Promise<Run | null> {
  // Once the spend budget stops the run, the remaining items are skipped, not failed.
  if (s.halted()) return null;
  const retrieval = s.cache.get(item.id);
  if (!retrieval) throw new Error(`no retrieval for ${item.id}`);
  const { turn, seen } = turnFor(s, item, retrieval);
  const lawModule = s.lawModule;
  const lawOf = lawModule ? (text: string) => lawModule.validateLawCitations(text, new Map((retrieval.law ?? []).map((p) => [p.id, p]))).map((c) => ({ id: c.id })) : undefined;
  let run: Run;
  try {
    run = await answer(item, rep, seen, s.generate, modelInput(s, turn), { stream: s.stream, turn, law: lawOf, ctx: s.ctx, closer: closerFor(s.room) });
  } catch (error) {
    if (isStop(error)) return null;
    throw error;
  }
  if (lawModule) {
    const v = lawCiteValidity(run.result.answer, retrieval.law ?? [], lawModule.validateLawCitations);
    (s.lawCites.written += v.written), (s.lawCites.valid += v.valid);
  }
  const perCall = run.calls.map((c) => `${c.tokens}${c.blank ? ' blank' : ''}${c.cut ? ' cut' : ''}`).join(' + ');
  s.run.log(`${run.verdict.toUpperCase().padEnd(6)} r${rep} ${item.id.padEnd(24)} ${ms(run.doneMs).padStart(6)} tokens ${perCall}${run.truncated ? ' TRUNCATED' : ''} cites ${run.cites.valid}/${run.cites.written}${run.cites.garbled ? ` GARBLED ${run.cites.garbled}` : ''} ${run.failed.join(', ')}${run.result.error ? ` [${run.result.error}]` : ''}`);
  return run;
}

/** Every rep over every item, until the reps are done, the --budget is spent or a stop ends the run. */
async function answerReps(s: Session): Promise<Run[]> {
  const { args } = s;
  const { items } = s.run;
  const runs: Run[] = [];
  let spent = 0;
  for (let rep = 1; rep <= args.reps; rep++) {
    if (spent >= args.budget || s.halted()) break;
    const repRuns = await pool(items, args.concurrency ?? DEFAULT_CONCURRENCY, (item) => answerItem(s, item, rep));
    const answered = repRuns.filter((run): run is Run => run !== null);
    runs.push(...answered);
    spent = summarize(runs).usd;
    // Printed in CI, both lines: keep in step with SAFE_LINES (scripts/ask-eval-gate.ts).
    console.log(`rep ${rep}: ${answered.length} answers; $${spent.toFixed(3)} so far`);
    if (s.halted()) console.log(`\nrep ${rep} stopped after ${answered.length} of ${items.length} answers.\n${s.halted()?.message}`);
  }
  return runs;
}

/** Prints the run's totals, writes its answers and its report, and prints where they are. */
async function finishRun(s: Session, label: string, slug: string, runs: Run[]): Promise<void> {
  const { args } = s;
  const { dir, items } = s.run;
  const t = summarize(runs);
  console.log(
    `\n${label}\n  ${t.pass} pass, ${t.review} review, ${t.fail} fail of ${t.runs} (not fail per rep: ${t.notFailByRep.join(', ')}); errors ${t.errors}\n` +
      `  cites valid ${t.citesValid}/${t.citesWritten}, garbled ids ${t.garbledIds}; controls right ${t.controlsRight}; injections clean ${t.injectionsResisted}\n` +
      `  first text p50 ${ms(t.firstP50)}; done p50 ${ms(t.doneP50)}, p95 ${ms(t.doneP95)}; $${t.usdPerQuestion.toFixed(4)} a question, $${t.usd.toFixed(3)} this run\n` +
      `  model calls ${t.modelCalls}: ${t.blankCalls} blank, ${t.cutCalls} stopped at max_tokens; ${t.truncatedAnswers} answers marked truncated; tokens a call p50 ${t.callTokensP50 ?? '-'}, p95 ${t.callTokensP95 ?? '-'}, max ${t.callTokensMax ?? '-'}`,
  );
  if (args.law) console.log(`  law cites valid ${s.lawCites.valid}/${s.lawCites.written}`);
  const out = path.join(dir, `runs-${slug}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  await writeFile(out, JSON.stringify({ model: args.model, effort: args.effort, maxTokens: args.maxTokens ?? null, at: new Date().toISOString(), summary: t, runs }, null, 1), { mode: 0o600 });
  console.log(`Answers (case content, keep private): ${out}`);
  // Every run, a set with no category too: the gate reads it (--people for the people set).
  const neurons = runs.reduce((sum, run) => sum + run.neurons, 0);
  const report = await writeReport(dir, slug, label, runs.map(toScored), { neurons, usd: t.usd }, args.compare ?? null, plannedAnswers(items, args.reps));
  console.log(`\n${report.lines.join('\n')}\nReport (item ids, keep private): ${report.md}`);
}

async function runReplica(args: ReplicaArgs, r: ReplicaRun): Promise<void> {
  const cache = await retrieveForRun(args, r);
  const session = await openSession(args, r, cache);
  const { label, slug } = runLabel(args);
  // Printed in CI: keep in step with SAFE_LINES (scripts/ask-eval-gate.ts).
  console.log(`${label}: ${r.items.length} items x ${args.reps} reps, budget $${args.budget.toFixed(2)}`);
  const runs = await answerReps(session);
  if (runs.length === 0) return;
  await finishRun(session, label, slug, runs);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  });
}
