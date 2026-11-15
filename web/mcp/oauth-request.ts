// SPDX-License-Identifier: Apache-2.0
// POST /token and POST /register, read before the OAuth library sees them (mcp/index.ts). /token's `scope` keeps
// only the scopes this server knows: an app that asks for more at the token step (`offline_access`, which some
// clients add) would otherwise fail with invalid_scope after the lawyer had already approved it. Dropping a scope
// can never widen a token: the library intersects what is asked with what the grant holds. Both requests also note
// the step, grant type and app host, so a failed answer can be reported (mcp/signin-failure.ts).
import { SCOPES } from './contract.ts';
import { failureHost, recordSignInFailure, skipReason, type SignInFailure, type SignInFailureEnv } from './signin-failure.ts';

const TOKEN_PATH = '/token';
const REGISTER_PATH = '/register';
const FORM_TYPE = 'application/x-www-form-urlencoded';
/** Bodies longer than this are left to the library unread: real token and registration requests are far smaller. */
export const MAX_PREREAD_BYTES = 16_384;

/** What a failed answer to the request is reported as, before its error code is known. */
export type OAuthSource = Omit<SignInFailure, 'code'>;

export interface PreparedRequest {
  /** The request to forward: the same object when nothing changed. */
  request: Request;
  /** Set for POST /token (form-encoded) and POST /register. */
  source?: OAuthSource;
}

/** The body of a copy of `request` as text, or null once it passes MAX_PREREAD_BYTES. The original stays unread. */
async function preread(request: Request): Promise<string | null> {
  const reader = request.clone().body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_PREREAD_BYTES) {
      reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/** The same POST with a new form body: every header kept (Authorization carries client_secret_basic), length dropped. */
function withForm(request: Request, params: URLSearchParams): Request {
  const headers = new Headers(request.headers);
  headers.delete('content-length');
  return new Request(request.url, { method: 'POST', headers, body: params.toString() });
}

/**
 * One `scope` parameter keeps only the tokens in SCOPES, and goes when none remain (the grant's scope then
 * applies). A repeated `scope` is left for the library to refuse; `resource` is never touched.
 */
async function prepareToken(request: Request): Promise<PreparedRequest> {
  const type = (request.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase();
  if (type !== FORM_TYPE) return { request };
  const text = await preread(request);
  if (text === null) return { request };
  const params = new URLSearchParams(text);
  const grantType = params.get('grant_type') ?? undefined;
  const source: OAuthSource = { where: 'token', host: failureHost(params.get('redirect_uri'), params.get('client_id')), grantType };
  const asked = params.getAll('scope');
  if (asked.length !== 1) return { request, source };
  const kept = asked[0].split(' ').filter((scope) => SCOPES.includes(scope)).join(' ');
  if (kept === asked[0]) return { request, source };
  if (kept) params.set('scope', kept);
  else params.delete('scope');
  return { request: withForm(request, params), source };
}

/** The host of a registration's first redirect URI, or "unknown". */
async function registerHost(request: Request): Promise<string> {
  try {
    const text = await preread(request);
    const body = (text === null ? null : JSON.parse(text)) as { redirect_uris?: unknown } | null;
    const uris = body?.redirect_uris;
    return failureHost(Array.isArray(uris) ? uris[0] : undefined, undefined);
  } catch {
    return 'unknown';
  }
}

/**
 * Reads POST /token and POST /register ahead of the library (see the file comment). Never throws: a request it
 * cannot read goes on unchanged with no source.
 */
export async function prepareOAuthRequest(request: Request): Promise<PreparedRequest> {
  if (request.method !== 'POST') return { request };
  const { pathname } = new URL(request.url);
  try {
    if (pathname === TOKEN_PATH) return await prepareToken(request);
    if (pathname === REGISTER_PATH) return { request, source: { where: 'register', host: await registerHost(request) } };
  } catch (error) {
    console.warn('mcp_oauth_preread_failed', error instanceof Error ? error.name : 'unknown');
  }
  return { request };
}

/** The OAuth `error` code of a failed answer, else `http_<status>`. */
async function errorCode(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown } | null;
    if (typeof body?.error === 'string') return body.error;
  } catch {
    // Not JSON: the status still says what happened.
  }
  return `http_${response.status}`;
}

/**
 * Reports a 4xx or 5xx answer to a prepared request (recordSignInFailure), for ctx.waitUntil. The body is read
 * from a copy taken before this returns, so the client's response is never consumed. /register's
 * invalid_redirect_uri is skipped: recordRefusedRedirect already emails it. Never throws.
 */
export function reportOAuthFailure(env: SignInFailureEnv, source: OAuthSource, response: Response, now: Date = new Date()): Promise<void> {
  if (response.status < 400 || skipReason(source)) return Promise.resolve();
  const copy = response.clone();
  return (async () => {
    const code = await errorCode(copy);
    if (source.where === 'register' && code === 'invalid_redirect_uri') return;
    await recordSignInFailure(env, { ...source, code }, now);
  })();
}
