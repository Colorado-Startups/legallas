// SPDX-License-Identifier: Apache-2.0
// POST /api/ask through the real gate in index.ts, with real SQL (node:sqlite) and fake AI bindings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sseParser } from '../src/scripts/chat-sse.ts';
import { dailyCap, generationInput, MAX_QUESTION_CHARS, REASONING_EFFORT, refundQuestion, takeQuestion } from './ask.ts';
import { MAX_RESULTS, retrieve, searchRequest } from './retrieval.ts';
import { utcDay } from './usage.ts';
import { askRequest, harness, HOST } from './ask-fixtures.ts';
import { chunk, d1, OWNER, schemaDb, seed } from './room-fixtures.ts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resetMatterCache } from './routes/matter.ts';
import { handle } from './index.ts';
import { readingCounts } from './routes/ask.ts';

const ctx = {} as ExecutionContext;

async function events(res: Response) {
  const parser = sseParser();
  return [...parser.push(await res.text()), ...parser.end()];
}

const QUESTION = 'What does the alpha memo say about the zebra meeting?';

test('a question streams deltas, then validated citations, then done', async () => {
  const h = harness({
    chunks: [chunk('doc-live-a', 2, 'The zebra meeting happened.')],
    answer: 'READ: The meeting happened [doc:doc-live-a p:2].',
  });
  const res = await handle(askRequest({ question: QUESTION }), h.env, ctx);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('Content-Type') ?? '', /^text\/event-stream/);
  assert.equal(res.headers.get('Cache-Control'), 'private, no-store');
  const got = await events(res);
  const text = got.filter((e) => e.event === 'delta').map((e) => (e.data as { text: string }).text).join('');
  assert.equal(text, 'READ: The meeting happened [doc:doc-live-a p:2].');
  assert.doesNotMatch(text, /hidden reasoning/, 'model reasoning is never forwarded');
  assert.deepEqual(got.at(-2), {
    event: 'citations',
    data: { citations: [{ id: 'doc-live-a', page: 2, name: 'Alpha memo.pdf', control_seq: null, quote: null }] },
  });
  assert.deepEqual(got.at(-1), { event: 'done', data: { dontKnow: false } });
});

test('the model call: configured model, streaming, max_tokens set, no gateway option', async () => {
  const h = harness({ chunks: [chunk('doc-live-a', 1, 'x')] });
  await (await handle(askRequest({ question: QUESTION }), h.env, ctx)).text();
  assert.equal(h.runs.length, 1);
  const run = h.runs[0]!;
  assert.equal(run.model, '@cf/openai/gpt-oss-120b');
  assert.equal(run.input.stream, true);
  assert.equal(run.input.max_tokens, 16_384, 'reasoning counts against it: 4096 left broad questions blank');
  assert.equal(run.input.reasoning_effort, 'medium', 'the level the replica eval chose for gpt-oss-120b');
  assert.equal(run.options, undefined, 'no options object, so no AI Gateway and no prompt logging');
});

test('reasoning effort follows the model; a model without an entry gets its own default, never a guessed level', () => {
  const messages = [{ role: 'user' as const, content: 'q' }];
  for (const [model, effort] of Object.entries(REASONING_EFFORT)) {
    assert.equal(generationInput(messages, model).reasoning_effort, effort, model);
  }
  const unlisted = generationInput(messages, '@cf/example/unlisted-model');
  assert.equal('reasoning_effort' in unlisted, false);
  assert.deepEqual(unlisted, { messages, stream: true, max_tokens: 16_384 });
  assert.equal('reasoning_effort' in generationInput(messages, 'toString'), false, 'own entries only');
});

test('retrieval is search() only, hybrid, with rewrite, reranking and cache off', async () => {
  const h = harness({ chunks: [chunk('doc-live-a', 1, 'x')] });
  await (await handle(askRequest({ question: QUESTION }), h.env, ctx)).text();
  assert.deepEqual(h.searches, [searchRequest(QUESTION)]);
  const opts = searchRequest(QUESTION).ai_search_options!;
  assert.equal(opts.retrieval?.retrieval_type, 'hybrid');
  assert.equal(opts.retrieval?.keyword_match_mode, 'or', 'any-term keyword matching, so BM25 contributes to natural questions');
  assert.equal(opts.retrieval?.max_num_results, MAX_RESULTS);
  assert.equal(MAX_RESULTS, 20);
  assert.equal(opts.query_rewrite?.enabled, false);
  assert.equal(opts.reranking?.enabled, false);
  assert.equal(opts.cache?.enabled, false);
  assert.equal('messages' in searchRequest(QUESTION), false, 'query, not messages, so rewriting cannot apply');
});

test('the daily cap stops the question before retrieval, audit or model', async () => {
  const h = harness({ cap: '2', chunks: [chunk('doc-live-a', 1, 'x')] });
  for (let i = 0; i < 2; i++) assert.equal((await handle(askRequest({ question: QUESTION }), h.env, ctx)).status, 200);
  const res = await handle(askRequest({ question: QUESTION }), h.env, ctx);
  assert.equal(res.status, 429);
  assert.deepEqual(await res.json(), { error: 'daily_limit' });
  assert.equal(h.searches.length, 2);
  assert.equal(h.runs.length, 2);
  assert.equal((h.db.prepare("SELECT count(*) AS n FROM audit_log WHERE action = 'ai_question'").get() as { n: number }).n, 2);
});

test('the cap is atomic: 25 concurrent questions at a cap of 10 let exactly 10 through', async () => {
  const db = schemaDb();
  const day = utcDay();
  const results = await Promise.all(Array.from({ length: 25 }, () => takeQuestion(d1(db), OWNER, 10, day)));
  assert.equal(results.filter(Boolean).length, 10);
  assert.deepEqual({ ...(db.prepare('SELECT questions FROM usage').get() as object) }, { questions: 10 });
});

test('the cap is per email and per UTC day', async () => {
  const db = d1(schemaDb());
  assert.equal(await takeQuestion(db, 'a@example.test', 1, '2026-10-01'), true);
  assert.equal(await takeQuestion(db, 'a@example.test', 1, '2026-10-01'), false);
  assert.equal(await takeQuestion(db, 'b@example.test', 1, '2026-10-01'), true);
  assert.equal(await takeQuestion(db, 'a@example.test', 1, '2026-10-06'), true);
  assert.equal(utcDay(new Date('2026-10-05T23:59:59-06:00')), '2026-10-06');
});

test('a cap of 0 turns asking off; a broken cap value falls back to 100', async () => {
  assert.equal(await takeQuestion(d1(schemaDb()), OWNER, 0, '2026-10-01'), false);
  assert.equal(dailyCap('0'), 0);
  assert.equal(dailyCap('25'), 25);
  assert.equal(dailyCap('lots'), 100);
  assert.equal(dailyCap(undefined), 100);
});

test('a research question takes 3 from the cap, all or nothing, and gives back the same', async () => {
  const sql = schemaDb();
  const db = d1(sql);
  const count = () => (sql.prepare('SELECT questions FROM usage').get() as { questions: number }).questions;
  assert.equal(await takeQuestion(db, OWNER, 10, '2026-10-01', 3), true, 'the first of the day inserts 3');
  for (let i = 0; i < 2; i++) assert.equal(await takeQuestion(db, OWNER, 10, '2026-10-01', 3), true);
  assert.equal(await takeQuestion(db, OWNER, 10, '2026-10-01', 3), false, '9 + 3 is past 10: nothing is taken');
  assert.equal(count(), 9);
  assert.equal(await takeQuestion(db, OWNER, 10, '2026-10-01'), true, 'quick Ask still fits the last one');
  await refundQuestion(db, OWNER, '2026-10-01', 3);
  assert.equal(count(), 7);
  await refundQuestion(db, OWNER, '2026-10-01', 9);
  assert.equal(count(), 0, 'never below zero');
  assert.equal(await takeQuestion(db, 'b@example.test', 2, '2026-10-01', 3), false, 'more than the whole cap');
  for (const bad of [0, -1, 1.5, Number.NaN]) await assert.rejects(takeQuestion(db, OWNER, 10, '2026-10-01', bad), RangeError);
});

test('the audit row records who and when, never the question, answer or documents', async () => {
  const h = harness({
    chunks: [chunk('doc-live-a', 1, 'Secret passage text.')],
    answer: 'A unique answer phrase [doc:doc-live-a p:1].',
  });
  const req = askRequest({ question: QUESTION });
  req.headers.set('User-Agent', 'TestBrowser/1');
  req.headers.set('CF-Connecting-IP', '203.0.113.9');
  await (await handle(req, h.env, ctx)).text();
  const rows = h.db.prepare('SELECT * FROM audit_log').all().map((r) => ({ ...r }));
  assert.equal(rows.length, 1);
  assert.deepEqual(
    { email: rows[0]!.email, action: rows[0]!.action, document_id: rows[0]!.document_id, ip: rows[0]!.ip, user_agent: rows[0]!.user_agent },
    { email: OWNER, action: 'ai_question', document_id: null, ip: '203.0.113.9', user_agent: 'TestBrowser/1' },
  );
  // Nothing the member typed or read is anywhere in the database.
  const dump = JSON.stringify(['audit_log', 'usage', 'comments'].map((t) => h.db.prepare(`SELECT * FROM ${t}`).all()));
  for (const secret of ['zebra', 'unique answer', 'Secret passage']) assert.equal(dump.includes(secret), false, secret);
});

test('a role without the ask permission is refused before anything is counted or searched', async () => {
  const h = harness({ members: { [OWNER]: 'limited' }, chunks: [chunk('doc-live-a', 1, 'Secret passage on the zebra meeting.')] });
  const res = await handle(askRequest({ question: QUESTION }), h.env, ctx);
  assert.equal(res.status, 403);
  // A role the code does not know is no member at all (auth.ts findMember): the gate's door page answers.
  assert.match(res.headers.get('Content-Type') ?? '', /^text\/html/);
  const body = await res.text();
  assert.match(body, /This room is private/);
  assert.doesNotMatch(body, /^\s*[[{]|\/api\//, 'no route JSON and no room API');
  assert.doesNotMatch(body, /doc-live|Alpha memo|Bravo notes|Secret passage|zebra/i, 'no document, passage or question text');
  assert.equal(h.searches.length, 0);
  assert.equal(h.runs.length, 0);
  assert.equal((h.db.prepare('SELECT count(*) AS n FROM usage').get() as { n: number }).n, 0);
  assert.equal((h.db.prepare('SELECT count(*) AS n FROM audit_log').get() as { n: number }).n, 0);
});

test('only POST, only same-origin, and the question comes only from the body', async () => {
  const h = harness({ chunks: [chunk('doc-live-a', 1, 'x')] });
  const get = await handle(new Request(`${HOST}/api/ask?question=${encodeURIComponent(QUESTION)}`), h.env, ctx);
  assert.equal(get.status, 405);
  const cross = askRequest({ question: QUESTION });
  cross.headers.set('Origin', 'https://evil.example');
  assert.equal((await handle(cross, h.env, ctx)).status, 403);
  const viaUrl = await handle(askRequest({}, HOST, `/api/ask?question=${encodeURIComponent(QUESTION)}`), h.env, ctx);
  assert.equal(viaUrl.status, 400, 'a question in the URL is ignored');
  assert.equal(h.searches.length, 0);
});

test('bad bodies and over-long questions are refused without spending a question', async () => {
  const h = harness();
  const cases: [unknown, number, string][] = [
    ['not json', 400, 'bad_request'],
    [{ question: 42 }, 400, 'bad_request'],
    [{ question: '   ' }, 400, 'empty_question'],
    [{ question: 'x'.repeat(MAX_QUESTION_CHARS + 1) }, 413, 'question_too_long'],
  ];
  for (const [body, status, error] of cases) {
    const res = await handle(askRequest(body), h.env, ctx);
    assert.equal(res.status, status, error);
    assert.deepEqual(await res.json(), { error });
  }
  assert.equal((await handle(askRequest({ question: 'x'.repeat(MAX_QUESTION_CHARS) }), h.env, ctx)).status, 200);
  assert.equal((h.db.prepare('SELECT coalesce(sum(questions), 0) AS n FROM usage').get() as { n: number }).n, 1);
});

test('retrieval drops chunks from removed or unknown documents and non-index keys', async () => {
  const db = schemaDb();
  seed(db);
  const fake = {
    async search() {
      return {
        search_query: '',
        chunks: [
          { id: '1', type: 'text', score: 1, text: '[[doc:doc-live-a p:1]] kept', item: { key: 'text/doc-live-a.p1.md' } },
          { id: '2', type: 'text', score: 1, text: '[[doc:doc-gone p:1]] removed', item: { key: 'text/doc-gone.p1.md' } },
          { id: '3', type: 'text', score: 1, text: 'never synced', item: { key: 'text/doc-nobody.p1.md' } },
          { id: '4', type: 'text', score: 1, text: 'not an index part', item: { key: 'originals/doc-live-b.pdf' } },
          { id: '5', type: 'text', score: 1, text: 'traversal', item: { key: 'text/../doc-live-b.p1.md' } },
        ],
      };
    },
  } as unknown as AiSearchInstance;
  const { chunks, citable } = await retrieve(fake, d1(db), 'q', 'counsel');
  assert.deepEqual(chunks.map((c) => c.docId), ['doc-live-a']);
  assert.deepEqual([...citable.keys()], ['doc-live-a']);
});

test('removed documents never reach the prompt, and citing them is dropped', async () => {
  const h = harness({
    chunks: [chunk('doc-live-a', 1, 'live text'), chunk('doc-gone', 1, 'REMOVED-TEXT')],
    answer: 'One [doc:doc-live-a p:1] and two [doc:doc-gone p:1].',
  });
  const got = await events(await handle(askRequest({ question: QUESTION }), h.env, ctx));
  const prompt = h.runs[0]!.input.messages.map((m) => m.content).join('\n');
  assert.equal(prompt.includes('REMOVED-TEXT'), false);
  assert.equal(prompt.includes('doc-gone'), false);
  assert.deepEqual((got.at(-2)!.data as { citations: { id: string }[] }).citations.map((c) => c.id), ['doc-live-a']);
});

test('nothing retrieved: "I don\'t know" without calling the model', async () => {
  const h = harness({ chunks: [chunk('doc-gone', 1, 'only removed text')] });
  const got = await events(await handle(askRequest({ question: QUESTION }), h.env, ctx));
  assert.equal(h.runs.length, 0);
  assert.match((got[0]!.data as { text: string }).text, /^I don't know\./);
  assert.deepEqual(got.at(-1), { event: 'done', data: { dontKnow: true } });
});

test('the model saying "I don\'t know" sets the verdict', async () => {
  const h = harness({ chunks: [chunk('doc-live-a', 1, 'x')], answer: "I don't know. Try the letters folder." });
  const got = await events(await handle(askRequest({ question: QUESTION }), h.env, ctx));
  assert.deepEqual(got.at(-1), { event: 'done', data: { dontKnow: true } });
});

test('a search outage is a 503, not an empty "I don\'t know"', async () => {
  const h = harness({ searchFails: true });
  const res = await handle(askRequest({ question: QUESTION }), h.env, ctx);
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { error: 'search_unavailable' });
  assert.equal(searchRequest('q').ai_search_options?.retrieval?.return_on_failure, false);
});

test('an empty search is asked once more before Legallas says he does not know', async () => {
  const h = harness({ chunks: [] });
  const got = await events(await handle(askRequest({ question: QUESTION }), h.env, ctx));
  assert.equal(h.searches.length, 2);
  assert.equal(h.runs.length, 0);
  assert.deepEqual(got.at(-1), { event: 'done', data: { dontKnow: true } });
});

test('a degenerate "!!!!" answer is replaced by a second model call the browser sees alone', async () => {
  let calls = 0;
  const h = harness({ chunks: [chunk('doc-live-a', 1, 'x')], answer: () => (calls++ === 0 ? '!'.repeat(200) : 'CONFIRMED: Second try [doc:doc-live-a p:1].') });
  const got = await events(await handle(askRequest({ question: QUESTION }), h.env, ctx));
  assert.equal(h.runs.length, 2);
  const text = got.filter((e) => e.event === 'delta').map((e) => (e.data as { text: string }).text).join('');
  assert.equal(text, 'CONFIRMED: Second try [doc:doc-live-a p:1].');
  assert.deepEqual(got.at(-1), { event: 'done', data: { dontKnow: false } });
});

test('an answer of reasoning only is asked again; two of them end in an error event, never a blank done', async () => {
  const original = console.error;
  console.error = () => undefined;
  try {
    let calls = 0;
    const once = harness({ chunks: [chunk('doc-live-a', 1, 'x')], answer: () => (calls++ === 0 ? '' : 'READ: Second try [doc:doc-live-a p:1].') });
    const recovered = await events(await handle(askRequest({ question: QUESTION }), once.env, ctx));
    assert.equal(once.runs.length, 2);
    const text = recovered.filter((e) => e.event === 'delta').map((e) => (e.data as { text: string }).text).join('');
    assert.equal(text, 'READ: Second try [doc:doc-live-a p:1].');
    assert.deepEqual(recovered.at(-1), { event: 'done', data: { dontKnow: false } });

    const twice = harness({ chunks: [chunk('doc-live-a', 1, 'x')], answer: '' });
    const failed = await events(await handle(askRequest({ question: QUESTION }), twice.env, ctx));
    assert.equal(twice.runs.length, 2);
    assert.deepEqual(failed.map((e) => e.event), ['reading', 'error']);
    assert.deepEqual(failed.at(-1), { event: 'error', data: { error: 'answer_failed' } });
  } finally {
    console.error = original;
  }
});

test('each citation carries its control number and the pinpoint quote from the cited page (R10)', async () => {
  const h = harness({
    chunks: [
      chunk(
        'doc-live-a',
        3,
        'Board Records. The log confirms that Moe sent the meeting notice at 10:05 am on May 8, 2012. ' +
          'Carol Count logged the call from the company office that morning.\n[[doc:doc-live-a p:4]]\n' +
          'Moe sent nothing on page four of this memo at any time today.',
      ),
    ],
    answer: '- CONFIRMED: Moe sent the meeting notice at 10:05 am on May 8, 2012 [doc:doc-live-a p:3].',
  });
  h.db.prepare("UPDATE documents SET control_seq = 412 WHERE id = 'doc-live-a'").run();
  const got = await events(await handle(askRequest({ question: QUESTION }), h.env, ctx));
  assert.deepEqual((got.at(-2)!.data as { citations: unknown[] }).citations, [
    {
      id: 'doc-live-a',
      page: 3,
      name: 'Alpha memo.pdf',
      control_seq: 412,
      quote: 'The log confirms that Moe sent the meeting notice at 10:05 am on May 8, 2012.',
    },
  ]);
});

test('a reading event with counts only opens the stream; nothing-found answers skip it', async () => {
  const h = harness({
    chunks: [chunk('doc-live-a', 1, 'x\n[[doc:doc-live-a p:2]]\ny'), chunk('doc-live-a', 2, 'again'), chunk('doc-live-b', 1, 'z')],
    answer: 'READ: x [doc:doc-live-a p:1].',
  });
  const got = await events(await handle(askRequest({ question: QUESTION }), h.env, ctx));
  assert.deepEqual(got[0], { event: 'reading', data: { documents: 2, pages: 3 } });
  assert.equal(got[1]!.event, 'delta');
  const none = await events(await handle(askRequest({ question: QUESTION }), harness({ chunks: [] }).env, ctx));
  assert.equal(none.some((e) => e.event === 'reading'), false);
});

test('reading counts ignore page markers that name another document', () => {
  assert.deepEqual(readingCounts([{ docId: 'a', text: '[[doc:a p:1]] [[doc:b p:9]] [[doc:a p:1]]' }], 1), { documents: 1, pages: 1 });
  assert.deepEqual(readingCounts([{ docId: 'a', text: 'no markers' }], 1), { documents: 1, pages: 1 });
});

/** The fixture manifest with its first proof document live in the harness, so the case picture can tag it. */
function briefHarness(opts: Parameters<typeof harness>[0] = {}) {
  resetMatterCache();
  const raw = readFileSync(join(import.meta.dirname, '..', 'fixtures', 'matter.example.json'), 'utf8');
  const proof = JSON.parse(raw).tracks[0].points[0].proof[0].cite as { doc: string; page: number };
  const h = harness({ ...opts, matter: raw });
  h.db.prepare("INSERT INTO documents (id, path, folder, name, kind, content_type, size, pages, r2_key, source, updated_at) VALUES (?1, 'p.pdf', '', 'Proof.pdf', 'pdf', 'application/pdf', 1, 9, 'k-p', 'mirror', 'now')").run(proof.doc);
  return { h, proof };
}

test('the case picture reaches the prompt, and a proof tag in it is a valid citation though not retrieved', async () => {
  const raw = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'fixtures', 'matter.example.json'), 'utf8'));
  const proof = raw.tracks[0].points[0].proof[0].cite as { doc: string; page: number };
  const h2 = briefHarness({ chunks: [chunk('doc-live-a', 2, 'Other text.')], answer: `READ: A point [doc:${proof.doc} p:${proof.page}].` }).h;
  const got = await events(await handle(askRequest({ question: QUESTION }), h2.env, ctx));
  const prompt = h2.runs[0]!.input.messages.map((m) => m.content).join('\n');
  assert.match(prompt, /case-picture>>>\nMatter now: Doe v\. Harbor Labs, Inc/);
  assert.match(prompt, /Filing 1 of 2: Doe v\. Harbor Labs, Inc\./);
  const cites = (got.find((e) => e.event === 'citations')!.data as { citations: { id: string; name: string }[] }).citations;
  assert.deepEqual(cites.map((c) => [c.id, c.name]), [[proof.doc, 'Proof.pdf']]);
  const reading = got.find((e) => e.event === 'reading')!.data as { documents: number };
  assert.equal(reading.documents, 1, 'reading counts stay the retrieved set');
});

test('nothing retrieved but a case picture: the model answers from the picture', async () => {
  const { h } = briefHarness({ chunks: [], answer: 'READ: The matter is Doe v. Harbor Labs (case picture).' });
  const got = await events(await handle(askRequest({ question: 'What filings is counsel preparing?' }), h.env, ctx));
  assert.equal(h.runs.length, 1);
  assert.deepEqual(got.at(-1), { event: 'done', data: { dontKnow: false } });
});

test('a manifest Ask cannot read leaves Ask answering from passages alone', async () => {
  resetMatterCache();
  const h = harness({ chunks: [chunk('doc-live-a', 2, 'Text.')], matter: '{ not json' });
  const res = await handle(askRequest({ question: QUESTION }), h.env, ctx);
  assert.equal(res.status, 200);
  await res.text();
  assert.doesNotMatch(h.runs[0]!.input.messages.map((m) => m.content).join('\n'), /case-picture>>>/);
});

test('an answer cut at max_tokens arrives as written, its cites validated, and done says truncated', async () => {
  const original = console.error;
  const logged: unknown[][] = [];
  console.error = (...args: unknown[]) => logged.push(args);
  try {
    const h = harness({ chunks: [chunk('doc-live-a', 2, 'The zebra meeting happened.')], answer: 'READ: The meeting happened [doc:doc-live-a p:2]. Then', stop: 'length' });
    const got = await events(await handle(askRequest({ question: QUESTION }), h.env, ctx));
    const text = got.filter((e) => e.event === 'delta').map((e) => (e.data as { text: string }).text).join('');
    assert.equal(text, 'READ: The meeting happened [doc:doc-live-a p:2]. Then');
    assert.deepEqual(got.at(-2), {
      event: 'citations',
      data: { citations: [{ id: 'doc-live-a', page: 2, name: 'Alpha memo.pdf', control_seq: null, quote: null }] },
    });
    assert.deepEqual(got.at(-1), { event: 'done', data: { dontKnow: false, truncated: true } });
    assert.equal(h.runs.length, 1, 'a cut answer with text is not asked again');
  } finally {
    console.error = original;
  }
  assert.deepEqual(logged, [['ask_answer_stopped', 'length']]);
});
