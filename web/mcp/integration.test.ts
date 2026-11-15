// SPDX-License-Identifier: Apache-2.0
// Integration wiring: the origin discovery names (production, or a localhost origin for wrangler dev only) and
// the privacy and terms placeholder until the owner approves their wording (D7).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MCP_ORIGIN, MCP_RESOURCE, type McpEnv } from './contract.ts';
import { oauthOptions, publicOrigin, resourceMetadata } from './oauth.ts';
import { renderPrivacy, renderTerms } from './pages/index.ts';

test('discovery names production unless a localhost dev origin is set', () => {
  assert.equal(publicOrigin(undefined), MCP_ORIGIN);
  assert.equal(publicOrigin(''), MCP_ORIGIN);
  assert.equal(publicOrigin('http://localhost:8790'), 'http://localhost:8790');
  assert.equal(publicOrigin('http://127.0.0.1:8790'), 'http://127.0.0.1:8790');
  for (const bad of ['https://evil.example', 'http://localhost.evil.example', 'http://localhost:8790/x', 'https://localhost:8790']) {
    assert.equal(publicOrigin(bad), MCP_ORIGIN, bad);
  }
});

test('resource metadata uses the canonical resource in production and /mcp on the dev origin', () => {
  assert.deepEqual(resourceMetadata(MCP_ORIGIN).resource, MCP_RESOURCE);
  assert.deepEqual(resourceMetadata('http://localhost:8790'), {
    resource: 'http://localhost:8790/mcp',
    authorization_servers: ['http://localhost:8790'],
    resource_name: resourceMetadata(MCP_ORIGIN).resource_name,
  });
  const options = oauthOptions({ redirectAllow: () => undefined });
  assert.equal(options.resourceMetadata?.resource, MCP_RESOURCE);
});

async function page(path: string, published?: string): Promise<{ status: number; body: string }> {
  const options = oauthOptions({ redirectAllow: () => undefined });
  const env = { POLICIES_PUBLISHED: published } as unknown as McpEnv;
  const handler = options.defaultHandler as { fetch(request: Request, env: McpEnv): Promise<Response> };
  const response = await handler.fetch(new Request(`${MCP_ORIGIN}${path}`), env);
  return { status: response.status, body: await response.text() };
}

test('privacy and terms show a placeholder until POLICIES_PUBLISHED is "1"', async () => {
  for (const [path, render] of [['/privacy', renderPrivacy], ['/terms', renderTerms]] as const) {
    const draft = await page(path);
    const live = await page(path, '1');
    assert.equal(draft.status, 200);
    assert.equal(live.status, 200);
    assert.equal(live.body, render(), `${path} serves the approved page once published`);
    assert.notEqual(draft.body, render(), `${path} never serves the draft wording before approval`);
  }
});
