// SPDX-License-Identifier: Apache-2.0
// Green only means safe if red still happens. Each plant hands one of the repository's own gates something it must
// refuse, in a throwaway folder, and each gate has a control it must accept, because a gate that always fails would
// otherwise read as catching everything. A control that goes wrong, or a tool that can't run, throws and the reading is
// missing. The wiring plants check the workflow itself, since a sound script behind `if: false` still catches nothing.
import { spawnSync } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Unreadable } from './measure.ts';
import { jobBlocks, jobNeeds, readWorkflows, runBlock, type SourceFile } from './workflows.ts';

export interface Plant {
  name: string;
  caught: boolean;
}

/** The repository's own git settings stay out of a throwaway folder. */
const GIT_ENV = {
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_AUTHOR_NAME: 'Drill',
  GIT_AUTHOR_EMAIL: 'drill@example.invalid',
  GIT_COMMITTER_NAME: 'Drill',
  GIT_COMMITTER_EMAIL: 'drill@example.invalid',
};

/** Runs a tool. One that can't start or times out throws, so it can never read as a catch. */
function run(command: string, args: readonly string[], cwd: string, env: Record<string, string> = {}): { code: number; output: string } {
  const result = spawnSync(command, args, { cwd, env: { ...process.env, ...GIT_ENV, ...env }, encoding: 'utf8', timeout: 120_000 });
  if (result.error || result.status === null) throw new Unreadable('a tool in the drill did not finish');
  return { code: result.status, output: `${result.stdout}${result.stderr}` };
}

/**
 * Runs a repository script. Its path travels in the environment, never in the argument list: an absolute path built from the
 * working directory is not a command, and `bash -c` reads it as one only through "$DRILL_SCRIPT", which stays one quoted word.
 */
const runScript = (script: string, cwd: string, env: Record<string, string> = {}) =>
  run('bash', ['-c', 'exec bash "$DRILL_SCRIPT"'], cwd, { ...env, DRILL_SCRIPT: script });

const exitCode = (command: string, args: readonly string[], cwd: string, env: Record<string, string> = {}) => run(command, args, cwd, env).code;

function git(cwd: string, ...args: string[]): string {
  const result = run('git', args, cwd);
  if (result.code !== 0) throw new Unreadable('a git step in the drill failed');
  return result.output.trim();
}

function inTempRepo<T>(work: (dir: string) => T): T {
  const dir = mkdtempSync(path.join(tmpdir(), 'qs-drill-'));
  try {
    git(dir, 'init', '-q', '-b', 'main');
    return work(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function commit(dir: string, file: string, text: string, message = 'A change.'): string {
  const full = path.join(dir, file);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, text);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', message);
  return git(dir, 'rev-parse', 'HEAD');
}

function requireControl(passed: boolean, gate: string): void {
  if (!passed) throw new Unreadable(`the drill's control failed: ${gate}`);
}

const blocksOf = (workflows: readonly SourceFile[], file: string) => jobBlocks(workflows.find((f) => f.name === file)?.text ?? '');

/** The gates `ci-ok` reads, from its own `env`: each variable and the job whose result it holds. A new gate joins the drill by itself. */
function gatesOf(lines: readonly string[]): [string, string][] {
  return lines.flatMap((line) => {
    const wired = /^\s*([A-Z_]+): \$\{\{ needs\.([a-z-]+)\.result \}\}\s*$/.exec(line);
    return wired ? [[wired[1] as string, wired[2] as string] as [string, string]] : [];
  });
}

/** `ci-ok` is what a merge requires, so it's run as written, with results it must and mustn't accept. */
export function ciOkPlants(workflows: readonly SourceFile[]): Plant[] {
  const lines = blocksOf(workflows, 'ci.yml').get('ci-ok') ?? [];
  const script = runBlock(lines);
  const gates = gatesOf(lines);
  if (!script || !gates.some(([, job]) => job === 'checks')) throw new Unreadable('ci-ok has no script or results to run');
  const all = (result: string) => Object.fromEntries(gates.map(([env, job]) => [env, job === 'checks' ? 'success' : result]));
  const verdict = (results: Record<string, string>) => exitCode('bash', ['-e', '-c', script], tmpdir(), { ...all('skipped'), ...results });
  requireControl(verdict({}) === 0, 'ci-ok, nothing to do past the checks');
  requireControl(verdict(all('success')) === 0, 'ci-ok, every job passed');
  const plants = gates.flatMap(([env, job]) => ['failure', 'cancelled'].map((result) => ({ name: detailName(job, result), caught: verdict({ [env]: result }) !== 0 })));
  plants.push({ name: 'ci_ok_checks_skipped', caught: verdict({ CHECKS: 'skipped' }) !== 0 });
  plants.push({ name: 'ci_ok_swift_without_ocr', caught: verdict({ SWIFT: 'success', SWIFT_OCR: 'skipped' }) !== 0 });
  return plants;
}

const detailName = (job: string, result: string) => `ci_ok_${job.replaceAll('-', '_')}_${result}`;

/** The script above only matters if CI really feeds it the results, always runs it, and nothing can swallow a failure. */
export function wiringPlants(workflows: readonly SourceFile[]): Plant[] {
  const blocks = blocksOf(workflows, 'ci.yml');
  const ciOk = blocks.get('ci-ok') ?? [];
  // `choose-runner` can fail by design: it isn't a check, and everything falls back to GitHub-hosted without it.
  const gateJobs = [...blocks.keys()].filter((name) => name !== 'ci-ok' && name !== 'choose-runner');
  const needs = jobNeeds(ciOk);
  const read = gatesOf(ciOk).map(([, job]) => job);
  return [
    { name: 'ci_ok_waits_for_every_job', caught: gateJobs.length > 0 && gateJobs.every((name) => needs.includes(name)) },
    { name: 'ci_ok_reads_real_results', caught: gateJobs.length > 0 && gateJobs.every((name) => read.includes(name)) },
    { name: 'ci_ok_always_runs', caught: ciOk.some((line) => /^ {4}if: always\(\)\s*$/.test(line)) && !ciOk.some((line) => /^ {6,}(- )?if:/.test(line)) },
    { name: 'no_gate_continues_on_error', caught: [...gateJobs, 'ci-ok'].every((job) => !(blocks.get(job) ?? []).some((line) => line.includes('continue-on-error'))) },
  ];
}

export function dcoPlant(workflows: readonly SourceFile[]): Plant {
  const script = runBlock(blocksOf(workflows, 'dco.yml').get('dco') ?? []);
  if (!script) throw new Unreadable('dco has no script to run');
  return inTempRepo((dir) => {
    const base = commit(dir, 'a.txt', 'one\n');
    const signed = commit(dir, 'a.txt', 'two\n', 'Signed.\n\nSigned-off-by: Drill <drill@example.invalid>');
    requireControl(exitCode('bash', ['-e', '-c', script], dir, { BASE: base, HEAD: signed }) === 0, 'dco, a signed commit');
    const unsigned = commit(dir, 'a.txt', 'three\n', 'Not signed.');
    return { name: 'dco_missing_sign_off', caught: exitCode('bash', ['-e', '-c', script], dir, { BASE: base, HEAD: unsigned }) !== 0 };
  });
}

/** A Mac job skipped because "nothing changed" counts as passed, so a missed path would be a false green. */
export function changedPathsPlants(root: string): Plant[] {
  const script = path.join(root, '.github/scripts/changed-paths.sh');
  const areas = (dir: string, env: Record<string, string>): Record<string, string> => {
    const output = path.join(dir, '.git', 'drill-output');
    writeFileSync(output, '');
    if (runScript(script, dir, { ...env, GITHUB_OUTPUT: output }).code !== 0) throw new Unreadable('changed-paths.sh did not run');
    return Object.fromEntries(readFileSync(output, 'utf8').trim().split('\n').map((line) => line.split('=') as [string, string]));
  };
  return inTempRepo((dir) => {
    let before = commit(dir, 'README.md', 'one\n');
    let head = commit(dir, 'README.md', 'two\n');
    const pushed = (from: string) => areas(dir, { EVENT_NAME: 'push', PUSH_BEFORE: from });
    const quiet = pushed(before);
    requireControl(quiet.web === 'false' && quiet.swift === 'false' && quiet.workflows === 'false', 'changed-paths, a docs change');
    const plant = (name: string, file: string, area: string): Plant => {
      before = head;
      head = commit(dir, file, `${name}\n`);
      return { name, caught: pushed(before)[area] === 'true' };
    };
    const plants = [
      plant('changed_web', 'web/src/a.ts', 'web'),
      plant('changed_swift', 'Sources/A/a.swift', 'swift'),
      plant('changed_app', 'LegallasApp/a.swift', 'swift'),
      plant('changed_workflow', '.github/workflows/a.yml', 'workflows'),
      plant('changed_office', 'web/scripts/office.ts', 'office'),
    ];
    const gap = pushed('0'.repeat(40));
    plants.push({ name: 'changed_unknown_base_runs_all', caught: gap.web === 'true' && gap.swift === 'true' && gap.workflows === 'true' });

    // A pull request checks out a test merge. This is the mode that decides the only Mac run, since main skips them once tested.
    const prBase = head;
    git(dir, 'checkout', '-q', '-b', 'docs');
    const docsHead = commit(dir, 'docs/a.md', 'docs\n');
    git(dir, 'checkout', '-q', 'main');
    commit(dir, 'Sources/A/b.swift', 'main moved\n');
    git(dir, 'merge', '-q', '--no-ff', '-m', 'Test merge.', 'docs');
    requireControl(areas(dir, { EVENT_NAME: 'pull_request', PR_BASE_SHA: prBase, PR_HEAD_SHA: docsHead }).swift === 'false', 'changed-paths, main moved under a docs pull request');
    git(dir, 'checkout', '-q', '-b', 'swift', prBase);
    const swiftHead = commit(dir, 'Sources/A/c.swift', 'swift\n');
    git(dir, 'checkout', '-q', 'main');
    git(dir, 'merge', '-q', '--no-ff', '-m', 'Test merge.', 'swift');
    plants.push({ name: 'changed_pull_request_swift', caught: areas(dir, { EVENT_NAME: 'pull_request', PR_BASE_SHA: prBase, PR_HEAD_SHA: swiftHead }).swift === 'true' });
    return plants;
  });
}

/** Blacksmith bills past its free minutes, and this guard is its only stop. */
export function guardPlants(root: string): Plant[] {
  const choice = (minutes: string): string => {
    const code = `import os, sys; sys.path.insert(0, os.environ['DRILL_SCRIPTS']); import build_minutes_guard as g; print(g.choose(${minutes})[0])`;
    const result = run('python3', ['-c', code], tmpdir(), { DRILL_SCRIPTS: path.join(root, '.github/scripts') });
    if (result.code !== 0) throw new Unreadable('the build minutes guard did not run');
    return result.output.trim();
  };
  requireControl(choice('0').includes('blacksmith'), 'the guard, with minutes to spare');
  return [
    { name: 'guard_stops_at_its_limit', caught: !choice('g.STOP_MINUTES').includes('blacksmith') },
    { name: 'guard_unknown_is_hosted', caught: !choice('None').includes('blacksmith') },
  ];
}

/** A token made up on the spot, so no such string is ever in this repository. */
function plantedToken(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return `${'ghp'}_${Array.from({ length: 36 }, () => alphabet[randomInt(alphabet.length)]).join('')}`;
}

/** A scan that stops on its own error also exits 1, so a catch must name what it found. */
export function secretScanPlants(root: string): Plant[] {
  const script = path.join(root, '.github/scripts/secret-scan.sh');
  const scan = (dir: string, env: Record<string, string> = {}) => runScript(script, dir, env);
  const found = (result: { code: number; output: string }) => result.code !== 0 && /leaks found: [1-9]/.test(result.output);
  return inTempRepo((dir) => {
    const clean = commit(dir, 'a.txt', 'nothing here\n');
    requireControl(scan(dir).code === 0, 'the secret scan, on a clean history');
    commit(dir, 'config.txt', `token = "${plantedToken()}"\n`);
    // Removed later, it stays in history, which is what the scan is for.
    const head = commit(dir, 'config.txt', 'token = ""\n');
    return [
      { name: 'secret_in_history', caught: found(scan(dir)) },
      { name: 'secret_in_pull_request', caught: found(scan(dir, { EVENT_NAME: 'pull_request', PR_BASE_SHA: clean, PR_HEAD_SHA: head })) },
    ];
  });
}

const CLEAN_WORKFLOW = `name: Clean
on: pull_request
permissions: {}
jobs:
  clean:
    runs-on: ubuntu-latest
    timeout-minutes: 1
    steps:
      - run: echo clean
`;
const INJECTION_WORKFLOW = CLEAN_WORKFLOW.replace('echo clean', ['echo "$', '{{ github.event.pull_request.title }}"'].join(''));

/** Lints the repository's real workflows, leaving out this site's, and plants one the linters must refuse. */
export function lintDrill(root: string, workflows: readonly SourceFile[]): { real: boolean; plant: Plant } {
  const script = path.join(root, '.github/scripts/lint-workflows.sh');
  return inTempRepo((dir) => {
    const folder = path.join(dir, '.github/workflows');
    mkdirSync(folder, { recursive: true });
    const config = path.join(root, '.github/actionlint.yaml');
    if (existsSync(config)) copyFileSync(config, path.join(dir, '.github/actionlint.yaml'));
    writeFileSync(path.join(folder, 'clean.yml'), CLEAN_WORKFLOW);
    requireControl(runScript(script, dir).code === 0, 'the workflow lint, on a clean workflow');
    writeFileSync(path.join(folder, 'clean.yml'), INJECTION_WORKFLOW);
    const planted = runScript(script, dir);
    const plant = { name: 'workflow_template_injection', caught: planted.code !== 0 && /template-injection|potentially untrusted/.test(planted.output) };
    rmSync(path.join(folder, 'clean.yml'));
    for (const file of workflows) writeFileSync(path.join(folder, file.name), file.text);
    return { real: runScript(script, dir).code === 0, plant };
  });
}

/** Every plant that needs no download, for the tests and as part of the full drill. */
export function localPlants(root: string): Plant[] {
  const workflows = readWorkflows(root);
  return [...ciOkPlants(workflows), ...wiringPlants(workflows), dcoPlant(workflows), ...changedPathsPlants(root), ...guardPlants(root)];
}
