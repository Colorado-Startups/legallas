// SPDX-License-Identifier: Apache-2.0
// The visit behind "Since your last visit" (D17): the room's record wins, and this browser's copy stands in whenever
// the room cannot answer, so the Overview and Documents still mark what is new. fetch and localStorage are stand-ins.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { INDEX_CSV_URL } from './files-api.ts';
import { localVisit, roomVisit } from './overview-news-seen.ts';
import { toVisit, VISIT_KEY, type Visit } from './overview-news-visit.ts';

const realFetch = globalThis.fetch;
const realStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

afterEach(() => {
  globalThis.fetch = realFetch;
  if (realStorage) Object.defineProperty(globalThis, 'localStorage', realStorage);
  else delete (globalThis as { localStorage?: unknown }).localStorage;
});

/** A Map-backed localStorage; `broken` throws on every call, as a blocked one does. */
function storage(broken = false): Map<string, string> {
  const map = new Map<string, string>();
  const fail = () => {
    throw new Error('SecurityError');
  };
  const store = {
    getItem: (key: string) => (broken ? fail() : (map.get(key) ?? null)),
    setItem: (key: string, value: string) => (broken ? fail() : void map.set(key, value)),
  };
  Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true, writable: true });
  return map;
}

/** fetch answering POST /api/seen with `status` and `body`, recording each call. */
function room(status: number, body: unknown): { method: string; url: string }[] {
  const calls: { method: string; url: string }[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ method: init?.method ?? 'GET', url: String(url) });
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return calls;
}

const NOW = new Date('2026-10-20T12:00:00.000Z');
const SERVER: Visit = { since: '2026-10-18T09:00:00.000Z', seen: NOW.toISOString() };

test('the room answers: its visit is used and the browser keeps a copy for next time', async () => {
  const map = storage();
  const calls = room(200, SERVER);
  const local = localVisit(NOW);
  assert.deepEqual(local, { since: null, seen: NOW.toISOString() }, 'this browser has never been here');
  assert.deepEqual(await roomVisit(local), SERVER, 'but the member has, on another browser');
  assert.deepEqual(calls, [{ method: 'POST', url: '/api/seen' }]);
  assert.deepEqual(JSON.parse(map.get(VISIT_KEY)!), SERVER);
});

test('the room cannot answer (no migration yet, an error, a bad body, offline): the browser copy stands in', async () => {
  const earlier: Visit = { since: '2026-10-10T00:00:00.000Z', seen: '2026-10-19T08:00:00.000Z' };
  for (const [status, body] of [[503, { error: 'unavailable' }], [500, {}], [200, { since: 'yesterday', seen: 'now' }], [403, { error: 'forbidden' }]] as const) {
    const map = storage();
    map.set(VISIT_KEY, JSON.stringify(earlier));
    room(status, body);
    const local = localVisit(NOW);
    assert.deepEqual(local, { since: earlier.seen, seen: NOW.toISOString() }, `${status}: a new visit from this browser's last`);
    assert.deepEqual(await roomVisit(local), local, String(status));
  }
  storage();
  globalThis.fetch = (async () => {
    throw new TypeError('offline');
  }) as typeof fetch;
  const local = localVisit(NOW);
  assert.deepEqual(await roomVisit(local), local, 'a network failure');
});

test('blocked storage and no room: every load is a first visit, and nothing throws', async () => {
  storage(true);
  room(503, { error: 'unavailable' });
  const local = localVisit(NOW);
  assert.deepEqual(local, { since: null, seen: NOW.toISOString() });
  assert.deepEqual(await roomVisit(local), local);
  room(200, SERVER);
  assert.deepEqual(await roomVisit(local), SERVER, 'the room still answers with storage blocked');
});

test('toVisit takes only a pair of instants', () => {
  assert.deepEqual(toVisit(SERVER), SERVER);
  assert.deepEqual(toVisit({ since: null, seen: SERVER.seen }), { since: null, seen: SERVER.seen });
  for (const bad of [null, undefined, 'x', [], { seen: 'now' }, { since: SERVER.since }]) assert.equal(toVisit(bad), null, JSON.stringify(bad));
});

test("the room's paths match the Worker's routes", () => {
  const worker = (file: string) => readFileSync(join(import.meta.dirname, '..', '..', 'worker', file), 'utf8');
  assert.ok(worker('export.ts').includes(`INDEX_CSV_PATH = '${INDEX_CSV_URL}'`), 'Download index links to the export route');
  assert.ok(worker('seen.ts').includes("SEEN_PATH = '/api/seen'"));
  assert.ok(readFileSync(join(import.meta.dirname, 'files-api.ts'), 'utf8').includes("fetch('/api/seen'"));
});
