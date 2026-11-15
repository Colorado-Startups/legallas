// A small read-only GitHub REST client for the Claude Code collector. It pages with
// the `page` parameter rather than Link headers, because some proxies rewrite
// those links to numeric repository ids they then refuse. A failed read
// throws: the collector turns that into a missing metric, never a good one.

export interface ListOptions {
  /** Key of the list in an object response, such as "workflow_runs". */
  key?: string;
  /** Stop after this many items: the newest ones, by the endpoint's order. */
  cap?: number;
  /** Stop once a page's last item says nothing older is needed. */
  stop?: (last: unknown) => boolean;
  /** The cap is a deliberate sample of the newest items. Otherwise reaching it means the list was cut, and that throws. */
  sample?: boolean;
}

export interface Api {
  get(path: string): Promise<unknown>;
  list(path: string, options?: ListOptions): Promise<unknown[]>;
}

/** A read that failed. `status` is the HTTP status when GitHub answered. */
export class ReadError extends Error {
  status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.status = status;
  }
}

/** Pages a list until it runs out or the stop test says enough. Reaching the cap first throws, unless the list is a sample. */
export async function pageThrough(get: (path: string) => Promise<unknown>, path: string, options: ListOptions = {}): Promise<unknown[]> {
  const out: unknown[] = [];
  const sep = path.includes("?") ? "&" : "?";
  const cap = options.cap ?? 3000;
  const page = async (n: number): Promise<unknown[]> => {
    const body = await get(`${path}${sep}per_page=100&page=${n}`);
    const items = options.key ? (body as Record<string, unknown>)[options.key] : body;
    if (!Array.isArray(items)) throw new ReadError(`GET ${path}: no list${options.key ? ` under ${options.key}` : ""}`);
    return items;
  };
  for (let n = 1; ; n++) {
    const items = await page(n);
    out.push(...items);
    if (items.length < 100 || (options.stop && options.stop(items[items.length - 1]))) return out.slice(0, cap);
    if (out.length < cap) continue;
    if (options.sample) return out.slice(0, cap);
    if ((await page(n + 1)).length === 0) return out;
    throw new ReadError(`GET ${path}: more than ${cap} items`);
  }
}

export function restApi(token: string, base = "https://api.github.com"): Api {
  async function get(path: string): Promise<unknown> {
    const response = await fetch(base + path, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "legallas-quality-speed-claude-code",
      },
    });
    if (!response.ok) throw new ReadError(`GET ${path}: HTTP ${response.status}`, response.status);
    return response.json();
  }
  return { get, list: (path, options) => pageThrough(get, path, options) };
}
