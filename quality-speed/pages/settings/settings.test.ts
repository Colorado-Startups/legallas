// SPDX-License-Identifier: Apache-2.0
// node --test quality-speed/pages/settings/settings.test.ts
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { validateManifest, validateRecords } from '../../contract/validate.ts';
import { collect, METRIC_IDS, score } from './collect.ts';
import { advance, emptyLog, parseLog } from './driftlog.ts';
import { applyChange, fixtureFetcher, load, runDrill, type Api, type Plant, type Vars } from './drill.ts';
import { uncovered } from './guard.ts';
import { GRAPHQL, MERGE_FIELDS, MERGE_QUERY, takeSnapshot, type Fetcher } from './reads.ts';
import { allowlistCovers, evaluate, loadExpected, resolveNested, workflowFacts, type Change, type Expected, type WorkflowFacts } from './settings.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXPECTED = path.join(HERE, 'expected-settings.json');
const R = '/repos/Colorado-Startups/legallas';
const SHA_A = 'a'.repeat(40);
const RUN = 'https://github.com/Colorado-Startups/legallas/actions/runs/7';
const LONG_AGO = '2026-09-01T00:00:00Z';

function writeExpected(mutate: (e: Record<string, unknown>) => void): string {
  const e = JSON.parse(readFileSync(EXPECTED, 'utf8')) as Record<string, unknown>;
  mutate(e);
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'qs-settings-')), 'expected.json');
  writeFileSync(file, JSON.stringify(e));
  return file;
}
type S = { id: string; gate: boolean; expect: { op: string; value: unknown } };
const fresh = (): Expected => JSON.parse(readFileSync(EXPECTED, 'utf8')) as Expected;

test('the expected settings file loads, and every setting has an extractor', () => {
  const e = loadExpected(EXPECTED);
  assert.ok(e.settings.length >= 70);
  assert.deepEqual(e.changes.map((c) => `${c.field}:${c.setting}`), [
    'expect:branch_required_checks',
    'expect:repo_visibility',
    'expect:allow_forking',
    'expect:has_discussions',
    'expect:allow_auto_merge',
    'removed:actions_access_level',
    'expect:branch_bypass',
    'removed:push_ruleset_case_paths',
    'removed:push_ruleset_max_file_mb',
    'removed:push_ruleset_bypass',
    'removed:pages_private',
  ]);
});

test('a malformed expected file is refused', () => {
  assert.throws(() => loadExpected(writeExpected((e) => (e.settings as S[]).push({ ...(e.settings as S[])[0]! }))), /unique/);
  assert.throws(
    () => loadExpected(writeExpected((e) => ((e.settings as S[]).find((s) => s.id === 'branch_required_checks')!.expect.value = ['dco', 'ci-ok']))),
    /sorted/,
  );
  assert.throws(() => loadExpected(writeExpected((e) => ((e.settings as S[])[0]!.expect.op = 'about'))), /unknown op/);
  assert.throws(() => loadExpected(writeExpected((e) => ((e.settings as S[])[0]!.id = 'no_such_setting'))), /no extractor/);
});

test('workflow facts find every uses, secret and environment, and skip comments and the job token', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'qs-wf-'));
  writeFileSync(
    path.join(dir, 'one.yml'),
    [
      'jobs:',
      '  a:',
      '    environment: deploy-a',
      '    steps:',
      `      - uses: actions/checkout@${SHA_A} # v9`,
      '      # - uses: someone/commented@v1',
      `        uses: "anthropics/claude-code-action@${SHA_A}"`,
      '        env:',
      '          A: ${{ secrets.FIRST_KEY }}',
      '          B: ${{ secrets.GITHUB_TOKEN }}',
      '      - uses: ./local-action',
      '  b:',
      '    environment:',
      '      name: deploy-b',
      '      url: https://example.invalid',
      '    steps: []',
    ].join('\n'),
  );
  writeFileSync(path.join(dir, 'two.yaml'), 'x: ${{ secrets.SECOND_KEY }}\n');
  writeFileSync(path.join(dir, 'notes.md'), 'uses: ignored/here@v1 secrets.IGNORED\n');
  assert.deepEqual(workflowFacts(dir), {
    uses: ['./local-action', `actions/checkout@${SHA_A}`, `anthropics/claude-code-action@${SHA_A}`],
    secrets: ['FIRST_KEY', 'SECOND_KEY'],
    environments: ['deploy-a', 'deploy-b'],
    all_uses: null,
  });
});

test('nested actions are followed at their pinned commits, and an unreadable one leaves the list unresolved', async () => {
  const files: Record<string, string> = {
    [`https://raw.githubusercontent.com/anthropics/claude-code-action/${SHA_A}/action.yml`]: `runs:\n  using: composite\n  steps:\n    - uses: oven-sh/setup-bun@${'b'.repeat(40)}\n`,
    [`https://raw.githubusercontent.com/oven-sh/setup-bun/${'b'.repeat(40)}/action.yml`]: 'runs:\n  using: node24\n',
    [`https://raw.githubusercontent.com/actions/cache/${SHA_A}/restore/action.yml`]: 'runs:\n  using: node24\n',
  };
  const fetchText = async (url: string) => files[url] ?? null;
  assert.deepEqual(await resolveNested([`anthropics/claude-code-action@${SHA_A}`, `actions/cache/restore@${SHA_A}`, './local'], fetchText), [
    './local',
    `actions/cache/restore@${SHA_A}`,
    `anthropics/claude-code-action@${SHA_A}`,
    `oven-sh/setup-bun@${'b'.repeat(40)}`,
  ]);
  assert.equal(await resolveNested([`someone/unknown@${SHA_A}`], fetchText), null);
});

test('the allowlist check needs a full SHA and an allowing policy for every action', () => {
  const selected = { github_owned_allowed: true, verified_allowed: false, patterns_allowed: ['anthropics/claude-code-action@*', 'oven-sh/setup-bun@*'] };
  assert.equal(allowlistCovers([`actions/cache/restore@${SHA_A}`, `anthropics/claude-code-action@${SHA_A}`, `oven-sh/setup-bun@${SHA_A}`, './x'], 'selected', selected), true);
  assert.equal(allowlistCovers(['actions/checkout@v6'], 'selected', selected), false, 'a tag is not a SHA');
  assert.equal(allowlistCovers([`someone/tool@${SHA_A}`], 'selected', selected), false, 'not on the list');
  assert.equal(allowlistCovers([`someone/tool@${SHA_A}`], 'all', null), true);
  assert.equal(allowlistCovers([`actions/checkout@${SHA_A}`], 'local_only', null), false);
  assert.equal(allowlistCovers([`actions/checkout@${SHA_A}`], 'selected', { ...selected, github_owned_allowed: false }), false);
  assert.equal(allowlistCovers([`someone/tool@${SHA_A}`], 'selected', { ...selected, patterns_allowed: ['someone/*'] }), true);
});

test('the drill passes on the committed fixtures', async () => {
  const r = await runDrill(score);
  assert.deepEqual(r.failures, []);
  assert.equal(r.passed, true);
  assert.ok(r.cases >= 90);
});

test('the drill fails when a plant is not caught as planted', async () => {
  const plants = load<Plant[]>('plants.json');
  const wrong = plants.map((p) => (p.setting === 'has_wiki' ? { ...p, also: ['has_issues'] } : p));
  assert.deepEqual((await runDrill(score, { plants: wrong })).failures, ['has_wiki']);
  const stale = plants.map((p) => (p.setting === 'deploy_keys' ? { ...p, changes: [{ path: '/no/such/path', op: 'set' as const, at: ['body'], value: [] }] } : p));
  assert.deepEqual((await runDrill(score, { plants: stale })).failures, ['deploy_keys']);
  assert.ok((await runDrill(score, { plants: plants.filter((p) => p.setting !== 'tag_bypass') })).failures.includes('every_setting_planted'));
});

test('the drill fails when scoring is broken or a clean fixture is not clean', async () => {
  const broken = await runDrill(() => []);
  assert.equal(broken.passed, false);
  assert.ok(broken.failures.includes('clean_drift_0'));
  assert.ok(broken.failures.includes('quiet_is_no_events'));
  const api = load<Api>('clean-api.json');
  applyChange(api, load<WorkflowFacts>('workflows.json'), {}, { path: R, op: 'set', at: ['body', 'has_wiki'], value: true });
  assert.ok((await runDrill(score, { api })).failures.includes('clean_all_match'));
});

test('a snapshot keeps no login, no person, no secret value and no unused name', async () => {
  const api = load<Api>('clean-api.json');
  const canary = 'invented-login-canary';
  (api[`${R}/collaborators?affiliation=all&permission=admin&per_page=100`]!.body as Record<string, unknown>[])[0]!.login = canary;
  (api[`${R}/hooks?per_page=100`]!.body as Record<string, Record<string, unknown>>[])[0]!.config!.url = `https://${canary}.invalid/hook`;
  const budgets = (api['/organizations/Colorado-Startups/settings/billing/budgets?per_page=100']!.body as { budgets: Record<string, unknown>[] }).budgets;
  budgets[0]!.budget_alerting = { will_alert: true, alert_recipients: [canary] };
  budgets[0]!.user = canary;
  budgets[0]!.budget_entity_name = canary;
  (api[`${R}/actions/secrets?per_page=100`]!.body as { secrets: Record<string, unknown>[] }).secrets[0]!.value = canary;
  (api['/orgs/Colorado-Startups']!.body as Record<string, unknown>).billing_email = `${canary}@invalid.example`;
  const branch = api[`${R}/rulesets/101`]!.body as { bypass_actors: Record<string, unknown>[] };
  branch.bypass_actors.push({ actor_id: 424242, actor_type: 'User', bypass_mode: 'always' });
  const snap = await takeSnapshot(fixtureFetcher(api), new Date('2026-11-02T06:00:00Z'), { known: { secrets: [], environments: [] }, claudeEnabled: 'true' });
  const text = JSON.stringify(snap);
  assert.equal(text.includes(canary), false);
  assert.equal(text.includes('424242'), false, 'a person bypassing is recorded by type alone');
  assert.equal(text.includes('CLAUDE_CODE_OAUTH_TOKEN'), false, 'not named by a workflow here, so withheld');
  assert.equal(text.includes('deploy-site'), false);
});

test('an unread setting is never a value, and partial reads keep the totals missing', async () => {
  const api = load<Api>('clean-api.json');
  for (const p of Object.keys(api)) if (p.includes('/actions/') || p.startsWith('/org')) api[p] = { status: 403, body: null };
  const wf = load<WorkflowFacts>('workflows.json');
  const now = '2026-11-02T06:00:00Z';
  const snap = await takeSnapshot(fixtureFetcher(api), new Date(now), { known: wf, claudeEnabled: 'true' });
  const e = loadExpected(EXPECTED);
  const results = evaluate(e, snap, wf, new Date(now));
  assert.equal(results.find((r) => r.id === 'org_two_factor_required')?.status, 'unread');
  assert.equal(results.find((r) => r.id === 'repo_visibility')?.status, 'match');
  const records = score(e, results, advance(emptyLog(LONG_AGO), results, now), { now, sourceUrl: RUN });
  const get = (id: string) => records.find((r) => r.id === id)!;
  assert.equal(get('settings_drift_count').status, 'missing');
  assert.equal(get('stop_budgets_ok').status, 'missing');
  assert.equal(get('drift_fix_hours').status, 'missing');
  assert.equal(get('read_gap_hours').status, 'missing', 'no complete read yet');
});

test('every record the collector writes passes the metric format, with or without a snapshot', async () => {
  const manifest = validateManifest(JSON.parse(readFileSync(path.join(HERE, 'manifest.json'), 'utf8')), 'settings');
  assert.deepEqual(manifest.errors, []);
  assert.deepEqual(manifest.value!.metrics.map((m) => m.id), [...METRIC_IDS]);
  const e = loadExpected(EXPECTED);
  const wf = load<WorkflowFacts>('workflows.json');
  const vars = load<Vars>('vars.json');
  const snap = await takeSnapshot(fixtureFetcher(load<Api>('clean-api.json')), new Date('2026-11-02T06:00:00Z'), { known: wf, claudeEnabled: vars.CLAUDE_ENABLED });
  const run = { now: '2026-11-02T06:00:00Z', sourceUrl: RUN };
  for (const s of [snap, null]) {
    const out = await collect(e, s, wf, emptyLog(LONG_AGO), run);
    assert.deepEqual(validateRecords(out.records, manifest.value!).errors, []);
    assert.deepEqual(out.records.map((r) => r.id), [...METRIC_IDS]);
  }
  const none = await collect(e, null, wf, emptyLog(LONG_AGO), run);
  assert.ok(none.records.filter((r) => r.id !== 'planted_drift_detected').every((r) => r.status === 'missing'));
});

test('the read gap counts the time since the last complete read when this one is partial', () => {
  const e = loadExpected(EXPECTED);
  const log = { ...emptyLog(LONG_AGO), full_reads: ['2026-11-01T06:00:00Z', '2026-11-02T06:00:00Z'] };
  const partial = e.settings.map((s, i) => ({ id: s.id, status: i === 0 ? ('unread' as const) : ('match' as const) }));
  const records = score(e, partial, log, { now: '2026-11-04T18:00:00Z', sourceUrl: RUN });
  assert.equal(records.find((r) => r.id === 'read_gap_hours')?.value, 60);
});

test('the drift log keeps open drifts, drops old fixed ones and starts fresh from a malformed file', () => {
  const now = '2026-11-02T00:00:00Z';
  assert.equal(parseLog({ version: 1 }, now).started_at, now);
  assert.equal(parseLog('nonsense', now).started_at, now);
  let log = advance(emptyLog('2025-12-01T00:00:00Z'), [{ id: 'has_wiki', status: 'drift' }], '2026-01-01T00:00:00Z');
  log = advance(log, [{ id: 'has_wiki', status: 'match' }], '2026-01-02T00:00:00Z');
  assert.equal(log.events[0]?.fix_hours, 24);
  log = advance(log, [{ id: 'has_wiki', status: 'drift' }], '2026-01-03T00:00:00Z');
  assert.equal(log.events[1]?.fixed_at, null);
  log = advance(log, [{ id: 'has_wiki', status: 'unread' }], '2026-06-01T00:00:00Z');
  assert.equal(log.events.length, 1, 'the fixed event aged out; the open one stays');
  assert.equal(log.events[0]?.fixed_at, null);
  assert.equal(log.full_reads.length, 3, 'an unread run is not a complete read');
});

test('the guard fails a loosening with no change entry and passes a tightening', () => {
  const base = fresh();
  assert.deepEqual(uncovered(base, fresh()), []);

  const tighter = fresh();
  tighter.settings.find((s) => s.id === 'stop_budgets')!.expect.value = 5;
  tighter.settings.find((s) => s.id === 'admin_count')!.expect.value = 0;
  tighter.push_ruleset.restricted_file_paths.push('**/*.sqlite');
  tighter.settings.push({ ...tighter.settings[0]!, id: 'new_setting' });
  assert.deepEqual(uncovered(base, tighter), []);

  const loose = fresh();
  loose.settings.find((s) => s.id === 'actions_allowed')!.expect.value = 'all';
  loose.settings.find((s) => s.id === 'actions_patterns_allowed')!.expect.value = ['*'];
  loose.settings.find((s) => s.id === 'stop_budgets')!.expect.value = 3;
  loose.settings.find((s) => s.id === 'tag_ruleset_active')!.gate = false;
  loose.settings = loose.settings.filter((s) => s.id !== 'has_wiki');
  loose.push_ruleset.restricted_file_paths.shift();
  loose.push_ruleset.max_file_size_mb = 50;
  const found = uncovered(base, loose).map((l) => `${l.field}:${l.setting}`).sort();
  assert.deepEqual(found, [
    'expect:actions_allowed',
    'expect:actions_patterns_allowed',
    'expect:stop_budgets',
    'gate:tag_ruleset_active',
    'push_ruleset:max_file_size_mb',
    'push_ruleset:restricted_file_paths',
    'removed:has_wiki',
  ]);

  const signed = fresh();
  signed.settings.find((s) => s.id === 'stop_budgets')!.expect.value = 3;
  const entry: Change = { date: '2026-11-02', setting: 'stop_budgets', field: 'expect', from: { op: 'min', value: 4 }, to: { op: 'min', value: 3 }, reason: 'superseded', issue: 1, signoff_comment: 2 };
  signed.changes.push(entry);
  assert.deepEqual(uncovered(base, signed), []);
  delete entry.signoff_comment;
  assert.deepEqual(uncovered(base, signed), [], 'an entry needs no signoff_comment');
  entry.signoff_comment = 0;
  assert.equal(uncovered(base, signed).length, 1, 'a signoff_comment that is not a comment id does not count');
  delete entry.signoff_comment;
  entry.issue = 0;
  assert.equal(uncovered(base, signed).length, 1, 'an entry without an issue does not count');
  entry.issue = 1;
  entry.reason = '';
  assert.equal(uncovered(base, signed).length, 1, 'an entry without a reason does not count');
});

test('stop budgets count whole products at organization or enterprise scope only', async () => {
  const wf = load<WorkflowFacts>('workflows.json');
  const e = loadExpected(EXPECTED);
  const status = async (budgets: Record<string, unknown>[]) => {
    const api = load<Api>('clean-api.json');
    api['/organizations/Colorado-Startups/settings/billing/budgets?per_page=100'] = { status: 200, body: { total_count: budgets.length, has_next_page: false, budgets } };
    const snap = await takeSnapshot(fixtureFetcher(api), new Date(LONG_AGO), { known: wf, claudeEnabled: 'true' });
    const r = evaluate(e, snap, wf, new Date(LONG_AGO));
    return { stops: r.find((x) => x.id === 'stop_budgets')?.status, actions: r.find((x) => x.id === 'stop_budget_actions')?.status };
  };
  const b = (sku: string, type = 'ProductPricing', scope = 'organization') => ({ budget_type: type, budget_product_sku: sku, budget_scope: scope, budget_amount: 0, prevent_further_usage: true });
  assert.deepEqual(await status([b('actions'), b('packages'), b('codespaces'), b('git_lfs', 'ProductPricing', 'enterprise')]), { stops: 'match', actions: 'match' });
  assert.deepEqual(await status([b('actions'), b('actions_linux', 'SkuPricing'), b('actions_macos', 'SkuPricing'), b('actions_windows', 'SkuPricing')]), { stops: 'drift', actions: 'match' });
  assert.deepEqual(await status([b('actions', 'ProductPricing', 'repository'), b('packages'), b('codespaces'), b('git_lfs')]), { stops: 'drift', actions: 'drift' });
});

test('no Pages site reads as build type none, and the review variable reads as GitHub compares it', async () => {
  const wf = load<WorkflowFacts>('workflows.json');
  const e = loadExpected(EXPECTED);
  const api = load<Api>('clean-api.json');
  api[`${R}/pages`] = { status: 404, body: null };
  applyChange(api, wf, {}, { path: R, op: 'set', at: ['body', 'has_pages'], value: false });
  const snap = await takeSnapshot(fixtureFetcher(api), new Date(LONG_AGO), { known: wf, claudeEnabled: 'True' });
  const r = evaluate(e, snap, wf, new Date(LONG_AGO));
  assert.equal(r.find((x) => x.id === 'pages_build_type')?.status, 'drift');
  assert.equal(r.find((x) => x.id === 'claude_review_enabled')?.status, 'match');
  const refused = load<Api>('clean-api.json');
  refused[`${R}/pages`] = { status: 404, body: null };
  const snap2 = await takeSnapshot(fixtureFetcher(refused), new Date(LONG_AGO), { known: wf, claudeEnabled: 'false' });
  const r2 = evaluate(e, snap2, wf, new Date(LONG_AGO));
  assert.equal(r2.find((x) => x.id === 'pages_build_type')?.status, 'unread', 'a 404 while the repository says it has a site may be a refused read');
  assert.equal(r2.find((x) => x.id === 'claude_review_enabled')?.status, 'drift');
});

test('Pages is read with the built-in token when the job gives one, so the key needs no Pages permission', async () => {
  const api = load<Api>('clean-api.json');
  const keyApi = { ...api, [`${R}/pages`]: { status: 403, body: null } };
  const wf = load<WorkflowFacts>('workflows.json');
  const e = loadExpected(EXPECTED);
  const withBuiltin = await takeSnapshot(fixtureFetcher(keyApi), new Date(LONG_AGO), { known: wf, claudeEnabled: 'true', builtin: fixtureFetcher(api) });
  assert.equal(evaluate(e, withBuiltin, wf, new Date(LONG_AGO)).find((x) => x.id === 'pages_build_type')?.status, 'match');
  const keyOnly = await takeSnapshot(fixtureFetcher(keyApi), new Date(LONG_AGO), { known: wf, claudeEnabled: 'true' });
  assert.equal(evaluate(e, keyOnly, wf, new Date(LONG_AGO)).find((x) => x.id === 'pages_build_type')?.status, 'unread');
});

test('the merge settings come from one GraphQL query; a refused query leaves all seven unread, never false', async () => {
  const api = load<Api>('clean-api.json');
  const wf = load<WorkflowFacts>('workflows.json');
  const e = loadExpected(EXPECTED);
  const merge = Object.keys(MERGE_FIELDS);
  const queries: (string | undefined)[] = [];
  const spy: Fetcher = async (p, query) => {
    if (p === GRAPHQL) queries.push(query);
    return fixtureFetcher(api)(p, query);
  };
  const clean = evaluate(e, await takeSnapshot(spy, new Date(LONG_AGO), { known: wf, claudeEnabled: 'true' }), wf, new Date(LONG_AGO));
  assert.deepEqual(queries, [MERGE_QUERY]);
  assert.doesNotMatch(MERGE_QUERY, /mutation/);
  for (const id of merge) assert.equal(clean.find((r) => r.id === id)?.status, 'match', id);
  const refused = { ...api, [GRAPHQL]: { status: 200, body: { data: null, errors: [{ type: 'FORBIDDEN' }] } } };
  const results = evaluate(e, await takeSnapshot(fixtureFetcher(refused), new Date(LONG_AGO), { known: wf, claudeEnabled: 'true' }), wf, new Date(LONG_AGO));
  for (const id of merge) assert.equal(results.find((r) => r.id === id)?.status, 'unread', id);
});
