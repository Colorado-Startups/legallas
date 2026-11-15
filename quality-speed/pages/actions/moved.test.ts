// SPDX-License-Identifier: Apache-2.0
// The moved metrics, on invented records.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appWorkflows, gatesIntact, queueSecondsP90, repeatRunsPerMerge, tokenJobs, type Rule } from './moved.ts';
import type { Job, PullRequest, Run } from './measure.ts';

const NOW = new Date('2026-11-09T12:00:00Z');
const AT = '2026-11-09T10:00:00Z';
const SHA = 'a'.repeat(40);
const LINT = "      - name: Lint workflows\n        if: steps.changed.outputs.workflows == 'true'\n        run: .github/scripts/lint-workflows.sh\n";
const RULES: Rule[] = [{ type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'ci-ok' }, { context: 'dco' }] } }, { type: 'required_signatures' }];

const job = (name: string, more: Partial<Job> = {}): Job => ({ name, conclusion: 'success', created_at: AT, started_at: AT, completed_at: AT, runner_name: 'r', ...more });
const run = (path: string, jobs: Job[], more: Partial<Run> = {}): Run => ({
  id: 1, path: `.github/workflows/${path}`, event: 'pull_request', status: 'completed', conclusion: 'success', run_attempt: 1, run_number: 1,
  head_branch: 'claude/x', head_sha: SHA, created_at: AT, updated_at: AT, jobs, ...more,
});
const pull: PullRequest = { number: 1, head_ref: 'claude/x', head_sha: SHA, created_at: AT, closed_at: AT, merged_at: AT, merge_commit_sha: 'b'.repeat(40), files: ['web/x.ts'] };
const ci = run('ci.yml', [job('ci-ok'), job('checks', { steps: [{ name: 'Secret scan', conclusion: 'success' }] })]);
const dco = run('dco.yml', [job('dco')]);

test('all six gates hold on a merged head', () => {
  assert.deepEqual(gatesIntact([ci, dco], [pull], RULES, LINT, NOW), { value: 6, samples: 1 });
});

test('a missing sign-off job and a dropped rule each cost a gate; a quiet window reads missing', () => {
  assert.equal(gatesIntact([ci], [pull], RULES.slice(0, 1), LINT, NOW)?.value, 4);
  assert.equal(gatesIntact([ci, dco], [{ ...pull, merged_at: '2026-11-01T00:00:00Z' }], RULES, LINT, NOW), null);
});

test('a second run of one workflow on one head is a repeat', () => {
  assert.deepEqual(repeatRunsPerMerge([ci, { ...ci, id: 2 }, dco], [pull], NOW), { value: 1, samples: 1 });
  assert.equal(repeatRunsPerMerge([ci], [], NOW), null);
});

test('queue p90 reads creation to start on a runner', () => {
  const waits = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((s) => job('j', { created_at: AT, started_at: new Date(Date.parse(AT) + s * 1000).toISOString() }));
  assert.deepEqual(queueSecondsP90([run('ci.yml', waits)], NOW), { value: 90, samples: 10 });
});

test('the App token jobs: passing share and median', () => {
  const steps = [{ name: 'Mint', conclusion: 'success' }];
  const reading = tokenJobs([
    { conclusion: 'success', started_at: AT, completed_at: '2026-11-09T10:01:00Z', steps },
    { conclusion: 'failure', started_at: AT, completed_at: '2026-11-09T10:03:00Z', steps },
    { conclusion: 'skipped', started_at: AT, completed_at: AT, steps },
  ]);
  assert.deepEqual(reading, { passing: { value: 50, samples: 2 }, p50: { value: 120, samples: 2 } });
  assert.equal(tokenJobs([]), null);
});

test('a workflow mints the App token only with its client id', () => {
  const text = '    steps:\n      - name: Mint\n        uses: actions/create-github-app-token@abc\n        with:\n          client-id: ${{ vars.CS_APP_CLIENT_ID }}\n';
  assert.deepEqual(appWorkflows([{ name: 'a.yml', text }, { name: 'b.yml', text: text.replace('CS_APP_CLIENT_ID', 'OTHER') }]), [{ file: 'a.yml', steps: ['Mint'] }]);
});
