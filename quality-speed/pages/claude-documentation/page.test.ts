// SPDX-License-Identifier: Apache-2.0
// node --test quality-speed/pages/claude-documentation/page.test.ts
// The page renders inside its word budget, each metric sits in one place, the moved checks still catch what they caught,
// and the question set stays pinned.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { joinMetrics, validateManifest, validateRecords } from '../../contract/validate.ts';
import { frameWords } from '../../core/build.ts';
import { countWords, MAX_WORDS } from '../../core/guard.ts';
import { scorePage } from '../../core/score.ts';
import { claudeLoad, startLoad } from './load.ts';
import { PLACES, placeCells, render } from './page.ts';
import { type Question, checkQuestions, loadCorpus } from './questions.ts';
import { meets, parseExpected, settingsReadings, type Expected } from './settings.ts';

const read = (rel: string) => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));
// Scored as a signed-off list: an unsigned list takes no readings.
const manifest = validateManifest({ ...read('./manifest.json'), signoff_comment: 1 }, 'claude-documentation').value!;
const now = new Date('2026-11-09T07:00:00Z');
const run = 'https://github.com/Colorado-Startups/legallas/actions/runs/1001';
// Invented readings: most at goal, every fourth missing, so both states render.
const raw = manifest.metrics.map((m, i) =>
  i % 4 === 1
    ? { id: m.id, page: 'claude-documentation', value: null, status: 'missing', stage: 'live', measured_at: null, source_url: null, sample_size: null }
    : { id: m.id, page: 'claude-documentation', value: m.goal, status: 'ok', stage: 'live', measured_at: '2026-11-09T06:00:00Z', source_url: run, sample_size: m.min_samples },
);
const records = validateRecords(raw, manifest, now).records;
const context = { score: scorePage('claude-documentation', manifest, records, now), metrics: joinMetrics(manifest, records), history: [], others: {}, detail: null };
const found = {
  answers: [{ id: 'q01', stated: true, true: true, clean: true }, { id: 'q02', stated: true, true: false, clean: true }],
  load: [{ path: 'CLAUDE.md', tokens: 1930, part: 'start' }, { path: '.claude/skills/x/SKILL.md', tokens: 59, part: 'claude' }],
  rows: [{ id: 'allow_x', met: true }],
};

test('the body fits the word budget with every drill-down, with no inline style or handler', () => {
  assert.equal(records.length, manifest.metrics.length, 'every invented record passes the contract');
  const { body } = render(context, found);
  assert.ok(countWords(body) <= MAX_WORDS - frameWords('claude-documentation'), `visible words: ${countWords(body)}`);
  assert.doesNotMatch(body, /\sstyle=|\son[a-z]+=/i);
  assert.match(body, /Start questions/);
  assert.equal(render({ ...context, score: { ...context.score, has_list: false } }, found).body, '', 'an unsigned list renders nothing');
});

test('every metric sits in one place, and a lens with none there is excluded', () => {
  assert.deepEqual(PLACES.flatMap((p) => p.metrics).sort(), manifest.metrics.map((m) => m.id).sort());
  const cells = placeCells([
    { id: 'questions_true', lens: 'quality', weight: 3, score: 100 },
    { id: 'settings_match', lens: 'quality', weight: 1, score: 0 },
  ]);
  assert.equal(cells.find((c) => c.col === 'start' && c.row === 'quality')?.score, 100);
  assert.equal(cells.find((c) => c.col === 'start' && c.row === 'speed')?.excluded, true);
});

/** A throwaway git repository of invented files, tracked and uncommitted. */
function repo(files: Record<string, string>): { dir: string; done: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'qs-claude-docs-'));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
  execFileSync('git', ['-C', dir, 'init', '-q'], { env });
  execFileSync('git', ['-C', dir, 'add', '-A'], { env });
  return { dir, done: () => rmSync(dir, { recursive: true, force: true }) };
}

test('a question passes only when stated, true in the code and contradicted nowhere', () => {
  const r = repo({
    'web/package.json': JSON.stringify({ scripts: { 'dev:seed': 'x' } }),
    'web/README.md': '# Room\n\nRun `npm run\ndev:seed` to seed it.\n',
    '.github/workflows/ci.yml': '# The Doe v. Roe room\non: push\n',
  });
  try {
    const base = { audience: 'agent' as const, question: 'Seed?', accept: [], doc: { path: 'web/README.md', pattern: 'npm run dev:seed' } };
    const qs: Question[] = [
      { ...base, id: 'ok', truth: [{ kind: 'script', name: 'dev:seed' }] },
      { ...base, id: 'untrue', truth: [{ kind: 'file', path: 'web/none.ts' }] },
      { ...base, id: 'unstated', doc: { path: 'web/README.md', pattern: 'npm run law' }, truth: [{ kind: 'script', name: 'dev:seed' }] },
      { ...base, id: 'contradicted', truth: [{ kind: 'script', name: 'dev:seed' }], conflicts: ['Doe v\\.\\s+Roe room'] },
    ];
    assert.deepEqual(checkQuestions(loadCorpus(r.dir), qs).map((q) => [q.id, q.pass]), [['ok', true], ['untrue', false], ['unstated', false], ['contradicted', false]]);
  } finally {
    r.done();
  }
});

test('start load counts the entry, its import and Read too once; .claude/ counts rules with no paths and skill listings', () => {
  const r = repo({
    'CLAUDE.md': '| Read too | `CONTRIBUTING.md`, `AGENTS.md` |\n@docs/more.md\n`@docs/code.md`\n',
    'CONTRIBUTING.md': 'abcd',
    'docs/more.md': 'abcdefgh',
    '.claude/rules/always.md': 'abcd',
    '.claude/rules/scoped.md': '---\npaths: web/**\n---\nonly with web files',
    '.claude/skills/s/SKILL.md': '---\nname: s\ndescription: abcd\nother: never listed\n---\nbody not loaded',
  });
  try {
    symlinkSync('CLAUDE.md', join(r.dir, 'AGENTS.md'));
    assert.deepEqual(startLoad(r.dir).map((f) => f.path).sort(), ['CLAUDE.md', 'CONTRIBUTING.md', 'docs/more.md']);
    const c = claudeLoad(r.dir);
    assert.deepEqual(c?.files.map((f) => f.path), ['.claude/rules/always.md', '.claude/skills/s/SKILL.md']);
    assert.equal(c?.tokens, Math.ceil((4 + 'name: s\ndescription: abcd'.length) / 4));
  } finally {
    r.done();
  }
});

test('the checkout meets every settings row, and planted drift is caught', () => {
  const expected = parseExpected(read('./expected.json')) as Expected;
  const settings = read('../../../.claude/settings.json') as { permissions: { allow: string[]; deny: string[] } };
  assert.ok((expected.rows.find((r) => r.id === 'deny_rules_kept')?.values?.length ?? 0) >= 60, 'the pinned deny rules stay');
  const s = settingsReadings(expected, settings, [], now.toISOString());
  assert.deepEqual([s.match?.value, s.deny?.value, s.open?.hours], [100, 1, 0]);
  const dropped = structuredClone(settings);
  dropped.permissions.deny.pop();
  assert.equal(settingsReadings(expected, dropped, [], now.toISOString()).deny?.value, 0);
  const row = { id: 'x', read: 'repo' as const, op: 'allowed' as const, values: ['mcp__a__b'], why: '', source: '' };
  assert.equal(meets(row, { permissions: { allow: ['mcp__a__b'], ask: ['mcp__a'] } }), false, 'an ask rule on the server takes the tool back');
});

test('questions.json matches its pin, or the lock records the change with a sign-off', () => {
  const lock = read('./inputs.lock.json') as { pins: Record<string, string>; changes: { file: string; to: string; signoff_comment: number }[] };
  const sha = createHash('sha256').update(readFileSync(new URL('./questions.json', import.meta.url))).digest('hex');
  assert.equal(sha, lock.pins['questions.json'], 'questions.json changed: record it in inputs.lock.json with the reviewer\'s sign-off');
  for (const c of lock.changes) assert.ok(Number.isInteger(c.signoff_comment) && c.signoff_comment > 0, 'every change is signed off');
  // Against the base branch's lock: a moved pin needs a new change entry ending at it, so editing a file and its pin together fails.
  const root = new URL('../../../', import.meta.url).pathname;
  const ref = /^[0-9a-f]{40}$/.test(process.env.PR_BASE_SHA ?? '') ? process.env.PR_BASE_SHA! : 'origin/main';
  let base: typeof lock | null = null;
  try {
    base = JSON.parse(execFileSync('git', ['-C', root, 'show', `${ref}:quality-speed/pages/claude-documentation/inputs.lock.json`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch {
    // The page's first merge: no base lock yet.
  }
  if (base && base.pins['questions.json'] !== lock.pins['questions.json']) {
    assert.deepEqual(lock.changes.slice(0, base.changes.length), base.changes, 'the change log may only be added to');
    assert.equal(lock.changes.slice(base.changes.length).filter((c) => c.file === 'questions.json').at(-1)?.to, lock.pins['questions.json']);
  }
});
