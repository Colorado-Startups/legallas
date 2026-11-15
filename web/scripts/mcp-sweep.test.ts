// SPDX-License-Identifier: Apache-2.0
// The multi-part page sweep of `mcp:smoke --local`: which pages the index has text for, following `next`,
// the counts that decide the check, and the step against a fake MCP session. No network, no wrangler.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildParts, type PageText } from './indexparts.ts';
import type { McpSession } from './mcp-client.ts';
import { Report } from './mcp-flow.ts';
import { LOCAL_BASE, runLocal } from './mcp-smoke.ts';
import { documentsBySize, indexedPages, readParts, sweepCounts, sweepOk, sweepPages, sweepStep, type Sweep } from './mcp-sweep.ts';
import { fakeServer } from './mcp-testkit.ts';

const DOC = 'doc-long';

/** A document whose page 3 has no text, split into several parts by a small part size. */
function longDocument(pages: number): { pages: PageText[]; parts: string[] } {
  const texts: PageText[] = [];
  for (let page = 1; page <= pages; page++) texts.push({ n: page, text: page === 3 ? '' : `Dummy page ${page} `.repeat(400) });
  return { pages: texts, parts: buildParts(DOC, texts, 20_000).map((part) => part.body) };
}

test('indexed pages: text after each marker across parts; a page with no text is not indexed', () => {
  const { parts } = longDocument(12);
  assert.ok(parts.length >= 2, `several parts (${parts.length})`);
  const pages = indexedPages(parts, DOC);
  assert.deepEqual([...pages].sort((a, b) => a - b), [1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.deepEqual([...indexedPages(['[[doc:other p:1]] text'], DOC)], [], 'another document\'s markers are ignored');
  assert.deepEqual([...indexedPages(['[[doc:a.b p:2]] x'], 'a.b')], [2]);
  assert.deepEqual([...indexedPages(['[[doc:axb p:2]] x'], 'a.b')], [], 'the id is matched literally');
});

test('parts are read from 1 until the first missing one', async () => {
  const seen: number[] = [];
  const parts = await readParts(async (_id, n) => (seen.push(n), n <= 3 ? `part ${n}` : null), DOC);
  assert.deepEqual(parts, ['part 1', 'part 2', 'part 3']);
  assert.deepEqual(seen, [1, 2, 3, 4]);
});

/** A fake read_pages: `size` pages per call, with optional faults. */
function reader(total: number, size: number, fault: { repeat?: number; blank?: number; stall?: boolean } = {}) {
  return async (args: Record<string, unknown>) => {
    const from = args.from as number;
    const to = Math.min(total, from + size - 1);
    const pages = [];
    for (let page = from; page <= to; page++) pages.push({ page, text: page === fault.blank || page === 3 ? '' : '<case-record>\nCase text\n</case-record>' });
    if (fault.repeat && fault.repeat >= from && fault.repeat <= to) pages.push({ page: fault.repeat, text: 'x' });
    const next = to < total ? (fault.stall ? from : to + 1) : undefined;
    return { result: { content: [], structuredContent: { total_pages: total, pages, ...(next ? { next } : {}) } }, error: null };
  };
}

test('sweep: follows next to the end; counts decide; text is never kept', async () => {
  const sweep = await sweepPages(reader(45, 20), DOC, 50);
  assert.equal(sweep.calls, 3);
  assert.deepEqual(sweep.pages, Array.from({ length: 45 }, (_, i) => i + 1));
  assert.deepEqual(sweep.blank, [3]);
  const counts = sweepCounts(sweep, 45, new Set([1, 2, 4]));
  assert.deepEqual(counts, { expected: 45, returned: 45, duplicates: 0, missing: 0, outOfRange: 0, blankIndexed: 0 });
  assert.equal(sweepOk(counts), true);
  assert.doesNotMatch(JSON.stringify(sweep), /Case text/);
});

test('sweep: a repeated, missing, extra or blank-but-indexed page fails; so does a stalled next', async () => {
  const repeated = sweepCounts(await sweepPages(reader(30, 20, { repeat: 5 }), DOC, 50), 30, new Set());
  assert.equal(repeated.duplicates, 1);
  assert.equal(sweepOk(repeated), false);
  const short: Sweep = { calls: 1, pages: [1, 2, 4, 9], blank: [], error: null };
  assert.deepEqual(sweepCounts(short, 4, new Set()), { expected: 4, returned: 4, duplicates: 0, missing: 1, outOfRange: 1, blankIndexed: 0 });
  const blank = sweepCounts(await sweepPages(reader(10, 20, { blank: 7 }), DOC, 5), 10, new Set([7]));
  assert.equal(blank.blankIndexed, 1);
  assert.equal((await sweepPages(reader(30, 20, { stall: true }), DOC, 50)).error, 'next_not_forward');
  assert.equal((await sweepPages(reader(100, 1), DOC, 5)).error, 'too_many_calls');
  const failing = async () => ({ result: { isError: true, content: [{ type: 'text', text: 'not_found: x' }] }, error: null });
  assert.equal((await sweepPages(failing, DOC, 5)).error, 'tool_error');
});

test('documents are ranked by page count; rows without pages are left out', () => {
  const result = { structuredContent: { documents: [{ id: 'a', pages: 3 }, { id: 'b', pages: null }, { id: 'c', pages: 90 }], next_cursor: null } };
  assert.deepEqual(documentsBySize(result), [{ id: 'c', pages: 90 }, { id: 'a', pages: 3 }]);
  assert.deepEqual(documentsBySize(null), []);
});

/** A session answering list, get and read_pages for one long document. */
function session(total: number, fault: Parameters<typeof reader>[2] = {}, pageCount: number | null = total): McpSession {
  const read = reader(total, 20, fault);
  return {
    async callTool(name: string, args: Record<string, unknown>) {
      if (name === 'legallas_list_documents') return { status: 200, error: null, result: { structuredContent: { documents: [{ id: 'short', pages: 2 }, { id: DOC, pages: total }] } } };
      if (name === 'legallas_get_document') return { status: 200, error: null, result: { structuredContent: { id: DOC, pages: pageCount } } };
      return { status: 200, ...(await read(args)) };
    },
  } as unknown as McpSession;
}

// Part n carries page n's marker, except that page 3 (blank in the fake reader) has no indexed text.
const partsOf = (count: number) => async (id: string, n: number) => (id === DOC && n <= count ? `[[doc:${DOC} p:${n === 3 ? 4 : n}]] text` : id === 'short' && n === 1 ? 'x' : null);

test('the step: passes on a clean sweep, fails on a repeated page or a missing page count, skips without a multi-part document', async () => {
  const ok = new Report();
  await sweepStep(ok, session(45), partsOf(3));
  assert.deepEqual(ok.checks, [{ name: 'read_pages_sweep', outcome: 'pass', detail: 'parts 3, calls 3, pages 45 of 45, duplicates 0, missing 0, out of range 0, blank where indexed 0' }]);
  const repeated = new Report();
  await sweepStep(repeated, session(45, { repeat: 21 }), partsOf(3));
  assert.equal(repeated.checks[0]!.outcome, 'fail');
  const blankIndexed = new Report();
  await sweepStep(blankIndexed, session(45, { blank: 2 }), partsOf(3));
  assert.match(blankIndexed.checks[0]!.detail, /blank where indexed 1$/);
  const noCount = new Report();
  await sweepStep(noCount, session(45, {}, null), partsOf(3));
  assert.match(noCount.checks[0]!.detail, /no page count/);
  const single = new Report();
  await sweepStep(single, session(45), partsOf(1));
  assert.deepEqual(single.checks, [{ name: 'read_pages_sweep', outcome: 'skip', detail: 'no multi-part document in local dev (checked 2, most parts 1)' }]);
});

test('runLocal runs the sweep only when given an index reader', async () => {
  const withReader = await runLocal(fakeServer().fetcher, LOCAL_BASE, async () => null);
  assert.equal(withReader.checks.find((c) => c.name === 'read_pages_sweep')?.outcome, 'skip');
  const without = await runLocal(fakeServer().fetcher, LOCAL_BASE);
  assert.equal(without.checks.some((c) => c.name === 'read_pages_sweep'), false);
});
