// SPDX-License-Identifier: Apache-2.0
// A tool result fitted to TOOL_RESULT_CHARS: a view over the limit is still JSON, keeps its cursor and says what it cut.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CallToolResult } from '@modelcontextprotocol/server';
import { TOOL_RESULT_CHARS } from '../ceiling.ts';
import { fitList } from './brief.ts';
import { compactResult } from './compact.ts';
import { Evidence } from './evidence.ts';

const CURSOR = 'WyJ0cmFja3MiLDAsMTksImNvbXBhY3QiXQ';
const fence = (text: string) => `<case-record>\n${text}\n</case-record>`;
const result = (structuredContent: Record<string, unknown>): CallToolResult => ({ content: [], structuredContent });
const uncut = (value: CallToolResult) => compactResult(value, new Evidence(), Number.MAX_SAFE_INTEGER).length;

/** A one-entry page of `count` hurdles, fenced as case data, the first's basis grown to run `over` characters past the limit. */
function pageOver(count: number, over: number): CallToolResult {
  const page = (grow: number) => result({
    nextCursor: CURSOR, section: 'tracks', total: 2,
    entries: [{
      id: 'track-a', part: 2, parts: 3,
      brief: {
        hurdles: Array.from({ length: count }, (_, i) => ({
          id: `hurdle-${i}`,
          title: fence(`Hurdle ${i}`),
          text: fence('the notice clause runs on. '.repeat(12).slice(0, 280)),
          ...(i === 0 ? { basis: fence('x'.repeat(grow)) } : {}),
          cites: [{ control: `DOE-${String(i).padStart(6, '0')}`, doc: 'doc-a-0001', page: 1 }],
        })),
      },
    }],
  });
  const grow = TOOL_RESULT_CHARS + over - uncut(page(0));
  assert.ok(grow >= 0, 'the hurdles alone stay under the limit');
  return page(grow);
}

test('a page just over the limit stays valid JSON within it, every item and the cursor still there', () => {
  const page = pageOver(9, 49);
  assert.equal(uncut(page), TOOL_RESULT_CHARS + 49, 'the page runs just past the limit');
  const view = compactResult(page, new Evidence());
  assert.ok(view.length <= TOOL_RESULT_CHARS, `${view.length}`);
  const value = JSON.parse(view);
  assert.equal(value.nextCursor, CURSOR);
  assert.deepEqual(Object.keys(value)[0], 'nextCursor', 'the cursor still leads');
  const [entry] = value.entries;
  assert.deepEqual([entry.id, entry.part, entry.parts], ['track-a', 2, 3]);
  assert.equal(entry.brief.hurdles.length, 9, 'no item is lost to a cut this small');
  assert.equal(value.truncated, undefined, 'nothing was dropped, so nothing is flagged');
  assert.match(entry.brief.hurdles[0].basis, / \[cut\]\n<\/case-record>$/, 'the cut is marked, inside the fence');
  assert.equal(entry.brief.hurdles[0].title, fence('Hurdle 0'), 'a short field is left alone');
  assert.equal(entry.brief.hurdles[1].text, (page.structuredContent as { entries: { brief: { hurdles: { text: string }[] } }[] }).entries[0]!.brief.hurdles[1]!.text, 'and so is a string shorter than the one cut');
});

test('many strings of one length, just over the limit: each loses a little, not half', () => {
  const page = (length: number) => result({ nextCursor: CURSOR, entries: [{ id: 'track-a', hurdles: Array.from({ length: 12 }, (_, i) => ({ id: `hurdle-${i}`, text: fence('n'.repeat(length)) })) }] });
  let length = 300;
  while (uncut(page(length)) <= TOOL_RESULT_CHARS) length += 1;
  assert.ok(length < 400 && uncut(page(length)) - TOOL_RESULT_CHARS <= 12, 'just over the limit, under the passage rule');
  const view = compactResult(page(length), new Evidence());
  assert.ok(view.length <= TOOL_RESULT_CHARS, `${view.length}`);
  const { hurdles } = JSON.parse(view).entries[0];
  assert.equal(hurdles.length, 12);
  for (const hurdle of hurdles) assert.ok(hurdle.text.length >= fence('n'.repeat(length)).length - 12, `${hurdle.text.length}`);
});

test('a string cut to fit keeps its case-data fence whole', () => {
  const view = compactResult(result({ nextCursor: CURSOR, entries: [{ id: 'a', text: fence('y'.repeat(399)), body: fence('z'.repeat(6_000)) }] }), new Evidence());
  const { body } = JSON.parse(view).entries[0];
  assert.match(body, /^<case-record>\nz+ \[cut\]\n<\/case-record>$/);
});

test('a halved text field keeps both fence tags, however many times it is halved, with one cut mark', () => {
  for (const length of [6_000, 40_000]) {
    const view = compactResult(result({ nextCursor: CURSOR, entries: [{ id: 'a', text: fence('y'.repeat(length)) }] }), new Evidence());
    const { text } = JSON.parse(view).entries[0];
    assert.ok(view.length <= TOOL_RESULT_CHARS, `${view.length}`);
    assert.ok(text.startsWith('<case-record>\n'), 'it opens');
    assert.ok(text.endsWith(' [cut]\n</case-record>'), 'it closes, after the mark');
    assert.equal(text.split('[cut]').length - 1, 1);
    assert.equal(text.split('<case-record>').length - 1, 1);
    assert.ok(text.length < length, 'it was shortened');
  }
});

test('a cut keeps an untrusted fence whole too, its mark included (mcp/untrusted.ts)', () => {
  // An unfiled court order says nothing to a model, so the view keeps its words; the fence keeps saying what it is.
  const marked = (text: string) => `<case-record untrusted="unfiled-court-order">\n${text}\n</case-record>`;
  const view = compactResult(result({ nextCursor: CURSOR, entries: [{ id: 'a', text: marked('y'.repeat(40_000)) }] }), new Evidence());
  const { text } = JSON.parse(view).entries[0];
  assert.ok(view.length <= TOOL_RESULT_CHARS, `${view.length}`);
  assert.match(text, /^<case-record untrusted="unfiled-court-order">\ny+ \[cut\]\n<\/case-record>$/);
});

test('a text field with no fence is halved without gaining one', () => {
  const { text } = JSON.parse(compactResult(result({ entries: [{ id: 'a', text: 'y'.repeat(6_000) }] }), new Evidence())).entries[0];
  assert.match(text, /^y+ \[cut\]$/);
});

test('a result under the limit is not touched', () => {
  const page = result({ nextCursor: CURSOR, entries: [{ id: 'a', text: fence('short') }] });
  assert.equal(compactResult(page, new Evidence()), JSON.stringify(page.structuredContent));
});

test('fields the model passes back are never cut, whatever else has to go', () => {
  const long = `c${'0'.repeat(300)}`;
  const value = JSON.parse(compactResult(result({ nextCursor: long, entries: [{ id: 'a', note: 'x'.repeat(9_000) }] }), new Evidence()));
  assert.equal(value.nextCursor, long);
  assert.equal(value.entries[0].id, 'a');
});

test('too many short items: lists are cut, the result is flagged, and it is still JSON with its cursor', () => {
  const entries = Array.from({ length: 2_000 }, (_, i) => ({ id: `e-${i}`, label: 'short' }));
  const view = compactResult(result({ nextCursor: CURSOR, total: 2_000, entries }), new Evidence());
  assert.ok(view.length <= TOOL_RESULT_CHARS, `${view.length}`);
  const value = JSON.parse(view);
  assert.deepEqual([value.nextCursor, value.total, value.truncated], [CURSOR, 2_000, true]);
  assert.ok(value.entries.length >= 1 && value.entries.length < 2_000);
  assert.equal(value.entries[0].id, 'e-0', 'the first items stay');
});

test('nothing left to cut in lists or strings: the top-level values stay, flagged, and then at least the cursor', () => {
  const wide = Object.fromEntries(Array.from({ length: 2_000 }, (_, i) => [`k${i}`, i]));
  const nested = JSON.parse(compactResult(result({ nextCursor: CURSOR, total: 3, wide }), new Evidence()));
  assert.deepEqual(nested, { nextCursor: CURSOR, total: 3, truncated: true });
  const flat = JSON.parse(compactResult(result({ nextCursor: CURSOR, ...wide }), new Evidence()));
  assert.deepEqual(flat, { nextCursor: CURSOR, truncated: true });
  assert.deepEqual(JSON.parse(compactResult(result(wide), new Evidence())), { truncated: true });
});

test('fitList: a single item too long alone comes back as JSON, and its cursor leads to the next item', () => {
  const big = (pageOver(9, 49).structuredContent as { entries: unknown[] }).entries[0];
  const page = result({ section: 'tracks', entries: [big, { id: 'track-b' }] });
  const value = JSON.parse(fitList(page, new Evidence(), 'entries', null, (kept) => `after-${kept}`));
  assert.equal(value.nextCursor, 'after-1');
  assert.deepEqual(value.entries.map((entry: { id: string }) => entry.id), ['track-a']);
});

test('an error result is still its plain text, cut to the limit', () => {
  const failed: CallToolResult = { isError: true, content: [{ type: 'text', text: 'e'.repeat(6_000) }] };
  const view = compactResult(failed, new Evidence());
  assert.equal(view.length, TOOL_RESULT_CHARS);
  assert.match(view, / \[cut\]$/);
});
