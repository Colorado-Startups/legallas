// SPDX-License-Identifier: Apache-2.0
// Fetching for the law build: allowlisted hosts only, a plain user agent, and a cache under
// ~/Library/Caches/legallas-sync/law/raw so a rebuild is offline unless --refresh asks for new copies.
// URLs come from sources.ts and never carry anything else (see its header).
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ALLOWED_HOSTS } from './sources.ts';

/** The user agent that the law build sends with its requests. */
export const USER_AGENT = 'Legallas law library build (public law research index)';
const TIMEOUT_MS = 90_000;
const PAUSE_MS = 400;
const MAX_REDIRECTS = 5;
/** Retries after a refused or overloaded answer (403, 429, 5xx): a host's passing hiccup costs a pause, not a build. */
const MAX_RETRIES = 3;
const RETRY_AFTER_CAP_MS = 60_000;

/** A fetched page: its URL and its body. */
export interface Fetched {
  url: string;
  body: Buffer;
  /** YYYY-MM-DD the body was downloaded (the cache keeps the first download's date). */
  retrieved: string;
  /** The final URL after redirects, for reading links (govinfo resolves to the edition's page). */
  finalUrl: string;
}

/** A function that fetches a URL, with the same shape as fetch. */
export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

interface CacheEntry {
  file: string;
  retrieved: string;
  finalUrl: string;
  sha256: string;
  bytes: number;
  /** How a supplied body was obtained (seed), when the build did not download it. */
  via?: string;
}

/** Throws unless `url` is https on an allowed host: the core sources' unless `hosts` adds a pack's (pack.ts). */
export function assertAllowed(url: string, hosts: ReadonlySet<string> = ALLOWED_HOSTS): URL {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !hosts.has(parsed.hostname)) throw new Error(`refusing to fetch from ${parsed.hostname}`);
  if (parsed.username || parsed.password) throw new Error('refusing a URL with credentials');
  return parsed;
}

function cacheName(url: string): string {
  const ext = /\.(docx|pdf|html?|json|xml)(?:$|\?)/.exec(new URL(url).pathname)?.[1] ?? 'bin';
  return `${createHash('sha256').update(url).digest('hex').slice(0, 24)}.${ext}`;
}

/** A cache of raw downloads keyed by URL, with an index file beside the bodies. */
export class RawCache {
  private index: Record<string, CacheEntry> | null = null;
  readonly dir: string;
  private readonly fetcher: Fetcher;
  private readonly today: () => string;
  private readonly hosts: ReadonlySet<string>;
  private readonly pauseMs: number;
  /** `pauseMs` is the politeness pause before each download; tests against a fake network pass 0. */
  constructor(dir: string, fetcher: Fetcher = fetch, today: () => string = () => new Date().toISOString().slice(0, 10), hosts: ReadonlySet<string> = ALLOWED_HOSTS, pauseMs = PAUSE_MS) {
    this.dir = dir;
    this.fetcher = fetcher;
    this.today = today;
    this.hosts = hosts;
    this.pauseMs = pauseMs;
  }

  private async load(): Promise<Record<string, CacheEntry>> {
    if (this.index) return this.index;
    try {
      this.index = JSON.parse(await readFile(path.join(this.dir, 'index.json'), 'utf8')) as Record<string, CacheEntry>;
    } catch {
      this.index = {};
    }
    return this.index;
  }

  private async save(): Promise<void> {
    await writeFile(path.join(this.dir, 'index.json'), `${JSON.stringify(this.index, null, 1)}\n`);
  }

  /** Follows redirects by hand, checking every hop's host before requesting it. */
  private async follow(url: string, headers: Record<string, string>): Promise<{ response: Response; finalUrl: string }> {
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const response = await this.fetcher(current, { headers: { 'User-Agent': USER_AGENT, ...headers }, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
      const location = response.status >= 300 && response.status < 400 ? response.headers.get('location') : null;
      if (!location) return { response, finalUrl: current };
      await response.body?.cancel().catch(() => undefined);
      current = assertAllowed(new URL(location, current).href, this.hosts).href;
    }
    throw new Error('too many redirects');
  }

  /**
   * One polite request, retried up to MAX_RETRIES times on 403, 429 and 5xx with a growing pause (the answer's
   * `Retry-After` wins, capped at a minute). Any other status, and the last retry's, is returned for the caller to judge.
   */
  private async download(url: string, headers: Record<string, string>): Promise<{ response: Response; finalUrl: string }> {
    for (let attempt = 0; ; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, this.pauseMs * (attempt === 0 ? 1 : 5 * 2 ** (attempt - 1))));
      const result = await this.follow(url, headers);
      const { status } = result.response;
      const retryable = status === 403 || status === 429 || status >= 500;
      if (!retryable || attempt === MAX_RETRIES) return result;
      const seconds = Number(result.response.headers.get('retry-after'));
      await result.response.body?.cancel().catch(() => undefined);
      if (Number.isFinite(seconds) && seconds > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(seconds * 1000, RETRY_AFTER_CAP_MS)));
    }
  }

  /**
   * The cached body, or a fresh download when absent or `refresh`. Null on a 404 (callers try another edition). A
   * `cacheOnly` source (its value says why) is never downloaded, `refresh` or not: it must have been seeded.
   */
  async get(url: string, options: { refresh?: boolean; headers?: Record<string, string>; cacheOnly?: string } = {}): Promise<Fetched | null> {
    assertAllowed(url, this.hosts);
    const index = await this.load();
    const hit = index[url];
    if (options.cacheOnly && !hit) throw new Error(`${url} is cache-only (${options.cacheOnly}) and not in the raw cache; seed it: node scripts/law/seed.ts <file>`);
    if (hit && (!options.refresh || options.cacheOnly)) {
      return { url, body: await readFile(path.join(this.dir, hit.file)), retrieved: hit.retrieved, finalUrl: hit.finalUrl };
    }
    const { response, finalUrl } = await this.download(url, options.headers ?? {});
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`fetch ${new URL(url).hostname} failed: HTTP ${response.status}`);
    const body = Buffer.from(await response.arrayBuffer());
    // OLLS answers a missing file with a 200 HTML "Page not found"; a .docx or .pdf must look like one.
    if (/\.docx$/.test(url) && body.subarray(0, 2).toString() !== 'PK') return null;
    if (/\.pdf$/.test(url) && body.subarray(0, 4).toString() !== '%PDF') return null;
    await mkdir(this.dir, { recursive: true });
    const file = cacheName(url);
    await writeFile(path.join(this.dir, file), body);
    const entry = { file, retrieved: this.today(), finalUrl, sha256: createHash('sha256').update(body).digest('hex'), bytes: body.length };
    index[url] = entry;
    await this.save();
    return { url, body, retrieved: entry.retrieved, finalUrl };
  }

  /** What the cache holds for `url`, without downloading anything. */
  async peek(url: string): Promise<{ retrieved: string; finalUrl: string } | null> {
    const hit = (await this.load())[url];
    return hit ? { retrieved: hit.retrieved, finalUrl: hit.finalUrl } : null;
  }

  /** Puts a body obtained outside the build (a cache-only source) into the cache under its URL, with its provenance. */
  async seed(url: string, body: Buffer, provenance: { retrieved: string; via: string }): Promise<void> {
    assertAllowed(url, this.hosts);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(provenance.retrieved)) throw new Error('bad retrieval date');
    const index = await this.load();
    await mkdir(this.dir, { recursive: true });
    const file = cacheName(url);
    await writeFile(path.join(this.dir, file), body);
    index[url] = { file, retrieved: provenance.retrieved, finalUrl: url, sha256: createHash('sha256').update(body).digest('hex'), bytes: body.length, via: provenance.via };
    await this.save();
  }
}
