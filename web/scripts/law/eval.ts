// SPDX-License-Identifier: Apache-2.0
// npm run eval:law: the law eval (T21). Every question in scripts/law/law-eval.json (a room's own file, not in this repository) goes through the room's own
// law retrieval (worker/law.ts retrieveLaw) and prompt (worker/prompt.ts buildMessages, law passages only), then
// the room's configured model (or --model) through the Workers AI REST API, and is scored by eval-score.ts. Until the legallas-law instance exists,
// retrieval runs on the local replica (replica.ts) over <lawDir>/out; never against production Ask.
//
//   npm run eval:law                      every question once
//   npm run eval:law -- --reps 3          each question three times (models are noisy)
//   npm run eval:law -- --retrieval-only  retrieval checks only, no model calls
//   npm run eval:law -- --only rule-506b,civil-conspiracy --show
//   npm run eval:law -- --concurrency 1         generations in flight (default 2: the model is shared)
//   npm run eval:law -- --set <file>            these questions instead of law-eval.json (collect.ts --questions writes the law pages')
//   npm run eval:law -- --answer-daily 10       every question retrieved, today's 10 answered: each one every ceil(n / 10) days
//
// Each row carries `search_ms`, its retrieval's wall time (the embedding call included), or null when the retrieval failed:
// quality-speed/core/law reads it as the law pages' search_p95.
//
// The questions and the corpus are public law, so the report may be read freely; it is written to
// <lawDir>/eval/. Spend is printed from Workers AI's neuron counts ($0.011 per 1,000 neurons). Every embedding and
// generation runs under a spend lease (scripts/spend-guard.ts): at the day's neuron budget the run stops, reports the
// questions it answered, and gives back what it held.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { usageNeurons, worstCaseNeurons } from '../../worker/budget.ts';
import { accountId, loadModule } from '../mcp-replica.ts';
import { cloudflareLease, SpendStop, type SpendLease } from '../spend-guard.ts';
import { citeCounts, lawChecks, lawVerdict, parseLawEvalSet, type LawEvalItem, type LawEvalResult } from './eval-score.ts';
import { mapLimit } from '../pool.ts';
import { lawDir } from './plan.ts';
import { localLawLibrary, withFreshToken, withRateRetry, wranglerTokens, type TokenSource } from './replica.ts';
import { readWranglerConfig } from '../../worker/wrangler-config.ts';
import type { LawChunk } from '../../worker/law-cite.ts';

const API = 'https://api.cloudflare.com/client/v4';
/** The room's configured model (wrangler.jsonc LEGALLAS_MODEL), so the eval measures what Ask runs. */
export function configuredModel(jsonc: string = readWranglerConfig('wrangler').raw): string {
  const model = /"LEGALLAS_MODEL"\s*:\s*"(@cf\/[^"]+)"/.exec(jsonc)?.[1];
  if (!model) throw new Error('no LEGALLAS_MODEL in wrangler.jsonc');
  return model;
}
const DOLLARS_PER_NEURON = 0.011 / 1000;
/** Generations in flight at once. Two by default: several sessions evaluate the same shared model. */
const CONCURRENCY = 2;

/** The parsed arguments of the law eval run. */
export interface LawEvalArgs {
  reps: number;
  retrievalOnly: boolean;
  only: string[] | null;
  show: boolean;
  model: string;
  /** --concurrency 1-3; CONCURRENCY when absent. */
  concurrency?: number;
  /** --set: the questions file; scripts/law/law-eval.json when absent. */
  set?: string;
  /** --answer-daily 1-99: every question retrieved, this many answered, a different slice each UTC day (answeredToday). */
  answerDaily?: number;
}

const USAGE = 'usage: eval:law [--reps 1-5] [--retrieval-only | --answer-daily 1-99] [--only id,id] [--set <file>] [--model @cf/...] [--concurrency 1-3] [--show]';

/** Parses the law eval run's command-line arguments. */
export function parseLawEvalArgs(argv: readonly string[]): LawEvalArgs {
  const args: LawEvalArgs = { reps: 1, retrievalOnly: false, only: null, show: false, model: configuredModel() };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--reps' && /^[1-5]$/.test(argv[i + 1] ?? '')) args.reps = Number(argv[++i]);
    else if (arg === '--retrieval-only') args.retrievalOnly = true;
    else if (arg === '--show') args.show = true;
    else if (arg === '--only' && argv[i + 1]) args.only = argv[++i]!.split(',');
    else if (arg === '--model' && /^@cf\/[a-z0-9._/-]+$/.test(argv[i + 1] ?? '')) args.model = argv[++i]!;
    else if (arg === '--concurrency' && /^[1-3]$/.test(argv[i + 1] ?? '')) args.concurrency = Number(argv[++i]);
    else if (arg === '--set' && argv[i + 1] && !argv[i + 1]!.startsWith('-')) args.set = argv[++i]!;
    else if (arg === '--answer-daily' && /^[1-9]\d?$/.test(argv[i + 1] ?? '')) args.answerDaily = Number(argv[++i]);
    else throw new Error(USAGE);
  }
  if (args.retrievalOnly && args.answerDaily) throw new Error(`--retrieval-only answers nothing, so it takes no --answer-daily\n${USAGE}`);
  return args;
}

const DAY_MS = 86_400_000;

/**
 * The ids --answer-daily answers today: the set sorted by id, cut into slices of `perDay`, one slice per UTC day in turn.
 * Each question is answered once every ceil(count / perDay) days; the rest of the set is retrieved only.
 */
export function answeredToday(ids: readonly string[], perDay: number, now = new Date()): Set<string> {
  const sorted = [...ids].sort();
  const slices = Math.max(1, Math.ceil(sorted.length / perDay));
  const slice = Math.floor(now.getTime() / DAY_MS) % slices;
  return new Set(sorted.slice(slice * perDay, (slice + 1) * perDay));
}

interface Passage extends LawChunk {
  text: string;
}
interface LawModule {
  ASK_LAW_MIN_VECTOR: number;
  retrieveLaw(search: unknown, bucket: unknown, question: string, options?: { minVector?: number }): Promise<{ passages: Passage[]; citable: Map<string, LawChunk> }>;
  validateLawCitations(answer: string, citable: Map<string, LawChunk>): LawChunk[];
}
interface PromptModule {
  buildMessages(question: string, chunks: unknown[], boundary?: string, brief?: string | null, law?: Passage[]): { role: string; content: string }[];
}
interface AskModule {
  generationInput(messages: { role: string; content: string }[], model?: string): Record<string, unknown>;
}

/**
 * One non-streamed generation through the REST API: the answer text and the neurons it cost. It holds its worst case
 * under `lease` first and is settled to the usage it reports; a refused call (4xx) costs nothing.
 */
async function generate(account: string, tokens: TokenSource, model: string, input: Record<string, unknown>, lease: SpendLease): Promise<{ text: string; neurons: number }> {
  const ticket = await lease.take('neurons', worstCaseNeurons(model, input));
  let response: Response;
  try {
    response = await withRateRetry(() =>
      withFreshToken(tokens, (token) => fetch(`${API}/accounts/${account}/ai/run/${model}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...input, stream: false }),
        signal: AbortSignal.timeout(240_000),
      })),
    );
  } catch (error) {
    lease.done(ticket, null);
    throw error;
  }
  const body = (await response.json().catch(() => null)) as { result?: { choices?: { message?: { content?: string } }[]; response?: string; usage?: unknown } } | null;
  if (!response.ok || !body?.result) {
    lease.done(ticket, response.status >= 400 && response.status < 500 ? 0 : null);
    throw new Error(`generation_http_${response.status}`);
  }
  const neurons = usageNeurons(model, body.result.usage);
  lease.done(ticket, neurons);
  const text = body.result.choices?.[0]?.message?.content ?? body.result.response ?? '';
  return { text, neurons: neurons ?? 0 };
}

async function main(): Promise<void> {
  const args = parseLawEvalArgs(process.argv.slice(2));
  const dir = lawDir();
  const set = args.set ?? path.join(import.meta.dirname, 'law-eval.json');
  const items = parseLawEvalSet(JSON.parse(await readFile(set, 'utf8'))).filter((item) => !args.only || args.only.includes(item.id));
  const [tokens, account] = [wranglerTokens(), await accountId()];
  const lease = cloudflareLease(account, tokens, 'eval:law');
  try {
    await evaluate(args, items, dir, account, tokens, lease);
  } catch (error) {
    if (!(error instanceof SpendStop)) throw error;
    console.log(`\n${error.message}`);
  } finally {
    await lease.close();
    console.log(lease.summary());
  }
}

async function evaluate(args: LawEvalArgs, items: LawEvalItem[], dir: string, account: string, tokens: TokenSource, lease: SpendLease): Promise<void> {
  const { search, bucket } = await localLawLibrary(dir, account, tokens, (line) => console.log(line), lease);
  const law = await loadModule<LawModule>('worker/law.ts');
  const prompt = await loadModule<PromptModule>('worker/prompt.ts');
  const ask = await loadModule<AskModule>('worker/ask.ts');

  // `answered`: the model was asked. A retrieval-only row passes on its one check and has no answer, so a reader of the
  // report (quality-speed/core/law) never counts it as an answer. `neurons`: what this row cost, embeddings aside.
  const rows: { id: string; rep: number; answered: boolean; neurons: number; search_ms: number | null; verdict: string; failed: string[]; result: LawEvalResult }[] = [];
  let neurons = 0;
  const due = args.answerDaily ? answeredToday(items.map((item) => item.id), args.answerDaily) : null;
  const answers = (item: LawEvalItem) => (due ? due.has(item.id) : !args.retrievalOnly);
  // Retrievals first: they cost an embedding each, so a budget stop cuts answers, never the cheap rows.
  const jobs = items
    .flatMap((item) => Array.from({ length: args.reps }, (_, i) => ({ item, rep: i + 1, answer: answers(item) })))
    .sort((a, b) => Number(a.answer) - Number(b.answer));
  await mapLimit(jobs, args.concurrency ?? CONCURRENCY, async ({ item, rep, answer }) => {
    // Once the spend budget stops the run, the remaining questions are skipped, not failed.
    if (lease.stopped()) return;
    let outcome: Awaited<ReturnType<typeof runOne>>;
    try {
      outcome = await runOne(item, answer, { law, prompt, ask, search, bucket, account, tokens, lease, model: args.model });
    } catch (error) {
      if (error instanceof SpendStop) return;
      throw error;
    }
    const { result, cost, searchMs } = outcome;
    neurons += cost;
    const checks = lawChecks(item, result).filter((c) => answer || c.name === 'retrieved');
    const verdict = lawVerdict(checks);
    const failed = checks.filter((c) => !c.ok).map((c) => c.name);
    rows.push({ id: item.id, rep, answered: answer, neurons: cost, search_ms: searchMs, verdict, failed, result });
    console.log(`${verdict.toUpperCase().padEnd(5)} ${item.id.padEnd(30)} rep ${rep} ${failed.join(', ')}${result.error ? ` [${result.error}]` : ''}`);
    if (args.show) console.log(`  retrieved: ${result.retrieved.slice(0, 8).join(' ')}\n  ${result.answer.replace(/\n/g, '\n  ')}\n`);
  });
  const stop = lease.stopped();
  if (stop) console.log(`\n${stop.message}\nAnswered ${rows.length} of ${jobs.length} runs before the stop.`);
  summarize(rows, neurons, args);
  await mkdir(path.join(dir, 'eval'), { recursive: true, mode: 0o700 });
  const out = path.join(dir, 'eval', `law-eval-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  await writeFile(out, JSON.stringify({ at: new Date().toISOString(), model: args.model, reps: args.reps, neurons, rows }, null, 1), { mode: 0o600 });
  console.log(`Report: ${out}`);
}

interface Deps {
  law: LawModule;
  prompt: PromptModule;
  ask: AskModule;
  search: unknown;
  bucket: unknown;
  account: string;
  tokens: TokenSource;
  lease: SpendLease;
  model: string;
}

/** One question's run. `searchMs`: its retrieval's wall time in whole milliseconds, or null when the retrieval failed. */
export async function runOne(item: LawEvalItem, answer: boolean, d: Deps): Promise<{ result: LawEvalResult; cost: number; searchMs: number | null }> {
  // Ask's own relevance floor, so the eval measures what Ask would send. A failed retrieval (an embedding call
  // refused, say) fails this run only: one 401 once ended a long run with no report (2026-10-05).
  let retrieved: Awaited<ReturnType<LawModule['retrieveLaw']>>;
  const start = performance.now();
  try {
    retrieved = await d.law.retrieveLaw(d.search, d.bucket, item.question, { minVector: d.law.ASK_LAW_MIN_VECTOR });
  } catch (error) {
    if (error instanceof SpendStop) throw error;
    return { result: { answer: '', retrieved: [], citations: [], error: `retrieval: ${error instanceof Error ? error.message : 'failed'}` }, cost: 0, searchMs: null };
  }
  const searchMs = Math.round(performance.now() - start);
  const ids = retrieved.passages.map((p) => p.id);
  if (!answer) return { result: { answer: '', retrieved: ids, citations: [] }, cost: 0, searchMs };
  try {
    const messages = d.prompt.buildMessages(item.question, [], undefined, null, retrieved.passages);
    const input = d.ask.generationInput(messages, d.model);
    const { text, neurons } = await generate(d.account, d.tokens, d.model, input, d.lease);
    return { result: { answer: text, retrieved: ids, citations: d.law.validateLawCitations(text, retrieved.citable) }, cost: neurons, searchMs };
  } catch (error) {
    if (error instanceof SpendStop) throw error;
    return { result: { answer: '', retrieved: ids, citations: [], error: error instanceof Error ? error.message : 'failed' }, cost: 0, searchMs };
  }
}

function summarize(rows: { id: string; verdict: string; failed: string[]; result: LawEvalResult }[], neurons: number, args: LawEvalArgs): void {
  const pass = rows.filter((r) => r.verdict === 'pass').length;
  const retrieved = rows.filter((r) => !r.failed.includes('retrieved')).length;
  console.log(`\n${pass} pass of ${rows.length} runs; expected authority retrieved in ${retrieved} of ${rows.length}.`);
  if (!args.retrievalOnly) {
    const cites = citeCounts(rows.map((r) => r.result));
    console.log(`Law cites: ${cites.valid} valid of ${cites.cited} (${cites.invalid} invalid). Spend: ${neurons.toFixed(0)} neurons, about $${(neurons * DOLLARS_PER_NEURON).toFixed(3)}.`);
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  });
}
