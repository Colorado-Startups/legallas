// SPDX-License-Identifier: Apache-2.0
// One answer of the Ask Legallas model replica (scripts/ask-replica.ts): the model's stream goes through the worker's own
// turn (worker/ask-turn.ts shape and finish), then is scored with the eval checks. Split out of ask-replica.ts, which
// plans the run, retrieves, and prints.
import type { Citation } from '../worker/citations.ts';
import type { CitableDoc } from '../worker/passages.ts';
import type { PromptChunk } from '../worker/prompt.ts';
import { garbledIds, type ScoreContext } from './ask-eval-checks.ts';
import { checksFor, verdict, type EvalItem, type EvalResult } from './ask-eval-score.ts';
import { GroqStop } from './ask-replica-groq.ts';
import { HostStop } from './ask-replica-host.ts';
import { callShape, citeValidity, streamUsage, type Run } from './ask-replica-runs.ts';
import { SpendStop } from './spend-guard.ts';

export interface WorkerStream {
  /** Returns the stop reason of the stream it answered from. */
  retryDegenerate(start: () => Promise<ReadableStream<Uint8Array>>): AsyncGenerator<string, string | null>;
}

/** The passages and documents one answer sees: the cached retrieval, plus the planted passage under --plant. */
export interface Seen {
  chunks: PromptChunk[];
  citable: Map<string, CitableDoc>;
}

/** The worker's turn (worker/ask-turn.ts Turn) as the replica uses it; typed here, loaded with loadModule. */
export interface Turn {
  messages: { role: 'system' | 'user'; content: string }[];
  book: { citable: Map<string, CitableDoc>; ids: Map<string, string> };
  stats: Record<string, unknown>;
  shape(deltas: AsyncIterable<string, string | null | void>): AsyncGenerator<string, string | null>;
  finish(answer: string): { citations: Citation[]; dontKnow: boolean };
}

export interface AnswerParts {
  stream: WorkerStream;
  /** The worker's own turn: shapes the deltas as the room does, then gives the citations and the verdict. */
  turn: Turn;
  /** --law: the answer's validated law cites, as Ask's `citations` event carries them. */
  law?: (answer: string) => { id: string }[];
  /** Eval v2: the run-wide scoring context; answer() adds this question's passages and citable ids. */
  ctx?: ScoreContext;
  /** The background closer the prompt asked for (ask-eval-score.ts closerFor). */
  closer?: string;
}

/** Starts one model call: its answer stream, and its usage frame as text once the stream ends. */
export type Generate = (input: Record<string, unknown>) => Promise<{ stream: ReadableStream<Uint8Array>; sse: Promise<string> }>;

/** A stop that ends the run cleanly (the spend budget, or Groq's or the host's limits): the item is skipped, not failed. */
export const isStop = (error: unknown): error is SpendStop | GroqStop | HostStop => error instanceof SpendStop || error instanceof GroqStop || error instanceof HostStop;

/** Records the raw model text on its way to the shaper. */
async function* tap(source: AsyncGenerator<string, string | null>, sink: { raw: string }): AsyncGenerator<string, string | null> {
  for (let next = await source.next(); ; next = await source.next()) {
    if (next.done) return next.value;
    sink.raw += next.value;
    yield next.value;
  }
}

/** What reading one answer's stream gave: the scored result, and the usage frames of every call that made it. */
interface Streamed {
  result: EvalResult;
  truncated: boolean;
  firstMs: number | null;
  frames: Promise<string>[];
  raw: string;
}

/** Streams the answer through the worker's turn. An error becomes the result's error, except a stop, which ends the run. */
async function readAnswer(generate: Generate, input: Record<string, unknown>, parts: AnswerParts, started: number): Promise<Streamed> {
  let firstMs: number | null = null;
  let text = '';
  let truncated = false;
  const frames: Promise<string>[] = [];
  const result: EvalResult = { status: 200, answer: '', citations: [], dontKnow: null, error: null };
  const sink = { raw: '' };
  try {
    const start = async () => {
      const { stream, sse } = await generate(input);
      frames.push(sse);
      return stream;
    };
    const deltas = parts.turn.shape(tap(parts.stream.retryDegenerate(start), sink));
    for (let next = await deltas.next(); ; next = await deltas.next()) {
      if (next.done) {
        truncated = next.value === 'length';
        break;
      }
      firstMs ??= Date.now() - started;
      text += next.value;
    }
    // The text as the reader sees it (cites mapped back, labels checked); a cite that validation drops below
    // still reaches the scorer. The model's own text is kept in the run as `raw`.
    result.answer = text;
    const finish = parts.turn.finish(text);
    result.citations = finish.citations;
    result.dontKnow = finish.dontKnow;
    if (parts.law) result.law = parts.law(text);
  } catch (error) {
    // Out of budget is not the model's answer: the run stops, and this item is not scored.
    if (isStop(error)) throw error;
    result.error = error instanceof Error ? error.message.slice(0, 80) : 'error';
  }
  return { result, truncated, firstMs, frames, raw: sink.raw };
}

/** The usage of every call that went into an answer: a retried stream bills too. */
async function totalUsage(frames: readonly Promise<string>[]): Promise<{ raws: string[]; usage: { neurons: number; promptTokens: number; completionTokens: number } }> {
  const usage = { neurons: 0, promptTokens: 0, completionTokens: 0 };
  const raws = await Promise.all(frames);
  for (const raw of raws) {
    const u = streamUsage(raw);
    if (u) (usage.neurons += u.neurons), (usage.promptTokens += u.promptTokens), (usage.completionTokens += u.completionTokens);
  }
  return { raws, usage };
}

export async function answer(item: EvalItem, rep: number, seen: Seen, generate: Generate, input: Record<string, unknown>, parts: AnswerParts): Promise<Run> {
  const started = Date.now();
  const { result, truncated, firstMs, frames, raw } = await readAnswer(generate, input, parts, started);
  const doneMs = Date.now() - started;
  const { raws, usage } = await totalUsage(frames);
  // The short ids count too, so a short id the book does not know (garbled or invented) counts as a garbled id.
  const citableIds = [...parts.turn.book.citable.keys(), ...parts.turn.book.ids.keys()];
  const closer = parts.closer ? { closer: parts.closer } : {};
  const checks = checksFor(item, result, parts.ctx ? { ...parts.ctx, chunks: seen.chunks, citableIds, ...closer } : closer);
  return {
    id: item.id,
    kind: item.kind,
    rep,
    verdict: verdict(checks),
    failed: checks.filter((c) => !c.ok).map((c) => c.name + (c.soft ? ' (review)' : '')),
    firstMs,
    doneMs,
    ...usage,
    cites: { ...citeValidity(result.answer, result.citations), garbled: garbledIds(result.answer, citableIds) },
    calls: raws.map(callShape),
    truncated,
    result,
    ...(item.category ? { category: item.category } : {}),
    blocked: Boolean(item.blockedUntil),
    checks,
    raw,
    shape: { ...parts.turn.stats },
  };
}
