// SPDX-License-Identifier: Apache-2.0
// node --test quality-speed/pages/build/build.test.ts  (seconds, no install)
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { collectFacts, median, readings, runFacts, trim, type Job, type Run, type RunFacts } from './ci.ts';
import { record } from './collect.ts';
import { checks, compare, fontFamily, partOf } from './release.ts';

const t = (s: number) => new Date(Date.UTC(2026, 10, 1, 0, 0, s)).toISOString();
const step = (name: string, conclusion: string | null, secs = 2) => ({ name, conclusion, started_at: t(0), completed_at: t(secs) });
const run = (id: number, event = 'push', branch = 'main'): Run => ({ id, head_sha: 'a'.repeat(40), event, head_branch: branch, created_at: t(id) });
const checksJob = (c: string | null = 'success'): Job => ({
  name: 'checks',
  steps: [step('Web install', 'success', 10), step('Web build', c, 2), step('Worker dry runs', c === 'success' ? 'success' : 'skipped', 3)],
});
const swiftJob: Job = {
  name: 'swift',
  steps: [step('Build (Debug)', 'success', 28), step('Build (Release)', 'success', 28), step('App bundle', 'success', 54), step('LegallasCore for iOS', 'success', 6)],
};

test('a run keeps each build step that ran and sums the build time only when all passed', () => {
  const ok = runFacts(run(1), [checksJob(), swiftJob]);
  assert.equal(ok.web, 15);
  assert.equal(ok.mac, 116);
  assert.equal(ok.main, true);
  assert.equal(ok.build, 1);
  const failed = runFacts(run(2), [checksJob('failure')]);
  assert.deepEqual(failed.steps, { 'Web install': 1, 'Web build': 0 });
  assert.equal(failed.build, 0, 'a failed build step fails the run, though the next step was skipped');
  assert.equal(failed.web, null);
  assert.equal(failed.mac, null);
  assert.equal(runFacts(run(3, 'pull_request', 'claude/x'), []).main, false);
});

test('build steps skipped after an earlier check failed leave the run unknown, never a pass', () => {
  const earlier: Job = { name: 'checks', steps: [step('Web install', 'success'), step('Web check', 'failure'), step('Web build', 'skipped'), step('Worker dry runs', 'skipped')] };
  assert.equal(runFacts(run(1), [earlier]).build, null);
  assert.equal(runFacts(run(1), [earlier, swiftJob]).build, null, 'a passing Swift build does not hide it');
  const untouched: Job = { name: 'checks', steps: ['Web install', 'Web build', 'Worker dry runs'].map((n) => step(n, 'skipped')) };
  assert.equal(runFacts(run(2), [untouched]).build, null, 'nothing built: not counted');
  assert.equal(runFacts(run(3), [untouched, swiftJob]).build, 1);
});

test('a renamed step reads as no build, never a pass', () => {
  const renamed: Job = { name: 'checks', steps: [step('Web install', 'success'), step('Build site', 'success'), step('Worker dry runs', 'success')] };
  const f = runFacts(run(1), [renamed]);
  assert.equal(f.web, null);
  assert.equal('Build site' in f.steps, false);
});

test('readings: share of main runs building, medians of the latest windows', () => {
  const skipped: Job = { name: 'checks', steps: [step('Web install', 'success'), step('Web build', 'skipped'), step('Worker dry runs', 'skipped')] };
  const facts = [runFacts(run(1), [checksJob()]), runFacts(run(2), [checksJob('failure')]), runFacts(run(3, 'pull_request', 'b'), [checksJob(), swiftJob]), runFacts(run(4), [skipped])];
  const r = readings(facts);
  assert.deepEqual(r.building, { value: 50, n: 2, run: 2 });
  assert.deepEqual(r.web, { value: 15, n: 2, run: 3 });
  assert.deepEqual(r.mac, { value: 116, n: 1, run: 3 });
  assert.equal(readings([]).building, null);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
});

test('trim keeps only runs a window can reach', () => {
  const many: RunFacts[] = Array.from({ length: 50 }, (_, i) => runFacts(run(i + 1, 'pull_request', 'b'), [checksJob()]));
  assert.deepEqual(trim(many).map((f) => f.id), [50, 49, 48, 47, 46, 45, 44, 43, 42, 41]);
});

test('collectFacts reads only runs newer than the known ones', async () => {
  const calls: string[] = [];
  const get = async (p: string) => {
    calls.push(p);
    if (p.startsWith('actions/workflows/')) return { workflow_runs: [run(5), run(4), run(3)] };
    return { jobs: [checksJob()] };
  };
  const known = [runFacts(run(3), [checksJob()])];
  const facts = await collectFacts(get, known);
  assert.deepEqual(facts.map((f) => f.id), [5, 4, 3]);
  assert.deepEqual(calls.filter((c) => c.startsWith('actions/runs/')), ['actions/runs/5/jobs?per_page=100', 'actions/runs/4/jobs?per_page=100']);
});

test('collectFacts lets a failed read throw, so the caller writes missing', async () => {
  await assert.rejects(collectFacts(async () => Promise.reject(new Error('403')), []));
});

test('a record is ok only with the lane run that measured it, else missing', () => {
  const at = '2026-11-02T00:00:00Z';
  const runUrl = 'https://github.com/Colorado-Startups/legallas/actions/runs/9';
  assert.equal(record('release_reproducible', 1, 1, runUrl, at).status, 'ok');
  assert.equal(record('release_reproducible', 1, 1, null, at).status, 'missing', 'a local run writes no number');
  assert.equal(record('release_gaps', 2, 1, `https://github.com/Colorado-Startups/legallas/commit/${'b'.repeat(40)}`, at).status, 'missing');
  assert.equal(record('web_build_seconds_p50', null, null, runUrl, at).value, null);
});

test('release checks, comparison and parts', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'qs-build-test-'));
  const put = (f: string, body: string | Buffer = 'x') => {
    mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    writeFileSync(path.join(dir, f), body);
  };
  for (const f of ['site/index.html', 'worker-web/room.js', 'worker-mcp/index.js', 'migrations/0001_init.sql', 'migrations/0003_next.sql']) put(f);
  put('site/pdfjs/standard_fonts/LiberationSans-Regular.ttf');
  const c = checks(dir, 0);
  assert.equal(c.cloudflare_limits && c.migrations_unchanged, true);
  assert.equal(c.migrations_numbered, false, 'a gap in the numbering');
  assert.equal(c.third_party_notices, false);
  assert.equal(c.no_gpl_fonts, false, 'not a font');
  const font = (family: string) => {
    const name = Buffer.from(family, 'utf16le').swap16();
    const head = Buffer.alloc(12 + 16);
    head.writeUInt16BE(1, 4);
    head.write('name', 12, 'latin1');
    head.writeUInt32BE(28, 20);
    const table = Buffer.alloc(6 + 12);
    table.writeUInt16BE(1, 2);
    table.writeUInt16BE(18, 4);
    table.writeUInt16BE(3, 6); // platform: Windows, UTF-16BE
    table.writeUInt16BE(1, 12); // name id 1, the family
    table.writeUInt16BE(name.length, 14);
    return Buffer.concat([head, table, name]);
  };
  assert.equal(fontFamily(font('Arimo')), 'Arimo');
  put('site/pdfjs/standard_fonts/LiberationSans-Regular.ttf', font('Liberation Sans'));
  assert.equal(checks(dir, 0).no_gpl_fonts, false, 'Liberation Sans itself');
  put('site/pdfjs/standard_fonts/LiberationSans-Regular.ttf', font('Arimo'));
  assert.equal(checks(dir, 0).no_gpl_fonts, true, 'Arimo (OFL-1.1) at the name pdf.js asks for');
  assert.equal(checks(dir, 1).migrations_unchanged, false, 'one migration edited after it landed');
  put('migrations/0002_mid.sql');
  put('site/THIRD-PARTY-NOTICES', 'pdf.js: Apache-2.0');
  assert.equal(checks(dir, 0).migrations_numbered, true);
  put('migrations/0003_same.sql');
  assert.equal(checks(dir, 0).migrations_numbered, false, 'two migrations share a number');
  rmSync(path.join(dir, 'migrations/0003_same.sql'));
  assert.equal(checks(dir, 0).third_party_notices, true);
  rmSync(path.join(dir, 'worker-mcp'), { recursive: true });
  assert.equal(checks(dir, 0).cloudflare_limits, false, 'a Worker missing from the release');

  const a = new Map([['x', '1'], ['y', '2']]);
  assert.deepEqual(compare(a, new Map(a)), { compared: 2, differ: 0 });
  assert.deepEqual(compare(a, new Map([['x', '1'], ['z', '2']])), { compared: 3, differ: 2 });

  assert.equal(partOf('worker-mcp/index.js.map'), 'maps');
  assert.equal(partOf('site/_astro/rive.C9yezqQz.wasm'), 'rive');
  assert.equal(partOf('site/pdfjs/standard_fonts/LiberationSans-Bold.ttf'), 'liberation');
  assert.equal(partOf('site/pdfjs/cmaps/Adobe-GB1-UCS2.bcmap'), 'pdfjs');
  assert.equal(partOf('NOTICE'), 'other');
});

test('the baseline lens scores in PLAN.md, and its totals, scored by core/score.ts', async () => {
  const { readFileSync } = await import('node:fs');
  const { scorePage } = await import('../../core/score.ts');
  const manifest = { ...JSON.parse(readFileSync(new URL('manifest.json', import.meta.url), 'utf8')), signoff_comment: 1 };
  const at = '2026-11-02T00:00:00Z';
  const rec = (id: string, value: number | null) =>
    ({ id, page: 'build', value, status: value === null ? 'missing' : 'ok', stage: 'lab', measured_at: value === null ? null : at, source_url: null, sample_size: value === null ? null : 10 }) as const;
  const score = (values: Record<string, number | null>) => scorePage('build', manifest, Object.entries(values).map(([id, v]) => rec(id, v)), new Date(at));
  // The lens scores to a tenth, as PLAN.md states them.
  const lenses = (values: Record<string, number | null>) => {
    const s = score(values);
    return [s.exact_quality, s.exact_speed, s.exact_consumption].map((v) => Math.round(v * 10) / 10);
  };
  const baseline = { main_commits_building: 100, release_reproducible: 1, release_gaps: 2, web_build_seconds_p50: 8, mac_build_seconds_p50: 118 };
  assert.deepEqual(lenses(baseline), [80, 94.6, 0]);
  assert.equal(score(baseline).total, 58);
  const missing = { ...baseline, release_reproducible: null };
  assert.deepEqual(lenses(missing), [46.7, 94.6, 0], 'missing scores 0');
  assert.equal(score(missing).total, 47, 'missing scores 0');
  const fixed = { ...baseline, release_gaps: 0 };
  assert.deepEqual(lenses(fixed), [100, 94.6, 0], 'the two release fixes');
  assert.equal(score(fixed).total, 64, 'the two release fixes');
  const atGoal = score({ ...fixed, mac_build_seconds_p50: 60, lane_minutes: 5, release_gzip_bytes: 4_800_000 });
  assert.deepEqual([atGoal.total, atGoal.consumption], [100, 100]);
});

test('a migration edited after it landed is caught, and a revert clears it', async () => {
  const { execFileSync } = await import('node:child_process');
  const { editedMigrations } = await import('./release.ts');
  const repo = mkdtempSync(path.join(os.tmpdir(), 'qs-build-git-'));
  // A throwaway repository: no global config, so no signing or hooks from the machine running the test.
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', ...args], { cwd: repo, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' } });
  const file = path.join(repo, 'web/migrations/0001_init.sql');
  git('init', '-q');
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, 'CREATE TABLE t (id INTEGER);\n');
  git('add', '.');
  git('commit', '-q', '-m', 'add');
  assert.equal(editedMigrations(repo), 0);
  writeFileSync(file, 'CREATE TABLE t (id INTEGER, x TEXT);\n');
  git('commit', '-qam', 'edit');
  assert.equal(editedMigrations(repo), 1);
  writeFileSync(file, 'CREATE TABLE t (id INTEGER);\n');
  git('commit', '-qam', 'revert');
  assert.equal(editedMigrations(repo), 0);
});

test('the page renders from the build context, and Road to 100 lists each metric short of goal by gain', async () => {
  const { readFileSync } = await import('node:fs');
  const { scorePage } = await import('../../core/score.ts');
  const { joinMetrics } = await import('../../contract/validate.ts');
  const { render, roadFixes } = await import('./page.ts');
  // Scored as a signed-off list, as the baseline test does: an unsigned list takes no readings.
  const manifest = { ...JSON.parse(readFileSync(new URL('manifest.json', import.meta.url), 'utf8')), signoff_comment: 1 };
  const at = '2026-11-02T00:00:00Z';
  const values: Record<string, number | null> = { main_commits_building: 100, release_reproducible: null, release_gaps: 2, web_build_seconds_p50: 8, mac_build_seconds_p50: 118, release_gzip_bytes: 6_043_346 };
  const records = Object.entries(values).map(([id, value]) =>
    value === null
      ? { id, page: 'build' as const, value, status: 'missing' as const, stage: 'lab' as const, measured_at: null, source_url: null, sample_size: null }
      : { id, page: 'build' as const, value, status: 'ok' as const, stage: 'lab' as const, measured_at: at, source_url: 'https://github.com/Colorado-Startups/legallas/actions/runs/1', sample_size: 10 });
  const score = scorePage('build', manifest, records, new Date(at));
  const metrics = joinMetrics(manifest, records);
  const fixes = roadFixes({ score, metrics });
  assert.deepEqual(fixes.map((f) => f.id), ['release_reproducible', 'lane_minutes', 'release_gaps', 'release_gzip_bytes', 'mac_build_seconds_p50']);
  // A third of each lens, as the total counts them.
  const gain = (f: { q: number; s: number; c?: number }) => (f.q + f.s + (f.c ?? 0)) / 3;
  const total = fixes.reduce((sum, f) => sum + gain(f), gain({ q: score.exact_quality, s: score.exact_speed, c: score.exact_consumption }));
  assert.ok(Math.abs(total - 100) < 1e-9, 'the fixes add up to 100');
  assert.match(render({ score, metrics, history: [], others: {}, detail: null }).body, /Road to 100/);
});

test('the lane detail passes core/detail.ts, and the page draws the release checks and parts from it', async () => {
  const { readFileSync, mkdtempSync: mk } = await import('node:fs');
  const { isDetail } = await import('../../core/detail.ts');
  const { scorePage } = await import('../../core/score.ts');
  const { writeDetail } = await import('./collect.ts');
  const { render } = await import('./page.ts');
  const dir = mk(path.join(os.tmpdir(), 'qs-build-detail-'));
  const checks = { migrations_numbered: true, migrations_unchanged: true, third_party_notices: false, no_gpl_fonts: true, cloudflare_limits: true };
  writeDetail(dir, [runFacts(run(1), [checksJob(), swiftJob])], { checks, parts: { site: 1_900_000, maps: 3_200_000 } });
  const detail = JSON.parse(readFileSync(path.join(dir, 'detail.json'), 'utf8'));
  assert.ok(isDetail(detail));
  assert.deepEqual(detail.checks.third_party_notices, 0);
  const runs = JSON.parse(readFileSync(path.join(dir, 'page/runs.json'), 'utf8'));
  assert.deepEqual(runs.main, [{ sha: 'aaaaaaa', steps: { 'Web install': 1, 'Web build': 1, 'Worker dry runs': 1, 'Build (Debug)': 1, 'Build (Release)': 1, 'App bundle': 1, 'LegallasCore for iOS': 1 } }]);
  assert.equal(JSON.parse(readFileSync(path.join(dir, 'facts/runs.json'), 'utf8')).length, 1);
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', import.meta.url), 'utf8'));
  const body = render({ score: scorePage('build', manifest, [], new Date()), metrics: [], history: [], others: {}, detail }).body;
  assert.match(body, /Release checks/);
});
