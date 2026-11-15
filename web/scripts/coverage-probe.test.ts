// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classify, distinctivePassage, documentFrequency, pacedSearchFetch, pacer, probeTargets, rankOf, runProbe, terms, TOP, type ProbeTarget,
} from './coverage-probe.ts';
import type { CoverageRow, ProbeHit } from './coverage-table.ts';
import { SpendStop } from './spend-guard.ts';

const words = (word: string, n: number) => Array.from({ length: n }, () => word).join(' ');

test('terms are lowercase letter and digit runs; document frequency counts each text once', () => {
  assert.deepEqual(terms('The Cooler, 2012-07!'), ['the', 'cooler', '2012', '07']);
  assert.deepEqual(documentFrequency(['a a b', 'b c']), new Map([['a', 1], ['b', 2], ['c', 1]]));
});

test('the passage is the window of the rarest words; short texts are used whole or not at all', () => {
  const common = words('agreement', 60);
  const rare = 'zephyr quorum lattice obsidian meridian halcyon tundra vellum cinder garnet sable willow ember fjord kestrel lantern marrow nimbus opal prism quill rook saffron thistle umber vesper wren yarrow zinnia azure';
  const text = `${common} ${rare} ${common}`;
  const df = documentFrequency([text, common, common, common]);
  const passage = distinctivePassage(text, df, 4)!;
  const picked = passage.split(' ');
  assert.equal(picked.length, 30);
  assert.ok(picked.filter((w) => w !== 'agreement').length >= 25, passage);
  assert.equal(distinctivePassage(words('short', 19), df, 4), null);
  assert.equal(distinctivePassage(words('mid', 25), df, 4), words('mid', 25));
});

test('a table of figures does not win the passage', () => {
  const figures = Array.from({ length: 40 }, (_, i) => String(1000 + i * 7)).join(' ');
  const prose = words('delivery schedule cooler repair', 10);
  const df = documentFrequency([`${figures} ${prose}`]);
  const passage = distinctivePassage(`${figures} ${prose}`, df, 1)!;
  assert.ok(terms(passage).filter((t) => /\p{L}/u.test(t)).length >= 20, passage);
});

test('ranks are passage positions in Ask order; document ranks and twins are kept too', () => {
  const chunks = [{ docId: 'x' }, { docId: 'x' }, { docId: 'twin' }, { docId: 'me' }];
  assert.deepEqual(rankOf(chunks, 'me', ['twin']), { rank: 4, docRank: 3, twinRank: 3, top: ['x', 'twin', 'me'] });
  assert.deepEqual(rankOf(chunks, 'gone'), { rank: null, docRank: null, twinRank: null, top: ['x', 'twin', 'me'] });
});

const target = (over: Partial<ProbeTarget> = {}): ProbeTarget => ({ id: 'me', summary: 's', passage: 'p', twins: [], chars: 5000, ocrShare: 0, ...over });
const hit = (rank: number | null, extra: Partial<ProbeHit> = {}): ProbeHit => ({ query: 'q', rank, docRank: rank, twinRank: null, top: [], ...extra });

test('a document is found when either query has it in the top passages; otherwise one word says why', () => {
  assert.deepEqual(classify(target(), [hit(TOP + 3), hit(TOP)]), { unfindable: false, reason: null });
  assert.equal(classify(target(), [hit(null, { error: 'search_http_500' }), hit(null, { error: 'x' })]).reason, 'error');
  assert.equal(classify(target({ chars: 20 }), [hit(null), null]).reason, 'blank');
  assert.equal(classify(target(), [hit(null, { twinRank: 2 }), hit(null)]).reason, 'twin');
  assert.equal(classify(target(), [hit(15), hit(null)]).reason, 'buried');
  assert.equal(classify(target({ ocrShare: 0.9 }), [hit(null), hit(null)]).reason, 'ocr');
  assert.equal(classify(target(), [hit(null), hit(null)]).reason, 'absent');
});

test('the probe runs both queries per document and records failed searches by code only', async () => {
  const asked: string[] = [];
  const results = await runProbe([target({ id: 'a', summary: 'find a', passage: 'secret words' }), target({ id: 'b', summary: null, passage: 'find b' })], {
    async retrieve(question) {
      asked.push(question);
      if (question === 'secret words') throw new Error(`failed for ${question}`);
      return question === 'find a' ? [{ docId: 'a' }] : [{ docId: 'z' }, { docId: 'b' }];
    },
  });
  assert.deepEqual(asked.sort(), ['find a', 'find b', 'secret words']);
  assert.equal(results.get('a')!.summary!.rank, 1);
  assert.equal(results.get('a')!.passage!.error, 'search_failed');
  assert.equal(results.get('a')!.unfindable, false);
  assert.deepEqual([results.get('b')!.summary, results.get('b')!.passage!.rank], [null, 2]);
});

test('probe targets are the indexed room documents, with twins by text group and by file', () => {
  const row = (id: string, extra: Partial<CoverageRow>): CoverageRow =>
    ({ zone: 'room', id, path: `${id}.pdf`, indexable: true, indexParts: 1, textGroup: null, sha256: `${id}-sha`, text: { version: 2, pages: 2, blankPages: 0, ocrPages: 1, chars: [300, 200], textHash: 'h' }, ...extra }) as CoverageRow;
  const rows = [row('a', { textGroup: 'T1' }), row('b', { textGroup: 'T1' }), row('c', { sha256: 'a-sha' }), row('d', { indexParts: 0 }), row('e', { indexable: 'agent file' })];
  const targets = probeTargets(rows, new Map([['a.pdf', words('alpha', 30)]]), new Map([['a.pdf', 'Summary of a.']]));
  assert.deepEqual(targets.map((t) => t.id), ['a', 'b', 'c']);
  const a = targets[0]!;
  assert.deepEqual([a.summary, [...a.twins].sort(), a.chars, a.ocrShare], ['Summary of a.', ['b', 'c'], 500, 0.5]);
  assert.equal(a.passage, words('alpha', 30));
  assert.equal(targets[1]!.passage, null);
});

test('the pacer spaces calls by the rate', async () => {
  let clock = 0;
  const waits: number[] = [];
  const wait = pacer(4, () => clock, async (ms) => {
    waits.push(ms);
    clock += ms;
  });
  await wait();
  await wait();
  await wait();
  assert.deepEqual(waits, [250, 250]);
  assert.throws(() => pacer(0), /positive/);
});

test('search requests carry the current token, renew it after a 401, and are paced', async () => {
  const seen: string[] = [];
  let paced = 0;
  let renewed = 0;
  const tokens = { get: async () => 'old', renew: async () => (renewed += 1, 'new') };
  const fetcher = async (_: unknown, init?: RequestInit) => {
    const auth = new Headers(init?.headers).get('Authorization')!;
    seen.push(auth);
    return new Response('{}', { status: auth === 'Bearer old' ? 401 : 200 });
  };
  const doFetch = pacedSearchFetch(tokens, async () => void (paced += 1), fetcher);
  const response = await doFetch('https://example.test/search', { method: 'POST', headers: { Authorization: 'Bearer placeholder', 'Content-Type': 'application/json' } });
  assert.equal(response.status, 200);
  assert.deepEqual([seen, renewed, paced], [['Bearer old', 'Bearer new'], 1, 2]);
});

test('out of budget ends the probe instead of scoring a failed search (scripts/spend-guard.ts)', async () => {
  const stop = new SpendStop('search_semantic', 'Stopped by the spend budget: test');
  await assert.rejects(runProbe([target()], { retrieve: async () => Promise.reject(stop) }), SpendStop);
});
