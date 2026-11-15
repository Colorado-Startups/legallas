// SPDX-License-Identifier: Apache-2.0
// The legallas-mcp retrieval eval for v2 sets (scripts/mcp-eval.ts): every item marked `mcp: true` with expected
// documents is searched with legallas_search, and scored by control number at document level (an expected
// document among the top N passages) and at page level (that document, on an expected page). A passage's pages
// are its own markers, which the tool writes as "[<control> p. 4]" (mcp/tools/search.ts readableCites), plus its
// `page`. Pure apart from the search call; only ids, ranks and numbers come out, never passage or question text.
import type { EvalItem } from './ask-eval-score.ts';
import { passageRecords } from './mcp-eval-score.ts';
import { SpendStop } from './spend-guard.ts';

/** One passage as the v2 score reads it. */
export interface PassageRef {
  id: string;
  control: string | null;
  pages: number[];
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The passages of a legallas_search result with their control numbers and the pages their own markers name. */
export function passageRefs(result: Record<string, unknown> | null): PassageRef[] {
  return passageRecords(result).map((record) => {
    const id = record.id as string;
    const control = typeof record.control === 'string' ? record.control : null;
    const pages = new Set<number>();
    if (typeof record.page === 'number' && record.page > 0) pages.add(record.page);
    if (typeof record.text === 'string') {
      const own = new RegExp(`\\[(?:${control ? `${escape(control)}|` : ''}doc:${escape(id)}) p\\. (\\d{1,6})\\]`, 'g');
      for (const match of record.text.matchAll(own)) pages.add(Number(match[1]));
    }
    return { id, control, pages: [...pages].sort((a, b) => a - b) };
  });
}

/** Items this eval scores: marked for MCP, not blocked, with expected documents. */
export function v2RetrievalItems(items: readonly EvalItem[]): EvalItem[] {
  return items.filter((item) => item.mcp === true && !item.blockedUntil && (item.expect.docs?.length ?? 0) > 0);
}

/** The control's number, so a fallback prefix still compares (one room has one prefix). */
const number = (control: string | null) => (control ? (/-(\d{6})$/.exec(control)?.[1] ?? null) : null);

export interface V2Outcome {
  id: string;
  status: 'scored' | 'error';
  /** 1-based rank of the first passage from an expected document, or null. */
  docRank: number | null;
  /** 1-based rank of the first passage from an expected document on an expected page, or null. */
  pageRank: number | null;
  /** False when no expected document names its pages: the item has no page-level score. */
  pageScored: boolean;
  error: string | null;
}

export function scoreV2(item: EvalItem, refs: readonly PassageRef[], top: number): V2Outcome {
  const docs = item.expect.docs ?? [];
  const kept = refs.slice(0, top);
  const isDoc = (ref: PassageRef, control: string) => number(ref.control) !== null && number(ref.control) === number(control);
  const docIndex = kept.findIndex((ref) => docs.some((doc) => isDoc(ref, doc.control)));
  const pageIndex = kept.findIndex((ref) => docs.some((doc) => isDoc(ref, doc.control) && doc.pages.some((p) => ref.pages.includes(p))));
  return {
    id: item.id,
    status: 'scored',
    docRank: docIndex === -1 ? null : docIndex + 1,
    pageRank: pageIndex === -1 ? null : pageIndex + 1,
    pageScored: docs.some((doc) => doc.pages.length > 0),
    error: null,
  };
}

export interface V2Summary {
  items: number;
  errors: number;
  docHits: number;
  docRecall: number;
  pageItems: number;
  pageHits: number;
  pageRecall: number;
  /** Mean reciprocal rank of the document hit (a miss or error counts 0). */
  docMrr: number;
}

export function summarizeV2(outcomes: readonly V2Outcome[]): V2Summary {
  const docHits = outcomes.filter((o) => o.docRank !== null).length;
  const paged = outcomes.filter((o) => o.pageScored);
  const pageHits = paged.filter((o) => o.pageRank !== null).length;
  return {
    items: outcomes.length,
    errors: outcomes.filter((o) => o.status === 'error').length,
    docHits,
    docRecall: outcomes.length ? docHits / outcomes.length : 0,
    pageItems: paged.length,
    pageHits,
    pageRecall: paged.length ? pageHits / paged.length : 0,
    docMrr: outcomes.length ? outcomes.reduce((sum, o) => sum + (o.docRank ? 1 / o.docRank : 0), 0) / outcomes.length : 0,
  };
}

/** One search call's outcome: the tool result, or an error code. */
export type V2Search = (query: string, limit: number) => Promise<{ result: Record<string, unknown> | null; error: string | null }>;

/** Searches and scores every v2 item. Errors (tool or transport) score as misses with their code kept. */
export async function evaluateV2(items: readonly EvalItem[], search: V2Search, top: number): Promise<V2Outcome[]> {
  const outcomes: V2Outcome[] = [];
  for (const item of v2RetrievalItems(items)) {
    const pageScored = (item.expect.docs ?? []).some((doc) => doc.pages.length > 0);
    const failed = (error: string): V2Outcome => ({ id: item.id, status: 'error', docRank: null, pageRank: null, pageScored, error });
    try {
      const { result, error } = await search(item.question, top);
      outcomes.push(result === null || result.isError === true ? failed(error ?? 'tool_error') : scoreV2(item, passageRefs(result), top));
    } catch (error) {
      // Out of budget ends the run (scripts/spend-guard.ts); it is not a miss.
      if (error instanceof SpendStop) throw error;
      outcomes.push(failed(error instanceof Error ? error.message.slice(0, 80) : 'error'));
    }
  }
  return outcomes;
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

/** The aggregate line that may print: counts and rates only. */
export function formatV2Summary(s: V2Summary, top: number): string {
  return (
    `v2 retrieval over ${s.items} items: document recall@${top} ${pct(s.docRecall)} (${s.docHits}/${s.items}), ` +
    `page recall@${top} ${pct(s.pageRecall)} (${s.pageHits}/${s.pageItems}), document MRR ${s.docMrr.toFixed(3)}, errors ${s.errors}.`
  );
}
