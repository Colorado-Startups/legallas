// SPDX-License-Identifier: Apache-2.0
// The metric format's rules, on invented metrics only. Each row breaks one rule and names its error, so removing any
// guard fails a row.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DIRECTIONS, LENSES, REQUIRED_LENSES, STAGES, STATUSES, type Manifest, type MetricDef, type MetricRecord } from './format.ts';
import { REPO } from './pages.ts';
import { isPublicUrl, isSourceUrl, isTime, joinMetrics, validateHistoryLine, validateIdeal, validateManifest, validateRecords } from './validate.ts';

const BASE = `https://github.com/Colorado-Startups/${REPO}`;
const json = (name: string): unknown => JSON.parse(readFileSync(new URL(`./example/${name}`, import.meta.url), 'utf8').replaceAll('Colorado-Startups/legallas/', `Colorado-Startups/${REPO}/`));
const def = (id: string, more: Record<string, unknown> = {}): MetricDef => ({ id, lens: 'quality', unit: 'percent', direction: 'higher', floor: 0, goal: 90, weight: 1, max_age_hours: 48, min_samples: 1, goal_source: 'https://example.com/goal', ...more } as MetricDef);
const speed = (id: string, more: Record<string, unknown> = {}) => def(id, { lens: 'speed', unit: 'ms', direction: 'lower', floor: 1000, goal: 100, ...more });
const use = (id: string, more: Record<string, unknown> = {}) => def(id, { lens: 'consumption', unit: 'tokens', direction: 'lower', floor: 1000, goal: 200, ...more });
const list = (...extra: MetricDef[]) => [def('a'), def('b'), def('c'), speed('s1'), speed('s2'), ...extra, use('u1')];
const { goal_source: _source, ...NO_SOURCE } = def('x');
const manifest = (more: Record<string, unknown> = {}): Manifest => ({ page: 'code', signoff_comment: 9, metrics: list(), changes: [], ...more } as Manifest);
const RUN = `${BASE}/actions/runs/42`;
const ISSUE = `${BASE}/issues/1`;
const record = (id: string, more: Record<string, unknown> = {}): MetricRecord => ({ id, page: 'code', value: 50, status: 'ok', stage: 'lab', measured_at: '2026-11-01T00:00:00Z', source_url: RUN, sample_size: 3, ...more } as MetricRecord);

const grouped = (metric: MetricDef, group: string) => ({ ...metric, group });
const GROUP_LIST = [grouped(def('a'), 'one'), grouped(def('b'), 'one'), grouped(def('c'), 'two'), grouped(speed('s1'), 'one'), grouped(speed('s2'), 'two'), grouped(use('u1'), 'one'), grouped(use('u2'), 'two')];
const TWO_GROUPS = [{ id: 'one', weight: 40 }, { id: 'two', weight: 60 }];
const CHANGE = { date: '2026-11-01', metric: 'a', field: 'goal', from: 90, to: 80, reason: 'wrong_basis', issue: 7, signoff_comment: 99 };
const { signoff_comment: _comment, ...NO_COMMENT } = CHANGE;
const { reason: _reason, ...NO_REASON } = CHANGE;
const { issue: _issue, ...NO_ISSUE } = CHANGE;
const metricWith = (more: Record<string, unknown>) => manifest({ metrics: list(def('x', more)) });
const changeWith = (more: Record<string, unknown>) => manifest({ changes: [{ ...CHANGE, ...more }] });
const groupsWith = (groups: unknown) => manifest({ metrics: GROUP_LIST, groups });

const BAD_MANIFESTS: [unknown, RegExp][] = [
  [null, /manifest: not an object/],
  [{ ...manifest(), title: 'x' }, /manifest: unknown field/],
  [manifest({ page: 'blog' }), /page is not in the closed list/],
  [manifest({ signoff_comment: true }), /signoff_comment must be a comment id/],
  [manifest({ metrics: 'x' }), /metrics must be a list/],
  [manifest({ metrics: ['x'] }), /metrics\[0\]: not an object/],
  [manifest({ changes: 'x' }), /changes must be a list/],
  [metricWith({ note: 'x' }), /metrics\[5\]: unknown field/],
  [metricWith({ id: 'Has Spaces' }), /id is not lowercase/],
  [metricWith({ id: 'dot.' }), /id is not lowercase/],
  [metricWith({ id: `a${'b'.repeat(120)}` }), /id is not lowercase/],
  [metricWith({ lens: 'style' }), /lens is not in the closed list/],
  [metricWith({ direction: 'up' }), /direction is not in the closed list/],
  [metricWith({ unit: 'parsecs' }), /unit is not in the closed list/],
  [metricWith({ floor: 'x' }), /floor is not a valid percent/],
  [metricWith({ floor: -1 }), /floor is not a valid percent/],
  [metricWith({ goal: 150 }), /goal is not a valid percent/],
  [metricWith({ unit: 'pass', goal: 2 }), /goal is not a valid pass/],
  [metricWith({ floor: 90, goal: 40 }), /goal must be past floor/],
  [metricWith({ floor: 50, goal: 50 }), /goal must be past floor/],
  [manifest({ metrics: list(speed('x', { floor: 10, goal: 100 })) }), /goal must be past floor/],
  [metricWith({ weight: 0 }), /weight must be a whole number/],
  [metricWith({ weight: '1' }), /weight must be a whole number/],
  [metricWith({ weight: 1e-9 }), /weight must be a whole number/],
  [metricWith({ weight: 101 }), /weight must be a whole number/],
  [metricWith({ critical: true }), /unknown field/],
  [metricWith({ max_age_hours: 0 }), /max_age_hours/],
  [metricWith({ max_age_hours: 1.5 }), /max_age_hours/],
  [metricWith({ max_age_hours: 24 * 90 + 1 }), /max_age_hours/],
  [metricWith({ min_samples: 0 }), /min_samples/],
  [metricWith({ coverage_metric: 'Not An Id' }), /coverage_metric is not an id/],
  [metricWith({ group: 'Not An Id' }), /group is not an id/],
  [manifest({ metrics: list(def('a')) }), /a repeats/],
  [manifest({ metrics: [speed('s1')] }), /at least one quality and one speed/],
  [manifest({ metrics: [def('a')] }), /at least one quality and one speed/],
  [manifest({ metrics: list(speed('t', { coverage_metric: 'nope' })) }), /not listed/],
  [manifest({ metrics: list(speed('t', { coverage_metric: 't' })) }), /own coverage metric/],
  [manifest({ metrics: list(speed('t', { coverage_metric: 'u' }), speed('u', { coverage_metric: 'a' })) }), /itself read no_events/],
  [manifest({ metrics: list(def('drill', { max_age_hours: 745 }), speed('t', { coverage_metric: 'drill' })) }), /may be over 744 hours old/],
  [groupsWith('x'), /at least two/],
  [groupsWith([{ id: 'one', weight: 100 }]), /at least two/],
  [groupsWith(['x', 'y']), /groups\[0\]: not an object/],
  [groupsWith([null, null]), /groups\[0\]: not an object/],
  [groupsWith([{ ...TWO_GROUPS[0], note: 'x' }, TWO_GROUPS[1]]), /groups\[0\]: unknown field/],
  [groupsWith([{ id: 'Not An Id', weight: 40 }, TWO_GROUPS[1]]), /groups\[0\]: id is not an id/],
  [groupsWith([TWO_GROUPS[0], { id: 'one', weight: 60 }]), /groups\[1\]: id repeats/],
  [groupsWith([{ id: 'one', weight: 1.5 }, TWO_GROUPS[1]]), /weight must be a whole number/],
  [groupsWith([{ id: 'one', weight: 40 }, { id: 'two', weight: 50 }]), /add up to 100/],
  [manifest({ groups: TWO_GROUPS }), /needs a listed group/],
  [metricWith({ group: 'one' }), /the page has none/],
  [groupsWith([...TWO_GROUPS.slice(0, 1), { id: 'three', weight: 60 }]), /three needs at least one quality and one speed/],
  [manifest({ metrics: [def('a'), speed('s1')] }), /metrics: needs at least one quality and one speed metric, and one consumption metric/],
  [manifest({ metrics: GROUP_LIST.filter((m) => m.id !== 'u2'), groups: TWO_GROUPS }), /groups: two needs at least one quality and one speed metric, and one consumption metric/],
  [manifest({ metrics: list(NO_SOURCE as MetricDef) }), /metrics: x needs a goal_source/],
  [manifest({ changes: ['x'] }), /changes\[0\]: not an object/],
  [changeWith({ note: 'x' }), /changes\[0\]: unknown field/],
  [changeWith({ date: '2026-13-01' }), /date is not a calendar date/],
  [changeWith({ metric: 'Not An Id' }), /metric is not an id/],
  [changeWith({ field: 'title' }), /field is not in the closed list/],
  [changeWith({ reason: 'because' }), /reason is not in the closed list/],
  [changeWith({ issue: 0 }), /issue must be a number/],
  [changeWith({ signoff_comment: 0 }), /signoff_comment must be a comment id/],
  [changeWith({ from: 'free text here' }), /from must be/],
  [changeWith({ to: { x: 1 } }), /to must be/],
  [changeWith({ field: 'added', from: null, to: 'zz', metric: 'zz', reason: 'added_toward_ideal' }), /an added metric goes from null to its own id, and is on the list/],
  [changeWith({ field: 'added', from: 90, to: 'a', reason: 'added_toward_ideal' }), /an added metric goes from null/],
  [changeWith({ field: 'added', from: null, to: 'b', reason: 'added_toward_ideal' }), /an added metric goes from null/],
  [manifest({ changes: [NO_REASON] }), /reason is not in the closed list/],
  [manifest({ changes: [NO_ISSUE] }), /issue must be a number/],
];

test('a metric the log added may leave the list once a later entry retires it, never before', () => {
  const added = { ...CHANGE, metric: 'zz', field: 'added', from: null, to: 'zz', reason: 'added_toward_ideal' };
  const retired = { ...CHANGE, metric: 'zz', field: 'retired', from: null, to: null, reason: 'superseded' };
  assert.deepEqual(validateManifest(manifest({ changes: [added, retired] })).errors, []);
  assert.match(validateManifest(manifest({ changes: [retired, added] })).errors.join(), /changes\[1\]: an added metric goes from null to its own id, and is on the list/);
});

test('each broken manifest fails with its own error', () => {
  for (const [input, expected] of BAD_MANIFESTS) {
    const errors = validateManifest(input).errors.join('\n');
    assert.match(errors, expected);
  }
});

test('good manifests pass: plain, one metric of each, a draft with none, dotted ids, grouped, with coverage and with a change, with or without its signoff_comment', () => {
  for (const good of [manifest(), manifest({ metrics: [def('a'), speed('s1'), use('u1')] }), { page: 'code', metrics: [], changes: [] }, { page: 'code', metrics: [def('a')], changes: [] }, { page: 'code', metrics: [NO_SOURCE], changes: [] }, { page: 'code', metrics: [grouped(def('a'), 'one')], groups: TWO_GROUPS, changes: [] }, manifest({ metrics: [def('forming.founder.find.search_p95.mac.live'), speed('s1'), use('u1')] }), groupsWith(TWO_GROUPS), manifest({ metrics: list(def('drill', { max_age_hours: 744 }), speed('t', { coverage_metric: 'drill' })) }), manifest({ changes: [CHANGE] }), manifest({ changes: [NO_COMMENT] }), manifest({ changes: [{ ...CHANGE, field: 'added', from: null, to: 'a', reason: 'added_toward_ideal' }] }), manifest({ changes: [{ ...NO_COMMENT, field: 'added', from: null, to: 'a', reason: 'added_toward_ideal' }] })]) {
    assert.deepEqual(validateManifest(good).errors, []);
  }
  assert.match(validateManifest(manifest(), 'issues').errors.join(), /does not match the folder/);
});

const RECORD_LIST = manifest({ metrics: list(speed('t', { coverage_metric: 'a' }), speed('z', { unit: 'count', floor: 10, goal: 0 }), def('g', { unit: 'pass', floor: 0, goal: 1 })) });
const CLEAN = record('t', { status: 'no_events', value: null, sample_size: 0 });
const { value: _dropped, ...NO_VALUE } = record('a');

const BAD_RECORDS: [unknown, RegExp][] = [
  ['x', /records\[0\]: not an object/],
  [{ ...record('a'), title: 'x' }, /unknown field/],
  [NO_VALUE, /value is required/],
  [record('nope'), /id is not in the manifest/],
  [record('a', { page: 'issues' }), /page does not match/],
  [record('a', { status: 'broken' }), /status is not in the closed list/],
  [record('a', { stage: 'synthetic' }), /stage is not in the closed list/],
  [record('a', { measured_at: 'yesterday' }), /measured_at is not a UTC time/],
  [record('a', { measured_at: '2099-01-01T00:00:00Z' }), /measured_at is in the future/],
  [record('a', { source_url: 'https://example.com/' }), /source_url is not an allowed link/],
  [record('a', { sample_size: 1.5 }), /sample_size must be a whole number/],
  [record('a', { sample_size: -1 }), /sample_size must be a whole number/],
  [record('a', { measured_at: null }), /ok needs measured_at/],
  [record('a', { source_url: null }), /ok needs a run link/],
  [record('a', { source_url: ISSUE }), /ok needs a run link/],
  [record('a', { sample_size: null }), /ok needs sample_size/],
  [record('a', { value: null }), /ok needs a number/],
  [record('a', { value: '0' }), /ok needs a number/],
  [record('a', { value: 101 }), /value is not a valid percent/],
  [record('a', { status: 'stale', value: '50' }), /value is not a valid percent/],
  [record('a', { status: 'stale', value: 101 }), /value is not a valid percent/],
  [record('a', { status: 'stale', measured_at: null }), /stale needs measured_at/],
  [record('a', { status: 'missing', value: 0 }), /must have a null value/],
  [{ ...CLEAN, value: 0 }, /must have a null value/],
  [{ ...CLEAN, measured_at: null }, /no_events needs measured_at/],
  [{ ...CLEAN, source_url: null }, /no_events needs a run link/],
  [{ ...CLEAN, source_url: ISSUE }, /no_events needs a run link/],
  [{ ...CLEAN, id: 's1' }, /needs a coverage metric/],
  [{ ...CLEAN, sample_size: 2 }, /sample_size 0/],
];

test('each broken record is dropped with its own error', () => {
  for (const [input, expected] of BAD_RECORDS) {
    const { records, errors } = validateRecords([input], RECORD_LIST);
    assert.match(errors.join('\n'), expected);
    assert.deepEqual(records, []);
  }
  assert.match(validateRecords({}, RECORD_LIST).errors.join(), /must be a list/);
  assert.match(validateRecords([record('a'), record('a')], RECORD_LIST).errors.join(), /a repeats/);
});

test('good records pass, and a bad one leaves the good ones', () => {
  const missing = record('a', { status: 'missing', value: null, measured_at: null, source_url: null, sample_size: null });
  for (const good of [
    record('a'),
    missing,
    record('a', { status: 'stale', value: null, source_url: null, sample_size: null }),
    CLEAN,
    record('a', { status: 'stale', source_url: ISSUE }),
    record('z', { value: 0 }),
    record('g', { value: 1 }),
  ]) {
    assert.deepEqual(validateRecords([good], RECORD_LIST).errors, []);
  }
  assert.deepEqual(validateRecords([record('a'), record('b', { value: 500 })], RECORD_LIST).records.map((r) => r.id), ['a']);
  const { signoff_comment: _signoff, ...draft } = manifest();
  assert.deepEqual(validateRecords([record('a')], draft), { records: [], errors: [] });
  assert.match(validateRecords([{ ...record('a'), title: 'x' }], draft).errors.join(), /unknown field/);
  assert.match(validateRecords('not a list', draft).errors.join(), /must be a list/);
  const justAhead = new Date(Date.parse('2026-11-01T00:00:00Z') - 4 * 60_000);
  assert.deepEqual(validateRecords([record('a')], RECORD_LIST, justAhead).errors, []);
});

test('errors never repeat the rejected value or an odd key', () => {
  const secret = 'do_not_log_this';
  for (const errors of [
    validateManifest(manifest({ page: secret })).errors,
    validateManifest({ ...manifest(), [secret]: 1 }).errors,
    validateManifest(manifest({ metrics: list(def('x', { lens: secret })) })).errors,
    validateManifest(groupsWith([{ id: 'do not log this do_not_log_this', weight: 40 }, TWO_GROUPS[1]])).errors,
    validateRecords([record(secret)], RECORD_LIST).errors,
    validateRecords([{ ...record('a'), [secret]: 1 }], RECORD_LIST).errors,
    validateRecords([record('a', { source_url: secret })], RECORD_LIST).errors,
    validateRecords([record('a', { value: secret })], RECORD_LIST).errors,
  ]) {
    assert.ok(errors.length > 0);
    assert.ok(!errors.join().includes(secret));
  }
});

test('source links are this repo only: issue, pull request, run, commit or a known settings page, with no query', () => {
  for (const good of [`${BASE}/issues/1`, `${BASE}/pull/2`, RUN, `${RUN}/job/4`, `${BASE}/commit/${'a'.repeat(40)}`, `${BASE}/settings`, `${BASE}/settings/branches`, `${BASE}/settings/security_analysis`]) {
    assert.ok(isSourceUrl(good), good);
  }
  for (const bad of [
    `${ISSUE}?x=1`,
    `${ISSUE}#issuecomment-5`,
    `${BASE}/blob/main/README.md`,
    `${BASE}/commit/abc`,
    `${BASE}/settings/../../other`,
    `${BASE}/settings/${'any-words-at-all-'.repeat(200)}x`,
    `${BASE}/settings/branches/more`,
    'https://github.com/Colorado-Startups/other/issues/1',
    `https://github.com/someone/${REPO}/issues/1`,
    `https://example.com/Colorado-Startups/${REPO}/issues/1`,
    `http://github.com/Colorado-Startups/${REPO}/issues/1`,
    `${ISSUE}\n`,
    7,
    null,
  ]) {
    assert.equal(isSourceUrl(bad), false, String(bad).slice(0, 80));
  }
});

test('a time is a real UTC instant', () => {
  assert.ok(isTime('2026-11-01T06:17:00Z'));
  assert.ok(isTime('2026-11-01T06:17:00.250Z'));
  for (const bad of ['2026-11-01', '2026-11-01T06:17:00', '2026-11-01T06:17:00+01:00', '2026-02-31T00:00:00Z', '2026-13-01T00:00:00Z', 5, null]) {
    assert.equal(isTime(bad), false, String(bad));
  }
});

test('the closed lists stay closed, and the example files pass', () => {
  assert.deepEqual([...LENSES], ['quality', 'speed', 'consumption']);
  assert.deepEqual([...REQUIRED_LENSES], ['quality', 'speed', 'consumption']);
  assert.deepEqual([...DIRECTIONS], ['higher', 'lower']);
  assert.deepEqual([...STATUSES], ['ok', 'stale', 'missing', 'no_events']);
  assert.deepEqual([...STAGES], ['lab', 'live']);
  const checked = validateManifest(json('manifest.json'), 'code');
  assert.deepEqual(checked.errors, []);
  assert.ok(checked.value);
  const { records, errors } = validateRecords(json('metrics.json'), checked.value);
  assert.deepEqual(errors, []);
  assert.equal(records.length, checked.value.metrics.length);
});

test('joining lists every metric once, and one with no record reads as missing', () => {
  const joined = joinMetrics(manifest(), [record('b', { value: 70 })]);
  assert.deepEqual(joined.map((x) => x.id), ['a', 'b', 'c', 's1', 's2', 'u1']);
  assert.deepEqual([joined[0]?.status, joined[0]?.value, joined[0]?.page], ['missing', null, 'code']);
  assert.deepEqual([joined[1]?.value, joined[1]?.goal], [70, 90]);
});

test('a history line holds only whole scores, a time and a closed page', () => {
  const line = { at: '2026-11-01T06:17:00Z', page: 'code', quality: 80, speed: 60, total: 73 };
  assert.deepEqual(validateHistoryLine(line).errors, []);
  assert.deepEqual(validateHistoryLine({ ...line, consumption: 40 }).errors, [], 'a line may carry consumption, and one written before it still passes');
  assert.deepEqual(validateHistoryLine({ ...line, capped: false }).errors, [], 'a line written before the cap was removed still passes');
  const bad: [unknown, RegExp][] = [
    ['x', /not an object/],
    [{ ...line, note: 'x' }, /unknown field/],
    [{ ...line, at: 'x' }, /at is not a UTC time/],
    [{ ...line, page: 'home' }, /page is not in the closed list/],
    [{ ...line, quality: 80.5 }, /quality must be/],
    [{ ...line, speed: -1 }, /speed must be/],
    [{ ...line, total: 101 }, /total must be/],
    [{ ...line, consumption: 40.5 }, /consumption must be/],
    [{ ...line, consumption: null }, /consumption must be/],
  ];
  for (const [input, expected] of bad) assert.match(validateHistoryLine(input).errors.join(), expected);
});

const IDEAL = { ideal: 'Every change ships small, reviewed and green.', sources: [{ title: 'A guide', url: 'https://example.com/guide', date: '2026-10-01' }] };
const NOW = new Date('2026-11-04T12:00:00Z');
const idealWith = (more: Record<string, unknown>) => ({ ...IDEAL, ...more });
const sourceWith = (more: Record<string, unknown>) => idealWith({ sources: [{ ...IDEAL.sources[0], ...more }] });

test('a goal source is a public https link', () => {
  assert.deepEqual(validateManifest(metricWith({ goal_source: 'https://web.dev/articles/ttfb' })).errors, []);
  assert.deepEqual(validateManifest(metricWith({ goal_source: 'https://docs.github.com/en/actions#limits' })).errors, []);
  for (const bad of [
    'http://web.dev/', 'https://user:pw@web.dev/', 'https://localhost/x', 'https://web.dev/a b', 'ftp://web.dev/', 7, `https://web.dev/${'a'.repeat(300)}`,
    'javascript:alert(1)', 'data:text/html,x', 'https://xn--pple-43d.com/', 'https://\u0430pple.com/', 'https://web.dev:8443/', 'https://we%62.dev/',
    'https://web.dev/?q=<script>', 'https://web.dev/#`{}|^', "https://web.dev/'x'", 'https://-web.dev/', 'https://web.dev./x',
  ]) {
    assert.match(validateManifest(metricWith({ goal_source: bad })).errors.join(), /goal_source is not a public https link/, String(bad));
    assert.equal(isPublicUrl(bad), false);
  }
});

test("an ideal is short plain words with dated public sources, in Git Crafter's shape", () => {
  assert.deepEqual(validateIdeal(IDEAL, NOW).errors, []);
  assert.deepEqual(validateIdeal(idealWith({ quality: 'Every check is right.', speed: 'Fast.', consumption: 'Cheap.' }), NOW).errors, []);
  const example = JSON.parse(readFileSync(new URL('./example/ideal.json', import.meta.url), 'utf8'));
  assert.deepEqual(validateIdeal(example, NOW).errors, []);
  const bad: [unknown, RegExp][] = [
    [null, /ideal: not an object/],
    [idealWith({ note: 'x' }), /ideal: unknown field/],
    [idealWith({ ideal: '' }), /ideal: must be plain words/],
    [idealWith({ ideal: '   ' }), /ideal: must be plain words/],
    [idealWith({ ideal: ' padded' }), /ideal: must be plain words/],
    [idealWith({ ideal: '&lt;script&gt;' }), /ideal: must be plain words/],
    [idealWith({ ideal: Array.from({ length: 26 }, (_, i) => 'abcdefghijklmnopqrstuvwxyz'[i]).join(',') }), /ideal: must be at most 25 words/],
    [sourceWith({ title: '123' }), /sources\[0\]: title: must be plain words/],
    [idealWith({ ideal: 'Has <b>markup</b>' }), /ideal: must be plain words/],
    [idealWith({ ideal: 'Has a dash \u2014 here' }), /ideal: must be plain words/],
    [idealWith({ ideal: 'Says "quoted"' }), /ideal: must be plain words/],
    [idealWith({ ideal: 'word '.repeat(26).trim() }), /ideal: must be at most 25 words/],
    [idealWith({ ideal: 'a'.repeat(301) }), /ideal: must be at most 300 characters/],
    [idealWith({ speed: 'x'.repeat(161) }), /ideal: speed: must be at most 160 characters/],
    [idealWith({ consumption: 'word '.repeat(26).trim() }), /ideal: consumption: must be at most 25 words/],
    [idealWith({ quality: 3 }), /ideal: quality: must be plain words/],
    [idealWith({ sources: [] }), /sources must list 1 to 5 documents/],
    [idealWith({ sources: Array(6).fill(IDEAL.sources[0]) }), /sources must list 1 to 5 documents/],
    [idealWith({ sources: 'x' }), /sources must list 1 to 5 documents/],
    [idealWith({ sources: ['x'] }), /sources\[0\]: not an object/],
    [sourceWith({ extra: 1 }), /sources\[0\]: unknown field/],
    [sourceWith({ title: '<a>' }), /sources\[0\]: title: must be plain words/],
    [sourceWith({ title: ' padded' }), /sources\[0\]: title: must be plain words/],
    [sourceWith({ title: 'See https://example.com/x' }), /sources\[0\]: title: must be plain words/],
    [idealWith({ ideal: 'Read https://example.com first' }), /ideal: must be plain words/],
    [idealWith({ quality: 'Like http://example.com' }), /ideal: quality: must be plain words/],
    [sourceWith({ title: 'ab '.repeat(26).trim() }), /sources\[0\]: title: must be at most 25 words/],
    [sourceWith({ title: 'x'.repeat(121) }), /sources\[0\]: title: must be at most 120 characters/],
    [sourceWith({ url: 'http://example.com/' }), /sources\[0\]: url is not a public https link/],
    [sourceWith({ date: '2026-02-31' }), /sources\[0\]: date is not a calendar date/],
    [sourceWith({ date: '2026-11-05' }), /sources\[0\]: date is after today/],
  ];
  for (const [input, error] of bad) assert.match(validateIdeal(input, NOW).errors.join(), error, JSON.stringify(input));
});

test("a Git Crafter ideal file's shape passes; its long template ideal fails only the 25-word rule", () => {
  // Git Crafter quality/ideals/code.json, 2026-11-04, as published: its ideal runs past 25 words.
  const template = {
    ideal: 'Code as small and plain as the job allows: short files and functions, no dead or copied code, each file and shared function saying why it exists, and lean server and page bundles.',
    sources: [{ title: 'Cloudflare Workers limits', url: 'https://developers.cloudflare.com/workers/platform/limits/', date: '2026-10-29' }],
    quality: 'No function past complexity 10 or 50 lines, no file past 300, nothing unused or copied, every file opening with its purpose.',
    speed: 'Requests served well inside a good time to first byte, and a bundle that builds in seconds.',
    consumption: "Server CPU per request under the free plan's limit, and page scripts inside a 307 KiB budget.",
  };
  assert.deepEqual(validateIdeal(template, NOW).errors, ['ideal: must be at most 25 words']);
});

test('an ideal error never repeats the rejected text', () => {
  const secret = 'ZZSECRETZZ <script>';
  const errors = validateIdeal(idealWith({ ideal: secret, quality: secret, sources: [{ title: secret, url: secret, date: secret }] }), NOW).errors.join();
  assert.doesNotMatch(errors, /ZZSECRETZZ/);
});

test("an ideal line's words are counted as the publish guard counts them", async () => {
  const { countWords } = await import('../core/guard.ts');
  for (const text of ['Every change ships small.', 'a,b,c,d,e', 'well-known pre-built', `x ${'a'.repeat(41)}`]) {
    const fits = countWords(text) <= 25;
    assert.equal(validateIdeal(idealWith({ ideal: text }), NOW).errors.length === 0, fits, text);
  }
  const twentySix = Array.from({ length: 26 }, () => 'w').join('-');
  assert.equal(countWords(twentySix), 26);
  assert.match(validateIdeal(idealWith({ ideal: twentySix }), NOW).errors.join(), /at most 25 words/);
});

test('a consumption metric is a metric like any other, but a signed-off list still needs quality and speed', () => {
  assert.deepEqual(validateManifest(manifest({ metrics: list(use('tokens')) }), 'code').errors, []);
  assert.match(validateManifest(manifest({ metrics: [def('a'), use('tokens')] }), 'code').errors.join(), /needs at least one quality and one speed metric/);
  assert.match(validateManifest(manifest({ metrics: [speed('s1'), use('tokens')] }), 'code').errors.join(), /needs at least one quality and one speed metric/);
  assert.match(validateManifest(manifest({ metrics: list(def('x', { lens: 'Consumption' })) }), 'code').errors.join(), /lens is not in the closed list/);
});

test("the validator counts an ideal line's words with the guard's own counter", async () => {
  const { wordsIn } = await import('./words.ts');
  const guard = readFileSync(new URL('../core/guard.ts', import.meta.url), 'utf8');
  assert.match(guard, /import \{ wordsIn \} from '\.\.\/contract\/words\.ts';/);
  assert.doesNotMatch(guard, /const wordsIn\b/);
  assert.equal(wordsIn(`a ${'b'.repeat(41)} 12 -`), 4);
});
