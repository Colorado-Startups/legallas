// SPDX-License-Identifier: Apache-2.0
// The shared Copilot registration ID in legallas-mcp's config (mcp/config.test.ts holds the rest of the file).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REFERENCE_ID_PATTERN } from '../connect/copilot/validate.ts';
import { readWranglerConfig } from '../worker/wrangler-config.ts';

const { config } = readWranglerConfig('wrangler.mcp');

test('the shared Copilot registration ID is empty (download off) or a well-formed ID, never anything else', () => {
  const id: unknown = config.vars.COPILOT_REFERENCE_ID;
  assert.equal(typeof id, 'string', 'declared, so a deploy never keeps a stale dashboard value');
  assert.ok(id === '' || (REFERENCE_ID_PATTERN.test(id as string) && !(id as string).includes('${{')), 'empty, or what the Developer Portal shows');
});
