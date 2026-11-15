// SPDX-License-Identifier: Apache-2.0
// Sign-in alerts (Access hardening item 6): the owner gets an email on every new Access session of another
// member, so a stolen account shows up in their inbox. Their own sign-ins alert only from a browser, system
// and country they have not used in the last 30 days, or from a browser that cannot be named.
//
// A new session is a never-before-seen (sub, iat) pair from the verified Access token. Access sends the
// same token on every request until the session ends, so only the first request after a login carries a
// new iat. The first page load fires many requests at once; INSERT OR IGNORE on the unique session key
// lets exactly one of them insert, and only that one sends the email.
//
// The email carries no document data: who, when, country and browser, plus a link to /activity/.
import { clientInfo } from './audit.ts';
import { findMember, type AccessIdentity } from './auth.ts';
import { htmlEmail, textToHtml, type Signature } from './email-signature.ts';
import type { Env } from './env.ts';
import { roomSignature } from './extensions.ts';
import { DEFAULT_INSTANCE_NAME, roomNamesOf, type RoomNameVars } from './room-names.ts';
import { summarizeUserAgent } from './user-agent.ts';
import { alertFrom, alertTo, roomHost, sentence } from './room-settings.ts';
import { isCompanyRoom } from './room-shape.ts';
import { STORED_NAME } from './stored-name.ts';

/** What a sign-in record reads from the identity: never whether it had a second factor. */
type SignInIdentity = Pick<AccessIdentity, 'email' | 'sub' | 'iat' | 'country'>;

/** Must match the send_email binding in wrangler.jsonc (config.test.ts checks this). */
export const ALERT_TO = alertTo;
export const ALERT_FROM = alertFrom;
/** How alerts name the room: the instance name (room-names.ts), "Legallas counsel room" by default, "Legallas room" with no matter (room-shape.ts). */
export function alertFromName(instanceName: string = DEFAULT_INSTANCE_NAME, company = false): string {
  return `${instanceName} ${company ? '' : 'counsel '}room`;
}

/**
 * On every automatic alert (sign-in, connected app, refused callback), so mail filters can find them: RFC 3834
 * marks the message machine-sent, RFC 2919 names the list. Both are on Email Service's header allowlist.
 * Hand-sent invites never carry them.
 */
export const ALERT_HEADERS: Readonly<Record<string, string>> = {
  'Auto-Submitted': 'auto-generated',
  'List-Id': `${sentence(STORED_NAME)} alerts <alerts.${roomHost}>`,
};

/**
 * The assistant's sign-off, which sendAlertEmail adds to both parts of every alert: the one the room's Worker entries
 * registered (extensions.ts), else the neutral one for the room's names (email-signature.ts).
 */
export function alertSignature(env: Pick<RoomNameVars, 'INSTANCE_NAME' | 'ASSISTANT_NAME'>): Signature {
  return roomSignature(roomNamesOf(env));
}

/** The owner's sign-in from a browser, system and country seen within this many days sends no email. */
export const OWNER_FAMILIAR_DAYS = 30;
// summarizeUserAgent's wording when it cannot name the browser ("A browser on macOS" names only the system).
const UNNAMED_BROWSER = /^(Unknown browser|A browser on )/;

type SignInEnv = Pick<Env, 'DB' | 'EMAIL' | 'ALERTS_ENABLED' | 'INSTANCE_NAME' | 'ASSISTANT_NAME' | 'COMPANY_ROOM_ENABLED' | 'TIME_ZONE'> & Partial<Pick<Env, 'FILES'>>;

export interface SignIn {
  email: string;
  /** Seconds since the epoch, from the token. */
  iat: number;
  country: string | null;
  userAgent: string | null;
}

// Sessions this isolate already recorded, so later requests in a session skip the database. Keyed by
// the D1 binding so separate databases (and tests) never share entries. Correctness never depends on
// it: a miss only costs one ignored insert.
const seen = new WeakMap<D1Database, Set<string>>();
const MAX_SEEN = 1000;

function remember(db: D1Database, key: string): void {
  let keys = seen.get(db);
  if (!keys) seen.set(db, (keys = new Set()));
  if (keys.size >= MAX_SEEN) keys.clear();
  keys.add(key);
}

/** The zone for an alert's local time when the room's TIME_ZONE is unset or not a zone Intl knows. */
export const DEFAULT_TIME_ZONE = 'America/Denver';

const LOCAL_TIME: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
};

/**
 * "2026-07-04 18:30 UTC (Jul 4, 2026, 12:30 PM MDT)": the time line every alert uses, its local part in the room's
 * TIME_ZONE (an IANA name). A name Intl rejects reads in DEFAULT_TIME_ZONE, so a typo never loses the alert.
 */
export function alertTime(when: Date, timeZone: string = DEFAULT_TIME_ZONE): string {
  let local: string;
  try {
    local = when.toLocaleString('en-US', { ...LOCAL_TIME, timeZone });
  } catch {
    local = when.toLocaleString('en-US', { ...LOCAL_TIME, timeZone: DEFAULT_TIME_ZONE });
  }
  return `${when.toISOString().slice(0, 16).replace('T', ' ')} UTC (${local})`;
}

/** The plain-text alert, naming the room by its instance name (room-names.ts). Exported for tests. */
export function signInEmail(signIn: SignIn, activityUrl: string, instanceName: string = DEFAULT_INSTANCE_NAME, company = false, timeZone?: string): { subject: string; text: string } {
  const lines = [
    `New sign-in to the ${alertFromName(instanceName, company)}.`,
    '',
    `Who:      ${signIn.email}`,
    `When:     ${alertTime(new Date(signIn.iat * 1000), timeZone)}`,
    `Country:  ${signIn.country ?? 'Unknown'}`,
    `Browser:  ${summarizeUserAgent(signIn.userAgent)}`,
    '',
    'If you do not recognize this sign-in, remove the member, revoke their Access sessions,',
    'and check what they did:',
    activityUrl,
  ];
  // The email is a verified, normalized address (no spaces or line breaks), so it is safe in a header.
  return { subject: `${instanceName}: new sign-in by ${signIn.email}`, text: `${lines.join('\n')}\n` };
}

function errorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : 'unknown';
}

/**
 * Sends one alert from room@ to owner@ with ALERT_HEADERS: the plain text ending in the text signature
 * (alertSignature), and the same text, escaped, as an HTML part ending in the HTML signature. It is the only
 * code that sends email (signed-senders.test.ts checks), so every Worker email is signed. Never throws: a failure logs
 * `failureEvent` and the error code only (E_SENDER_NOT_VERIFIED and so on), because messages can repeat
 * addresses. Email Service refuses a whole message over one header it does not accept (E_HEADER_*), so that
 * failure is logged and the alert goes again without the headers: a filter label is never worth a lost alert.
 * Callers check ALERTS_ENABLED first. legallas-mcp's connection and refused-callback alerts use it too. The From
 * name follows the room's INSTANCE_NAME (alertFromName).
 */
export async function sendAlertEmail(
  env: { EMAIL: SendEmail } & Pick<RoomNameVars, 'INSTANCE_NAME' | 'ASSISTANT_NAME'>,
  message: { subject: string; text: string },
  failureEvent: string,
  company = false,
): Promise<void> {
  const signature = alertSignature(env);
  const signed = { subject: message.subject, text: `${message.text}${signature.text}`, html: htmlEmail(textToHtml(message.text), signature.html) };
  const name = alertFromName(roomNamesOf(env).instanceName, company);
  const send = (headers?: Record<string, string>) =>
    env.EMAIL.send({ to: ALERT_TO, from: { email: ALERT_FROM, name }, ...signed, ...(headers && { headers }) });
  try {
    await send({ ...ALERT_HEADERS });
    return;
  } catch (error) {
    const code = errorCode(error);
    if (!code.startsWith('E_HEADER')) {
      console.error(JSON.stringify({ event: failureEvent, code }));
      return;
    }
    console.error(JSON.stringify({ event: failureEvent, code, retry: 'without_headers' }));
  }
  try {
    await send();
  } catch (error) {
    console.error(JSON.stringify({ event: failureEvent, code: errorCode(error) }));
  }
}

/**
 * True when this is the owner's sign-in from a named browser on the same system, in the same country, as one of
 * the owner's other sessions issued in the last OWNER_FAMILIAR_DAYS: the owner's routine sign-in, which sends no
 * email. Any other member, a first or unfamiliar combination, or a browser that cannot be named returns false.
 */
async function isFamiliarOwnerSignIn(db: D1Database, signIn: SignIn, rowId: number): Promise<boolean> {
  const browser = summarizeUserAgent(signIn.userAgent);
  if (UNNAMED_BROWSER.test(browser)) return false;
  if ((await findMember(db, signIn.email))?.role !== 'owner') return false;
  const since = signIn.iat - OWNER_FAMILIAR_DAYS * 86_400;
  const { results } = await db
    .prepare('SELECT DISTINCT user_agent, country FROM sign_ins WHERE email = ?1 AND id <> ?2 AND iat >= ?3')
    .bind(signIn.email, rowId, since)
    .all<{ user_agent: string | null; country: string | null }>();
  return results.some((row) => row.country === signIn.country && summarizeUserAgent(row.user_agent) === browser);
}

async function sendAlert(env: SignInEnv, signIn: SignIn, rowId: number, activityUrl: string): Promise<void> {
  let familiar = false;
  try {
    familiar = await isFamiliarOwnerSignIn(env.DB, signIn, rowId);
  } catch (error) {
    // The check only ever removes an email, so when it fails the alert goes.
    console.error(JSON.stringify({ event: 'signin.history_failed', code: error instanceof Error ? error.name : 'unknown' }));
  }
  if (familiar) return;
  const company = await isCompanyRoom(env);
  await sendAlertEmail(env, signInEmail(signIn, activityUrl, roomNamesOf(env).instanceName, company, env.TIME_ZONE), 'signin.email_failed', company);
}

/**
 * Records the session and, if it is new, emails the owner (unless it is their own familiar sign-in). Resolves true
 * when this call inserted the row. Never throws for a failed send; a database error on the insert does throw
 * (the caller logs it).
 */
export async function recordSignIn(env: SignInEnv, identity: SignInIdentity, request: Request): Promise<boolean> {
  if (identity.iat === null) return false;
  const key = `${identity.sub ?? identity.email}\n${identity.iat}`;
  if (seen.get(env.DB)?.has(key)) return false;

  const { ip, userAgent } = clientInfo(request);
  const result = await env.DB.prepare(
    'INSERT OR IGNORE INTO sign_ins (email, sub, iat, country, user_agent, ip) VALUES (?1, ?2, ?3, ?4, ?5, ?6)',
  )
    .bind(identity.email, identity.sub, identity.iat, identity.country, userAgent, ip)
    .run();
  remember(env.DB, key);
  if (result.meta.changes !== 1) return false;

  if (env.ALERTS_ENABLED !== '0') {
    const signIn: SignIn = { email: identity.email, iat: identity.iat, country: identity.country, userAgent };
    await sendAlert(env, signIn, result.meta.last_row_id, `${new URL(request.url).origin}/activity/`);
  }
  return true;
}

/** For the gate: records the sign-in after the response, so no page waits on D1 or email. */
export function trackSignIn(env: SignInEnv, ctx: ExecutionContext, identity: SignInIdentity, request: Request): void {
  if (identity.iat === null) return;
  ctx.waitUntil(
    recordSignIn(env, identity, request).then(
      () => undefined,
      (error: unknown) => console.error('signin_record_failed', error instanceof Error ? error.name : typeof error),
    ),
  );
}
