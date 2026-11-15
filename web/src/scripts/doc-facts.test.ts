// SPDX-License-Identifier: Apache-2.0
// The document facts client: control numbers, cites, prose dates, the prefix lookup and the fetch helper.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { controlPrefix, fetchMatter, formatCite, formatControl, formatPartialDate, MATTER_TIMEOUT_MS } from './doc-facts.ts';

test('formatControl pads to six digits behind the prefix', () => {
  assert.equal(formatControl('DOE', 412), 'DOE-000412');
  assert.equal(formatControl('DOE', 1), 'DOE-000001');
  assert.equal(formatControl('ABC', 999_999), 'ABC-999999');
  assert.equal(formatControl('DOE', 1_234_567), 'DOE-1234567', 'never truncated');
  for (const none of [null, undefined, 0, -3, 1.5, Number.NaN]) assert.equal(formatControl('DOE', none), '', String(none));
});

test('formatCite reads "DOE-000412 at 3", or just the number for a whole file', () => {
  assert.equal(formatCite('DOE', { control: 412, page: 3 }), 'DOE-000412 at 3');
  assert.equal(formatCite('DOE', { control: 412, page: null }), 'DOE-000412');
  assert.equal(formatCite('DOE', { control: null, page: 3 }), '');
});

test('formatPartialDate writes prose dates in brief style', () => {
  assert.equal(formatPartialDate('2023-10-17'), 'Oct. 17, 2023');
  assert.equal(formatPartialDate('2023-10'), 'Oct. 2023');
  assert.equal(formatPartialDate('2023'), '2023');
  assert.equal(formatPartialDate('2024-03-01'), 'Mar. 1, 2024', 'no leading zero');
  assert.equal(formatPartialDate('2024-06-30'), 'June 30, 2024');
  assert.equal(formatPartialDate('2024-09'), 'Sept. 2024');
  assert.equal(formatPartialDate('2024-05-05'), 'May 5, 2024');
  for (const bad of [null, undefined, '', '2023-13', '2023-00-01', '2023-10-32', '10/17/2023', '2023-10-17T00:00:00Z']) {
    assert.equal(formatPartialDate(bad), '', String(bad));
  }
});

test('controlPrefix reads <html data-control-prefix>, falling back to the neutral DOC', () => {
  assert.equal(controlPrefix({ dataset: { controlPrefix: 'ABC' } }), 'ABC');
  assert.equal(controlPrefix({ dataset: { controlPrefix: 'DOE' } }), 'DOE', 'a room may still set the fixture prefix');
  assert.equal(controlPrefix({ dataset: {} }), 'DOC');
  assert.equal(controlPrefix({ dataset: { controlPrefix: 'abc' } }), 'DOC', 'only the shape Room.astro emits');
  assert.equal(controlPrefix(undefined), 'DOC');
  assert.equal(controlPrefix(), 'DOC', 'no document under node');
});

test('fetchMatter returns null before the first publish and throws on other failures', async () => {
  const original = globalThis.fetch;
  const calls: string[] = [];
  const respond = (res: Response) => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return res;
    }) as typeof fetch;
  };
  try {
    respond(Response.json({ error: 'not_built' }, { status: 404 }));
    assert.equal(await fetchMatter(), null);
    respond(Response.json({ version: 1, events: [] }));
    assert.deepEqual(await fetchMatter(), { version: 1, events: [] });
    respond(Response.json({ error: 'bad_matter' }, { status: 500 }));
    await assert.rejects(fetchMatter(), /matter: 500/);
    assert.deepEqual(calls, ['/api/matter', '/api/matter', '/api/matter']);
  } finally {
    globalThis.fetch = original;
  }
});

test('fetchMatter never waits for ever: it sends a timeout signal, and a caller signal replaces it', async () => {
  const original = globalThis.fetch;
  const seen: (AbortSignal | null | undefined)[] = [];
  // A server that never answers: the request settles only when its signal aborts.
  globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
    seen.push(init?.signal);
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    });
  }) as typeof fetch;
  try {
    assert.ok(MATTER_TIMEOUT_MS >= 10_000 && MATTER_TIMEOUT_MS <= 60_000, 'long enough for a slow link, short of for ever');
    const stalled = fetchMatter();
    assert.ok(seen[0] instanceof AbortSignal, 'a default signal is always sent');
    assert.equal(seen[0]?.aborted, false);
    // The caller's signal stands in for the timeout firing: the stalled request rejects instead of hanging.
    const own = new AbortController();
    const mine = fetchMatter({ signal: own.signal });
    assert.equal(seen[1], own.signal, "the caller's signal wins");
    own.abort(new DOMException('The operation timed out.', 'TimeoutError'));
    await assert.rejects(mine, { name: 'TimeoutError' });
    void stalled.catch(() => undefined);
  } finally {
    globalThis.fetch = original;
  }
});
