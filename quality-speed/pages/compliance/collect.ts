// SPDX-License-Identifier: Apache-2.0
// The Compliance page's collector: how ready the written security policies in docs/security/ are for a law firm's vendor
// risk review. It reads the seven policies at HEAD and the date git last changed each. Anything it can't read writes
// missing, never a good number. The restore drill runs in a room's own Cloudflare account, out of this lane's reach, so it
// reads missing until a job merged by the owner passes in the sample room's drill record (PLAN.md, Collector). Last,
// lane_minutes (core/lane/collect.ts).
//
//   node quality-speed/pages/compliance/collect.ts --out records.json [--run-url <a run link of this repository>]
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import type { MetricRecord } from '../../contract/format.ts';
import type { Detail, Reading } from '../../core/detail.ts';
import { laneRecord } from '../../core/lane/collect.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const PAGE = 'compliance' as const;
const DIR = 'docs/security';
const DAY_MS = 86_400_000;

/** The control areas a firm's security review asks about, one policy each. Shrinking this list lifts the score: tests pin it. */
export const AREAS = [
  { id: 'ai', file: 'ai-governance.md' },
  { id: 'access', file: 'access.md' },
  { id: 'encryption', file: 'encryption.md' },
  { id: 'data', file: 'data-and-network.md' },
  { id: 'continuity', file: 'bcp-dr.md' },
  { id: 'incidents', file: 'incident-response.md' },
  { id: 'vulns', file: 'vulnerability-management.md' },
] as const;

/** The attestations a firm asks for, as rows of the README's Attestations table. */
export const ATTESTATIONS = [
  { id: 'soc2', row: /\bSOC 2\b/ },
  { id: 'iso27001', row: /\b27001\b/ },
  { id: 'iso42001', row: /\b42001\b/ },
  { id: 'pentest', row: /penetration test/i },
] as const;

/** A dated version line, which every policy carries: "Version 1.0, 2026-11-05." */
const VERSION = /\bVersion \d+(?:\.\d+)*, \d{4}-\d{2}-\d{2}\b/;
const TICKED = /`([^`\n]+)`/g;
/**
 * A repository path: folders with an optional file, or a file with a known extension. Never `..` or `/x`. A bare dotfile isn't
 * one: policies name ignored local files such as a secrets file, whose absence is the point.
 */
const IN_FOLDER = /^(?:\.?[A-Za-z0-9_][A-Za-z0-9_.-]*\/)+(?:[A-Za-z0-9_][A-Za-z0-9_.-]*)?$/;
const FILE = /^[A-Za-z0-9_][A-Za-z0-9_.-]*\.(?:md|ts|js|mjs|json|jsonc|ya?ml|toml|sh|py|swift|sql|txt)$/;
/** A symbol named beside its file, either way round: `file` (`symbol`), or `symbol` in `file`. */
const SYMBOL_AFTER = /`([^`\s]+)`\s*\(`([A-Za-z_$][\w$]*)`\)/g;
const SYMBOL_BEFORE = /`([A-Za-z_$][\w$]*)` in `([^`\s]+)`/g;

export const isPath = (token: string) => IN_FOLDER.test(token) || FILE.test(token);

export interface Ref {
  path: string;
  symbol?: string;
}

/** Every evidence reference in a policy: each ticked path once, and each symbol named with its file. */
export function references(text: string): Ref[] {
  const paths = new Set([...text.matchAll(TICKED)].map((m) => m[1]!).filter(isPath)); // safe: group 1 always matches
  const symbols = [
    ...[...text.matchAll(SYMBOL_AFTER)].map((m) => ({ path: m[1]!, symbol: m[2]! })), // safe: both groups match
    ...[...text.matchAll(SYMBOL_BEFORE)].map((m) => ({ path: m[2]!, symbol: m[1]! })), // safe: both groups match
  ].filter((r) => isPath(r.path));
  const seen = new Set<string>();
  const unique: Ref[] = [];
  const all: Ref[] = [...[...paths].map((p) => ({ path: p })), ...symbols];
  for (const ref of all) {
    const key = `${ref.path}\0${ref.symbol ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(ref);
  }
  return unique;
}

/** What the tree holds at a path: the file's text, `dir` for a folder, or null when nothing is there. */
export type Lookup = (repoPath: string) => string | 'dir' | null;

/** Whether a reference is true to the tree: its path exists, and a named symbol appears in that file as a whole word. */
export function resolves(ref: Ref, lookup: Lookup): boolean {
  const found = lookup(ref.path.replace(/\/$/, ''));
  if (found === null) return false;
  if (ref.symbol === undefined) return true;
  return found !== 'dir' && new RegExp(`(?<![\\w$])${ref.symbol.replace(/\$/g, '\\$')}(?![\\w$])`).test(found);
}

/** Data rows of the table under a `## <heading>`, as cells; the header and its rule line are left out. */
export function tableRows(text: string, heading: string): string[][] {
  const at = text.search(new RegExp(`^## ${heading}\\s*$`, 'm'));
  if (at < 0) return [];
  const section = text.slice(at).split('\n').slice(1);
  const end = section.findIndex((line) => line.startsWith('## '));
  const lines = (end < 0 ? section : section.slice(0, end)).filter((line) => line.startsWith('|'));
  return lines.slice(2).map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()));
}

export interface PolicyReading {
  id: string;
  /** The policy file exists. */
  present: boolean;
  dated: boolean;
  refs: number;
  dead: number;
  gaps: number;
  /** Days since git last changed the file, or null when unread. */
  age: number | null;
}

/** One policy's reading from its text, the tree and its age. A file that isn't there reads as absent, with nothing in it. */
export function readPolicy(id: string, text: string | null, lookup: Lookup, age: number | null): PolicyReading {
  if (text === null) return { id, present: false, dated: false, refs: 0, dead: 0, gaps: 0, age: null };
  const refs = references(text);
  return { id, present: true, dated: VERSION.test(text), refs: refs.length, dead: refs.filter((r) => !resolves(r, lookup)).length, gaps: tableRows(text, 'Gaps').length, age };
}

/** Covered: the policy is there, dated, and names at least one piece of evidence that is in the tree. */
export const covered = (p: PolicyReading) => p.present && p.dated && p.refs > p.dead;

/** Each attestation the README's table lists as held. A row it doesn't have reads as not held, and none is ever assumed. */
export function attestations(readme: string | null): Record<string, 0 | 1> {
  const rows = readme === null ? [] : tableRows(readme, 'Attestations');
  const held: Record<string, 0 | 1> = {};
  for (const { id, row } of ATTESTATIONS) {
    const state = rows.find((cells) => row.test(cells[0] ?? ''))?.[1] ?? '';
    held[id] = state !== '' && !/^none\b/i.test(state) ? 1 : 0;
  }
  return held;
}

export const days = (from: string, now: Date) => Math.round((10 * (now.getTime() - Date.parse(from))) / DAY_MS) / 10;

export interface Run {
  now: Date;
  /** The run on the commit being scored. */
  sourceUrl: string;
}

const stamp = (now: Date) => `${now.toISOString().slice(0, 19)}Z`;
const missing = (id: string): MetricRecord => ({ id, page: PAGE, value: null, status: 'missing', stage: 'live', measured_at: null, source_url: null, sample_size: null });
const ok = (id: string, value: number, sample: number, run: Run): MetricRecord => ({ id, page: PAGE, value, status: 'ok', stage: 'live', measured_at: stamp(run.now), source_url: run.sourceUrl, sample_size: sample });

/**
 * The page's records. `policies` is null when the history couldn't be read (a shallow checkout), so no age can be trusted;
 * `drill` is when the last passing restore drill ended, or null when there is none or it couldn't be read.
 */
export function records(policies: readonly PolicyReading[] | null, drill: string | null, run: Run): MetricRecord[] {
  const ages = (policies ?? []).flatMap((p) => (p.age === null ? [] : [p.age]));
  const refs = (policies ?? []).reduce((n, p) => n + p.refs, 0);
  return [
    policies ? ok('policy_areas_covered', Math.round((10_000 * policies.filter(covered).length) / AREAS.length) / 100, AREAS.length, run) : missing('policy_areas_covered'),
    policies ? ok('evidence_refs_dead', policies.reduce((n, p) => n + p.dead, 0), refs, run) : missing('evidence_refs_dead'),
    ages.length ? ok('policy_review_age_days', Math.max(...ages), ages.length, run) : missing('policy_review_age_days'),
    drill ? ok('restore_drill_age_days', days(drill, run.now), 1, run) : missing('restore_drill_age_days'),
  ];
}

/** The drill-down: each area covered or not and each attestation held or not, and per area its references and gaps. */
export function detail(policies: readonly PolicyReading[], held: Record<string, 0 | 1>): Detail {
  const checks: Record<string, 0 | 1> = {};
  const readings: Record<string, Reading> = {};
  for (const p of policies) {
    checks[`area_${p.id}`] = covered(p) ? 1 : 0;
    readings[`dead_${p.id}`] = { value: p.dead, limit: 0, n: p.refs };
    readings[`gaps_${p.id}`] = { value: p.gaps, limit: null, n: p.present ? 1 : 0 };
    if (p.age !== null) readings[`age_${p.id}`] = { value: p.age, limit: 365, n: 1 };
  }
  for (const [id, value] of Object.entries(held)) checks[`attest_${id}`] = value;
  return { checks, readings };
}

/** The tree at HEAD, read from the checkout. Only plain repository paths reach here (`isPath`). */
export function treeLookup(root = ROOT): Lookup {
  return (repoPath) => {
    const full = path.join(root, repoPath);
    if (!existsSync(full)) return null;
    try {
      return readFileSync(full, 'utf8');
    } catch {
      return 'dir';
    }
  };
}

/** Days since git last changed a file on HEAD's history, or null when git has no date for it. */
function gitAge(root: string, file: string, now: Date): number | null {
  const at = execFileSync('git', ['log', '-1', '--format=%cI', 'HEAD', '--', file], { cwd: root, encoding: 'utf8' }).trim();
  return at ? days(at, now) : null;
}

/** Every policy's reading, or null in a shallow checkout, where git's dates can't be trusted. */
export function readPolicies(now: Date, root = ROOT): PolicyReading[] | null {
  if (execFileSync('git', ['rev-parse', '--is-shallow-repository'], { cwd: root, encoding: 'utf8' }).trim() !== 'false') return null;
  const lookup = treeLookup(root);
  return AREAS.map(({ id, file }) => {
    const repoPath = `${DIR}/${file}`;
    const text = lookup(repoPath);
    return text === null || text === 'dir' ? readPolicy(id, null, lookup, null) : readPolicy(id, text, lookup, gitAge(root, repoPath, now));
  });
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { out: { type: 'string' }, 'run-url': { type: 'string' } } });
  const { GITHUB_SERVER_URL: server, GITHUB_REPOSITORY: repo, GITHUB_RUN_ID: id, DETAIL_DIR } = process.env;
  const sourceUrl = values['run-url'] ?? (server && repo && id ? `${server}/${repo}/actions/runs/${id}` : undefined);
  if (!values.out || !sourceUrl) {
    console.error('usage: collect.ts --out <file> [--run-url <run link>]');
    process.exit(1);
  }
  const now = new Date();
  const policies = readPolicies(now);
  const readme = treeLookup()(`${DIR}/README.md`);
  // No drill record is readable from here yet: see the header.
  const written = records(policies, null, { now, sourceUrl });
  if (policies && DETAIL_DIR) writeFileSync(path.join(DETAIL_DIR, 'detail.json'), `${JSON.stringify(detail(policies, attestations(readme === 'dir' ? null : readme)))}\n`);
  // Last, after every read, so it times the whole lane.
  written.push(await laneRecord(PAGE));
  writeFileSync(values.out, `${JSON.stringify(written)}\n`);
  for (const r of written) console.log(`${r.id}: ${r.status}`);
}
