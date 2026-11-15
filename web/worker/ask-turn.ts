// SPDX-License-Identifier: Apache-2.0
// One Ask turn from retrieval to verdict, shared by POST /api/ask (routes/ask.ts) and the eval replica
// (scripts/ask-replica.ts), so the eval scores exactly what the reader sees: the prompt with short cite ids
// (cite-book.ts), the model's deltas shaped for the reader (answer-shape.ts), then the validated citations and the
// "I don't know" verdict over the shaped answer. Passages that address the model, or read as a court order outside
// the court's record, are marked untrusted first and never become citable (quarantine.ts).
import { answerShaper, shapeDeltas, type LabelPolicy, type ShapeStats } from './answer-shape.ts';
import type { StopReason } from './ask-stream.ts';
import { validateCitations, type Citation } from './citations.ts';
import { citeBook, type CiteBook } from './cite-book.ts';
import type { CitableDoc } from './passages.ts';
import { buildMessages, type ChatMessage, type LawPassage, type PromptChunk } from './prompt.ts';
import { quarantine } from './quarantine.ts';
import type { Speaker } from './speaker.ts';

/** True when an answer opens with the "I don't know" verdict (straight or curly apostrophe). */
export function isDontKnow(answer: string): boolean {
  return /^\s*I don['’]t know\b/i.test(answer);
}

export interface TurnInput {
  question: string;
  /** Retrieved passages, already filtered to live documents (retrieval.ts retrieve). */
  chunks: readonly PromptChunk[];
  /** The live documents of those passages. */
  citable: ReadonlyMap<string, CitableDoc>;
  /** The case picture, the live documents its proof tags name and whether the complaint is filed (ask-brief.ts), or null. */
  brief: { text: string; citable: ReadonlyMap<string, CitableDoc>; filed?: boolean } | null;
  /** Law library passages, when law reached the prompt. */
  law?: readonly LawPassage[];
  /** The writers the manifest knows (speaker.ts), so an attributed letter or email names whose statement it is. */
  speakers?: readonly Speaker[];
  /** The room's RECOMMEND is "1" (recommend.ts): the prompt asks for options and a recommendation. */
  recommend?: boolean;
  /** A room with no published matter (room-shape.ts isCompanyRoom): the prompt speaks to founders, not counsel. */
  company?: boolean;
}

export interface Turn {
  messages: ChatMessage[];
  book: CiteBook;
  /** Counts from shaping (unresolved cite ids, relabelled and attributed claims); never text. */
  stats: ShapeStats;
  /** Passages marked untrusted (quarantine.ts): they address the model or read as an unfiled order; fenced, never citable. */
  withheld: number;
  /** The model's text deltas as the reader sees them; returns the model's stop reason. */
  shape(deltas: AsyncIterable<string, StopReason | void>): AsyncGenerator<string, StopReason>;
  /** Validated citations and the verdict, over the shaped answer. */
  finish(answer: string): { citations: Citation[]; dontKnow: boolean };
}

export function askTurn(input: TurnInput, options: { boundary?: string; policy?: LabelPolicy } = {}): Turn {
  const { chunks, withheld } = quarantine(input.chunks, (chunk) => input.citable.get(chunk.docId));
  const book = citeBook(chunks.filter((chunk) => !chunk.untrusted), input.citable, input.brief, input.speakers ?? []);
  const brief = input.brief ? { text: input.brief.text, filed: input.brief.filed === true } : null;
  const messages = buildMessages(input.question, chunks, options.boundary, brief, input.law ?? [], book, input.recommend === true, input.company === true);
  const shaper = answerShaper(book, options.policy);
  return {
    messages,
    book,
    stats: shaper.stats,
    withheld,
    shape: (deltas) => shapeDeltas(deltas, shaper),
    finish: (answer) => ({ citations: validateCitations(answer, book.citable, chunks, book), dontKnow: isDontKnow(answer) }),
  };
}
