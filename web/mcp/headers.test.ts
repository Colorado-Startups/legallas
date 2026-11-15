// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withNosniff } from './headers.ts';

test('a JSON answer gains nosniff and keeps its status, headers and body', async () => {
  const original = Response.json({ issuer: 'http://localhost:8790' }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  const out = withNosniff(original);
  assert.equal(out.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(out.status, 201);
  assert.equal(out.headers.get('Cache-Control'), 'no-store');
  assert.match(out.headers.get('Content-Type') ?? '', /application\/json/);
  assert.deepEqual(await out.json(), { issuer: 'http://localhost:8790' });
});

test('a response that already says nosniff is returned as it is', () => {
  const page = new Response('<p>hi</p>', { headers: { 'x-content-type-options': 'nosniff' } });
  assert.equal(withNosniff(page), page);
});

test('an error answer gains it too', () => {
  assert.equal(withNosniff(new Response(null, { status: 401 })).headers.get('X-Content-Type-Options'), 'nosniff');
});
