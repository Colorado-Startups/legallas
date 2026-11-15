// SPDX-License-Identifier: Apache-2.0
// Sign out (plan D10): quick Ask history is cleared and the member's research sockets are closed, then the browser
// goes to Access logout. The research call is a same-origin keepalive POST, and nothing it does can hold sign-out up:
// a refusal, a network error, a throw or a request that never answers all still end at the logout page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RESEARCH_PATHS } from '../../worker/agent/protocol.ts';
import { LOGOUT, researchSignout, signOut, type SignoutSteps } from './chat-signout.ts';

test('the research sign-out is a same-origin keepalive POST to the protocol path', async () => {
  const calls: [string, RequestInit][] = [];
  await researchSignout((async (url: string, init: RequestInit) => {
    calls.push([url, init]);
    return new Response(null, { status: 204 });
  }) as typeof fetch);
  assert.deepEqual(calls, [[RESEARCH_PATHS.signout, { method: 'POST', credentials: 'same-origin', keepalive: true }]]);
  assert.equal(RESEARCH_PATHS.signout, '/api/research/signout');
});

test('a refused, failed or throwing research sign-out still resolves', async () => {
  const refused = (async () => new Response(null, { status: 503 })) as unknown as typeof fetch;
  const network = (async () => {
    throw new TypeError('network');
  }) as unknown as typeof fetch;
  const throws = (() => {
    throw new Error('sync');
  }) as unknown as typeof fetch;
  for (const doFetch of [refused, network, throws]) assert.equal(await researchSignout(doFetch), undefined);
});

/** Sign-out with stand-ins; records where it went and in what order. */
function steps(research: () => Promise<void>, clear: () => Promise<void> = async () => undefined) {
  const went: string[] = [];
  const s: SignoutSteps = { clear, research, go: (url) => went.push(url) };
  return { s, went };
}

test('sign-out waits for both steps, then goes to Access logout', async () => {
  const done: string[] = [];
  const { s, went } = steps(async () => void done.push('research'), async () => void done.push('clear'));
  await signOut(s, 1000);
  assert.deepEqual(done.sort(), ['clear', 'research']);
  assert.deepEqual(went, [LOGOUT]);
});

test('a failing research sign-out never blocks logout', async () => {
  const { s, went } = steps(() => Promise.reject(new Error('boom')));
  await signOut(s, 1000);
  assert.deepEqual(went, [LOGOUT]);
});

test('a research sign-out that never answers gives way to the timeout', async () => {
  const { s, went } = steps(() => new Promise<void>(() => undefined));
  const started = Date.now();
  await signOut(s, 20);
  assert.deepEqual(went, [LOGOUT]);
  assert.ok(Date.now() - started < 1000, 'logout came at the timeout');
});
