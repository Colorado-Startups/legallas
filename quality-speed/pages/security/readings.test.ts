// SPDX-License-Identifier: Apache-2.0
// The rule these tests hold: a scan that can't be proven reads as null, never as a clean zero. All data here is invented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  allIgnored,
  scanMinutes,
  compilePatterns,
  countsAsFinding,
  CRITICAL_HIGH,
  dependabotAgrees,
  drillResults,
  drillsPass,
  fixHours,
  forbiddenInHistory,
  gateCoverage,
  keysFromReadOut,
  lockfilesScanned,
  matchHash,
  MEDIUM_LOW,
  oldestKeyDays,
  openCount,
  osvOpen,
  p90,
  parsePaths,
  parseReadOut,
  parseSecretScan,
  requiredKeyReadOuts,
  sastCounts,
  scannersUnblinded,
  scorecardAtGoal,
  secretsInHistory,
  stillOpen,
  wholeHistoryRead,
  type Alert,
  type SemgrepFinding,
  type SemgrepOutput,
  type TriageEntry,
  type UnscoredRule,
} from './readings.ts';

const CLEAN_LOG = 'INF 119 commits scanned.\nINF scanned ~13173543 bytes in 1.58s\nINF no leaks found\n';
const LEAK_LOG = 'RuleID: some-rule\nINF 119 commits scanned.\nWRN leaks found: 2\n';

test('a clean secret scan needs exit 0 and the words to match', () => {
  assert.deepEqual(parseSecretScan(0, CLEAN_LOG), { commits: 119, leaks: 0 });
  assert.deepEqual(parseSecretScan(1, LEAK_LOG), { commits: 119, leaks: 2 });
  assert.equal(parseSecretScan(0, ''), null, 'no summary at all');
  assert.equal(parseSecretScan(null, CLEAN_LOG), null, 'never ran');
  assert.equal(parseSecretScan(2, CLEAN_LOG), null, 'an error exit');
  assert.equal(parseSecretScan(0, LEAK_LOG), null, 'exit 0 that reports leaks');
  assert.equal(parseSecretScan(1, CLEAN_LOG), null, 'exit 1 that reports none');
});

test('a zero from the secret scan counts only if it reached the whole history', () => {
  const scan = { commits: 119, leaks: 0 };
  assert.equal(secretsInHistory(scan, 119, 43, 43), 0);
  assert.equal(secretsInHistory(scan, 120, 43, 43), null, 'a commit was not scanned');
  assert.equal(secretsInHistory(scan, 0, 43, 43), null, 'an empty history proves nothing');
  assert.equal(secretsInHistory(scan, 119, 10, 43), null, 'most pull requests were not fetched');
  assert.equal(secretsInHistory(scan, 119, 40, 43), 0, 'pull requests opened during the run are allowed');
  assert.equal(secretsInHistory(scan, null, 43, 43), null);
  assert.equal(secretsInHistory(null, 119, 43, 43), null);
  assert.equal(secretsInHistory({ commits: 119, leaks: 3 }, 119, 43, 43), 3);
});

test('the history counts as read only from a full checkout with every pull request head fetched', () => {
  assert.equal(wholeHistoryRead('false', 0), true);
  assert.equal(wholeHistoryRead('true', 0), false, 'shallow');
  assert.equal(wholeHistoryRead(undefined, 0), false, 'never checked');
  assert.equal(wholeHistoryRead('', 0), false);
  assert.equal(wholeHistoryRead('false', 1), false, 'the fetch failed');
  assert.equal(wholeHistoryRead('false', null), false, 'the fetch never ran');
});

test('any file that can blind a scanner means no scan is trusted, and so does not having looked', () => {
  assert.equal(scannersUnblinded(0, ''), true);
  assert.equal(scannersUnblinded(0, '\n'), true);
  assert.equal(scannersUnblinded(0, '.gitleaksignore\n'), false);
  assert.equal(scannersUnblinded(1, ''), false, 'the look failed');
  assert.equal(scannersUnblinded(null, ''), false, 'it never looked');
  assert.equal(scannersUnblinded(0, null), false, 'no list to read');
});

const patterns = compilePatterns(['(^|/)\\.dev\\.vars(\\.(?!example$)[^/]+)?$', '(^|/)CaseData/', '\\.store(-shm|-wal)?$']);

test('forbidden paths are counted, and an empty listing proves nothing', () => {
  assert.equal(forbiddenInHistory(0, ['web/src/app.ts', 'README.md'], patterns), 0);
  assert.equal(forbiddenInHistory(0, ['web/.dev.vars', 'a/CaseData/b.pdf', 'README.md'], patterns), 2);
  assert.equal(forbiddenInHistory(0, [], patterns), null);
  assert.equal(forbiddenInHistory(1, ['README.md'], patterns), null);
  assert.equal(forbiddenInHistory(null, ['README.md'], patterns), null);
  assert.equal(forbiddenInHistory(0, ['README.md'], []), null);
});

test('a forbidden path is caught however it is named or cased, and a committed example is allowed', () => {
  const paths = parsePaths('CaseData/Résumé – Exhibit.pdf\0casedata/lower.pdf\0café.store\0web/.dev.vars.staging\0\n\0web/.dev.vars.example\0README.md\0');
  assert.deepEqual(paths, ['CaseData/Résumé – Exhibit.pdf', 'casedata/lower.pdf', 'café.store', 'web/.dev.vars.staging', 'web/.dev.vars.example', 'README.md']);
  assert.equal(forbiddenInHistory(0, paths, patterns), 4);
});

test('every sample path must be ignored', () => {
  assert.equal(allIgnored(['a', 'b'], ['b', 'a']), 1);
  assert.equal(allIgnored(['a', 'b'], ['a']), 0);
  assert.equal(allIgnored([], []), null);
});

const finding = (id: string) => ({ package: { name: 'left-pad', version: '1.0.0' }, groups: [{ ids: [id] }] });
const LOCKS = ['web/package-lock.json', 'quality-speed/package-lock.json'];
const OSV_LOG = 'Scanned /repo/web/package-lock.json file and found 605 packages\nScanned /repo/quality-speed/package-lock.json file and found 1 package\n';

test('osv-scanner must say it read every lockfile, because its report lists only those with findings', () => {
  assert.equal(lockfilesScanned(OSV_LOG, LOCKS), true);
  assert.equal(lockfilesScanned('Scanned /repo/web/package-lock.json file and found 605 packages\n', LOCKS), false, 'one was missed');
  assert.equal(lockfilesScanned(OSV_LOG.replace('605', '0'), LOCKS), false, 'read but empty');
  assert.equal(lockfilesScanned('', LOCKS), false);
  assert.equal(lockfilesScanned(OSV_LOG, []), false, 'no lockfiles proves nothing');
});

test('osv-scanner: only exit 0 and 1 are readings, and the report must agree', () => {
  assert.equal(osvOpen(0, { results: [] }, OSV_LOG, LOCKS), 0);
  assert.equal(osvOpen(1, { results: [{ packages: [finding('A'), finding('B')] }] }, OSV_LOG, LOCKS), 2);
  assert.equal(osvOpen(0, { results: [] }, '', LOCKS), null, 'a clean report with nothing read');
  assert.equal(osvOpen(127, { results: [] }, OSV_LOG, LOCKS), null, 'a general error');
  assert.equal(osvOpen(128, { results: [] }, OSV_LOG, LOCKS), null, 'no lockfile found');
  assert.equal(osvOpen(0, { results: [{ packages: [finding('A')] }] }, OSV_LOG, LOCKS), null, 'exit 0 with findings');
  assert.equal(osvOpen(1, { results: [] }, OSV_LOG, LOCKS), null, 'exit 1 with none');
  assert.equal(osvOpen(0, null, OSV_LOG, LOCKS), null);
  assert.equal(osvOpen(0, {}, OSV_LOG, LOCKS), null);
});

const semgrep = (rule: string, path: string, line = 1, category = 'security'): SemgrepFinding => ({
  check_id: `typescript.rules.${rule}`,
  path: `/src/${path}`,
  start: { line },
  end: { line },
  extra: { severity: 'WARNING', metadata: { category } },
});
const NOT_SCORED: readonly UnscoredRule[] = [{ rule: 'named-rule', audited_hits: 1, not_counted_under: 'quality-speed/' }];

test('a finding counts when it is about security, in code that ships, and from no rule named as unscored', () => {
  assert.equal(countsAsFinding(semgrep('r', 'web/a.ts'), NOT_SCORED), true);
  assert.equal(countsAsFinding(semgrep('named-rule', 'web/a.ts'), NOT_SCORED), false);
  assert.equal(countsAsFinding(semgrep('r', 'web/a.test.ts'), NOT_SCORED), false, 'a test file never ships');
  assert.equal(countsAsFinding(semgrep('r', 'web/a.ts', 1, 'correctness'), NOT_SCORED), false);
  assert.equal(countsAsFinding({ check_id: 'x', path: 'a.ts', extra: {} }, NOT_SCORED), false);
});

test('a line hash follows the text, not the line number, and changes when the text does', () => {
  const before = 'one\n  flagged();\nthree\n';
  const moved = 'zero\none\n    flagged();\nthree\n';
  assert.equal(matchHash(before, 2, 2), matchHash(moved, 3, 3), 'moved and reindented');
  assert.notEqual(matchHash(before, 2, 2), matchHash('one\n  flagged(input);\nthree\n', 2, 2), 'edited');
  assert.match(matchHash(before, 2, 2), /^[0-9a-f]{16}$/);
});

const scannedPaths = { scanned: Array.from({ length: 1000 }, (_, i) => `/src/file${i}.ts`) };
const report: SemgrepOutput = {
  paths: scannedPaths,
  errors: [],
  results: [semgrep('real', 'web/a.ts', 1), semgrep('read', 'web/b.ts', 2), semgrep('named-rule', 'web/c.ts'), semgrep('noise', 'web/d.ts', 1, 'correctness')],
};
const entry: TriageEntry = { rule: 'read', path: 'web/b.ts', line_hash: 'h2', reason: 'read it; the input is a constant' };
const options = (triage: readonly TriageEntry[], more = {}) => ({ triage, audited: NOT_SCORED, codeFiles: 1000, hashOf: (f: SemgrepFinding) => `h${f.start?.line}`, ...more });

test('Semgrep counts findings, and triage needs the exact rule, path and line', () => {
  assert.deepEqual(sastCounts(0, report, options([])), {
    open: 2, triaged: 0, stale: 0, audited: 1, scanned: 1000, parseWarnings: 0, byRule: { real: 1, read: 1, 'named-rule': 1 },
    unjudged: [{ rule: 'real', path: 'web/a.ts', line: 1, hash: 'h1' }, { rule: 'read', path: 'web/b.ts', line: 2, hash: 'h2' }], staleReasons: [], auditedOff: [],
  });
  assert.equal(sastCounts(0, report, options([entry]))?.open, 1);
  assert.equal(sastCounts(0, report, options([entry]))?.triaged, 1);
  assert.equal(sastCounts(0, report, options([{ ...entry, path: 'web/other.ts' }]))?.triaged, 0, 'the same rule elsewhere');
  assert.equal(sastCounts(0, report, options([{ ...entry, rule: 'other' }]))?.triaged, 0, 'another rule on that line');
  assert.equal(sastCounts(0, report, options([{ ...entry, line_hash: 'changed' }]))?.triaged, 0, 'the line changed');
});

test('a mark is not a reason, and a reason for a finding that has gone counts against the page', () => {
  assert.equal(sastCounts(0, report, options([{ ...entry, reason: '.' }]))?.triaged, 0);
  const stale = sastCounts(0, report, options([entry, { ...entry, path: 'web/gone.ts' }]));
  assert.equal(stale?.stale, 1);
  assert.equal(stale?.open, 2, 'one real finding and one stale reason');
});

test('everything counted as open is listed, so each one can be found', () => {
  const twoHits = { ...report, results: [...(report.results ?? []), semgrep('named-rule', 'web/e.ts')] };
  const counts = sastCounts(0, twoHits, options([entry, { ...entry, path: 'web/gone.ts' }]));
  assert.deepEqual(counts?.unjudged, [{ rule: 'real', path: 'web/a.ts', line: 1, hash: 'h1' }]);
  assert.deepEqual(counts?.staleReasons, [{ rule: 'read', path: 'web/gone.ts', hash: 'h2' }]);
  assert.deepEqual(counts?.auditedOff, [{ rule: 'named-rule', hits: 2, read: 1 }]);
  assert.equal(counts?.open, 3, 'the three lists add up to the count');
});

test('one judgment covers one finding, so a copied line needs its own', () => {
  const copied = { ...report, results: [semgrep('named-rule', 'web/a.ts'), semgrep('read', 'web/b.ts', 2), semgrep('read', 'web/b.ts', 2)] };
  const counts = sastCounts(0, copied, options([entry]));
  assert.equal(counts?.triaged, 1);
  assert.equal(counts?.open, 1);
});

test('an audited rule counts as open by any difference from the hits the audit read, in the code it covers', () => {
  const withHits = (...paths: string[]) => ({ ...report, results: paths.map((path) => semgrep('named-rule', path)) });
  assert.deepEqual(sastCounts(0, withHits('web/a.ts'), options([]))?.open, 0, 'within what the audit read');
  assert.equal(sastCounts(0, withHits('web/a.ts', 'web/b.ts'), options([]))?.open, 1, 'one more than it read');
  assert.equal(sastCounts(0, withHits(), options([]))?.open, 1, 'one fewer than it read, which would leave room for a new one');
  assert.equal(sastCounts(0, withHits('web/a.ts', 'web/b.ts'), options([]))?.audited, 1);
  assert.equal(sastCounts(0, withHits('web/a.ts', 'quality-speed/core/x.ts'), options([]))?.open, 0, 'a folder it names');
  assert.equal(sastCounts(0, withHits('web/a.ts', 'web/a.test.ts'), options([]))?.open, 0, 'a test file');
  assert.equal(sastCounts(0, withHits('web/a.ts', 'web/b.ts'), options([], { audited: [{ rule: 'named-rule', audited_hits: 1 }] }))?.open, 1, 'no folder named');
  assert.equal(sastCounts(0, withHits('web/a.ts', 'quality-speed/core/x.ts'), options([], { audited: [{ rule: 'named-rule', audited_hits: 1 }] }))?.open, 1, 'no folder named, so it counts');
});

test('Semgrep proves nothing if it errored or read too little', () => {
  assert.equal(sastCounts(0, { ...report, errors: [{ level: 'error' }] }, options([])), null, 'an error');
  assert.equal(sastCounts(0, { ...report, errors: [{ level: 'warn' }] }, options([]))?.parseWarnings, 1, 'one file partly parsed');
  assert.equal(sastCounts(0, { ...report, errors: Array.from({ length: 21 }, () => ({ level: 'warn' })) }, options([])), null, 'too many partly parsed');
  assert.equal(sastCounts(0, { ...report, paths: { scanned: ['/src/a.ts'] } }, options([])), null, 'barely read anything');
  assert.equal(sastCounts(0, report, options([], { codeFiles: 1200 })), null, 'under 90% of the code');
  assert.equal(sastCounts(0, report, options([], { codeFiles: null })), null, 'nothing to compare with');
  const textOnly = { ...report, paths: { scanned: Array.from({ length: 1000 }, (_, i) => `/src/note${i}.md`) } };
  assert.equal(sastCounts(0, textOnly, options([])), null, 'it read plenty, but none of it code');
  assert.equal(sastCounts(2, report, options([])), null, 'a fatal exit');
  assert.equal(sastCounts(0, null, options([])), null);
  assert.equal(sastCounts(0, { paths: scannedPaths, errors: [] }, options([])), null, 'no results list');
  assert.equal(sastCounts(0, { paths: scannedPaths, results: [] }, options([])), null, 'no errors list');
});

const HEAD = 'abc';

test('Scorecard: held checks at their own goal, and one that could not run spoils the reading', () => {
  const card = { repo: { commit: HEAD }, checks: [{ name: 'A', score: 10 }, { name: 'B', score: 9 }, { name: 'C', score: -1 }] };
  assert.equal(scorecardAtGoal(0, card, { A: 10 }, HEAD), 100);
  assert.equal(scorecardAtGoal(0, card, { A: 10, B: 10 }, HEAD), 50, 'a 9 is short of a goal of 10');
  assert.equal(scorecardAtGoal(0, card, { A: 10, B: 9 }, HEAD), 100, 'a 9 meets a goal of 9');
  assert.equal(scorecardAtGoal(0, { ...card, checks: [{ name: 'B', score: 8 }] }, { B: 9 }, HEAD), 0, 'a regression below the goal counts');
  assert.equal(scorecardAtGoal(0, card, { A: 10, C: 10 }, HEAD), null, 'inconclusive');
  assert.equal(scorecardAtGoal(0, card, { A: 10, Missing: 10 }, HEAD), null, 'absent');
  assert.equal(scorecardAtGoal(1, card, { A: 10 }, HEAD), null, 'failed run');
  assert.equal(scorecardAtGoal(0, { checks: card.checks }, { A: 10 }, HEAD), null, 'no commit means no proof');
  assert.equal(scorecardAtGoal(0, card, { A: 10 }, 'another'), null, 'it scanned some other commit');
  assert.equal(scorecardAtGoal(0, card, {}, HEAD), null);
});

const drills = {
  secretScan: { commits: 1, leaks: 1 },
  pathsRc: 0,
  paths: ['web/.dev.vars', 'CaseData/Résumé – planted.pdf'],
  osvRc: 1,
  osv: { results: [{ packages: [finding('A')] }] },
  osvLog: 'Scanned /tmp/x/package-lock.json file and found 1 package\n',
  sastRc: 0,
  sast: { paths: { scanned: ['/src/planted.js'] }, errors: [], results: [semgrep('r', 'planted.js')] },
};

test('drills pass only when every planted problem is found', () => {
  assert.equal(drillsPass(drills, patterns), 1);
  assert.deepEqual(drillResults(drills, patterns), { secret: true, path: true, osv: true, sast: true });
  assert.equal(drillsPass({ ...drills, secretScan: { commits: 1, leaks: 0 } }, patterns), 0);
  assert.equal(drillsPass({ ...drills, secretScan: null }, patterns), 0);
  assert.equal(drillsPass({ ...drills, paths: ['README.md'] }, patterns), 0);
  assert.equal(drillsPass({ ...drills, paths: ['web/.dev.vars', '"CaseData/R\\303\\251sum\\303\\251.pdf"'] }, patterns), 0, 'git quoted one, so the fix has come undone');
  assert.equal(drillsPass({ ...drills, osvRc: 0, osv: { results: [] } }, patterns), 0);
  assert.equal(drillsPass({ ...drills, sast: { paths: drills.sast.paths, errors: [], results: [] } }, patterns), 0);
  assert.equal(drillsPass({ ...drills, osvRc: null }, patterns), null, 'a drill that never ran is not a pass or a fail');
  assert.equal(drillsPass({ ...drills, sastRc: null }, patterns), null);
});

const NOW = Date.parse('2031-03-20T00:00:00Z');
const alert = (severity: string, created: string, more: Partial<Alert> = {}, advisory: Partial<Alert['security_advisory']> = {}): Alert => ({
  state: 'open',
  created_at: created,
  security_advisory: { severity, ...advisory },
  ...more,
});
const REASON = 'the package is never loaded at run time';

test('closed means fixed, or dismissed as not real or not reachable with a real comment', () => {
  const dismissed = (reason: string, comment: string | null = REASON) => alert('high', '2031-03-01T00:00:00Z', { state: 'dismissed', dismissed_reason: reason, dismissed_comment: comment });
  assert.equal(stillOpen(alert('high', '2031-03-01T00:00:00Z')), true);
  assert.equal(stillOpen(alert('high', '2031-03-01T00:00:00Z', { state: 'fixed' })), false);
  assert.equal(stillOpen(dismissed('not_used')), false);
  assert.equal(stillOpen(dismissed('inaccurate')), false);
  assert.equal(stillOpen(dismissed('not_used', '.')), true, 'a mark is not a reason');
  assert.equal(stillOpen(dismissed('not_used', null)), true);
  assert.equal(stillOpen(dismissed('no_bandwidth')), true, 'no time leaves it open');
  assert.equal(stillOpen(dismissed('fix_started')), true, 'a fix started is not a fix');
  assert.equal(stillOpen(dismissed('tolerable_risk')), true, 'an accepted risk is still a known weakness');
  assert.equal(stillOpen(alert('high', '2031-03-01T00:00:00Z', { state: 'auto_dismissed' })), true);
});

test('open alerts are counted by severity', () => {
  const alerts = [alert('critical', '2031-03-01T00:00:00Z'), alert('high', '2031-03-01T00:00:00Z'), alert('high', '2031-03-01T00:00:00Z', { state: 'fixed' }), alert('medium', '2031-03-01T00:00:00Z')];
  assert.equal(openCount(alerts, CRITICAL_HIGH), 2);
  assert.equal(openCount(alerts, MEDIUM_LOW), 1);
  assert.equal(openCount([], CRITICAL_HIGH), 0);
});

const ghsa = (id: string, state = 'open') => alert('high', '2031-03-01T00:00:00Z', { state }, { ghsa_id: id });
const osvWith = (...ids: string[][]) => ({ results: [{ packages: [{ groups: ids.map((group) => ({ ids: group })) }] }] });

test('a finding only osv-scanner sees means Dependabot has gone quiet', () => {
  assert.equal(dependabotAgrees(osvWith(), []), true, 'neither sees anything');
  assert.equal(dependabotAgrees(osvWith(['GHSA-a', 'CVE-1']), [ghsa('GHSA-a')]), true);
  assert.equal(dependabotAgrees(osvWith(['GHSA-a']), []), false, 'Dependabot went quiet');
  assert.equal(dependabotAgrees(osvWith(['GHSA-a']), [ghsa('GHSA-b')]), false);
  assert.equal(dependabotAgrees(osvWith(['GHSA-a']), [ghsa('GHSA-a', 'fixed')]), false, 'it says fixed, and the lockfile says not');
  assert.equal(dependabotAgrees(osvWith(['MAL-1']), []), true, 'no GHSA id, so outside what Dependabot reads');
  assert.equal(dependabotAgrees(null, []), false);
});

test('time to fix counts from when the weakness was public, if that is earlier than the alert', () => {
  const late = alert('high', '2031-03-19T00:00:00Z', { state: 'fixed', fixed_at: '2031-03-19T06:00:00Z' }, { published_at: '2031-03-18T00:00:00Z' });
  assert.deepEqual(fixHours([late], CRITICAL_HIGH, NOW), [30]);
  const early = alert('high', '2031-03-19T00:00:00Z', { state: 'fixed', fixed_at: '2031-03-19T06:00:00Z' }, { published_at: '2031-03-19T03:00:00Z' });
  assert.deepEqual(fixHours([early], CRITICAL_HIGH, NOW), [6], 'an alert raised first starts the clock');
  assert.deepEqual(fixHours([alert('high', '2031-03-19T00:00:00Z', { state: 'fixed', fixed_at: '2031-03-19T06:00:00Z' })], CRITICAL_HIGH, NOW), [6], 'no publish date');
});

test('time to fix counts an open alert at its age so far, so waiting never helps', () => {
  const fixed = alert('high', '2031-03-19T00:00:00Z', { state: 'fixed', fixed_at: '2031-03-19T06:00:00Z' });
  const open = alert('high', '2031-03-10T00:00:00Z');
  assert.deepEqual(fixHours([fixed, open], CRITICAL_HIGH, NOW), [6, 240]);
  assert.deepEqual(fixHours([fixed], MEDIUM_LOW, NOW), [], 'another severity');
});

test('closed alerts leave after 30 days, and an open one never does', () => {
  const oldFixed = alert('high', '2031-01-01T00:00:00Z', { state: 'fixed', fixed_at: '2031-02-01T00:00:00Z' });
  const recentFixed = alert('high', '2031-01-01T00:00:00Z', { state: 'fixed', fixed_at: '2031-03-10T00:00:00Z' });
  assert.deepEqual(fixHours([oldFixed], CRITICAL_HIGH, NOW), []);
  assert.equal(fixHours([recentFixed], CRITICAL_HIGH, NOW)?.length, 1, 'timed by when it closed, not when it opened');
  assert.equal(fixHours([alert('high', '2030-01-01T00:00:00Z')], CRITICAL_HIGH, NOW)?.length, 1);
});

test('a dismissal with a real reason stops the clock at the dismissal', () => {
  const dismissed = alert('high', '2031-03-19T00:00:00Z', { state: 'dismissed', dismissed_reason: 'not_used', dismissed_comment: REASON, dismissed_at: '2031-03-19T03:00:00Z' });
  assert.deepEqual(fixHours([dismissed], CRITICAL_HIGH, NOW), [3]);
});

test('an unreadable date makes the reading null, because dropping that alert could read as no events', () => {
  assert.equal(fixHours([alert('high', 'not a date')], CRITICAL_HIGH, NOW), null);
  assert.equal(fixHours([alert('high', '2031-03-19T00:00:00Z', { state: 'fixed', fixed_at: null })], CRITICAL_HIGH, NOW), null);
  assert.deepEqual(fixHours([], CRITICAL_HIGH, NOW), [], 'no alerts at all is a real zero');
  assert.deepEqual(fixHours([alert('medium', 'not a date')], CRITICAL_HIGH, NOW), [], 'another severity is not this reading');
});

test('p90 is nearest-rank, so a small sample reads as its slowest case', () => {
  assert.equal(p90([]), null);
  assert.equal(p90([5]), 5);
  assert.equal(p90([1, 2, 3, 4]), 4);
  assert.equal(p90([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), 9);
  assert.equal(p90([10, 1]), 10, 'order does not matter');
});

test('gate coverage ignores commits with no finished run, and needs at least one that has', () => {
  assert.deepEqual(gateCoverage(['success', 'success']), { percent: 100, sample: 2 });
  assert.deepEqual(gateCoverage(['success', 'none', null]), { percent: 50, sample: 2 });
  assert.deepEqual(gateCoverage(['success', 'skipped', 'skipped']), { percent: 33.3, sample: 3 }, 'a skipped scan did not scan');
  assert.equal(gateCoverage([null]), null);
  assert.equal(gateCoverage([]), null);
});

test('key age is the oldest key, and no keys or an unreadable date proves nothing', () => {
  assert.equal(oldestKeyDays(['2031-03-19T00:00:00Z', '2031-03-10T00:00:00Z'], NOW), 10);
  assert.equal(oldestKeyDays([], NOW), null);
  assert.equal(oldestKeyDays(['2031-03-19T00:00:00Z', 'never'], NOW), null);
});

const READ_OUT = 'HTTP/2.0 200 OK\r\ndate: Wed, 19 Mar 2031 20:00:00 GMT\r\ngithub-authentication-token-expiration: 2031-05-01 00:00:00 UTC\r\nContent-Type: application/json\r\n\r\n{"total_count":2,"secrets":[{"name":"A_KEY","updated_at":"2031-03-01T00:00:00Z"},{"name":"B_KEY","updated_at":"2031-03-10T00:00:00Z"}]}';
const fresh = (text: string) => keysFromReadOut(parseReadOut(text), NOW, 30);

test('a read-out gives its status, its date and the body', () => {
  const parsed = parseReadOut(READ_OUT);
  assert.equal(parsed.status, 200);
  assert.equal(parsed.date, 'Wed, 19 Mar 2031 20:00:00 GMT');
  assert.deepEqual(fresh(READ_OUT), ['2031-03-01T00:00:00Z', '2031-03-10T00:00:00Z']);
});

test('only a recent 200 with a list of keys counts, so a refused or old read never reads as no keys', () => {
  const dated = 'HTTP/2.0 200 OK\ndate: Wed, 19 Mar 2031 20:00:00 GMT\n\n';
  assert.equal(fresh('HTTP/2.0 403 Forbidden\ndate: Wed, 19 Mar 2031 20:00:00 GMT\n\n{"message":"no"}'), null);
  assert.equal(fresh('HTTP/2.0 403 Forbidden\ndate: Wed, 19 Mar 2031 20:00:00 GMT\n\n{"secrets":[]}'), null, 'the status decides, whatever the body says');
  assert.equal(fresh(`${dated}{"other":[]}`), null);
  assert.equal(fresh(`${dated}not json`), null);
  assert.equal(fresh(''), null);
  assert.equal(fresh(`${dated}{"secrets":[{"updated_at":5}]}`), null);
  assert.equal(fresh('HTTP/2.0 200 OK\n\n{"secrets":[]}'), null, 'no date, so no way to know it is recent');
  assert.equal(fresh(READ_OUT.replace('19 Mar', '10 Mar')), null, 'more than 30 hours old');
  assert.deepEqual(fresh(`${dated}{"secrets":[]}`), [], 'an empty list stays empty, and age then proves nothing');
});

test('every environment needs its own list of keys, and unread environments prove nothing', () => {
  const environments = (body: string, status = 200) => parseReadOut(`HTTP/2.0 ${status} OK\n\n${body}`);
  assert.deepEqual(requiredKeyReadOuts(environments('{"environments":[{"name":"one"},{"name":"two"}]}')), [
    'repository-actions-secrets.txt',
    'repository-dependabot-secrets.txt',
    'repository-environments-one-secrets.txt',
    'repository-environments-two-secrets.txt',
  ]);
  assert.deepEqual(requiredKeyReadOuts(environments('{"environments":[]}')), ['repository-actions-secrets.txt', 'repository-dependabot-secrets.txt']);
  assert.equal(requiredKeyReadOuts(null), null, 'never read');
  assert.equal(requiredKeyReadOuts(environments('{"message":"no"}', 403)), null, 'refused');
  assert.equal(requiredKeyReadOuts(environments('{"environments":[]}', 403)), null, 'refused, whatever the body says');
  assert.equal(requiredKeyReadOuts(environments('{"environments":[{"id":1}]}')), null, 'no name to look for');
});

test('scan minutes round up as a runner bills a job, and a scan that did not finish or missed a drill reads missing', () => {
  assert.equal(scanMinutes(0, 1, true), 1);
  assert.equal(scanMinutes(0, 7 * 60_000, true), 7);
  assert.equal(scanMinutes(0, 7 * 60_000 + 1, true), 8);
  assert.equal(scanMinutes(1, 60_000, true), null);
  assert.equal(scanMinutes(null, 60_000, true), null);
  assert.equal(scanMinutes(0, -1, true), null);
  assert.equal(scanMinutes(0, 20_000, false), null, 'a scan whose drills failed may have scanned nothing');
});
