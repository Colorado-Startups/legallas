// SPDX-License-Identifier: Apache-2.0
// Ask proposes (adapters.ts): offered only while the room's proposals are on, it calls the same propose tool a
// connected AI calls, so a draft is stored pending as the member, through Ask, and nothing changes until the member
// approves it on /proposals/ in their own session. Ask has no tool that approves. The fixture is invented (Doe v.
// Harbor Labs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { catalogDb } from '../../../mcp/tools/doc-fixtures.ts';
import { PROPOSE_TOOL_NAME } from '../../../mcp/contract.ts';
import type { Member } from '../../env.ts';
import { approveProposal } from '../../proposal-review.ts';
import { researchTools, toolState, type ResearchToolEnv } from './adapters.ts';

const MEMBER: Member = { email: 'ada@firm.example', role: 'counsel', name: null };
const DRAFT = { title: 'Advisor agreement amendment', body: 'The term of the Doe advisor agreement is extended to 2027-03-01.', why: 'The member asked for it.' };

function setup(settings: Partial<ResearchToolEnv>, member: Member = MEMBER) {
  const { db, sqlite } = catalogDb([{ id: 'doe-1', path: 'Agreements/Doe advisor agreement.pdf' }]);
  const env: ResearchToolEnv = { DB: db, INDEX: {} as R2Bucket, FILES: {} as R2Bucket, SEARCH: { search: async () => ({ search_query: '', chunks: [] }) } as never, ...settings };
  const state = toolState(env, member);
  const tools = researchTools(state);
  const run = async (args: Record<string, unknown>) => {
    const t = tools[PROPOSE_TOOL_NAME]!;
    const parsed = (t.inputSchema as unknown as { parse(v: unknown): Record<string, unknown> }).parse(args);
    return (await t.execute!(parsed, { toolCallId: 'x', messages: [], context: {} })) as string;
  };
  return { db, sqlite, state, tools, run };
}

test('Ask is offered the propose tool only while the room has proposals on, and never a tool that decides', () => {
  assert.equal(PROPOSE_TOOL_NAME in setup({}).tools, false);
  assert.equal(PROPOSE_TOOL_NAME in setup({ PROPOSALS_ENABLED: '0' }).tools, false);
  const on = setup({ PROPOSALS_ENABLED: '1' }).tools;
  assert.equal(PROPOSE_TOOL_NAME in on, true);
  assert.deepEqual(Object.keys(on).filter((name) => /approve|reject|decide|grant|share/i.test(name)), []);
});

test('Ask stores a pending draft as the member, through Ask, citing a document by its alias; only the member approves it', async () => {
  const { db, sqlite, state, run } = setup({ PROPOSALS_ENABLED: '1', ASSISTANT_NAME: 'Harbor Helper' });
  const alias = state.evidence.alias('doe-1');
  const out = await run({ ...DRAFT, sources: [{ document_id: alias, page: 2 }] });
  assert.match(out, /pending/);
  assert.doesNotMatch(out, /extended to 2027/, 'the draft is not echoed back');
  const rows = sqlite.prepare('SELECT id, kind, status, proposed_by, via, client_kind FROM proposals').all().map((row) => ({ ...row }));
  assert.equal(rows.length, 1);
  const { id, ...row } = rows[0] as { id: string };
  assert.deepEqual(row, { kind: 'draft_document', status: 'pending', proposed_by: MEMBER.email, via: 'Harbor Helper', client_kind: 'ask' });
  assert.deepEqual(sqlite.prepare('SELECT document_id, page FROM proposal_sources').all().map((r) => ({ ...r })), [{ document_id: 'doe-1', page: 2 }]);

  const now = new Date();
  assert.deepEqual(await approveProposal(db, MEMBER, id, { title: null, body: null }, now, { ip: null, userAgent: null }), { ok: true, status: 'approved', edited: false });
  assert.deepEqual(sqlite.prepare('SELECT action, actor_email, via FROM proposal_events ORDER BY id').all().map((r) => ({ ...r })), [
    { action: 'proposed', actor_email: MEMBER.email, via: 'Harbor Helper' },
    { action: 'approved', actor_email: MEMBER.email, via: null },
  ], 'the approval is a person\'s, in the room');
});
