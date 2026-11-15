// SPDX-License-Identifier: Apache-2.0
// The front door's public list: exactly these files load without signing in, and nothing near them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PUBLIC_PATHS, isPublicPath, servePublic } from './public.ts';
import type { Env } from './env.ts';

// What the Worker sees: URL.pathname after the runtime's own normalization.
const pathOf = (raw: string) => new URL(raw, 'https://legallas.example').pathname;

test('every listed path is public', () => {
  for (const path of PUBLIC_PATHS) assert.equal(isPublicPath(path), true, path);
});

test('near misses stay private', () => {
  const near = [
    '/',
    '/Welcome/',
    '/WELCOME/door.css',
    '/welcomex',
    '/welcome.html',
    '/welcome/index.html',
    '/welcome/missing',
    '/welcome/denied',
    '/welcome//door.css',
    '/welcome/door.css/',
    '/welcome/door.css%00',
    '/welcome/%2e%2e/api/me',
    '/welcome/%2E%2E/files/abc',
    '/welcome/..%2fapi/me',
    '/welcome/fonts/',
    '/welcome/fonts/other.woff2',
    '/_astro/door.css',
    '/api/me',
    '/favicon.svg',
  ];
  for (const raw of near) {
    assert.equal(isPublicPath(raw), false, `${raw} as written`);
    assert.equal(isPublicPath(pathOf(raw)), false, `${raw} as URL.pathname (${pathOf(raw)})`);
  }
});

test('a dot-dot path that the URL parser resolves back into /welcome/ is still only that file', () => {
  // new URL() resolves literal ".." segments, so this request really is /welcome/door.css.
  assert.equal(pathOf('/api/../welcome/door.css'), '/welcome/door.css');
  assert.equal(isPublicPath(pathOf('/welcome/fonts/../door.css')), true);
  assert.equal(isPublicPath(pathOf('/welcome/../api/me')), false);
});

function assetsEnv(): { env: Env; seen: string[] } {
  const seen: string[] = [];
  const env = {
    ASSETS: {
      fetch: async (request: Request) => {
        seen.push(new URL(request.url).pathname);
        return new Response('body', { headers: { 'Content-Type': 'text/css' } });
      },
    },
  } as unknown as Env;
  return { env, seen };
}

test('servePublic serves GET and HEAD with the page headers', async () => {
  for (const method of ['GET', 'HEAD']) {
    const { env, seen } = assetsEnv();
    const res = await servePublic(new Request('https://legallas.example/welcome/door.css', { method }), env, '/welcome/door.css');
    assert.equal(res.status, 200, method);
    assert.deepEqual(seen, ['/welcome/door.css']);
    assert.match(res.headers.get('Content-Security-Policy') ?? '', /frame-ancestors 'none'/);
    assert.equal(res.headers.get('X-Robots-Tag'), 'noindex, nofollow, noarchive');
    assert.equal(res.headers.get('Cross-Origin-Resource-Policy'), 'same-origin');
  }
});

test('servePublic refuses writes without touching assets', async () => {
  for (const method of ['POST', 'PUT', 'DELETE']) {
    const { env, seen } = assetsEnv();
    const res = await servePublic(new Request('https://legallas.example/welcome/', { method }), env, '/welcome/');
    assert.equal(res.status, 405, method);
    assert.equal(res.headers.get('Allow'), 'GET, HEAD');
    assert.deepEqual(seen, []);
  }
});

test('only the Access login logo may load cross-origin', async () => {
  const { env } = assetsEnv();
  const logo = await servePublic(new Request('https://legallas.example/welcome/seal-access.svg'), env, '/welcome/seal-access.svg');
  assert.equal(logo.headers.get('Cross-Origin-Resource-Policy'), 'cross-origin');
  const icon = await servePublic(new Request('https://legallas.example/welcome/favicon.svg'), env, '/welcome/favicon.svg');
  assert.equal(icon.headers.get('Cross-Origin-Resource-Policy'), 'same-origin');
});

test('with the company room setting on, HEAD on a page sends a shaped GET\'s headers: no unshaped Content-Length (#220)', async () => {
  const page = '<html><p data-case-only>A case-room line.</p></html>';
  const env = {
    COMPANY_ROOM_ENABLED: '1',
    ASSETS: { fetch: async () => new Response(page, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': String(page.length) } }) },
  } as unknown as Env;
  const res = await servePublic(new Request('https://legallas.example/welcome/', { method: 'HEAD' }), env, '/welcome/');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Content-Length'), null);
  assert.match(res.headers.get('Content-Security-Policy') ?? '', /frame-ancestors 'none'/);
  const css = await servePublic(new Request('https://legallas.example/welcome/door.css', { method: 'HEAD' }), { ...env, ASSETS: { fetch: async () => new Response('x', { headers: { 'Content-Type': 'text/css', 'Content-Length': '1' } }) } } as unknown as Env, '/welcome/door.css');
  assert.equal(css.headers.get('Content-Length'), '1', 'only a page is shaped');
});
