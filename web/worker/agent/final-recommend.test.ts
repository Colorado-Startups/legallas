// SPDX-License-Identifier: Apache-2.0
// Card 11.2: the room's RECOMMEND reaches Research mode's answer as it reaches quick Ask's (ask-recommend.test.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { catalogDb, fakeIndex } from '../../mcp/tools/doc-fixtures.ts';
import { ANSWER_RULES, OPTIONS_HEADING, PERSONA, RECOMMEND_CLOSER, RECOMMEND_PERSONA, RECOMMEND_REMINDER } from '../prompt.ts';
import { DISPUTE_LINES, INVESTOR_LINE, TAX_LINE } from '../product-notices.ts';
import { modelSse } from '../room-fixtures.ts';
import type { ResearchChunk } from './final.ts';
import type { ResearchEnv } from './mock.ts';
import { runResearchTurn } from './turn.ts';

const MEMBER = 'owner@example.test';
const DOC = 'doc-minutes-0001';
const QUESTION = 'Should we hold another meeting?';
const DONE = { choices: [{ message: { role: 'assistant', content: 'DONE' }, finish_reason: 'stop' }], usage: { prompt_tokens: 0, completion_tokens: 0 } };
const ANSWER = [
  '- READ: The board met on Tuesday. [doc:D1 p:1]',
  '',
  OPTIONS_HEADING,
  '- OPTION: Hold another meeting. [doc:D1 p:1]',
  '- OPTION: Act by written consent. [doc:D1 p:1]',
  '- RECOMMENDATION: Hold another meeting. [doc:D1 p:1]',
  '- NOT VERIFIED: The bylaws were not found.',
  RECOMMEND_CLOSER,
].join('\n');

/** One research turn for the owner, no lawyer in the room: the final answer's prompt, its text and its cites. */
async function research(vars: Record<string, string>) {
  const { db, sqlite } = catalogDb([{ id: DOC, path: '02-Board/Minutes.pdf', controlSeq: 3, pages: 1 }]);
  sqlite.prepare('INSERT INTO members (email, role, name) VALUES (?1, ?2, NULL)').run(MEMBER, 'owner');
  const prompts: { content: string }[][] = [];
  const ai = {
    async run(_model: string, input: { stream?: boolean; messages: { content: string }[] }) {
      if (!input.stream) return DONE;
      prompts.push(input.messages);
      return modelSse(ANSWER, 7, 'stop');
    },
  };
  const search = {
    async search() {
      return { search_query: '', chunks: [{ id: 'c0', type: 'text', score: 0.9, text: `[[doc:${DOC} p:1]]\nThe board met on Tuesday.`, item: { key: `text/${DOC}.p1.md` } }] };
    },
  };
  const env = {
    DB: db,
    INDEX: fakeIndex(new Map()).bucket,
    FILES: { get: async () => null } as unknown as R2Bucket,
    AI: ai as unknown as Ai,
    SEARCH: search as unknown as AiSearchInstance,
    LEGALLAS_MODEL: '@cf/zai-org/glm-5.3-flash',
    DAILY_QUESTION_CAP: '10',
    RESEARCH_ENABLED: '1',
    CONTROL_PREFIX: 'DOE',
    ...vars,
  } as unknown as ResearchEnv;
  const chunks: ResearchChunk[] = [];
  const outcome = await runResearchTurn({ write: (chunk) => chunks.push(chunk) }, { env, email: MEMBER, client: { ip: null, userAgent: null }, local: false, question: QUESTION, history: [] });
  assert.equal(outcome.ok, true);
  assert.equal(prompts.length, 1);
  const [system, user] = prompts[0]!.map((m) => m.content);
  const answer = chunks.flatMap((chunk) => (chunk.type === 'text-delta' ? [chunk.delta] : [])).join('');
  const citations = chunks.flatMap((chunk) => (chunk.type === 'data-citations' ? chunk.data.citations.map((c) => c.id) : []));
  return { system: system!, user: user!, answer, citations };
}

test('RECOMMEND "1": the research answer gives options and a recommendation, with Ask\'s rules and notices', async () => {
  const { system, user, answer, citations } = await research({ RECOMMEND: '1' });
  assert.ok(system.startsWith(RECOMMEND_PERSONA));
  for (const needle of [OPTIONS_HEADING, INVESTOR_LINE, TAX_LINE, ...DISPUTE_LINES, RECOMMEND_CLOSER]) assert.ok(system.includes(needle), needle);
  assert.ok(user.includes(RECOMMEND_REMINDER));
  assert.ok(user.endsWith(`Question:\n${QUESTION}`), 'the question names no asker');
  assert.match(answer, /Options and recommendation\n- OPTION: .+\n- OPTION: .+\n- RECOMMENDATION: .+\[doc:doc-minutes-0001 p:1\]/);
  assert.deepEqual([...new Set(citations)], [DOC]);
});

test('RECOMMEND unset or "0": the research prompt is exactly as before', async () => {
  for (const vars of [{}, { RECOMMEND: '0' }] as Record<string, string>[]) {
    const { system, user } = await research(vars);
    assert.equal(system, `${PERSONA}\n\n${ANSWER_RULES}`);
    assert.equal(user.includes(RECOMMEND_REMINDER), false);
    assert.ok(user.endsWith(`Question from counsel:\n${QUESTION}`));
  }
});
