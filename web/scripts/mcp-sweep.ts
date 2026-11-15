// SPDX-License-Identifier: Apache-2.0
// The page sweep in `mcp:smoke --local`: read one multi-part document end to end with legallas_read_pages,
// following `next`, and check the pages come back as 1..N exactly once each, N being legallas_get_document's
// page count, with no page blank where the index has text.
//
// "Where the index has text" is worked out here, independently of the server's own regrouping
// (mcp/pages-text.ts): the local index parts (`text/<id>.p<N>.md` in the local legallas-index bucket) are read
// and split on their `[[doc:<id> p:<n>]]` markers (scripts/indexparts.ts writes them). Parts split at
// PART_MAX_BYTES, so only a very long document has several. Output is counts only, never page text.
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { partKey } from './indexparts.ts';
import { resultValue, type McpSession, type ToolReply } from './mcp-client.ts';
import type { Report } from './mcp-flow.ts';
import { cliWrangler, INDEX_BUCKET } from './wrangler.ts';

/** Reads index part `part` (1-based) of a document, or null when there is no such part. */
export type PartReader = (docId: string, part: number) => Promise<string | null>;

/** Index parts are numbered from 1 with no gaps; stop at the first missing one. */
const MAX_PARTS = 200;

export async function readParts(read: PartReader, docId: string): Promise<string[]> {
  const parts: string[] = [];
  for (let n = 1; n <= MAX_PARTS; n++) {
    const text = await read(docId, n);
    if (text === null) break;
    parts.push(text);
  }
  return parts;
}

/** Pages that carry non-blank text in the index: the text after each page's markers, across all parts. */
export function indexedPages(parts: readonly string[], docId: string): Set<number> {
  const escaped = docId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const marker = new RegExp(`\\[\\[doc:${escaped} p:([1-9][0-9]*)\\]\\]`, 'g');
  const pages = new Set<number>();
  for (const part of parts) {
    const marks = [...part.matchAll(marker)];
    marks.forEach((m, i) => {
      const start = m.index! + m[0].length; // safe: matchAll sets index
      const end = i + 1 < marks.length ? marks[i + 1]!.index! : part.length; // safe: as above
      if (part.slice(start, end).trim() !== '') pages.add(Number(m[1]));
    });
  }
  return pages;
}

/** The local legallas-index through `wrangler r2 object get --local`, via a temp directory removed after each read. */
export function localPartReader(): PartReader {
  const wrangler = cliWrangler('local');
  return async (docId, part) => {
    const dir = await mkdtemp(path.join(tmpdir(), 'legallas-sweep-'));
    try {
      const file = path.join(dir, 'part.md');
      await wrangler.r2Get(INDEX_BUCKET, partKey(docId, part), file);
      return await readFile(file, 'utf8');
    } catch {
      return null;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };
}

/** What a sweep saw: page numbers in order and which came back blank. Never text. */
export interface Sweep {
  calls: number;
  pages: number[];
  blank: number[];
  /** A code when a call failed or `next` did not move forward. */
  error: string | null;
}

interface PageEntry {
  page?: unknown;
  text?: unknown;
}

/** Reads every page of `docId`, following `next`, at most `maxCalls` calls. */
export async function sweepPages(call: (args: Record<string, unknown>) => Promise<ToolReply>, docId: string, maxCalls: number): Promise<Sweep> {
  const sweep: Sweep = { calls: 0, pages: [], blank: [], error: null };
  let from = 1;
  while (sweep.calls < maxCalls) {
    const reply = await call({ id: docId, from });
    sweep.calls++;
    const result = reply.result;
    if (!result || result.isError === true) {
      sweep.error = reply.error ?? 'tool_error';
      return sweep;
    }
    const body = (resultValue(result) ?? {}) as { pages?: PageEntry[]; next?: unknown };
    for (const entry of body.pages ?? []) {
      if (typeof entry.page !== 'number') continue;
      sweep.pages.push(entry.page);
      if (typeof entry.text !== 'string' || entry.text.replace(/<\/?case-record>/g, '').trim() === '') sweep.blank.push(entry.page);
    }
    if (typeof body.next !== 'number') return sweep;
    if (body.next <= from) {
      sweep.error = 'next_not_forward';
      return sweep;
    }
    from = body.next;
  }
  sweep.error = 'too_many_calls';
  return sweep;
}

/** Counts that decide the check. */
export interface SweepCounts {
  expected: number;
  returned: number;
  duplicates: number;
  missing: number;
  outOfRange: number;
  blankIndexed: number;
}

export function sweepCounts(sweep: Sweep, pageCount: number, indexed: ReadonlySet<number>): SweepCounts {
  const seen = new Set<number>();
  let duplicates = 0;
  for (const page of sweep.pages) {
    if (seen.has(page)) duplicates++;
    seen.add(page);
  }
  let missing = 0;
  for (let page = 1; page <= pageCount; page++) if (!seen.has(page)) missing++;
  return {
    expected: pageCount,
    returned: sweep.pages.length,
    duplicates,
    missing,
    outOfRange: [...seen].filter((page) => page < 1 || page > pageCount).length,
    blankIndexed: sweep.blank.filter((page) => indexed.has(page)).length,
  };
}

export function sweepOk(counts: SweepCounts): boolean {
  return counts.expected > 0 && counts.returned === counts.expected && counts.duplicates === 0 && counts.missing === 0 && counts.outOfRange === 0 && counts.blankIndexed === 0;
}

export function formatCounts(sweep: Sweep, parts: number, counts: SweepCounts): string {
  return `parts ${parts}, calls ${sweep.calls}, pages ${counts.returned} of ${counts.expected}, duplicates ${counts.duplicates}, missing ${counts.missing}, out of range ${counts.outOfRange}, blank where indexed ${counts.blankIndexed}`;
}

/** Documents from a legallas_list_documents result: id and page count, largest first. */
export function documentsBySize(result: Record<string, unknown> | null): { id: string; pages: number }[] {
  const body = resultValue(result) ?? {};
  const rows = Object.values(body).find((v): v is Record<string, unknown>[] => Array.isArray(v) && v.length > 0 && v.every((r) => typeof (r as { id?: unknown })?.id === 'string')) ?? [];
  return rows
    .map((row) => ({ id: row.id as string, pages: typeof row.pages === 'number' ? row.pages : 0 }))
    .filter((row) => row.pages > 0)
    .sort((a, b) => b.pages - a.pages);
}

/** How many of the longest listed documents are checked for several index parts. */
const CANDIDATES = 3;

/**
 * The sweep as one smoke check. SKIP when local dev has no document with several index parts (seed one:
 * a document needs more than PART_MAX_BYTES of text to split).
 */
export async function sweepStep(report: Report, session: McpSession, read: PartReader): Promise<void> {
  const list = await session.callTool('legallas_list_documents', {});
  let chosen: { id: string; parts: string[] } | null = null;
  let mostParts = 0;
  const candidates = documentsBySize(list.result).slice(0, CANDIDATES);
  for (const doc of candidates) {
    const parts = await readParts(read, doc.id);
    mostParts = Math.max(mostParts, parts.length);
    if (parts.length >= 2) {
      chosen = { id: doc.id, parts };
      break;
    }
  }
  if (!chosen) {
    report.add('read_pages_sweep', null, `no multi-part document in local dev (checked ${candidates.length}, most parts ${mostParts})`);
    return;
  }
  const doc = await session.callTool('legallas_get_document', { id: chosen.id });
  const pageCount = resultValue(doc.result)?.pages;
  if (typeof pageCount !== 'number' || pageCount < 1) {
    report.add('read_pages_sweep', false, `legallas_get_document gave no page count (${doc.error ?? 'pages missing'})`);
    return;
  }
  const sweep = await sweepPages((args) => session.callTool('legallas_read_pages', args), chosen.id, pageCount + 5);
  const counts = sweepCounts(sweep, pageCount, indexedPages(chosen.parts, chosen.id));
  report.add('read_pages_sweep', sweep.error === null && sweepOk(counts), `${formatCounts(sweep, chosen.parts.length, counts)}${sweep.error ? `, ${sweep.error}` : ''}`);
}
