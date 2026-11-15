// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GitHubError, reader, type FetchLike, type ResponseLike } from './github.ts';

const BASE = 'https://api.github.com';

function fake(pages: Record<string, { body: unknown; status?: number; next?: string; remaining?: number }>) {
  const seen: { url: string; auth: string | undefined }[] = [];
  const fetch: FetchLike = async (url, init) => {
    seen.push({ url, auth: init.headers.authorization });
    const page = pages[url];
    if (!page) throw new Error('offline');
    const headers = new Map<string, string>();
    if (page.next) headers.set('link', `<${page.next}>; rel="next", <${BASE}/last>; rel="last"`);
    headers.set('x-ratelimit-remaining', String(page.remaining ?? 5000));
    const res: ResponseLike = {
      ok: (page.status ?? 200) < 300,
      status: page.status ?? 200,
      headers: { get: (name) => headers.get(name) ?? null },
      json: async () => page.body,
    };
    return res;
  };
  return { fetch, seen };
}

describe('GitHub reader', () => {
  it('follows next links and sends the token only when set', async () => {
    const { fetch, seen } = fake({
      [`${BASE}/items?page=1`]: { body: [1, 2], next: `${BASE}/items?page=2` },
      [`${BASE}/items?page=2`]: { body: [3] },
    });
    assert.deepEqual(await reader({ fetch, token: 'invented' }).pages('/items?page=1'), [1, 2, 3]);
    assert.equal(seen[0]?.auth, 'Bearer invented');
    const anonymous = fake({ [`${BASE}/one`]: { body: { a: 1 } } });
    assert.deepEqual(await reader({ fetch: anonymous.fetch }).get('/one'), { a: 1 });
    assert.equal(anonymous.seen[0]?.auth, undefined);
  });

  it('picks items out of a wrapped page and can stop early', async () => {
    const { fetch, seen } = fake({
      [`${BASE}/runs`]: { body: { workflow_runs: [1] }, next: `${BASE}/runs2` },
      [`${BASE}/runs2`]: { body: { workflow_runs: [2] } },
    });
    const got = await reader({ fetch }).pages('/runs', (b) => (b as { workflow_runs: number[] }).workflow_runs, () => false);
    assert.deepEqual(got, [1]);
    assert.equal(seen.length, 1);
  });

  it('throws on an error status, naming the path without its query', async () => {
    const { fetch } = fake({ [`${BASE}/x?secret=1`]: { body: {}, status: 403 } });
    await assert.rejects(reader({ fetch }).get('/x?secret=1'), (e: unknown) => {
      assert.ok(e instanceof GitHubError);
      assert.equal(e.message, 'GitHub answered 403 for /x');
      return true;
    });
  });

  it('throws when the network fails, the rate limit runs low or a page is not a list', async () => {
    const { fetch } = fake({ [`${BASE}/low`]: { body: [], remaining: 10 }, [`${BASE}/obj`]: { body: {} } });
    await assert.rejects(reader({ fetch }).get('/gone'), /no answer from GitHub for \/gone/);
    await assert.rejects(reader({ fetch }).get('/low'), /rate limit/);
    await assert.rejects(reader({ fetch }).pages('/obj'), /other than a list/);
  });

  it('refuses a link to another host and a link loop', async () => {
    const away = fake({ [`${BASE}/a`]: { body: [1], next: 'https://elsewhere.example/a' } });
    await assert.rejects(reader({ fetch: away.fetch }).pages('/a'), /left the GitHub API/);
    const loop = fake({ [`${BASE}/l`]: { body: [1], next: `${BASE}/l` } });
    await assert.rejects(reader({ fetch: loop.fetch, maxPages: 3 }).pages('/l'), /too many pages/);
  });

  it('can rewrite a next link before following it', async () => {
    const { fetch, seen } = fake({
      [`${BASE}/repos/o/r/items`]: { body: [1], next: `${BASE}/repositories/7/items?page=2` },
      [`${BASE}/repos/o/r/items?page=2`]: { body: [2] },
    });
    const rewrite = (url: string) => url.replace(`${BASE}/repositories/7/`, `${BASE}/repos/o/r/`);
    assert.deepEqual(await reader({ fetch, rewrite }).pages('/repos/o/r/items'), [1, 2]);
    assert.equal(seen[1]?.url, `${BASE}/repos/o/r/items?page=2`);
  });

  it('counts its calls', async () => {
    const { fetch } = fake({ [`${BASE}/one`]: { body: {} } });
    const gh = reader({ fetch });
    await gh.get('/one');
    await gh.get('/one');
    assert.equal(gh.calls(), 2);
  });
});
