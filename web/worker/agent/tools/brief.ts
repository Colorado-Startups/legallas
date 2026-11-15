// SPDX-License-Identifier: Apache-2.0
// Paged results for the tool steps: the full track briefs (plan session 9), and comment threads (extra.ts). The
// overview and the comments run with the compact profile (extra.ts profileFor), so a long track comes in parts sharing
// its id; but a page is sized as pretty JSON for a client, and the model's view (compact.ts compactResult) is cut at
// TOOL_RESULT_CHARS. A cut there would lose the end of the page, and with it the cursor (compact.ts also drops a
// `next_cursor`), so the rest of a brief or a thread list could never be read. fitList keeps the page's first items
// whose view fits and sets nextCursor to the first item it left out (encoded as the tool encodes its own cursors). A
// single item too long alone is fitted by compact.ts, which keeps the cursor and marks each cut. Every item is so
// reached in order, none cut unseen.
import type { CallToolResult } from '@modelcontextprotocol/server';
import { decodePosition, encodePosition, type Position } from '../../../mcp/tools/overview-page.ts';
import { TOOL_RESULT_CHARS } from '../ceiling.ts';
import { compactResult } from './compact.ts';
import type { Evidence } from './evidence.ts';

type Value = Record<string, unknown>;

const isCount = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 1;

/**
 * Where an overview page goes on after `kept`, its first items, given where it started. An item marked `part` of
 * `parts` (overview-page.ts splitEntry, 1-based) before its last part leads to the entry's next part; anything else, a
 * whole entry or a last part (or a defined term), to the next entry.
 */
export function positionAfter(start: Position, kept: readonly unknown[]): Position {
  let at: Position = start;
  for (const item of kept) {
    const { part, parts } = (item ?? {}) as Value;
    at = isCount(part) && isCount(parts) && part < parts ? { offset: at.offset, part } : { offset: at.offset + 1, part: 0 };
  }
  return at;
}

/** The view's length before any cut. Aliases minted here are the ones the next page would mint anyway. */
function viewLength(result: CallToolResult, evidence: Evidence): number {
  return compactResult(result, evidence, Number.MAX_SAFE_INTEGER).length;
}

/**
 * The view of `result`, whose structured content carries the array `list`: nextCursor first, the tool's `own` cursor
 * when the whole page fits, else the page cut back to its first items that fit (at least one) and `cursorAfter(kept)`.
 */
export function fitList(result: CallToolResult, evidence: Evidence, list: string, own: unknown, cursorAfter: (kept: number) => string): string {
  const value = result.structuredContent as Value;
  const items = value[list] as unknown[];
  const page = (count: number): CallToolResult => {
    // Listed first, so the model reads where to go on before anything else.
    const structured: Value = { nextCursor: null, ...value, [list]: items.slice(0, count) };
    structured.nextCursor = count < items.length ? cursorAfter(count) : (own ?? null);
    return { ...result, structuredContent: structured };
  };
  let count = items.length;
  while (count > 1 && viewLength(page(count), evidence) > TOOL_RESULT_CHARS) count--;
  return compactResult(page(count), evidence);
}

/** The list an overview page carries: a section's entries, or the summary's defined terms. */
function listOf(value: Value): 'entries' | 'definedTerms' | null {
  if (Array.isArray(value.entries)) return 'entries';
  if (Array.isArray(value.definedTerms)) return 'definedTerms';
  return null;
}

/** The model's view of a legallas_case_overview result: fitList, with the overview's own positions as cursors. */
export function overviewView(args: Value, result: CallToolResult, evidence: Evidence): string {
  const value = result.structuredContent as Value | undefined;
  const list = !result.isError && value ? listOf(value) : null;
  if (!value || !list) return compactResult(result, evidence);
  const section = typeof args.section === 'string' ? args.section : 'summary';
  const items = value[list] as unknown[];
  const start = (typeof args.cursor === 'string' ? decodePosition(args.cursor, section, 'compact') : null) ?? { offset: 0, part: 0 };
  return fitList(result, evidence, list, value.nextCursor, (kept) => encodePosition(section, positionAfter(start, items.slice(0, kept)), 'compact'));
}
