// SPDX-License-Identifier: Apache-2.0
// A small GitHub REST reader. It pages through Link headers and throws on any error or short read, so a failed call can
// only ever make a metric missing, never a good number. Errors name the status and the path, never a token or a body.

export interface ResponseLike {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}
export type FetchLike = (url: string, init: { headers: Record<string, string> }) => Promise<ResponseLike>;

export class GitHubError extends Error {}

export interface ReaderOptions {
  /** Sent as a bearer token when set. In a cloud session the proxy signs requests, so it may be absent. */
  token?: string;
  fetch?: FetchLike;
  base?: string;
  /** Stop before the rate limit runs out for the other pages sharing it. */
  minRemaining?: number;
  /** A guard against a Link loop. */
  maxPages?: number;
  /** Rewrites a next-page link before it is followed, such as GitHub's /repositories/<id>/ form to the owner/name path. */
  rewrite?: (url: string) => string;
}

export interface Reader {
  get<T>(path: string): Promise<T>;
  /**
   * Every item across pages. `pick` takes the items out of a page's body (default: the body is the list), and `more`
   * may stop early once a page shows nothing further is wanted.
   */
  pages<T>(path: string, pick?: (body: unknown) => T[], more?: (page: T[]) => boolean): Promise<T[]>;
  /** Requests made so far. */
  calls(): number;
}

const NEXT = /<([^>]+)>;\s*rel="next"/;

export function reader(options: ReaderOptions = {}): Reader {
  const base = options.base ?? 'https://api.github.com';
  const doFetch = options.fetch ?? (fetch as unknown as FetchLike);
  const minRemaining = options.minRemaining ?? 200;
  const maxPages = options.maxPages ?? 300;
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'legallas-quality-speed-insights',
  };
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  let count = 0;

  async function request(url: string): Promise<{ body: unknown; next: string | null }> {
    if (!url.startsWith(`${base}/`)) throw new GitHubError('a link left the GitHub API');
    const where = new URL(url).pathname;
    count += 1;
    let res: ResponseLike;
    try {
      res = await doFetch(url, { headers });
    } catch {
      throw new GitHubError(`no answer from GitHub for ${where}`);
    }
    if (!res.ok) throw new GitHubError(`GitHub answered ${res.status} for ${where}`);
    const remaining = Number(res.headers.get('x-ratelimit-remaining') ?? 'NaN');
    if (Number.isFinite(remaining) && remaining < minRemaining) {
      throw new GitHubError(`GitHub rate limit too low to continue at ${where}`);
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new GitHubError(`GitHub sent a body that is not JSON for ${where}`);
    }
    const next = NEXT.exec(res.headers.get('link') ?? '');
    return { body, next: next?.[1] ?? null };
  }

  const asList = <T>(body: unknown): T[] => {
    if (!Array.isArray(body)) throw new GitHubError('GitHub sent something other than a list');
    return body as T[];
  };

  return {
    async get<T>(path: string): Promise<T> {
      return (await request(`${base}${path}`)).body as T;
    },
    async pages<T>(path: string, pick: (body: unknown) => T[] = asList, more?: (page: T[]) => boolean): Promise<T[]> {
      const items: T[] = [];
      let url: string | null = `${base}${path}`;
      for (let page = 0; url !== null; page += 1) {
        if (page >= maxPages) throw new GitHubError('too many pages: stopped to avoid a loop');
        const { body, next }: { body: unknown; next: string | null } = await request(url);
        const got = pick(body);
        items.push(...got);
        if (more && !more(got)) break;
        url = next !== null && options.rewrite ? options.rewrite(next) : next;
      }
      return items;
    },
    calls: () => count,
  };
}
