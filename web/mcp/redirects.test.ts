// SPDX-License-Identifier: Apache-2.0
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_REDIRECT_ALLOW } from './contract.ts';
import { isAllowedRedirect, isUnsupportedAiHost, isUnsupportedAiUri, redirectAllowList, redirectHost } from './redirects.ts';

const none = {};

test('the default list lets Claude and Microsoft in', () => {
  for (const uri of [
    'https://claude.ai/api/mcp/auth_callback',
    'https://claude.com/api/mcp/auth_callback',
    'https://teams.microsoft.com/api/platform/v1.0/oAuthRedirect',
    'https://global.consent.azure-apim.net/redirect/legallas-connector-5f1',
  ]) {
    assert.equal(isAllowedRedirect(uri, none), true, uri);
  }
});

test('an exact entry matches only itself', () => {
  for (const uri of [
    'https://claude.ai/api/mcp/auth_callback/x',
    'https://claude.ai/api/mcp/auth_callback?next=1',
    'https://claude.ai/api/mcp/auth_callbackx',
    'https://claude.ai.evil.example/api/mcp/auth_callback',
    'https://teams.microsoft.com/api/platform/v1.0/oAuthRedirect/',
  ]) {
    assert.equal(isAllowedRedirect(uri, none), false, uri);
  }
});

test('loopback is refused by default, and matches any port and path once MCP_REDIRECT_ALLOW names it', () => {
  const loopback = { MCP_REDIRECT_ALLOW: 'http://localhost,http://127.0.0.1' };
  for (const uri of ['http://localhost:33418/callback', 'http://localhost/', 'http://127.0.0.1:5000/oauth/cb']) {
    assert.equal(isAllowedRedirect(uri, none), false, uri);
    assert.equal(isAllowedRedirect(uri, loopback), true, uri);
  }
});

test('other http, fragments, userinfo and non-URLs are refused', () => {
  for (const uri of [
    'http://claude.ai/api/mcp/auth_callback',
    'http://evil.example/cb',
    'http://[::1]:3000/cb',
    'http://localhost.evil.example/cb',
    'https://claude.ai/api/mcp/auth_callback#frag',
    'https://claude.ai/api/mcp/auth_callback#',
    'http://localhost:3000/cb#x',
    'https://user@claude.ai/api/mcp/auth_callback',
    'http://user:pw@localhost:3000/cb',
    'javascript:alert(1)',
    'not a url',
    '',
  ]) {
    assert.equal(isAllowedRedirect(uri, none), false, uri);
  }
});

test('a prefix entry holds only on the canonical form', () => {
  for (const uri of [
    'https://global.consent.azure-apim.net/redirect/../evil',
    'https://global.consent.azure-apim.net/redirect/%2e%2e/evil/x/../y',
    'https://GLOBAL.consent.azure-apim.net/redirect/x',
    'https://global.consent.azure-apim.net:443/redirect/x',
    'https://global.consent.azure-apim.net/redirectx',
  ]) {
    assert.equal(isAllowedRedirect(uri, none), false, uri);
  }
});

test('MCP_REDIRECT_ALLOW adds exact and prefix entries, never a remote http one', () => {
  const env = { MCP_REDIRECT_ALLOW: ' https://app.harvey.example/oauth/callback , ,https://auth.harvey.example/mcp/,http://evil.example/' };
  assert.equal(isAllowedRedirect('https://app.harvey.example/oauth/callback', env), true);
  assert.equal(isAllowedRedirect('https://auth.harvey.example/mcp/tenant-9', env), true);
  assert.equal(isAllowedRedirect('https://app.harvey.example/oauth/callback2', env), false);
  assert.equal(isAllowedRedirect('http://evil.example/', env), false);
  assert.equal(redirectAllowList(env.MCP_REDIRECT_ALLOW).length, DEFAULT_REDIRECT_ALLOW.length + 3);
});

test('redirectHost names only the host, and "invalid" for anything unparseable', () => {
  assert.equal(redirectHost('https://app.harvey.example/oauth/callback?code=secret'), 'app.harvey.example');
  assert.equal(redirectHost('nope'), 'invalid');
  assert.equal(redirectHost(42), 'invalid');
  assert.equal(redirectHost(undefined), 'invalid');
});

test('Harvey: harvey.ai and its subdomains, https on the canonical form, any path', () => {
  for (const uri of ['https://app.harvey.ai/oauth/callback', 'https://harvey.ai/oauth/callback', 'https://eu.app.harvey.ai/mcp/cb?tenant=9']) {
    assert.equal(isAllowedRedirect(uri, none), true, uri);
  }
  for (const uri of [
    'https://harvey.ai.evil.com/x',
    'https://evilharvey.ai/x',
    'http://app.harvey.ai/x',
    'https://user@app.harvey.ai/x',
    'https://user:pw@app.harvey.ai/x',
    'https://app.harvey.ai:8443/x',
    'https://app.harvey.ai:443/x',
    'https://app.harvey.ai/x#frag',
    'https://APP.harvey.ai/x',
    'https://app.harvey.ai./x',
    'https://app.harvey.ai',
  ]) {
    assert.equal(isAllowedRedirect(uri, none), false, uri);
  }
});

test("Harvey's documented hosts, US, EU and AU (help.harvey.ai and the harvey.ai region menu, 2026-10-20), are allowed on any path", () => {
  for (const host of ['app.harvey.ai', 'eu.app.harvey.ai', 'au.app.harvey.ai', 'api.harvey.ai', 'eu.api.harvey.ai', 'au.api.harvey.ai']) {
    for (const path of ['/oauth/callback', '/api/mcp/auth_callback', '/connectors/oauth/callback?region=eu']) {
      assert.equal(isAllowedRedirect(`https://${host}${path}`, none), true, `${host}${path}`);
    }
    assert.equal(isAllowedRedirect(`http://${host}/oauth/callback`, none), false, `${host} over http`);
  }
});

test('Harvey look-alikes stay refused: other domains, userinfo, encoded dots and non-canonical forms', () => {
  for (const uri of [
    'https://harvey.com/oauth/callback',
    'https://harveyai.com/oauth/callback',
    'https://harvey-ai.com/oauth/callback',
    'https://harvey.ai@evil.com/cb',
    'https://evil.com/harvey.ai/cb',
    'https://evil.com/?r=https://app.harvey.ai/cb',
    'https://app.harvey.ai%2eevil.com/cb',
    'https://harvey.ai.evil.com./x',
    'https://eu.app.harvey.ai.evil.com/cb',
    'https://au.app-harvey.ai/cb',
    'https://xn--hrvey-wqa.ai/cb',
    'https://app.harvey.ai/../cb',
    'https://app.harvey.ai/%2e%2e/cb',
    'HTTPS://app.harvey.ai/cb',
    'https:app.harvey.ai/cb',
    'https://app.harvey.ai\\cb',
    'https://app.harvey.ai/ cb',
    'https://harvey.ai:443/',
  ]) {
    assert.equal(isAllowedRedirect(uri, none), false, uri);
  }
});

test('a host-suffix entry in MCP_REDIRECT_ALLOW works the same way, and needs a dot in the host', () => {
  const env = { MCP_REDIRECT_ALLOW: 'https://*.firm.example/' };
  assert.equal(isAllowedRedirect('https://ai.firm.example/cb', env), true);
  assert.equal(isAllowedRedirect('https://firm.example/cb', env), true);
  assert.equal(isAllowedRedirect('https://notfirm.example/cb', env), false);
  assert.equal(isAllowedRedirect('https://ai.firm.example.evil.example/cb', env), false);
  assert.equal(isAllowedRedirect('https://anything.example/cb', { MCP_REDIRECT_ALLOW: 'https://*.example/' }), false);
});

test('an exact-marked entry matches only that URI, even one ending in "/"', () => {
  const env = { MCP_REDIRECT_ALLOW: '=https://cb.vendor.example/oauth/' };
  assert.equal(isAllowedRedirect('https://cb.vendor.example/oauth/', env), true);
  for (const uri of ['https://cb.vendor.example/oauth/x', 'https://cb.vendor.example/oauth', 'https://CB.vendor.example/oauth/', 'https://cb.vendor.example:443/oauth/']) {
    assert.equal(isAllowedRedirect(uri, env), false, uri);
  }
  assert.equal(isAllowedRedirect('http://localhost/cb', { MCP_REDIRECT_ALLOW: '=http://localhost/cb' }), false);
});

test("Microsoft's documented callbacks: per-connector consent URIs and the Teams URI in; the retired global one out", () => {
  // learn.microsoft.com, read 2026-10-20: connectors/custom-connectors (per-connector redirect URIs since February
  // 2024), connectors/custom-connectors/azure-active-directory-authentication and connectors/celonismcpserver (the
  // forms below), microsoft-365/copilot/extensibility/plugin-authentication-oauth (the Teams URI for every plugin).
  for (const uri of [
    'https://global.consent.azure-apim.net/redirect/samplecustomconnector123-5f98284236d845b802-5f21c6202f06d65e16',
    'https://global.consent.azure-apim.net/redirect/celonismcpserver',
    'https://global.consent.azure-apim.net/redirect/cr626-5flegallas-20counsel-20room-5f1a2b3c',
    'https://teams.microsoft.com/api/platform/v1.0/oAuthRedirect',
  ]) {
    assert.equal(isAllowedRedirect(uri, none), true, uri);
  }
  // The pre-2024 global URI no longer works for new connections; other consent hosts are undocumented, so they are
  // refused and kept for the owner's one-click Allow (recordRefusedRedirect) rather than guessed.
  for (const uri of [
    'https://global.consent.azure-apim.net/redirect',
    'https://tip1-shared.consent.azure-apim.net/redirect',
    'https://brazil-001.consent.azure-apim.net/redirect/cr626-5fx',
    'https://teams.microsoft.com/api/platform/v1.0/oAuthConsentRedirect',
  ]) {
    assert.equal(isAllowedRedirect(uri, none), false, uri);
  }
});

describe('Google: no Gemini Enterprise callback (allowed from 2026-10-20; removed 2026-10-31)', () => {
  // The only closed models the room connects are Claude, Copilot and Harvey (the owner, 2026-10-31). Gemini Enterprise's
  // documented callback for a custom MCP server (docs.cloud.google.com gemini/enterprise/docs/connectors/
  // custom-mcp-server/set-up-custom-mcp-server, updated 2026-10-19) is refused like any other unlisted URI.
  const GEMINI_ENTERPRISE = 'https://vertexaisearch.cloud.google.com/oauth-redirect';

  test('the callback is no default entry and is refused', () => {
    assert.ok(!DEFAULT_REDIRECT_ALLOW.includes(GEMINI_ENTERPRISE));
    assert.equal(isAllowedRedirect(GEMINI_ENTERPRISE, none), false);
    assert.equal(redirectHost(GEMINI_ENTERPRISE), 'vertexaisearch.cloud.google.com', 'a refused registration still names its host for the owner');
  });

  test('no default entry names a Google host, prefix or suffix', () => {
    for (const entry of DEFAULT_REDIRECT_ALLOW) {
      assert.ok(!entry.includes('google'), entry);
    }
  });

  test('look-alikes of the callback are refused', () => {
    for (const uri of [
      'https://vertexaisearch.cloud.google.com/oauth-redirect/',
      'https://vertexaisearch.cloud.google.com/oauth-redirect/x',
      'https://vertexaisearch.cloud.google.com/oauth-redirectx',
      'https://vertexaisearch.cloud.google.com/oauth-redirect?next=1',
      'https://vertexaisearch.cloud.google.com/oauth-redirect#x',
      'https://vertexaisearch.cloud.google.com/./oauth-redirect',
      'https://vertexaisearch.cloud.google.com/OAUTH-REDIRECT',
      'https://VERTEXAISEARCH.cloud.google.com/oauth-redirect',
      'https://vertexaisearch.cloud.google.com:443/oauth-redirect',
      'https://vertexaisearch.cloud.google.com:8443/oauth-redirect',
      'http://vertexaisearch.cloud.google.com/oauth-redirect',
      'https://user@vertexaisearch.cloud.google.com/oauth-redirect',
      'https://vertexaisearch.cloud.google.com.evil.example/oauth-redirect',
      'https://evil.example/vertexaisearch.cloud.google.com/oauth-redirect',
      'https://xvertexaisearch.cloud.google.com/oauth-redirect',
      'https://a.vertexaisearch.cloud.google.com/oauth-redirect',
      'https://vertexaisearch.cloud.google.co/oauth-redirect',
      'https://vertexaisearch-cloud-google.com/oauth-redirect',
    ]) {
      assert.equal(isAllowedRedirect(uri, none), false, uri);
    }
  });

  test('other Google hosts and paths stay refused; the owner decides on any that turns up', () => {
    for (const uri of [
      // An older codelab's extra agent-registration redirect, absent from the current setup docs.
      'https://vertexaisearch.cloud.google.com/static/oauth/oauth.html',
      'https://gemini.google.com/oauth-redirect',
      'https://business.gemini.google/oauth-redirect',
      'https://accounts.google.com/o/oauth2/callback',
      'https://cloud.google.com/oauth-redirect',
      'https://notebooklm.google.com/oauth-redirect',
      'https://aistudio.google.com/oauth-redirect',
      'https://www.google.com/oauth-redirect',
      // Gemini CLI's loopback callback (geminicli.com/docs/tools/mcp-server, updated 2026-10-06): off by default.
      'http://localhost:7777/oauth/callback',
      'http://localhost:51234/oauth/callback',
    ]) {
      assert.equal(isAllowedRedirect(uri, none), false, uri);
    }
  });
});

test("an unsupported AI's callback is refused whatever MCP_REDIRECT_ALLOW or the owner's Allow says", () => {
  const callbacks = [
    'https://chatgpt.com/connector_platform_oauth_redirect',
    'https://chatgpt.com/connector/oauth/abc123',
    'https://platform.openai.com/apps-manage/oauth',
    'https://vertexaisearch.cloud.google.com/oauth-redirect',
    'https://grok.com/oauth/callback',
    'https://accounts.x.ai/callback',
    'https://x.com/i/grok/cb',
    'https://twitter.com/i/grok/cb',
    'https://chat.com/oauth/callback',
    'https://gemini.google/oauth/callback',
  ];
  const listed = { MCP_REDIRECT_ALLOW: [...callbacks, ...callbacks.map((uri) => `=${uri}`), 'https://*.google.com/'].join(',') };
  for (const uri of callbacks) assert.equal(isAllowedRedirect(uri, listed), false, uri);
});

test('the unsupported hosts cover their subdomains and nothing that merely ends alike', () => {
  for (const host of ['chatgpt.com', 'CHATGPT.COM.', 'chat.com', 'gemini.google.com', 'gemini.google', 'x.ai', 'api.x.ai', 'grok.com', 'x.com', 'twitter.com']) assert.equal(isUnsupportedAiHost(host), true, host);
  for (const host of ['claude.ai', 'notchatgpt.com', 'max.ai', 'teams.microsoft.com', 'app.harvey.ai', 'google.com.evil.example']) {
    assert.equal(isUnsupportedAiHost(host), false, host);
  }
  assert.equal(isUnsupportedAiUri('https://chatgpt.com/oauth/client.json'), true);
  assert.equal(isUnsupportedAiUri('a-registered-client-id'), false);
  assert.equal(isUnsupportedAiUri(null), false);
});
