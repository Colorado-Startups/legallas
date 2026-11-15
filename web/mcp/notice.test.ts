// SPDX-License-Identifier: Apache-2.0
// A3 on the MCP Worker: a member who hasn't ticked the current full notice can't connect an AI or call a tool.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NOTICE_VERSION } from '../worker/full-notice.ts';
import { requireMember } from './authorize.ts';
import { NOTICE_FIRST, type Props } from './contract.ts';
import { COUNSEL, fakeEnv, getKey, signedRequest } from './oauth-fakes.ts';
import { runTool } from './server.ts';
import { listedTools } from './tools/index.ts';

const NOW = new Date('2026-06-01T09:00:00.000Z');
const text = (out: { content: unknown[] }) => String((out.content[0] as { text: string }).text);
const PROPS: Props = { email: COUNSEL, role: 'counsel', clientId: 'dcr-1', clientName: 'Claude' };

test('until the member ticks the current notice, AI sign-in and every tool call are refused', async (t) => {
  t.mock.method(console, 'error', () => {}); // the fixture has no search or file bindings: those tools fail, coded
  const env = fakeEnv();
  const tick = (version: string) => env.DB.prepare('INSERT INTO notice_acks (email, version) VALUES (?1, ?2)').bind(COUNSEL, version).run();
  const signIn = async () => requireMember(await signedRequest('/authorize', COUNSEL), env, { getKey });
  const calls = async () => Promise.all(listedTools().map(async (tool) => text(await runTool(tool, {}, env, PROPS, undefined, NOW))));
  await env.DB.prepare('DELETE FROM notice_acks').run();

  for (const version of [null, 'A3-00000000']) {
    if (version) await tick(version); // an older version is not enough
    const refused = await signIn();
    assert.ok('response' in refused, String(version));
    assert.equal(refused.response.status, 403);
    assert.match(await refused.response.text(), /Read the notice first[\s\S]*\/notice\//);
    for (const out of await calls()) assert.equal(out, `notice_required: ${NOTICE_FIRST}`);
  }

  await tick(NOTICE_VERSION);
  const allowed = await signIn();
  assert.ok('member' in allowed && allowed.member.email === COUNSEL);
  for (const out of await calls()) assert.doesNotMatch(out, /^notice_required:/);
});
