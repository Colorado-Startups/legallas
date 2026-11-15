// SPDX-License-Identifier: Apache-2.0
// The smoke-client sweep with a fake KV that lists keys with their expiry and metadata the way Workers KV does
// (sorted, a cursor that resumes after the last key returned), and fake helpers that read and delete `client:` keys
// like the library, charging a delete what the library's costs (the key, every grant page, every legacy grant).
// Only old, unconnected dynamic registrations named exactly legallas-smoke may ever be deleted.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { SMOKE_CLIENT_NAME, STATIC_CLIENT_PREFIX, type McpEnv } from './contract.ts';
import {
  CLIENT_PAGE,
  DELETE_SUBREQUEST_BUDGET,
  MAX_GRANT_READS,
  MAX_SMOKE_DELETES_PER_RUN,
  SMOKE_CLIENT_MIN_AGE_SECONDS,
  SMOKE_CURSOR_KEY,
  SmokeSweepRefused,
  deleteCap,
  grantedClients,
  isOldSmokeClient,
  sweepSmokeClients,
} from './smoke-clients.ts';

const NOW = Date.parse('2026-10-20T12:00:00Z');
const NOW_S = NOW / 1000;
const OLD = NOW_S - 2 * 86400;
const FRESH = NOW_S - 3600;
const EXPIRES = NOW_S + 28 * 86400;

interface Entry {
  value: string;
  expiration?: number;
  metadata?: unknown;
}

/** The sweep's cost so far: every KV and helper call counts one operation, plus what a library delete charges. */
interface Meter {
  ops: number;
}

/** A KV namespace over `store` that lists, gets, puts and deletes as Workers KV does, counting each call. */
function fakeKv(store: Map<string, Entry>, meter: Meter, failList: boolean | undefined) {
  return {
    async list({ prefix = '', limit = 1000, cursor }: { prefix?: string; limit?: number; cursor?: string }) {
      meter.ops++;
      if (failList && cursor !== undefined) throw new Error('KV list failed');
      const names = [...store.keys()].filter((name) => name.startsWith(prefix)).sort();
      const rest = cursor === undefined ? names : names.filter((name) => name > cursor);
      const page = rest.slice(0, limit);
      const complete = page.length === rest.length;
      const keys = page.map((name) => {
        const { expiration, metadata } = store.get(name)!;
        return { name, ...(expiration === undefined ? {} : { expiration }), ...(metadata === undefined ? {} : { metadata }) };
      });
      return { keys, list_complete: complete, ...(complete ? {} : { cursor: page[page.length - 1] }) };
    },
    async get(key: string, type?: string) {
      meter.ops++;
      const entry = store.get(key);
      if (!entry) return null;
      return type === 'json' ? JSON.parse(entry.value) : entry.value;
    },
    async put(key: string, value: string) {
      meter.ops++;
      store.set(key, { value });
    },
    async delete(key: string) {
      meter.ops++;
      store.delete(key);
    },
  };
}

/** The OAuth library's helpers: look a client up, and delete one at the library's cost. */
function fakeHelpers(
  store: Map<string, Entry>,
  meter: Meter,
  deleted: string[],
  looked: string[],
  failDelete: ((clientId: string) => boolean) | undefined,
) {
  return {
    async lookupClient(clientId: string) {
      meter.ops++;
      looked.push(clientId);
      const entry = store.get(`client:${clientId}`);
      return entry ? JSON.parse(entry.value) : null;
    },
    // The library deletes the key, then lists every grant page and reads every grant written without metadata, to
    // revoke any that name the client (workers-oauth-provider 1.2.3, deleteClient and findGrants).
    async deleteClient(clientId: string) {
      const grants = [...store.keys()].filter((name) => name.startsWith('grant:'));
      const legacy = grants.filter((name) => store.get(name)!.metadata === undefined).length;
      meter.ops += 1 + Math.max(1, Math.ceil(grants.length / 1000)) + legacy;
      if (failDelete?.(clientId)) throw new TypeError('delete failed');
      deleted.push(clientId);
      store.delete(`client:${clientId}`);
    },
  };
}

/** Seeders for the three kinds of key the sweep reads: a registered client, a created one, and a grant. */
function seeders(store: Map<string, Entry>) {
  return {
    /** A /register client: an expiring `client:` key, named legallas-smoke and two days old unless told otherwise. */
    registered(clientId: string, client: { clientName?: string; registrationDate?: number } = {}): void {
      const record = { clientId, clientName: SMOKE_CLIENT_NAME, registrationDate: OLD, redirectUris: ['https://app.harvey.ai/oauth/callback'], ...client };
      store.set(`client:${clientId}`, { value: JSON.stringify(record), expiration: EXPIRES });
    },
    /** A client created on /admin/clients: a `client:` key that never expires, and the page's index entry. */
    created(clientId: string, clientName = SMOKE_CLIENT_NAME): void {
      store.set(`client:${clientId}`, { value: JSON.stringify({ clientId, clientName, registrationDate: OLD, redirectUris: [] }) });
      store.set(`${STATIC_CLIENT_PREFIX}${clientId}`, { value: '1' });
    },
    /** A grant naming `clientId`: in the key's metadata, or (legacy) only in the record. */
    granted(key: string, clientId: string, legacy = false): void {
      store.set(`grant:${key}`, { value: JSON.stringify({ id: key, clientId }), ...(legacy ? {} : { metadata: { clientId } }) });
    },
  };
}

function setup(options: { failDelete?: (clientId: string) => boolean; failList?: boolean } = {}) {
  const store = new Map<string, Entry>();
  const deleted: string[] = [];
  const looked: string[] = [];
  const meter: Meter = { ops: 0 };
  const env = { OAUTH_KV: fakeKv(store, meter, options.failList), OAUTH_PROVIDER: fakeHelpers(store, meter, deleted, looked, options.failDelete) } as unknown as McpEnv;
  const { registered, created, granted } = seeders(store);
  return { env, store, deleted, looked, registered, created, granted, ops: () => meter.ops };
}

function quiet(t: TestContext) {
  const logs: unknown[][] = [];
  const errors: unknown[][] = [];
  t.mock.method(console, 'log', (...args: unknown[]) => void logs.push(args));
  t.mock.method(console, 'error', (...args: unknown[]) => void errors.push(args));
  return { logs, errors };
}

test('isOldSmokeClient: exactly the smoke name, registered at least a day ago', () => {
  const day = SMOKE_CLIENT_MIN_AGE_SECONDS;
  assert.equal(isOldSmokeClient({ clientName: SMOKE_CLIENT_NAME, registrationDate: NOW_S - day }, NOW_S), true);
  assert.equal(isOldSmokeClient({ clientName: SMOKE_CLIENT_NAME, registrationDate: NOW_S - day + 1 }, NOW_S), false);
  assert.equal(isOldSmokeClient({ clientName: SMOKE_CLIENT_NAME, registrationDate: undefined }, NOW_S), false);
  assert.equal(isOldSmokeClient({ clientName: SMOKE_CLIENT_NAME, registrationDate: Number.NaN }, NOW_S), false);
  for (const clientName of ['legallas-smoke-harvey', 'legallas-smoke-apim', 'Legallas-Smoke', ' legallas-smoke', 'legallas-smoke ', 'Harvey', undefined]) {
    assert.equal(isOldSmokeClient({ clientName, registrationDate: OLD }, NOW_S), false, String(clientName));
  }
  assert.equal(isOldSmokeClient(null, NOW_S), false);
});

test('deletes only old, unconnected legallas-smoke registrations; static, fresh, other and connected clients stay', async (t) => {
  quiet(t);
  const { env, store, deleted, registered, created, granted } = setup();
  registered('smoke-old-1');
  registered('smoke-old-2');
  registered('smoke-fresh', { registrationDate: FRESH });
  registered('e2e-harvey', { clientName: 'legallas-smoke-harvey' });
  registered('firm-harvey', { clientName: 'Harvey' });
  registered('smoke-undated', { registrationDate: undefined });
  registered('smoke-connected');
  granted('counsel@firm.example:g1', 'smoke-connected');
  registered('smoke-legacy-grant');
  granted('counsel@firm.example:g2', 'smoke-legacy-grant', true);
  created('static-named-smoke');
  // Worst case: an indexed static client whose key expires anyway is still never deleted.
  registered('static-indexed');
  store.set(`${STATIC_CLIENT_PREFIX}static-indexed`, { value: '1' });

  const result = await sweepSmokeClients(env, NOW);
  assert.deepEqual(deleted.sort(), ['smoke-old-1', 'smoke-old-2']);
  assert.deepEqual(result, { checked: 10, deleted: 2, withGrant: 2, skipped: 0, more: false });
  for (const kept of ['smoke-fresh', 'e2e-harvey', 'firm-harvey', 'smoke-undated', 'smoke-connected', 'smoke-legacy-grant', 'static-named-smoke', 'static-indexed']) {
    assert.ok(store.has(`client:${kept}`), kept);
  }
  assert.ok(store.has(`${STATIC_CLIENT_PREFIX}static-named-smoke`));
  assert.equal(store.has(SMOKE_CURSOR_KEY), false);
});

test('a client key with no expiry is never even read: /admin/clients writes those', async (t) => {
  quiet(t);
  const { env, looked, created, registered } = setup();
  created('static-1', 'Microsoft');
  created('static-2');
  registered('smoke-old');
  await sweepSmokeClients(env, NOW);
  assert.deepEqual(looked, ['smoke-old']);
});

test('the log line carries counts only, never a client ID or name', async (t) => {
  const { logs, errors } = quiet(t);
  const { env, registered } = setup();
  registered('smoke-old-secretive-id');
  await sweepSmokeClients(env, NOW);
  assert.deepEqual(logs, [[JSON.stringify({ event: 'mcp.smoke_sweep', checked: 1, deleted: 1, withGrant: 0, skipped: 0, more: false })]]);
  assert.deepEqual(errors, []);
});

test('deletes at most MAX_SMOKE_DELETES_PER_RUN per run; the next run lists the same page again and finishes', async (t) => {
  quiet(t);
  const { env, store, deleted, registered } = setup();
  for (let i = 0; i < MAX_SMOKE_DELETES_PER_RUN + 5; i++) registered(`smoke-${String(i).padStart(3, '0')}`);
  const first = await sweepSmokeClients(env, NOW);
  assert.deepEqual([first.deleted, first.skipped, first.more], [MAX_SMOKE_DELETES_PER_RUN, 0, true]);
  const second = await sweepSmokeClients(env, NOW);
  assert.deepEqual([second.deleted, second.skipped, second.more], [5, 0, false]);
  assert.equal(deleted.length, MAX_SMOKE_DELETES_PER_RUN + 5);
  assert.equal([...store.keys()].filter((key) => key.startsWith('client:')).length, 0);
});

test('a long list is read two pages a run and resumed from the saved cursor; more clears once the pass reaches the end', async (t) => {
  quiet(t);
  const { env, store, deleted, looked, registered } = setup();
  for (let i = 0; i < 3 * CLIENT_PAGE; i++) registered(`c-${String(i).padStart(3, '0')}`, { clientName: 'Claude' });
  registered('c-010-smoke');
  registered('c-140-smoke');
  const first = await sweepSmokeClients(env, NOW);
  assert.deepEqual([first.checked, first.deleted, first.more], [2 * CLIENT_PAGE, 1, true]);
  assert.ok(looked.length <= 2 * CLIENT_PAGE, `reads: ${looked.length}`);
  assert.ok(store.has(SMOKE_CURSOR_KEY));
  const second = await sweepSmokeClients(env, NOW);
  assert.deepEqual([second.deleted, second.more], [1, false], 'the rest of the list, then nothing left');
  assert.equal(store.has(SMOKE_CURSOR_KEY), false, 'back to the start once the list ended');
  assert.deepEqual(deleted, ['c-010-smoke', 'c-140-smoke']);
});

test('pressing until more is false clears every old smoke client from a list of hundreds, in a few passes', async (t) => {
  quiet(t);
  const { env, store, deleted, registered } = setup();
  for (let i = 0; i < 300; i++) registered(`c-${String(i).padStart(3, '0')}${i % 4 === 0 ? '-smoke' : ''}`, i % 4 === 0 ? {} : { clientName: 'Claude' });
  let passes = 0;
  for (let more = true; more && passes < 20; passes++) more = (await sweepSmokeClients(env, NOW)).more;
  assert.ok(passes <= 6, `passes: ${passes}`);
  assert.equal(deleted.length, 75);
  assert.equal([...store.keys()].filter((key) => key.endsWith('-smoke')).length, 0);
  assert.equal([...store.keys()].filter((key) => key.startsWith('client:')).length, 225, 'every other client stays');
});

test('deleteCap divides the delete budget by what one library delete costs this run', () => {
  assert.equal(deleteCap(1, 0), MAX_SMOKE_DELETES_PER_RUN);
  assert.equal(deleteCap(20, MAX_GRANT_READS), Math.floor(DELETE_SUBREQUEST_BUDGET / (1 + 20 + MAX_GRANT_READS)));
  assert.equal(deleteCap(10_000, 10_000), 1, 'never below one');
  assert.equal(deleteCap(0, 0), MAX_SMOKE_DELETES_PER_RUN, 'a listing is always one page at least');
});

test('a run stays far below the per-invocation subrequest limit with few grants', async (t) => {
  quiet(t);
  const { env, registered, granted, ops } = setup();
  for (let i = 0; i < 400; i++) registered(`s-${String(i).padStart(3, '0')}`);
  for (let i = 0; i < 40; i++) granted(`u${i}@firm.example:g${i}`, `s-${String(i).padStart(3, '0')}`);
  await sweepSmokeClients(env, NOW);
  assert.ok(ops() < 300, `KV operations: ${ops()}`);
});

test('with 20 pages of grants and every legacy read allowed, fewer deletes keep the run within budget', async (t) => {
  quiet(t);
  const { env, store, deleted, registered, ops } = setup();
  for (let i = 0; i < 100; i++) registered(`s-${String(i).padStart(3, '0')}`);
  for (let i = 0; i < 20_000 - MAX_GRANT_READS; i++) store.set(`grant:u@firm.example:m${String(i).padStart(5, '0')}`, { value: '{}', metadata: { clientId: 'other' } });
  for (let i = 0; i < MAX_GRANT_READS; i++) store.set(`grant:u@firm.example:l${String(i).padStart(3, '0')}`, { value: JSON.stringify({ clientId: 'other' }) });
  const result = await sweepSmokeClients(env, NOW);
  assert.equal(deleted.length, deleteCap(20, MAX_GRANT_READS));
  assert.ok(deleted.length < MAX_SMOKE_DELETES_PER_RUN);
  assert.equal(result.more, true);
  // A fixed 25 would cost 25 x (1 + 20 + 50) = 1,775 here, past the 1,000 per invocation.
  assert.ok(ops() <= 700, `KV operations: ${ops()}`);
});

test('a failed delete is counted, logged by code and never stops the sweep', async (t) => {
  const { errors } = quiet(t);
  const { env, deleted, registered } = setup({ failDelete: (id) => id === 'smoke-a' });
  registered('smoke-a');
  registered('smoke-b');
  const result = await sweepSmokeClients(env, NOW);
  assert.deepEqual(deleted, ['smoke-b']);
  assert.deepEqual([result.deleted, result.skipped, result.more], [1, 1, true]);
  assert.deepEqual(errors, [[JSON.stringify({ event: 'mcp.smoke_sweep_delete_failed', code: 'TypeError' })]]);
});

test('too many legacy grants to read is refused before any delete, by name', async (t) => {
  const { logs } = quiet(t);
  const { env, store, deleted, registered, granted } = setup();
  registered('smoke-old');
  for (let i = 0; i <= MAX_GRANT_READS; i++) granted(`u@firm.example:g${String(i).padStart(3, '0')}`, 'other', true);
  await assert.rejects(sweepSmokeClients(env, NOW), (error: unknown) => error instanceof SmokeSweepRefused && error.name === 'SmokeSweepRefused');
  assert.deepEqual(deleted, []);
  assert.ok(store.has('client:smoke-old'));
  assert.deepEqual(logs, []);
});

test('a failed delete keeps more set until a later pass deletes it', async (t) => {
  quiet(t);
  let failing = true;
  const { env, deleted, registered } = setup({ failDelete: () => failing });
  registered('smoke-a');
  assert.equal((await sweepSmokeClients(env, NOW)).more, true);
  failing = false;
  assert.deepEqual([(await sweepSmokeClients(env, NOW)).more, deleted], [false, ['smoke-a']]);
});

test('grantedClients reads client IDs from key metadata, reading only legacy keys, and counts both', async () => {
  const { env, granted, ops } = setup();
  granted('a@firm.example:g1', 'client-a');
  granted('b@firm.example:g2', 'client-b', true);
  const before = ops();
  const scan = await grantedClients(env.OAUTH_KV);
  assert.deepEqual([...(scan?.clients ?? [])].sort(), ['client-a', 'client-b']);
  assert.deepEqual([scan?.pages, scan?.legacy], [1, 1]);
  assert.equal(ops() - before, 2, 'one list, one read');
});

test('grantedClients gives up (null) on a grant listing longer than its page cap', async () => {
  const { env, granted } = setup();
  for (let i = 0; i < 20_001; i++) granted(`u@firm.example:g${String(i).padStart(5, '0')}`, 'client-a');
  assert.equal(await grantedClients(env.OAUTH_KV), null);
});

test('a listing that fails from a saved cursor clears the cursor and rejects, so the next run starts over', async (t) => {
  quiet(t);
  const { env, store } = setup({ failList: true });
  store.set(SMOKE_CURSOR_KEY, { value: 'client:m' });
  await assert.rejects(sweepSmokeClients(env, NOW), /KV list failed/);
  assert.equal(store.has(SMOKE_CURSOR_KEY), false);
});
