// SPDX-License-Identifier: Apache-2.0
// /files/:id through the real gate in room.ts, with fake D1 and R2 (files-fixtures.ts). /api/visuals is pro's:
// visuals-route.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from './room.ts';
import type { Env } from './env.ts';
import { fakeEnv, HOST, OWNER } from './files-fixtures.ts';
import { attachment } from './routes/files.ts';

const get = (env: Env, path: string, headers?: HeadersInit) =>
  handle(new Request(`${HOST}${path}`, { headers }), env, {} as ExecutionContext);

test('a mirrored visual framed by the room runs in the script-only sandbox and is audited', async () => {
  const { env, audits } = fakeEnv({ 'k-start': '<html>chart</html>' });
  const res = await get(env, '/files/v1', { 'CF-Connecting-IP': '203.0.113.9', 'User-Agent': 'test', 'Sec-Fetch-Dest': 'iframe' });
  assert.equal(res.status, 200);
  assert.equal(await res.text(), '<html>chart</html>');
  assert.equal(res.headers.get('Content-Type'), 'text/html; charset=utf-8');
  assert.equal(res.headers.get('Content-Disposition'), null);
  const csp = res.headers.get('Content-Security-Policy') ?? '';
  assert.match(csp, /^sandbox allow-scripts;/);
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /frame-ancestors 'self'/);
  assert.deepEqual(audits.map((a) => a.slice(0, 5)), [[OWNER, 'view', 'v1', '203.0.113.9', 'test']]);
});

test('a mirrored visual opened in its own tab is a sandboxed download, never run', async () => {
  const { env, audits } = fakeEnv({ 'k-start': '<html><meta http-equiv="refresh" content="0;url=https://tracker.example/"></html>' });
  for (const dest of ['document', null]) {
    const res = await get(env, '/files/v1', dest ? { 'Sec-Fetch-Dest': dest } : {});
    assert.match(res.headers.get('Content-Disposition') ?? '', /^attachment;/, String(dest));
    assert.match(res.headers.get('Content-Security-Policy') ?? '', /^sandbox;/, String(dest));
  }
  assert.equal(audits[0]![1], 'download');
});

test('counsel-uploaded HTML never runs: it is a sandboxed download', async () => {
  const { env, audits } = fakeEnv({ 'k-counsel': '<script>alert(1)</script>' });
  const res = await get(env, '/files/c1');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('Content-Disposition') ?? '', /^attachment;/);
  assert.match(res.headers.get('Content-Security-Policy') ?? '', /^sandbox;/);
  assert.equal(audits[0]![1], 'download');
});

test('unknown or missing files are 404 JSON and are not audited', async () => {
  const { env, audits } = fakeEnv({});
  assert.equal((await get(env, '/files/nope')).status, 404);
  assert.equal((await get(env, '/files/v1')).status, 404);
  assert.equal(audits.length, 0);
});

test('attachment() keeps quotes and non-ASCII out of the plain filename', () => {
  assert.equal(attachment('a "b".pdf'), `attachment; filename="a _b_.pdf"; filename*=UTF-8''a%20%22b%22.pdf`);
  assert.match(attachment('café.pdf'), /filename="caf_\.pdf"; filename\*=UTF-8''caf%C3%A9\.pdf/);
});
