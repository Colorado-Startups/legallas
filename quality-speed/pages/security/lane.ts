// SPDX-License-Identifier: Apache-2.0
// What the Security page's collectors share: reading GitHub, and turning a reading into a record. A reading of null writes
// `missing`, so an error can never read as a clean zero. Failures here name a status and never a response body.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import type { MetricRecord } from '../../contract/format.ts';

const PAGE = 'security';
const API = 'https://api.github.com';

export const repository = (): string => process.env.GITHUB_REPOSITORY ?? 'Colorado-Startups/legallas';

export interface RunContext {
  sourceUrl: string;
  measuredAt: string;
}

export function runContext(now = new Date()): RunContext {
  return {
    sourceUrl: `https://github.com/${repository()}/actions/runs/${process.env.GITHUB_RUN_ID ?? ''}`,
    measuredAt: `${now.toISOString().slice(0, 19)}Z`,
  };
}

/** `missing` when there is no value, so nothing a scan failed to prove can score. */
export function record(context: RunContext, id: string, value: number | null, sampleSize = 1): MetricRecord {
  if (value === null) return { id, page: PAGE, value: null, status: 'missing', stage: 'live', measured_at: null, source_url: null, sample_size: null };
  return { id, page: PAGE, value, status: 'ok', stage: 'live', measured_at: context.measuredAt, source_url: context.sourceUrl, sample_size: sampleSize };
}

/** The collector ran and found nothing to time. It scores 100 only while the drills prove detection works. */
export function noEvents(context: RunContext, id: string): MetricRecord {
  return { id, page: PAGE, value: null, status: 'no_events', stage: 'live', measured_at: context.measuredAt, source_url: context.sourceUrl, sample_size: 0 };
}

const nextLink = (link: string | null): string | null => /<([^>]+)>;\s*rel="next"/.exec(link ?? '')?.[1] ?? null;

async function get(url: string, token: string): Promise<Response> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
  });
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
  return response;
}

/** Every item of a listing, following its pages. `key` names the list when the answer wraps it. Any error throws. */
export async function githubList<T>(apiPath: string, key?: string, maxPages = 20): Promise<T[]> {
  const token = process.env.GH_TOKEN;
  if (!token) throw new Error('GH_TOKEN is not set');
  const items: T[] = [];
  let url: string | null = `${API}${apiPath}`;
  for (let page = 0; url && page < maxPages; page += 1) {
    const response: Response = await get(url, token);
    const body = (await response.json()) as Record<string, T[]> | T[];
    const list = key ? (body as Record<string, T[]>)[key] : body;
    if (!Array.isArray(list)) throw new Error('GitHub answered with no list');
    items.push(...list);
    url = nextLink(response.headers.get('link'));
  }
  if (url) throw new Error('the listing is longer than expected');
  return items;
}

/** Runs a read and treats any failure as no reading, naming the metric and the status only. */
export async function reading<T>(what: string, read: () => Promise<T> | T): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    console.error(`::warning title=Security collector::${what} could not be read: ${error instanceof Error ? error.message.slice(0, 80) : 'unknown'}`);
    return null;
  }
}

export interface DetailOut {
  checks: Record<string, 0 | 1>;
  readings: Record<string, { value: number; limit: number | null; n: number }>;
}

/** Writes the records, and the drill-down if the run was given a place for it. */
export function finish(records: MetricRecord[], detail: DetailOut): void {
  const { values } = parseArgs({ options: { out: { type: 'string' } } });
  if (!values.out) {
    console.error('usage: <collector> --out <file>');
    process.exit(1);
  }
  writeFileSync(values.out, `${JSON.stringify(records, null, 1)}\n`);
  const dir = process.env.DETAIL_DIR;
  if (dir) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'detail.json'), `${JSON.stringify(detail)}\n`);
  }
}
