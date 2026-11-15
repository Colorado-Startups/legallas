// SPDX-License-Identifier: Apache-2.0
// Every request a page's load waits on settles. getJson (files-api.ts) and the shared /api/me (room-me.ts) give up
// after their timeout, as fetchMatter does (matter-api.test.ts), so Documents and the Overview never wait on their
// Loading line for ever: a stalled request ends as a failure the page already knows how to show.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FETCH_TIMEOUT_MS, getJson } from './files-api.ts';
import { loadMe, meCan, ME_TIMEOUT_MS } from './room-me.ts';

type Seen = (AbortSignal | null | undefined)[];

/** A server that never answers: each request settles only when its signal aborts. */
function stalling(seen: Seen): typeof fetch {
  return ((_input: RequestInfo | URL, init?: RequestInit) => {
    seen.push(init?.signal);
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    });
  }) as typeof fetch;
}

/** Runs `body` with `fetch` swapped for `stub`, and puts the real one back. */
async function withFetch(stub: typeof fetch, body: () => Promise<void>): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = stub;
  try {
    await body();
  } finally {
    globalThis.fetch = original;
  }
}

const timedOut = () => new DOMException('The operation timed out.', 'TimeoutError');

test('the timeouts are long enough for a slow link and short of for ever', () => {
  for (const ms of [FETCH_TIMEOUT_MS, ME_TIMEOUT_MS]) assert.ok(ms >= 10_000 && ms <= 60_000, String(ms));
});

test('getJson sends a timeout signal; a stalled request ends as status 0 instead of hanging', async () => {
  const seen: Seen = [];
  await withFetch(stalling(seen), async () => {
    const stalled = getJson('/api/documents');
    assert.ok(seen[0] instanceof AbortSignal, 'a default signal is always sent');
    assert.equal(seen[0]?.aborted, false);
    // The caller's signal stands in for the timeout firing.
    const own = new AbortController();
    const mine = getJson('/api/documents', { signal: own.signal });
    assert.equal(seen[1], own.signal, "the caller's signal wins");
    own.abort(timedOut());
    assert.deepEqual(await mine, { ok: false, status: 0 }, 'never throws: the page shows its own error line');
    void stalled;
  });
});

test('getJson: a value, a refusal by status, and a network failure or bad body as status 0', async () => {
  let answer: () => Promise<Response> = async () => Response.json({ root: { count: 2 } });
  await withFetch((async () => answer()) as typeof fetch, async () => {
    assert.deepEqual(await getJson('/api/documents'), { ok: true, value: { root: { count: 2 } } });
    answer = async () => Response.json({ error: 'forbidden' }, { status: 403 });
    assert.deepEqual(await getJson('/api/comments'), { ok: false, status: 403 });
    answer = async () => Promise.reject(new TypeError('Failed to fetch'));
    assert.deepEqual(await getJson('/api/uploads'), { ok: false, status: 0 });
    answer = async () => new Response('<!doctype html><title>Not found</title>', { headers: { 'content-type': 'text/html' } });
    assert.deepEqual(await getJson('/api/documents'), { ok: false, status: 0 }, 'an HTML page where JSON was due');
  });
});

/** loadMe keeps its one request on window; a test gets a fresh window each time. */
async function withWindow(body: () => Promise<void>): Promise<void> {
  const g = globalThis as { window?: unknown };
  const had = 'window' in g;
  const before = g.window;
  g.window = {};
  try {
    await body();
  } finally {
    if (had) g.window = before;
    else delete g.window;
  }
}

test('/api/me sends a timeout signal, and one that fires is no answer: the page goes on, the Worker decides', async () => {
  const seen: Seen = [];
  await withWindow(async () => {
    await withFetch(((input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(init?.signal);
      assert.equal(String(input), '/api/me');
      return Promise.reject(timedOut());
    }) as typeof fetch, async () => {
      assert.equal(await loadMe(), null);
      assert.ok(seen[0] instanceof AbortSignal, 'a default signal is always sent');
      assert.equal(await meCan('readComments'), true, 'unknown counts as yes, as before');
      assert.equal(seen.length, 1, 'one shared request per page');
    });
  });
});

test('/api/me still answers as before when it answers', async () => {
  await withWindow(async () => {
    const me = { email: 'counsel@example.com', role: 'counsel', name: null, can: { readComments: true, viewActivity: false } };
    await withFetch((async () => Response.json(me)) as typeof fetch, async () => {
      assert.deepEqual(await loadMe(), me);
      assert.equal(await meCan('viewActivity'), false);
      assert.equal(await meCan('readComments'), true);
      assert.equal(await meCan('upload'), true, 'an action /api/me does not mention counts as yes');
    });
  });
});
