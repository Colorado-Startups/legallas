// SPDX-License-Identifier: Apache-2.0
// Holds the reviewed lists this page's scores rest on. Shrinking one would lift a score with nothing fixed, and the goal
// check reads only manifest.json. So loosening any of them means loosening this test, which REVIEW.md rule 4 blocks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isDetail } from '../../core/detail.ts';
import { compilePatterns, MIN_REASON_LENGTH, sastRuleId, scorecardId, type TriageEntry } from './readings.ts';

const here = (name: string) => new URL(name, import.meta.url);
const json = <T>(name: string): T => JSON.parse(readFileSync(here(name), 'utf8')) as T;

const forbidden = json<{ never_in_history: string[]; must_be_ignored: string[] }>('./forbidden-paths.json');
const scorecard = json<{ held: Record<string, number>; not_held: Record<string, string> }>('./scorecard-checks.json');
const triage = json<{ sast: TriageEntry[]; rules_not_scored: { rule: string; audited_hits: number; not_counted_under: string; reason: string }[] }>('./triage.json');
const manifest = json<{ metrics: { id: string; coverage_metric?: string }[] }>('./manifest.json');
/** The script with its comments gone, so a flag named only in a comment doesn't pass for one in use. */
const code = (text: string) => text.split('\n').filter((line) => !line.trim().startsWith('#')).join('\n');
const scan = code(readFileSync(here('./scan.sh'), 'utf8'));
const secretScan = code(readFileSync(here('../../../.github/scripts/secret-scan.sh'), 'utf8'));

test('every path the page guards is still in both lists', () => {
  const patterns = compilePatterns(forbidden.never_in_history);
  const required = [
    'CaseData/planted.pdf', 'Sources/CaseData/planted.pdf', 'legallas-inbox/planted.pdf', 'web/legallas-inbox/planted.pdf', 'legallas-export.json',
    'planted.store', 'planted.store.bak', 'planted.store-shm', 'planted.store-wal', 'Documents/planted.pdf', 'agent-plan/planted.md', 'web/.dev.vars', 'web/.dev.vars.staging',
    'web/legallas.config.json', 'web/room.config.json', 'web/wrangler.jsonc', 'web/wrangler.mcp.jsonc', 'LegallasApp/Config/Signing.xcconfig',
    'LegallasApp/Config/Room.xcconfig', 'Sources/LegallasCore/Persistence/Planted+Room.swift', 'Sources/LegallasCore/Models/Planted+Room.swift',
    '.env', '.env.local', 'web/.env', '.envrc', 'planted.pem', 'planted.p8', 'planted.p12', 'planted.mobileprovision',
    'id_rsa', 'id_dsa', 'id_ecdsa', 'id_ecdsa_sk', 'id_ed25519', 'id_ed25519_sk', 'web/.wrangler/planted.sqlite',
  ];
  for (const path of required) {
    assert.ok(forbidden.must_be_ignored.includes(path), `${path} is checked against .gitignore`);
    assert.ok(patterns.some((pattern) => pattern.test(path)), `${path} is refused in history`);
  }
  assert.ok(patterns.some((pattern) => pattern.test('planted.store.bak')), 'a copy of a store is refused in history too');
  // Exact strings, because a narrower pattern can still pass every sample above.
  for (const pattern of [
    '(^|/)CaseData/', '(^|/)legallas-inbox/', '(^|/)legallas-export\\.json$', '\\.store[^/]*$', '^web/\\.wrangler/', '^Documents/', '^agent-plan/',
    '(^|/)\\.dev\\.vars(\\.(?!example$)[^/]+)?$', '^web/legallas\\.config\\.json$', '^web/room\\.config\\.json$', '^web/wrangler\\.jsonc$', '^web/wrangler\\.mcp\\.jsonc$',
    '^LegallasApp/Config/(Signing|Room)\\.xcconfig$', '^Sources/LegallasCore/(Persistence|Models)/[^/]*\\+Room\\.swift$',
    '(^|/)\\.env(\\.(?!example$)[^/]+)?$', '(^|/)\\.envrc$', '\\.(pem|p8|p12|mobileprovision)$', '(^|/)id_(rsa|dsa|ecdsa|ed25519)(_sk)?$',
  ]) assert.ok(forbidden.never_in_history.includes(pattern), pattern);
});

test('a committed example is not forbidden, so the list stays true', () => {
  const patterns = compilePatterns(forbidden.never_in_history);
  for (const path of ['web/.dev.vars.example', '.env.example', 'web/wrangler.example.jsonc', 'web/legallas.config.example.json']) {
    assert.ok(!patterns.some((pattern) => pattern.test(path)), path);
  }
});

test('the checks held to a goal are all still held, none lower', () => {
  for (const name of ['Binary-Artifacts', 'Dangerous-Workflow', 'Dependency-Update-Tool', 'Pinned-Dependencies', 'Security-Policy', 'Token-Permissions', 'Vulnerabilities']) {
    assert.equal(scorecard.held[name], 10, name);
  }
});

test('every Scorecard check is held or has a reason, so a new one gets a decision', () => {
  const all = ['Binary-Artifacts', 'Branch-Protection', 'CI-Tests', 'CII-Best-Practices', 'Code-Review', 'Contributors', 'Dangerous-Workflow', 'Dependency-Update-Tool', 'Fuzzing', 'License', 'Maintained', 'Packaging', 'Pinned-Dependencies', 'SAST', 'Security-Policy', 'Signed-Releases', 'Token-Permissions', 'Vulnerabilities'];
  for (const name of all) {
    assert.ok(name in scorecard.held || (scorecard.not_held[name] ?? '').length >= MIN_REASON_LENGTH, name);
  }
});

test('each judged finding names its exact line and gives a reason', () => {
  const seen = new Set<string>();
  for (const entry of triage.sast) {
    const key = `${entry.rule}|${entry.path}|${entry.line_hash}`;
    assert.match(entry.line_hash, /^[0-9a-f]{16}$/, key);
    assert.ok(entry.reason.trim().length >= MIN_REASON_LENGTH, key);
    assert.ok(!/\.test\.[a-z]+$/.test(entry.path), `${key}: a test file needs no entry`);
    assert.doesNotMatch(entry.reason, /^accept/i, `${key}: an accepted risk is still a known weakness, so it stays open`);
    assert.ok(!seen.has(key), `${key} repeats`);
    seen.add(key);
  }
});

test('only the one rule the audit covered goes unscored', () => {
  assert.deepEqual(triage.rules_not_scored.map((entry) => entry.rule), ['html-in-template-string']);
  for (const entry of triage.rules_not_scored) {
    assert.ok(entry.reason.length >= MIN_REASON_LENGTH);
    assert.equal(entry.not_counted_under, 'quality-speed/');
  }
});

test('an inline comment can not excuse a secret, in the gate or the page', () => {
  assert.ok(secretScan.includes('--ignore-gitleaks-allow'), 'the flag is in use in the secret scan');
  assert.match(readFileSync(here('./scan.sh'), 'utf8'), /allow_comment="gitleaks"":allow"/, 'the planted secret carries the comment');
});

test('the scan keeps its rules, its isolation and everything that stops it being blinded', () => {
  for (const dir of ['javascript', 'typescript', 'python', 'bash', 'swift', 'html', 'yaml/github-actions', 'generic/secrets']) {
    assert.ok(new RegExp(`SEMGREP_RULE_DIRS=\\([^)]*\\b${dir.replace('/', '\\/')}\\b`).test(scan), dir);
  }
  for (const flag of ['--disable-nosem', '--network=none', ':/src:ro', 'core.quotePath=false', '--metrics=off', 'ls-files -z', '--diff-merges=first-parent', '-diff(=[^[:space:]]*)?']) assert.ok(scan.includes(flag), flag);
  for (const name of ['.gitleaks\\.toml', '.gitleaksignore', '.gitleaks\\.baseline', '.semgrepignore', 'osv-scanner\\.toml', '.osv-scanner\\.toml']) {
    assert.ok(scan.includes(name), `${name} counts as blinding a scanner`);
  }
  assert.doesNotMatch(scan, /semgrep[^\n]*--exclude/);
  // A -diff attribute hides a file's text from the secret scan. Only the lockfile and the Rive binaries may have one.
  assert.ok(scan.includes('.gitattributes'), 'attributes count as blinding a scanner');
  assert.ok(scan.includes('(web/package-lock\\.json|\\*\\.riv)'), 'and the exempt files are exactly these');
});

test('the lanes that read alerts or keys stay on the runners that can', () => {
  // The plain linux runner has no scope for alerts and 10 minutes, so the scan on it would read as missing with no other error.
  const lanes = json<{ id: string; runner: string; cadence: string; admin?: boolean }[]>('./lanes.json');
  const byId = new Map(lanes.map((lane) => [lane.id, lane]));
  assert.equal(byId.get('scan')?.runner, 'linux-hosted');
  assert.equal(byId.get('keys')?.runner, 'linux-hosted');
  assert.equal(byId.get('keys')?.admin, true);
  assert.deepEqual([...byId.keys()].sort(), ['gate', 'keys', 'scan']);
});

test('the drills stay what lets a clean record count', () => {
  const byId = new Map(manifest.metrics.map((metric) => [metric.id, metric]));
  for (const id of ['time_to_fix_critical_high_hours', 'time_to_fix_medium_low_hours']) assert.equal(byId.get(id)?.coverage_metric, 'scanner_drills_passing', id);
});

test('every known rule and check makes a usable detail id, because one bad id loses the whole file', () => {
  const rules = [...triage.sast, ...triage.rules_not_scored].map((entry) => entry.rule);
  const checks = [...Object.keys(scorecard.held), ...Object.keys(scorecard.not_held)];
  assert.ok(rules.includes('insufficient-postmessage-origin-validation'), 'the longest rule seen so far is in this test');
  const readings = Object.fromEntries([...rules.map(sastRuleId), ...checks.map(scorecardId)].map((id) => [id, { value: 1, limit: null, n: 1 }]));
  assert.ok(isDetail({ checks: {}, readings }));
});
