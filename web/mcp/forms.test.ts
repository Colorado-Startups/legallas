// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FORM_COOKIE, FORM_FIELD, checkForm, formToken } from './forms.ts';

const ORIGIN = 'https://mcp.room.example.com';

function post(token: string | null, field: string | null, origin: string | null, url = `${ORIGIN}/connections`) {
  const headers = new Headers();
  if (token) headers.set('cookie', `other=1; ${FORM_COOKIE}=${token}`);
  if (origin) headers.set('origin', origin);
  const form = new FormData();
  if (field !== null) form.set(FORM_FIELD, field);
  return { request: new Request(url, { method: 'POST', headers }), form };
}

test('a new browser gets a fresh token and a strict __Host- cookie', () => {
  const { token, setCookie } = formToken(new Request(`${ORIGIN}/connections`));
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(setCookie?.startsWith(`${FORM_COOKIE}=${token};`));
  for (const attr of ['Path=/', 'Secure', 'HttpOnly', 'SameSite=Strict']) assert.ok(setCookie?.includes(attr), attr);
});

test('a browser with a token keeps it', () => {
  const { token } = formToken(new Request(`${ORIGIN}/`));
  const again = formToken(new Request(`${ORIGIN}/`, { headers: { cookie: `${FORM_COOKIE}=${token}` } }));
  assert.equal(again.token, token);
  assert.equal(again.setCookie, null);
});

test('accepts a same-origin post whose field matches the cookie', async () => {
  const { token } = formToken(new Request(`${ORIGIN}/`));
  const { request, form } = post(token, token, ORIGIN);
  assert.equal(await checkForm(request, form), true);
});

test('refuses cross-origin, missing origin, mismatched or missing tokens', async () => {
  const { token } = formToken(new Request(`${ORIGIN}/`));
  const other = formToken(new Request(`${ORIGIN}/`)).token;
  for (const [cookie, field, origin] of [
    [token, token, 'https://evil.example'],
    [token, token, null],
    [token, token, 'null'],
    [token, other, ORIGIN],
    [null, token, ORIGIN],
    [token, null, ORIGIN],
  ] as const) {
    const { request, form } = post(cookie, field, origin);
    assert.equal(await checkForm(request, form), false);
  }
});

test('on localhost the local origin counts as same-origin', async () => {
  const { token } = formToken(new Request('http://localhost:8790/'));
  const { request, form } = post(token, token, 'http://localhost:8790', 'http://localhost:8790/connections');
  assert.equal(await checkForm(request, form), true);
});
