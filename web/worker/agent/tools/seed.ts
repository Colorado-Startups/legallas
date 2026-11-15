// SPDX-License-Identifier: Apache-2.0
// The research turn's first search, made before any tool step: quick Ask's own retrieval of the member's exact
// question (routes/ask.ts searchRecord), so the evidence, and with it the final answer's cite book, holds at least the
// passages quick Ask's would. The replica of 2026-10-20 showed why: tool steps search in their own words, and on a
// facts question none of them found the document quick Ask cites every time.
//
// It runs retrieve() under the member's role with ASK_VISUALS and quick Ask's keyword fallback, so a spent AI Search
// month (or an outage) answers from the free keyword index exactly as Ask does. It counts as one of the question's
// MAX_SEARCHES, so the tool steps have one fewer, and the tool-step model reads it as its own first legallas_search
// (steps.ts stepMessages): aliased, withheld where a passage addresses AI tools, and cut, like any tool result.
//
// Privacy: the question goes only to AI Search (or the D1 keyword index). Logs carry a reason word and an error name.
import { askVisuals } from '../../ask.ts';
import { canPerform } from '../../auth.ts';
import type { PromptChunk } from '../../prompt.ts';
import type { CitableDoc } from '../../passages.ts';
import { keywordFallbackFor, RETRIEVAL, retrieve, type KeywordReason } from '../../retrieval.ts';
import { BudgetExhausted } from '../../spend.ts';
import { formatControl } from '../../../mcp/format.ts';
import { KEYWORD_NOTES, passagePage, readableCites } from '../../../mcp/tools/search.ts';
import { FAILED, SEARCH_BUDGET, type ToolState } from './adapters.ts';
import { compactResult } from './compact.ts';

/** What the seed search found: retrieve()'s passages and the live documents they come from. */
export interface SeedFound {
  chunks: PromptChunk[];
  citable: Map<string, CitableDoc>;
}

/** Options for seeding a turn's evidence. */
export interface SeedOptions {
  /**
   * Changes what was found before it becomes evidence. Only the replica passes one (scripts/research-replica.ts
   * --plant puts an injection item's passage where quick Ask's replica does); a turn never does.
   */
  edit?(found: SeedFound): SeedFound;
}

const NOTHING_MATCHED = 'Nothing in the case documents matched the question. Search with other words: a name, a date, a document type or a phrase.';
/** legallas_search's own refusal. A turn never gets here with such a role (turn.ts admit), so this is a second lock. */
const FORBIDDEN = 'forbidden: this member cannot search the room. Reply DONE.';

/** The tool-step model's view of the seed: legallas_search's result shape, through compactResult. */
function seedView(state: ToolState, found: SeedFound, keyword: KeywordReason | null): string {
  const how = keyword ? { fallback: 'keyword', note: KEYWORD_NOTES[keyword] } : {};
  const results = found.chunks.flatMap((chunk) => {
    const doc = found.citable.get(chunk.docId);
    if (!doc) return [];
    const control = formatControl(state.env.CONTROL_PREFIX, doc.control_seq);
    return [{ id: chunk.docId, control, title: doc.name, page: passagePage(chunk.text, chunk.docId), text: readableCites(chunk.text, chunk.docId, control) }];
  });
  const value = results.length > 0 ? { results, ...how } : { results, ...how, message: NOTHING_MATCHED };
  return compactResult({ content: [], structuredContent: value }, state.evidence);
}

/**
 * Searches the record for `question` as quick Ask does, adds the passages to the turn's evidence, and returns the
 * tool-step model's view of them. A role that may not view the room is refused before any search, as legallas_search
 * refuses it. Never throws: a search the month's allowance refused (with no keyword index to answer) is remembered on
 * `state.refused`, any other failure is logged by name, and either becomes the view's words, so the steps go on with
 * the searches they have left.
 */
export async function seedSearch(state: ToolState, question: string, options: SeedOptions = {}): Promise<string> {
  if (!canPerform(state.member.role, 'view')) return FORBIDDEN;
  state.evidence.searches++;
  const visuals = askVisuals(state.env);
  let view: string;
  try {
    const found = await retrieve(state.env.SEARCH, state.env.DB, question, state.member.role, RETRIEVAL, {
      includeVisuals: visuals,
      keywordFallback: keywordFallbackFor(visuals),
      keywordOnOutage: true,
    });
    const kept = options.edit ? options.edit({ chunks: found.chunks, citable: found.citable }) : { chunks: found.chunks, citable: found.citable };
    state.evidence.addChunks(kept.chunks, kept.citable);
    view = seedView(state, kept, found.keywordReason ?? null);
  } catch (error) {
    if (error instanceof BudgetExhausted) {
      state.refused = 'search_semantic';
      view = SEARCH_BUDGET;
    } else {
      console.error('research_seed_failed', error instanceof Error ? error.name : typeof error);
      view = FAILED;
    }
  }
  state.onProgress();
  return view;
}
