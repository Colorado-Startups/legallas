// SPDX-License-Identifier: Apache-2.0
// settings_match, deny_rules_kept, drift_open_hours: each repo row of expected.json against .claude/settings.json, and how
// long a row has been short. Moved from the Claude settings page with expected.json, unchanged.

export const SETTINGS = '.claude/settings.json';
export const EXPECTED = 'quality-speed/pages/claude-documentation/expected.json';
/** Where expected.json lived before the move, so drift's history walk reaches past it. */
export const EXPECTED_BEFORE = 'quality-speed/pages/claude-settings/expected.json';
const HOUR_MS = 3_600_000;

export interface Row {
  id: string;
  /** repo: checked in .claude/settings.json. owner: an account setting no CI token can read. */
  read: 'repo' | 'owner';
  /** allowed: each tool is in permissions.allow and no deny or ask rule reaches it. denied: each rule is in permissions.deny as written. */
  op?: 'allowed' | 'denied';
  values?: string[];
  where?: string;
  expect?: string;
  why: string;
  source: string;
}
export interface Expected { rows: Row[] }
/** Both files as one commit had them. */
export interface Version { at: string; expected: Expected | null; settings: unknown }

/** expected.json with unique ids, a closed read and op, and every repo row naming at least one rule; otherwise null. */
export function parseExpected(input: unknown): Expected | null {
  const rows = (input as Partial<Expected> | null)?.rows;
  if (!Array.isArray(rows) || !rows.length) return null;
  const named = (v: unknown) => Array.isArray(v) && v.length > 0 && v.every((s) => typeof s === 'string' && s.length > 0);
  const good = rows.every((r: Row) => typeof r?.id === 'string' && (r.read === 'owner' || (r.read === 'repo' && (r.op === 'allowed' || r.op === 'denied') && named(r.values))));
  return good && new Set(rows.map((r: Row) => r.id)).size === rows.length ? { rows } : null;
}

function rules(settings: unknown, key: 'allow' | 'deny' | 'ask'): string[] {
  const list = (settings as { permissions?: Record<string, unknown> } | null)?.permissions?.[key];
  return Array.isArray(list) ? list.filter((r): r is string => typeof r === 'string') : [];
}

/** Whether a deny or ask rule reaches an MCP tool: by its name, its server's name, or a glob over the whole name. A scoped rule, with parentheses, never does. */
export function reaches(rule: string, tool: string): boolean {
  if (rule.includes('(')) return false;
  const glob = rule.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*');
  return new RegExp(`^${glob}$`).test(tool) || tool.startsWith(`${rule}__`);
}

/** Whether the settings meet one repo row. */
export function meets(row: Row, settings: unknown): boolean {
  const values = row.values ?? [];
  const deny = rules(settings, 'deny');
  if (row.op === 'denied') return values.every((v) => deny.includes(v));
  const blocking = [...deny, ...rules(settings, 'ask')];
  return values.every((v) => rules(settings, 'allow').includes(v) && !blocking.some((r) => reaches(r, v)));
}

export const repoRows = (e: Expected) => e.rows.filter((r) => r.read === 'repo');
const allMet = (e: Expected, settings: unknown) => repoRows(e).every((r) => meets(r, settings));

/**
 * How long a row has been short: 0 when every row is met now, otherwise the hours since the oldest commit in the newest run
 * of commits short of their own expected.json. Null when the history ends inside that run, so its start is unknown.
 */
export function openHours(metNow: boolean, versions: readonly Version[], now: string): { hours: number; read: number } | null {
  if (metNow) return { hours: 0, read: 1 };
  let since: string | null = null;
  for (const [i, v] of versions.entries()) {
    if (!v.expected || allMet(v.expected, v.settings)) return since === null ? null : { hours: Math.round(((Date.parse(now) - Date.parse(since)) / HOUR_MS) * 100) / 100, read: i + 1 };
    since = v.at;
  }
  return null;
}

/** The three readings: share of repo rows met, every deny rule kept, hours short. Null where there is nothing to read. */
export function settingsReadings(expected: Expected, settings: unknown, versions: readonly Version[], now: string) {
  const repo = repoRows(expected);
  const met = repo.filter((r) => meets(r, settings)).length;
  const deny = repo.filter((r) => r.op === 'denied');
  return {
    match: repo.length ? { value: Math.round((met / repo.length) * 10_000) / 100, n: repo.length } : null,
    deny: deny.length ? { value: deny.every((r) => meets(r, settings)) ? 1 : 0, n: deny.reduce((n, r) => n + (r.values?.length ?? 0), 0) } : null,
    open: repo.length ? openHours(met === repo.length, versions, now) : null,
    rows: repo.map((r) => ({ id: r.id, met: meets(r, settings) })),
  };
}
