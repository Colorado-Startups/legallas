// SPDX-License-Identifier: Apache-2.0
// Law eval scoring (T21): the gates on fictional answers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { LawChunk } from '../../worker/law-cite.ts';
import { citeCounts, expectedUnit, lawChecks, lawVerdict, type LawEvalItem } from './eval-score.ts';
import { answeredToday, configuredModel, parseLawEvalArgs, runOne } from './eval.ts';

const ENTRY = (id: string, url = 'https://www.ecfr.gov/x'): LawChunk => ({ id, cite: id, title: 't', url, retrieved: '2026-10-03', track: 'civil', kind: 'statute', source: 's' });
const ITEM: LawEvalItem = { id: 'q', question: 'When must a landlord return a security deposit?', expect: ['C.R.S. § 38-12-103(1)', '107 P.3d 393'] };

test('expected cites name units, pinpoints ignored', () => {
  assert.equal(expectedUnit('C.R.S. § 38-12-103(1)'), 'crs-38-12-103');
  assert.equal(expectedUnit('107 P.3d 393'), 'case-107-p3d-393');
  assert.equal(expectedUnit('Rule 10b-5'), 'cfr-17-240-10b-5');
  assert.equal(expectedUnit('the operating agreement'), null);
});

test('a good answer passes every gate', () => {
  const answer = '- LAW: The deposit goes back within one month [law:crs-38-12-103].';
  const checks = lawChecks(ITEM, { answer, retrieved: ['crs-38-12-104', 'crs-38-12-103'], citations: [ENTRY('crs-38-12-103')] });
  assert.equal(lawVerdict(checks), 'pass');
});

test('each gate fails on its own fault', () => {
  const failed = (answer: string, retrieved: string[], citations: LawChunk[]) =>
    lawChecks(ITEM, { answer, retrieved, citations }).filter((c) => !c.ok).map((c) => c.name);
  assert.deepEqual(failed('- LAW: x [law:crs-38-12-103].', ['crs-38-12-102'], [ENTRY('crs-38-12-103')]), ['retrieved']);
  assert.deepEqual(failed('- LAW: x [law:crs-38-12-104].', ['crs-38-12-103', 'crs-38-12-104'], [ENTRY('crs-38-12-104')]), ['cites_expected']);
  assert.deepEqual(failed('- LAW: x [law:crs-38-12-103] [law:usc-15-99].', ['crs-38-12-103'], [ENTRY('crs-38-12-103')]), ['only_retrieved']);
  assert.deepEqual(failed('- LAW: x [law:crs-38-12-103].', ['crs-38-12-103'], [ENTRY('crs-38-12-103', 'https://evil.example/')]), ['resolves']);
  assert.deepEqual(failed('- LAW: x [law:crs-38-12-103] [doc:abc p:2].', ['crs-38-12-103'], [ENTRY('crs-38-12-103')]), ['no_record_in_law']);
  assert.ok(failed('', ['crs-38-12-103'], []).includes('answered'));
});

test('cite counts sum valid and invalid tags across runs', () => {
  const runs = [
    { answer: '[law:a-b] [law:a-b] [law:c-d]', retrieved: [], citations: [ENTRY('a-b')] },
    { answer: '[law:e-f]', retrieved: [], citations: [ENTRY('e-f')] },
  ];
  assert.deepEqual(citeCounts(runs), { cited: 3, valid: 2, invalid: 1 });
});

test('eval arguments are bounded', () => {
  assert.deepEqual(parseLawEvalArgs(['--reps', '3', '--only', 'a,b', '--model', '@cf/openai/gpt-oss-120b']), { reps: 3, retrievalOnly: false, only: ['a', 'b'], show: false, model: '@cf/openai/gpt-oss-120b' });
  assert.match(configuredModel(), /^@cf\//);
  assert.equal(configuredModel('{ "vars": { "LEGALLAS_MODEL": "@cf/x/y" } }'), '@cf/x/y');
  assert.throws(() => parseLawEvalArgs(['--reps', '9']));
  assert.throws(() => parseLawEvalArgs(['--model', 'https://evil.example']));
  assert.equal(parseLawEvalArgs(['--concurrency', '2']).concurrency, 2);
  assert.throws(() => parseLawEvalArgs(['--concurrency', '8']), 'the shared model takes at most three at once');
  const daily = parseLawEvalArgs(['--set', '/tmp/q.json', '--answer-daily', '10']);
  assert.deepEqual([daily.set, daily.answerDaily, daily.retrievalOnly], ['/tmp/q.json', 10, false]);
  assert.throws(() => parseLawEvalArgs(['--answer-daily', '0']));
  assert.throws(() => parseLawEvalArgs(['--answer-daily', '100']));
  assert.throws(() => parseLawEvalArgs(['--set', '--show']), 'a flag is not a file');
  assert.throws(() => parseLawEvalArgs(['--retrieval-only', '--answer-daily', '5']), /answers nothing/);
});

test('--answer-daily answers each question once a cycle, a slice a UTC day', () => {
  const ids = Array.from({ length: 23 }, (_, i) => `q-${String(i).padStart(2, '0')}`);
  const day = (n: number) => new Date(Date.UTC(2026, 10, 6) + n * 86_400_000 + 3_600_000);
  // 23 ids at 10 a day: three slices (10, 10, 3), and every id in exactly one.
  const cycle = [0, 1, 2].map((n) => answeredToday(ids, 10, day(n)));
  assert.deepEqual(cycle.map((s) => s.size).sort((a, b) => a - b), [3, 10, 10]);
  assert.deepEqual(cycle.flatMap((s) => [...s]).sort(), ids);
  assert.deepEqual(answeredToday(ids, 10, day(3)), cycle[0], 'the fourth day starts the cycle again');
  assert.deepEqual(answeredToday([...ids].reverse(), 10, day(0)), cycle[0], 'the order of the set does not matter');
  assert.equal(answeredToday(ids, 50, day(9)).size, 23, 'a set smaller than a day is answered every day');
  assert.equal(answeredToday([], 10, day(0)).size, 0);
});

const OPINION = (id: string, opinion: LawChunk['opinion']): LawChunk => ({ ...ENTRY(id, 'https://www.courtlistener.com/opinion/1/x/'), kind: 'case', opinion });
const CASE_ITEM: LawEvalItem = { id: 'c', question: 'What did the court hold?', expect: ['107 P.3d 393'] };

test('each retrieval is timed for search_p95, and a failed one has no time', async () => {
  const law = {
    ASK_LAW_MIN_VECTOR: 0.5,
    retrieveLaw: async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return { passages: [{ ...ENTRY('cfr-17-230-503'), text: 'Form D' }], citable: new Map() };
    },
    validateLawCitations: () => [],
  };
  const deps = { law } as unknown as Parameters<typeof runOne>[2];
  const timed = await runOne(ITEM, false, deps);
  assert.deepEqual(timed.result.retrieved, ['cfr-17-230-503']);
  assert.ok(Number.isInteger(timed.searchMs) && timed.searchMs! >= 20, `timed ${timed.searchMs}`);
  const refused = { ...law, retrieveLaw: async () => Promise.reject(new Error('embedding_http_401')) };
  const failed = await runOne(ITEM, false, { ...deps, law: refused } as Parameters<typeof runOne>[2]);
  assert.deepEqual([failed.searchMs, failed.result.error], [null, 'retrieval: embedding_http_401']);
});

test('only the opinion of the court answers: a cite to a dissent part is not the expected authority', () => {
  const failed = (answer: string, citations: LawChunk[]) =>
    lawChecks(CASE_ITEM, { answer, retrieved: citations.map((c) => c.id), citations }).filter((c) => !c.ok).map((c) => c.name);
  assert.deepEqual(failed('- LAW: The court held the rule [law:case-107-p3d-393~2].', [OPINION('case-107-p3d-393~2', 'majority')]), []);
  assert.deepEqual(failed('- LAW: The dissent argued a rule [law:case-107-p3d-393~9].', [OPINION('case-107-p3d-393~9', 'dissent')]), ['cites_expected']);
  assert.deepEqual(failed('- LAW: The court held the rule [law:case-107-p3d-393~2].', [{ ...ENTRY('case-107-p3d-393~2'), kind: 'case' }]), [], 'a catalog built before opinions were marked still counts');
});

test('a LAW bullet resting only on a separate opinion must say so', () => {
  const citations = [OPINION('case-107-p3d-393~2', 'majority'), OPINION('case-107-p3d-393~9', 'dissent'), OPINION('case-107-p3d-393~10', 'concurrence')];
  const failed = (answer: string) => lawChecks(CASE_ITEM, { answer, retrieved: citations.map((c) => c.id), citations }).filter((c) => !c.ok).map((c) => c.name);
  assert.deepEqual(failed('- LAW: The rule is X [law:case-107-p3d-393~2].\n- LAW: A two-year period applies [law:case-107-p3d-393~9].'), ['no_separate_as_holding']);
  assert.deepEqual(failed('- LAW: The rule is X [law:case-107-p3d-393~2].\n- LAW: A concurrence would add Y [law:case-107-p3d-393~10].'), []);
  assert.deepEqual(failed('- LAW: The rule is X [law:case-107-p3d-393~2].\n- LAW: The dissent argued a two-year period applies [law:case-107-p3d-393~9].'), []);
  assert.deepEqual(failed('- LAW: The rule is X, which the dissent disputes [law:case-107-p3d-393~2] [law:case-107-p3d-393~9].'), [], 'a bullet that also rests on the majority is the holding');
});

test('wrangler tokens renew on schedule and after a 401 (T21)', async () => {
  const { withFreshToken, wranglerTokens } = await import('./replica.ts');
  let issued = 0;
  let clock = 0;
  const tokens = wranglerTokens(async () => `t${++issued}`, 1000, () => clock);
  assert.equal(await tokens.get(), 't1');
  assert.equal(await tokens.get(), 't1');
  clock = 1500;
  assert.equal(await tokens.get(), 't2');
  const seen: string[] = [];
  const response = await withFreshToken(tokens, async (token) => (seen.push(token), new Response('x', { status: token === 't2' ? 401 : 200 })));
  assert.equal(response.status, 200);
  assert.deepEqual(seen, ['t2', 't3']);
});

test('a failed token fetch is not cached: the next get() asks again', async () => {
  const { wranglerTokens } = await import('./replica.ts');
  let calls = 0;
  const tokens = wranglerTokens(async () => {
    calls++;
    if (calls === 1) throw new Error('wrangler not logged in');
    return 'good';
  }, 60_000, () => 0);
  await assert.rejects(tokens.get());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(await tokens.get(), 'good');
  assert.equal(calls, 2);
});
