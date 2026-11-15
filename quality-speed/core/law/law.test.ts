// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { validateManifest, validateRecords } from '../../contract/validate.ts';
import { laneMinutes } from '../lane/minutes.ts';
import { lawPages, newestReport, records } from './collect.ts';
import { lawCharts, readView, roadFixes } from './page.ts';
import {
  answerRuns,
  assess,
  CARRY_DAYS,
  carryRuns,
  evalSpend,
  field,
  freshDate,
  freshUnit,
  lawLibrary,
  lookupTokens,
  numerals,
  parseNeeds,
  questionsPassed,
  readHoldings,
  ROOT,
  searchP95,
  tables,
  TOOL_PASSAGES,
  toolAnswer,
  unitRights,
  unitVerified,
  type Holdings,
  type LawPassage,
  type Need,
  type Source,
} from './law.ts';

const NOW = new Date('2026-11-02T12:00:00Z');

function source(ref: string, over: Partial<Source> = {}): Source {
  const unit = ref.startsWith('unit:');
  return { ref, checked: '2026-11-01', verified: unit ? true : null, fresh: true, rights: unit ? true : null, text: '', ...over };
}

const holdings: Holdings = {
  paths: ['startup-forms', 'startup-raises', 'fights'],
  hosts: new Set(['olls.info']),
  now: NOW,
  sources: new Map(
    [
      source('unit:a', { text: 'form d within 15 days after the first sale' }),
      source('unit:b', { verified: false, rights: false }),
      source('template:x/y', { fresh: false, text: 'fee of $50' }),
      source('item:c.d', { text: 'file form d within 15 days after the first sale' }),
    ].map((s) => [s.ref, s]),
  ),
};

const need = (id: string, covered_by: string[], over: Partial<Need> = {}): Need => ({
  id,
  path: 'startup-raises',
  need: 'Something a founder needs',
  source: 'https://www.sec.gov/page',
  checked: '2026-11-02',
  covered_by,
  ...over,
});

test('coverage needs every reference to resolve, and an empty list is a gap', () => {
  const { values, rows, byPath } = assess({ needs: [need('one', ['unit:a', 'item:c.d']), need('two', ['unit:a', 'unit:gone']), need('three', [], { path: 'fights' })] }, holdings);
  assert.equal(values.coverage!.value, 33.33);
  assert.deepEqual(rows[1]!.unresolved, ['unit:gone']);
  assert.deepEqual(byPath, [
    { path: 'startup-raises', held: 1, listed: 2 },
    { path: 'fights', held: 0, listed: 1 },
  ]);
});

test('a need is held only when its own source was checked within a year', () => {
  const needs = [need('now', ['unit:a']), need('old', ['unit:a'], { checked: '2025-11-01' }), need('never', ['unit:a'], { checked: null }), need('ahead', ['unit:a'], { checked: '2026-12-01' })];
  const { values, rows, fixes } = assess({ needs }, holdings);
  assert.deepEqual(rows.map((r) => r.covered), [true, false, false, false]);
  assert.deepEqual(values.coverage, { value: 25, samples: 4 });
  assert.deepEqual(fixes.map((f) => `${f.metric} ${f.what}`), ['coverage old source', 'coverage never source', 'coverage ahead source']);
});

test('each source counts once, and a metric that applies to nothing reads missing', () => {
  const { values } = assess({ needs: [need('one', ['unit:a', 'unit:b']), need('two', ['unit:a'])] }, holdings);
  assert.deepEqual(values.verified, { value: 50, samples: 2 });
  assert.deepEqual(values.rights, { value: 50, samples: 2 });
  assert.deepEqual(values.flags, { value: null, samples: 0 });
});

test('a flag is found only in a template or checklist item the need relies on, whatever the case and spacing', () => {
  const deadline = { kind: 'deadline' as const, text: 'Within 15  days after the first sale' };
  const fee = { kind: 'fee' as const, text: 'fee of $50' };
  const needs = [need('plan', ['unit:a'], { flags: [deadline] }), need('item', ['unit:a', 'item:c.d'], { flags: [deadline, fee] })];
  const { values, fixes } = assess({ needs }, holdings);
  assert.deepEqual(values.flags, { value: 33.33, samples: 3 });
  assert.deepEqual(fixes.map((f) => `${f.metric} ${f.what}`), ['flags plan deadline', 'flags item fee']);
});

test('a number in words matches the same number in digits', () => {
  assert.equal(numerals('within two years and three hundred days, or twenty-one days, or one thousand five hundred'), 'within 2 years and 300 days, or 21 days, or 1500');
  assert.equal(numerals('often tenant'), 'often tenant');
  const words = { kind: 'deadline' as const, text: 'Within fifteen days after the first sale' };
  assert.equal(assess({ needs: [need('item', ['item:c.d'], { flags: [words] })] }, holdings).values.flags?.value, 100);
});

test('every gap is a fix, with the points it adds to its metric', () => {
  const { fixes } = assess({ needs: [need('one', ['unit:b', 'template:x/y']), need('two', [])] }, holdings);
  assert.deepEqual(
    fixes.map((f) => `${f.metric} ${f.what} ${f.gain}`),
    ['coverage two 50', 'verified unit:b 100', 'fresh template:x/y 50', 'rights unit:b 100'],
  );
});

test('fresh: checked within a year, with a dated currency line no older than last year', () => {
  assert.equal(freshDate('2025-11-03', NOW), true);
  assert.equal(freshDate('2025-11-01', NOW), false);
  assert.equal(freshDate('2026-12-01', NOW), false);
  assert.equal(freshDate(null, NOW), false);
  assert.equal(freshUnit('C.R.S. 2026; no 2025 or 2026 source notes', '2026-11-01', NOW), true);
  assert.equal(freshUnit('Read in the 2023 edition on govinfo', '2026-11-01', NOW), false);
  assert.equal(freshUnit('C.R.S. 2026; HB 26-1188 effective 2026-08-12', '2026-11-01', NOW), true);
  assert.equal(freshUnit('U.S. Code through P.L. 119-136', '2026-11-01', NOW), false);
  assert.equal(freshUnit('Effective date moved to 2028-01-01', '2026-11-01', NOW), false);
  assert.equal(freshUnit('C.R.S. 2026', '2025-01-01', NOW), false);
  assert.equal(freshUnit(null, '2026-11-01', NOW), false);
});

test('verified: opened on the official host, so adding a PARTIAL unit never lowers a reading', () => {
  assert.deepEqual(['VERIFIED', 'PARTIAL', 'SECONDARY', 'UNVERIFIED', null].map(unitVerified), [true, true, false, false, false]);
  const partial = source('unit:p', { verified: unitVerified('PARTIAL') });
  const more: Holdings = { ...holdings, sources: new Map([...holdings.sources, [partial.ref, partial]]) };
  const before = assess({ needs: [need('one', ['unit:a']), need('two', [])] }, holdings).values;
  // The PARTIAL unit backs a need already held and holds a new one.
  const after = assess({ needs: [need('one', ['unit:a', 'unit:p']), need('two', ['unit:p'])] }, more).values;
  for (const [id, value] of Object.entries(before)) assert.ok((after[id]?.value ?? 0) >= (value.value ?? 0), id);
  assert.deepEqual([before.verified, after.verified], [{ value: 100, samples: 1 }, { value: 100, samples: 2 }]);
  assert.deepEqual(after.coverage, { value: 100, samples: 2 });
});

test('rights: no pending permission, and a machine can fetch whatever is stored whole', () => {
  assert.equal(unitRights('after-statement', 'whole', 'yes-with-rules'), true);
  assert.equal(unitRights('cite-only', 'cite-only', 'no'), true);
  assert.equal(unitRights('after-permission', 'whole', 'no'), false);
  assert.equal(unitRights('after-counsel', 'whole', 'browser-only'), false);
  assert.equal(unitRights(null, 'whole', 'yes'), false);
  assert.equal(unitRights('bundle', 'whole', null), false);
  assert.equal(unitRights('bundle', null, 'yes'), false);
});

test('a unit behind the next flag isn\'t held, since a room built with the defaults doesn\'t build it', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'law-next-'));
  try {
    mkdirSync(path.join(root, 'docs/design'), { recursive: true });
    mkdirSync(path.join(root, 'docs/checklist'));
    mkdirSync(path.join(root, 'templates'));
    const unit = (id: string, flag = '') => `[[unit]]\nid = "${id}"\nstatus = "VERIFIED"\nas_of = "C.R.S. 2026"\n${flag}\n\n[[unit.on_path]]\npath = "fights"\n`;
    writeFileSync(path.join(root, 'docs/design/law-pack-plan.toml'), `checked = "2026-11-01"\n\n${unit('built')}\n${unit('later', 'flag = "next"')}`);
    writeFileSync(path.join(root, 'docs/checklist/baseline.toml'), 'drafted = "2026-11-01"\n');
    const held = readHoldings(root, NOW);
    assert.deepEqual([...held.sources.keys()], ['unit:built']);
    const { values, rows } = assess({ needs: [need('one', ['unit:built']), need('two', ['unit:later'])] }, held);
    assert.deepEqual(rows[1]!.unresolved, ['unit:later']);
    assert.deepEqual(values.coverage, { value: 50, samples: 2 });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the repository holdings: every unit a default room builds, every item and template, with the plan read as written', () => {
  const real = readHoldings(ROOT, NOW);
  const count = (kind: string) => [...real.sources.keys()].filter((r) => r.startsWith(kind)).length;
  const plan = readFileSync(path.join(ROOT, 'docs/design/law-pack-plan.toml'), 'utf8');
  const checklist = readFileSync(path.join(ROOT, 'docs/checklist/baseline.toml'), 'utf8');
  const built = tables(plan, 'unit').filter((u) => field(u, 'flag') !== 'next').map((u) => `unit:${field(u, 'id')}`);
  assert.deepEqual([...real.sources.keys()].filter((r) => r.startsWith('unit:')), built);
  assert.equal(count('item:'), tables(checklist, 'item').length);
  assert.ok(count('template:') > 0);
  assert.ok(real.paths.includes('startup-forms') && real.paths.includes('fights'));
  assert.equal(real.sources.get('unit:co-securities-rules')?.rights, true, 'cite-only: linked, never fetched');
  assert.equal(real.sources.get('unit:us-sec-part-270')?.verified, true, 'PARTIAL: opened on the official host');
  assert.equal(real.sources.get('template:founders/delaware-corporation-certificate')?.checked, '2026-11-01');
  assert.match(real.sources.get('item:financing.form-d-and-state-notices')?.text ?? '', /within 15 days after the first sale/);
});

test('a malformed list fails with every problem named', () => {
  const real = readHoldings(ROOT, NOW);
  const bad = {
    needs: [
      need('dup', ['unit:co-llc-act']),
      need('dup', ['nope:x']),
      { ...need('host', []), source: 'https://example.com/law', path: 'nowhere', extra: 1 },
      need('flag', [], { flags: [{ kind: 'date' as 'fee', text: 'x' }] }),
      need('empty-flag', [], { flags: [{ kind: 'fee', text: '** **' }] }),
      need('short-flag', [], { flags: [{ kind: 'fee', text: 'a' }] }),
    ],
    questions: [{ id: 'other-q', question: 'What applies?', expect: ['17 CFR 230.503'] }],
  };
  assert.throws(() => parseNeeds(bad, 'sec', real), (error: Error) => {
    for (const rule of [/dup: id must be unique/, /covered_by/, /unknown field/, /path is not/, /source is not/, /flag: each flag/, /empty-flag: each flag/, /short-flag: each flag/, /question ids/]) assert.match(error.message, rule);
    return true;
  });
  assert.throws(() => parseNeeds({ needs: [], extra: [] }, 'sec', real), /holds only needs/);
  const good = { needs: [need('ok', ['unit:co-llc-act'], { source: 'https://olls.info/crs/crs2026-title-07.pdf', checked: null })], questions: [{ id: 'sec-q', question: 'Q?', expect: ['17 CFR 230.503'] }] };
  assert.equal(parseNeeds(good, 'sec', real).needs.length, 1);
});

test('questions pass only when every run passes with an answer, and an unanswered one fails', () => {
  const questions = ['sec-a', 'sec-b', 'sec-c', 'sec-d'].map((id) => ({ id, question: 'Q?', expect: ['17 CFR 230.503'] }));
  const run = (id: string, verdict: string, answer = 'LAW: 17 CFR 230.503') => ({ id, verdict, result: { answer } });
  const at = '2026-11-02T06:00:00.000Z';
  // A report from before eval.ts marked retrieval-only rows: every row is a turn, so sec-c's empty answer fails.
  const runs = answerRuns({ at, rows: [run('sec-a', 'pass'), run('sec-b', 'pass'), run('sec-b', 'fail'), run('sec-c', 'pass', '')] });
  assert.deepEqual(questionsPassed(questions, runs), { value: 25, samples: 3, at });
  assert.deepEqual(questionsPassed(questions, []), { value: null, samples: 0 }, 'no turn at all reads missing');
  // Marked retrieval-only rows are no turn: sec-c and sec-d were only retrieved today.
  const mixed = answerRuns({ at, rows: [{ ...run('sec-a', 'pass'), answered: true }, { ...run('sec-c', 'pass', ''), answered: false }, { ...run('sec-d', 'pass', ''), answered: false }] });
  assert.deepEqual(mixed.map((r) => [r.id, r.pass]), [['sec-a', true]]);
  // An errored call is no turn: sec-b keeps its carried pass, and sec-c, never answered, stays without a turn.
  const failedCall = (id: string) => ({ id, answered: true, neurons: 0, verdict: 'fail', result: { answer: '', error: 'generation_http_503' } });
  const today = answerRuns({ at, rows: [failedCall('sec-b'), failedCall('sec-c'), { ...run('sec-a', 'fail', ''), answered: true }] });
  assert.deepEqual(today.map((r) => [r.id, r.pass]), [['sec-a', false]], 'an empty answer with no error is still a fail');
  const kept = carryRuns(questions, today, [{ id: 'sec-b', at: '2026-10-20T06:00:00.000Z', pass: true, answered: 1, neurons: 600 }], new Date(at));
  assert.deepEqual(kept.map((r) => [r.id, r.pass]), [['sec-a', false], ['sec-b', true]]);
  // Some reps errored, the rest answered: only the answered reps count.
  assert.deepEqual(answerRuns({ at, rows: [failedCall('sec-d'), { ...run('sec-d', 'pass'), answered: true }] }).map((r) => [r.id, r.pass, r.answered]), [['sec-d', true, 1]]);
  assert.throws(() => answerRuns({ rows: [] }), /not a law eval report/);
  assert.throws(() => answerRuns({ at: 'yesterday', rows: [] }), /not a law eval report/);
});

test('eval spend is what answering every page question once costs, from its answered turns, and none reads missing', () => {
  const questions = ['sec-a', 'sec-b'].map((id) => ({ id, question: 'Q?', expect: ['17 CFR 230.503'] }));
  const answer = { answer: 'LAW: 17 CFR 230.503' };
  const at = '2026-11-02T06:00:00.000Z';
  // An older report keeps one total: 3,000 neurons over three answered rows, so sec-a's two cost 2,000.
  const rows = [{ id: 'sec-a', result: answer }, { id: 'sec-a', result: answer }, { id: 'sec-b', result: { answer: '' } }, { id: 'tax-a', result: answer }];
  assert.deepEqual(evalSpend(questions, answerRuns({ at, neurons: 3000, rows })), { value: 0.044, samples: 1, at });
  assert.deepEqual(evalSpend(questions, answerRuns({ at, rows })), { value: null, samples: 0 });
  assert.deepEqual(evalSpend(questions, answerRuns({ at, neurons: 0, rows })), { value: null, samples: 0 });
  const retrievalOnly = rows.map(({ id }) => ({ id, answered: false, neurons: 0, result: { answer: '' } }));
  assert.deepEqual(evalSpend(questions, answerRuns({ at, neurons: 40, rows: retrievalOnly })), { value: null, samples: 0 });
  // A report with a spend per row: 500 and 700 neurons, a mean of 600 for each of the two questions.
  const own = [{ id: 'sec-a', answered: true, neurons: 500, result: answer }, { id: 'sec-b', answered: true, neurons: 700, result: answer }];
  assert.deepEqual(evalSpend(questions, answerRuns({ at, neurons: 1200, rows: own })), { value: 0.0132, samples: 2, at });
  // Only sec-a answered today: its spend stands in for sec-b.
  assert.deepEqual(evalSpend(questions, answerRuns({ at, neurons: 500, rows: own.slice(0, 1) })), { value: 0.011, samples: 1, at });
});

test('each question keeps its newest turn for 60 days, across runs, and nothing unreadable is carried', () => {
  const questions = ['sec-a', 'sec-b', 'sec-c'].map((id) => ({ id, question: 'Q?', expect: ['17 CFR 230.503'] }));
  const now = new Date('2026-11-06T09:00:00Z');
  const turn = (id: string, at: string, pass: boolean) => ({ id, at, pass, answered: 1, neurons: 600 });
  const carried = [
    turn('sec-a', '2026-10-20T08:40:00.000Z', false),
    turn('sec-b', '2026-10-25T08:40:00.000Z', true),
    turn('sec-c', '2026-09-01T08:40:00.000Z', true),
    turn('gone-q', '2026-11-01T08:40:00.000Z', true),
    { id: 'sec-b', at: 'soon', pass: true, answered: 1, neurons: 1 },
    { id: 'sec-c', pass: 'yes' },
  ];
  const fresh = [turn('sec-a', '2026-11-06T08:40:00.000Z', true)];
  const runs = carryRuns(questions, fresh, carried, now);
  // sec-a: today's turn wins; sec-b: carried; sec-c: 66 days old, dropped; gone-q: no longer on the page.
  assert.deepEqual(runs.map((r) => [r.id, r.at.slice(0, 10), r.pass]), [['sec-a', '2026-11-06', true], ['sec-b', '2026-10-25', true]]);
  assert.deepEqual(questionsPassed(questions, runs), { value: 66.66, samples: 2, at: '2026-11-06T08:40:00.000Z' });
  assert.deepEqual(carryRuns(questions, fresh, { not: 'a list' }, now), fresh);
  assert.deepEqual(carryRuns(questions, [], carried, new Date('2026-12-30T00:00:00Z')), [], 'every turn has aged out');
  assert.equal(CARRY_DAYS, 60);
});

const passage = (id: string, text: string, over: Partial<LawPassage> = {}): LawPassage => ({
  id,
  cite: '17 C.F.R. § 230.503',
  title: 'Filing of notice of sales',
  url: 'https://www.ecfr.gov/current/title-17/section-230.503',
  retrieved: '2026-11-01',
  track: 'regulator',
  kind: 'regulation',
  source: 'eCFR',
  text,
  ...over,
});

test('the kit rebuilds the answer with the tool\'s own builder: once as text, six long parts within the 2,250-token goal', () => {
  const six = Array.from({ length: TOOL_PASSAGES }, (_, i) => passage(`cfr-17-230-50${i}`, `${'x '.repeat(2000)}</public-law>`, { track: i % 2 ? 'civil' : 'regulator' }));
  const answer = toolAnswer(six);
  assert.equal(answer.content.length, 1);
  assert.equal('structuredContent' in answer, false, 'no second copy');
  assert.ok(Math.ceil(JSON.stringify(answer).length / 4) <= 2250);
  const text = (JSON.parse(answer.content[0]!.text) as { results: { text: string }[] }).results[0]!.text;
  assert.ok(text.startsWith('<public-law>\n') && text.endsWith(' [passage cut]\n</public-law>'));
});

test('law lookup tokens are the 95th percentile of the tool\'s answers to the page\'s runs, skipping any it can\'t rebuild', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'law-library-'));
  try {
    const held = [passage('cfr-17-230-503', 'Form D within 15 days.'), passage('cfr-17-230-506~1', 'y'.repeat(1800), { track: 'both' })];
    for (const p of held) {
      mkdirSync(path.join(dir, 'out', 'law', p.track), { recursive: true });
      writeFileSync(path.join(dir, 'out', 'law', p.track, `${p.id}.md`), `${p.text}\n`);
    }
    writeFileSync(path.join(dir, 'out', 'catalog.json'), JSON.stringify({ version: 1, built: '2026-11-01', chunks: held.map(({ text: _t, ...c }) => c) }));
    const library = lawLibrary(dir);
    const [a, b] = held;
    const tokens = (ps: LawPassage[]) => Math.ceil(JSON.stringify(toolAnswer(ps)).length / 4);
    const run = (id: string, retrieved: string[]) => ({ id, result: { answer: '', retrieved } });
    const six = [a!.id, b!.id, a!.id, b!.id, a!.id, b!.id];
    const rows = [run('sec-a', [a!.id]), run('sec-a', [...six, 'cfr-17-gone']), run('sec-b', []), run('sec-b', [a!.id, 'cfr-17-gone']), run('tax-a', six)];
    const at = '2026-11-02T06:00:00.000Z';
    const questions = ['sec-a', 'sec-b'].map((id) => ({ id, question: 'Q?', expect: ['17 CFR 230.503'] }));
    assert.deepEqual(lookupTokens(questions, { at, rows }, library), { value: tokens([a!, b!, a!, b!, a!, b!]), samples: 2, at });
    assert.ok(tokens([a!]) < tokens([a!, b!, a!, b!, a!, b!]));
    assert.deepEqual(lookupTokens(questions, { at, rows: rows.slice(0, 1) }, library), { value: tokens([a!]), samples: 1, at });
    assert.deepEqual(lookupTokens(questions, { at, rows }, lawLibrary(path.join(dir, 'none'))), { value: null, samples: 0, at });
    assert.throws(() => lookupTokens(questions, { rows }, library), /not a law eval report/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('search p95 is the page\'s timed searches, and a question skipped or failed counts as slower than any', () => {
  const at = '2026-11-02T06:00:00.000Z';
  const questions = Array.from({ length: 20 }, (_, i) => ({ id: `sec-${i}`, question: 'Q?', expect: ['17 CFR 230.503'] }));
  const row = (id: string, search_ms: number | null) => ({ id, answered: false, search_ms, result: { answer: '', retrieved: [] } });
  const all = questions.map((q, i) => row(q.id, (i + 1) * 100));
  // Twenty runs: the 95th percentile is the 19th fastest. Another page's question never counts.
  assert.deepEqual(searchP95(questions, { at, rows: [...all, row('tax-a', 99_999)] }), { value: 1900, samples: 20, at });
  // One failed search is the slowest, so the 19th is still timed; a second, or a question the run skipped, reaches it.
  assert.deepEqual(searchP95(questions, { at, rows: [...all.slice(0, 19), row('sec-19', null)] }), { value: 1900, samples: 20, at });
  assert.deepEqual(searchP95(questions, { at, rows: [...all.slice(0, 18), row('sec-18', null)] }), { value: null, samples: 20, at });
  // Each rep is a run, and a report from before the timing reads missing.
  assert.deepEqual(searchP95(questions.slice(0, 1), { at, rows: [row('sec-0', 300), row('sec-0', 100)] }), { value: 300, samples: 2, at });
  assert.deepEqual(searchP95(questions, { at, rows: [{ id: 'sec-0', answered: false, result: { answer: '', retrieved: [] } }] }), { value: null, samples: 0, at });
  assert.throws(() => searchP95(questions, { rows: all }), /not a law eval report/);
});

test('the lane reads the law-eval job\'s newest report and carries each question\'s turn to its next run', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'law-eval-lane-'));
  try {
    const slug = 'court-rules';
    const list = JSON.parse(readFileSync(path.join(ROOT, 'quality-speed/pages', slug, 'needs.json'), 'utf8')) as { questions: { id: string }[] };
    const [first, second] = list.questions.map((q) => q.id);
    const law = path.join(dir, 'key-jobs', 'law-eval');
    const held = passage('cfr-17-230-503', 'Form D within 15 days.');
    mkdirSync(path.join(law, 'out', 'law', held.track), { recursive: true });
    writeFileSync(path.join(law, 'out', 'law', held.track, `${held.id}.md`), `${held.text}\n`);
    const { text: _t, ...entry } = held;
    writeFileSync(path.join(law, 'out', 'catalog.json'), JSON.stringify({ version: 1, built: '2026-11-01', chunks: [entry] }));
    mkdirSync(path.join(law, 'eval'));
    const at = new Date().toISOString();
    const row = (id: string, answered: boolean) => ({ id, rep: 1, answered, neurons: answered ? 600 : 0, search_ms: answered ? 400 : 200, verdict: 'pass', failed: [], result: { answer: answered ? 'LAW: 17 CFR 230.503' : '', retrieved: [held.id], citations: [] } });
    // An older report the lane must pass over, and today's: the first question answered, the second retrieved only.
    writeFileSync(path.join(law, 'eval', 'law-eval-2026-01-01T00-00-00-000Z.json'), JSON.stringify({ at: '2026-01-01T00:00:00.000Z', neurons: 0, rows: [] }));
    writeFileSync(path.join(law, 'eval', `law-eval-${at.replace(/[:.]/g, '-')}.json`), JSON.stringify({ at, neurons: 600, rows: [row(first!, true), row(second!, false)] }));
    assert.equal(newestReport(path.join(law, 'eval')), path.join(law, 'eval', `law-eval-${at.replace(/[:.]/g, '-')}.json`));
    assert.equal(newestReport(path.join(dir, 'none')), null);
    // Yesterday's lane answered the second question and failed it.
    const prev = path.join(dir, 'prev');
    mkdirSync(path.join(prev, 'facts'), { recursive: true });
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    writeFileSync(path.join(prev, 'facts', 'law-runs.json'), JSON.stringify([{ id: second, at: yesterday, pass: false, answered: 1, neurons: 800 }]));
    const detail = path.join(dir, 'detail');
    const out = path.join(dir, 'records.json');
    const env = { ...process.env, DETAIL_DIR: detail, PREV_DIR: prev, KEY_JOB_OUTPUT_DIR: path.join(dir, 'key-jobs'), GITHUB_RUN_ID: '' };
    const run = spawnSync(process.execPath, [path.join(ROOT, 'quality-speed/core/law/collect.ts'), slug, '--out', out], { cwd: ROOT, encoding: 'utf8', env });
    assert.equal(run.status, 0, run.stderr);
    const values = (JSON.parse(readFileSync(path.join(detail, 'page', 'law.json'), 'utf8')) as { values: Record<string, { value: number | null; samples: number }> }).values;
    const total = list.questions.length;
    assert.deepEqual([values.questions!.value, values.questions!.samples], [Math.floor((1 / total) * 10_000) / 100, 2]);
    assert.deepEqual([values.eval_usd!.value, values.eval_usd!.samples], [Math.round(700 * total * 0.011) / 1000, 2]);
    assert.equal(values.law_lookup_tokens_p95!.samples, 2);
    // Two timed searches, and every other page question, which the report skipped, as slower than any: so it reads missing.
    assert.deepEqual([values.search_p95!.value, values.search_p95!.samples], [null, total]);
    const carried = JSON.parse(readFileSync(path.join(detail, 'facts', 'law-runs.json'), 'utf8')) as { id: string; pass: boolean }[];
    assert.deepEqual(carried.map((r) => [r.id, r.pass]).sort(), [[first, true], [second, false]].sort());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the law-eval job starts on live-room\'s up, never on a variable', () => {
  const workflow = readFileSync(path.join(ROOT, '.github/workflows/quality-speed.yml'), 'utf8');
  const job = workflow.split('\n  law-eval:\n')[1]?.split(/\n  [\w-]+:\n/)[0] ?? '';
  const gate = /^ {4}if: (.+)$/m.exec(job)?.[1] ?? '';
  // A variable gate skipped the job on every run, so every law page's tokens read missing: a job's if can't see the
  // environment's CLOUDFLARE_ACCOUNT_ID, and nobody set SAMPLE_ROOM_URL.
  assert.equal(gate, "needs.live-room.outputs.up == 'true'");
  assert.match(job, /^ {4}needs: live-room$/m);
});

test('lane minutes round the job\'s time so far up to the whole minute, and an unlisted job reads missing', () => {
  const now = new Date('2026-11-04T06:10:00Z');
  const jobs = { jobs: [{ name: 'sec (law)', started_at: '2026-11-04T06:07:30Z' }, { name: 'tax (law)', started_at: '2026-11-04T06:09:59Z' }] };
  assert.deepEqual(laneMinutes(jobs, 'sec (law)', now), { value: 3, samples: 1 });
  assert.deepEqual(laneMinutes(jobs, 'tax (law)', now), { value: 1, samples: 1 });
  assert.equal(laneMinutes(jobs, 'court-rules (law)', now), null);
  assert.equal(laneMinutes(null, 'sec (law)', now), null);
  assert.equal(laneMinutes({ jobs: [{ name: 'sec (law)', started_at: '2026-11-04T06:11:00Z' }] }, 'sec (law)', now), null);
  assert.equal(laneMinutes({ jobs: [{ name: 'sec (law)', started_at: null }] }, 'sec (law)', now), null);
});

test('records pass the metric format, and a value the kit couldn\'t measure reads missing', () => {
  const manifest = validateManifest({
    page: 'sec',
    metrics: [
      { id: 'coverage', lens: 'quality', unit: 'percent', direction: 'higher', floor: 0, goal: 100, weight: 3, max_age_hours: 48, min_samples: 1 },
      { id: 'flags', lens: 'quality', unit: 'percent', direction: 'higher', floor: 0, goal: 100, weight: 1, max_age_hours: 48, min_samples: 1 },
      { id: 'questions', lens: 'quality', unit: 'percent', direction: 'higher', floor: 0, goal: 100, weight: 1, max_age_hours: 48, min_samples: 1 },
      { id: 'search_p95', lens: 'speed', unit: 'ms', direction: 'lower', floor: 5000, goal: 1000, weight: 1, max_age_hours: 48, min_samples: 20 },
      { id: 'change_lag', lens: 'speed', unit: 'days', direction: 'lower', floor: 90, goal: 7, weight: 1, max_age_hours: 48, min_samples: 1 },
    ],
    changes: [],
  });
  assert.deepEqual(manifest.errors, []);
  const ids = manifest.value!.metrics.map((m) => m.id);
  const values = { coverage: { value: 50, samples: 4 }, flags: { value: null, samples: 0 } };
  const at = `${new Date().toISOString().slice(0, 19)}Z`;
  const out = records('sec', ids, values, { at, url: 'https://github.com/Colorado-Startups/legallas/actions/runs/123' });
  assert.deepEqual(out.map((r) => `${r.id} ${r.status}`), ['coverage ok', 'flags missing']);
  assert.deepEqual(validateRecords(out, manifest.value!).errors, []);
  const offCi = records('sec', ids, values, { at, url: null });
  assert.deepEqual(offCi.map((r) => `${r.id} ${r.status} ${r.source_url}`), ['coverage missing null', 'flags missing null']);
  assert.deepEqual(validateRecords(offCi, manifest.value!).errors, []);
});

test('every law page\'s reviewed list is well formed', () => {
  const real = readHoldings(ROOT, new Date());
  for (const slug of lawPages()) parseNeeds(JSON.parse(readFileSync(path.join(ROOT, 'quality-speed/pages', slug, 'needs.json'), 'utf8')), slug, real);
});

test('every law page\'s collector runs as its lane does, writing its records and law.json', () => {
  const collector = path.join(ROOT, 'quality-speed/core/law/collect.ts');
  for (const slug of lawPages()) {
    const dir = mkdtempSync(path.join(tmpdir(), 'law-lane-'));
    try {
      const out = path.join(dir, 'records.json');
      const run = spawnSync(process.execPath, [collector, slug, '--out', out], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, DETAIL_DIR: dir } });
      assert.equal(run.status, 0, `${slug}: ${run.stderr}`);
      assert.ok(Array.isArray(JSON.parse(readFileSync(out, 'utf8'))), slug);
      assert.ok(readView(pathToFileURL(path.join(dir, 'page', 'law.json'))), slug);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('the page template draws needs by path and each need against each check, and a missing view reads red', () => {
  const view = assess({ needs: [need('one', ['unit:a']), need('two', ['unit:b'], { path: 'fights' }), need('three', [], { path: 'fights' })] }, holdings);
  const html = lawCharts(view);
  assert.match(html, /Raising/);
  assert.match(html, /Fights/);
  assert.equal(html.match(/qs-dm-fail/g)?.length, 3);
  assert.match(lawCharts(null), /is-missing/);
  assert.equal(readView(new URL('./no-such-law.json', import.meta.url)), null);
  const dir = mkdtempSync(path.join(tmpdir(), 'law-view-'));
  try {
    const file = (name: string, text: string) => (writeFileSync(path.join(dir, name), text), pathToFileURL(path.join(dir, name)));
    assert.equal(readView(file('cut.json', '{"byPath": [')), null);
    assert.equal(readView(file('old.json', JSON.stringify({ rows: [{ id: 'one' }] }))), null);
    assert.ok(readView(file('ok.json', JSON.stringify(view))));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Road to 100 has one fix per metric short of its goal, worth its share of its lens', () => {
  const def = { unit: 'percent' as const, direction: 'higher' as const, floor: 0, goal: 100, max_age_hours: 48, min_samples: 1 };
  const metrics = [
    { ...def, id: 'coverage', lens: 'quality' as const, weight: 3 },
    { ...def, id: 'verified', lens: 'quality' as const, weight: 1 },
    { ...def, id: 'open_p95', lens: 'speed' as const, weight: 1 },
  ];
  const scores = { coverage: 80, verified: 100, open_p95: 0 };
  const fixes = roadFixes({ metrics, score: { metrics: metrics.map((m) => ({ id: m.id, score: scores[m.id as keyof typeof scores], reading: 'measured' })) } } as never);
  assert.deepEqual(fixes.map((f) => [f.id, f.q, f.s]), [['coverage', 15, 0], ['open_p95', 0, 100]]);
  assert.deepEqual(fixes.map((f) => f.label), ['Coverage', 'open p95'], "the kit's short label, else the id");
  const named = roadFixes({ metrics, score: { metrics: metrics.map((m) => ({ id: m.id, score: scores[m.id as keyof typeof scores] })) } } as never, { coverage: 'Held' });
  assert.deepEqual(named.map((f) => f.label), ['Held', 'open p95'], "the page's own label first");
});

test('a law page renders inside the build\'s fence, reading only its law.json', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'law-kit-'));
  try {
    const page = path.join(dir, 'pages', 'sec');
    mkdirSync(page, { recursive: true });
    const def = { unit: 'percent', direction: 'higher', floor: 0, goal: 100, weight: 1, max_age_hours: 48, min_samples: 1 };
    const metrics = [{ ...def, id: 'coverage', lens: 'quality' }, { ...def, id: 'search_p95', lens: 'speed', unit: 'ms', direction: 'lower', floor: 5000, goal: 1000 }];
    writeFileSync(path.join(page, 'manifest.json'), JSON.stringify({ page: 'sec', metrics, changes: [] }));
    writeFileSync(path.join(page, 'law.json'), JSON.stringify(assess({ needs: [need('one', ['unit:a'])] }, holdings)));
    const kit = pathToFileURL(path.join(ROOT, 'quality-speed/core/law/page.ts')).href;
    writeFileSync(path.join(page, 'page.ts'), `import { lawCharts, readView } from '${kit}';\nexport const render = () => ({ body: lawCharts(readView(new URL('./law.json', import.meta.url))) });\n`);
    const build = path.join(ROOT, 'quality-speed/core/build.ts');
    const run = spawnSync(process.execPath, [build, '--synthetic', '--pages', path.join(dir, 'pages'), '--out', path.join(dir, 'out')], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.match(readFileSync(path.join(dir, 'out', 'sec', 'index.html'), 'utf8'), /qs-dotmatrix/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
