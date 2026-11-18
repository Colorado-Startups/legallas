// SPDX-License-Identifier: Apache-2.0
// /authorize: the consent step of the OAuth flow. Access proves who the person is (the email code), the members
// table, or with ROOMS_ENABLED an investor's room invitation (worker/rooms.ts findAiGuest), decides whether they may
// connect, and the OAuth library binds the consent form to this browser. GET shows what is asking and where the
// tokens go; POST approves or declines, then records the connection.
import type { JWTVerifyGetKey } from 'jose';
import type { AuthRequest, ConsentDescription } from '@cloudflare/workers-oauth-provider';
import { canPerform, findMember, ROOM_READER, verifyAccessIdentity } from '../worker/auth.ts';
import type { Member } from '../worker/env.ts';
import { tickedCurrent } from '../worker/full-notice.ts';
import { enrollUrl, lacksSecondFactor } from '../worker/mfa.ts';
import { proposalsEnabled } from '../worker/proposals.ts';
import { publicRecordsEnabled } from '../worker/public-records.ts';
import { findAiGuest, markJoined } from '../worker/rooms.ts';
import { notifyConnected } from './alert.ts';
import { aiAudit } from './audit.ts';
import { findConsentDone, rememberConsentDone, type Sleep } from './consent-repeat.ts';
import { DECISIONS, FIELDS, NOTICE_FIRST, SCOPE_READ, userIdFor, type GrantMetadata, type McpEnv, type Props } from './contract.ts';
import { CONTACT } from './pages/html.ts';
import { htmlResponse, renderConsent, renderMessage } from './pages/index.ts';
import { isAllowedRedirect, isUnsupportedAiUri, logRefusedRedirect, redirectHost } from './redirects.ts';
import { retentionRefusal, zeroRetentionOnly } from './retention.ts';
import { convertedAt } from './conversion.ts';
import { resolveClientKind } from './server.ts';
import { failureCode, failureHost, type SignInFailure } from './signin-failure.ts';
import { ownerFullName, ownerName, ownerTitled } from '../worker/room-settings.ts';

/** The longest app name kept for audit_log.via, alerts and props; self-registered names are untrusted. */
const MAX_APP_NAME = 80;

/** Injected for tests: the Access public key lookup (worker/auth.ts) and the audit writer (audit.ts aiAudit). */
export interface GateDeps {
  getKey?: JWTVerifyGetKey;
  audit?: typeof aiAudit;
  /**
   * Called with a redirect URI refused at registration or on the consent page, so the owner can allow it.
   * mcp/index.ts hands it to recordRefusedRedirect (mcp/redirects.ts) under waitUntil; it must not throw or block.
   */
  onRefusedRedirect?(uri: string): void;
  /**
   * Called when a sign-in fails on /authorize (the library refused the request) or on the consent page (the app's
   * details could not be checked). mcp/index.ts hands it to recordSignInFailure (mcp/signin-failure.ts) under
   * waitUntil; it must not throw or block.
   */
  onSignInFailure?(failure: SignInFailure): void;
  /** Keeps work alive after the response (ctx.waitUntil, from mcp/index.ts): the connected-app email. */
  waitUntil?(promise: Promise<unknown>): void;
  /** The pause between looks for a first Connect click's redirect (mcp/consent-repeat.ts); tests make it instant. */
  sleep?: Sleep;
}

/** Hands a failure to deps.onSignInFailure; a throwing hook is logged by error name and never changes the page. */
function reportFailure(deps: GateDeps, failure: SignInFailure): void {
  try {
    deps.onSignInFailure?.(failure);
  } catch (error) {
    console.error('mcp_signin_failure_report_failed', error instanceof Error ? error.name : 'unknown');
  }
}

/** An HTML page with a message, for refusals and errors, and optional links to next steps. */
export function messagePage(status: number, title: string, message: string, links?: readonly { href: string; label: string }[]): Response {
  return htmlResponse(renderMessage({ title, message, status, ...(links ? { links } : {}) }), status);
}

/**
 * REQUIRE_MFA refused this sign-in (worker/mfa.ts): how to add a second factor, then sign out of this Access session,
 * which stays without one until it ends. The links are Cloudflare's enrollment page and this host's Access logout.
 */
function secondStepNeeded(env: McpEnv): Response {
  const enroll = enrollUrl(env.TEAM_DOMAIN);
  const links = [...(enroll ? [{ href: enroll, label: 'Add a sign-in step' }] : []), { href: '/cdn-cgi/access/logout', label: 'Sign out' }];
  return messagePage(
    403,
    'Add a second sign-in step',
    'The counsel room asks for a security key, Touch ID, Face ID or Windows Hello as well as the emailed code. A code from an authenticator app is not enough here. Add one, sign out, then go back to your AI app and choose Connect again.',
    links,
  );
}

/**
 * The member behind an Access-gated request, or the 403 page to send. Fails closed: no valid Access token for
 * ACCESS_AUD (or, on localhost only, the dev identity), no second factor while REQUIRE_MFA is "1" (code
 * second_factor), an email containing ':' (code bad_identity), or no members row, and the request goes no further:
 * no consent handle is touched.
 */
export async function requireMember(request: Request, env: McpEnv, deps: GateDeps = {}): Promise<{ member: Member } | { response: Response }> {
  return gate(request, env, deps, null);
}

/**
 * requireMember for /authorize only, where a room guest may connect too: an email with no members row and an active
 * invitation whose role may connect (worker/rooms.ts findAiGuest) passes as ROOM_READER. Connecting is a use of the
 * invitation (markJoined), as a first visit to the room is. Guests tick no notice, as in the room.
 */
export async function requireConnector(request: Request, env: McpEnv, deps: GateDeps = {}, now: Date = new Date()): Promise<{ member: Member } | { response: Response }> {
  return gate(request, env, deps, now);
}

async function gate(request: Request, env: McpEnv, deps: GateDeps, guestsAt: Date | null): Promise<{ member: Member } | { response: Response }> {
  const identity = await verifyAccessIdentity(request, env, deps.getKey);
  if (!identity) {
    return { response: messagePage(403, 'Sign in first', 'Open this page from your AI app so the counsel room can send you an email code.') };
  }
  if (lacksSecondFactor(identity, env)) {
    console.warn('mcp_access_refused', 'second_factor');
    return { response: secondStepNeeded(env) };
  }
  // userIdFor(email) must never contain ':', the library's token separator; normalizeEmail would allow it.
  if (identity.email.includes(':')) {
    console.warn('mcp_access_refused', 'bad_identity');
    return { response: messagePage(403, 'No access', 'This email address cannot be used to connect an AI app.') };
  }
  const member = await findMember(env.DB, identity.email);
  if (!member) {
    const guest = guestsAt ? await findAiGuest(env, identity.email, guestsAt) : null;
    if (guest && guestsAt) {
      await markJoined(env.DB, guest, guestsAt);
      return { member: { email: guest.email, role: ROOM_READER, name: null } };
    }
    return { response: messagePage(403, 'No access', `You signed in as ${identity.email}, which is not a member of the counsel room. Ask ${ownerTitled} to add it.`) };
  }
  if (!(await tickedCurrent(env.DB, member.email))) return { response: messagePage(403, 'Read the notice first', NOTICE_FIRST) };
  if (!canPerform(member.role, 'connect')) {
    return { response: messagePage(403, 'No access', 'Your access to the room does not include AI apps. Ask the room owner.') };
  }
  return { member };
}

/** The name an app goes by in the activity feed and alerts: a CIMD client's verified domain, else its name. */
export function appName(details: Pick<ConsentDescription, 'clientName' | 'clientDomain'>): string {
  const raw = details.clientDomain ?? details.clientName ?? '';
  const clean = raw.replace(/[\p{Cc}\p{Cf}]/gu, '').replace(/\s+/g, ' ').trim();
  // By code point, so the cut never splits a surrogate pair.
  return Array.from(clean).slice(0, MAX_APP_NAME).join('') || 'Unknown app';
}

/** The fields of a library AuthorizationError this file reads (duck-typed: the class is a runtime import). */
interface AuthorizationErrorLike {
  code?: unknown;
  redirectUri?: unknown;
  redirectTo?: unknown;
}

/**
 * parseAuthRequest failed. When the library validated the redirect and it is on our list, the client gets the
 * standard error redirect; otherwise the browser gets a page and nothing goes to the redirect URI. Either way a
 * member's sign-in failed (the gate ran first), so it is logged and reported with the host the request names.
 */
function authorizeFailure(error: unknown, request: Request, env: McpEnv, deps: GateDeps): Response {
  const failure = (error ?? {}) as AuthorizationErrorLike;
  const code = failureCode(error);
  const query = new URL(request.url).searchParams;
  console.warn('mcp_authorize_invalid', code);
  reportFailure(deps, { where: 'authorize', code, host: failureHost(query.get('redirect_uri'), query.get('client_id')) });
  if (typeof failure.redirectTo === 'string' && typeof failure.redirectUri === 'string') {
    if (isAllowedRedirect(failure.redirectUri, env)) return Response.redirect(failure.redirectTo, 302);
    logRefusedRedirect(failure.redirectUri);
  }
  return messagePage(400, 'This link cannot be used', `Go back to your AI app and choose Connect again. If this page comes back, tell ${ownerFullName} (${CONTACT}).`);
}

/** The consent handle is used, older than 10 minutes, or from another browser: the library cannot tell which. */
const expired = () =>
  messagePage(400, 'This page has expired', 'A sign-in page works once, for 10 minutes, in the browser that opened it. Go back to your AI app and choose Connect again.');
/** describeConsent failed (Claude's client details, for example, could not be fetched). */
const unchecked = () => messagePage(502, 'App details unavailable', 'The counsel room could not check the app. Wait a minute, then go back to your AI app and choose Connect again.');

/**
 * The page for a redirect URI off the allowlist. `capture` (the consent page only) keeps the URI for the owner: a
 * Client ID Metadata Document or static client never passes /register, so this is where its new callback is seen.
 * The approve and decline re-checks pass none, since there the URI left the list after the page was shown.
 */
function refusedRedirect(uri: string, capture?: (uri: string) => void): Response {
  logRefusedRedirect(uri);
  if (isUnsupportedAiUri(uri)) {
    return messagePage(400, 'App not allowed', 'ChatGPT, Gemini and Grok can\'t connect to the counsel room, and the owner can\'t allow them. Connect with Claude, Microsoft Copilot or Harvey instead.');
  }
  try {
    capture?.(uri);
  } catch (error) {
    console.error('mcp_redirect_capture_failed', error instanceof Error ? error.name : 'unknown');
  }
  return messagePage(
    400,
    'App not allowed',
    `Only Harvey, Microsoft Copilot and Claude (claude.ai and the Claude apps) can connect to the counsel room. For Claude Code or another app, ask ${ownerFullName} (${CONTACT}). If this is one of those three, its sign-in callback is new to the room and nothing was sent to it: ask ${ownerName} to allow it, then connect again.`,
  );
}

/** The app's details for the consent page, or null (reported as a consent failure) when they cannot be checked. */
async function describe(env: McpEnv, authRequest: AuthRequest, deps: GateDeps): Promise<ConsentDescription | null> {
  try {
    return await env.OAUTH_PROVIDER.describeConsent(authRequest);
  } catch (error) {
    console.warn('mcp_consent_describe_failed', error instanceof Error ? error.name : 'unknown');
    reportFailure(deps, { where: 'consent', code: failureCode(error), host: failureHost(authRequest.redirectUri, authRequest.clientId) });
    return null;
  }
}

/** A zero-retention room's refusal for this app (mcp/retention.ts), or null. Looks the app up only in such a room. */
async function refusedByRetention(env: McpEnv, clientId: string, email: string): Promise<Response | null> {
  if (!zeroRetentionOnly(env)) return null;
  const reason = retentionRefusal(env, await resolveClientKind(env, clientId), clientId, email);
  return reason ? messagePage(403, 'Zero retention only', reason) : null;
}

/** GET /authorize: the consent page, bound to this browser by the library's transaction headers. */
export async function showConsent(request: Request, env: McpEnv, member: Member, deps: GateDeps = {}): Promise<Response> {
  // Before the library reads anything: a client ID on an unsupported AI's host is a metadata document it would fetch.
  const asked = new URL(request.url).searchParams;
  const unsupported = [asked.get('redirect_uri'), asked.get('client_id')].find(isUnsupportedAiUri);
  if (unsupported) return refusedRedirect(unsupported);
  let authRequest: AuthRequest;
  try {
    authRequest = await env.OAUTH_PROVIDER.parseAuthRequest(request);
  } catch (error) {
    return authorizeFailure(error, request, env, deps);
  }
  if (!isAllowedRedirect(authRequest.redirectUri, env)) return refusedRedirect(authRequest.redirectUri, deps.onRefusedRedirect);
  const details = await describe(env, authRequest, deps);
  if (!details) return unchecked();
  const refused = await refusedByRetention(env, authRequest.clientId, member.email);
  if (refused) return refused;
  const consent = await env.OAUTH_PROVIDER.beginConsent(authRequest);
  const html = renderConsent({
    memberEmail: member.email,
    clientName: appName(details),
    clientDomain: details.clientDomain,
    redirectHost: details.redirectHost,
    redirectIsLoopback: details.redirectIsLoopback,
    // The same lookup every tool call makes, so the page promises files only to an app the server sends them to.
    clientKind: await resolveClientKind(env, authRequest.clientId),
    handle: consent.handle,
    ...(mayPropose(env, member) ? { offerPropose: true, proposes: proposeKinds(env) } : {}),
  });
  return htmlResponse(html, 200, consent.headers);
}

async function decline(request: Request, env: McpEnv, handle: string): Promise<Response> {
  try {
    const denied = await env.OAUTH_PROVIDER.denyConsent(request, handle);
    // Checked again, like approve: the list may have changed since the page was shown.
    if (!isAllowedRedirect(denied.request.redirectUri, env)) return refusedRedirect(denied.request.redirectUri);
    return new Response(null, { status: 302, headers: denied.headers });
  } catch {
    return expired();
  }
}

/**
 * Writes ai_connect before any grant exists. Fails closed (C1): when the row cannot be written, the caller shows
 * an error page and grants nothing, so every connection is in the activity log.
 */
async function auditConnection(request: Request, env: McpEnv, member: Member, clientName: string, audit: typeof aiAudit): Promise<boolean> {
  try {
    await audit(env, { email: member.email, action: 'ai_connect', documentId: null, via: clientName, request });
    return true;
  } catch (error) {
    console.error('mcp_connect_audit_failed', error instanceof Error ? error.name : 'unknown');
    return false;
  }
}

/**
 * The consent was already used: when it was this member's Connect click in this browser within 120 seconds (the
 * browser cancelled the first request and posted again), the same redirect, whose code is still unexchanged.
 */
async function repeatedConnect(request: Request, env: McpEnv, member: Member, handle: string, deps: GateDeps): Promise<Response> {
  const done = await findConsentDone(env.OAUTH_KV, request, handle, member.email, deps.sleep);
  if (!done) return expired();
  console.warn('mcp_consent_repeat', redirectHost(done.redirectTo));
  const headers = new Headers({ location: done.redirectTo, 'cache-control': 'no-store' });
  headers.append('set-cookie', `${done.cookieName}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`);
  return new Response(null, { status: 302, headers });
}

/** The connected-app email, never in the redirect's way: under deps.waitUntil when given (mcp/index.ts). */
function sendConnected(env: McpEnv, deps: GateDeps, alert: Parameters<typeof notifyConnected>[1]): Promise<void> {
  const sent = notifyConnected(env, alert);
  if (!deps.waitUntil) return sent;
  deps.waitUntil(sent);
  return Promise.resolve();
}

type Approved = Awaited<ReturnType<McpEnv['OAUTH_PROVIDER']['approveConsent']>>;

/**
 * Whether the consent page offers, and the grant may carry, the propose consent: a room setting that lists a tool needing
 * it (PROPOSALS_ENABLED for drafts, PUBLIC_RECORDS for public-records checks) and the role.
 */
function mayPropose(env: McpEnv, member: Member): boolean {
  return (proposalsEnabled(env) || publicRecordsEnabled(env)) && canPerform(member.role, 'propose');
}

/** What the propose consent covers in this room, so the box names exactly that. */
function proposeKinds(env: McpEnv): { drafts: boolean; records: boolean } {
  return { drafts: proposalsEnabled(env), records: publicRecordsEnabled(env) };
}

async function approve(request: Request, env: McpEnv, member: Member, handle: string, now: Date, deps: GateDeps, propose = false): Promise<Response> {
  let approved: Approved;
  try {
    approved = await env.OAUTH_PROVIDER.approveConsent(request, handle, { scope: [SCOPE_READ] });
  } catch {
    return repeatedConnect(request, env, member, handle, deps);
  }
  // The consent is used up now, so the rest must finish even when the browser drops this request (a second click
  // cancels it): under waitUntil, the grant and the redirect a repeat click picks up still get made.
  const work = finishApproval(request, env, member, handle, approved, now, deps, propose);
  deps.waitUntil?.(work);
  return await work;
}

/** After approveConsent: re-check, describe, audit, grant, keep the redirect for a repeat click, then redirect. */
async function finishApproval(request: Request, env: McpEnv, member: Member, handle: string, approved: Approved, now: Date, deps: GateDeps, propose: boolean): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER;
  const authRequest = approved.request;
  // Checked again: the list may have changed since the page was shown.
  if (!isAllowedRedirect(authRequest.redirectUri, env)) return refusedRedirect(authRequest.redirectUri);
  const details = await describe(env, authRequest, deps);
  if (!details) return unchecked();
  // Checked again, like the redirect: the setting may have changed since the page was shown.
  const refused = await refusedByRetention(env, authRequest.clientId, member.email);
  if (refused) return refused;
  const clientName = appName(details);
  // The propose consent only when the member ticked it and the room and role allow it now; otherwise the props are
  // exactly what they were before proposals existed.
  const props: Props = {
    email: member.email,
    role: member.role,
    clientId: authRequest.clientId,
    clientName,
    ...(propose && mayPropose(env, member) ? { propose: true as const } : {}),
    // After a conversion, this approval is the person's re-approval (mcp/conversion.ts); before one, props are as they were.
    ...((await convertedAt(env.DB)) === null ? {} : { reapprovedAt: now.toISOString() }),
  };
  const metadata: GrantMetadata = { clientName, approvedAt: now.toISOString() };
  if (!(await auditConnection(request, env, member, clientName, deps.audit ?? aiAudit))) {
    return messagePage(503, 'Connection not made', 'The counsel room could not record this connection, so it was not made. Wait a minute, then go back to your AI app and choose Connect again.');
  }
  const { redirectTo } = await oauth.completeAuthorization({
    request: authRequest,
    userId: userIdFor(member.email),
    scope: authRequest.scope,
    props,
    metadata,
    revokeExistingGrants: true,
  });
  await rememberConsentDone(env.OAUTH_KV, handle, { email: member.email, redirectTo });
  await sendConnected(env, deps, { email: member.email, clientName, redirectHost: redirectHost(authRequest.redirectUri), propose: props.propose === true });
  approved.headers.set('location', redirectTo);
  return new Response(null, { status: 302, headers: approved.headers });
}

/** POST /authorize: approve or decline the consent the browser was shown. */
export async function submitConsent(request: Request, env: McpEnv, member: Member, deps: GateDeps = {}, now: Date = new Date()): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return expired();
  }
  const handle = form.get(FIELDS.handle);
  if (typeof handle !== 'string' || handle === '') return expired();
  // Anything but DECISIONS.approve declines (fail closed).
  if (form.get(FIELDS.decision) !== DECISIONS.approve) return decline(request, env, handle);
  return approve(request, env, member, handle, now, deps, form.get(FIELDS.propose) === '1');
}

/** /authorize for any method: the Access gate for members and room guests, then the consent page or its answer. */
export async function handleAuthorize(request: Request, env: McpEnv, deps: GateDeps = {}): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'POST') {
    return new Response(null, { status: 405, headers: { allow: 'GET, POST' } });
  }
  const passed = await requireConnector(request, env, deps);
  if ('response' in passed) return passed.response;
  return request.method === 'GET' ? showConsent(request, env, passed.member, deps) : submitConsent(request, env, passed.member, deps);
}
