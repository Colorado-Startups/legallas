// SPDX-License-Identifier: Apache-2.0
// A lawyer's first connection that fails anywhere in the OAuth flow emails the owner the same day, once per step,
// error code and app host per 24 hours, with separate daily caps for member-gated and open steps. /authorize and the consent page report through GateDeps.onSignInFailure
// (authorize.ts); /token and /register through mcp/oauth-request.ts. An off-list callback has its own email
// (redirects.ts recordRefusedRedirect), so it is not reported here again.
//
// Only the step, the OAuth error code and the app's host are kept, logged or emailed: never an error description,
// a token, a code or any other client-supplied text.
import { notifySignInFailure } from './alert.ts';
import type { McpEnv } from './contract.ts';
import { isReservedTestHost } from './redirects.ts';
import { STORED_NAME } from '../worker/stored-name.ts';

/** Where in the flow the sign-in failed. */
export type SignInStep = 'authorize' | 'consent' | 'register' | 'token';

export interface SignInFailure {
  where: SignInStep;
  /** The OAuth error code (`invalid_grant`), or the library's reason or error name when there is no code. */
  code: string;
  /** The app's host: its callback's, else its metadata document's (failureHost). */
  host: string;
  /** /token only: the request's grant_type. Only authorization_code is a sign-in. */
  grantType?: string;
}

export type SignInFailureEnv = Pick<McpEnv, 'OAUTH_KV' | 'EMAIL' | 'ALERTS_ENABLED'>;

/**
 * Who can cause a failure: only a signed-in member reaches /authorize and the consent page; anyone can post to
 * /token and /register. Each group has its own cap, so bogus /token posts cannot use up the alerts a lawyer's
 * failed sign-in needs.
 */
export type SignInGroup = 'member' | 'public';

/** KV keys (OAUTH_KV) that remember an emailed failure: `${prefix}${group}:${where}:${code}:${host}`. */
export const SIGNIN_FAILURE_PREFIX = `${STORED_NAME}-admin:signin-failure:`;
/** The same step, code and host emails again after this long. */
export const SIGNIN_FAILURE_TTL_SECONDS = 86_400;
/** At most this many failures of each group email per 24 hours, so a scanner varying hosts cannot flood the inbox. */
export const MAX_SIGNIN_FAILURES_PER_GROUP = 10;
/** The library's reason on a Client ID Metadata Document that could not be fetched or checked (CimdFetchError). */
export const METADATA_RESOLUTION_FAILED = 'metadata_resolution_failed';

const CODE = /^[A-Za-z0-9_.-]{1,64}$/;
/** What URL parsing leaves in a hostname (ASCII, punycode, IPv6 brackets), at DNS length. */
const HOST = /^[a-z0-9._[\]:-]{1,253}$/;

function hostOf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    return new URL(value).hostname || null;
  } catch {
    return null;
  }
}

/**
 * The host to report: the redirect URI's, else an https client_id's (a Client ID Metadata Document client, such as
 * Claude), else "unknown". An opaque registered client_id names no host.
 */
export function failureHost(redirectUri: unknown, clientId: unknown): string {
  const cimd = typeof clientId === 'string' && clientId.startsWith('https://') ? hostOf(clientId) : null;
  return hostOf(redirectUri) ?? cimd ?? 'unknown';
}

/** A thrown error's code: its OAuth `code`, the library's metadata-resolution reason, else its name. */
export function failureCode(error: unknown): string {
  const fields = (error ?? {}) as { code?: unknown; reason?: unknown };
  if (typeof fields.code === 'string') return fields.code;
  if (fields.reason === METADATA_RESOLUTION_FAILED) return METADATA_RESOLUTION_FAILED;
  return error instanceof Error ? error.name : 'unknown';
}

/**
 * Why a failure is not reported, or null to report it: /token other than an authorization code (a refresh or a
 * revocation is no sign-in), and hosts reserved for tests (the smoke's `.invalid` callbacks).
 */
export function skipReason(failure: Pick<SignInFailure, 'where' | 'host' | 'grantType'>): string | null {
  if (failure.where === 'token' && failure.grantType !== 'authorization_code') return 'grant_type';
  if (isReservedTestHost(failure.host)) return 'test_host';
  return null;
}

/** The failure with its code and host reduced to safe slugs, for the KV key, the log and the email. */
function normalized(failure: SignInFailure): SignInFailure {
  const host = failure.host.toLowerCase();
  return { ...failure, code: CODE.test(failure.code) ? failure.code : 'unknown', host: HOST.test(host) ? host : 'unknown' };
}

/** A step's group: member-gated (authorize, consent) or open to anyone (token, register). */
export function signInGroup(where: SignInStep): SignInGroup {
  return where === 'authorize' || where === 'consent' ? 'member' : 'public';
}

/**
 * Emails the owner about a failed sign-in, once per step, code and host per 24 hours, and at most 10 a day for each
 * group (signInGroup). Never throws: a KV or email failure logs a code only.
 */
export async function recordSignInFailure(env: SignInFailureEnv, failure: SignInFailure, now: Date = new Date()): Promise<void> {
  const reason = skipReason(failure);
  if (reason) {
    console.warn('mcp_signin_failure_skipped', reason);
    return;
  }
  try {
    const f = normalized(failure);
    const group = `${SIGNIN_FAILURE_PREFIX}${signInGroup(f.where)}:`;
    const key = `${group}${f.where}:${f.code}:${f.host}`;
    if ((await env.OAUTH_KV.get(key)) !== null) return;
    const live = await env.OAUTH_KV.list({ prefix: group, limit: MAX_SIGNIN_FAILURES_PER_GROUP });
    if (live.keys.length >= MAX_SIGNIN_FAILURES_PER_GROUP) {
      console.warn('mcp_signin_failure_skipped', 'full', signInGroup(f.where));
      return;
    }
    await env.OAUTH_KV.put(key, '1', { expirationTtl: SIGNIN_FAILURE_TTL_SECONDS });
    console.warn('mcp_signin_failure', f.where, f.code, f.host);
    await notifySignInFailure(env, f, now);
  } catch (error) {
    console.error('mcp_signin_failure_record_failed', error instanceof Error ? error.name : 'unknown');
  }
}
