// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withSecurityHeaders, type HeaderKind } from './headers.ts';
import { isSameOriginWrite, isWrite } from './http.ts';
import { matchRoute, type Route } from './router.ts';

const csp = (kind: HeaderKind, response = new Response('x')) =>
  withSecurityHeaders(response, kind).headers.get('Content-Security-Policy') ?? '';

test('every kind gets noindex, no-store, no-referrer and nosniff', () => {
  for (const kind of ['page', 'api', 'file', 'visual'] as const) {
    const h = withSecurityHeaders(new Response('x'), kind).headers;
    assert.equal(h.get('X-Robots-Tag'), 'noindex, nofollow, noarchive', kind);
    assert.equal(h.get('Cache-Control'), 'private, no-store', kind);
    assert.equal(h.get('Referrer-Policy'), 'no-referrer', kind);
    assert.equal(h.get('X-Content-Type-Options'), 'nosniff', kind);
  }
});

test('HSTS is pinned: a year, the room host and the hosts under it, never preload', () => {
  for (const kind of ['page', 'api', 'file', 'visual'] as const) {
    assert.equal(withSecurityHeaders(new Response('x'), kind).headers.get('Strict-Transport-Security'), 'max-age=31536000; includeSubDomains', kind);
  }
});

test('pages allow no inline script or style and cannot be framed', () => {
  const policy = csp('page');
  assert.doesNotMatch(policy, /'unsafe-inline'|'unsafe-eval'/, 'CSP keywords are quoted, so wasm-unsafe-eval does not match');
  assert.match(policy, /frame-ancestors 'none'/);
  assert.match(policy, /connect-src 'self'/);
});

test('the page CSP is pinned: wasm may compile, nothing may eval, the network stays same-origin', () => {
  // Any change to the page policy must change this test too, on purpose and in review.
  assert.equal(
    csp('page'),
    [
      "default-src 'self'",
      "script-src 'self' 'wasm-unsafe-eval'",
      "style-src 'self'",
      "img-src 'self' data: blob:",
      "font-src 'self'",
      "connect-src 'self'",
      "worker-src 'self' blob:",
      "frame-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
  );
  const directive = (name: string) => csp('page').split('; ').find((d) => d.startsWith(`${name} `));
  assert.equal(directive('script-src'), "script-src 'self' 'wasm-unsafe-eval'", 'no CDN for the Rive wasm');
  assert.equal(directive('connect-src'), "connect-src 'self'", 'blocks the runtime falling back to a CDN');
  assert.doesNotMatch(csp('page'), /'unsafe-eval'|'unsafe-inline'|https?:/);
});

test('only pages may compile WebAssembly', () => {
  for (const kind of ['api', 'file', 'visual'] as const) assert.doesNotMatch(csp(kind), /wasm-unsafe-eval/, kind);
});

test('files are sandboxed and only framable by the room itself', () => {
  const policy = csp('file');
  assert.match(policy, /^sandbox;/, 'no allow-scripts: an SVG or HTML opened directly runs nothing');
  assert.match(policy, /frame-ancestors 'self'/);
});

test('visuals may run inline script but have no network or same-origin access', () => {
  const policy = csp('visual');
  assert.match(policy, /^sandbox allow-scripts;/);
  assert.doesNotMatch(policy, /allow-same-origin/);
  assert.match(policy, /default-src 'none'/);
  assert.doesNotMatch(policy, /connect-src/, 'falls back to none');
});

test('a CSP set by the route is kept', () => {
  const pre = new Response('x', { headers: { 'Content-Security-Policy': 'sandbox' } });
  assert.equal(csp('api', pre), 'sandbox');
});

test('status and body survive', async () => {
  const out = withSecurityHeaders(new Response('hello', { status: 418 }), 'api');
  assert.equal(out.status, 418);
  assert.equal(await out.text(), 'hello');
});

test('only a 101 carrying a socket skips the headers; a socket on another status gets them', () => {
  // Node's Response cannot hold status 101, so the upgrade is a stand-in; copying it would throw.
  const upgrade = { status: 101, webSocket: {} } as unknown as Response;
  assert.equal(withSecurityHeaders(upgrade, 'api'), upgrade);
  const other = Object.assign(new Response('x'), { webSocket: {} });
  assert.equal(withSecurityHeaders(other, 'api').headers.get('X-Content-Type-Options'), 'nosniff');
});

test('writes need the exact origin and Sec-Fetch-Site same-origin', () => {
  const url = 'https://legallas.example.test/api/x';
  const make = (headers: Record<string, string>) => new Request(url, { method: 'POST', headers });
  assert.equal(isSameOriginWrite(make({ Origin: 'https://legallas.example.test', 'Sec-Fetch-Site': 'same-origin' })), true);
  assert.equal(isSameOriginWrite(make({ Origin: 'https://example.test', 'Sec-Fetch-Site': 'same-site' })), false, 'sibling subdomain');
  assert.equal(isSameOriginWrite(make({ Origin: 'https://legallas.example.test' })), false, 'missing Sec-Fetch-Site');
  assert.equal(isSameOriginWrite(make({ 'Sec-Fetch-Site': 'same-origin' })), false, 'missing Origin');
  assert.equal(isWrite('patch'), true);
  assert.equal(isWrite('GET'), false);
});

test('routes match literal segments and params, and report wrong methods', () => {
  const handler = async () => new Response('ok');
  const routes: Route[] = [
    { method: 'GET', path: '/api/documents/:id', handler },
    { method: 'POST', path: '/api/documents/:id/comments', handler },
  ];
  const found = matchRoute(routes, 'GET', '/api/documents/abc%20def');
  assert.equal(found.kind, 'found');
  assert.deepEqual(found.kind === 'found' && found.params, { id: 'abc def' });
  assert.deepEqual(matchRoute(routes, 'DELETE', '/api/documents/abc'), { kind: 'wrong-method', allow: ['GET'] });
  assert.equal(matchRoute(routes, 'GET', '/api/documents/').kind, 'none', 'empty param');
  assert.equal(matchRoute(routes, 'GET', '/api/documents/%E0%A4%A').kind, 'none', 'bad escape');
  assert.equal(matchRoute(routes, 'GET', '/api/documents/a/b').kind, 'none');
});
