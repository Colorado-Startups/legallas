// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NOTICE_VERSION } from '../../../web/worker/full-notice.ts';
import { labEnv, REGISTER_PROBES, registerVerdict, seedSql, TOOL_LIST, toolListTokens } from './collect.ts';

test('a registration counts as refused only by the allowlist\'s own answer', () => {
  assert.equal(registerVerdict(400, { error: 'invalid_redirect_uri' }), 'refused');
  assert.equal(registerVerdict(400, { error: 'invalid_client_metadata' }), 'unproven', 'a malformed request proves nothing');
  assert.equal(registerVerdict(400, null), 'unproven');
  assert.equal(registerVerdict(429, { error: 'invalid_redirect_uri' }), 'unproven');
  assert.equal(registerVerdict(201, {}), 'admitted');
  assert.equal(registerVerdict(0, null), 'unproven');
});

test('the lab\'s child processes never get the job\'s token', () => {
  const env = labEnv({ PATH: '/usr/bin', HOME: '/home/runner', CI: 'true', GH_TOKEN: 'x', GITHUB_TOKEN: 'x', ANSWER_TESTS_ANTHROPIC_API_KEY: 'x' });
  assert.deepEqual(env, { PATH: '/usr/bin', HOME: '/home/runner', CI: 'true', WRANGLER_SEND_METRICS: 'false' });
});

test('every denied host is probed, inside the registration limit with the control', () => {
  for (const host of ['openai.com', 'google.com', 'grok.com', 'x.ai', 'x.com']) {
    assert.ok(REGISTER_PROBES.some(([, uri]) => new URL(uri).hostname.endsWith(`.${host}`)), host);
  }
  assert.ok(REGISTER_PROBES.length + 1 <= 10);
});

test("the lab's owner has ticked the room's current notice, so sign-in gets past it", () => {
  const sql = seedSql('dev@example.com', NOTICE_VERSION);
  assert.match(sql, /INSERT OR IGNORE INTO members \(email, role, name\) VALUES \('dev@example\.com', 'owner'/);
  assert.ok(sql.includes(`INSERT OR IGNORE INTO notice_acks (email, version) VALUES ('dev@example.com', '${NOTICE_VERSION}')`));
  for (const [owner, version] of [["x'); DROP TABLE members; --@a.b", NOTICE_VERSION], ['dev@example.com', "A3-'1"]]) assert.throws(() => seedSql(owner!, version!));
});

test('the tool list counts as compact JSON, four characters a token; a missing, broken or empty list reads missing', () => {
  assert.deepEqual(toolListTokens('{ "tools": [ { "name": "a" } ] }'), { tokens: 6, tools: 1 });
  for (const text of [null, '{', '{"tools":[]}', '{"tools":{}}']) assert.equal(toolListTokens(text), null);
  const pinned = toolListTokens(readFileSync(new URL(`../../../${TOOL_LIST}`, import.meta.url), 'utf8'));
  assert.ok(pinned && pinned.tools > 0, 'the pinned list reads');
});
