// SPDX-License-Identifier: Apache-2.0
// Issue #19 through the route: the room's RECOMMEND reaches Ask's prompt, and without it the prompt has no options.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { askRequest, harness } from './ask-fixtures.ts';
import { handle } from './index.ts';
import { OPTIONS_HEADING, PERSONA, RECOMMEND_PERSONA } from './prompt.ts';
import { chunk } from './room-fixtures.ts';

async function systemFor(extraVars: Record<string, string>): Promise<string> {
  const h = harness({ chunks: [chunk('doc-live-a', 1, 'The board met on Tuesday.')], extraVars });
  await (await handle(askRequest({ question: 'Should we hold another meeting?' }), h.env, {} as ExecutionContext)).text();
  return h.runs[0]!.input.messages[0]!.content;
}

test('RECOMMEND "1" sends Ask the options and recommendation rules; unset or "0" does not', async () => {
  const on = await systemFor({ RECOMMEND: '1' });
  assert.ok(on.startsWith(RECOMMEND_PERSONA) && on.includes(OPTIONS_HEADING));
  for (const off of [await systemFor({}), await systemFor({ RECOMMEND: '0' })]) {
    assert.ok(off.startsWith(PERSONA));
    assert.equal(off.includes(OPTIONS_HEADING), false);
  }
});
