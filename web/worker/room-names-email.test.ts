// SPDX-License-Identifier: Apache-2.0
// The emails under the configurable names (room-names.ts). With nothing set, every alert's From name, subject and
// body are what they were. A renamed room's alerts name the room by its instance name, and the neutral signature
// (email-signature.ts) names the assistant and the room. A room that registers its own signature keeps it whatever
// the names (legallas.test.ts: Legallas's, byte for byte). The research prompt's name: agent/steps.test.ts. No real
// email is sent: EMAIL is a mock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectionEmail, notifyConnected, notifyRefusedRedirect, notifySignInFailure, refusedRedirectEmail, signInFailureEmail } from '../mcp/alert.ts';
import { htmlEmail, neutralSignature, textToHtml } from './email-signature.ts';
import { ALERT_FROM, alertFromName, recordSignIn, signInEmail } from './signins.ts';
import { testDb } from './sqlite-d1.ts';

interface Sent {
  from: { email: string; name: string };
  subject: string;
  text: string;
  html?: string;
}

// 2026-07-04 18:30 UTC.
const NOW = new Date(Date.UTC(2026, 6, 4, 18, 30));
const SIGN_IN = { email: 'ada@firm.example', iat: NOW.getTime() / 1000, country: 'US', userAgent: null };
const ALERT = { email: 'ada@firm.example', clientName: 'Claude', redirectHost: 'claude.ai' };
const FAILURE = { where: 'token', code: 'invalid_grant', host: 'claude.ai' } as const;

const DEFAULT_SIGNATURE = neutralSignature({ assistantName: 'Legallas', instanceName: 'Legallas' });

function mailer(extra: Record<string, string> = {}) {
  const sent: Sent[] = [];
  const env = { EMAIL: { send: async (m: Sent) => void sent.push(m) }, ...extra } as never;
  return { env, sent };
}

/** One of each automatic alert, sent through its real entry point. */
async function sendAll(extra: Record<string, string> = {}): Promise<Sent[]> {
  const { env, sent } = mailer(extra);
  await recordSignIn(
    { ...(env as object), DB: testDb().db as unknown as D1Database } as never,
    { email: SIGN_IN.email, sub: 'sub-ada', iat: SIGN_IN.iat, country: 'US' },
    new Request('https://legallas.example.test/'),
  );
  await notifyConnected(env, ALERT, NOW);
  await notifyRefusedRedirect(env, 'https://evil.example/cb');
  await notifySignInFailure(env, FAILURE, NOW);
  return sent;
}

test("with nothing set, the alerts carry today's From name, subjects and first lines, signed for the default names", async () => {
  const sent = await sendAll();
  assert.equal(sent.length, 4);
  for (const mail of sent) {
    assert.deepEqual(mail.from, { email: ALERT_FROM, name: 'Legallas counsel room' });
    assert.ok(mail.text.endsWith(DEFAULT_SIGNATURE.text), 'the text part ends with the signature');
    assert.ok(mail.html?.endsWith(`${DEFAULT_SIGNATURE.html.trim()}\n</body>\n</html>\n`), 'the HTML part ends with the signature');
  }
  assert.deepEqual(sent.map((m) => m.subject), [
    'Legallas: new sign-in by ada@firm.example',
    'Legallas: ada@firm.example connected Claude',
    'Legallas: an AI app sign-in callback was refused',
    'Legallas: an AI app sign-in failed',
  ]);
  assert.ok(sent[0]!.text.startsWith('New sign-in to the Legallas counsel room.\n'));
  assert.ok(sent[1]!.text.startsWith('An AI app was connected to the Legallas counsel room.\n'));
  assert.ok(sent[3]!.text.startsWith("An AI app's sign-in to the Legallas counsel room failed."));
});

test("today's instance name set explicitly sends the same bytes", async () => {
  const unset = await sendAll();
  const explicit = await sendAll({ INSTANCE_NAME: 'Legallas' });
  assert.equal(JSON.stringify(explicit), JSON.stringify(unset));
  assert.equal(alertFromName(), 'Legallas counsel room');
  assert.deepEqual(signInEmail(SIGN_IN, 'https://x.test/activity/'), signInEmail(SIGN_IN, 'https://x.test/activity/', 'Legallas'));
  assert.deepEqual(connectionEmail(ALERT, NOW), connectionEmail(ALERT, NOW, 'Legallas'));
  assert.deepEqual(refusedRedirectEmail('https://evil.example/cb'), refusedRedirectEmail('https://evil.example/cb', 'Legallas'));
  assert.deepEqual(signInFailureEmail(FAILURE, NOW), signInFailureEmail(FAILURE, NOW, 'Legallas'));
});

test("a renamed room's alerts name the room, and the neutral signature names the assistant and the room", async () => {
  const sent = await sendAll({ INSTANCE_NAME: 'Acme', ASSISTANT_NAME: 'Juniper' });
  const signature = neutralSignature({ assistantName: 'Juniper', instanceName: 'Acme' });
  assert.equal(signature.text, '\n-- \nJuniper\nAI assistant for Acme\nJuniper is AI, not a lawyer. You aren\'t receiving legal advice from a licensed lawyer.\n');
  assert.doesNotMatch(signature.text + signature.html, /does not give legal advice/, 'notices A1, "Don\'t say" (#213)');
  assert.deepEqual(sent.map((m) => m.subject), [
    'Acme: new sign-in by ada@firm.example',
    'Acme: ada@firm.example connected Claude',
    'Acme: an AI app sign-in callback was refused',
    'Acme: an AI app sign-in failed',
  ]);
  for (const mail of sent) {
    assert.deepEqual(mail.from, { email: ALERT_FROM, name: 'Acme counsel room' });
    assert.ok(mail.text.endsWith(signature.text));
    assert.equal(mail.html, htmlEmail(textToHtml(mail.text.slice(0, -signature.text.length)), signature.html));
  }
  assert.ok(sent[0]!.text.startsWith('New sign-in to the Acme counsel room.\n'));
});
