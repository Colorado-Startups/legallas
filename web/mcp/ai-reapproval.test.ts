// SPDX-License-Identifier: Apache-2.0
// AI connections at the conversion to a litigation room (mcp/conversion.ts; research J21): every grant stops, at its
// next tool call, until a person approves it again at /authorize. On real SQLite; the fixture is invented. The Data room
// page (quality-speed/pages/data-room/list.ts) reads this test by name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conversionStatements } from '../scripts/litigation.ts';
import { handleAuthorize } from './authorize.ts';
import { DECISIONS, FIELDS, type Props } from './contract.ts';
import { CLAUDE_REDIRECT, COUNSEL, OWNER, fakeEnv, fakeOAuth, getKey, signedRequest } from './oauth-fakes.ts';
import { runTool } from './server.ts';
import { listedTools } from './tools/index.ts';

const RUN = 'eeeeeeee-0000-4000-8000-00000000000e';
const STARTED = new Date('2026-06-01T09:00:00.000Z');
const LATER = new Date('2026-06-01T10:00:00.000Z');
const text = (out: { content: unknown[] }) => String((out.content[0] as { text: string }).text);

test('at conversion every AI grant stops until a person approves it again', async (t) => {
  t.mock.method(console, 'error', () => {}); // the fixture has no search or file bindings: those tools fail, coded
  const oauth = fakeOAuth();
  oauth.register(1); // dcr-1: Claude
  const env = fakeEnv(oauth);
  const grants: Props[] = [
    { email: COUNSEL, role: 'counsel', clientId: 'dcr-1', clientName: 'Claude' },
    { email: OWNER, role: 'owner', clientId: 'dcr-1', clientName: 'Claude', propose: true },
  ];
  const tools = listedTools();
  for (const props of grants) {
    for (const tool of tools) assert.doesNotMatch(text(await runTool(tool, {}, env, props, undefined, STARTED)), /^reapprove:/, 'before: as today');
  }
  const before = await env.DB.prepare('SELECT sum(tool_calls) AS n FROM usage').first<{ n: number }>();

  for (const sql of conversionStatements(RUN, 'a'.repeat(64), STARTED)) await env.DB.prepare(sql).run();
  for (const props of grants) {
    for (const tool of tools) {
      assert.match(text(await runTool(tool, {}, env, props, undefined, LATER)), /^reapprove: This room became a litigation room/, `${props.email} ${tool.name}`);
    }
  }
  assert.deepEqual(await env.DB.prepare('SELECT sum(tool_calls) AS n FROM usage').first(), before, 'stopped before the cap counts');

  // A person approves it again: the consent page, then Connect. The new grant runs; the old one stays stopped.
  const q = new URLSearchParams({ response_type: 'code', client_id: 'dcr-1', redirect_uri: CLAUDE_REDIRECT, state: 's1' });
  const shown = await handleAuthorize(await signedRequest(`/authorize?${q}`, COUNSEL), env, { getKey });
  assert.equal(shown.status, 200);
  const handle = /__Host-oauth-consent=(\w+)/.exec(shown.headers.get('set-cookie') ?? '')![1]!;
  const body = new URLSearchParams({ [FIELDS.handle]: handle, [FIELDS.decision]: DECISIONS.approve });
  assert.equal((await handleAuthorize(await signedRequest('/authorize', COUNSEL, { method: 'POST', body }), env, { getKey })).status, 302);
  const complete = oauth.calls.find((call) => call.name === 'completeAuthorization')!.args[0] as { props: Props };
  assert.ok(complete.props.reapprovedAt! >= STARTED.toISOString());
  for (const tool of tools) assert.doesNotMatch(text(await runTool(tool, {}, env, complete.props, undefined, LATER)), /^reapprove:/, tool.name);
  assert.match(text(await runTool(tools[0]!, {}, env, grants[0]!, undefined, LATER)), /^reapprove:/);
});
