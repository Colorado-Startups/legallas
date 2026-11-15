// SPDX-License-Identifier: Apache-2.0
// The propose consent on /authorize (docs/design/propose-and-approve.md): a connection stays read-only unless its member
// ticks "propose" on the consent page, which is offered only while the room's PROPOSALS_ENABLED is "1". With it off,
// the page and the grant's props are exactly what they were, whatever the form posts. Driven with the fake OAuth
// library and a locally signed Access token, as mcp/authorize.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { McpEnv } from './contract.ts';
import { handleAuthorize } from './authorize.ts';
import { CIMD_CLIENT, CLAUDE_REDIRECT, COUNSEL, fakeEnv, fakeOAuth, getKey, OWNER, signedRequest, type FakeOAuth } from './oauth-fakes.ts';

const deps = { getKey };
const URL_ = `/authorize?${new URLSearchParams({ response_type: 'code', client_id: CIMD_CLIENT, redirect_uri: CLAUDE_REDIRECT, state: 's1' })}`;

async function page(env: McpEnv, email: string): Promise<string> {
  const shown = await handleAuthorize(await signedRequest(URL_, email), env, deps);
  assert.equal(shown.status, 200);
  return shown.text();
}

/** Shows the page, then approves it with `fields` posted beside the handle; returns the grant's props. */
async function approve(env: McpEnv, oauth: FakeOAuth, email: string, fields: Record<string, string>): Promise<Record<string, unknown>> {
  await page(env, email);
  const body = new URLSearchParams({ handle: 'h1', decision: 'approve', ...fields });
  const response = await handleAuthorize(await signedRequest('/authorize', email, { method: 'POST', body }), env, deps);
  assert.equal(response.status, 302);
  const complete = oauth.calls.find((call) => call.name === 'completeAuthorization')?.args[0] as { props: Record<string, unknown> };
  return complete.props;
}

test('off: no propose box on the page, and a posted propose field is ignored: the props are as before', async () => {
  for (const value of [undefined, '0', 'true']) {
    const oauth = fakeOAuth();
    const env = fakeEnv(oauth, value === undefined ? {} : { PROPOSALS_ENABLED: value });
    assert.doesNotMatch(await page(env, COUNSEL), /name="propose"|propose new drafts/, String(value));
    const fresh = fakeOAuth();
    const props = await approve(fakeEnv(fresh, value === undefined ? {} : { PROPOSALS_ENABLED: value }), fresh, COUNSEL, { propose: '1' });
    assert.deepEqual(props, { email: COUNSEL, role: 'counsel', clientId: CIMD_CLIENT, clientName: 'claude.ai' }, String(value));
  }
});

test('on: the box is offered unticked, and only a ticked box gives the connection the propose consent', async () => {
  const shown = await page(fakeEnv(fakeOAuth(), { PROPOSALS_ENABLED: '1' }), OWNER);
  assert.match(shown, /<input type="checkbox" name="propose" value="1">/);
  assert.doesNotMatch(shown, /checked/, 'never ticked for the member');
  assert.match(shown, /changes nothing until you approve it there, and the app cannot approve it/);

  const unticked = fakeOAuth();
  assert.equal((await approve(fakeEnv(unticked, { PROPOSALS_ENABLED: '1' }), unticked, OWNER, {})).propose, undefined);
  const other = fakeOAuth();
  assert.equal((await approve(fakeEnv(other, { PROPOSALS_ENABLED: '1' }), other, OWNER, { propose: 'yes' })).propose, undefined, 'only "1" counts');
  const ticked = fakeOAuth();
  assert.deepEqual(await approve(fakeEnv(ticked, { PROPOSALS_ENABLED: '1' }), ticked, COUNSEL, { propose: '1' }), {
    email: COUNSEL,
    role: 'counsel',
    clientId: CIMD_CLIENT,
    clientName: 'claude.ai',
    propose: true,
  });
});

test('declining with the box ticked still grants nothing', async () => {
  const oauth = fakeOAuth();
  const env = fakeEnv(oauth, { PROPOSALS_ENABLED: '1' });
  await page(env, COUNSEL);
  const body = new URLSearchParams({ handle: 'h1', decision: 'deny', propose: '1' });
  await handleAuthorize(await signedRequest('/authorize', COUNSEL, { method: 'POST', body }), env, deps);
  assert.ok(!oauth.names().includes('completeAuthorization'));
});

test('public-records checks on: the box is offered and names them; ticking it gives the propose consent', async () => {
  const records = await page(fakeEnv(fakeOAuth(), { PUBLIC_RECORDS: '1' }), COUNSEL);
  assert.match(records, /<input type="checkbox" name="propose" value="1">/);
  assert.match(records, /propose public-records checks \(a check sends a name to public sites only after you approve it\) for you/);
  assert.doesNotMatch(records, /new drafts/, 'it names only what the room has on');
  const both = await page(fakeEnv(fakeOAuth(), { PUBLIC_RECORDS: '1', PROPOSALS_ENABLED: '1' }), COUNSEL);
  assert.match(both, /propose new drafts and public-records checks for you/);
  const ticked = fakeOAuth();
  assert.equal((await approve(fakeEnv(ticked, { PUBLIC_RECORDS: '1' }), ticked, COUNSEL, { propose: '1' })).propose, true);
  const unticked = fakeOAuth();
  assert.equal((await approve(fakeEnv(unticked, { PUBLIC_RECORDS: '1' }), unticked, COUNSEL, {})).propose, undefined);
});
