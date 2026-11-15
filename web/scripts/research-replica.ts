// SPDX-License-Identifier: Apache-2.0
// The research-mode replica: runs the worktree's own research turn (worker/agent/steps.ts tool steps, then
// worker/agent/final.ts, quick Ask's answer pipeline) on eval items, without a member session or the daily cap, and
// scores each answer with the eval checks (scripts/ask-eval-score.ts) so it compares with eval:ask-replica.
//
//   node scripts/research-replica.ts [--set <file>] [--out <dir>] [--limit 3] [--ids a,b] [--category c[:n],...]
//                                    [--plant] [--model @cf/...] [--tool-model @cf/...]
//
// Run it only when you mean to spend the neurons. A research question may hold up to 2,000 neurons (worker/agent/ceiling.ts) and the
// scripts stop at 7,000 a day, so the default is 3 items: spread a set over days. --tool-model tries another model for
// the tool steps only (for example @cf/zai-org/glm-4.7-flash); without its entry in NEURON_RATES (worker/budget.ts) it
// is held at the dearest rate.
//
// --category picks n items (default 1) of each v2 category named, in that order (for example
// `--category facts:1,unknown:2,injection:2`); within a category, items that exercise a hard gate come first (an
// unknown item's I-don't-know check, an injection item's planted passage), so a small run measures the gates. --plant
// puts each injection item's planted passage where quick Ask's replica does (ask-replica-v2.ts plant, at PLANT_RANK
// among the passages quick Ask's search of the question returns, worker/agent/tools/seed.ts), in memory only.
//
// Bindings, all read-only against production: the AI Search REST search (mcp-replica.ts restSearch), an in-memory
// SQLite copy of `documents` from one SELECT, the published case picture, and the page index rebuilt in memory from
// the extractor's local text cache with the sync's own part builder (scripts/indexparts.ts, its SSN guard included).
// Model calls go straight to Workers AI over REST on wrangler's token, @cf/ models only, no AI Gateway. Every model
// call and search runs under a spend lease (scripts/spend-guard.ts). Answers are case content: they stay in --out
// (mode 700, files mode 600) and only item ids, verdicts and numbers print.
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { usageNeurons, worstCaseNeurons } from '../worker/budget.ts';
import type { CitableDoc } from '../worker/passages.ts';
import type { PromptChunk } from '../worker/prompt.ts';
import { CATEGORY_KIND, checksFor, parseEvalSet, verdict, type Category, type EvalItem, type EvalResult } from './ask-eval-score.ts';
import { controlPrefix, plant, shaById, textCachePages } from './ask-replica-v2.ts';
import { loadSyncConfig } from './config.ts';
import { buildParts } from './indexparts.ts';
import { withFreshToken, withRateRetry, wranglerTokens, type TokenSource } from './law/replica.ts';
import { accountId, documentsDb, loadModule, memoryFiles, publishedMatter, restSearch } from './mcp-replica.ts';
import { cloudflareLease, SpendStop, sseUsage, type SpendLease } from './spend-guard.ts';
import { cliWrangler } from './wrangler.ts';

const API = 'https://api.cloudflare.com/client/v4';
const MODEL_TIMEOUT_MS = 120_000;
/** Ask's default model (wrangler.example.jsonc); research-replica.test.ts refuses one in DEPRECATED_MODELS (worker/budget.ts). */
const DEFAULT_MODEL = '@cf/openai/gpt-oss-120b';
const MATTER_KEY = 'meta/matter.json';

/** Items of one v2 category to run. */
export interface CategoryPick {
  category: Category;
  count: number;
}

export interface ResearchReplicaArgs {
  set?: string;
  out?: string;
  limit: number;
  ids: string[];
  /** Set only by --category. */
  categories?: CategoryPick[];
  /** Plant injection items' passages (eval v2); set only by --plant. */
  plant?: true;
  model: string;
  toolModel: string;
}

const USAGE =
  'usage: node scripts/research-replica.ts [--set <file>] [--out <dir>] [--limit n] [--ids a,b] [--category c[:n],...] [--plant] [--model @cf/...] [--tool-model @cf/...]';

/** `facts:1,unknown:2` as picks; null when a name is not a v2 category or a count is not 1 to 20. */
function parseCategories(value: string): CategoryPick[] | null {
  const picks: CategoryPick[] = [];
  for (const part of value.split(',').filter(Boolean)) {
    const match = /^([a-z-]+)(?::([1-9][0-9]?))?$/.exec(part);
    if (!match || !Object.hasOwn(CATEGORY_KIND, match[1]!)) return null;
    const count = match[2] ? Number(match[2]) : 1;
    if (count > 20) return null;
    picks.push({ category: match[1] as Category, count });
  }
  return picks.length > 0 ? picks : null;
}

export function parseResearchArgs(argv: readonly string[]): ResearchReplicaArgs {
  const args: ResearchReplicaArgs = { limit: 3, ids: [], model: DEFAULT_MODEL, toolModel: DEFAULT_MODEL };
  for (let i = 0; i < argv.length; i++) {
    const [arg, value] = [argv[i], argv[i + 1]];
    const categories = arg === '--category' && value ? parseCategories(value) : null;
    if (arg === '--set' && value) (args.set = value), i++;
    else if (arg === '--out' && value) (args.out = value), i++;
    else if (arg === '--limit' && value && /^[1-9][0-9]?$/.test(value)) (args.limit = Number(value)), i++;
    else if (arg === '--ids' && value) (args.ids = value.split(',').filter(Boolean)), i++;
    else if (categories) (args.categories = categories), i++;
    else if (arg === '--plant') args.plant = true;
    else if (arg === '--model' && value?.startsWith('@cf/')) (args.model = value), i++;
    else if (arg === '--tool-model' && value?.startsWith('@cf/')) (args.toolModel = value), i++;
    else throw new Error(USAGE);
  }
  if (args.toolModel === DEFAULT_MODEL && args.model !== DEFAULT_MODEL) args.toolModel = args.model;
  return args;
}

/** True when the item exercises a hard gate beyond those every answer meets: the I-don't-know check, a planted passage. */
export function exercisesGate(item: EvalItem): boolean {
  return item.expect.dontKnow === true || item.plantedPassage !== undefined;
}

/**
 * The items to run: the ids asked for; else `count` of each category picked, in the order named, the items that
 * exercise a hard gate first (otherwise in set order); else the first `limit`.
 */
export function pickItems(items: readonly EvalItem[], args: Pick<ResearchReplicaArgs, 'limit' | 'ids' | 'categories'>): EvalItem[] {
  if (args.ids.length > 0) return items.filter((item) => args.ids.includes(item.id));
  if (!args.categories) return items.slice(0, args.limit);
  return args.categories.flatMap(({ category, count }) => {
    const of = items.filter((item) => item.category === category);
    return [...of.filter(exercisesGate), ...of.filter((item) => !exercisesGate(item))].slice(0, count);
  });
}

/** What the seed search found (worker/agent/tools/seed.ts SeedFound). */
interface SeedFound {
  chunks: PromptChunk[];
  citable: Map<string, CitableDoc>;
}

/**
 * The seed search's options for `item` (worker/agent/tools/seed.ts SeedOptions): under --plant, an injection item's
 * passage goes among the passages quick Ask's search of the question found, exactly where quick Ask's replica puts it.
 */
export function seedFor(item: EvalItem, args: Pick<ResearchReplicaArgs, 'plant'>): { edit(found: SeedFound): SeedFound } | undefined {
  return args.plant ? { edit: (found) => plant(item, found.chunks, found.citable) } : undefined;
}

/** An R2-shaped page index built in memory from page text, with the sync's own part builder. */
export function memoryIndex(pagesOf: (id: string) => { n: number; text: string }[]) {
  const parts = new Map<string, Map<string, string>>();
  const partsFor = (id: string) => {
    let built = parts.get(id);
    if (!built) parts.set(id, (built = new Map(buildParts(id, pagesOf(id)).map((part) => [part.key, part.body]))));
    return built;
  };
  const idOf = (key: string) => /^text\/([A-Za-z0-9_-]{1,64})\.p/.exec(key)?.[1] ?? null;
  return {
    async list(options?: { prefix?: string }) {
      const id = idOf(options?.prefix ?? '');
      const keys = id ? [...partsFor(id).keys()].filter((key) => key.startsWith(options?.prefix ?? '')) : [];
      return { objects: keys.map((key) => ({ key })), delimitedPrefixes: [], truncated: false };
    },
    async get(key: string) {
      const id = idOf(key);
      const body = id ? partsFor(id).get(key) : undefined;
      return body === undefined ? null : { text: async () => body };
    },
  };
}

/** Workers AI over REST as the binding's run(): @cf/ models only, every call held under `lease` and settled to its usage. */
export function restAi(account: string, tokens: TokenSource, lease: SpendLease, fetcher: typeof fetch = fetch) {
  const run = async (model: string, input: Record<string, unknown>): Promise<unknown> => {
    if (!model.startsWith('@cf/')) throw new Error('model_refused');
    const ticket = await lease.take('neurons', worstCaseNeurons(model, input));
    const call = () =>
      withFreshToken(tokens, (token) =>
        fetcher(`${API}/accounts/${account}/ai/run/${model}`, {
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
    if (input.stream === true) {
      const [stream, copy] = response.body.tee();
      void new Response(copy).text().then((raw) => lease.done(ticket, usageNeurons(model, sseUsage(raw))), () => lease.done(ticket, null));
      return stream;
    }
    const result = ((await response.json()) as { result?: { usage?: unknown } }).result ?? null;
    lease.done(ticket, usageNeurons(model, result?.usage ?? null));
    return result;
  };
  return { run };
}

/** The worker modules this script runs, loaded at runtime (their Workers types do not resolve here). */
interface Modules {
  steps: { runToolSteps(input: Record<string, unknown>): Promise<number> };
  final: { runFinal(writer: { write(chunk: { type: string; data?: unknown }): void }, input: Record<string, unknown>): Promise<{ answer: string; dontKnow: boolean; truncated: boolean }> };
  ceiling: { QuestionCeiling: new () => { held: number } };
  adapters: { toolState(env: unknown, member: unknown): { evidence: { chunks: { docId: string; text: string }[]; citable: Map<string, unknown>; counts(): Record<string, number> } } };
  brief: { matterBrief(load: () => Promise<unknown>, lookup: (ids: readonly string[]) => Promise<Map<string, unknown>>): Promise<unknown> };
  matter: { loadMatter(env: unknown): Promise<unknown> };
  retrieval: { liveDocuments(db: unknown, ids: readonly string[], role: string): Promise<Map<string, unknown>> };
}

async function modules(): Promise<Modules> {
  const [steps, final, ceiling, adapters, brief, matter, retrieval] = await Promise.all(
    ['worker/agent/steps.ts', 'worker/agent/final.ts', 'worker/agent/ceiling.ts', 'worker/agent/tools/adapters.ts', 'worker/ask-brief.ts', 'worker/routes/matter.ts', 'worker/retrieval.ts'].map((file) => loadModule<unknown>(file)),
  );
  return { steps, final, ceiling, adapters, brief, matter, retrieval } as Modules;
}

interface ItemRun {
  id: string;
  category: string | null;
  planted: boolean;
  verdict: string;
  failed: string[];
  steps: number;
  counts: Record<string, number>;
  held: number;
  result: EvalResult;
}

/** One item through the research turn, scored. A spent lease stops the run; any other failure is scored as such. */
async function runItem(m: Modules, item: EvalItem, env: Record<string, unknown>, ai: unknown, args: ResearchReplicaArgs, scoreCtx: Record<string, unknown>): Promise<ItemRun> {
  const member = { email: 'replica@example.test', role: 'owner', name: 'Replica' };
  const ceiling = new m.ceiling.QuestionCeiling();
  const state = m.adapters.toolState(env, member);
  const result: EvalResult = { status: 200, answer: '', citations: [], dontKnow: null, error: null };
  let steps = 0;
  try {
    steps = await m.steps.runToolSteps({ ai, model: args.toolModel, question: item.question, history: [], state, ceiling, seed: seedFor(item, args) });
    const brief = await m.brief.matterBrief(() => m.matter.loadMatter(env), (ids) => m.retrieval.liveDocuments(env.DB, ids, 'owner'));
    const chunks: { type: string; data?: unknown }[] = [];
    const final = await m.final.runFinal({ write: (chunk) => chunks.push(chunk) }, { ai, model: args.model, question: item.question, evidence: state.evidence, brief, ceiling });
    result.answer = final.answer;
    result.dontKnow = final.dontKnow;
    result.citations = ((chunks.find((chunk) => chunk.type === 'data-citations')?.data as { citations?: EvalResult['citations'] }) ?? {}).citations ?? [];
  } catch (error) {
    if (error instanceof SpendStop) throw error;
    result.error = error instanceof Error ? error.name : 'error';
  }
  const citableIds = [...state.evidence.citable.keys()];
  const checks = checksFor(item, result, { ...scoreCtx, chunks: state.evidence.chunks as never, citableIds });
  const planted = args.plant === true && item.plantedPassage !== undefined;
  return { id: item.id, category: item.category ?? null, planted, verdict: verdict(checks), failed: checks.filter((c) => !c.ok).map((c) => c.name), steps, counts: state.evidence.counts(), held: ceiling.held, result };
}

async function main(): Promise<void> {
  const args = parseResearchArgs(process.argv.slice(2));
  const config = await loadSyncConfig().catch(() => null);
  const dir = args.out ? path.resolve(args.out) : config ? path.join(config.cacheDir, 'research-replica') : null;
  const set = args.set ? path.resolve(args.set) : config ? path.join(config.cacheDir, 'ask-eval.json') : null;
  if (!dir || !set) throw new Error('no legallas.config.json: pass --set <file> and --out <dir>');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const items = pickItems(parseEvalSet(JSON.parse(await readFile(set, 'utf8'))), args);
  const tokens = wranglerTokens();
  const [account, token] = await Promise.all([accountId(), tokens.get()]);
  const lease = cloudflareLease(account, tokens, 'research-replica');
  const rows = await cliWrangler('remote').d1Query('SELECT * FROM documents');
  const pageText = config ? textCachePages(path.join(config.cacheDir, 'text'), shaById(rows)) : () => null;
  const pagesById = new Map(rows.map((row) => [String(row.id), Number(row.pages) || 0]));
  const pagesOf = (id: string) => Array.from({ length: pagesById.get(id) ?? 0 }, (_, i) => ({ n: i + 1, text: pageText(id, i + 1)?.text ?? '' })).filter((p) => p.text);
  const prefix = await controlPrefix();
  const env = {
    DB: await documentsDb(rows),
    INDEX: memoryIndex(pagesOf),
    FILES: memoryFiles(MATTER_KEY, await publishedMatter()),
    SEARCH: restSearch(lease.meter(fetch), account, token),
    CONTROL_PREFIX: prefix,
    LAW_LIBRARY: '0',
  };
  const ai = restAi(account, tokens, lease);
  const m = await modules();
  const runs: ItemRun[] = [];
  console.log(`research replica: ${items.length} items, ${args.model}${args.toolModel === args.model ? '' : ` (tools ${args.toolModel})`}${args.plant ? ' +plant' : ''}`);
  try {
    for (const item of items) {
      const run = await runItem(m, item, env, ai, args, { ...(prefix ? { controlPrefix: prefix } : {}), pageText });
      runs.push(run);
      const file = path.join(dir, `${item.id}.json`);
      await writeFile(file, JSON.stringify(run, null, 2), { mode: 0o600 });
      await chmod(file, 0o600);
      console.log(`${run.id}  ${run.category ?? '-'}${run.planted ? ' +plant' : ''}  ${run.verdict}  steps ${run.steps}  ${JSON.stringify(run.counts)}  held ${run.held}${run.failed.length ? `  failed: ${run.failed.join(', ')}` : ''}`);
    }
  } catch (error) {
    if (!(error instanceof SpendStop)) throw error;
    console.log(`\nstopped after ${runs.length} of ${items.length}: ${error.message}`);
  } finally {
    await lease.close();
    console.log(lease.summary());
  }
  const tally = runs.reduce<Record<string, number>>((t, run) => ((t[run.verdict] = (t[run.verdict] ?? 0) + 1), t), {});
  console.log(`\n${runs.length} items: ${JSON.stringify(tally)}; most held by one question: ${Math.max(0, ...runs.map((r) => r.held))} neurons`);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  });
}
