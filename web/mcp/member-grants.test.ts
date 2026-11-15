// SPDX-License-Identifier: Apache-2.0
// The room's "connected?" answer from live grants (member-grants.ts): the owner revoking a counsel's app changes the
// counsel's answer and not the owner's; disconnecting one of two apps leaves the other; expired grants never count.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GrantSummary } from '@cloudflare/workers-oauth-provider';
import type { Member } from '../worker/env.ts';
import { testDb } from '../worker/sqlite-d1.ts';
import { handleConnections } from './connections.ts';
import type { McpEnv, OAuthHelpersLike } from './contract.ts';
import { FORM_COOKIE, FORM_FIELD, GRANT_FIELD, formToken } from './forms.ts';
import { liveAi, NOT_CONNECTED } from './member-grants.ts';

const ORIGIN = 'https://mcp.room.example.com';
const OWNER: Member = { email: 'owner@example.test', role: 'owner', name: 'Owner' };
const ADA: Member = { email: 'ada@firm.example', role: 'counsel', name: null };
const NOW_S = 1_792_000_000;
const DAY_S = 86_400;

function grant(id: string, userId: string, createdAt: number, clientName?: string): GrantSummary {
  const metadata = clientName === undefined ? undefined : { clientName, approvedAt: '2026-10-01T00:00:00Z' };
  return { id, clientId: `https://client.example/${id}`, userId, scope: ['case.read'], metadata, createdAt, expiresAt: createdAt + 30 * DAY_S };
}

/** Grants keyed by member, as the library keys them (grant:<userId>:<grantId>); revoke removes only that member's. */
function room(grants: GrantSummary[]) {
  const { db, sqlite } = testDb();
  for (const m of [OWNER, ADA]) sqlite.prepare('INSERT INTO members (email, role, name) VALUES (?, ?, ?)').run(m.email, m.role, m.name);
  let live = [...grants];
  const helpers = {
    async listUserGrants(userId: string) {
      return { items: live.filter((g) => g.userId === userId), cursor: undefined };
    },
    async revokeGrant(grantId: string, userId: string) {
      live = live.filter((g) => !(g.id === grantId && g.userId === userId));
    },
  } as unknown as OAuthHelpersLike;
  const env = { DB: db, OAUTH_PROVIDER: helpers, TEAM_DOMAIN: '', ACCESS_AUD: '' } as unknown as McpEnv;
  const ai = (member: Member) => liveAi(helpers, member.email, NOW_S * 1000);
  return { env, ai };
}

/** A same-origin revoke from /connections, as the page's form sends it. */
function revoke(grantId: string): Request {
  const { token } = formToken(new Request(`${ORIGIN}/connections`));
  const body = new FormData();
  body.set(FORM_FIELD, token);
  body.set(GRANT_FIELD, grantId);
  return new Request(`${ORIGIN}/connections`, { method: 'POST', headers: { cookie: `${FORM_COOKIE}=${token}`, origin: ORIGIN }, body });
}

const noAudit = async () => {};

test("the owner revokes counsel's app: counsel is not connected, the owner is unchanged", async () => {
  const r = room([grant('adaClaude0001', ADA.email, NOW_S - DAY_S, 'claude.ai'), grant('ownerClaude01', OWNER.email, NOW_S - 2 * DAY_S, 'claude.ai')]);
  const ownerBefore = await r.ai(OWNER);
  assert.deepEqual(await r.ai(ADA), { connected: true, via: 'claude.ai', at: new Date((NOW_S - DAY_S) * 1000).toISOString() });

  const res = await handleConnections(revoke('adaClaude0001'), r.env, OWNER, noAudit);
  assert.equal(res.status, 200);
  assert.deepEqual(await r.ai(ADA), NOT_CONNECTED, "counsel's grant is gone");
  assert.deepEqual(await r.ai(OWNER), ownerBefore, "the owner's own connection is untouched");
  assert.equal(ownerBefore.connected, true);
});

test('with two apps connected, disconnecting one leaves the other', async () => {
  const r = room([grant('adaClaude0001', ADA.email, NOW_S - 3 * DAY_S, 'claude.ai'), grant('adaHarvey0001', ADA.email, NOW_S - DAY_S, 'Harvey')]);
  assert.equal((await r.ai(ADA)).via, 'Harvey', 'the newest grant names the app');

  await handleConnections(revoke('adaHarvey0001'), r.env, ADA, noAudit);
  assert.deepEqual(await r.ai(ADA), { connected: true, via: 'claude.ai', at: new Date((NOW_S - 3 * DAY_S) * 1000).toISOString() });
});

test('an expired grant never counts, and an address that is not one is never looked up', async () => {
  const r = room([grant('adaOld0000001', ADA.email, NOW_S - 31 * DAY_S, 'claude.ai')]);
  assert.deepEqual(await r.ai(ADA), NOT_CONNECTED, 'past its 30 days');

  const asked: string[] = [];
  const helpers = { listUserGrants: async (userId: string) => (asked.push(userId), { items: [], cursor: undefined }) };
  for (const bad of [undefined, null, '', 'not an address', 42, { email: ADA.email }]) assert.deepEqual(await liveAi(helpers, bad), NOT_CONNECTED);
  assert.deepEqual(asked, []);
  await liveAi(helpers, ' Ada@Firm.example ');
  assert.deepEqual(asked, [ADA.email], 'a real address, normalized, is looked up');
});

test('only { connected, via, at } leaves: an unnamed app is null, never its client id or grant id', async () => {
  const r = room([grant('adaNoName0001', ADA.email, NOW_S - DAY_S), grant('adaBlank00001', ADA.email, NOW_S - 2 * DAY_S, '   ')]);
  const ai = await r.ai(ADA);
  assert.deepEqual(Object.keys(ai).sort(), ['at', 'connected', 'via']);
  assert.deepEqual(ai, { connected: true, via: null, at: new Date((NOW_S - DAY_S) * 1000).toISOString() });
  assert.doesNotMatch(JSON.stringify(ai), /client\.example|adaNoName|adaBlank/);
});
