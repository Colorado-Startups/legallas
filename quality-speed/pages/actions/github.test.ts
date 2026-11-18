// SPDX-License-Identifier: Apache-2.0
// The GitHub App token read (#8), on invented runs and jobs. GitHub is a fake fetch that pages like the real API and,
// like a search, never returns past its 1,000th result. Nothing here reads the network.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { Github } from './github.ts';
import type { TokenJob } from './moved.ts';

const NOW = new Date('2026-11-17T00:00:00Z');
const SINCE = new Date('2026-10-18T00:00:00Z');
const STEPS = [{ name: 'Mint', conclusion: 'success' }];

interface FakeRun {
  id: number;
  created_at: string;
  jobs: TokenJob[];
}

const job = (conclusion = 'success'): TokenJob => ({ conclusion, started_at: '2026-11-01T10:00:00Z', completed_at: '2026-11-01T10:01:00Z', steps: STEPS });

/** `count` runs spread evenly over the window, one minting job each; the first run has `wide` jobs. */
function runsOver(count: number, wide = 1): FakeRun[] {
  const span = NOW.getTime() - SINCE.getTime();
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    created_at: new Date(SINCE.getTime() + Math.floor(((i + 0.5) * span) / count)).toISOString(),
    jobs: Array.from({ length: i === 0 ? wide : 1 }, () => job()),
  }));
}

function fakeGithub(t: TestContext, runs: readonly FakeRun[]): void {
  t.mock.method(globalThis, 'fetch', async (input: string | URL) => {
    const url = new URL(String(input));
    const perPage = Number(url.searchParams.get('per_page') ?? 30);
    const page = Number(url.searchParams.get('page') ?? 1);
    const slice = <T>(items: readonly T[]) => items.slice((page - 1) * perPage, page * perPage);
    const jobsOf = /\/actions\/runs\/(\d+)\/jobs$/.exec(url.pathname);
    if (jobsOf) {
      const jobs = runs.find((r) => r.id === Number(jobsOf[1]))?.jobs ?? [];
      return Response.json({ total_count: jobs.length, jobs: slice(jobs) });
    }
    assert.match(url.pathname, /\/actions\/workflows\/qs\.yml\/runs$/);
    assert.equal(url.searchParams.get('status'), 'completed');
    // A span ("from..to"), or an open end (">=from").
    const created = url.searchParams.get('created') ?? '';
    const [from, to] = created.startsWith('>=') ? [Date.parse(created.slice(2)), Infinity] : created.split('..').map((d) => Date.parse(d));
    const listed = runs.filter((r) => Date.parse(r.created_at) >= from! && Date.parse(r.created_at) <= to! + 999);
    // A search answers its true count but no result past the 1,000th.
    const shown = (page - 1) * perPage >= 1000 ? [] : slice(listed);
    return Response.json({ total_count: listed.length, workflow_runs: shown.map(({ id }) => ({ id })) });
  });
}

test('every run in the window is read, past one page and past the search limit (#8)', async (t) => {
  for (const count of [250, 1200]) {
    const runs = runsOver(count);
    fakeGithub(t, runs);
    const jobs = await new Github('token', 'owner/repo').tokenJobs([{ file: 'qs.yml', steps: ['Mint'] }], SINCE, NOW);
    assert.equal(jobs.length, count, `${count} runs`);
    t.mock.restoreAll();
  }
});

test('every job of a run is read, past one page', async (t) => {
  fakeGithub(t, runsOver(3, 150));
  const jobs = await new Github('token', 'owner/repo').tokenJobs([{ file: 'qs.yml', steps: ['Mint'] }], SINCE, NOW);
  assert.equal(jobs.length, 152);
});

test('only jobs that ran a minting step count', async (t) => {
  const runs = runsOver(2);
  runs[1]!.jobs.push({ ...job(), steps: [{ name: 'Other', conclusion: 'success' }] }, { ...job(), steps: [{ name: 'Mint', conclusion: 'skipped' }] });
  fakeGithub(t, runs);
  const jobs = await new Github('token', 'owner/repo').tokenJobs([{ file: 'qs.yml', steps: ['Mint'] }], SINCE, NOW);
  assert.equal(jobs.length, 2);
});
