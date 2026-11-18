// SPDX-License-Identifier: Apache-2.0
// Guards on wrangler.mcp.jsonc, the same production rules worker/config.test.ts holds the room to, plus what
// the OAuth library and the owner's decisions need. A checkout without the room's own file holds
// wrangler.mcp.example.jsonc to the product's rules instead (worker/wrangler-config.ts); the room's own settings
// are checked only in the room's file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MFA_SETTINGS } from '../worker/mfa.ts';
import { definedSetting, hasRoomConfig, readWranglerConfig, withoutRoomExtras, withoutRoomFields } from '../worker/wrangler-config.ts';
import { MCP_HOST } from './contract.ts';

const { raw, config, example } = readWranglerConfig('wrangler.mcp');
/** For a guard on a setting the room makes itself, which the example leaves to it. */
const roomOnly = { skip: example && 'a room\'s own setting, not in the example' };

test('only the custom domain serves it: no workers.dev or preview URLs', () => {
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.equal(config.routes.length, 1);
  assert.equal(config.routes[0].custom_domain, true);
});

test('the route is the host the server names itself by', roomOnly, () => {
  assert.deepEqual(config.routes, [{ pattern: definedSetting(config, 'ROOM_MCP_HOST', MCP_HOST), custom_domain: true }]);
});

test('the dev identity and Ask mock are never configured for production', () => {
  for (const name of ['ALLOW_DEV_IDENTITY"', 'DEV_IDENTITY_EMAIL"', 'ASK_MOCK"', 'MCP_DEV_ORIGIN"', 'MCP_SEARCH_MOCK"', 'LEGALLAS_DEV_REMOTE_AI"']) assert.equal(raw.includes(name), false, name);
});

test('the control prefix is a secret, never a var', () => {
  assert.equal(config.vars.CONTROL_PREFIX, undefined);
});

test('REQUIRE_MFA is "0", "1" or unset, in the config and in the example: any other value would leave MFA off silently', () => {
  for (const vars of [config.vars, readWranglerConfig('wrangler.mcp', true).config.vars]) {
    assert.ok(vars.REQUIRE_MFA === undefined || MFA_SETTINGS.includes(vars.REQUIRE_MFA), `REQUIRE_MFA ${JSON.stringify(vars.REQUIRE_MFA)}`);
  }
});

test('traces and invocation logs stay off', () => {
  assert.equal(config.observability.traces.enabled, false);
  assert.equal(config.observability.logs.invocation_logs, false);
});

test('Workers Issues is on and stack traces map to the source (no case content in this Worker\'s paths)', () => {
  assert.equal(config.observability.issues.enabled, true);
  assert.equal(config.upload_source_maps, true);
});

test('each request is capped at 5 s of CPU as a cost guard', () => {
  assert.deepEqual(config.limits, { cpu_ms: 5000 });
});

test('the OAuth library gets its KV binding and can fetch client metadata documents', () => {
  assert.ok(config.kv_namespaces.some((kv: { binding: string }) => kv.binding === 'OAUTH_KV'));
  assert.ok(config.compatibility_flags.includes('global_fetch_strictly_public'));
});

test('alerts can only go from one sender to one address', () => {
  assert.equal(config.send_email.length, 1);
  assert.equal(config.send_email[0].name, 'EMAIL');
  assert.equal(typeof config.send_email[0].destination_address, 'string');
  assert.equal(config.send_email[0].allowed_sender_addresses.length, 1);
});

test('alerts can only go from room@ to owner@', roomOnly, () => {
  assert.deepEqual(config.send_email, [
    { name: 'EMAIL', destination_address: definedSetting(config, 'ROOM_ALERT_TO', 'owner@example.com'), allowed_sender_addresses: [definedSetting(config, 'ROOM_ALERT_FROM', 'room@example.com')] },
  ]);
});

test('no Workers AI binding: this server retrieves, the client model generates', () => {
  assert.equal(config.ai, undefined);
});

test('the privacy and terms pages are published (the owner approved the wording on 2026-10-06)', roomOnly, () => {
  assert.equal(config.vars.POLICIES_PUBLISHED, '1');
});

test('a real KV namespace and a daily-free config: no placeholder ids', roomOnly, () => {
  assert.equal(raw.includes('REPLACE_WITH'), false);
});

test('the daily sweep is scheduled', () => {
  assert.deepEqual(config.triggers.crons, ['17 9 * * *']);
});

test('dynamic client registration is open for Harvey and Copilot Studio (the owner, 2026-10-06)', () => {
  assert.equal(config.vars.DCR_ENABLED, '1');
});

test('an unlisted Origin on /mcp is logged, not refused, until the first Copilot and Harvey sessions', () => {
  assert.equal(config.vars.MCP_ORIGIN_ENFORCE, '0');
});

test('rate limits guard the public /register, /token and package routes, and tool calls per member', () => {
  const limits = Object.fromEntries(config.ratelimits.map((r: { name: string; simple: { limit: number; period: number } }) => [r.name, r.simple]));
  assert.deepEqual(limits, {
    REGISTER_LIMIT: { limit: 10, period: 60 },
    TOKEN_LIMIT: { limit: 120, period: 60 },
    PACKAGE_LIMIT: { limit: 10, period: 60 },
    TOOL_LIMIT: { limit: 60, period: 60 },
  });
  assert.equal(new Set(config.ratelimits.map((r: { namespace_id: string }) => r.namespace_id)).size, 4);
});

test('ACCESS_AUD is a secret, not a var (gitleaks flags a 64-hex AUD in the file)', () => {
  assert.equal(config.vars.ACCESS_AUD, undefined);
});

test('the law library is on, in its own bucket and AI Search instance, apart from the record (T21)', () => {
  const storedName = definedSetting(config, 'ROOM_STORED_NAME', 'legallas');
  assert.equal(config.vars.LAW_LIBRARY, '1');
  assert.deepEqual(
    config.r2_buckets.map((b: { binding: string; bucket_name: string }) => [b.binding, b.bucket_name]),
    [['FILES', `${storedName}-files`], ['INDEX', `${storedName}-index`], ['LAW', `${storedName}-law`]],
  );
  assert.deepEqual(config.ai_search, [
    { binding: 'SEARCH', instance_name: storedName, remote: true },
    { binding: 'LAW_SEARCH', instance_name: `${storedName}-law`, remote: true },
  ]);
});

test('the Worker and its database carry the stored name, so they vary with it and nothing else', () => {
  const storedName = definedSetting(config, 'ROOM_STORED_NAME', 'legallas');
  assert.equal(config.name, `${storedName}-mcp`);
  assert.deepEqual(config.d1_databases.map((d: { database_name: string }) => d.database_name), [storedName]);
});

/**
 * What a room fills in when it copies the example, and `main`, the entry it deploys (the room alone, or with
 * pro's routes); everything else is the product's setting.
 */
const ROOM_FIELDS = [
  'name', 'main', 'routes', 'vars.TEAM_DOMAIN', 'vars.POLICIES_PUBLISHED', 'vars.COPILOT_REFERENCE_ID', 'd1_databases[].database_id', 'd1_databases[].database_name', 'kv_namespaces[].id',
  'r2_buckets[].bucket_name', 'ai_search[].instance_name',
  'send_email[].destination_address', 'send_email[].allowed_sender_addresses',
];

test('the example is the room\'s own config apart from the fields a room fills in', { skip: !hasRoomConfig('wrangler.mcp') && 'no room config in this checkout' }, () => {
  const sample = readWranglerConfig('wrangler.mcp', true);
  const product = (parsed: { vars?: Record<string, unknown> }) => withoutRoomFields(withoutRoomExtras(parsed, ['INSTANCE_NAME', 'ASSISTANT_NAME', 'MCP_TOOL_PREFIX', 'TIME_ZONE', 'REQUIRE_MFA', 'RETAIN_SIGNINS_DAYS', 'RETAIN_AUDIT_DAYS_AFTER_CLOSE', 'ROOMS_ENABLED']), ROOM_FIELDS);
  assert.deepEqual(product(sample.config), product(readWranglerConfig('wrangler.mcp', false).config));
  assert.equal(sample.config.main, 'mcp/entry-pro.ts', 'the product\'s entry: the full product');
  // Filled in, the example fails closed: no Access team, no published policies and no shared Copilot download.
  assert.deepEqual([sample.config.vars.TEAM_DOMAIN, sample.config.vars.POLICIES_PUBLISHED, sample.config.vars.COPILOT_REFERENCE_ID], ['', '0', '']);
});

test('the example deploys the full product and, filled in, fails closed: checked in every checkout, room config or not (#285)', () => {
  // The test above compares the example with a room's own file, so it runs only beside one, and CI has none.
  const sample = readWranglerConfig('wrangler.mcp', true);
  assert.equal(sample.config.main, 'mcp/entry-pro.ts', 'the product\'s entry: the full product');
  assert.deepEqual([sample.config.vars.TEAM_DOMAIN, sample.config.vars.POLICIES_PUBLISHED, sample.config.vars.COPILOT_REFERENCE_ID], ['', '0', '']);
  // And keeps everything until the room sets a retention schedule (worker/data-retention.ts).
  assert.deepEqual([sample.config.vars.RETAIN_SIGNINS_DAYS, sample.config.vars.RETAIN_AUDIT_DAYS_AFTER_CLOSE], ['', '']);
  // And ships deal rooms off, like the room Worker's example: a room turns them on in both Workers together (#10).
  assert.equal(sample.config.vars.ROOMS_ENABLED, undefined);
  assert.equal(sample.raw.includes('ROOMS_ENABLED'), false);
});
