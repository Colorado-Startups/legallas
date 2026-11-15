// SPDX-License-Identifier: Apache-2.0
// Card 11.3: in a company room (no published matter, room-shape.ts), Ask and Research mode speak to founders: the
// voice and the question's label name no counsel and no case. A case room's prompt is exactly as before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { catalogDb, fakeIndex } from '../mcp/tools/doc-fixtures.ts';
import type { ResearchChunk } from './agent/final.ts';
import type { ResearchEnv } from './agent/mock.ts';
import { runResearchTurn } from './agent/turn.ts';
import { askRequest, harness } from './ask-fixtures.ts';
import { handle } from './index.ts';
import { ANSWER_RULES, COMPANY_PERSONA, OPTIONS_HEADING, PERSONA } from './prompt.ts';
import { chunk, modelSse } from './room-fixtures.ts';
import { resetMatterCache } from './routes/matter.ts';

const QUESTION = 'Who signed the board minutes?';
const DOC = 'doc-minutes-0001';
/** Words that assume a lawyer working a case. */
const COUNSEL_OR_CASE = /\b(counsel|case|matter|litigation|associate|attorney)\b/i;

type Prompt = { system: string; user: string };
type Vars = { RECOMMEND?: string };

/** What says who asks and in what voice: the persona, and the label over the question. */
const voiceOf = ({ system, user }: Prompt) => `${system.split('\n\n')[0]}\n${user.slice(user.lastIndexOf('\n\n') + 2)}`;

/** Quick Ask's prompt through the route, COMPANY_ROOM_ENABLED "1". `matter`: one is published (it need not parse). */
async function quickAsk(matter: boolean, vars: Vars = {}): Promise<Prompt> {
  resetMatterCache();
  const extraVars = { COMPANY_ROOM_ENABLED: '1', ...vars };
  const h = harness({ chunks: [chunk('doc-live-a', 1, 'The board met on Tuesday.')], extraVars, ...(matter ? { matter: '{ not json' } : {}) });
  await (await handle(askRequest({ question: QUESTION }), h.env, {} as ExecutionContext)).text();
  const [system, user] = h.runs[0]!.input.messages.map((m) => m.content);
  return { system: system!, user: user! };
}

/** Research mode's final prompt for the owner, COMPANY_ROOM_ENABLED "1". `matter`: one is published. */
async function research(matter: boolean, vars: Vars = {}): Promise<Prompt> {
  const { db, sqlite } = catalogDb([{ id: DOC, path: '02-Board/Minutes.pdf', controlSeq: 3, pages: 1 }]);
  sqlite.prepare("INSERT INTO members (email, role, name) VALUES ('owner@example.test', 'owner', NULL)").run();
  const prompts: { content: string }[][] = [];
  const ai = {
    async run(_model: string, input: { stream?: boolean; messages: { content: string }[] }) {
      if (!input.stream) return { choices: [{ message: { role: 'assistant', content: 'DONE' }, finish_reason: 'stop' }], usage: { prompt_tokens: 0, completion_tokens: 0 } };
      prompts.push(input.messages);
      return modelSse('- READ: The board met on Tuesday. [doc:D1 p:1]', 7, 'stop');
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
    FILES: { get: async () => null, head: async () => (matter ? {} : null) },
    AI: ai,
    SEARCH: search,
    LEGALLAS_MODEL: '@cf/zai-org/glm-5.3-flash',
    DAILY_QUESTION_CAP: '10',
    RESEARCH_ENABLED: '1',
    CONTROL_PREFIX: 'DOE',
    COMPANY_ROOM_ENABLED: '1',
    ...vars,
  } as unknown as ResearchEnv;
  const chunks: ResearchChunk[] = [];
  const outcome = await runResearchTurn({ write: (c) => chunks.push(c) }, { env, email: 'owner@example.test', client: { ip: null, userAgent: null }, local: false, question: QUESTION, history: [] });
  assert.equal(outcome.ok, true);
  const [system, user] = prompts[0]!.map((m) => m.content);
  return { system: system!, user: user! };
}

for (const [mode, prompt] of [['Ask', quickAsk], ['Research mode', research]] as const) {
  test(`${mode}, a company room: the voice speaks to founders, and names no counsel or case`, async () => {
    for (const vars of [{}, { RECOMMEND: '1' }] as Vars[]) {
      const got = await prompt(false, vars);
      assert.ok(got.system.startsWith(COMPANY_PERSONA));
      assert.ok(got.user.endsWith(`Question:\n${QUESTION}`));
      assert.doesNotMatch(voiceOf(got), COUNSEL_OR_CASE);
      assert.equal(got.system.includes(OPTIONS_HEADING), vars.RECOMMEND === '1', 'RECOMMEND still decides the options');
    }
  });

  test(`${mode}, a case room: the prompt is exactly as before`, async () => {
    const got = await prompt(true);
    assert.equal(got.system, `${PERSONA}\n\n${ANSWER_RULES}`);
    assert.ok(got.user.endsWith(`Question from counsel:\n${QUESTION}`));
  });
}
