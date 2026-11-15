// SPDX-License-Identifier: Apache-2.0
// The sample room's test login: a very small OpenID Connect provider, deployed as its own Worker and added to Cloudflare Access as
// a login method for the sample room's two Access apps only. The room rightly refuses a service token, because a service token has
// no email. So a journey signs in the way a person does: Access sends it here, and this answers for an invented address.
//
// It signs in only addresses at example.test, a domain reserved for testing that no real person can have, and only for whoever
// holds LOGIN_SECRET. It holds no document and no room data, and the room still decides from its own members table who gets in.
import type { webcrypto } from 'node:crypto';

const CODE_SECONDS = 60;
const ID_TOKEN_SECONDS = 300;
const encoder = new TextEncoder();

export interface LoginEnv {
  /** SAMPLE_ROOM_TEST_LOGIN_SECRET: what a sign-in must present. */
  LOGIN_SECRET: string;
  /** This login's private key, a JWK made by live/run.ts when it deploys. */
  SIGNING_JWK: string;
  /** What Access presents at /token, and the one place a sign-in may return to. */
  CLIENT_ID: string;
  CLIENT_SECRET: string;
  CALLBACK_URL: string;
}

const base64url = (bytes: Uint8Array | ArrayBuffer) => Buffer.from(bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes).toString('base64url');
const fromBase64url = (text: string) => Buffer.from(text, 'base64url');

async function hmac(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
}

/** Compares by HMAC, so neither the length nor the first differing byte of a secret shows in the time taken. */
async function sameSecret(secret: string, given: string): Promise<boolean> {
  const [a, b] = await Promise.all([hmac(secret, 'compare'), hmac(given, 'compare')]);
  return a.every((byte, i) => byte === b[i]);
}

/**
 * A code Access trades at /token: the address, the nonce and an expiry, signed. It can be traded more than once inside its life, and /token
 * doesn't compare the return address: this login has no storage, a trade needs the client secret, and it only signs in invented addresses.
 */
async function makeCode(env: LoginEnv, email: string, nonce: string, now: number): Promise<string> {
  const body = base64url(encoder.encode(JSON.stringify({ email, nonce, exp: now + CODE_SECONDS })));
  return `${body}.${base64url(await hmac(env.CLIENT_SECRET, body))}`;
}

async function readCode(env: LoginEnv, code: string, now: number): Promise<{ email: string; nonce: string } | null> {
  const [body, signature] = code.split('.');
  if (!body || !signature || !(await sameSecret(base64url(await hmac(env.CLIENT_SECRET, body)), signature))) return null;
  try {
    const claims = JSON.parse(fromBase64url(body).toString('utf8')) as { email: string; nonce: string; exp: number };
    return claims.exp >= now ? claims : null;
  } catch {
    return null;
  }
}

async function idToken(env: LoginEnv, origin: string, email: string, nonce: string, now: number): Promise<string> {
  const jwk = JSON.parse(env.SIGNING_JWK) as webcrypto.JsonWebKey & { kid: string };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const head = base64url(encoder.encode(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid: jwk.kid })));
  const claims = { iss: origin, sub: email, aud: env.CLIENT_ID, email, email_verified: true, nonce, iat: now, exp: now + ID_TOKEN_SECONDS };
  const payload = base64url(encoder.encode(JSON.stringify(claims)));
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, encoder.encode(`${head}.${payload}`));
  return `${head}.${payload}.${base64url(signature)}`;
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/** The page a journey fills in. No script and no outside request: the policy says so. */
function loginPage(params: URLSearchParams): Response {
  const field = (name: string) => `<input type="hidden" name="${name}" value="${escapeHtml(params.get(name) ?? '')}">`;
  const html = `<!doctype html><meta charset="utf-8"><title>Test login</title><p>Test login for the fictional sample room.</p><form method="post" action="/authorize">${['redirect_uri', 'state', 'nonce'].map(field).join('')}<label>Address <input name="email" data-test-email></label> <label>Secret <input name="secret" type="password" data-test-secret></label> <button>Sign in</button></form>`;
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'none'; form-action 'self'" } });
}

/** A checked sign-in returns to Access with a code. Anything wrong is the same refusal, saying nothing about which part was wrong. */
async function signIn(request: Request, env: LoginEnv, now: number): Promise<Response> {
  const form = await request.formData().catch(() => new FormData());
  const value = (name: string) => String(form.get(name) ?? '');
  const email = value('email').trim().toLowerCase();
  const fits = /^[a-z0-9._-]+@example\.test$/.test(email) && value('redirect_uri') === env.CALLBACK_URL;
  if (!fits || !(await sameSecret(env.LOGIN_SECRET, value('secret')))) return new Response('Refused', { status: 403 });
  const target = new URL(env.CALLBACK_URL);
  target.searchParams.set('code', await makeCode(env, email, value('nonce'), now));
  target.searchParams.set('state', value('state'));
  return new Response(null, { status: 302, headers: { location: target.href } });
}

/** Access trades its code for an ID token, with its client secret in the form or in Basic auth. */
async function token(request: Request, env: LoginEnv, origin: string, now: number): Promise<Response> {
  const form = await request.formData().catch(() => new FormData());
  const basic = /^Basic (.+)$/.exec(request.headers.get('authorization') ?? '')?.[1];
  // The client secret is base64url (run.ts), so it holds no colon.
  const [basicId, basicSecret] = basic ? Buffer.from(basic, 'base64').toString('utf8').split(':') : [];
  const clientId = String(form.get('client_id') ?? basicId ?? '');
  const clientSecret = String(form.get('client_secret') ?? basicSecret ?? '');
  if (clientId !== env.CLIENT_ID || !(await sameSecret(env.CLIENT_SECRET, clientSecret))) return Response.json({ error: 'invalid_client' }, { status: 401 });
  const claims = await readCode(env, String(form.get('code') ?? ''), now);
  if (!claims) return Response.json({ error: 'invalid_grant' }, { status: 400 });
  return Response.json({ access_token: crypto.randomUUID(), token_type: 'Bearer', expires_in: ID_TOKEN_SECONDS, id_token: await idToken(env, origin, claims.email, claims.nonce, now) });
}

/** The public half of the signing key. */
function certs(env: LoginEnv): Response {
  const { kty, crv, x, y, kid } = JSON.parse(env.SIGNING_JWK) as Record<string, string>;
  return Response.json({ keys: [{ kty, crv, x, y, kid, use: 'sig', alg: 'ES256' }] });
}

export async function handle(request: Request, env: LoginEnv, now = Math.floor(Date.now() / 1000)): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === 'GET' && url.pathname === '/authorize') return loginPage(url.searchParams);
  if (request.method === 'POST' && url.pathname === '/authorize') return signIn(request, env, now);
  if (request.method === 'POST' && url.pathname === '/token') return token(request, env, url.origin, now);
  if (request.method === 'GET' && url.pathname === '/certs') return certs(env);
  return new Response('Not found', { status: 404 });
}

export default { fetch: (request: Request, env: LoginEnv) => handle(request, env) };
