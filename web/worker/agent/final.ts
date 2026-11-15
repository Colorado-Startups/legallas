// SPDX-License-Identifier: Apache-2.0
// The research turn's final answer: quick Ask's own pipeline (worker/ask-turn.ts) over what this turn's tools found.
// The prompt, the per-request short ids, the label and provenance guards, the citation checks and the "I don't know"
// verdict are exactly quick Ask's, and so is the model call (ask-model.ts runModel: retry, then the fallback model),
// at the final answer's reasoning effort (ask.ts REASONING_EFFORT). Only two things differ: the passages are the
// evidence book (tools/evidence.ts), never retrieval and never client history, and the binding is the ceiling's
// (ceiling.ts finalBinding), which cuts max_tokens to what the question has left. The room's RECOMMEND (recommend.ts)
// adds options and a recommendation exactly as it does to quick Ask's.
//
// The answer goes out as AI SDK UI message chunks: text deltas, then `data-citations` and `data-verdict`
// (protocol.ts). Logs carry counts and names only.
import type { UIMessageChunk } from 'ai';
import { runModel } from '../ask-model.ts';
import { DegenerateAnswer, retryDegenerate, type StopReason } from '../ask-stream.ts';
import { askTurn, type Turn, type TurnInput } from '../ask-turn.ts';
import { inputChars } from '../budget.ts';
import { validateLawCitations } from '../law.ts';
import { DONT_KNOW } from '../prompt.ts';
import { finalBinding, FINAL_INPUT_CHARS, QuestionCeiling } from './ceiling.ts';
import type { ResearchDataParts } from './protocol.ts';
import type { Evidence } from './tools/evidence.ts';

/** One chunk of the research UI message stream. */
export type ResearchChunk = UIMessageChunk<unknown, ResearchDataParts>;

/** Where a turn writes its chunks: the AI SDK's UI message stream writer, or a test's array. */
export interface ChunkWriter {
  write(chunk: ResearchChunk): void;
}

/** What the steps found nothing for: said without a model call, as quick Ask does. */
export const NOTHING_FOUND = `${DONT_KNOW} The research found nothing in this room's documents that answers this. Try naming a document, a person or a date.`;

/** The case picture as ask-brief.ts matterBrief gives it, or null. */
export type Brief = NonNullable<TurnInput['brief']> & { speakers?: TurnInput['speakers'] };

/** What the final answer step takes, including the AI binding and the model. */
export interface FinalInput {
  ai: Pick<Ai, 'run'>;
  model: string;
  question: string;
  evidence: Evidence;
  brief: Brief | null;
  ceiling: QuestionCeiling;
  /** The room's RECOMMEND is "1" (worker/recommend.ts): options and a recommendation, as quick Ask gives them. */
  recommend?: boolean;
  /** A room with no published matter (worker/room-shape.ts): the answer speaks to founders, as quick Ask's does. */
  company?: boolean;
  /** The turn's abort signal: the member left, so the answer stops and the model stream is cancelled. */
  signal?: AbortSignal;
}

/** The final answer: its text and whether it says the documents do not answer. */
export interface FinalAnswer {
  answer: string;
  dontKnow: boolean;
  truncated: boolean;
  /** Passages that reached the prompt, and those withheld as untrusted (quarantine.ts): counts only. */
  passages: number;
  withheld: number;
}

/**
 * The ask-turn for this evidence, within FINAL_INPUT_CHARS: when it is too long, the passages found last are dropped
 * first (the steps search before they read further), then the case picture. Pure apart from askTurn's random boundary.
 */
export function fitTurn(input: TurnInput): Turn {
  let chunks = input.chunks;
  let brief = input.brief;
  let turn = askTurn({ ...input, chunks, brief });
  while (inputChars({ messages: turn.messages }) > FINAL_INPUT_CHARS) {
    if (chunks.length > 0) chunks = chunks.slice(0, Math.max(0, Math.min(chunks.length - 1, Math.floor(chunks.length * 0.85))));
    else if (brief) brief = null;
    else break;
    turn = askTurn({ ...input, chunks, brief });
  }
  return turn;
}

/** Writes a whole text part. */
function writeText(writer: ChunkWriter, id: string, text: string): void {
  writer.write({ type: 'text-start', id });
  writer.write({ type: 'text-delta', id, delta: text });
  writer.write({ type: 'text-end', id });
}

/**
 * Streams the final answer to `writer` and returns it. Throws before the first delta when no model can answer
 * (spend.ts BudgetExhausted, ask-model.ts ModelUnavailable, ceiling.ts CeilingReached): the turn refunds and says so.
 * A failure after text has started is written as `answer_failed` and thrown as well.
 */
export async function runFinal(writer: ChunkWriter, input: FinalInput): Promise<FinalAnswer> {
  const { evidence } = input;
  if (evidence.chunks.length === 0 && !input.brief && evidence.law.length === 0) {
    writeText(writer, 'answer', NOTHING_FOUND);
    writer.write({ type: 'data-citations', id: 'citations', data: { citations: [] } });
    writer.write({ type: 'data-verdict', id: 'verdict', data: { dontKnow: true } });
    return { answer: NOTHING_FOUND, dontKnow: true, truncated: false, passages: 0, withheld: 0 };
  }
  const turn = fitTurn({
    question: input.question,
    chunks: evidence.chunks,
    citable: evidence.citable,
    brief: input.brief,
    law: evidence.law,
    speakers: input.brief?.speakers ?? [],
    recommend: input.recommend === true,
    company: input.company === true,
  });
  const ai = finalBinding(input.ai, input.ceiling);
  // The first call happens here, so a refusal is still thrown before any text (and the turn refunds).
  let first: ReadableStream<Uint8Array> | null = (await runModel(ai, input.model, turn.messages)).stream;
  const start = async () => {
    const stream = first ?? (await runModel(ai, input.model, turn.messages)).stream;
    first = null;
    return stream;
  };
  const { answer, stop } = await streamAnswer(writer, turn.shape(retryDegenerate(start)), input.signal);
  const { citations, dontKnow } = turn.finish(answer);
  const law = evidence.law.length > 0 ? { law: validateLawCitations(answer, evidence.lawCitable) } : {};
  writer.write({ type: 'data-citations', id: 'citations', data: { citations, ...law } });
  const truncated = stop === 'length';
  writer.write({ type: 'data-verdict', id: 'verdict', data: truncated ? { dontKnow, truncated } : { dontKnow } });
  if (truncated) console.error('research_answer_stopped', 'length');
  return { answer, dontKnow, truncated, passages: turn.book.citable.size, withheld: turn.withheld };
}

/**
 * Writes the shaped deltas as one text part and returns the answer and why the model stopped. A cancelled turn
 * (`signal`) closes the model stream and throws TurnCancelled; any other failure writes `answer_failed` and throws.
 */
async function streamAnswer(writer: ChunkWriter, deltas: AsyncGenerator<string, StopReason>, signal: AbortSignal | undefined): Promise<{ answer: string; stop: StopReason }> {
  let answer = '';
  const cancelled = cancellation(signal);
  writer.write({ type: 'text-start', id: 'answer' });
  try {
    for (;;) {
      const next = await Promise.race([deltas.next(), cancelled.promise]);
      if (next.done) {
        writer.write({ type: 'text-end', id: 'answer' });
        return { answer, stop: next.value };
      }
      answer += next.value;
      writer.write({ type: 'text-delta', id: 'answer', delta: next.value });
    }
  } catch (error) {
    writer.write({ type: 'text-end', id: 'answer' });
    if (error instanceof TurnCancelled) {
      // Closes the model stream too (retryDegenerate), so the call stops and settles what it cost (spend.ts).
      await deltas.return(null).catch(() => undefined);
      throw error;
    }
    writer.write({ type: 'error', errorText: 'answer_failed' });
    console.error('research_answer_failed', error instanceof Error ? error.name : typeof error);
    throw error instanceof DegenerateAnswer ? error : new AnswerFailed();
  } finally {
    cancelled.done();
  }
}

/** The answer failed after it started; the turn gives the question back. */
export class AnswerFailed extends Error {
  override name = 'AnswerFailed';
}

/** The member left mid-answer: the answer stops, quietly. */
export class TurnCancelled extends Error {
  override name = 'TurnCancelled';
}

/** A promise that rejects with TurnCancelled when `signal` aborts (never otherwise), and its cleanup. */
function cancellation(signal: AbortSignal | undefined): { promise: Promise<never>; done(): void } {
  let onAbort = () => undefined as void;
  const promise = new Promise<never>((_, reject) => {
    onAbort = () => reject(new TurnCancelled());
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });
  });
  promise.catch(() => undefined);
  return { promise, done: () => signal?.removeEventListener('abort', onAbort) };
}
