// SPDX-License-Identifier: Apache-2.0
// What the Security page's raw scanner output and GitHub's records add up to. Every function here returns null when it
// can't prove the scan happened, so a broken tool reads as missing and never as a clean result: an exit code alone proves
// little, because a scanner over empty input also exits 0. Pure, so `node --test` covers it in seconds with no scanner.
import { createHash } from 'node:crypto';

/** Pull requests opened between fetching the refs and asking GitHub how many there are. */
export const NEW_PULLS_ALLOWED = 3;
/** Semgrep must read at least this share of the repository's code. */
export const MIN_SCANNED_SHARE = 0.9;
/** It may warn that it only partly parsed this share of what it read, and no more. */
export const MAX_PARSE_WARNING_SHARE = 0.02;
/** The languages it scans, the same list scan.sh counts. Generic rules read other files too, and those prove nothing about code. */
export const CODE_FILE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|py|sh|swift|html|ya?ml)$/;
/** A written reason, not a mark. */
export const MIN_REASON_LENGTH = 20;
/** Paths the path drill plants, one of them non-ASCII because git quotes those unless told not to. */
export const PLANTED_PATHS = 2;
const CLOSING_WINDOW_DAYS = 30;

// The secret scan.

export interface SecretScan {
  commits: number;
  leaks: number;
}

/** Reads gitleaks' own summary. Exit 0 must say "no leaks found", and exit 1 must say how many. */
export function parseSecretScan(rc: number | null, log: string): SecretScan | null {
  const commits = /(\d+) commits scanned/.exec(log);
  if (rc === null || !commits) return null;
  const count = Number(commits[1]);
  if (rc === 0 && /no leaks found/.test(log)) return { commits: count, leaks: 0 };
  const leaks = /leaks found: (\d+)/.exec(log);
  if (rc === 1 && leaks && Number(leaks[1]) > 0) return { commits: count, leaks: Number(leaks[1]) };
  return null;
}

/** Leaks across the whole history, proven by the scan reaching every commit it can read and every pull request. */
export function secretsInHistory(
  scan: SecretScan | null,
  commitsWithText: number | null,
  pullHeadsFetched: number | null,
  pullRequests: number | null,
): number | null {
  if (!scan || commitsWithText === null || pullHeadsFetched === null || pullRequests === null) return null;
  if (commitsWithText < 1 || scan.commits < commitsWithText) return null;
  if (pullHeadsFetched < pullRequests - NEW_PULLS_ALLOWED) return null;
  return scan.leaks;
}

/** A shallow checkout or a failed fetch of the pull request heads proves nothing about the history. */
export const wholeHistoryRead = (shallow: string | undefined, pullHeadsRc: number | null): boolean => shallow === 'false' && pullHeadsRc === 0;

/** Anything in the repository that could blind a scanner means none of the three can be trusted. An unread list counts. */
export const scannersUnblinded = (rc: number | null, log: string | null): boolean => rc === 0 && log !== null && log.trim() === '';

// Paths that must never enter git.

/** Case-insensitive, because the Mac's disk is: `casedata/` is the same folder as `CaseData/`. */
export const compilePatterns = (sources: readonly string[]): RegExp[] => sources.map((source) => new RegExp(source, 'i'));

/** Paths from `git -c core.quotePath=false log -z`, separated by NUL, so a path can't be quoted or broken across lines. */
export const parsePaths = (log: string): string[] => log.split('\0').map((path) => path.replace(/^\n+/, '')).filter(Boolean);

/** How many added paths match, given the listing's exit code. An empty listing proves nothing, so it reads as null. */
export function forbiddenInHistory(rc: number | null, paths: readonly string[], patterns: readonly RegExp[]): number | null {
  if (rc !== 0 || paths.length === 0 || patterns.length === 0) return null;
  return paths.filter((path) => patterns.some((pattern) => pattern.test(path))).length;
}

/** 1 when git ignores every sample path, 0 when it misses any, null with nothing to prove it on. */
export function allIgnored(samples: readonly string[], ignored: readonly string[]): 0 | 1 | null {
  if (samples.length === 0) return null;
  const seen = new Set(ignored);
  return samples.every((sample) => seen.has(sample)) ? 1 : 0;
}

// osv-scanner.

interface OsvOutput {
  results?: { packages?: { package?: { name?: string; version?: string }; groups?: { ids?: string[] }[] }[] }[];
}

/** True when its log says it read each lockfile and found packages in it. Its report lists only the ones with findings. */
export function lockfilesScanned(log: string, lockfiles: readonly string[]): boolean {
  if (lockfiles.length === 0) return false;
  return lockfiles.every((lockfile) => {
    const line = log.split('\n').find((text) => text.includes(`/${lockfile} file and found `));
    return Number(/found (\d+) packages?\b/.exec(line ?? '')?.[1] ?? 0) > 0;
  });
}

const osvGroups = (report: OsvOutput) => (report.results ?? []).flatMap((result) => (result.packages ?? []).flatMap((entry) => entry.groups ?? []));

/**
 * Advisories open across every lockfile. osv-scanner exits 0 clean and 1 with findings; 127 is an error and 128 means no
 * lockfile was found, and both read as null. So does an exit code that disagrees with the report, or a lockfile unread.
 */
export function osvOpen(rc: number | null, report: OsvOutput | null, log: string, lockfiles: readonly string[]): number | null {
  if ((rc !== 0 && rc !== 1) || !report || !Array.isArray(report.results) || !lockfilesScanned(log, lockfiles)) return null;
  const count = osvGroups(report).length;
  return (rc === 1) === count > 0 ? count : null;
}

// Semgrep.

export interface SemgrepFinding {
  check_id: string;
  path: string;
  start?: { line?: number };
  end?: { line?: number };
  extra: { severity?: string; metadata?: { category?: string } };
}

export interface SemgrepOutput {
  results?: SemgrepFinding[];
  errors?: { level?: string; path?: string; type?: unknown; spans?: { start?: { line?: number }; end?: { line?: number } }[] }[];
  paths?: { scanned?: string[] };
}

/** A finding read and judged not to be a weakness: this exact line, with the reason on file. */
export interface TriageEntry {
  rule: string;
  path: string;
  line_hash: string;
  reason: string;
}

export const ruleName = (checkId: string) => checkId.slice(checkId.lastIndexOf('.') + 1);
/** Semgrep reports the path it saw inside its container. */
export const repoPath = (path: string) => (path.startsWith('/src/') ? path.slice('/src/'.length) : path);

/** Identifies the flagged lines, so an edit or a new finding in the same file is read afresh instead of inheriting a reason. */
export function matchHash(fileText: string, startLine: number, endLine: number): string {
  const lines = fileText.split('\n').slice(startLine - 1, endLine).map((line) => line.trim());
  return createHash('sha256').update(lines.join('\n')).digest('hex').slice(0, 16);
}

/** A rule audited instead of judged line by line, up to the hits the audit read. */
export interface UnscoredRule {
  rule: string;
  audited_hits: number;
  /** A folder the audit's limit doesn't count, with its reason in triage.json. */
  not_counted_under?: string;
}

const isTestFile = (path: string) => /\.test\.[a-z]+$/.test(repoPath(path));

/** A detail id holds 32 characters, and one longer loses the lane's whole detail. Two long rules could share an id; this is only a display count. */
export const sastRuleId = (rule: string): string => `sast_rule_${rule.toLowerCase().slice(0, 22)}`;

/** A security finding in code that ships, and not one from a rule named as audited. */
export function countsAsFinding(finding: SemgrepFinding, audited: readonly UnscoredRule[]): boolean {
  if (finding.extra.metadata?.category !== 'security' || isTestFile(finding.path)) return false;
  return !audited.some((entry) => entry.rule === ruleName(finding.check_id));
}

export interface SastCounts {
  /** Findings no reason covers, and reasons that no longer match a finding. */
  open: number;
  triaged: number;
  stale: number;
  /** Hits of an audited rule within what the audit read. Any other count reads as open. */
  audited: number;
  scanned: number;
  parseWarnings: number;
  /** Every security finding by rule, tests included, for the page's table. */
  byRule: Record<string, number>;
  /** What `open` is made of, so each one can be found and fixed: the three lists add up to it. */
  unjudged: { rule: string; path: string; line: number | null; hash: string | null }[];
  staleReasons: { rule: string; path: string; hash: string }[];
  /** An audited rule whose hits differ from what the audit read, with where each counted hit is, for the next audit. */
  auditedOff: { rule: string; hits: number; read: number; at: string[] }[];
}

export interface SastOptions {
  triage: readonly TriageEntry[];
  audited: readonly UnscoredRule[];
  /** Tracked files in the languages it scans. */
  codeFiles: number | null;
  hashOf: (finding: SemgrepFinding) => string | null;
}

/** Semgrep's findings, proven by exit 0, by no error, and by the scan having read nearly all of the repository's code. */
export function sastCounts(rc: number | null, report: SemgrepOutput | null, options: SastOptions): SastCounts | null {
  const { triage, audited, codeFiles, hashOf } = options;
  const scanned = report?.paths?.scanned?.length ?? 0;
  if (rc !== 0 || !report || !Array.isArray(report.results) || !Array.isArray(report.errors) || !codeFiles) return null;
  if ((report.paths?.scanned ?? []).filter((path) => CODE_FILE.test(path)).length < codeFiles * MIN_SCANNED_SHARE) return null;
  if (report.errors.some((error) => error.level !== 'warn')) return null;
  if (report.errors.length > scanned * MAX_PARSE_WARNING_SHARE) return null;

  const usable = triage.filter((entry) => entry.reason.trim().length >= MIN_REASON_LENGTH);
  const used = new Set<TriageEntry>();
  const byRule: Record<string, number> = {};
  const auditedHits = new Map<string, string[]>();
  const unjudged: SastCounts['unjudged'] = [];
  let triaged = 0;
  for (const finding of report.results) {
    if (finding.extra.metadata?.category !== 'security') continue;
    const rule = ruleName(finding.check_id);
    byRule[rule] = (byRule[rule] ?? 0) + 1;
    const path = repoPath(finding.path);
    const named = audited.find((entry) => entry.rule === rule);
    if (named) {
      const counted = !isTestFile(finding.path) && !(named.not_counted_under && path.startsWith(named.not_counted_under));
      if (counted) auditedHits.set(rule, [...(auditedHits.get(rule) ?? []), `${path}:${finding.start?.line ?? '?'}`]);
      continue;
    }
    if (!countsAsFinding(finding, audited)) continue;
    const hash = hashOf(finding);
    // One entry for one finding, so a copied line isn't excused by the original's reason.
    const entry = usable.find((candidate) => !used.has(candidate) && candidate.rule === rule && candidate.path === path && candidate.line_hash === hash);
    if (entry) {
      used.add(entry);
      triaged += 1;
    } else {
      unjudged.push({ rule, path, line: finding.start?.line ?? null, hash });
    }
  }
  const staleReasons = usable.filter((entry) => !used.has(entry)).map((entry) => ({ rule: entry.rule, path: entry.path, hash: entry.line_hash }));
  const stale = staleReasons.length;
  const auditedOff: SastCounts['auditedOff'] = [];
  let auditedCount = 0;
  let unaudited = 0;
  for (const entry of audited) {
    const at = auditedHits.get(entry.rule) ?? [];
    const hits = at.length;
    auditedCount += Math.min(hits, entry.audited_hits);
    unaudited += Math.abs(hits - entry.audited_hits);
    if (hits !== entry.audited_hits) auditedOff.push({ rule: entry.rule, hits, read: entry.audited_hits, at });
  }
  return { open: unjudged.length + stale + unaudited, triaged, stale, audited: auditedCount, scanned, parseWarnings: report.errors.length, byRule, unjudged, staleReasons, auditedOff };
}

// OpenSSF Scorecard.

export const scorecardId = (name: string) => `scorecard_${name.toLowerCase().replace(/-/g, '_')}`;

export interface ScorecardOutput {
  repo?: { commit?: string };
  score?: number;
  checks?: { name?: string; score?: number }[];
}

/**
 * The share of the held checks at their goal, named check by check because Scorecard's own docs warn that an aggregate
 * says little about what a repository does. A held check that is absent or inconclusive (-1) makes the whole reading null,
 * and so does a scan of any commit but this one.
 */
export function scorecardAtGoal(rc: number | null, report: ScorecardOutput | null, held: Readonly<Record<string, number>>, head: string): number | null {
  const names = Object.keys(held);
  if (rc !== 0 || !report?.repo?.commit || report.repo.commit !== head || !Array.isArray(report.checks) || names.length === 0) return null;
  const scores = new Map(report.checks.map((check) => [check.name, check.score]));
  let atGoal = 0;
  for (const name of names) {
    const score = scores.get(name);
    if (typeof score !== 'number' || score < 0) return null;
    if (score >= (held[name] as number)) atGoal += 1;
  }
  return Math.round((atGoal / names.length) * 1000) / 10;
}

// The planted drills.

export interface Drills {
  secretScan: SecretScan | null;
  pathsRc: number | null;
  paths: readonly string[];
  osvRc: number | null;
  osv: OsvOutput | null;
  osvLog: string;
  sastRc: number | null;
  sast: SemgrepOutput | null;
}

/** Which planted problems were found, or null when a drill did not run, which is neither a pass nor a fail. */
export function drillResults(drills: Drills, patterns: readonly RegExp[]): Record<'secret' | 'path' | 'osv' | 'sast', boolean> | null {
  const { secretScan, pathsRc, paths, osvRc, osv, osvLog, sastRc, sast } = drills;
  if (pathsRc === null || osvRc === null || sastRc === null) return null;
  return {
    secret: (secretScan?.leaks ?? 0) >= 1,
    path: (forbiddenInHistory(pathsRc, paths, patterns) ?? 0) >= PLANTED_PATHS,
    osv: (osvOpen(osvRc, osv, osvLog, ['package-lock.json']) ?? 0) >= 1,
    sast: sastRc === 0 && (sast?.results ?? []).some((finding) => countsAsFinding(finding, [])),
  };
}

/** 1 when every planted problem was found, 0 when any was missed, null when a drill did not run. */
export function drillsPass(drills: Drills, patterns: readonly RegExp[]): 0 | 1 | null {
  const results = drillResults(drills, patterns);
  if (!results) return null;
  return Object.values(results).every(Boolean) ? 1 : 0;
}

// Dependabot alerts.

export interface Alert {
  state: string;
  created_at: string;
  fixed_at?: string | null;
  dismissed_at?: string | null;
  dismissed_reason?: string | null;
  dismissed_comment?: string | null;
  security_advisory: { severity: string; ghsa_id?: string; published_at?: string | null };
}

export const CRITICAL_HIGH = ['critical', 'high'] as const;
export const MEDIUM_LOW = ['medium', 'low'] as const;
/** A dismissal that says the weakness isn't there or isn't reachable. "No time" and "fix started" leave it open. */
const CLOSING_REASONS: ReadonlySet<string> = new Set(['inaccurate', 'not_used']);

/**
 * Closed only if fixed, or dismissed with one of those reasons and a real comment. An automatic dismissal, or an accepted
 * risk, still counts as open, so a weakness can't leave the page by being waved away.
 */
export function stillOpen(alert: Alert): boolean {
  if (alert.state === 'fixed') return false;
  const written = (alert.dismissed_comment ?? '').trim().length >= MIN_REASON_LENGTH;
  return !(alert.state === 'dismissed' && CLOSING_REASONS.has(alert.dismissed_reason ?? '') && written);
}

export function openCount(alerts: readonly Alert[], severities: readonly string[]): number {
  return alerts.filter((alert) => severities.includes(alert.security_advisory.severity) && stillOpen(alert)).length;
}

/**
 * True unless osv-scanner reports an advisory that Dependabot has no open alert for. Dependabot can't be drilled, because an
 * alert needs a real vulnerable package on main, so this is what shows it has gone quiet. An advisory with no GHSA id is
 * outside what Dependabot reads.
 */
export function dependabotAgrees(report: OsvOutput | null, alerts: readonly Alert[]): boolean {
  if (!report) return false;
  const open = new Set(alerts.filter((alert) => alert.state !== 'fixed').map((alert) => alert.security_advisory.ghsa_id));
  return osvGroups(report).every((group) => {
    const ghsa = (group.ids ?? []).filter((id) => id.startsWith('GHSA-'));
    return ghsa.length === 0 || ghsa.some((id) => open.has(id));
  });
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/**
 * How long each weakness stayed open, in hours, from when it was public or the alert was raised, whichever came first. The
 * alert alone would flatter an old advisory on a new repository, or one Dependabot was slow to raise. A still-open alert
 * counts at its age so far, because timing only the closed ones would look better the longer the hard ones stay open. Closed
 * ones count for 30 days after closing, to show how fixes are going now, and an open one never leaves. An unreadable date
 * makes the whole reading null, because dropping that alert could read as no events.
 */
export function fixHours(alerts: readonly Alert[], severities: readonly string[], nowMs: number): number[] | null {
  const hours: number[] = [];
  for (const alert of alerts) {
    if (!severities.includes(alert.security_advisory.severity)) continue;
    const open = stillOpen(alert);
    const closed = open ? nowMs : Date.parse((alert.state === 'fixed' ? alert.fixed_at : alert.dismissed_at) ?? '');
    if (!Number.isFinite(closed)) return null;
    if (!open && nowMs - closed > CLOSING_WINDOW_DAYS * DAY_MS) continue;
    const raised = Date.parse(alert.created_at);
    if (!Number.isFinite(raised)) return null;
    const published = Date.parse(alert.security_advisory.published_at ?? '');
    const started = Number.isFinite(published) ? Math.min(raised, published) : raised;
    hours.push(Math.max(0, closed - started) / HOUR_MS);
  }
  return hours;
}

/** The nearest-rank 90th percentile, so a small sample reads as its slowest case rather than an interpolated guess. */
export function p90(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.9) - 1] as number;
}

// The secret scan as a gate.

/** The percent of commits whose run scanned them. A commit with no finished run has no answer, so it stays out. */
export function gateCoverage(conclusions: readonly (string | null)[]): { percent: number; sample: number } | null {
  const known = conclusions.filter((conclusion) => conclusion !== null);
  if (known.length === 0) return null;
  const passed = known.filter((conclusion) => conclusion === 'success').length;
  return { percent: Math.round((passed / known.length) * 1000) / 10, sample: known.length };
}

// Keys.

/** The age in days of the oldest stored key, from when each was last set. No keys listed proves nothing. */
export function oldestKeyDays(updatedAt: readonly string[], nowMs: number): number | null {
  const ages = updatedAt.map((time) => (nowMs - Date.parse(time)) / DAY_MS);
  if (ages.length === 0 || ages.some((age) => !Number.isFinite(age))) return null;
  return Math.max(0, Math.round(Math.max(...ages) * 10) / 10);
}

export interface ReadOut {
  status: number | null;
  /** When GitHub answered, from its own header. */
  date: string | null;
  body: unknown;
}

/** One raw `gh api --include` read-out: a status line, headers, a blank line and the JSON. Anything else has no body. */
export function parseReadOut(text: string): ReadOut {
  const normal = text.replace(/\r\n/g, '\n');
  const split = normal.indexOf('\n\n');
  const head = split < 0 ? normal : normal.slice(0, split);
  const status = /^HTTP\/[\d.]+ (\d{3})/.exec(head)?.[1];
  let body: unknown = null;
  if (split >= 0) {
    try {
      body = JSON.parse(normal.slice(split + 2));
    } catch {
      body = null;
    }
  }
  return {
    status: status ? Number(status) : null,
    date: /^date:\s*(.+)$/im.exec(head)?.[1]?.trim() ?? null,
    body,
  };
}

/** The read-outs a complete reading needs: the two that always exist, and one per environment. Null if the environments went unread. */
export function requiredKeyReadOuts(environments: ReadOut | null): string[] | null {
  const list = (environments?.body as { environments?: { name?: unknown }[] } | null)?.environments;
  if (environments?.status !== 200 || !Array.isArray(list) || !list.every((entry) => typeof entry.name === 'string')) return null;
  return ['repository-actions-secrets.txt', 'repository-dependabot-secrets.txt', ...list.map((entry) => `repository-environments-${entry.name as string}-secrets.txt`)];
}

/** When each key was last set, from a list of stored keys. Null unless GitHub answered 200 with a list, recently. */
export function keysFromReadOut(readOut: ReadOut, nowMs: number, maxAgeHours: number): string[] | null {
  const secrets = (readOut.body as { secrets?: { updated_at?: unknown }[] } | null)?.secrets;
  if (readOut.status !== 200 || !Array.isArray(secrets)) return null;
  const answered = Date.parse(readOut.date ?? '');
  if (!Number.isFinite(answered) || nowMs - answered > maxAgeHours * HOUR_MS) return null;
  const dates = secrets.map((secret) => secret.updated_at);
  return dates.every((date): date is string => typeof date === 'string') ? dates : null;
}

/**
 * Minutes the scanners took, rounded up as a runner bills a job. Only a scan that did its work counts: one that didn't finish,
 * or whose planted drills weren't all found, could be fast because it scanned nothing, so it reads missing.
 */
export function scanMinutes(status: number | null, elapsedMs: number, drillsPassed: boolean): number | null {
  return status === 0 && drillsPassed && elapsedMs >= 0 ? Math.ceil(elapsedMs / 60_000) : null;
}
