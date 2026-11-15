// SPDX-License-Identifier: Apache-2.0
// node --test quality-speed/pages/github-app/github-app.test.ts
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { Manifest, MetricRecord } from '../../contract/format.ts';
import { joinMetrics, validateManifest, validateRecords } from '../../contract/validate.ts';
import { frameWords } from '../../core/build.ts';
import { roadState } from '../../core/charts/charts.js';
import { countWords, MAX_WORDS } from '../../core/guard.ts';
import { scorePage } from '../../core/score.ts';
import { appWorkflows, collect, EXPECTED, measure, permissionsOff, readJobs, readPermissions, tokenSteps, type Get, type Job } from './collect.ts';
import { render, roadFixes } from './page.ts';

/** The list as signed off, whatever the sign-off comment's id. */
const manifest: Manifest = { ...JSON.parse(readFileSync(new URL('./manifest.json', import.meta.url), 'utf8')), signoff_comment: 1 };
const NOW = new Date('2026-11-05T12:00:00Z');
const RUN = { now: '2026-11-05T12:00:00Z', sourceUrl: 'https://github.com/Colorado-Startups/legallas/actions/runs/7' };
const job = (conclusion: string | null, seconds: number): Job => ({ conclusion, started_at: '2026-11-01T10:00:00Z', completed_at: new Date(Date.parse('2026-11-01T10:00:00Z') + seconds * 1000).toISOString() });
const values = (records: MetricRecord[]) => Object.fromEntries(records.map((r) => [r.id, r.value]));
/** Answers each path from a table, and null for anything else, as a refused read does. */
const answers = (table: Record<string, unknown>): Get => async (p) => table[p] ?? null;

test('the App holding exactly the expected permissions, with passing jobs, reads at goal and passes the format', () => {
  const records = collect({ ...EXPECTED.permissions }, [job('success', 20), job('success', 40)], RUN);
  assert.deepEqual(values(records), { app_permissions_off: 0, app_token_runs_passing: 100, app_token_job_seconds_p50: 30 });
  const checked = validateManifest({ ...manifest }, 'github-app');
  assert.deepEqual(checked.errors, []);
  assert.deepEqual(validateRecords(records, checked.value as Manifest, NOW).errors, []);
});

test('an extra, missing or wider permission each count once', () => {
  const want = EXPECTED.permissions;
  const n = Object.keys(want).length;
  assert.deepEqual(permissionsOff(want, { ...want }), { off: [], read: n });
  assert.deepEqual(permissionsOff(want, { ...want, issues: 'write' }), { off: ['issues'], read: n + 1 });
  const { metadata: _, ...short } = want;
  assert.deepEqual(permissionsOff(want, short), { off: ['metadata'], read: n });
  assert.deepEqual(permissionsOff(want, { ...want, contents: 'write' }), { off: ['contents'], read: n });
});

test('only answered jobs count; none answered, or any failed read, reads missing, never 0', async () => {
  assert.deepEqual(measure([job('success', 10), job('failure', 50), job('timed_out', 300), job('skipped', 0), job('cancelled', 5), job(null, 5)]), { passing: 33.33, p50: 50, n: 3 });
  assert.equal(measure([job('skipped', 0)]), null);
  assert.equal(measure([{ conclusion: 'success', started_at: null, completed_at: null }]), null);
  const none = collect(null, null, RUN);
  assert.ok(none.every((r) => r.status === 'missing' && r.value === null));
  assert.deepEqual(validateRecords(none, manifest, NOW).errors, []);

  const api = '/repos/Colorado-Startups/legallas/actions';
  const runs = `${api}/workflows/board-card.yml/runs?status=completed&created=%3E%3D2026-10-06&per_page=100`;
  const minted = { ...job('success', 20), steps: [{ name: 'App token', conclusion: 'success' }] };
  const others = [job('success', 30), { ...job('failure', 5), steps: [{ name: 'Checkout', conclusion: 'failure' }, { name: 'App token', conclusion: 'skipped' }] }];
  const table = { [runs]: { workflow_runs: [{ id: 11 }] }, [`${api}/runs/11/jobs?filter=all&per_page=100`]: { jobs: [minted, ...others] } };
  const workflows = [{ file: 'board-card.yml', steps: ['App token'] }];
  assert.deepEqual(await readJobs(answers(table), workflows, NOW), [minted], 'only a job that ran the token step');
  assert.equal(await readJobs(answers({ [runs]: table[runs] }), workflows, NOW), null, 'a refused jobs read');
  assert.equal(await readJobs(answers({}), workflows, NOW), null, 'a refused runs read');

  const app = { slug: 'legallas-automation', permissions: { ...EXPECTED.permissions } };
  assert.deepEqual(await readPermissions(answers({ '/apps/legallas-automation': app }), EXPECTED.app), EXPECTED.permissions);
  assert.equal(await readPermissions(answers({}), EXPECTED.app), null, 'a private App the token cannot see');
  assert.equal(await readPermissions(answers({ '/apps/legallas-automation': { ...app, slug: 'another-app' } }), EXPECTED.app), null);
  assert.equal(await readPermissions(answers({ '/apps/legallas-automation': { ...app, permissions: { contents: 1 } } }), EXPECTED.app), null);
});

const ACTION = 'actions/create-github-app-token@0000000000000000000000000000000000000000';
const mint = (head: string, client = 'vars.CS_APP_CLIENT_ID') => `      - ${head}\n        uses: ${ACTION} # v0\n        with:\n          client-id: \${{ ${client} }}\n`;

test("only the steps minting this App's token count, by the name the jobs API gives them", () => {
  const lanes = `      - name: Checkout\n        uses: actions/checkout@0000000000000000000000000000000000000000\n`;
  const next = '  next:\n    name: Another job\n    runs-on: ubuntu-latest\n';
  const file = `jobs:\n  a:\n    steps:\n${lanes}${mint('name: App token')}${mint("name: 'Quoted token'")}${mint('id: unnamed')}${next}${mint('name: Other App', 'vars.OTHER_CLIENT_ID')}`;
  assert.deepEqual(tokenSteps(file), ['App token', 'Quoted token', `Run ${ACTION}`]);
  assert.deepEqual(tokenSteps(`steps:\n  - uses: ${ACTION}\n    with:\n      client-id: \${{ vars.CS_APP_CLIENT_ID }}\n`), [`Run ${ACTION}`]);
  const dir = mkdtempSync(path.join(tmpdir(), 'github-app-'));
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'board-card.yml'), `jobs:\n  card:\n    steps:\n${mint('name: App token')}`);
    writeFileSync(path.join(dir, 'other-app.yml'), `jobs:\n  card:\n    steps:\n${mint('name: App token', 'vars.OTHER_CLIENT_ID')}`);
    writeFileSync(path.join(dir, 'mentions.yml'), `# Not ${ACTION} itself, and not vars.CS_APP_CLIENT_ID either.\n`);
    assert.deepEqual(appWorkflows(dir), [{ file: 'board-card.yml', steps: ['App token'] }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const atGoal: MetricRecord[] = manifest.metrics.map((m) => ({ id: m.id, page: 'github-app', value: m.goal, status: 'ok', stage: 'live', measured_at: '2026-11-05T06:00:00Z', source_url: RUN.sourceUrl, sample_size: m.min_samples }));
/** Only the metrics that used to be safety gates, each measured at its floor: a miss the site can see. */
const MISSED = ['app_permissions_off'];
const gatesMissed: MetricRecord[] = atGoal.flatMap((r) => {
  const def = manifest.metrics.find((m) => m.id === r.id);
  return def && MISSED.includes(r.id) ? [{ ...r, value: def.floor }] : [];
});
const page = (records: MetricRecord[]) => {
  const score = scorePage('github-app', manifest, records, NOW);
  return { score, body: render({ score, metrics: joinMetrics(manifest, records), history: [], others: {}, detail: null }).body };
};
const rowsOf = (score: ReturnType<typeof page>['score']) =>
  joinMetrics(manifest, []).map((m, i) => ({ id: m.id, lens: m.lens, weight: m.weight, group: m.group, score: score.metrics[i]?.score ?? 0 }));

test('the page renders with nothing measured, in the word limit; every metric at goal reads 100 in each third', () => {
  const empty = page([]);
  assert.equal(empty.score.total, 0);
  assert.match(empty.body, /Permissions off/);
  assert.ok(countWords(empty.body) + frameWords('github-app') <= MAX_WORDS, `visible words: ${countWords(empty.body)} + ${frameWords('github-app')}`);
  assert.doesNotMatch(empty.body, /\u2014/);
  const full = page(atGoal).score;
  assert.deepEqual([full.quality, full.speed, full.consumption, full.total], [100, 100, 100, 100]);
});

test('every fix on reaches 100', () => {
  const { score } = page(gatesMissed);
  const fixes = roadFixes(rowsOf(score), score);
  assert.deepEqual(fixes.map((f) => f.id), ['permissions', 'runs', 'fast', 'lane']);
  const now = { q: score.exact_quality, s: score.exact_speed, c: score.exact_consumption, total: score.total };
  assert.equal(roadState(now, fixes, fixes.map((f) => f.id)).total, 100);
});
