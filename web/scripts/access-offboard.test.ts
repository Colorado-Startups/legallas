// SPDX-License-Identifier: Apache-2.0
// One-step offboarding (access-offboard.ts) against a fake Cloudflare API: no request leaves the process.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ACCESS_TOKEN_ENV, AccessApiError, accessApi, hostOf, mayStillAllow, namesEmail, offboard, roomApps, roomTargets, type RoomTargets } from './access-offboard.ts';

const ACCOUNT = '0123456789abcdef0123456789abcdef';
const TOKEN = 'test-token-not-real-0001';
const LEAVER = 'ada@firm.example';
const TARGETS: RoomTargets = { hosts: ['room.example.test', 'mcp.room.example.test'], auds: ['aud-room'] };

type Policy = Record<string, unknown> & { id: string; name: string; reusable?: boolean };
interface Call {
  method: string;
  path: string;
  body: unknown;
  authorization: string | null;
}

/** A fake Access API: apps by id, policies by id (reusable) or app/id (legacy). `fail` maps "METHOD path-suffix" to a status. */
function fakeCloudflare(options: { apps?: Record<string, unknown>[]; policies?: Policy[]; fail?: Record<string, number>; revoked?: boolean } = {}) {
  const policies = new Map<string, Policy>((options.policies ?? []).map((p) => [p.id, structuredClone(p)]));
  const calls: Call[] = [];
  const ok = (result: unknown, extra: Record<string, unknown> = {}) => Response.json({ success: true, errors: [], result, ...extra });
  const fetcher = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? 'GET';
    const path = url.pathname.replace('/client/v4', '');
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method, path, body, authorization: new Headers(init.headers).get('authorization') });
    for (const [key, status] of Object.entries(options.fail ?? {})) {
      const [m, suffix] = key.split(' ');
      if (m === method && path.endsWith(suffix!)) return Response.json({ success: false, errors: [{ code: 10000, message: `refused ${LEAVER}` }] }, { status });
    }
    if (path === `/accounts/${ACCOUNT}/access/apps`) {
      const page = Number(url.searchParams.get('page'));
      return ok(page === 1 ? options.apps ?? [] : [], { result_info: { page, total_pages: 1 } });
    }
    if (path === `/accounts/${ACCOUNT}/access/organizations/revoke_user`) return ok(options.revoked ?? true);
    const id = path.split('/').at(-1)!;
    const policy = policies.get(id);
    if (!policy) return Response.json({ success: false, errors: [{ code: 404 }] }, { status: 404 });
    if (method === 'GET') return ok(policy);
    if (method === 'PUT') {
      policies.set(id, { ...policy, ...(body as Record<string, unknown>), id });
      return ok(policies.get(id));
    }
    return Response.json({ success: false }, { status: 405 });
  }) as typeof fetch;
  return { api: accessApi(TOKEN, fetcher), calls, policies };
}

const email = (address: string) => ({ email: { email: address } });
const roomApp = (policies: Policy[], extra: Record<string, unknown> = {}) => ({
  id: 'app-room',
  name: 'legallas-web',
  aud: 'aud-room',
  domain: 'room.example.test',
  policies: policies.map(({ id, name, reusable }) => ({ id, name, reusable: reusable ?? true })),
  ...extra,
});

test('removes the email from the room\'s policy, keeps every other rule and setting, confirms, then ends their sessions', async () => {
  const policy: Policy = {
    id: 'pol-members',
    name: 'Room members',
    reusable: true,
    decision: 'allow',
    include: [email('founder@example.test'), email('Ada@Firm.example'), email('bo@firm.example')],
    require: [{ geo: { country_code: 'US' } }],
    mfa_config: { allowed_authenticators: ['totp', 'security_key'], session_duration: '24h' },
    session_duration: '6h',
    app_count: 1,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
  const { api, calls, policies } = fakeCloudflare({ apps: [roomApp([policy]), { id: 'app-other', name: 'other', aud: 'aud-other', domain: 'other.example.test', policies: [{ id: 'pol-other' }] }], policies: [policy] });
  const result = await offboard(api, ACCOUNT, LEAVER, TARGETS);
  assert.deepEqual(result, { removedFrom: ['Room members'], sessionsEnded: true, failures: [], problems: [] });
  const put = calls.find((c) => c.method === 'PUT')!;
  assert.equal(put.path, `/accounts/${ACCOUNT}/access/policies/pol-members`);
  const sent = put.body as Record<string, unknown>;
  assert.deepEqual(sent.include, [email('founder@example.test'), email('bo@firm.example')]);
  assert.deepEqual(sent.mfa_config, policy.mfa_config, 'a setting this code does not edit is sent back as it was');
  assert.deepEqual(sent.require, policy.require);
  for (const field of ['id', 'app_count', 'created_at', 'updated_at', 'reusable']) assert.equal(field in sent, false, `${field} is read-only`);
  assert.deepEqual(policies.get('pol-members')!.include, [email('founder@example.test'), email('bo@firm.example')]);
  // Order: list, read, update, read back, then revoke, and nothing touches the other application.
  assert.deepEqual(calls.map((c) => `${c.method} ${c.path.replace(`/accounts/${ACCOUNT}`, '')}`), [
    'GET /access/apps',
    'GET /access/policies/pol-members',
    'PUT /access/policies/pol-members',
    'GET /access/policies/pol-members',
    'POST /access/organizations/revoke_user',
  ]);
  assert.deepEqual(calls.at(-1)!.body, { email: LEAVER });
  assert.ok(calls.every((c) => c.authorization === `Bearer ${TOKEN}`));
});

test('a legacy policy is updated at its application\'s path', async () => {
  const policy: Policy = { id: 'pol-legacy', name: 'Counsel', reusable: false, decision: 'allow', include: [email(LEAVER), email('bo@firm.example')], precedence: 1 };
  const { api, calls } = fakeCloudflare({ apps: [roomApp([policy])], policies: [policy] });
  const result = await offboard(api, ACCOUNT, LEAVER, TARGETS);
  assert.deepEqual(result.removedFrom, ['Counsel']);
  const put = calls.find((c) => c.method === 'PUT')!;
  assert.equal(put.path, `/accounts/${ACCOUNT}/access/apps/app-room/policies/pol-legacy`);
  assert.equal((put.body as { precedence?: unknown }).precedence, 1, 'precedence is the legacy policy\'s own setting');
});

test('a reusable policy shared with an application outside the room is left alone and reported', async () => {
  const policy: Policy = { id: 'pol-shared', name: 'Everyone we work with', decision: 'allow', include: [email(LEAVER), email('bo@firm.example')], app_count: 2 };
  const { api, calls } = fakeCloudflare({ apps: [roomApp([policy])], policies: [policy] });
  const result = await offboard(api, ACCOUNT, LEAVER, TARGETS);
  assert.deepEqual(result.removedFrom, []);
  assert.deepEqual(result.failures, ['shared_policy']);
  assert.equal(calls.some((c) => c.method === 'PUT'), false);
  assert.equal(result.sessionsEnded, true, 'sessions still end');
});

test('a reusable policy with no usable app_count is treated as shared and left alone (fail closed)', async () => {
  for (const app_count of [undefined, null, '1', Number.NaN]) {
    const policy: Policy = { id: 'pol-uncounted', name: 'Room members', decision: 'allow', include: [email(LEAVER), email('bo@firm.example')], ...(app_count === undefined ? {} : { app_count }) };
    const { api, calls } = fakeCloudflare({ apps: [roomApp([policy])], policies: [policy] });
    const result = await offboard(api, ACCOUNT, LEAVER, TARGETS);
    assert.deepEqual(result.removedFrom, [], String(app_count));
    assert.deepEqual(result.failures, ['shared_policy'], String(app_count));
    assert.equal(calls.some((c) => c.method === 'PUT'), false, String(app_count));
  }
});

test('a legacy policy belongs to its one application and needs no app_count', async () => {
  const policy: Policy = { id: 'pol-legacy-2', name: 'Counsel', reusable: false, decision: 'allow', include: [email(LEAVER), email('bo@firm.example')] };
  const { api } = fakeCloudflare({ apps: [roomApp([policy])], policies: [policy] });
  assert.deepEqual((await offboard(api, ACCOUNT, LEAVER, TARGETS)).removedFrom, ['Counsel']);
});

test('a policy used by both room applications counts as the room\'s own', async () => {
  const policy: Policy = { id: 'pol-both', name: 'Room members', decision: 'allow', include: [email(LEAVER), email('bo@firm.example')], app_count: 2 };
  const mcp = { ...roomApp([policy]), id: 'app-mcp', name: 'AI connect', aud: 'aud-mcp', domain: 'mcp.room.example.test/authorize' };
  const { api } = fakeCloudflare({ apps: [roomApp([policy]), mcp], policies: [policy] });
  assert.deepEqual((await offboard(api, ACCOUNT, LEAVER, TARGETS)).removedFrom, ['Room members']);
});

test('a policy naming only this email is not emptied; a rule that may still let them in is reported', async () => {
  const alone: Policy = { id: 'pol-alone', name: 'Ada only', decision: 'allow', include: [email(LEAVER)], app_count: 1 };
  const domain: Policy = { id: 'pol-domain', name: 'The firm', decision: 'allow', include: [{ email_domain: { domain: '@firm.example' } }], app_count: 1 };
  const service: Policy = { id: 'pol-sync', name: 'Sync', decision: 'non_identity', include: [{ any_valid_service_token: {} }], app_count: 1 };
  const { api, calls } = fakeCloudflare({ apps: [roomApp([alone, domain, service])], policies: [alone, domain, service] });
  const result = await offboard(api, ACCOUNT, LEAVER, TARGETS);
  assert.deepEqual(result.removedFrom, []);
  assert.deepEqual(result.failures, ['only_rule', 'still_allowed']);
  assert.match(result.problems.join('\n'), /"Ada only" allows ada@firm\.example alone/);
  assert.match(result.problems.join('\n'), /"The firm" may still let ada@firm\.example in/);
  assert.equal(calls.some((c) => c.method === 'PUT'), false);
});

test('an API refusal becomes a problem with the status and codes only, never the token, and the sessions step still runs', async () => {
  const policy: Policy = { id: 'pol-members', name: 'Room members', decision: 'allow', include: [email(LEAVER), email('bo@firm.example')], app_count: 1 };
  const { api, calls } = fakeCloudflare({ apps: [roomApp([policy])], policies: [policy], fail: { 'PUT /pol-members': 403 } });
  const result = await offboard(api, ACCOUNT, LEAVER, TARGETS);
  assert.deepEqual(result.failures, ['policy_failed']);
  assert.match(result.problems[0]!, /Updating the policy "Room members" answered 403 \(Cloudflare error 10000\): the token lacks a permission/);
  assert.equal(result.sessionsEnded, true);
  assert.equal(calls.at(-1)!.path.endsWith('/revoke_user'), true);
  assert.equal(JSON.stringify(result).includes(TOKEN), false);
});

test('when the sessions cannot be ended, that is reported too', async () => {
  for (const options of [{ fail: { 'POST /revoke_user': 500 } }, { revoked: false }]) {
    const { api } = fakeCloudflare({ apps: [roomApp([])], ...options });
    const result = await offboard(api, ACCOUNT, LEAVER, TARGETS);
    assert.equal(result.sessionsEnded, false);
    assert.deepEqual(result.failures, ['sessions_not_ended']);
  }
});

test('no room application found, or a bad account id, is said plainly', async () => {
  const { api } = fakeCloudflare({ apps: [{ id: 'app-other', name: 'other', aud: 'aud-other', domain: 'other.example.test', policies: [] }] });
  assert.deepEqual((await offboard(api, ACCOUNT, LEAVER, TARGETS)).failures, ['apps_not_found']);
  const bad = await offboard(api, 'not-an-account', LEAVER, TARGETS);
  assert.deepEqual(bad.failures, ['bad_account']);
  assert.equal(bad.sessionsEnded, false);
});

test('the token must be set and whole', () => {
  for (const token of ['', ' ', 'two words']) assert.throws(() => accessApi(token), (error: unknown) => error instanceof AccessApiError && error.message.includes(ACCESS_TOKEN_ENV));
});

test('room applications are found by AUD or by a hostname the room serves, never by anything else', () => {
  const apps = [
    { id: 'by-aud', aud: 'aud-room', domain: 'elsewhere.example.test', policies: [] },
    { id: 'by-domain', aud: 'x', domain: 'mcp.room.example.test/authorize', policies: [] },
    { id: 'by-self-hosted', aud: 'x', self_hosted_domains: ['ROOM.example.test/api/sync'], policies: [] },
    { id: 'by-destination', aud: 'x', destinations: [{ type: 'public', uri: 'room.example.test/x' }], policies: [] },
    { id: 'sub-host', aud: 'x', domain: 'evil.room.example.test', policies: [] },
    { id: 'other', aud: 'x', domain: 'other.example.test', policies: [] },
    { id: 'bad id/../', aud: 'aud-room', policies: [] },
  ];
  assert.deepEqual(roomApps(apps, TARGETS).map((a) => a.id), ['by-aud', 'by-domain', 'by-self-hosted', 'by-destination']);
});

test('the room\'s hostnames and AUD tags come from its two Wrangler configs, comments and all', () => {
  const dir = mkdtempSync(join(tmpdir(), 'offboard-'));
  const web = join(dir, 'wrangler.jsonc');
  const mcp = join(dir, 'wrangler.mcp.jsonc');
  writeFileSync(web, '{\n  // the room\n  "routes": [{ "pattern": "room.example.test", "custom_domain": true }],\n  "vars": { "ACCESS_AUD": "aud-room, aud-old", },\n}\n');
  writeFileSync(mcp, '{\n  "routes": [{ "pattern": "mcp.room.example.test/*", "zone_name": "example.test" }],\n  "vars": {}\n}\n');
  assert.deepEqual(roomTargets([web, mcp, join(dir, 'missing.jsonc')]), { hosts: ['room.example.test', 'mcp.room.example.test'], auds: ['aud-room', 'aud-old'] });
});

test('rule helpers', () => {
  assert.equal(namesEmail(email(' Ada@Firm.Example '), LEAVER), true);
  assert.equal(namesEmail(email('bo@firm.example'), LEAVER), false);
  assert.equal(mayStillAllow(email('bo@firm.example'), LEAVER), false);
  assert.equal(mayStillAllow({ email_domain: { domain: 'other.example' } }, LEAVER), false);
  assert.equal(mayStillAllow({ email_domain: { domain: 'firm.example' } }, LEAVER), true);
  assert.equal(mayStillAllow({ everyone: {} }, LEAVER), true);
  assert.equal(mayStillAllow({ group: { id: 'g1' } }, LEAVER), true);
  assert.equal(mayStillAllow({ any_valid_service_token: {} }, LEAVER), false);
  assert.equal(hostOf('https://Room.Example.test:443/path'), 'room.example.test');
  assert.equal(hostOf('localhost'), null);
  assert.equal(hostOf(42), null);
});
