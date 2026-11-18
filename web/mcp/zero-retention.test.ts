// SPDX-License-Identifier: Apache-2.0
// A room set to zero retention only (AI_POLICY "zdr", mcp/retention.ts): claude.ai, where every Claude consumer plan
// connects, and Microsoft are refused at /authorize and on every tool call; any other app waits for the owner's
// confirmation. The Data room page (quality-speed/pages/data-room/list.ts) reads this test by name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleAuthorize } from './authorize.ts';
import { DECISIONS, FIELDS, type ClientKind, type McpEnv, type Props } from './contract.ts';
import { CLAUDE_REDIRECT, COUNSEL, fakeEnv, fakeOAuth, getKey, OWNER, signedRequest } from './oauth-fakes.ts';
import { clearClientKindCache, runTool } from './server.ts';
import { listedTools } from './tools/index.ts';

const HARVEY_REDIRECT = 'https://app.harvey.ai/oauth/callback';
const ZDR = { AI_POLICY: 'zdr' } as Partial<McpEnv>;
const deps = { getKey };
const url = (clientId: string, redirectUri: string) =>
  `/authorize?${new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, state: 's1' })}`;

test('a room set to zero retention refuses a consumer AI plan', async () => {
  clearClientKindCache();
  const oauth = fakeOAuth();
  oauth.register(1); // dcr-1: Claude, on claude.ai's redirect, the way every consumer plan connects
  oauth.clients.push({ clientId: 'dcr-harvey', clientName: 'Harvey', redirectUris: [HARVEY_REDIRECT], tokenEndpointAuthMethod: 'none' });
  const show = async (env: McpEnv, clientId: string, redirectUri: string) => handleAuthorize(await signedRequest(url(clientId, redirectUri), COUNSEL), env, deps);

  // Off, as today: the consent page.
  assert.equal((await show(fakeEnv(oauth), 'dcr-1', CLAUDE_REDIRECT)).status, 200);

  // On: refused before any consent begins, and before any grant on a consent begun earlier.
  const zdr = fakeEnv(oauth, ZDR);
  const calls = oauth.calls.length;
  const refused = await show(zdr, 'dcr-1', CLAUDE_REDIRECT);
  assert.equal(refused.status, 403);
  assert.match(await refused.text(), /This plan can&#39;t be zero-retention, and this room is set to &quot;zero retention only&quot;, so it refuses it\./);
  assert.ok(!oauth.names().slice(calls).includes('beginConsent'));
  const begun = await show(fakeEnv(oauth), 'dcr-1', CLAUDE_REDIRECT);
  const handle = /__Host-oauth-consent=(\w+)/.exec(begun.headers.get('set-cookie') ?? '')![1]!;
  const body = new URLSearchParams({ [FIELDS.handle]: handle, [FIELDS.decision]: DECISIONS.approve });
  assert.equal((await handleAuthorize(await signedRequest('/authorize', COUNSEL, { method: 'POST', body }), zdr, deps)).status, 403);
  assert.ok(!oauth.names().includes('completeAuthorization'), 'no grant made');

  // A grant made before the setting fails at its next call, for every tool, before the cap counts.
  for (const kind of ['claude', 'microsoft'] as ClientKind[]) {
    const props: Props = { email: COUNSEL, role: 'counsel', clientId: 'dcr-1', clientName: 'Claude' };
    for (const tool of listedTools()) {
      const out = await runTool(tool, {}, zdr, props, undefined, new Date(), kind);
      assert.match(String((out.content[0] as { text: string }).text), /^zero_retention:/, `${kind} ${tool.name}`);
    }
  }
  const usage = await zdr.DB.prepare('SELECT count(*) AS n FROM usage').first<{ n: number }>();
  assert.equal(usage?.n, 0);

  // Any other app waits for the owner, who confirms by client id; claude.ai can't be confirmed.
  assert.equal((await show(zdr, 'dcr-harvey', HARVEY_REDIRECT)).status, 403);
  const confirmed = fakeEnv(oauth, { ...ZDR, AI_ZDR_CLIENTS: 'dcr-harvey, dcr-1' } as Partial<McpEnv>);
  assert.equal((await show(confirmed, 'dcr-harvey', HARVEY_REDIRECT)).status, 200);
  assert.equal((await show(confirmed, 'dcr-1', CLAUDE_REDIRECT)).status, 403);
});

test("a desktop app's shared client id, confirmed for one member, still refuses another; a member entry binds it", async () => {
  clearClientKindCache();
  const oauth = fakeOAuth();
  const DESKTOP = 'https://desktop.example.test/client-metadata';
  const LOOPBACK = 'http://127.0.0.1:19876/callback';
  oauth.clients.push({ clientId: DESKTOP, clientName: 'Desktop', redirectUris: [LOOPBACK], tokenEndpointAuthMethod: 'none' });
  oauth.clients.push({ clientId: 'dcr-desktop', clientName: 'Desktop', redirectUris: [LOOPBACK], tokenEndpointAuthMethod: 'none' });
  const room = (clients: string) => fakeEnv(oauth, { ...ZDR, AI_ZDR_CLIENTS: clients, MCP_REDIRECT_ALLOW: 'http://127.0.0.1' } as Partial<McpEnv>);
  const show = async (env: McpEnv, email: string, clientId: string) => {
    const response = await handleAuthorize(await signedRequest(url(clientId, LOOPBACK), email), env, deps);
    if (response.status === 403) assert.match(await response.text(), /the room owner hasn&#39;t confirmed this app keeps nothing/);
    return response.status;
  };
  const [tool] = listedTools();
  const refusedCall = async (env: McpEnv, email: string, clientId: string) => {
    const props: Props = { email, role: email === OWNER ? 'owner' : 'counsel', clientId, clientName: 'Desktop' };
    const out = await runTool(tool!, {}, env, props, undefined, new Date(), 'unknown');
    return /^zero_retention:/.test(String((out.content[0] as { text: string }).text));
  };

  // A plain shared https id stands for no one member's setup: it confirms nobody.
  const plain = room(DESKTOP);
  for (const email of [OWNER, COUNSEL]) {
    assert.equal(await show(plain, email, DESKTOP), 403, email);
    assert.equal(await refusedCall(plain, email, DESKTOP), true, email);
  }

  // The owner confirmed one member's setup: that member connects, the other is refused, at /authorize and per call.
  const bound = room(` ${OWNER.toUpperCase()}  ${DESKTOP} `);
  assert.equal(await show(bound, OWNER, DESKTOP), 200);
  assert.equal(await refusedCall(bound, OWNER, DESKTOP), false);
  assert.equal(await show(bound, COUNSEL, DESKTOP), 403);
  assert.equal(await refusedCall(bound, COUNSEL, DESKTOP), true);

  // A per-install registration's id, as /admin/clients lists it, still confirms as a plain entry.
  const perInstall = room('dcr-desktop');
  assert.equal(await show(perInstall, COUNSEL, 'dcr-desktop'), 200);
  assert.equal(await refusedCall(perInstall, COUNSEL, 'dcr-desktop'), false);
});
