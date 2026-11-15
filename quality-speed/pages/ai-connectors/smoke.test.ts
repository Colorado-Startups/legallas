// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contract, ownerOf, stageOf } from './smoke.ts';

const table = (rows: string[]) => `${rows.join('\n')}\n${rows.length} pass, 0 fail, 0 skip.\n`;
const shared = ['PASS  challenge_401  status 401', 'PASS  token_exchange  status 200', 'SKIP  read_pages_sweep  none'];
const kind = (k: string, extra = '') => [`PASS  register_${k}  status 201`, `PASS  ${k}_approve_consent  302`, `PASS  ${k}_call_search  ok, text 100 chars${extra}`, `PASS  ${k}_revoke_grant  200`];

test('rows belong to their AI, Copilot being Teams, Copilot Studio and the package', () => {
  assert.equal(ownerOf('register_harvey'), 'harvey');
  assert.equal(ownerOf('register_harvey_lookalike_refused'), 'harvey');
  assert.equal(ownerOf('teams_tools_list'), 'copilot');
  assert.equal(ownerOf('apim_refresh'), 'copilot');
  assert.equal(ownerOf('copilot_package_zip'), 'copilot');
  assert.equal(ownerOf('opencode_call_search'), 'open_weight');
  assert.equal(ownerOf('register_public'), 'shared');
  assert.equal(ownerOf('register_rate_limited'), 'shared');
  assert.equal(stageOf('claude_revoked_access_refused'), 'revoke');
  assert.equal(stageOf('client_id_metadata_documents'), 'discover');
});

test('an AI with no rows of its own has no proof, so it does not connect', () => {
  const c = contract(table([...shared, ...kind('claude'), ...kind('teams'), ...kind('harvey')]))!;
  assert.deepEqual(c.connects, { claude: true, copilot: true, harvey: true, open_weight: false });
  assert.equal(c.grid.open_weight.tools, null);
  assert.equal(c.grid.claude.discover, 1);
});

test('a failed shared row fails every AI, and a Copilot result over its limit fails Copilot', () => {
  const failedShared = contract(table([...shared.map((r) => r.replace('PASS  token', 'FAIL  token')), ...kind('claude')]))!;
  assert.equal(failedShared.connects.claude, false);
  const big = contract(table([...shared, ...kind('teams').map((r) => r.replace('100 chars', '9001 chars'))]))!;
  assert.equal(big.connects.copilot, false);
});

test('an AI with a stage nothing proved does not connect, even with no failures', () => {
  const partial = [`PASS  register_harvey  status 201`, `PASS  harvey_call_search  ok, text 100 chars`];
  const c = contract(table([...shared, ...kind('claude'), ...partial]))!;
  assert.equal(c.connects.claude, true);
  assert.equal(c.connects.harvey, false, 'no own sign-in or revoke rows');
  assert.equal(c.grid.harvey.sign_in, null, 'shared sign-in rows do not stand in for its own');
});

test('a smoke that never reached its count line is no measurement', () => {
  assert.equal(contract('PASS  challenge_401  status 401\n'), null);
});
