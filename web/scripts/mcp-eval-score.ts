// SPDX-License-Identifier: Apache-2.0
// Scoring for the legallas-mcp retrieval eval (scripts/mcp-eval.ts). Pure: the Ask eval set's known-answer
// items (scripts/ask-eval-score.ts) and the passages legallas_search returned, a hit or a miss out.
//
// An item is scored when it names expected documents (`expect.citesAnyOf`), matched the way the Ask eval
// matches citations: an expected string equals a passage's document id or appears in its document name
// (case-insensitive). Control and injection items test the answer, not retrieval, and are skipped.
import type { EvalItem } from './ask-eval-score.ts';

/** One passage as the eval sees it. The passage text is never kept. */
export interface Passage {
  id: string;
  name: string;
  page: number | null;
}

export type ItemStatus = 'hit' | 'miss' | 'error';

export interface ItemOutcome {
  id: string;
  status: ItemStatus;
  /** 1-based rank of the first matching passage, or null. */
  rank: number | null;
  passages: number;
  /** A tool error code or transport code when status is 'error'. */
  error: string | null;
}

/** The items this eval can score: known-answer items with at least one expected document. */
export function retrievalItems(items: readonly EvalItem[]): EvalItem[] {
  return items.filter((item) => (item.expect.citesAnyOf ?? []).some((want) => want.trim() !== ''));
}

function matches(passage: Passage, want: string): boolean {
  const needle = want.trim().toLowerCase();
  return needle !== '' && (passage.id === want.trim() || passage.name.toLowerCase().includes(needle));
}

/** 1-based rank of the first passage among the top `top` that matches any expected document, or null. */
export function firstHit(item: EvalItem, passages: readonly Passage[], top: number): number | null {
  const wants = item.expect.citesAnyOf ?? [];
  const index = passages.slice(0, top).findIndex((passage) => wants.some((want) => matches(passage, want)));
  return index === -1 ? null : index + 1;
}

export function scoreItem(item: EvalItem, passages: readonly Passage[], top: number): ItemOutcome {
  const rank = firstHit(item, passages, top);
  return { id: item.id, status: rank === null ? 'miss' : 'hit', rank, passages: Math.min(passages.length, top), error: null };
}

export interface Summary {
  scored: number;
  hits: number;
  misses: number;
  errors: number;
  /** hits / scored. */
  recall: number;
  /** Mean reciprocal rank over scored items (a miss or error counts 0). */
  mrr: number;
}

export function summarize(outcomes: readonly ItemOutcome[]): Summary {
  const count = (status: ItemStatus) => outcomes.filter((o) => o.status === status).length;
  const scored = outcomes.length;
  const reciprocal = outcomes.reduce((sum, o) => sum + (o.rank ? 1 / o.rank : 0), 0);
  return {
    scored,
    hits: count('hit'),
    misses: count('miss'),
    errors: count('error'),
    recall: scored ? count('hit') / scored : 0,
    mrr: scored ? reciprocal / scored : 0,
  };
}

/** One printable line: the item id, its outcome and numbers. Never the question or passage text. */
export function formatOutcome(outcome: ItemOutcome, top: number): string {
  const label = outcome.status.toUpperCase().padEnd(6);
  if (outcome.status === 'error') return `${label}${outcome.id.padEnd(28)}${outcome.error ?? 'error'}`;
  const rank = outcome.rank === null ? 'not in top' : `rank ${outcome.rank}`;
  return `${label}${outcome.id.padEnd(28)}${rank} (${outcome.passages} of top ${top})`;
}

function asPassage(value: unknown): Passage | null {
  const record = value as Record<string, unknown> | null;
  if (!record || typeof record !== 'object' || typeof record.id !== 'string') return null;
  const name = [record.title, record.name, record.document].find((v): v is string => typeof v === 'string') ?? '';
  const page = typeof record.page === 'number' ? record.page : null;
  return { id: record.id, name, page };
}

/**
 * The passages in a legallas_search result, in order: the first array (depth-first) whose entries carry a
 * string `id`. Reads `structuredContent`, or the JSON text block that mcp/format.ts jsonResult also sends.
 */
export function passagesFrom(result: Record<string, unknown> | null, depth = 0): Passage[] {
  return passageRecords(result, depth).map((record) => asPassage(record)!); // safe: passageRecords keeps records with an id
}

/** The raw passage records passagesFrom reads (scripts/mcp-eval-v2.ts reads their control numbers and pages). */
export function passageRecords(result: Record<string, unknown> | null, depth = 0): Record<string, unknown>[] {
  if (!result || depth > 5) return [];
  let value: unknown = depth === 0 ? result.structuredContent : result;
  if (depth === 0 && (value === undefined || value === null)) {
    const text = (result.content as { type?: unknown; text?: unknown }[] | undefined)?.find((c) => c.type === 'text')?.text;
    try {
      value = typeof text === 'string' ? JSON.parse(text) : null;
    } catch {
      value = null;
    }
  }
  if (Array.isArray(value) && value.length > 0 && value.every((entry) => asPassage(entry) !== null)) return value as Record<string, unknown>[];
  if (value && typeof value === 'object') {
    for (const child of Array.isArray(value) ? value : Object.values(value)) {
      if (child && typeof child === 'object') {
        const found = passageRecords(child as Record<string, unknown>, depth + 1);
        if (found.length > 0) return found;
      }
    }
  }
  return [];
}
