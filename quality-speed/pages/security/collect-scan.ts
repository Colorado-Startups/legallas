// SPDX-License-Identifier: Apache-2.0
// The long lane: runs scan.sh, then reads what it left, along with Dependabot's records to set beside osv-scanner's. The raw
// output stays in a temporary folder and is deleted here, so only counts leave: findings can name paths and code. The scan's
// log gets each step's exit code and nothing else.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { MetricRecord } from '../../contract/format.ts';
import { finish, githubList, noEvents, reading, record, repository, runContext, type DetailOut, type RunContext } from './lane.ts';
import {
  allIgnored,
  compilePatterns,
  CRITICAL_HIGH,
  dependabotAgrees,
  drillResults,
  drillsPass,
  fixHours,
  forbiddenInHistory,
  matchHash,
  MEDIUM_LOW,
  openCount,
  osvOpen,
  p90,
  parsePaths,
  parseSecretScan,
  repoPath,
  sastCounts,
  scorecardAtGoal,
  sastRuleId,
  scanMinutes,
  scannersUnblinded,
  scorecardId,
  secretsInHistory,
  wholeHistoryRead,
  type Alert,
  type Drills,
  type ScorecardOutput,
  type SemgrepFinding,
  type SemgrepOutput,
  type TriageEntry,
  type UnscoredRule,
} from './readings.ts';

const PAGE_DIR = import.meta.dirname;
/** Under the collector's own 40 minutes, so a stuck scan still reports what it finished. */
const SCAN_TIMEOUT_MS = 22 * 60_000;

const pageJson = <T>(name: string): T => JSON.parse(readFileSync(path.join(PAGE_DIR, name), 'utf8')) as T;

function rawReader(raw: string) {
  const text = (name: string): string | null => {
    try {
      return readFileSync(path.join(raw, name), 'utf8');
    } catch {
      return null;
    }
  };
  const rc = (name: string): number | null => {
    const value = text(`${name}.rc`)?.trim();
    return value && /^\d+$/.test(value) ? Number(value) : null;
  };
  const json = <T>(name: string): T | null => {
    const value = text(name);
    if (value === null) return null;
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  };
  const count = (name: string): number | null => {
    const value = text(name)?.trim();
    return value && /^\d+$/.test(value) ? Number(value) : null;
  };
  return { text, rc, json, count };
}

function ignoredSamples(samples: readonly string[]): string[] {
  const run = spawnSync('git', ['check-ignore', '--no-index', '--stdin'], { input: samples.join('\n'), encoding: 'utf8' });
  if (run.status !== 0 && run.status !== 1) throw new Error('git check-ignore failed');
  return run.stdout.split('\n').filter(Boolean);
}

/** The flagged lines' hash, read from the checkout. A file that can't be read matches no reason, so its finding stays open. */
function findingHash(finding: SemgrepFinding): string | null {
  const start = finding.start?.line;
  if (!start) return null;
  try {
    return matchHash(readFileSync(repoPath(finding.path), 'utf8'), start, finding.end?.line ?? start);
  } catch {
    return null;
  }
}

function timeToFix(context: RunContext, id: string, alerts: readonly Alert[] | null, severities: readonly string[], nowMs: number): MetricRecord {
  if (!alerts) return record(context, id, null);
  const hours = fixHours(alerts, severities, nowMs);
  if (!hours) return record(context, id, null);
  const value = p90(hours);
  return value === null ? noEvents(context, id) : record(context, id, Math.round(value * 10) / 10, hours.length);
}


if (import.meta.main) {
  const raw = mkdtempSync(path.join(tmpdir(), 'qs-security-raw-'));
  try {
    const scanStarted = Date.now();
    const scan = spawnSync('bash', [path.join(PAGE_DIR, 'scan.sh'), raw], { stdio: 'inherit', timeout: SCAN_TIMEOUT_MS });
    const scanElapsedMs = Date.now() - scanStarted;
    if (scan.status !== 0) console.error('::warning title=Security collector::the scan did not finish, so anything it missed reads as missing');
    const r = rawReader(raw);
    const now = Date.now();
    const context = runContext(new Date(now));
    const forbidden = pageJson<{ never_in_history: string[]; must_be_ignored: string[] }>('forbidden-paths.json');
    const patterns = compilePatterns(forbidden.never_in_history);
    const triage = pageJson<{ sast: TriageEntry[]; rules_not_scored: UnscoredRule[] }>('triage.json');
    const heldChecks = pageJson<{ held: Record<string, number> }>('scorecard-checks.json').held;

    const [head = '', shallow, commitsWithText] = (r.text('history.counts') ?? '').trim().split('\n');
    const wholeHistory = wholeHistoryRead(shallow, r.rc('pull_heads'));
    const unblinded = scannersUnblinded(r.rc('blinders'), r.text('blinders.log'));

    const secretScan = parseSecretScan(r.rc('secrets'), r.text('secrets.log') ?? '');
    const pullRequests = await reading('the pull request count', async () => (await githubList<unknown>(`/repos/${repository()}/pulls?state=all&per_page=100`)).length);
    const secrets = wholeHistory && unblinded ? secretsInHistory(secretScan, Number(commitsWithText) || null, r.count('pull_heads.count'), pullRequests) : null;
    const paths = wholeHistory ? forbiddenInHistory(r.rc('added_paths'), parsePaths(r.text('added_paths.log') ?? ''), patterns) : null;

    const lockfiles = (r.text('lockfiles.txt') ?? '').split('\n').filter(Boolean);
    const osvReport = r.json<Parameters<typeof dependabotAgrees>[0]>('osv.json');
    const osv = unblinded ? osvOpen(r.rc('osv'), osvReport, r.text('osv.log') ?? '', lockfiles) : null;
    const semgrep = r.json<SemgrepOutput>('semgrep.json');
    // Each file Semgrep could not read in full, with the lines it skipped, so someone can read them by hand (#244).
    for (const e of unblinded ? (semgrep?.errors ?? []) : []) {
      const lines = (e.spans ?? []).map((s) => `${s.start?.line ?? '?'}-${s.end?.line ?? '?'}`).join(', ');
      console.log(`::notice title=Semgrep parse::${e.path ?? 'no path'}: ${JSON.stringify(e.type ?? null)} at lines ${lines || 'unknown'}`);
    }
    const sast = unblinded
      ? sastCounts(r.rc('semgrep'), semgrep, {
          triage: triage.sast,
          audited: triage.rules_not_scored,
          codeFiles: r.count('code_files.count'),
          hashOf: findingHash,
        })
      : null;
    const scorecard = r.json<ScorecardOutput>('scorecard.json');

    // If osv-scanner reports what Dependabot doesn't, Dependabot has gone quiet, so its zeros mean nothing.
    const allAlerts = await reading('Dependabot alerts', () => githubList<Alert>(`/repos/${repository()}/dependabot/alerts?per_page=100`));
    const alerts = allAlerts && osv !== null && dependabotAgrees(osvReport, allAlerts) ? allAlerts : null;

    const drills: Drills = {
      secretScan: parseSecretScan(r.rc('drill_secrets'), r.text('drill_secrets.log') ?? ''),
      pathsRc: r.rc('drill_added_paths'),
      paths: parsePaths(r.text('drill_added_paths.log') ?? ''),
      osvRc: r.rc('drill_osv'),
      osv: r.json('drill_osv.json'),
      osvLog: r.text('drill_osv.log') ?? '',
      sastRc: r.rc('drill_sast'),
      sast: r.json<SemgrepOutput>('drill_sast.json'),
    };

    const detail: DetailOut = { checks: {}, readings: {} };
    const put = (id: string, value: number | null | undefined, limit: number | null = null) => {
      if (value !== null && value !== undefined) detail.readings[id] = { value, limit, n: 1 };
    };
    for (const [name, found] of Object.entries(drillResults(drills, patterns) ?? {})) detail.checks[`drill_${name}`] = found ? 1 : 0;
    for (const check of scorecard?.checks ?? []) {
      if (typeof check.name === 'string' && typeof check.score === 'number' && check.score >= 0) put(scorecardId(check.name), check.score, 10);
    }
    for (const [rule, count] of Object.entries(sast?.byRule ?? {})) put(sastRuleId(rule), count);
    put('sast_parse_warnings', sast?.parseWarnings);

    finish(
      [
        record(context, 'alerts_critical_high_open', alerts && openCount(alerts, CRITICAL_HIGH)),
        record(context, 'alerts_medium_low_open', alerts && openCount(alerts, MEDIUM_LOW)),
        record(context, 'osv_vulnerabilities_open', osv),
        record(context, 'sast_findings_open', sast?.open ?? null),
        record(context, 'scorecard_checks_at_goal', scorecardAtGoal(r.rc('scorecard'), scorecard, heldChecks, head)),
        record(context, 'secrets_in_history', secrets),
        record(context, 'forbidden_paths_in_history', paths),
        record(context, 'case_paths_ignored', allIgnored(forbidden.must_be_ignored, (await reading('git check-ignore', () => ignoredSamples(forbidden.must_be_ignored))) ?? [])),
        record(context, 'scanner_drills_passing', drillsPass(drills, patterns), 4),
        timeToFix(context, 'time_to_fix_critical_high_hours', alerts, CRITICAL_HIGH, now),
        timeToFix(context, 'time_to_fix_medium_low_hours', alerts, MEDIUM_LOW, now),
        record(context, 'scan_minutes', scanMinutes(scan.status, scanElapsedMs, drillsPass(drills, patterns) === 1)),
      ],
      detail,
    );
  } finally {
    rmSync(raw, { recursive: true, force: true });
  }
}
