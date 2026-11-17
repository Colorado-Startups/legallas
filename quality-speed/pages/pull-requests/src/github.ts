// Read-only GitHub REST access for the Pull requests page.
//
// Two transports, one shape: in CI, fetch with the job's read-only token; in a
// cloud session without a token, the preconfigured `gh api`. Pagination uses
// `page=` rather than the Link header, because some proxies refuse the
// numeric-id paths that Link headers carry. Any HTTP or parse error throws:
// a failed read is a missing measurement, never an empty list.

import { execFileSync } from "node:child_process";

export type Getter = (path: string) => Promise<unknown>;

const API = "https://api.github.com";

/** A getter that uses fetch and a token (CI). */
export function fetchGetter(token: string): Getter {
  return async (path: string) => {
    const res = await fetch(`${API}/${path}`, {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "x-github-api-version": "2022-11-28",
        "user-agent": "quality-speed-pull-requests",
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (rateLimited(res.status, res.headers, body)) throw new RateLimited(endpoint(path), res.status);
      if (res.status === 404) throw new NotFound(endpoint(path));
      throw new Error(`GET ${endpoint(path)}: HTTP ${res.status}${reason(body)}`);
    }
    return res.json();
  };
}

/** GitHub's primary or secondary rate limit: the token's budget is spent, not the read refused. */
export class RateLimited extends Error {
  constructor(path: string, status: number) {
    super(`GET ${path}: HTTP ${status}, rate limited`);
  }
}

/** A 404: the thing read does not exist, as a file absent at a commit. */
export class NotFound extends Error {
  constructor(path: string) {
    super(`GET ${path}: HTTP 404, Not Found`);
  }
}

/** A 403 or 429 that GitHub marks as a rate limit, by its headers or its message. */
export function rateLimited(status: number, headers: Headers, body: string): boolean {
  if (status !== 403 && status !== 429) return false;
  return headers.get("x-ratelimit-remaining") === "0" || headers.has("retry-after") || /rate limit|abuse detection/i.test(body);
}

/** GitHub's own message for a refused read, so the log says why: plain characters only, at most 100. */
export function reason(body: string): string {
  let message: unknown;
  try {
    message = (JSON.parse(body) as { message?: unknown }).message;
  } catch {
    return "";
  }
  if (typeof message !== "string") return "";
  const plain = message.replace(/[^A-Za-z0-9 .,'()-]/g, "").trim().slice(0, 100);
  return plain ? `, ${plain}` : "";
}

export type GraphQL = (query: string, variables: Record<string, unknown>) => Promise<unknown>;

/** A read-only GraphQL client (CI only: some sessions refuse GraphQL). Errors throw. */
export function graphqlClient(token: string): GraphQL {
  return async (query, variables) => {
    const res = await fetch(`${API}/graphql`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "user-agent": "quality-speed-pull-requests",
      },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) throw new Error(`POST graphql: HTTP ${res.status}`);
    const body = (await res.json()) as { errors?: unknown[] };
    if (Array.isArray(body.errors) && body.errors.length > 0) throw new Error("POST graphql: errors");
    return body;
  };
}

/** A getter that shells out to `gh api` (a session where gh is signed in). */
export function ghGetter(): Getter {
  return async (path: string) => {
    let out: string;
    try {
      out = execFileSync("gh", ["api", path], {
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      throw new Error(`GET ${endpoint(path)}: gh api failed`);
    }
    return JSON.parse(out);
  };
}

/** The path without its query, so errors and logs never carry branch names. */
function endpoint(path: string): string {
  return path.split("?")[0] ?? path;
}

/** Joins a path and a query parameter. */
function withParam(path: string, key: string, value: string | number): string {
  return `${path}${path.includes("?") ? "&" : "?"}${key}=${value}`;
}

/**
 * Reads every page of a list endpoint. `pick` takes the array out of an
 * envelope (for example `.workflow_runs`). Stops at a short page, and throws
 * past `maxPages` rather than returning a silently truncated list.
 */
export async function getAll<T>(
  get: Getter,
  path: string,
  pick: (body: unknown) => T[] = (b) => b as T[],
  maxPages = 50,
): Promise<T[]> {
  const perPage = 100;
  const out: T[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const body = await get(withParam(withParam(path, "per_page", perPage), "page", page));
    const items = pick(body);
    if (!Array.isArray(items)) throw new Error(`GET ${endpoint(path)}: not a list`);
    out.push(...items);
    if (items.length < perPage) return out;
  }
  throw new Error(`GET ${endpoint(path)}: more than ${maxPages} pages`);
}
