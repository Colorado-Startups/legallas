// SPDX-License-Identifier: Apache-2.0
// The Cloudflare security page's collector, as core/collect.ts runs it. It reads this checkout only: the three example
// Wrangler configs, web/scripts/harden.ts and practices.json. No secret, no account, no hostname. Anything it can't read
// writes missing, never 0. Last, lane_minutes: this lane's own job time (core/lane/collect.ts).
//
//   node quality-speed/pages/cloudflare-security/collect.ts --out records.json [--run-url <a run link of this repository>]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import type { MetricRecord } from '../../contract/format.ts';
import type { Detail, Reading } from '../../core/detail.ts';
import { laneRecord } from '../../core/lane/collect.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const PAGE = 'cloudflare-security' as const;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
/** The compatibility date's goal age (manifest.json). */
export const DATE_GOAL_DAYS = 60;

/** The three Workers a room deploys, by their example config. */
export const CONFIGS = { room: 'web/wrangler.example.jsonc', mcp: 'web/wrangler.mcp.example.jsonc', backup: 'web/wrangler.backup.example.jsonc' } as const;
export type ConfigId = keyof typeof CONFIGS;
export const CHECKS = ['date', 'node', 'maps', 'urls', 'logs'] as const;
export type Check = (typeof CHECKS)[number];
const HARDEN = 'web/scripts/harden.ts';

export interface Item {
  n: number;
  label: string;
  settled: 'met' | 'fixed' | 'accepted';
  pr: number;
  check?: Check;
}
export interface Practices {
  guide: string;
  guide_date: string;
  reviewed: string;
  items: Item[];
}
/** One config's checks, and its compatibility date's age in days. */
export interface ConfigReading {
  checks: Record<Check, boolean>;
  age: number;
}
export type Configs = Record<ConfigId, ConfigReading | null>;

export const PRACTICES: Practices = JSON.parse(readFileSync(new URL('./practices.json', import.meta.url), 'utf8'));

/** JSONC to JSON: comments out, trailing commas out, strings untouched. */
export function stripJsonc(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!; // safe: in range
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? text.length : end + 1;
    } else out += c;
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}

/** One example config's checks, or null when it can't be read or has no valid compatibility date. */
export function readConfig(text: string | null, now: Date): ConfigReading | null {
  if (text === null) return null;
  let c: Record<string, unknown>;
  try {
    c = JSON.parse(stripJsonc(text)) as Record<string, unknown>;
  } catch {
    return null;
  }
  const date = typeof c.compatibility_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(c.compatibility_date) ? Date.parse(`${c.compatibility_date}T00:00:00Z`) : NaN;
  if (!Number.isFinite(date)) return null;
  const age = Math.max(0, Math.floor((now.getTime() - date) / DAY_MS));
  const flags = Array.isArray(c.compatibility_flags) ? c.compatibility_flags : [];
  const obs = (c.observability ?? {}) as { enabled?: unknown; logs?: { enabled?: unknown } };
  return {
    age,
    checks: {
      date: age <= DATE_GOAL_DAYS,
      node: flags.includes('nodejs_compat'),
      maps: c.upload_source_maps === true,
      urls: c.workers_dev === false && c.preview_urls === false,
      logs: obs.enabled === true && obs.logs?.enabled === true,
    },
  };
}

/** The rows harden.ts checks: the entries of checkAll's Promise.all, or null when it can't be found. */
export function edgeRows(text: string | null): number | null {
  const list = text && /function checkAll\([^)]*\)[^{]*\{\s*return Promise\.all\(\[([^\]]*)\]\)/.exec(text)?.[1];
  const rows = list ? list.match(/\b\w+Row\(ctx\)/g)?.length ?? 0 : 0;
  return rows > 0 ? rows : null;
}

/** An item passes its check only when every config does. Undefined when a config can't be read. */
export function itemPasses(item: Item, configs: Configs): boolean | undefined {
  if (!item.check) return true;
  const read = Object.values(configs);
  if (read.some((c) => c === null)) return undefined;
  return read.every((c) => c!.checks[item.check!]); // safe: none null
}

/** Met over applicable items: an accepted item is out of both, unless its check fails. Null when a config can't be read. */
export function practicesMet(practices: Practices, configs: Configs): { value: number; n: number } | null {
  let met = 0;
  let applicable = 0;
  for (const item of practices.items) {
    const pass = itemPasses(item, configs);
    if (pass === undefined) return null;
    if (item.settled === 'accepted' && pass) continue;
    applicable++;
    if (pass) met++;
  }
  return applicable ? { value: Math.round((10_000 * met) / applicable) / 100, n: applicable } : null;
}

/** Hours since the last complete read before this run: the gap a daily lane keeps near 24. */
export function readGap(prev: string | null, now: Date): number | null {
  const last = prev ? Date.parse(prev) : NaN;
  if (!Number.isFinite(last) || last > now.getTime()) return null;
  return Math.round(((now.getTime() - last) / HOUR_MS) * 100) / 100;
}

export interface Run {
  now: Date;
  sourceUrl: string;
}
const at = (now: Date) => `${now.toISOString().slice(0, 19)}Z`;
const missing = (id: string): MetricRecord => ({ id, page: PAGE, value: null, status: 'missing', stage: 'lab', measured_at: null, source_url: null, sample_size: null });
const ok = (id: string, value: number, sample: number, run: Run): MetricRecord => ({ id, page: PAGE, value, status: 'ok', stage: 'lab', measured_at: at(run.now), source_url: run.sourceUrl, sample_size: sample });

/** The page's records from what was read. */
export function collect(configs: Configs, rows: number | null, gap: number | null, run: Run): MetricRecord[] {
  const met = practicesMet(PRACTICES, configs);
  const ages = Object.values(configs).map((c) => c?.age ?? null);
  return [
    met ? ok('workers_practices_met', met.value, met.n, run) : missing('workers_practices_met'),
    rows ? ok('edge_rows_checked', rows, 1, run) : missing('edge_rows_checked'),
    ages.every((a) => a !== null) ? ok('compat_date_age_days', Math.max(...(ages as number[])), ages.length, run) : missing('compat_date_age_days'),
    gap !== null ? ok('sources_read_hours', gap, 1, run) : missing('sources_read_hours'),
  ];
}

/** The drill-down: each config's checks and date age. A config that can't be read has no entries, so it shows missing. */
export function detail(configs: Configs): Detail {
  const checks: Record<string, 0 | 1> = {};
  const readings: Record<string, Reading> = {};
  for (const [id, c] of Object.entries(configs)) {
    if (!c) continue;
    for (const check of CHECKS) checks[`${id}_${check}`] = c.checks[check] ? 1 : 0;
    readings[`age_${id}`] = { value: c.age, limit: DATE_GOAL_DAYS, n: 1 };
  }
  return { checks, readings };
}

const readText = (file: string): string | null => {
  try {
    return readFileSync(path.join(ROOT, file), 'utf8');
  } catch {
    return null;
  }
};

if (import.meta.main) {
  const { values } = parseArgs({ options: { out: { type: 'string' }, 'run-url': { type: 'string' } } });
  const { GITHUB_SERVER_URL: server, GITHUB_REPOSITORY: repo, GITHUB_RUN_ID: id, DETAIL_DIR, PREV_DIR } = process.env;
  const sourceUrl = values['run-url'] ?? (server && repo && id ? `${server}/${repo}/actions/runs/${id}` : undefined);
  if (!values.out || !sourceUrl) {
    console.error('usage: collect.ts --out <file> [--run-url <run link>]');
    process.exit(1);
  }
  const now = new Date();
  const configs = Object.fromEntries(Object.entries(CONFIGS).map(([k, file]) => [k, readConfig(readText(file), now)])) as Configs;
  const rows = edgeRows(readText(HARDEN));
  const complete = Object.values(configs).every((c) => c !== null) && rows !== null;
  // The lane's memory: when it last read every source.
  const prevFile = PREV_DIR ? path.join(PREV_DIR, 'facts', 'reads.json') : '';
  const prev = prevFile && existsSync(prevFile) ? ((JSON.parse(readFileSync(prevFile, 'utf8')) as { last?: unknown }).last as string | undefined) ?? null : null;
  const records = collect(configs, rows, readGap(prev, now), { now, sourceUrl });
  if (DETAIL_DIR) {
    writeFileSync(path.join(DETAIL_DIR, 'detail.json'), `${JSON.stringify(detail(configs))}\n`);
    mkdirSync(path.join(DETAIL_DIR, 'facts'), { recursive: true });
    const last = complete ? at(now) : prev;
    if (last) writeFileSync(path.join(DETAIL_DIR, 'facts', 'reads.json'), `${JSON.stringify({ last })}\n`);
  }
  // Last, after every read, so it times the whole lane.
  records.push(await laneRecord(PAGE));
  writeFileSync(values.out, `${JSON.stringify(records)}\n`);
  for (const r of records) console.log(`${r.id}: ${r.status} ${r.value ?? ''}`);
}
