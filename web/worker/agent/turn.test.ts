// SPDX-License-Identifier: Apache-2.0
// One research question end to end (turn.ts) on real SQLite, the real tools, the real metered bindings and quick Ask's
// own answer pipeline, with a fake Workers AI that chooses tools and then streams an answer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { neuronLimit, paidBefore } from '../budget.ts';
import { modelSse } from '../room-fixtures.ts';
import { catalogDb, fakeIndex, partsFor, words, type DocSeed } from '../../mcp/tools/doc-fixtures.ts';
import type { Role } from '../env.ts';
import { mockStepAi } from './mock.ts';
import type { ResearchEnv } from './mock.ts';
import { RESEARCH_QUESTION_COST } from './protocol.ts';
import type { PastTurn } from './steps.ts';
import { answerAndRecord, runResearchTurn, type TurnRequest } from './turn.ts';
import type { ResearchChunk } from './final.ts';

const MEMBER = 'counsel@example.test';
const QUESTION = 'When did Doe call Roe about the zebra ledger?';
const DOCS: DocSeed[] = [
  { id: 'doc-memo-0001', path: '04-Letters/Memo.pdf', controlSeq: 12, pages: 3 },
  { id: 'doc-history-0009', path: '04-Letters/Earlier.pdf', controlSeq: 19, pages: 4 },
];
const SECRET_TEXT = 'zebra ledger';

interface Setup {
  role?: Role | null;
  enabled?: string;
  answer?: (prompt: string) => string;
  finalFails?: unknown;
  /** Today's neurons spent down to this many left. */
  neuronsLeft?: number;
  /** The tool-step model replies DONE at once, calling no tool. */
  stepsDone?: boolean;
}

const DONE = { choices: [{ message: { role: 'assistant', content: 'DONE' }, finish_reason: 'stop' }], usage: { prompt_tokens: 0, completion_tokens: 0 } };

function setup(options: Setup = {}) {
  const { db, sqlite } = catalogDb(DOCS);
  if (options.role !== null) sqlite.prepare('INSERT INTO members (email, role, name) VALUES (?1, ?2, NULL)').run(MEMBER, options.role ?? 'counsel');
  if (options.neuronsLeft !== undefined) {
    // No account days are recorded here, so the limit is the free 9,000, or on the 1st the paid month's too.
    const day = new Date().toISOString().slice(0, 10);
    sqlite.prepare("INSERT INTO spend_counters (meter, period, used) VALUES ('neurons', ?1, ?2)").run(day, neuronLimit(day, 'worker', paidBefore(day, {}, {})) - options.neuronsLeft);
  }
  const index = fakeIndex(
    new Map(partsFor('doc-memo-0001', [
      { n: 1, text: `Doe called Roe on April 1 about the ${SECRET_TEXT}. ${words('a', 20)}` },
      { n: 2, text: `The ${SECRET_TEXT} shows the refund. ${words('b', 20)}` },
    ])),
  ).bucket;
  const searches: string[] = [];
  const search = {
    async search(request: { query: string }) {
      searches.push(request.query);
      return { search_query: '', chunks: [{ id: 'c0', type: 'text', score: 0.9, text: `[[doc:doc-memo-0001 p:1]]\nDoe called Roe on April 1 about the ${SECRET_TEXT}.`, item: { key: 'text/doc-memo-0001.p1.md' } }] };
    },
  };
  const step = mockStepAi();
  const finals: string[] = [];
  const ai = {
    async run(model: string, input: { stream?: boolean; messages: { content: string }[] }) {
      if (!input.stream) return options.stepsDone ? DONE : step.run(model as keyof AiModels, input as never);
      if (options.finalFails) throw options.finalFails;
      const prompt = input.messages.at(-1)?.content ?? '';
      finals.push(prompt);
      return modelSse(options.answer ? options.answer(prompt) : 'Doe called Roe on April 1. [doc:D1 p:1]', 7, 'stop');
    },
  };
  const env = {
    DB: db,
    INDEX: index,
    FILES: { get: async () => null } as unknown as R2Bucket,
    AI: ai as unknown as Ai,
    SEARCH: search as unknown as AiSearchInstance,
    LEGALLAS_MODEL: '@cf/openai/gpt-oss-120b',
    DAILY_QUESTION_CAP: '10',
    RESEARCH_ENABLED: options.enabled ?? '1',
    CONTROL_PREFIX: 'DOE',
  } as unknown as ResearchEnv;
  const questions = () => (sqlite.prepare('SELECT questions FROM usage WHERE email = ?1').get(MEMBER) as { questions: number } | undefined)?.questions ?? 0;
  const audits = () => sqlite.prepare("SELECT email, action, document_id FROM audit_log WHERE action = 'ai_question'").all().map((row) => ({ ...row }));
  return { env, finals, questions, audits, sqlite, searches };
}

async function turn(env: ResearchEnv, history: PastTurn[] = [], question = QUESTION, signal?: AbortSignal, onChunk?: (chunk: ResearchChunk) => void) {
  const chunks: ResearchChunk[] = [];
  const req: TurnRequest = { env, email: MEMBER, client: { ip: '203.0.113.9', userAgent: 'test' }, local: false, question, history, signal };
  const outcome = await runResearchTurn({ write: (chunk) => (chunks.push(chunk), onChunk?.(chunk)) }, req);
  const find = <T extends ResearchChunk['type']>(type: T) => chunks.filter((chunk) => chunk.type === type) as Extract<ResearchChunk, { type: T }>[];
  return { outcome, chunks, find };
}

test('a research question: progress as counts, a cited answer from this turn\'s pages, 3 from the cap, one audit row', async () => {
  const { env, questions, audits } = setup();
  const { outcome, find } = await turn(env);
  assert.equal(outcome.ok, true);
  const progress = find('data-progress').map((chunk) => chunk.data);
  assert.ok(progress.length >= 3);
  assert.deepEqual(Object.keys(progress.at(-1)!).sort(), ['documents', 'pages', 'searches', 'steps']);
  assert.ok(progress.every((data) => Object.values(data).every((n) => typeof n === 'number')), 'counts only');
  const citations = find('data-citations')[0]!.data.citations;
  assert.deepEqual(citations.map((c) => [c.id, c.page]), [['doc-memo-0001', 1]]);
  assert.deepEqual(find('data-verdict')[0]!.data, { dontKnow: false });
  assert.equal(questions(), RESEARCH_QUESTION_COST);
  assert.deepEqual(audits(), [{ email: MEMBER, action: 'ai_question', document_id: null }]);
});

test('a tool model that searches nothing still answers from quick Ask\'s search of the exact question', async () => {
  const { env, searches, finals } = setup({ stepsDone: true });
  const { outcome, find } = await turn(env);
  assert.equal(outcome.ok, true);
  assert.deepEqual(searches, [QUESTION], 'the seed, in the member\'s own words; no tool searched');
  assert.equal(find('data-progress').at(-1)!.data.searches, 1);
  assert.deepEqual(find('data-citations')[0]!.data.citations.map((c) => [c.id, c.page]), [['doc-memo-0001', 1]]);
  assert.match(finals[0]!, /Doe called Roe on April 1/);
});

test('the cite book ignores earlier turns: a page named only in history never becomes a citation', async () => {
  const history: PastTurn[] = [{ question: 'Earlier?', answer: 'See [doc:doc-history-0009 p:2] and [doc:D2 p:2].' }];
  const { env, finals } = setup({ answer: () => 'Doe called Roe. [doc:D1 p:1] An older note. [doc:doc-history-0009 p:2] [doc:D2 p:2]' });
  const { find } = await turn(env, history);
  const ids = find('data-citations')[0]!.data.citations.map((c) => c.id);
  assert.deepEqual(ids, ['doc-memo-0001']);
  assert.doesNotMatch(finals[0]!, /doc-history-0009/, 'history reaches the final prompt as earlier questions only, never as passages');
  assert.match(finals[0]!, /Earlier questions in this research thread/);
});

test('the kill switch refuses before anything is charged or called', async () => {
  for (const enabled of ['0', '', 'true']) {
    const { env, questions, finals } = setup({ enabled });
    const { outcome, find } = await turn(env);
    assert.deepEqual(outcome, { ok: false, error: 'research_off' });
    assert.deepEqual(find('error').map((chunk) => chunk.errorText), ['research_off']);
    assert.equal(questions(), 0);
    assert.equal(finals.length, 0);
  }
});

test('the member row is read again: a removed member or a role that may not ask is refused', async () => {
  const { env, questions } = setup({ role: null });
  assert.deepEqual((await turn(env)).outcome, { ok: false, error: 'forbidden' });
  assert.equal(questions(), 0);
});

test('without room for a whole question today, nothing is charged', async () => {
  const { env, questions } = setup({ neuronsLeft: 1_000 });
  assert.deepEqual((await turn(env)).outcome, { ok: false, error: 'ai_budget' });
  assert.equal(questions(), 0);
});

test('a model failure before the answer starts gives the 3 questions back', async () => {
  const { env, questions } = setup({ finalFails: new Error('503 unavailable') });
  const { outcome, find } = await turn(env);
  assert.deepEqual(outcome, { ok: false, error: 'model_unavailable' });
  assert.deepEqual(find('error').map((chunk) => chunk.errorText), ['model_unavailable']);
  assert.equal(questions(), 0);
});

test('no question, answer or document text ever reaches the console', async () => {
  const seen: string[] = [];
  const saved = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug };
  for (const level of Object.keys(saved) as (keyof typeof saved)[]) console[level] = (...args: unknown[]) => void seen.push(args.map(String).join(' '));
  try {
    await turn(setup().env);
    await turn(setup({ finalFails: new Error(`503 ${SECRET_TEXT}`) }).env);
    await turn(setup({ answer: () => '' }).env);
    await turn(setup({ enabled: '0' }).env);
  } finally {
    Object.assign(console, saved);
  }
  for (const line of seen) {
    assert.doesNotMatch(line, /zebra|ledger|Doe|Roe|April|doc-memo|Memo\.pdf|refund/i, line);
  }
});

test('anything that fails after the charge gives the 3 questions back: here the audit insert', async () => {
  const { env, questions, sqlite } = setup();
  sqlite.exec('DROP TABLE audit_log');
  const { outcome, find } = await turn(env);
  assert.deepEqual(outcome, { ok: false, error: 'answer_failed' });
  assert.deepEqual(find('error').map((chunk) => chunk.errorText), ['answer_failed']);
  assert.equal(questions(), 0);
});

test('a record that fails after the verdict never turns an answered turn into a failed one', async () => {
  const { env, questions } = setup();
  const chunks: ResearchChunk[] = [];
  const req: TurnRequest = { env, email: MEMBER, client: { ip: null, userAgent: null }, local: false, question: QUESTION, history: [] };
  const outcome = await answerAndRecord({ write: (chunk) => chunks.push(chunk) }, req, async () => {
    throw new Error('SQLITE_FULL');
  });
  assert.equal(outcome.ok, true);
  assert.equal(chunks.filter((chunk) => chunk.type === 'error').length, 0);
  assert.ok(chunks.some((chunk) => chunk.type === 'data-verdict'));
  assert.equal(questions(), RESEARCH_QUESTION_COST);
});

test('a member who leaves mid-answer stops the answer quietly and keeps the charge', async () => {
  const { env, questions } = setup({ answer: () => 'Doe called Roe on April 1, and later the ledger moved. [doc:D1 p:1]'.repeat(4) });
  const controller = new AbortController();
  const { outcome, find } = await turn(env, [], QUESTION, controller.signal, (chunk) => {
    if (chunk.type === 'text-delta') controller.abort();
  });
  assert.deepEqual(outcome, { ok: false, error: 'answer_failed' });
  assert.equal(find('error').length, 0, 'nobody is listening: no error chunk');
  assert.equal(find('text-end').length, 1);
  assert.equal(find('data-verdict').length, 0);
  assert.equal(questions(), RESEARCH_QUESTION_COST);
});
