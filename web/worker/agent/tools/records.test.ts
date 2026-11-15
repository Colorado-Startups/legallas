// SPDX-License-Identifier: Apache-2.0
// Ask and the public-records check (adapters.ts, turn.ts): offered only while the room has it on; a call asks for
// the member's approval exactly as for a connected AI and sends nothing; its result is kept for the member's card and
// adds nothing to the evidence book, so the final answer never cites a public record as the case record.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { catalogDb } from '../../../mcp/tools/doc-fixtures.ts';
import { RECORDS_TOOL_NAME, useRecordsFetcher } from '../../../mcp/tools/public-records.ts';
import type { Member } from '../../env.ts';
import { decideCheck } from '../../public-records.ts';
import { COLORADO_ROWS, FIXTURE_COMPANY, recordedFetch } from '../../public-records-fixtures.ts';
import { researchTools, toolState, type ResearchToolEnv } from './adapters.ts';

const MEMBER: Member = { email: 'm@example.test', role: 'counsel', name: null };

function setup(settings: Partial<ResearchToolEnv>) {
  const { db } = catalogDb([]);
  const env: ResearchToolEnv = { DB: db, INDEX: {} as R2Bucket, FILES: {} as R2Bucket, SEARCH: { search: async () => ({ search_query: '', chunks: [] }) } as never, ...settings };
  const state = toolState(env, MEMBER);
  const tools = researchTools(state);
  const run = async (args: Record<string, unknown>) => {
    const t = tools[RECORDS_TOOL_NAME]!;
    const parsed = (t.inputSchema as { parse(v: unknown): Record<string, unknown> }).parse(args);
    return (await t.execute!(parsed, { toolCallId: 'x', messages: [], context: {} })) as string;
  };
  return { db, state, tools, run };
}

test('Ask is offered the check only while the room has it on', () => {
  assert.equal(RECORDS_TOOL_NAME in setup({}).tools, false);
  assert.equal(RECORDS_TOOL_NAME in setup({ PUBLIC_RECORDS: '0' }).tools, false);
  assert.equal(RECORDS_TOOL_NAME in setup({ PUBLIC_RECORDS: '1' }).tools, true);
});

test('Ask asks for the same approval, sends nothing before it, and keeps the result for the member\'s card only', async (t) => {
  const recorded = recordedFetch({ 'data.colorado.gov': { body: COLORADO_ROWS } });
  useRecordsFetcher(recorded.fetcher);
  t.after(() => useRecordsFetcher());
  const { db, state, run } = setup({ PUBLIC_RECORDS: '1' });
  const first = await run({ name: FIXTURE_COMPANY, kind: 'company' });
  assert.match(first, /approval_needed/);
  assert.equal(recorded.calls.length, 0);
  assert.equal(state.records.length, 1);
  const pending = state.records[0];
  assert.equal(pending.status, 'approval_needed');
  if (pending.status !== 'approval_needed') return;
  const id = new URL(pending.approve_at).searchParams.get('id')!;
  await decideCheck(db, id, MEMBER.email, 'approve', new Date());
  await run({ name: FIXTURE_COMPANY, kind: 'company' });
  assert.equal(recorded.calls.length, 1);
  assert.equal(state.records[1].status, 'checked');
  assert.equal(state.evidence.chunks.length, 0, 'a public record never becomes evidence for the answer');
  assert.equal(state.evidence.law.length, 0);
});
