// SPDX-License-Identifier: Apache-2.0
// Dead external links: each distinct http(s) URL the docs link to, asked once.
// Only a definite answer counts: 2xx or 3xx is alive; 404, 410 or a host that
// does not exist is dead. Anything else (401, 403, 429, 5xx, a timeout) is
// unverified, and too many unverified answers make the reading missing, never
// clean. sec.gov answers only clients that name a contact, so the run sends
// the repository's LEGALLAS_LAW_CONTACT, as the law pack does.

import { INPUTS } from './inputs.ts';

export type Verdict = 'alive' | 'dead' | 'unverified';

export interface UrlResult { url: string; verdict: Verdict; status: number | null }

/**
 * Links into this organization's own GitHub repositories and org pages (its board, its people) are left out: they are
 * private, so a signed-out request gets 404 whether or not the page exists, and the internal checks already cover this
 * repository.
 */
export function isOwnRepo(url: string): boolean {
  return /^https:\/\/github\.com\/(orgs\/)?Colorado-Startups\//i.test(url);
}

/** Placeholder addresses (RFC 2606 and RFC 6761 names, localhost) stand for a room's own host and are never fetched. */
export function isPlaceholder(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return true;
  }
  return /(^|\.)(example\.(com|org|net)|example|test|invalid|localhost)$/.test(host);
}

/** The URL without its fragment: one fetch per page, whatever the anchor. */
export function pageOf(url: string): string {
  const i = url.indexOf('#');
  return i === -1 ? url : url.slice(0, i);
}

export function verdictOf(status: number | null, error: string | null): Verdict {
  if (status !== null) {
    if (status >= 200 && status < 400) return 'alive';
    if (status === 404 || status === 410) return 'dead';
    return 'unverified';
  }
  if (error && /ENOTFOUND|EAI_NONAME/.test(error)) return 'dead';
  return 'unverified';
}

async function ask(url: string, agent: string, timeoutMs: number): Promise<UrlResult> {
  for (const method of ['HEAD', 'GET']) {
    try {
      const res = await fetch(url, { method, redirect: 'follow', headers: { 'user-agent': agent }, signal: AbortSignal.timeout(timeoutMs) });
      await res.body?.cancel();
      // Some servers refuse HEAD; ask again with GET before believing them.
      if (method === 'HEAD' && (res.status === 405 || res.status === 403 || res.status === 404 || res.status === 501)) continue;
      return { url, verdict: verdictOf(res.status, null), status: res.status };
    } catch (e) {
      const cause = (e as { cause?: { code?: string } }).cause?.code ?? String(e);
      if (method === 'GET' || !/ENOTFOUND|EAI_NONAME/.test(cause)) return { url, verdict: verdictOf(null, cause), status: null };
    }
  }
  return { url, verdict: 'unverified', status: null };
}

/** Asks every page, at most `perHost` at a time per host and `total` at a time overall. */
export async function checkUrls(urls: string[], contact: string, perHost = 2, total = 8, timeoutMs = 20_000): Promise<UrlResult[]> {
  const agent = `Legallas docs link check (${contact || 'no contact set'})`;
  const pages = [...new Set(urls.filter((u) => !isOwnRepo(u) && !isPlaceholder(u)).map(pageOf))].sort();
  const busy = new Map<string, number>();
  const results: UrlResult[] = [];
  let next = 0;
  let running = 0;
  return new Promise((resolve) => {
    const pump = () => {
      if (next >= pages.length && running === 0) return resolve(results.sort((a, b) => a.url.localeCompare(b.url)));
      for (let i = next; i < pages.length && running < total; i++) {
        const url = pages[i]!;
        const host = new URL(url).host;
        if ((busy.get(host) ?? 0) >= perHost) continue;
        pages.splice(i, 1);
        pages.splice(next, 0, url);
        next++;
        running++;
        busy.set(host, (busy.get(host) ?? 0) + 1);
        ask(url, agent, timeoutMs).then((r) => {
          results.push(r);
          running--;
          busy.set(host, (busy.get(host) ?? 1) - 1);
          pump();
        });
      }
    };
    pump();
  });
}

/**
 * A host that answers 404 for its own home page is refusing this client, not reporting a missing page (ftc.gov
 * does this to some networks). Its 404 and 410 answers become unverified. A host that no longer resolves has no home
 * page either, so its pages stay dead.
 */
export function demoteBlockedHosts(results: UrlResult[], rootAlive: Map<string, boolean>): UrlResult[] {
  return results.map((r) => (r.verdict === 'dead' && r.status !== null && rootAlive.get(new URL(r.url).host) !== true ? { ...r, verdict: 'unverified' } : r));
}

/**
 * Dead pages among the definite answers, or null (missing) when under `minShare` of them are definite, or when none is
 * alive: a resolver that fails every host would read every page dead.
 */
export function deadReading(results: UrlResult[], minShare = MIN_DEFINITE_SHARE): { dead: number; definite: number } | null {
  const definite = results.filter((r) => r.verdict !== 'unverified').length;
  if (results.length === 0 || definite / results.length < minShare || !results.some((r) => r.verdict === 'alive')) return null;
  return { dead: results.filter((r) => r.verdict === 'dead').length, definite };
}

/** Checks the URLs, then asks the home page of each host that reported a dead page. */
export async function checkWithHosts(urls: string[], contact: string): Promise<UrlResult[]> {
  const results = await checkUrls(urls, contact);
  const hosts = [...new Set(results.filter((r) => r.verdict === 'dead').map((r) => new URL(r.url).host))];
  const roots = await checkUrls(hosts.map((h) => `https://${h}/`), contact);
  const rootAlive = new Map(roots.map((r) => [new URL(r.url).host, r.verdict === 'alive']));
  return demoteBlockedHosts(results, rootAlive);
}

/** The share of definite answers below which the reading is missing. */
export const MIN_DEFINITE_SHARE = INPUTS.min_definite_share;
