// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { collect, loadReviewed } from './collect.ts';
import { DAY_MS } from './delivery.ts';
import { NOW, history } from './fixture.ts';
import { GitHubError, type Reader } from './github.ts';

/** A reader that answers from an invented history, the way the REST endpoints shape it. */
function fakeReader(options: { failOn?: string; error?: Error } = {}): Reader {
  const h = history(
    [
      { number: 1, mergedDaysAgo: 20, body: 'Closes #50.' },
      { number: 2, mergedDaysAgo: 3, body: 'A follow-up to #1.' },
      { number: 3, mergedDaysAgo: null },
    ],
    { issues: [50] },
  );
  let calls = 0;
  const answer = (path: string): unknown => {
    calls += 1;
    if (options.failOn && path.includes(options.failOn)) throw options.error ?? new GitHubError(`GitHub answered 500 for ${options.failOn}`);
    if (path.includes('/commits?sha=main&per_page=1&until=')) return [{ sha: 'e'.repeat(40) }];
    if (path.includes('/pulls?')) return h.pulls;
    if (path.includes('/issues?')) return [{ number: 50, labels: [] }, { number: 1, pull_request: {}, labels: [] }];
    const commits = /\/pulls\/(\d+)\/commits/.exec(path);
    if (commits) return [{ commit: { author: { date: h.pulls.find((p) => p.number === Number(commits[1]))?.created_at }, committer: null } }];
    if (/\/pulls\/\d+\/files/.test(path)) return [{ filename: 'web/src/invented.ts' }];
    if (path.includes('/runs?')) {
      const range = /created=(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})/.exec(path);
      const from = Date.parse(`${range?.[1]}T00:00:00Z`);
      const to = Date.parse(`${range?.[2]}T00:00:00Z`) + DAY_MS;
      const runs = h.runs.filter((r) => Date.parse(r.created_at) >= from && Date.parse(r.created_at) < to);
      return { total_count: runs.length, workflow_runs: runs };
    }
    throw new GitHubError('GitHub answered 404 for an unknown path');
  };
  return {
    get: async <T>(path: string) => answer(path) as T,
    pages: async <T>(path: string, pick?: (b: unknown) => T[]) => {
      const body = answer(path);
      return pick ? pick(body) : (body as T[]);
    },
    calls: () => calls,
  };
}

const dir = mkdtempSync(path.join(tmpdir(), 'insights-'));
const REVIEWED = path.join(dir, 'reviewed.json');
writeFileSync(REVIEWED, JSON.stringify({ reviewed_through: '2031-03-10', repairs: [{ pr: 2, repairs: 1 }], not_backlog_issues: [], backlog_board: null }));

describe('collect', () => {
  it('reads the history, passes the drill and links the Actions run', async () => {
    const env = { GITHUB_RUN_ID: '777', GITHUB_REPOSITORY: 'Colorado-Startups/legallas' };
    const result = await collect(fakeReader(), NOW, env, REVIEWED);
    assert.equal(result.error, null);
    const by = Object.fromEntries(result.records.map((r) => [r.id, r]));
    assert.equal(by.failure_drill?.value, 1, JSON.stringify(result.drillChecks));
    assert.equal(by.rework_rate?.value, 50);
    assert.equal(by.merges_tied_to_issue?.value, 100);
    assert.equal(by.lead_time_p50?.source_url, 'https://github.com/Colorado-Startups/legallas/actions/runs/777');
    assert.equal(result.detail?.commit, 'e'.repeat(40));
    assert.equal(result.detail?.changes.length, 2);
  });

  it('scores nothing when not run by Actions in this repository, and keeps the readings', async () => {
    const result = await collect(fakeReader(), NOW, { GITHUB_RUN_ID: '777', GITHUB_REPOSITORY: 'someone/else' }, REVIEWED);
    assert.ok(result.records.every((r) => r.status === 'missing'));
    assert.equal(result.records[1]?.source_url, `https://github.com/Colorado-Startups/legallas/commit/${'e'.repeat(40)}`);
    assert.equal(result.readings.find((r) => r.id === 'rework_rate')?.value, 50);
  });

  it('writes every metric missing when any call fails, and says which', async () => {
    const result = await collect(fakeReader({ failOn: '/files' }), NOW, {}, REVIEWED);
    assert.ok(result.records.every((r) => r.status === 'missing' && r.value === null));
    assert.equal(result.detail, null);
    assert.equal(result.error, 'GitHub answered 500 for /files');
  });

  it('never prints an error it did not write itself', async () => {
    const result = await collect(fakeReader({ failOn: '/issues', error: new Error('a body with anything in it') }), NOW, {}, REVIEWED);
    assert.equal(result.error, 'the collector failed');
  });

  it("reads this folder's reviewed list, and refuses one that holds anything but numbers", () => {
    assert.ok(loadReviewed().repairs.length > 0);
    const bad = path.join(dir, 'bad.json');
    writeFileSync(bad, JSON.stringify({ reviewed_through: '2031-03-10', repairs: [{ pr: 'words', repairs: 1 }], not_backlog_issues: [] }));
    assert.throws(() => loadReviewed(bad), /numbers and a date only/);
    writeFileSync(bad, JSON.stringify({ reviewed_through: 'soon', repairs: [], not_backlog_issues: [], backlog_board: null }));
    assert.throws(() => loadReviewed(bad), /numbers and a date only/);
    writeFileSync(bad, JSON.stringify({ reviewed_through: '2031-03-10', repairs: [], not_backlog_issues: [] }));
    assert.throws(() => loadReviewed(bad), /numbers and a date only/);
  });
});
