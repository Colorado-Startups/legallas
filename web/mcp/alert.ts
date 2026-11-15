// SPDX-License-Identifier: Apache-2.0
// The email to owner@ when a member connects an AI app (owner: session C2), when a sign-in callback is refused, and
// when an app's sign-in fails. It follows worker/signins.ts: the same sender, destination and list headers
// (sendAlertEmail), the ALERTS_ENABLED gate, errors logged by code only. It names who, which app, where the
// tokens go and when; never a file name or case text.
import { DEFAULT_INSTANCE_NAME, roomNamesOf } from '../worker/room-names.ts';
import { isCompanyRoom } from '../worker/room-shape.ts';
import { alertFromName, alertTime, sendAlertEmail } from '../worker/signins.ts';
import { MCP_ORIGIN, REFRESH_TOKEN_TTL_SECONDS, type McpEnv } from './contract.ts';
import type { SignInFailure, SignInStep } from './signin-failure.ts';
import { STORED_NAME } from '../worker/stored-name.ts';

export interface ConnectionAlert {
  email: string;
  clientName: string;
  /** Where the tokens go (the consent page's redirect host). */
  redirectHost: string;
  /** The member also let it propose (Props.propose): it may store proposals for them to approve in the room. */
  propose?: boolean;
}

/** Where a member (or the owner, for everyone) revokes a connection. */
export const CONNECTIONS_URL = `${MCP_ORIGIN}/connections`;
const MAX_FIELD = 120;
const CONNECTION_DAYS = Math.round(REFRESH_TOKEN_TTL_SECONDS / 86_400);

type AlertEnv = Pick<McpEnv, 'EMAIL' | 'ALERTS_ENABLED' | 'INSTANCE_NAME' | 'COMPANY_ROOM_ENABLED' | 'TIME_ZONE'> & Partial<Pick<McpEnv, 'FILES'>>;

/**
 * A client-supplied value made safe for a header and one body line: control and format characters (line breaks,
 * bidi overrides) become spaces, runs collapse, and the result is capped. Client names come from whoever
 * registered the client, so they are never trusted.
 */
function oneLine(value: string): string {
  const flat = value.replace(/[\p{Cc}\p{Cf}\u2028\u2029]+/gu, ' ').replace(/\s+/g, ' ').trim();
  // By code point, so a cut never splits a surrogate pair (an emoji in an app name).
  const chars = Array.from(flat);
  return (chars.length > MAX_FIELD ? `${chars.slice(0, MAX_FIELD).join('')}...` : flat) || 'Unknown';
}

/** The plain-text alert, naming the room by its instance name (worker/room-names.ts). Exported for tests. */
export function connectionEmail(alert: ConnectionAlert, now: Date, instanceName: string = DEFAULT_INSTANCE_NAME, company = false, timeZone?: string): { subject: string; text: string } {
  const email = oneLine(alert.email);
  const app = oneLine(alert.clientName);
  const lines = [
    `An AI app was connected to the ${alertFromName(instanceName, company)}.`,
    '',
    `Who:       ${email}`,
    `App:       ${app}`,
    `Sends to:  ${oneLine(alert.redirectHost)}`,
    `When:      ${alertTime(now, timeZone)}`,
    '',
    alert.propose
      ? `The connection reads and may propose; a proposal changes nothing until the member approves it in the room. It lasts ${CONNECTION_DAYS} days; then the member signs in with a new email code.`
      : `The connection is read-only and lasts ${CONNECTION_DAYS} days; then the member signs in with a new email code.`,
    'If you do not recognize it, revoke it here:',
    CONNECTIONS_URL,
  ];
  return { subject: `${instanceName}: ${email} connected ${app}`, text: `${lines.join('\n')}\n` };
}

/** Sends the alert unless ALERTS_ENABLED is "0"; never throws. `now` is for tests. */
export async function notifyConnected(
  env: AlertEnv,
  alert: ConnectionAlert,
  now: Date = new Date(),
): Promise<void> {
  if (env.ALERTS_ENABLED === '0') return;
  const company = await isCompanyRoom(env);
  let message: { subject: string; text: string };
  try {
    message = connectionEmail(alert, now, roomNamesOf(env).instanceName, company, env.TIME_ZONE);
  } catch {
    // A malformed alert (a missing name, an invalid date) must not break the consent redirect.
    console.error(JSON.stringify({ event: 'mcp.connect_email_failed', code: 'build' }));
    return;
  }
  await sendAlertEmail(env, message, 'mcp.connect_email_failed', company);
}

/** Where the owner allows or dismisses a refused sign-in callback. */
export const ADMIN_CLIENTS_URL = `${MCP_ORIGIN}/admin/clients`;

/** The plain-text email for a refused sign-in callback (one per new host). Exported for tests. */
export function refusedRedirectEmail(uri: string, instanceName: string = DEFAULT_INSTANCE_NAME): { subject: string; text: string } {
  // Shown in full (the owner compares it with the one on /admin/clients); a stored URI is canonical ASCII anyway.
  const callback = uri.replace(/[\p{Cc}\p{Cf}\u2028\u2029\s]+/gu, ' ').trim() || 'Unknown';
  const text =
    `An AI app tried to connect with a sign-in callback that is not on the list: ${callback}. ` +
    `If this is Harvey (or another app you expect), allow it at ${ADMIN_CLIENTS_URL}.\n`;
  return { subject: `${instanceName}: an AI app sign-in callback was refused`, text };
}

/** Sends the refused-callback alert unless ALERTS_ENABLED is "0"; never throws. */
export async function notifyRefusedRedirect(env: AlertEnv, uri: string): Promise<void> {
  if (env.ALERTS_ENABLED === '0') return;
  await sendAlertEmail(env, refusedRedirectEmail(uri, roomNamesOf(env).instanceName), 'mcp.refused_redirect_email_failed', await isCompanyRoom(env));
}

/** Each step in words, and the legallas-mcp log event that carries its detail. */
const SIGNIN_STEPS: Record<SignInStep, { label: string; event: string }> = {
  authorize: { label: 'authorize: the sign-in link from the app', event: 'mcp_authorize_invalid' },
  consent: { label: 'consent: the page that asks to connect the app', event: 'mcp_consent_describe_failed' },
  register: { label: 'register: the app registering itself', event: 'mcp_oauth_error' },
  token: { label: 'token: the app trading its sign-in code for access', event: 'mcp_oauth_error' },
};

/**
 * The plain-text email for a failed sign-in (one per step, code and host a day). It names the step, the OAuth
 * error code, the app's host and the time, never the error description or other client text. Exported for tests.
 */
export function signInFailureEmail(failure: SignInFailure, now: Date, instanceName: string = DEFAULT_INSTANCE_NAME, company = false, timeZone?: string): { subject: string; text: string } {
  const step = SIGNIN_STEPS[failure.where] ?? { label: failure.where, event: 'mcp_oauth_error' };
  const lines = [
    `An AI app's sign-in to the ${alertFromName(instanceName, company)} failed. If ${company ? 'someone' : 'a lawyer'} was connecting, they saw an error.`,
    '',
    `Where:     ${oneLine(step.label)}`,
    `Error:     ${oneLine(failure.code)}`,
    `App host:  ${oneLine(failure.host)}`,
    `When:      ${alertTime(now, timeZone)}`,
    '',
    `Look at ${STORED_NAME}-mcp logs for ${step.event} at that time.`,
    `Apps and callbacks: ${ADMIN_CLIENTS_URL}`,
  ];
  return { subject: `${instanceName}: an AI app sign-in failed`, text: `${lines.join('\n')}\n` };
}

/** Sends the failed-sign-in alert unless ALERTS_ENABLED is "0"; never throws. `now` is for tests. */
export async function notifySignInFailure(env: AlertEnv, failure: SignInFailure, now: Date = new Date()): Promise<void> {
  if (env.ALERTS_ENABLED === '0') return;
  const company = await isCompanyRoom(env);
  let message: { subject: string; text: string };
  try {
    message = signInFailureEmail(failure, now, roomNamesOf(env).instanceName, company, env.TIME_ZONE);
  } catch {
    console.error(JSON.stringify({ event: 'mcp.signin_failure_email_failed', code: 'build' }));
    return;
  }
  await sendAlertEmail(env, message, 'mcp.signin_failure_email_failed', company);
}
