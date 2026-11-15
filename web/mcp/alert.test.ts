// SPDX-License-Identifier: Apache-2.0
// The new-connection alert with a mock EMAIL binding. No real email is ever sent.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { ALERT_FROM, ALERT_HEADERS, ALERT_TO } from '../worker/signins.ts';
import { ADMIN_CLIENTS_URL, CONNECTIONS_URL, connectionEmail, notifyConnected, notifyRefusedRedirect, notifySignInFailure, signInFailureEmail, type ConnectionAlert } from './alert.ts';
import type { McpEnv } from './contract.ts';
import type { SignInFailure } from './signin-failure.ts';

// 2026-07-04 18:30 UTC is 12:30 PM in Denver (MDT).
const JULY_4 = new Date(Date.UTC(2026, 6, 4, 18, 30));
const ALERT: ConnectionAlert = { email: 'ada@firm.example', clientName: 'Claude', redirectHost: 'claude.ai' };

interface Sent {
  to: string;
  from: { email: string; name: string };
  subject: string;
  text: string;
  headers?: Record<string, string>;
}

function mailer(options: { alerts?: string; fail?: unknown } = {}) {
  const sent: Sent[] = [];
  const env = {
    EMAIL: {
      send: async (m: Sent) => {
        if (options.fail !== undefined) throw options.fail;
        sent.push(m);
      },
    },
    ...(options.alerts === undefined ? {} : { ALERTS_ENABLED: options.alerts }),
  } as unknown as Pick<McpEnv, 'EMAIL' | 'ALERTS_ENABLED'>;
  return { env, sent };
}

test('emails owner@ from room@ with who, which app, where the tokens go, when, and the revoke link', async () => {
  const { env, sent } = mailer();
  await notifyConnected(env, ALERT, JULY_4);
  assert.equal(sent.length, 1);
  const [mail] = sent;
  assert.equal(mail.to, ALERT_TO);
  assert.equal(mail.from.email, ALERT_FROM);
  assert.equal(mail.subject, 'Legallas: ada@firm.example connected Claude');
  assert.match(mail.text, /^Who: +ada@firm\.example$/m);
  assert.match(mail.text, /^App: +Claude$/m);
  assert.match(mail.text, /^Sends to: +claude\.ai$/m);
  assert.match(mail.text, /^When: +2026-07-04 18:30 UTC \(Jul 4, 2026, 12:30\s?PM MDT\)$/m);
  assert.match(mail.text, /read-only and lasts 30 days/);
  assert.ok(mail.text.includes(`\n${CONNECTIONS_URL}\n`));
  assert.equal(CONNECTIONS_URL, 'https://mcp.room.example.com/connections');
});

test('a connection its member let propose is not called read-only in the owner\'s email', () => {
  assert.match(connectionEmail(ALERT, JULY_4).text, /read-only and lasts 30 days/);
  const proposing = connectionEmail({ ...ALERT, propose: true }, JULY_4).text;
  assert.doesNotMatch(proposing, /read-only/);
  assert.match(proposing, /may propose; a proposal changes nothing until the member approves it in the room\. It lasts 30 days/);
});

test('ALERTS_ENABLED=0 sends nothing; any other value sends', async () => {
  const off = mailer({ alerts: '0' });
  await notifyConnected(off.env, ALERT, JULY_4);
  assert.equal(off.sent.length, 0);
  const on = mailer({ alerts: '1' });
  await notifyConnected(on.env, ALERT, JULY_4);
  assert.equal(on.sent.length, 1);
});

test('a failed send never throws and logs the error code only', async (t: TestContext) => {
  const logged: unknown[][] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => void logged.push(args));
  const failure = Object.assign(new Error('could not send to ada@firm.example about Claude'), { code: 'E_SENDER_NOT_VERIFIED' });
  await notifyConnected(mailer({ fail: failure }).env, ALERT, JULY_4);
  assert.deepEqual(logged, [[JSON.stringify({ event: 'mcp.connect_email_failed', code: 'E_SENDER_NOT_VERIFIED' })]]);
  logged.length = 0;
  await notifyConnected(mailer({ fail: 'boom' }).env, ALERT, JULY_4);
  assert.deepEqual(logged, [[JSON.stringify({ event: 'mcp.connect_email_failed', code: 'unknown' })]]);
});

test('client-chosen names cannot add header lines, spoof with bidi controls, or run long', () => {
  const hostile: ConnectionAlert = {
    email: 'ada@firm.example',
    clientName: 'Claude\r\nBcc: someone@evil.example\u202Egnp.exe',
    redirectHost: 'evil.example\nApp: Claude',
  };
  const { subject, text } = connectionEmail(hostile, JULY_4);
  assert.doesNotMatch(subject, /[\r\n\u202E]/);
  assert.equal(subject, 'Legallas: ada@firm.example connected Claude Bcc: someone@evil.example gnp.exe');
  assert.equal(text.match(/^App:/gm)?.length, 1);
  assert.doesNotMatch(text, /\u202E/);
  const long = connectionEmail({ ...ALERT, clientName: 'A'.repeat(500) }, JULY_4);
  assert.ok(long.subject.length < 200);
  assert.equal(connectionEmail({ ...ALERT, clientName: '\u0000\u200B' }, JULY_4).subject, 'Legallas: ada@firm.example connected Unknown');
});

test('the email has a fixed shape: no document, file or case field can appear in it', () => {
  const { text } = connectionEmail(ALERT, JULY_4);
  const labels = text
    .split('\n')
    .map((line) => line.match(/^([A-Za-z ]+):\s/)?.[1])
    .filter(Boolean);
  assert.deepEqual(labels, ['Who', 'App', 'Sends to', 'When']);
  assert.doesNotMatch(text, /\.pdf|document|exhibit/i);
});

test('a malformed alert never throws: it logs the code "build" and sends nothing', async (t: TestContext) => {
  const logged: unknown[][] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => void logged.push(args));
  const { env, sent } = mailer();
  const broken = { email: 'ada@firm.example', clientName: undefined, redirectHost: 'claude.ai' } as unknown as ConnectionAlert;
  await assert.doesNotReject(notifyConnected(env, broken, JULY_4));
  await assert.doesNotReject(notifyConnected(env, ALERT, new Date(Number.NaN)));
  assert.equal(sent.length, 0);
  const build = JSON.stringify({ event: 'mcp.connect_email_failed', code: 'build' });
  assert.deepEqual(logged, [[build], [build]]);
});

test('a long name is cut by code point, never through a surrogate pair', () => {
  const name = `${'A'.repeat(119)}\u{1F600}\u{1F600}`;
  const { subject } = connectionEmail({ ...ALERT, clientName: name }, JULY_4);
  assert.ok(subject.endsWith(`${'A'.repeat(119)}\u{1F600}...`));
  assert.doesNotMatch(subject, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
});

const LIST_HEADERS = { 'Auto-Submitted': 'auto-generated', 'List-Id': 'Legallas alerts <alerts.room.example.com>' };

test('the connected-app and refused-callback alerts carry Auto-Submitted and List-Id', async () => {
  assert.deepEqual(ALERT_HEADERS, LIST_HEADERS);
  const { env, sent } = mailer();
  await notifyConnected(env, ALERT, JULY_4);
  await notifyRefusedRedirect(env, 'https://connect.vendor.app/cb');
  assert.equal(sent.length, 2);
  for (const mail of sent) assert.deepEqual(mail.headers, LIST_HEADERS);
});

/** A mailer that records every attempt and fails the ones `reject` names (by the error it returns). */
function picky(reject: (attempt: Sent, n: number) => unknown) {
  const attempts: Sent[] = [];
  const env = {
    EMAIL: {
      send: async (m: Sent) => {
        attempts.push(m);
        const error = reject(m, attempts.length);
        if (error !== undefined) throw error;
      },
    },
  } as unknown as Pick<McpEnv, 'EMAIL' | 'ALERTS_ENABLED'>;
  return { env, attempts };
}

const headerRefused = Object.assign(new Error("Header 'List-Id' is not allowed."), { code: 'E_HEADER_NOT_ALLOWED' });

test('a refused header never loses the alert: it goes again once without the headers', async (t: TestContext) => {
  const logged: unknown[][] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => void logged.push(args));
  const { env, attempts } = picky((m) => (m.headers ? headerRefused : undefined));
  await notifyConnected(env, ALERT, JULY_4);
  assert.equal(attempts.length, 2);
  assert.deepEqual(attempts[0]?.headers, LIST_HEADERS);
  assert.equal(attempts[1]?.headers, undefined);
  assert.deepEqual({ ...attempts[1], headers: LIST_HEADERS }, attempts[0], 'the same alert, only the headers dropped');
  assert.deepEqual(logged, [[JSON.stringify({ event: 'mcp.connect_email_failed', code: 'E_HEADER_NOT_ALLOWED', retry: 'without_headers' })]]);
});

test('other failures are not retried, and a failed retry is logged by code only', async (t: TestContext) => {
  const logged: unknown[][] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => void logged.push(args));
  const sender = Object.assign(new Error('cannot send to ada@firm.example'), { code: 'E_SENDER_NOT_VERIFIED' });
  const once = picky(() => sender);
  await notifyConnected(once.env, ALERT, JULY_4);
  assert.equal(once.attempts.length, 1);

  logged.length = 0;
  const twice = picky((_m, n) => (n === 1 ? headerRefused : sender));
  await assert.doesNotReject(notifyRefusedRedirect(twice.env, 'https://connect.vendor.app/cb'));
  assert.equal(twice.attempts.length, 2);
  assert.deepEqual(logged, [
    [JSON.stringify({ event: 'mcp.refused_redirect_email_failed', code: 'E_HEADER_NOT_ALLOWED', retry: 'without_headers' })],
    [JSON.stringify({ event: 'mcp.refused_redirect_email_failed', code: 'E_SENDER_NOT_VERIFIED' })],
  ]);
  assert.doesNotMatch(JSON.stringify(logged), /ada@|vendor\.app|List-Id/);
});

const FAILURE: SignInFailure = { where: 'token', code: 'invalid_grant', host: 'claude.ai', grantType: 'authorization_code' };

test('the sign-in failure email names the step, the code, the host, the time, where to look and /admin/clients', async () => {
  const { env, sent } = mailer();
  await notifySignInFailure(env, FAILURE, JULY_4);
  assert.equal(sent.length, 1);
  const [mail] = sent;
  assert.equal(mail.subject, 'Legallas: an AI app sign-in failed');
  assert.deepEqual(mail.headers, LIST_HEADERS);
  assert.match(mail.text, /^Where: +token: the app trading its sign-in code for access$/m);
  assert.match(mail.text, /^Error: +invalid_grant$/m);
  assert.match(mail.text, /^App host: +claude\.ai$/m);
  assert.match(mail.text, /^When: +2026-07-04 18:30 UTC \(Jul 4, 2026, 12:30\s?PM MDT\)$/m);
  assert.match(mail.text, /^Look at legallas-mcp logs for mcp_oauth_error at that time\.$/m);
  assert.ok(mail.text.includes(ADMIN_CLIENTS_URL));
  const consent = signInFailureEmail({ where: 'consent', code: 'metadata_resolution_failed', host: 'claude.ai' }, JULY_4).text;
  assert.match(consent, /^Look at legallas-mcp logs for mcp_consent_describe_failed at that time\.$/m);
  const off = mailer({ alerts: '0' });
  await notifySignInFailure(off.env, FAILURE, JULY_4);
  assert.equal(off.sent.length, 0);
});

test('the sign-in failure email never carries the error description, and every field stays on one line', () => {
  const withText = { ...FAILURE, description: 'Grant not found for ada@firm.example' } as SignInFailure;
  const { text } = signInFailureEmail(withText, JULY_4);
  assert.doesNotMatch(text, /Grant not found|ada@/);
  const labels = text.split('\n').map((line) => line.match(/^([A-Za-z ]+):\s/)?.[1]).filter(Boolean);
  assert.deepEqual(labels, ['Where', 'Error', 'App host', 'When', 'Apps and callbacks']);

  const hostile = signInFailureEmail({ where: 'authorize', code: 'invalid_request\r\nBcc: x@evil.example', host: 'evil.example\nError: none' }, JULY_4).text;
  assert.equal(hostile.match(/^Error:/gm)?.length, 1);
  assert.equal(hostile.match(/^Bcc:/gm), null);
  assert.match(hostile, /^App host: +evil\.example Error: none$/m);
});

test('a malformed sign-in failure never throws: it logs "build" and sends nothing', async (t: TestContext) => {
  const logged: unknown[][] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => void logged.push(args));
  const { env, sent } = mailer();
  await assert.doesNotReject(notifySignInFailure(env, { ...FAILURE, code: undefined } as unknown as SignInFailure, JULY_4));
  assert.equal(sent.length, 0);
  assert.deepEqual(logged, [[JSON.stringify({ event: 'mcp.signin_failure_email_failed', code: 'build' })]]);
});
