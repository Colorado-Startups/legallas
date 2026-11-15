// SPDX-License-Identifier: Apache-2.0
// /authorize behind Access and membership, driven with a fake OAuth library and a locally signed Access token.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leftoverFamilySql } from '../worker/gate-fixtures.ts';
import { SCOPE_READ, type McpEnv } from './contract.ts';
import type { AiAuditEntry } from './audit.ts';
import { appName, handleAuthorize, type GateDeps } from './authorize.ts';
import type { SignInFailure } from './signin-failure.ts';
import { allowRefusedRedirect, loadAllowedRedirects, mergeRedirectAllow, recordRefusedRedirect, refusedRedirects } from './redirects.ts';
import { clearClientKindCache } from './server.ts';
import {
  AUD,
  CIMD_CLIENT,
  CLAUDE_REDIRECT,
  COUNSEL,
  FakeAuthorizationError,
  OWNER,
  STRANGER,
  accessToken,
  fakeEnv,
  fakeOAuth,
  getKey,
  signedRequest,
  type FakeOAuth,
} from './oauth-fakes.ts';

const deps = { getKey };

function authorizeUrl(params: Record<string, string> = {}): string {
  const q = new URLSearchParams({ response_type: 'code', client_id: CIMD_CLIENT, redirect_uri: CLAUDE_REDIRECT, state: 's1', ...params });
  return `/authorize?${q}`;
}

/** Shows the consent page as `email`, then posts `decision` with the handle it was given. */
async function consent(env: McpEnv, oauth: FakeOAuth, email: string, decision: string, params: Record<string, string> = {}, with_: GateDeps = deps): Promise<Response> {
  const shown = await handleAuthorize(await signedRequest(authorizeUrl(params), email), env, with_);
  assert.equal(shown.status, 200);
  // The fake numbers handles h1, h2, ...; each test shows one consent page per fake.
  assert.ok(oauth.names().includes('beginConsent'));
  const body = new URLSearchParams({ handle: 'h1', decision });
  return handleAuthorize(await signedRequest('/authorize', email, { method: 'POST', body }), env, with_);
}

function rawRequest(token: string | null, url = authorizeUrl()): Request {
  return new Request(new URL(url, 'https://mcp.room.example.com'), { headers: token ? { 'Cf-Access-Jwt-Assertion': token } : {} });
}

test('no, forged or wrong-audience Access tokens get 403 before the OAuth request is read', async () => {
  const oauth = fakeOAuth();
  const env = fakeEnv(oauth);
  for (const token of [null, 'not-a-jwt', await accessToken(COUNSEL, { forged: true }), await accessToken(COUNSEL, { aud: `${AUD}-other` })]) {
    const response = await handleAuthorize(rawRequest(token), env, deps);
    assert.equal(response.status, 403);
  }
  assert.deepEqual(oauth.names(), []);
});

test('a signed-in non-member gets 403 on GET and POST', async () => {
  const oauth = fakeOAuth();
  const env = fakeEnv(oauth);
  assert.equal((await handleAuthorize(await signedRequest(authorizeUrl(), STRANGER), env, deps)).status, 403);
  const post = await signedRequest('/authorize', STRANGER, { method: 'POST', body: new URLSearchParams({ handle: 'h1', decision: 'approve' }) });
  assert.equal((await handleAuthorize(post, env, deps)).status, 403);
  assert.deepEqual(oauth.names(), []);
});

test('a family row left from before migration 0010 cannot connect an AI app, on GET or POST: it is no member', async () => {
  const oauth = fakeOAuth();
  const env = fakeEnv(oauth);
  for (const statement of leftoverFamilySql('kin@example.test', 'Kin')) await env.DB.prepare(statement).run();
  const shown = await handleAuthorize(await signedRequest(authorizeUrl(), 'kin@example.test'), env, deps);
  assert.equal(shown.status, 403);
  assert.match(await shown.text(), /is not a member of the counsel room/);
  const post = await signedRequest('/authorize', 'kin@example.test', { method: 'POST', body: new URLSearchParams({ handle: 'h1', decision: 'approve' }) });
  assert.equal((await handleAuthorize(post, env, deps)).status, 403);
  assert.deepEqual(oauth.names(), []);
});

test("an Access email containing ':' is refused before any handle is touched", async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const oauth = fakeOAuth();
  const env = fakeEnv(oauth);
  const odd = 'a@b.example:x.y';
  const get = await handleAuthorize(rawRequest(await accessToken(odd)), env, deps);
  assert.equal(get.status, 403);
  const post = new Request('https://mcp.room.example.com/authorize', {
    method: 'POST',
    headers: { 'Cf-Access-Jwt-Assertion': await accessToken(odd) },
    body: new URLSearchParams({ handle: 'h1', decision: 'approve' }),
  });
  assert.equal((await handleAuthorize(post, env, deps)).status, 403);
  assert.deepEqual(oauth.names(), []);
  assert.deepEqual(warn.mock.calls.map((call) => call.arguments), [
    ['mcp_access_refused', 'bad_identity'],
    ['mcp_access_refused', 'bad_identity'],
  ]);
});

test('the dev identity works on localhost only', async () => {
  const oauth = fakeOAuth();
  const dev = fakeEnv(oauth, { ALLOW_DEV_IDENTITY: '1', DEV_IDENTITY_EMAIL: COUNSEL });
  const local = new Request(`http://localhost:8790${authorizeUrl()}`);
  assert.equal((await handleAuthorize(local, dev, deps)).status, 200);
  assert.equal((await handleAuthorize(rawRequest(null), dev, deps)).status, 403);
});

test('GET shows the consent page with the library transaction headers', async () => {
  clearClientKindCache(); // earlier tests resolved this client's kind; the page looks it up afresh here
  const oauth = fakeOAuth();
  const response = await handleAuthorize(await signedRequest(authorizeUrl(), COUNSEL), fakeEnv(oauth), deps);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie') ?? '', /^__Host-oauth-consent=h1/);
  assert.match(response.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
  assert.deepEqual(oauth.names(), ['parseAuthRequest', 'describeConsent', 'beginConsent', 'lookupClient']);
});

test('the consent page promises files only to an app the server sends them to (its client kind)', async () => {
  clearClientKindCache();
  const oauth = fakeOAuth();
  oauth.register(1); // dcr-1, on Claude's redirect
  const harveyRedirect = 'https://app.harvey.ai/oauth/callback';
  oauth.clients.push({ clientId: 'dcr-harvey', clientName: 'Harvey', redirectUris: [harveyRedirect], tokenEndpointAuthMethod: 'none' });
  const page = async (clientId: string, redirectUri: string) =>
    (await handleAuthorize(await signedRequest(authorizeUrl({ client_id: clientId, redirect_uri: redirectUri }), COUNSEL), fakeEnv(oauth), deps)).text();
  assert.ok((await page('dcr-1', CLAUDE_REDIRECT)).includes('It can also receive small original files and images of the visuals.'));
  // Harvey, and a client the lookup cannot find even on Claude's redirect, get the text-only promise.
  for (const html of [await page('dcr-harvey', harveyRedirect), await page('missing-client', CLAUDE_REDIRECT)]) {
    assert.doesNotMatch(html, /original file|images of the visuals|visual image/);
    assert.ok(html.includes('all as text and as you see them'));
  }
});

test('a redirect off the allowlist is refused and only its host is logged', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const oauth = fakeOAuth();
  const url = authorizeUrl({ client_id: 'static-1', redirect_uri: 'https://evil.example/cb?token=x' });
  const response = await handleAuthorize(await signedRequest(url, COUNSEL), fakeEnv(oauth), deps);
  assert.equal(response.status, 400);
  assert.equal(response.headers.get('location'), null);
  assert.deepEqual(warn.mock.calls.map((call) => call.arguments), [['mcp_redirect_refused', 'evil.example']]);
  assert.deepEqual(oauth.names(), ['parseAuthRequest']);
});

test("an unsupported AI's metadata document is refused before the library fetches it, and never reaches the owner's list", async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const oauth = fakeOAuth();
  const env = fakeEnv(oauth);
  const pending: Promise<void>[] = [];
  const withCapture: GateDeps = { ...deps, onRefusedRedirect: (uri) => void pending.push(recordRefusedRedirect(env, uri)) };
  const callback = 'https://chatgpt.com/connector_platform_oauth_redirect';
  const listed = { ...env, MCP_REDIRECT_ALLOW: `${callback},=${callback}` };
  const url = authorizeUrl({ client_id: 'https://chatgpt.com/oauth/client.json', redirect_uri: callback });
  const response = await handleAuthorize(await signedRequest(url, COUNSEL), listed, withCapture);
  assert.equal(response.status, 400);
  const page = await response.text();
  assert.match(page, /App not allowed/);
  assert.match(page, /the owner can(&#39;|&#x27;|')t allow them/, 'a ChatGPT user is not sent to the owner');
  assert.doesNotMatch(page, /ask the owner/);
  assert.deepEqual(oauth.names(), [], 'the library read nothing');
  await Promise.all(pending);
  assert.deepEqual(await refusedRedirects(env), []);
  assert.deepEqual(warn.mock.calls.map((call) => call.arguments)[0], ['mcp_redirect_refused', 'chatgpt.com']);
});

test("a metadata-document client's unlisted callback reaches the owner's list from the consent page, and works once allowed", async (t) => {
  t.mock.method(console, 'warn', () => {});
  const env = fakeEnv();
  const pending: Promise<void>[] = [];
  const withCapture: GateDeps = { ...deps, onRefusedRedirect: (uri) => void pending.push(recordRefusedRedirect(env, uri)) };
  const callback = 'https://connect.vendor.app/oauth/callback';
  // Such a client never passes /register, so the consent page is the first place its callback is seen.
  const url = authorizeUrl({ client_id: 'https://connect.vendor.app/client.json', redirect_uri: callback });
  const refused = await handleAuthorize(await signedRequest(url, COUNSEL), env, withCapture);
  assert.equal(refused.status, 400);
  assert.match(await refused.text(), /If this is one of those three, its sign-in callback is new to the room and nothing was sent to it: ask the owner to allow it, then connect again\./);
  await Promise.all(pending);
  assert.deepEqual((await refusedRedirects(env)).map((row) => row.uri), [callback]);
  assert.equal(await allowRefusedRedirect(env, callback), 'allowed');
  // What mcp/index.ts does before every /authorize: the owner's allowed callbacks join MCP_REDIRECT_ALLOW.
  const merged = { ...env, MCP_REDIRECT_ALLOW: mergeRedirectAllow(env.MCP_REDIRECT_ALLOW, await loadAllowedRedirects(env)) };
  assert.equal((await handleAuthorize(await signedRequest(url, COUNSEL), merged, withCapture)).status, 200);
  assert.equal(pending.length, 1, 'an allowed callback is not captured again');
});

test('only the consent page captures: a throwing hook still gets the page, and the approve and decline re-checks keep nothing', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const error = t.mock.method(console, 'error', () => {});
  const throwing: GateDeps = {
    ...deps,
    onRefusedRedirect: () => {
      throw new RangeError('boom');
    },
  };
  const url = authorizeUrl({ client_id: 'static-1', redirect_uri: 'https://connect.vendor.app/cb' });
  assert.equal((await handleAuthorize(await signedRequest(url, COUNSEL), fakeEnv(), throwing)).status, 400);
  assert.deepEqual(error.mock.calls.at(-1)?.arguments, ['mcp_redirect_capture_failed', 'RangeError']);

  const seen: string[] = [];
  const watching: GateDeps = { ...deps, onRefusedRedirect: (uri) => void seen.push(uri) };
  const harvey = 'https://app.harvey.example/oauth/callback';
  for (const decision of ['approve', 'deny']) {
    const env = fakeEnv(fakeOAuth(), { MCP_REDIRECT_ALLOW: harvey });
    const shown = await handleAuthorize(await signedRequest(authorizeUrl({ client_id: 'dcr-1', redirect_uri: harvey }), COUNSEL), env, watching);
    assert.equal(shown.status, 200, decision);
    // The owner removed the callback after the page was shown: refused, and not offered back to the owner.
    env.MCP_REDIRECT_ALLOW = '';
    const body = new URLSearchParams({ handle: 'h1', decision });
    assert.equal((await handleAuthorize(await signedRequest('/authorize', COUNSEL, { method: 'POST', body }), env, watching)).status, 400, decision);
  }
  assert.deepEqual(seen, []);
});

test('a parse error redirects only to an allowed URI, else renders a page; each is reported with the host asked for', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const env = fakeEnv();
  const seen: SignInFailure[] = [];
  const watching: GateDeps = { ...deps, onSignInFailure: (failure) => void seen.push(failure) };
  const allowed = await handleAuthorize(await signedRequest(authorizeUrl({ fail: 'redirect' }), COUNSEL), env, watching);
  assert.equal(allowed.status, 302);
  assert.equal(allowed.headers.get('location'), `${CLAUDE_REDIRECT}?error=invalid_request`);

  const evil = authorizeUrl({ fail: 'redirect', redirect_uri: 'https://evil.example/cb' });
  assert.equal((await handleAuthorize(await signedRequest(evil, COUNSEL), env, watching)).status, 400);
  // No redirect_uri at all: the metadata-document client_id names the host.
  const local = authorizeUrl({ fail: 'page', redirect_uri: '' });
  assert.equal((await handleAuthorize(await signedRequest(local, COUNSEL), env, watching)).status, 400);
  assert.deepEqual(warn.mock.calls.map((call) => call.arguments), [
    ['mcp_authorize_invalid', 'invalid_request'],
    ['mcp_authorize_invalid', 'invalid_request'],
    ['mcp_redirect_refused', 'evil.example'],
    ['mcp_authorize_invalid', 'invalid_request'],
  ]);
  const report = (host: string): SignInFailure => ({ where: 'authorize', code: 'invalid_request', host });
  assert.deepEqual(seen, [report('claude.ai'), report('evil.example'), report('claude.ai')]);

  t.mock.method(env.OAUTH_PROVIDER, 'parseAuthRequest', async () => {
    throw new FakeAuthorizationError('invalid_target', CLAUDE_REDIRECT);
  });
  assert.equal((await handleAuthorize(await signedRequest(authorizeUrl(), COUNSEL), env, watching)).status, 302);
  assert.deepEqual(seen.at(-1), { where: 'authorize', code: 'invalid_target', host: 'claude.ai' });
});

test("an app's details that cannot be checked report a consent failure, on approve and on the page; a throwing hook changes nothing", async (t) => {
  t.mock.method(console, 'warn', () => {});
  const error = t.mock.method(console, 'error', () => {});
  const oauth = fakeOAuth();
  const env = fakeEnv(oauth);
  const seen: SignInFailure[] = [];
  const watching: GateDeps = { ...deps, onSignInFailure: (failure) => void seen.push(failure) };
  assert.equal((await handleAuthorize(await signedRequest(authorizeUrl(), COUNSEL), env, watching)).status, 200);
  // Claude's metadata document stops resolving after the page was shown (the library's CimdFetchError).
  const cimd = Object.assign(new Error(`CIMD fetch failed for ${CIMD_CLIENT}: 404`), { name: 'CimdFetchError', reason: 'metadata_resolution_failed' });
  t.mock.method(oauth.helpers, 'describeConsent', async () => {
    throw cimd;
  });
  const post = await signedRequest('/authorize', COUNSEL, { method: 'POST', body: new URLSearchParams({ handle: 'h1', decision: 'approve' }) });
  assert.equal((await handleAuthorize(post, env, watching)).status, 502);
  assert.equal((await handleAuthorize(await signedRequest(authorizeUrl(), COUNSEL), env, watching)).status, 502);
  const failure: SignInFailure = { where: 'consent', code: 'metadata_resolution_failed', host: 'claude.ai' };
  assert.deepEqual(seen, [failure, failure]);
  const throwing: GateDeps = {
    ...deps,
    onSignInFailure: () => {
      throw new RangeError('boom');
    },
  };
  assert.equal((await handleAuthorize(await signedRequest(authorizeUrl(), COUNSEL), env, throwing)).status, 502);
  assert.deepEqual(error.mock.calls.at(-1)?.arguments, ['mcp_signin_failure_report_failed', 'RangeError']);
});

test('approving completes the grant with the member props, userId and metadata', async () => {
  const oauth = fakeOAuth();
  const now = Date.now();
  const response = await consent(fakeEnv(oauth), oauth, OWNER, 'approve');
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), `${CLAUDE_REDIRECT}?code=c1&state=s1`);
  assert.equal(response.headers.get('cache-control'), 'no-store');

  const approve = oauth.calls.find((call) => call.name === 'approveConsent');
  assert.deepEqual(approve?.args, ['h1', { scope: [SCOPE_READ] }]);
  const complete = oauth.calls.find((call) => call.name === 'completeAuthorization')?.args[0] as Record<string, unknown>;
  assert.equal(complete.userId, OWNER);
  assert.deepEqual(complete.scope, [SCOPE_READ]);
  assert.equal(complete.revokeExistingGrants, true);
  // A CIMD client goes by its verified domain.
  assert.deepEqual(complete.props, { email: OWNER, role: 'owner', clientId: CIMD_CLIENT, clientName: 'claude.ai' });
  const metadata = complete.metadata as { clientName: string; approvedAt: string };
  assert.equal(metadata.clientName, 'claude.ai');
  assert.ok(Math.abs(Date.parse(metadata.approvedAt) - now) < 60_000);
});

test('a registered client goes by its name', async () => {
  const oauth = fakeOAuth();
  await consent(fakeEnv(oauth), oauth, COUNSEL, 'approve', { client_id: 'dcr-7' });
  const complete = oauth.calls.find((call) => call.name === 'completeAuthorization')?.args[0] as { props: Record<string, unknown> };
  assert.deepEqual(complete.props, { email: COUNSEL, role: 'counsel', clientId: 'dcr-7', clientName: 'App dcr-7' });
});

test('ai_connect is written before the grant, with the app name as via', async () => {
  const oauth = fakeOAuth();
  const audited: { entry: AiAuditEntry; grantsBefore: number }[] = [];
  const audit = async (_env: unknown, entry: AiAuditEntry) => {
    audited.push({ entry, grantsBefore: oauth.names().filter((name) => name === 'completeAuthorization').length });
  };
  const response = await consent(fakeEnv(oauth), oauth, COUNSEL, 'approve', {}, { getKey, audit });
  assert.equal(response.status, 302);
  assert.equal(audited.length, 1);
  const { entry, grantsBefore } = audited[0];
  assert.equal(grantsBefore, 0);
  assert.deepEqual({ ...entry, request: undefined }, { email: COUNSEL, action: 'ai_connect', documentId: null, via: 'claude.ai', request: undefined });
  assert.ok(entry.request instanceof Request);
});

test('when ai_connect cannot be written, no grant is made and the error is logged by code', async (t) => {
  const error = t.mock.method(console, 'error', () => {});
  const oauth = fakeOAuth();
  const audit = async () => {
    throw new TypeError('D1_ERROR: secret detail');
  };
  const response = await consent(fakeEnv(oauth), oauth, COUNSEL, 'approve', {}, { getKey, audit });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('location'), null);
  assert.ok(!oauth.names().includes('completeAuthorization'));
  assert.deepEqual(error.mock.calls.map((call) => call.arguments), [['mcp_connect_audit_failed', 'TypeError']]);
});

test('declining, or any decision but approve, redirects with access_denied and grants nothing', async () => {
  for (const decision of ['deny', 'Approve', '']) {
    const oauth = fakeOAuth();
    const response = await consent(fakeEnv(oauth), oauth, COUNSEL, decision);
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), `${CLAUDE_REDIRECT}?error=access_denied&state=s1`);
    assert.ok(!oauth.names().includes('completeAuthorization'), decision);
  }
});

test('approve and decline both re-check the allowlist after the page was shown', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const harvey = 'https://app.harvey.example/oauth/callback';
  for (const decision of ['approve', 'deny']) {
    const oauth = fakeOAuth();
    const env = fakeEnv(oauth, { MCP_REDIRECT_ALLOW: harvey });
    const shown = await handleAuthorize(await signedRequest(authorizeUrl({ client_id: 'dcr-1', redirect_uri: harvey }), COUNSEL), env, deps);
    assert.equal(shown.status, 200);
    env.MCP_REDIRECT_ALLOW = '';
    const body = new URLSearchParams({ handle: 'h1', decision });
    const response = await handleAuthorize(await signedRequest('/authorize', COUNSEL, { method: 'POST', body }), env, deps);
    assert.equal(response.status, 400, decision);
    assert.equal(response.headers.get('location'), null, decision);
    assert.ok(!oauth.names().includes('completeAuthorization'));
  }
  assert.deepEqual(warn.mock.calls.map((call) => call.arguments), [
    ['mcp_redirect_refused', 'app.harvey.example'],
    ['mcp_redirect_refused', 'app.harvey.example'],
  ]);
});

test('a used or unknown handle gets the expired page', async () => {
  const oauth = fakeOAuth();
  const env = fakeEnv(oauth);
  assert.equal((await consent(env, oauth, COUNSEL, 'approve')).status, 302);
  const again = await signedRequest('/authorize', COUNSEL, { method: 'POST', body: new URLSearchParams({ handle: 'h1', decision: 'approve' }) });
  assert.equal((await handleAuthorize(again, env, deps)).status, 400);
  const empty = await signedRequest('/authorize', COUNSEL, { method: 'POST', body: new URLSearchParams({ decision: 'approve' }) });
  assert.equal((await handleAuthorize(empty, env, deps)).status, 400);
});

test('a POST without Access never reaches the consent helpers', async () => {
  const oauth = fakeOAuth();
  const post = new Request('https://mcp.room.example.com/authorize', { method: 'POST', body: new URLSearchParams({ handle: 'h1', decision: 'approve' }) });
  assert.equal((await handleAuthorize(post, fakeEnv(oauth), deps)).status, 403);
  assert.deepEqual(oauth.names(), []);
});

test('other methods get 405', async () => {
  const response = await handleAuthorize(await signedRequest('/authorize', COUNSEL, { method: 'PUT' }), fakeEnv(), deps);
  assert.equal(response.status, 405);
});

test('appName strips control characters, collapses space and caps the length', () => {
  assert.equal(appName({ clientName: ' Har\u0000vey‮ \n AI ' }), 'Harvey AI');
  assert.equal(appName({ clientName: 'x'.repeat(200) }).length, 80);
  assert.equal(appName({ clientName: '\u0007' }), 'Unknown app');
  assert.equal(appName({ clientName: 'Claude', clientDomain: 'claude.ai' }), 'claude.ai');
  // 79 letters then an emoji: the cut keeps the whole emoji instead of half a surrogate pair.
  const cut = appName({ clientName: `${'x'.repeat(79)}\u{1F600}tail` });
  assert.equal(Array.from(cut).length, 80);
  assert.ok(cut.endsWith('\u{1F600}'));
  assert.equal(appName({ clientName: '\u{1F600}'.repeat(100) }), '\u{1F600}'.repeat(80));
});

// Counsel setup preflight (2026-10-20): each error page says what happened and the one thing to do next.
test('the error pages name the cause and send the lawyer back to their AI app', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const oauth = fakeOAuth();
  const env = fakeEnv(oauth);
  const stranger = await (await handleAuthorize(await signedRequest(authorizeUrl(), STRANGER), env, deps)).text();
  assert.ok(stranger.includes(`You signed in as ${STRANGER}, which is not a member of the counsel room.`), 'names the signed-in email');
  assert.ok(stranger.includes('Ask the room owner to add it.'));

  assert.equal((await consent(env, oauth, COUNSEL, 'approve')).status, 302);
  const again = await signedRequest('/authorize', COUNSEL, { method: 'POST', body: new URLSearchParams({ handle: 'h1', decision: 'approve' }) });
  const expired = await (await handleAuthorize(again, env, deps)).text();
  assert.ok(expired.includes('<h1>This page has expired</h1>'));
  assert.ok(expired.includes('A sign-in page works once, for 10 minutes, in the browser that opened it. Go back to your AI app and choose Connect again.'));

  const unusable = await (await handleAuthorize(await signedRequest(authorizeUrl({ fail: 'page' }), COUNSEL), fakeEnv(), deps)).text();
  assert.ok(unusable.includes('Go back to your AI app and choose Connect again. If this page comes back, tell the owner (email@example.com).'));

  const loopback = authorizeUrl({ client_id: 'static-1', redirect_uri: 'http://localhost:33418/callback' });
  const refused = await (await handleAuthorize(await signedRequest(loopback, COUNSEL), fakeEnv(), deps)).text();
  assert.ok(refused.includes('For Claude Code or another app, ask the owner (email@example.com).'), 'Claude Code is on request');
});

test('the not-a-member page escapes the signed-in email', async () => {
  const response = await handleAuthorize(await signedRequest(authorizeUrl(), 'a<b>@example.test'), fakeEnv(), deps);
  assert.equal(response.status, 403);
  const html = await response.text();
  assert.ok(!html.includes('a<b>@') && html.includes('a&lt;b&gt;@example.test'));
});
