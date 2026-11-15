// SPDX-License-Identifier: Apache-2.0
// The collector on a fake API: run listings halve until each range fits one page, a page short of its count throws, a
// whole read takes only the jobs its readings need, and a blip is retried.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CONFIG, httpGet, listRuns, pool, read, type Get } from './collect.ts';
import { readings, type Run } from './compute.ts';

const start = Date.parse('2026-03-10T00:00:00Z');
const day = 86_400_000;
const runs = Array.from({ length: 450 }, (_, i) => ({ id: i, created_at: new Date(start + Math.floor((i * day) / 450)).toISOString().slice(0, 19) + 'Z' }));
/** Answers a created range as GitHub does: the count, and at most 100 runs. `drop` loses one run from every page. */
const fake = (drop = false): Get => async (path) => {
  const [a, b] = decodeURIComponent(/created=([^&]+)/.exec(path)?.[1] ?? '').split('..').map((x) => Date.parse(x ?? ''));
  const hits = runs.filter((r) => Date.parse(r.created_at) >= (a as number) && Date.parse(r.created_at) <= (b as number));
  return { body: { total_count: hits.length, workflow_runs: hits.slice(0, Math.min(100, hits.length) - (drop ? 1 : 0)) }, next: null };
};

test('a day of 450 runs is read whole, one page per range', async () => {
  const got = await listRuns(fake(), 'pull_request', start, start + day);
  assert.equal(new Set(got.map((r) => r.id)).size, 450);
  assert.equal(got.length, 450);
});

test('a page short of its count throws', async () => {
  await assert.rejects(listRuns(fake(true), 'pull_request', start, start + day));
});

// An invented repository: #1 merged an hour ago on a head pushed five days ago, #2 merged half an hour ago, #3 is open
// with CI run twice on one head, and a push to main.
const now = Date.parse('2026-03-10T12:00:00Z');
const ago = (min: number) => new Date(now - min * 60_000).toISOString().slice(0, 19) + 'Z';
const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const C = 'c'.repeat(40);
const r = (id: number, name: string, sha: string, min: number, event = 'pull_request', conclusion = 'success'): Run => ({
  id,
  name,
  event,
  status: 'completed',
  conclusion,
  head_sha: sha,
  head_branch: event === 'push' ? 'main' : 'x',
  created_at: ago(min),
  updated_at: ago(min - 3),
});
const ALL = [
  r(101, 'CI', A, 5 * 1440),
  r(102, 'DCO', A, 5 * 1440),
  r(201, 'CI', B, 120),
  r(202, 'DCO', B, 120),
  r(301, 'CI', C, 180),
  r(302, 'CI', C, 150),
  r(303, 'DCO', C, 180),
  r(401, 'CI', 'd'.repeat(40), 20, 'push'),
  r(501, 'DCO', C, 60, 'pull_request', 'skipped'),
];
const jobsOf = (run: Run) =>
  run.name === 'CI'
    ? [
        { name: 'checks', labels: ['ubuntu-latest'], started_at: run.created_at, completed_at: run.updated_at, conclusion: 'success', steps: [{ name: 'Secret scan', conclusion: 'success' }] },
        { name: 'ci-ok', labels: ['ubuntu-slim'], started_at: run.created_at, completed_at: run.updated_at, conclusion: 'success' },
      ]
    : [{ name: 'dco', labels: ['ubuntu-slim'], started_at: run.created_at, completed_at: run.updated_at, conclusion: 'success' }];
const comment = (n: number, min: number, body: string, author_association = 'MEMBER', type = 'User') => ({
  issue_url: `https://api.github.com/repos/Colorado-Startups/legallas/issues/${n}`,
  created_at: ago(min),
  author_association,
  user: { type },
  body,
});

function repo() {
  const asked: string[] = [];
  const get: Get = async (path) => {
    asked.push(path);
    const u = new URL(path, 'https://api.github.com');
    const q = u.searchParams;
    if (u.pathname.endsWith('/actions/runs') && q.has('head_sha')) {
      const hits = ALL.filter((x) => x.head_sha === q.get('head_sha') && x.event === q.get('event'));
      return { body: { total_count: hits.length, workflow_runs: hits }, next: null };
    }
    if (u.pathname.endsWith('/actions/runs')) {
      const [a, b] = (q.get('created') ?? '').split('..').map((x) => Date.parse(x));
      const hits = ALL.filter((x) => x.event === q.get('event') && Date.parse(x.created_at) >= (a as number) && Date.parse(x.created_at) <= (b as number));
      return { body: { total_count: hits.length, workflow_runs: hits }, next: null };
    }
    const jobs = /\/actions\/runs\/(\d+)\/jobs$/.exec(u.pathname);
    if (jobs) return { body: { jobs: jobsOf(ALL.find((x) => x.id === Number(jobs[1])) as Run) }, next: null };
    if (u.pathname.endsWith('/pulls')) {
      return {
        body: [
          { number: 2, merged_at: ago(30), updated_at: ago(30), head: { ref: 'x', sha: B }, user: { type: 'User' } },
          { number: 1, merged_at: ago(60), updated_at: ago(60), head: { ref: 'x', sha: A }, user: { type: 'User' } },
          { number: 3, merged_at: null, updated_at: ago(150), head: { ref: 'x', sha: C }, user: { type: 'User' } },
        ],
        next: null,
      };
    }
    if (u.pathname.endsWith('/timeline')) return { body: [], next: null };
    if (u.pathname.endsWith('/issues/comments')) {
      return {
        body: [
          comment(1, 70, `Review: MERGE at ${A}`),
          comment(2, 40, `Review: MERGE at ${B}\nGreen on the head.`, 'CONTRIBUTOR'),
          comment(2, 45, 'Looks good.'),
          comment(3, 100, `Review: BLOCK at ${C}`, 'NONE', 'Bot'),
        ],
        next: null,
      };
    }
    if (u.pathname.endsWith('/rules/branches/main')) return { body: [{ type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'ci-ok' }, { context: 'dco' }] } }], next: null };
    throw new Error(`unexpected read ${path}`);
  };
  return { get, asked };
}

test('read: an old merged head is found by SHA, only the jobs a reading needs are read, verdicts kept', async () => {
  const { get, asked } = repo();
  const d = await read(get, { ...CONFIG, drill_runs: 1 }, now);
  // #1's head was pushed before the lookback: its runs came by SHA, so its CI run proves the push.
  assert.ok(asked.some((p) => p.includes(`head_sha=${A}`)));
  assert.ok(!asked.some((p) => p.includes(`head_sha=${B}`)));
  // Gates: 101, 102, 201, 202. Repeats: 301 and 302. Newest run: 401. Not 303 (once, unmerged), not 501 (skipped).
  assert.deepEqual(Object.keys(d.jobs).map(Number).sort((a, b) => a - b), [101, 102, 201, 202, 301, 302, 401]);
  assert.equal(d.drill_from, ago(20));
  // Only the two members' verdicts, timed as posted.
  assert.deepEqual(d.verdicts?.map((v) => [v.issue, v.verdict]), [[1, 'MERGE'], [2, 'MERGE']]);
  const v = readings(d, CONFIG, now);
  // CI pushes in the window: heads B and C over two merges.
  assert.deepEqual(v.pushes_per_merge, { value: 1, samples: 2 });
  assert.deepEqual(v.reviews_per_merge, { value: 1, samples: 2 });
  assert.deepEqual(v.repeat_runs_per_merge, { value: 0.5, samples: 2 });
  assert.equal(v.final_push_to_merge_p50.samples, 2);
});

test('pool: a failure stops the rest and is thrown', async () => {
  const done: number[] = [];
  await assert.rejects(
    pool([1, 2, 3, 4, 5], 1, async (n) => {
      if (n === 2) throw new Error('no');
      done.push(n);
    }),
  );
  assert.deepEqual(done, [1]);
});

test('httpGet: a 502 is tried again; a 404, a plain 403 and a third failure are not', async () => {
  const waits: number[] = [];
  const wait = async (ms: number) => void waits.push(ms);
  const answers = (...codes: number[]) => {
    let i = 0;
    return (async () => {
      const code = codes[Math.min(i++, codes.length - 1)] as number;
      return code === 200 ? new Response('{"ok":true}', { status: 200 }) : new Response('', { status: code, headers: code === 429 ? { 'retry-after': '7' } : {} });
    }) as unknown as typeof fetch;
  };
  assert.deepEqual((await httpGet('t', answers(502, 200), wait)('/x')).body, { ok: true });
  assert.deepEqual(waits, [2000]);
  await httpGet('t', answers(429, 200), wait)('/x');
  assert.equal(waits.at(-1), 7000);
  await assert.rejects(httpGet('t', answers(404), wait)('/x'), /HTTP 404/);
  await assert.rejects(httpGet('t', answers(403), wait)('/x'), /HTTP 403/);
  await assert.rejects(httpGet('t', answers(502, 503, 500), wait)('/x'), /HTTP 500/);
  await assert.rejects(httpGet('t', answers(200), wait)('https://example.com/x'), /not api\.github\.com/);
});
