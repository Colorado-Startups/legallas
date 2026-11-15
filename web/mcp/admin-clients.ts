// SPDX-License-Identifier: Apache-2.0
// /admin/clients: the owner's view of registered OAuth clients. It creates the static client that Microsoft's
// federated connector needs (a client ID and secret typed into the Microsoft admin page; the secret is shown
// once), adds an allowlisted redirect URI to one (so a connector can be finished in one pass) and deletes
// clients, which also revokes their grants. It also lists the sign-in callbacks a registration was refused for,
// to Allow (no redeploy) or Dismiss, and the allowed ones, to Remove, and its All clients list has one button that
// deletes the production smoke's old registrations (smoke-clients.ts). Counsel get a 403; posts need the form token.
//
// Anyone can register clients through /register, so this page never reads every client in one request (a KV
// read each, against a 1,000-operation limit). It lists the static clients from its own small KV index, and
// pages through all clients only when asked (?list=all), one page per request.
import type { ClientInfo } from '@cloudflare/workers-oauth-provider';
import type { Member } from '../worker/env.ts';
import { FIELDS, STATIC_CLIENT_PREFIX, type McpEnv } from './contract.ts';
import { checkForm, formToken } from './forms.ts';
import { formPageResponse, type AdminClientsView } from './pages/index.ts';
import { renderAdminClientsPage, type RedirectsView, type SmokeSweepView } from './pages/admin.ts';
import { SmokeSweepRefused, sweepSmokeClients, type SmokeSweepResult } from './smoke-clients.ts';
import { messagePage, requireMember, type GateDeps } from './authorize.ts';
import {
  allowRefusedRedirect,
  allowedRedirects,
  dismissRefusedRedirect,
  isAllowedRedirect,
  logRefusedRedirect,
  MAX_STORED_REDIRECTS,
  refusedRedirects,
  removeAllowedRedirect,
} from './redirects.ts';
import { neverZeroRetention, zeroRetentionOnly } from './retention.ts';
import { clientKindOf } from './server.ts';
import { STORED_NAME } from '../worker/stored-name.ts';

/**
 * Values of FIELDS.action. Field and query names live in contract.ts FIELDS; the three callback actions post the
 * URI in FIELDS.redirectUris.
 */
export const ADMIN_ACTIONS = {
  create: 'create',
  delete: 'delete',
  addRedirect: 'add_redirect',
  allowCallback: 'allow_callback',
  dismissCallback: 'dismiss_callback',
  removeCallback: 'remove_callback',
  sweepSmoke: 'sweep_smoke',
} as const;
/** FIELDS.list=all pages through every client; anything else lists the static clients. */
export const LIST_ALL = 'all';

/**
 * KV keys this page owns, beside the library's (`client:`, `grant:`, `token:`, `transaction:`). The static index is
 * declared in contract.ts, so smoke-clients.ts can skip every client it names.
 */
export { STATIC_CLIENT_PREFIX };
const CREATED_PREFIX = `${STORED_NAME}-admin:created:`;
/** KV's minimum expiry: a new secret waits at most this long for its one view. */
const CREATED_TTL_SECONDS = 60;

const MAX_CLIENT_NAME = 80;
const MAX_REDIRECT_URIS = 10;
const MAX_CLIENT_ID = 256;
const MAX_CURSOR = 2048;
/** Rows per request: one KV list plus one read per row stays far below the per-request limit. */
export const PAGE_SIZE = 50;
const CREATED_REF = /^[A-Za-z0-9_-]{22}$/;

type ClientRow = AdminClientsView['clients'][number];
type Created = NonNullable<AdminClientsView['created']>;

/** What the page shows beyond AdminClientsView (A2 renders a "Load more" link and the list toggle from these). */
export interface AdminListExtras {
  list: 'static' | 'all';
  /** Present when more rows follow: link to `?list=<list>&cursor=<nextCursor>`. */
  nextCursor?: string;
}

function toRow(client: ClientInfo): ClientRow {
  return {
    clientId: client.clientId,
    clientName: client.clientName ?? '',
    redirectUris: [...client.redirectUris],
    registrationDate: client.registrationDate ?? null,
  };
}

/** One page of the static clients this page created, from its own index. */
export async function staticClients(env: McpEnv, cursor?: string): Promise<{ rows: ClientRow[]; nextCursor?: string }> {
  const listed = await env.OAUTH_KV.list({ prefix: STATIC_CLIENT_PREFIX, limit: PAGE_SIZE, cursor });
  const clients = await Promise.all(listed.keys.map((key) => env.OAUTH_PROVIDER.lookupClient(key.name.slice(STATIC_CLIENT_PREFIX.length))));
  const rows = clients.filter((client): client is ClientInfo => client !== null).map(toRow);
  return { rows, nextCursor: listed.list_complete ? undefined : listed.cursor };
}

/** One page of every stored client, dynamic registrations included. */
export async function allClientsPage(env: McpEnv, cursor?: string): Promise<{ rows: ClientRow[]; nextCursor?: string }> {
  const result = await env.OAUTH_PROVIDER.listClients({ limit: PAGE_SIZE, cursor });
  return { rows: result.items.map(toRow), nextCursor: result.cursor || undefined };
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function fromBase64url(text: string): Uint8Array {
  return Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0));
}

/** An AES key from the browser's form token: KV holds only ciphertext, and only that browser can open it. */
async function createdKey(token: string, ref: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${token}|${ref}`));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** Holds a new client's secret for one view, sealed to this browser; returns the reference for the redirect. */
async function sealCreated(env: McpEnv, token: string, created: Created): Promise<string> {
  const ref = base64url(crypto.getRandomValues(new Uint8Array(16)));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await createdKey(token, ref), new TextEncoder().encode(JSON.stringify(created)));
  await env.OAUTH_KV.put(`${CREATED_PREFIX}${ref}`, `${base64url(iv)}.${base64url(new Uint8Array(sealed))}`, { expirationTtl: CREATED_TTL_SECONDS });
  return ref;
}

/** The sealed secret, deleted as it is read, so a reload shows the list without it. Null if gone or not ours. */
export async function openCreated(env: McpEnv, token: string, ref: string | null): Promise<Created | null> {
  if (!ref || !CREATED_REF.test(ref)) return null;
  const key = `${CREATED_PREFIX}${ref}`;
  const stored = await env.OAUTH_KV.get(key);
  if (!stored) return null;
  await env.OAUTH_KV.delete(key);
  try {
    const [iv, sealed] = stored.split('.');
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64url(iv) }, await createdKey(token, ref), fromBase64url(sealed));
    return JSON.parse(new TextDecoder().decode(plain)) as Created;
  } catch {
    return null;
  }
}

/** The counts a Delete old smoke clients post redirects with; anything else in the query shows no note. */
export function sweptNotice(params: URLSearchParams): SmokeSweepView['swept'] {
  const deleted = params.get(FIELDS.swept);
  if (deleted === null || !/^\d{1,4}$/.test(deleted)) return undefined;
  return { deleted: Number(deleted), more: params.get(FIELDS.more) === '1' };
}

/** True when the room's zero-retention policy refuses an app with this callback however the owner lists it: Claude and Microsoft. */
export function neverAllowedCallback(env: McpEnv, uri: unknown): boolean {
  return typeof uri === 'string' && zeroRetentionOnly(env) && neverZeroRetention(clientKindOf([uri]));
}

/**
 * What the page shows for a GET: the refused and allowed sign-in callbacks, one page of static (default) or all
 * clients, a new secret at most once, and the counts of a smoke sweep just run.
 */
export async function adminView(request: Request, env: McpEnv, token: string): Promise<AdminClientsView & AdminListExtras & Required<RedirectsView> & SmokeSweepView> {
  const params = new URL(request.url).searchParams;
  const list = params.get(FIELDS.list) === LIST_ALL ? 'all' : 'static';
  const rawCursor = params.get(FIELDS.cursor);
  const cursor = rawCursor && rawCursor.length <= MAX_CURSOR ? rawCursor : undefined;
  const { rows, nextCursor } = list === 'all' ? await allClientsPage(env, cursor) : await staticClients(env, cursor);
  const created = (await openCreated(env, token, params.get(FIELDS.created))) ?? undefined;
  const [refused, allowed] = await Promise.all([refusedRedirects(env), allowedRedirects(env)]);
  const neverAllowed = refused.filter((row) => neverAllowedCallback(env, row.uri)).map((row) => row.uri);
  return { clients: rows, created, formToken: token, list, nextCursor, refused, allowed, neverAllowed, swept: sweptNotice(params) };
}

async function page(request: Request, env: McpEnv): Promise<Response> {
  const { token, setCookie } = formToken(request);
  const html = renderAdminClientsPage(await adminView(request, env, token));
  return formPageResponse(html, 200, setCookie ? { 'set-cookie': setCookie } : undefined);
}

/** The redirect URIs typed into the form, or null when any is missing, extra or not on the allowlist. */
export function parseRedirectUris(value: unknown, env: McpEnv): string[] | null {
  if (typeof value !== 'string') return null;
  const uris = [...new Set(value.split(/[\n,]/).map((uri) => uri.trim()).filter(Boolean))];
  if (uris.length === 0 || uris.length > MAX_REDIRECT_URIS) return null;
  const refused = uris.find((uri) => !isAllowedRedirect(uri, env));
  if (refused !== undefined) {
    logRefusedRedirect(refused);
    return null;
  }
  return uris;
}

function seeOther(request: Request, search = ''): Response {
  return new Response(null, { status: 303, headers: { location: new URL(`/admin/clients${search}`, request.url).href } });
}

/** Creates the client, indexes it, and redirects (303) to a one-time view of its secret: a reload re-posts nothing. */
async function create(request: Request, env: McpEnv, form: FormData): Promise<Response> {
  const name = form.get(FIELDS.clientName);
  const clientName = typeof name === 'string' ? name.replace(/\s+/g, ' ').trim() : '';
  if (!clientName || clientName.length > MAX_CLIENT_NAME) {
    return messagePage(400, 'Name the client', `Give the client a name of at most ${MAX_CLIENT_NAME} characters.`);
  }
  const redirectUris = parseRedirectUris(form.get(FIELDS.redirectUris), env);
  if (!redirectUris) {
    return messagePage(400, 'Redirect not allowed', 'Each redirect URI must be one that Harvey, Microsoft or Claude uses.');
  }
  let client: ClientInfo;
  try {
    // tokenEndpointAuthMethod left unset: a confidential client with a secret, accepted by Basic or POST.
    client = await env.OAUTH_PROVIDER.createClient({ clientName, redirectUris });
  } catch (error) {
    console.warn('mcp_admin_create_failed', error instanceof Error ? error.name : 'unknown');
    return messagePage(400, 'Client not created', 'The client details were refused. Check the redirect URIs.');
  }
  try {
    if (!client.clientSecret) throw new TypeError('no secret');
    await env.OAUTH_KV.put(`${STATIC_CLIENT_PREFIX}${client.clientId}`, '1');
    const ref = await sealCreated(env, formToken(request).token, { clientId: client.clientId, clientSecret: client.clientSecret, clientName });
    return seeOther(request, `?${FIELDS.created}=${ref}`);
  } catch (error) {
    // Never leave a client whose secret nobody saw, or one the static list cannot show.
    console.error('mcp_admin_create_failed', error instanceof Error ? error.name : 'unknown');
    await env.OAUTH_PROVIDER.deleteClient(client.clientId);
    await env.OAUTH_KV.delete(`${STATIC_CLIENT_PREFIX}${client.clientId}`);
    return messagePage(500, 'Client not created', 'Something went wrong, so the client was removed. Try again.');
  }
}

function chosenClient(form: FormData): string | null {
  const clientId = form.get(FIELDS.clientId);
  return typeof clientId === 'string' && clientId !== '' && clientId.length <= MAX_CLIENT_ID ? clientId : null;
}

async function remove(request: Request, env: McpEnv, form: FormData): Promise<Response> {
  const clientId = chosenClient(form);
  if (!clientId) return messagePage(400, 'No client chosen', 'Choose a client to delete.');
  await env.OAUTH_PROVIDER.deleteClient(clientId);
  await env.OAUTH_KV.delete(`${STATIC_CLIENT_PREFIX}${clientId}`);
  return seeOther(request);
}

/**
 * Adds allowlisted redirect URIs to a static client this page created (never a dynamic registration, whose
 * metadata its app owns). The list stays within MAX_REDIRECT_URIS.
 */
async function addRedirect(request: Request, env: McpEnv, form: FormData): Promise<Response> {
  const clientId = chosenClient(form);
  if (!clientId || !(await env.OAUTH_KV.get(`${STATIC_CLIENT_PREFIX}${clientId}`))) {
    return messagePage(404, 'Not a static client', 'Redirect URIs can be added only to clients created on this page.');
  }
  const added = parseRedirectUris(form.get(FIELDS.redirectUris), env);
  if (!added) return messagePage(400, 'Redirect not allowed', 'Each redirect URI must be one that Harvey, Microsoft or Claude uses.');
  const client = await env.OAUTH_PROVIDER.lookupClient(clientId);
  if (!client) return messagePage(404, 'Client not found', 'The client no longer exists. Reload the page.');
  const redirectUris = [...new Set([...client.redirectUris, ...added])];
  if (redirectUris.length > MAX_REDIRECT_URIS) {
    return messagePage(400, 'Too many redirect URIs', `A client can have at most ${MAX_REDIRECT_URIS} redirect URIs.`);
  }
  try {
    if (!(await env.OAUTH_PROVIDER.updateClient(clientId, { redirectUris }))) {
      return messagePage(404, 'Client not found', 'The client no longer exists. Reload the page.');
    }
  } catch (error) {
    console.warn('mcp_admin_update_failed', error instanceof Error ? error.name : 'unknown');
    return messagePage(400, 'Redirect not added', 'The redirect URI was refused. Check it and try again.');
  }
  return seeOther(request);
}

/**
 * One bounded pass of the smoke sweep, then All clients with its counts (303), so a reload deletes nothing more.
 * FIELDS.more is set while work is left, so pressing until the note no longer says so clears every old one.
 */
async function sweepSmoke(request: Request, env: McpEnv): Promise<Response> {
  let result: SmokeSweepResult;
  try {
    result = await sweepSmokeClients(env);
  } catch (error) {
    console.error('mcp_admin_smoke_sweep_failed', error instanceof Error ? error.name : 'unknown');
    if (error instanceof SmokeSweepRefused) {
      return messagePage(503, 'Smoke clients not deleted', 'There are too many connections to check them all safely, so nothing was deleted. Use the Delete button on each smoke client instead.');
    }
    return messagePage(500, 'Smoke clients not deleted', 'Something went wrong before the sweep finished. Reload the page and try again.');
  }
  const query = new URLSearchParams({ [FIELDS.list]: LIST_ALL, [FIELDS.swept]: String(result.deleted) });
  if (result.more) query.set(FIELDS.more, '1');
  return seeOther(request, `?${query.toString()}`);
}

const CALLBACK_GONE = 'It is no longer on the list (refused callbacks are kept for 14 days). Reload the page.';

/** Allow, Dismiss or Remove one sign-in callback, then back to the page (303). */
async function callback(request: Request, env: McpEnv, action: unknown, uri: unknown): Promise<Response> {
  if (action === ADMIN_ACTIONS.allowCallback) {
    if (neverAllowedCallback(env, uri)) {
      return messagePage(400, 'Callback not allowed', 'This room is set to "zero retention only", and this app\'s plans keep chats, so allowing the callback would not let it connect. Dismiss it.');
    }
    const result = await allowRefusedRedirect(env, uri);
    if (result === 'missing') return messagePage(404, 'Callback not found', CALLBACK_GONE);
    if (result === 'full') {
      return messagePage(400, 'Too many allowed callbacks', `At most ${MAX_STORED_REDIRECTS} callbacks can be allowed. Remove one first.`);
    }
    return seeOther(request);
  }
  const done = action === ADMIN_ACTIONS.dismissCallback ? await dismissRefusedRedirect(env, uri) : await removeAllowedRedirect(env, uri);
  return done ? seeOther(request) : messagePage(400, 'Callback not found', CALLBACK_GONE);
}

const CALLBACK_ACTIONS: ReadonlySet<unknown> = new Set([ADMIN_ACTIONS.allowCallback, ADMIN_ACTIONS.dismissCallback, ADMIN_ACTIONS.removeCallback]);

async function submit(request: Request, env: McpEnv): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return messagePage(400, 'Form not readable', 'Reload the page and try again.');
  }
  if (!checkForm(request, form)) return messagePage(403, 'Form expired', 'Reload the page and try again.');
  const action = form.get(FIELDS.action);
  if (action === ADMIN_ACTIONS.create) return create(request, env, form);
  if (action === ADMIN_ACTIONS.delete) return remove(request, env, form);
  if (action === ADMIN_ACTIONS.addRedirect) return addRedirect(request, env, form);
  if (action === ADMIN_ACTIONS.sweepSmoke) return sweepSmoke(request, env);
  if (CALLBACK_ACTIONS.has(action)) return callback(request, env, action, form.get(FIELDS.redirectUris));
  return messagePage(400, 'Unknown action', 'Reload the page and try again.');
}

function isOwner(member: Member): boolean {
  return member.role === 'owner';
}

/** /admin/clients for any method: Access, membership and the owner role, then the list or a change. */
export async function handleAdminClients(request: Request, env: McpEnv, deps: GateDeps = {}): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'POST') {
    return new Response(null, { status: 405, headers: { allow: 'GET, POST' } });
  }
  const gate = await requireMember(request, env, deps);
  if ('response' in gate) return gate.response;
  if (!isOwner(gate.member)) return messagePage(403, 'Owner only', 'Only the room owner manages registered clients.');
  return request.method === 'GET' ? page(request, env) : submit(request, env);
}
