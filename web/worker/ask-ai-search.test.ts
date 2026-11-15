// SPDX-License-Identifier: Apache-2.0
// worker/ai-search.ts askAgain through POST /api/ask: the room's Ask searches a keyword-only answer once more, and
// the prompt carries the second answer. The helper on its own and under retrieve(): ai-search.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answering, HYBRID, KEYWORD } from './ai-search-fixtures.ts';
import { askRequest, harness } from './ask-fixtures.ts';
import { handle } from './index.ts';
import { chunk } from './room-fixtures.ts';

const ctx = {} as ExecutionContext;

test('Ask: a keyword-only answer is searched once more and the prompt carries the second answer', async () => {
  const h = harness();
  const search = answering([
    [{ ...chunk('doc-live-b', 1, 'KEYWORD-ONLY thread.'), details: KEYWORD }],
    [{ ...chunk('doc-live-a', 2, 'WHOLE-HYBRID agreement.'), details: HYBRID }],
  ]);
  (h.env as { SEARCH: unknown }).SEARCH = search;
  const res = await handle(askRequest({ question: 'When was the agreement signed?' }), h.env, ctx);
  assert.equal(res.status, 200);
  await res.text();
  assert.equal(search.searches.length, 2);
  const prompt = h.runs[0]!.input.messages.map((m) => m.content).join('\n');
  assert.match(prompt, /WHOLE-HYBRID agreement\./);
  assert.doesNotMatch(prompt, /KEYWORD-ONLY/);
});
