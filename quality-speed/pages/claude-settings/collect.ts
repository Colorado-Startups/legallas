// SPDX-License-Identifier: Apache-2.0
// The Claude settings page's collector, as core/collect.ts runs it. It checks each repo row of expected.json against the
// checkout's .claude/settings.json, walks the git history of both files for how long a row has been short, and counts the
// tokens the checkout's .claude/ files add to every session (startup). No token for those; lane_minutes, its lane's own time,
// reads the run's jobs with the lane's read-only one (core/lane/collect.ts).
//
//   node quality-speed/pages/claude-settings/collect.ts --out records.json [--run-url <a run link of this repository>]
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MetricRecord } from '../../contract/format.ts';
import { laneRecord } from '../../core/lane/collect.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const SETTINGS = '.claude/settings.json';
export const EXPECTED = 'quality-speed/pages/claude-settings/expected.json';
const PAGE = 'claude-settings' as const;
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
export interface Expected {
  rows: Row[];
}
/** Both files as one commit had them. */
export interface Version {
  at: string;
  expected: Expected | null;
  settings: unknown;
}
export interface Run {
  now: string;
  /** The run on the commit being scored. */
  sourceUrl: string;
}

const parse = (text: string | null): unknown => {
  try {
    return text === null ? null : JSON.parse(text);
  } catch {
    return null;
  }
};

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

/**
 * A file's text as Claude Code loads it, block HTML comments stripped (code.claude.com/docs/en/memory). Null when it has an
 * `@path` import outside code, which this count doesn't follow: then the reading is missing, never short.
 */
export function loadedText(text: string): string | null {
  let fenced = false;
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    else if (!fenced && /(^|\s)@[^\s`]/.test(line.replace(/`[^`]*`/g, ''))) return null;
  }
  return text.replace(/<!--[\s\S]*?-->/g, '');
}

/** A Markdown file's YAML frontmatter, or '' when it has none. */
const frontmatter = (text: string) => /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? '';

/** The skill listing's share of a SKILL.md or agent file: its name, description and when_to_use frontmatter, continuation lines included. */
export function listing(text: string): string {
  const kept: string[] = [];
  let keep = false;
  for (const line of frontmatter(text).split('\n')) {
    keep = /^(name|description|when_to_use):/.test(line) || (keep && /^\s/.test(line));
    if (keep) kept.push(line);
  }
  return kept.join('\n');
}

const readText = (file: string) => (existsSync(file) ? readFileSync(file, 'utf8') : null);
const mdIn = (dir: string, recursive: boolean) =>
  existsSync(dir) ? (readdirSync(dir, { recursive }) as string[]).filter((f) => f.endsWith('.md')).sort().map((f) => path.join(dir, f)) : [];

/**
 * What this repository's .claude/ adds to every session at launch: .claude/CLAUDE.md, each .claude/rules/ file with no `paths`
 * frontmatter, and the skill listing of .claude/skills/<name>/SKILL.md and .claude/agents/*.md (code.claude.com/docs/en/memory
 * and /skills, read 2026-11-05). The root CLAUDE.md counts on the Documentation page (start_tokens), so no file counts twice.
 * Tokens are UTF-8 bytes / 4, Git Crafter's estimate for the same files. Null on an import.
 */
export function startup(root: string): { tokens: number; files: number } | null {
  const texts: string[] = [];
  for (const file of [path.join(root, '.claude', 'CLAUDE.md'), ...mdIn(path.join(root, '.claude', 'rules'), true)]) {
    const raw = readText(file);
    // A rule with `paths` loads only with a matching file, not at launch.
    if (raw === null || /^paths:/m.test(frontmatter(raw))) continue;
    const text = loadedText(raw);
    if (text === null) return null;
    texts.push(text);
  }
  const skills = path.join(root, '.claude', 'skills');
  const named = existsSync(skills) ? readdirSync(skills).sort().map((d) => path.join(skills, d, 'SKILL.md')) : [];
  for (const file of [...named, ...mdIn(path.join(root, '.claude', 'agents'), false)]) {
    const raw = readText(file);
    if (raw !== null) texts.push(listing(raw));
  }
  const bytes = texts.reduce((n, t) => n + Buffer.byteLength(t, 'utf8'), 0);
  return texts.length ? { tokens: Math.ceil(bytes / 4), files: texts.length } : null;
}

const missing = (id: string): MetricRecord => ({ id, page: PAGE, value: null, status: 'missing', stage: 'live', measured_at: null, source_url: null, sample_size: null });
const ok = (id: string, value: number, sample: number, run: Run): MetricRecord => ({ id, page: PAGE, value, status: 'ok', stage: 'live', measured_at: run.now, source_url: run.sourceUrl, sample_size: sample });

/** The page's records. `settings` null means the file is absent or not JSON, so Claude Code applies none of its rules. */
export function collect(expected: Expected, settings: unknown, versions: readonly Version[], run: Run): MetricRecord[] {
  const repo = repoRows(expected);
  const met = repo.filter((r) => meets(r, settings)).length;
  const deny = repo.filter((r) => r.op === 'denied');
  const open = repo.length ? openHours(met === repo.length, versions, run.now) : null;
  return [
    repo.length ? ok('settings_match', Math.round((met / repo.length) * 10_000) / 100, repo.length, run) : missing('settings_match'),
    deny.length ? ok('deny_rules_kept', deny.every((r) => meets(r, settings)) ? 1 : 0, deny.reduce((n, r) => n + (r.values?.length ?? 0), 0), run) : missing('deny_rules_kept'),
    open ? ok('drift_open_hours', open.hours, open.read, run) : missing('drift_open_hours'),
  ];
}

function git(args: string[]): string | null {
  const out = spawnSync('git', ['-C', ROOT, ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  return out.status === 0 ? out.stdout : null;
}

/** Every commit that touched either file, newest first. */
function history(): Version[] {
  const log = git(['log', '--format=%H %cI', '--', SETTINGS, EXPECTED]) ?? '';
  return log
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha = '', at = ''] = line.split(' ');
      const show = (file: string) => parse(git(['show', `${sha}:${file}`]));
      return { at: new Date(at).toISOString(), expected: parseExpected(show(EXPECTED)), settings: show(SETTINGS) };
    });
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const arg = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const { GITHUB_SERVER_URL: server, GITHUB_REPOSITORY: repo, GITHUB_RUN_ID: id } = process.env;
  const out = arg('--out');
  const sourceUrl = arg('--run-url') ?? (server && repo && id ? `${server}/${repo}/actions/runs/${id}` : undefined);
  const expected = parseExpected(parse(readFileSync(path.join(ROOT, EXPECTED), 'utf8')));
  if (!out || !sourceUrl || !expected) {
    console.error('usage: collect.ts --out <file> [--run-url <run link>], with an expected.json that passes its check');
    process.exit(1);
  }
  const file = path.join(ROOT, SETTINGS);
  const settings = parse(existsSync(file) ? readFileSync(file, 'utf8') : null);
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const records = collect(expected, settings, history(), { now, sourceUrl });
  const start = startup(ROOT);
  records.push(start ? ok('startup_tokens', start.tokens, start.files, { now, sourceUrl }) : missing('startup_tokens'));
  // Last, after the history walk, so it times the whole lane.
  records.push(await laneRecord(PAGE));
  writeFileSync(out, `${JSON.stringify(records)}\n`);
  for (const r of repoRows(expected)) console.log(`${r.id}: ${meets(r, settings) ? 'met' : 'short'}`);
  for (const r of records) console.log(`${r.id}: ${r.status}`);
}
