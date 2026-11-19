// SPDX-License-Identifier: Apache-2.0
// From ZAP's alerts to the report: one finding per ZAP rule and target, each with its severity and remediation status.
//
// | Status   | Means |
// |----------|-------|
// | open     | Seen in this run and not judged. Open High or Medium fails the run |
// | accepted | Seen, and every place it was seen is covered by a triage.json judgment with its reason |
// | fixed    | Judged fixed in triage.json, with the change that fixed it, and not seen in this run |
//
// A finding judged fixed that shows up again is open, marked as a regression. A judgment that matches nothing this run
// is listed as not seen, so a stale one shows instead of hiding a future finding.
import { targetOfSite, type TargetName, TARGETS } from './targets.ts';

export const RISKS = ['High', 'Medium', 'Low', 'Informational'] as const;
export type Risk = (typeof RISKS)[number];
const RISK_CODE: Readonly<Record<string, Risk>> = { '3': 'High', '2': 'Medium', '1': 'Low', '0': 'Informational' };
const CONFIDENCE_CODE: Readonly<Record<string, string>> = { '0': 'False positive', '1': 'Low', '2': 'Medium', '3': 'High', '4': 'Confirmed' };

export interface Instance {
  method: string;
  /** The path with seeded ids put back as their :names, and hashed build files folded. */
  path: string;
  param: string;
}

export interface Alert {
  /** ZAP's alert reference: the rule id, with a variant suffix for rules that raise several kinds. */
  alertRef: string;
  pluginId: string;
  name: string;
  risk: Risk;
  confidence: string;
  cwe: string;
  target: TargetName;
  instances: Instance[];
}

/**
 * Puts each seeded id back as its route parameter, so `/api/doc/3f9c...` and `/api/doc/:id` read as one place, and folds
 * the build's hashed files (`/_astro/index.Bx1.js`) into one.
 */
export function normalizePath(uri: string, names: ReadonlyMap<string, string>): string {
  let path: string;
  try {
    path = new URL(uri).pathname;
  } catch {
    path = uri.split('?')[0] ?? uri;
  }
  const segments = path.split('/').map((segment) => {
    const name = segment.length >= 4 ? names.get(decodeURIComponentSafe(segment)) : undefined;
    return name ? `:${name}` : segment;
  });
  return segments.join('/').replace(/^\/_astro\/[^/]+$/, '/_astro/*');
}

function decodeURIComponentSafe(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

const text = (value: unknown): string => (typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '');

/** ZAP's traditional-json report as alerts. A site that is not one of the four targets is an error: the scan touched something it must not. */
export function parseZapJson(report: unknown, names: ReadonlyMap<string, string>): { alerts: Alert[]; foreignSites: string[] } {
  const alerts: Alert[] = [];
  const foreignSites: string[] = [];
  const sites = (report as { site?: unknown } | null)?.site;
  for (const site of Array.isArray(sites) ? sites : []) {
    const name = text((site as Record<string, unknown>)['@name']);
    const target = targetOfSite(name);
    if (!target) {
      foreignSites.push(name);
      continue;
    }
    const raw = (site as { alerts?: unknown }).alerts;
    for (const alert of Array.isArray(raw) ? (raw as Record<string, unknown>[]) : []) {
      const risk = RISK_CODE[text(alert.riskcode)];
      if (!risk) continue;
      const instances = (Array.isArray(alert.instances) ? (alert.instances as Record<string, unknown>[]) : []).map((instance) => ({
        method: text(instance.method) || 'GET',
        path: normalizePath(text(instance.uri), names),
        param: text(instance.param),
      }));
      alerts.push({
        alertRef: text(alert.alertRef) || text(alert.pluginid),
        pluginId: text(alert.pluginid),
        name: text(alert.name) || text(alert.alert),
        risk,
        confidence: CONFIDENCE_CODE[text(alert.confidence)] ?? 'Unknown',
        cwe: text(alert.cweid),
        target: target.name,
        instances,
      });
    }
  }
  return { alerts, foreignSites };
}

export interface TriageEntry {
  /** ZAP's alert reference, as the report's Rule column shows it. */
  alert: string;
  /** The targets it covers; every target when absent. */
  targets?: TargetName[];
  /** A regular expression the normalized path must match; every path when absent. */
  paths?: string;
  status: 'accepted' | 'fixed';
  reason: string;
  /** YYYY-MM-DD. */
  decided: string;
  /** For a fixed finding: the pull request or commit that fixed it. */
  fixedIn?: string;
  /** For a fixed finding, which this run may not see: its name and severity when it was found. */
  name?: string;
  risk?: Risk;
}

export interface Triage {
  schema: 1;
  entries: TriageEntry[];
}

const TARGET_NAMES = new Set<string>(TARGETS.map((target) => target.name));
const MIN_REASON = 30;

/** The triage file, or the reasons it is refused. A short reason, a bad date or a pattern that does not compile is refused. */
export function validateTriage(value: unknown): { triage: Triage; errors: string[] } {
  const errors: string[] = [];
  const raw = value as { schema?: unknown; entries?: unknown } | null;
  if (raw?.schema !== 1) errors.push('schema must be 1');
  const entries = Array.isArray(raw?.entries) ? (raw.entries as TriageEntry[]) : [];
  if (!Array.isArray(raw?.entries)) errors.push('entries must be a list');
  entries.forEach((entry, i) => {
    const at = `entries[${i}]`;
    if (typeof entry.alert !== 'string' || !/^\d+(-\d+)?$/.test(entry.alert)) errors.push(`${at}.alert must be a ZAP alert reference, such as 10038 or 10038-1`);
    if (entry.status !== 'accepted' && entry.status !== 'fixed') errors.push(`${at}.status must be accepted or fixed`);
    if (typeof entry.reason !== 'string' || entry.reason.trim().length < MIN_REASON) errors.push(`${at}.reason must say why, in at least ${MIN_REASON} characters`);
    if (typeof entry.decided !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(entry.decided)) errors.push(`${at}.decided must be YYYY-MM-DD`);
    if (entry.targets !== undefined && (!Array.isArray(entry.targets) || entry.targets.length === 0 || entry.targets.some((t) => !TARGET_NAMES.has(t)))) {
      errors.push(`${at}.targets must list target names from targets.ts`);
    }
    if (entry.paths !== undefined) {
      try {
        pathPattern(entry.paths);
      } catch {
        errors.push(`${at}.paths must be a regular expression`);
      }
    }
    if (entry.status === 'fixed') {
      if (typeof entry.fixedIn !== 'string' || !/^(#\d+|[0-9a-f]{7,40})$/.test(entry.fixedIn)) errors.push(`${at}.fixedIn must be a pull request (#123) or a commit`);
      if (typeof entry.name !== 'string' || entry.name.length === 0) errors.push(`${at}.name is required for a fixed finding`);
      if (!RISKS.includes(entry.risk as Risk)) errors.push(`${at}.risk is required for a fixed finding`);
    }
  });
  return { triage: { schema: 1, entries }, errors };
}

export type Status = 'open' | 'accepted' | 'fixed';

export interface Finding {
  alertRef: string;
  pluginId: string;
  name: string;
  risk: Risk;
  confidence: string;
  cwe: string;
  /** Null for a fixed judgment that covers every target. */
  target: TargetName | null;
  status: Status;
  /** The triage reasons, for accepted and fixed; for open, why it is open when that is not just "new". */
  reason: string;
  /** Unique method and path pairs. */
  places: string[];
  /** Places no accepted judgment covers. Empty unless open. */
  uncovered: string[];
  fixedIn?: string;
}

/** The one place a triage entry's `paths` is compiled. It comes from this page's own triage file, which is reviewed like code. */
function pathPattern(paths: string): RegExp {
  return new RegExp(paths);
}

const covers = (entry: TriageEntry, alert: Pick<Alert, 'alertRef' | 'pluginId' | 'target'>, path?: string) =>
  (entry.alert === alert.alertRef || entry.alert === alert.pluginId) &&
  (entry.targets === undefined || entry.targets.includes(alert.target)) &&
  (path === undefined || entry.paths === undefined || pathPattern(entry.paths).test(path));

const place = (instance: Instance) => `${instance.method} ${instance.path}`;
const unique = (items: readonly string[]) => [...new Set(items)].sort();

export interface Judged {
  findings: Finding[];
  /** Accepted judgments that matched nothing in this run. */
  notSeen: TriageEntry[];
}

/** Merges alerts into findings, one per rule and target, and gives each its status. */
export function judge(alerts: readonly Alert[], triage: Triage): Judged {
  const groups = new Map<string, Alert[]>();
  for (const alert of alerts) {
    const key = `${alert.alertRef}|${alert.target}`;
    groups.set(key, [...(groups.get(key) ?? []), alert]);
  }
  const used = new Set<TriageEntry>();
  const findings: Finding[] = [];
  for (const group of groups.values()) {
    const first = group[0]!; // safe: a group is made with one alert in it
    const instances = group.flatMap((alert) => alert.instances);
    const accepted = triage.entries.filter((entry) => entry.status === 'accepted' && covers(entry, first));
    const fixed = triage.entries.filter((entry) => entry.status === 'fixed' && covers(entry, first));
    const uncovered = unique(instances.filter((instance) => !accepted.some((entry) => covers(entry, first, instance.path))).map(place));
    const coveredBy = accepted.filter((entry) => instances.some((instance) => covers(entry, first, instance.path)));
    for (const entry of [...coveredBy, ...fixed]) used.add(entry);
    const risk = group.reduce<Risk>((worst, alert) => (RISKS.indexOf(alert.risk) < RISKS.indexOf(worst) ? alert.risk : worst), first.risk);
    const base = { alertRef: first.alertRef, pluginId: first.pluginId, name: first.name, risk, confidence: first.confidence, cwe: first.cwe, target: first.target, places: unique(instances.map(place)) };
    if (instances.length > 0 && uncovered.length === 0) {
      findings.push({ ...base, status: 'accepted', reason: unique(coveredBy.map((entry) => entry.reason)).join(' '), uncovered: [] });
    } else if (fixed.length > 0) {
      findings.push({ ...base, status: 'open', reason: `Regression: judged fixed in ${fixed.map((entry) => entry.fixedIn).join(', ')}, seen again.`, uncovered });
    } else {
      findings.push({ ...base, status: 'open', reason: coveredBy.length > 0 ? 'Seen at places no judgment covers.' : '', uncovered });
    }
  }
  for (const entry of triage.entries) {
    if (entry.status !== 'fixed' || used.has(entry)) continue;
    for (const target of entry.targets ?? [null]) {
      findings.push({
        alertRef: entry.alert,
        pluginId: entry.alert.split('-')[0] ?? entry.alert,
        name: entry.name ?? entry.alert,
        risk: entry.risk ?? 'Informational',
        confidence: '',
        cwe: '',
        target,
        status: 'fixed',
        reason: entry.reason,
        places: [],
        uncovered: [],
        fixedIn: entry.fixedIn,
      });
    }
  }
  const STATUSES: readonly Status[] = ['open', 'accepted', 'fixed'];
  findings.sort(
    (a, b) =>
      RISKS.indexOf(a.risk) - RISKS.indexOf(b.risk) ||
      STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status) ||
      a.name.localeCompare(b.name) ||
      (a.target ?? '').localeCompare(b.target ?? ''),
  );
  const notSeen = triage.entries.filter((entry) => entry.status === 'accepted' && !used.has(entry));
  return { findings, notSeen };
}

export type Counts = Record<Risk, Record<Status, number>>;

export function countBySeverity(findings: readonly Finding[]): Counts {
  const counts = Object.fromEntries(RISKS.map((risk) => [risk, { open: 0, accepted: 0, fixed: 0 }])) as Counts;
  for (const finding of findings) counts[finding.risk][finding.status] += 1;
  return counts;
}

/** Open High and Medium findings fail the run. Low and Informational are listed, and wait for triage. */
export const blocking = (findings: readonly Finding[]): Finding[] => findings.filter((finding) => finding.status === 'open' && (finding.risk === 'High' || finding.risk === 'Medium'));
