// SPDX-License-Identifier: Apache-2.0
// The consent and token steps of the legallas-mcp client flow (see scripts/mcp-oauth.ts for discovery and
// registration): read the consent page, post its approval, take the code from the Location header, then the
// token endpoint (code exchange, refresh, RFC 7009 revocation). Fetch is injected; nothing here logs.
import { cookiesFrom, onBase, timeout, type AuthMethod, type Client, type Fetch } from './mcp-oauth.ts';

/** The consent page's approval form: where to post it and every field to send, the `handle` among them. */
export interface ConsentForm {
  action: string;
  fields: Record<string, string>;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", '#x27': "'" };

function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, name: string) => {
    const lower = name.toLowerCase();
    if (ENTITIES[lower]) return ENTITIES[lower];
    if (lower.startsWith('#x')) return String.fromCodePoint(parseInt(lower.slice(2), 16));
    if (lower.startsWith('#')) return String.fromCodePoint(parseInt(lower.slice(1), 10));
    return whole;
  });
}

function attributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of tag.matchAll(/([A-Za-z_:][-A-Za-z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    attrs[match[1]!.toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attrs;
}

const APPROVE = /approve|allow|accept|connect|authori[sz]e/i;
const DENY = /deny|decline|cancel|reject/i;

/**
 * Finds the POST form that carries a `handle` and returns it with its hidden fields plus the approve button's
 * name and value (a button that reads as approve, never one that reads as deny). Null when there is none.
 */
export function parseConsentForm(html: string, pageUrl: string): ConsentForm | null {
  for (const form of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const formAttrs = attributes(form[1]!);
    if ((formAttrs.method ?? 'get').toLowerCase() !== 'post') continue;
    const fields: Record<string, string> = {};
    for (const input of form[2]!.matchAll(/<input\b([^>]*)>/gi)) {
      const attrs = attributes(input[1]!);
      if (attrs.name && (attrs.type ?? 'text').toLowerCase() === 'hidden') fields[attrs.name] = attrs.value ?? '';
    }
    if (!('handle' in fields)) continue;
    for (const button of form[2]!.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)) {
      const attrs = attributes(button[1]!);
      const label = `${attrs.value ?? ''} ${button[2]!.replace(/<[^>]*>/g, ' ')}`;
      if (attrs.name && APPROVE.test(label) && !DENY.test(label)) {
        fields[attrs.name] = attrs.value ?? '';
        break;
      }
    }
    return { action: new URL(formAttrs.action || pageUrl, pageUrl).href, fields };
  }
  return null;
}

export interface ConsentPage {
  status: number;
  form: ConsentForm | null;
  cookies: string[];
}

/** GET /authorize as the signed-in browser would, keeping the consent binding cookie. */
export async function openConsent(fetcher: Fetch, url: string): Promise<ConsentPage> {
  const response = await fetcher(url, { headers: { Accept: 'text/html' }, redirect: 'manual', signal: timeout() });
  const html = response.ok ? await response.text() : '';
  if (!response.ok) await response.body?.cancel();
  return { status: response.status, form: response.ok ? parseConsentForm(html, url) : null, cookies: cookiesFrom(response.headers) };
}

export interface Approval {
  status: number;
  code: string | null;
  state: string | null;
  iss: string | null;
  /** `error` on the redirect, if the server sent the browser back with one. */
  error: string | null;
}

/** Posts the approval (same-origin, with the binding cookie) and reads the redirect's query, never following it. */
export async function approveConsent(fetcher: Fetch, form: ConsentForm, cookies: string[], base: string): Promise<Approval> {
  const response = await fetcher(onBase(form.action, base), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'text/html',
      Origin: new URL(base).origin,
      'Sec-Fetch-Site': 'same-origin',
      Cookie: cookies.join('; '),
    },
    body: new URLSearchParams(form.fields).toString(),
    redirect: 'manual',
    signal: timeout(),
  });
  await response.body?.cancel();
  const location = response.headers.get('Location');
  const query = location ? new URL(location, base).searchParams : new URLSearchParams();
  return { status: response.status, code: query.get('code'), state: query.get('state'), iss: query.get('iss'), error: query.get('error') };
}

export interface Tokens {
  accessToken: string;
  refreshToken: string | null;
  tokenType: string;
  expiresIn: number | null;
  scope: string | null;
}

export interface TokenResult {
  status: number;
  tokens: Tokens | null;
  /** The OAuth error code (`invalid_grant`, `invalid_target`, ...). */
  error: string | null;
}

/**
 * A client as the token endpoint sees it. `authMethod` is how it registered (RFC 7591 token_endpoint_auth_method):
 * unset keeps the old rule, the secret in the body when there is one. A server that recorded an explicit method
 * refuses any other (workers-oauth-provider: token_endpoint_auth_method_mismatch), so Teams' Basic client must use Basic.
 */
export type TokenClient = Client & { authMethod?: AuthMethod };

/** RFC 6749 section 2.3.1: the id and secret are each form-encoded, joined by a colon, then base64'd. */
export function basicCredentials(clientId: string, secret: string): string {
  const encode = (value: string) => encodeURIComponent(value).replace(/%20/g, '+');
  return `Basic ${btoa(`${encode(clientId)}:${encode(secret)}`)}`;
}

/**
 * How a request authenticates `client`: client_secret_basic is an Authorization header and nothing in the body (the
 * library refuses Basic plus a body client_id as two methods); otherwise client_id in the body, and the secret
 * too unless the client is public (`none`).
 */
export function clientAuth(client: TokenClient): { headers: Record<string, string>; fields: Record<string, string> } {
  if (client.authMethod === 'client_secret_basic') {
    if (!client.clientSecret) throw new Error('client_secret_basic needs a client secret');
    return { headers: { Authorization: basicCredentials(client.clientId, client.clientSecret) }, fields: {} };
  }
  const fields: Record<string, string> = { client_id: client.clientId };
  if (client.clientSecret && client.authMethod !== 'none') fields.client_secret = client.clientSecret;
  return { headers: {}, fields };
}

/** One form POST to the token endpoint, the client authenticated as clientAuth says. */
export async function tokenRequest(fetcher: Fetch, endpoint: string, client: TokenClient, params: Record<string, string>): Promise<TokenResult> {
  const auth = clientAuth(client);
  const response = await fetcher(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', ...auth.headers },
    body: new URLSearchParams({ ...params, ...auth.fields }).toString(),
    redirect: 'manual',
    signal: timeout(),
  });
  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok || typeof json.access_token !== 'string') {
    return { status: response.status, tokens: null, error: typeof json.error === 'string' ? json.error : `http_${response.status}` };
  }
  return {
    status: response.status,
    tokens: {
      accessToken: json.access_token,
      refreshToken: typeof json.refresh_token === 'string' ? json.refresh_token : null,
      tokenType: typeof json.token_type === 'string' ? json.token_type : '',
      expiresIn: typeof json.expires_in === 'number' ? json.expires_in : null,
      scope: typeof json.scope === 'string' ? json.scope : null,
    },
    error: null,
  };
}

/** The code exchange; a null resource leaves the parameter out (the authorization request did too). */
export function exchangeCode(fetcher: Fetch, endpoint: string, client: TokenClient, code: string, redirectUri: string, verifier: string, resource: string | null): Promise<TokenResult> {
  const params: Record<string, string> = { grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier };
  if (resource !== null) params.resource = resource;
  return tokenRequest(fetcher, endpoint, client, params);
}

export function refresh(fetcher: Fetch, endpoint: string, client: TokenClient, refreshToken: string, resource: string): Promise<TokenResult> {
  return tokenRequest(fetcher, endpoint, client, { grant_type: 'refresh_token', refresh_token: refreshToken, resource });
}

/** RFC 7009: revoking a refresh token revokes its whole grant. Returns the HTTP status (200 even if unknown). */
export async function revoke(fetcher: Fetch, endpoint: string, client: TokenClient, token: string): Promise<number> {
  const auth = clientAuth(client);
  const response = await fetcher(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...auth.headers },
    body: new URLSearchParams({ token, token_type_hint: 'refresh_token', ...auth.fields }).toString(),
    redirect: 'manual',
    signal: timeout(),
  });
  await response.body?.cancel();
  return response.status;
}
