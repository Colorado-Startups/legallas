// SPDX-License-Identifier: Apache-2.0
// The legallas-mcp retrieval eval for v2 sets: passages' controls and pages, document and page recall, on the
// fictional Doe fixture. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEvalSet } from './ask-eval-score.ts';
import { parseMcpEvalArgs } from './mcp-eval.ts';
import { evaluateV2, formatV2Summary, passageRefs, scoreV2, summarizeV2, v2RetrievalItems, type V2Search } from './mcp-eval-v2.ts';
import { SpendStop } from './spend-guard.ts';

const passage = (id: string, control: string | null, page: number | null, text: string) => ({ id, control, title: 'Doe exhibit', folder: '01-Contracts', page, link: 'x', text: `<case-record>\n${text}\n</case-record>` });
const result = (rows: ReturnType<typeof passage>[]) => ({ content: [{ type: 'text', text: 'x' }], structuredContent: { results: rows } });
const ROWS = [
  passage('doe-a', 'DOE-000100', 1, '[DOE-000100 p. 1] Supply agreement, delivery schedule.'),
  passage('doe-b', 'DOE-000412', 2, '[DOE-000412 p. 2] Cooler repair ticket. [DOE-000412 p. 3] Temperature readings. [DOE-000999 p. 9] not its own.'),
  passage('doe-c', null, 5, '[doc:doe-c p. 5] Unnumbered. [doc:doe-c p. 6] Next page.'),
];
const items = parseEvalSet([
  { id: 'doe-page', category: 'facts', question: 'Secret question one?', mcp: true, expect: { docs: [{ control: 'DOE-000412', pages: [3] }] } },
  { id: 'doe-any-page', category: 'locate', question: 'Secret question two?', mcp: true, expect: { docs: [{ control: 'DOE-000100', pages: [] }] } },
  { id: 'doe-miss', category: 'facts', question: 'Secret question three?', mcp: true, expect: { docs: [{ control: 'DOE-000777', pages: [1] }] } },
  { id: 'doe-not-mcp', category: 'facts', question: 'q', expect: { docs: [{ control: 'DOE-000100', pages: [1] }] } },
  { id: 'doe-blocked', category: 'facts', question: 'q', mcp: true, blockedUntil: 'docx-indexed', expect: { docs: [{ control: 'DOE-000100', pages: [1] }] } },
  { id: 'doe-no-docs', category: 'unknown', question: 'q', mcp: true, expect: { docs: [] } },
]);

test('passages carry their control and the pages their own markers name, never another document\'s', () => {
  assert.deepEqual(passageRefs(result(ROWS)), [
    { id: 'doe-a', control: 'DOE-000100', pages: [1] },
    { id: 'doe-b', control: 'DOE-000412', pages: [2, 3] },
    { id: 'doe-c', control: null, pages: [5, 6] },
  ]);
  assert.deepEqual(passageRefs(null), []);
});

test('only mcp items with expected documents that are not blocked are scored', () => {
  assert.deepEqual(v2RetrievalItems(items).map((i) => i.id), ['doe-page', 'doe-any-page', 'doe-miss']);
});

test('document rank by control number, page rank on an expected page; no pages means no page score', () => {
  const refs = passageRefs(result(ROWS));
  assert.deepEqual(scoreV2(items[0]!, refs, 10), { id: 'doe-page', status: 'scored', docRank: 2, pageRank: 2, pageScored: true, error: null });
  assert.equal(scoreV2(items[0]!, refs, 1).docRank, null, 'outside the top N');
  assert.deepEqual(scoreV2(items[1]!, refs, 10), { id: 'doe-any-page', status: 'scored', docRank: 1, pageRank: null, pageScored: false, error: null });
  const otherPrefix = passageRefs(result([passage('doe-b', 'XYZ-000412', 3, '[XYZ-000412 p. 3] x')]));
  assert.equal(scoreV2(items[0]!, otherPrefix, 10).pageRank, 1, 'a fallback prefix still compares by number');
});

test('evaluate: errors score as misses with their code; the summary prints counts and rates only', async () => {
  const asked: string[] = [];
  const search: V2Search = async (query) => {
    asked.push(query);
    if (query.includes('three')) return { result: { isError: true, content: [{ type: 'text', text: 'daily_limit: reached' }] }, error: null };
    return { result: result(ROWS), error: null };
  };
  const outcomes = await evaluateV2(items, search, 10);
  assert.equal(asked.length, 3);
  assert.deepEqual(outcomes.map((o) => `${o.id}:${o.status}:${o.docRank}:${o.pageRank}`), ['doe-page:scored:2:2', 'doe-any-page:scored:1:null', 'doe-miss:error:null:null']);
  const s = summarizeV2(outcomes);
  assert.deepEqual([s.items, s.errors, s.docHits, s.pageItems, s.pageHits], [3, 1, 2, 2, 1]);
  assert.equal(s.docMrr, (1 / 2 + 1) / 3);
  const line = formatV2Summary(s, 10);
  assert.match(line, /document recall@10 66\.7% \(2\/3\), page recall@10 50\.0% \(1\/2\)/);
  assert.doesNotMatch(line, /doe-|Secret/);
  const thrown = await evaluateV2(items.slice(0, 1), async () => {
    throw new Error('search_http_500');
  }, 10);
  assert.deepEqual([thrown[0]!.status, thrown[0]!.error], ['error', 'search_http_500']);
});

test('eval:mcp takes --out for the per-item ranks; without it the arguments are unchanged', () => {
  assert.equal('out' in parseMcpEvalArgs(['--replica']), false);
  assert.match(parseMcpEvalArgs(['--replica', '--out', 'ranks']).out!, /ranks$/);
});

test('out of budget ends the run instead of scoring the rest as errors (scripts/spend-guard.ts)', async () => {
  const stop = new SpendStop('search_semantic', 'Stopped by the spend budget: test');
  const search: V2Search = async () => Promise.reject(stop);
  await assert.rejects(evaluateV2(items, search, 10), SpendStop);
});
