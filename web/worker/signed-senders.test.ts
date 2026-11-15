// SPDX-License-Identifier: Apache-2.0
// Every email the Workers send ends with the room's signature, in both parts (signins.ts alertSignature: the one the
// room's Worker entries registered, else the neutral one; legallas.test.ts checks Legallas's). One table holds every
// automatic sender, each driven through its real entry point with a mock EMAIL binding (no real email is ever sent),
// and a scan fails when code sends email any way other than sendAlertEmail. A new sender adds a row here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { notifyConnected, notifyRefusedRedirect } from '../mcp/alert.ts';
import { textToHtml } from './email-signature.ts';
import type { Env } from './env.ts';
import { ALERT_FROM, ALERT_HEADERS, ALERT_TO, alertSignature, recordSignIn } from './signins.ts';
import { testDb } from './sqlite-d1.ts';

interface Sent {
  to: string;
  from: { email: string; name: string };
  replyTo?: unknown;
  subject: string;
  text: string;
  html?: string;
  headers?: Record<string, string>;
}

type MailEnv = Pick<Env, 'EMAIL' | 'ALERTS_ENABLED'>;

// 2026-07-04 18:30 UTC.
const NOW = new Date(Date.UTC(2026, 6, 4, 18, 30));
/** Client-supplied text that would be markup if the HTML part did not escape it. */
const HOSTILE = '<img src=x onerror=alert(1)>';

/** Every automatic email, with how to make it send once. */
const SENDERS: { name: string; send: (env: MailEnv) => Promise<unknown> }[] = [
  {
    name: 'legallas-web sign-in alert',
    send: (env) =>
      recordSignIn(
        { ...env, DB: testDb().db as unknown as D1Database },
        { email: 'ada@firm.example', sub: 'sub-ada', iat: NOW.getTime() / 1000, country: 'US' },
        new Request('https://legallas.example.test/', { headers: { 'User-Agent': HOSTILE } }),
      ),
  },
  {
    name: 'legallas-mcp new-connection alert',
    send: (env) => notifyConnected(env, { email: 'ada@firm.example', clientName: HOSTILE, redirectHost: 'claude.ai' }, NOW),
  },
  {
    name: 'legallas-mcp refused-callback alert',
    send: (env) => notifyRefusedRedirect(env, `https://evil.example/cb?app=${HOSTILE}`),
  },
];

function mailer(alerts?: string) {
  const sent: Sent[] = [];
  const env = {
    EMAIL: { send: async (m: Sent) => void sent.push(m) },
    ...(alerts === undefined ? {} : { ALERTS_ENABLED: alerts }),
  } as unknown as MailEnv;
  return { env, sent };
}

for (const sender of SENDERS) {
  test(`${sender.name}: room@ to owner@, both parts end with the signature, the HTML escaped`, async () => {
    const { env, sent } = mailer();
    await sender.send(env);
    assert.equal(sent.length, 1);
    const [mail] = sent;
    // The sender, recipient and list headers are what DMARC alignment and the owner's filters rely on: unchanged.
    assert.equal(mail.to, ALERT_TO);
    assert.deepEqual(mail.from, { email: ALERT_FROM, name: 'Legallas counsel room' });
    assert.equal(mail.replyTo, undefined, 'replies go to the From, room@');
    assert.deepEqual(mail.headers, ALERT_HEADERS);

    const signature = alertSignature({});
    assert.ok(mail.text.endsWith(signature.text), 'the text part ends with the signature');
    assert.equal(mail.text.split(signature.text).length, 2, 'signed once');

    const html = mail.html ?? '';
    assert.ok(html.endsWith(`${signature.html.trim()}\n</body>\n</html>\n`), 'the HTML part ends with the HTML signature');
    assert.ok(!html.includes(HOSTILE), 'client-supplied text never becomes markup');
    // The HTML part says everything the text part says, line by line.
    const body = mail.text.slice(0, -signature.text.length);
    for (const line of body.split('\n').filter((l) => l.trim())) assert.ok(html.includes(textToHtml(line).slice(3, -4)), line);
  });

  test(`${sender.name}: ALERTS_ENABLED "0" sends nothing`, async () => {
    const { env, sent } = mailer('0');
    await sender.send(env);
    assert.equal(sent.length, 0);
  });
}

/** The Workers' own source files (both Workers import from worker/ and mcp/), tests and generated types aside. */
function workerSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : workerSources(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') && !entry.name.endsWith('.d.ts') ? [path] : [];
  });
}

test('sendAlertEmail is the only code that sends email, so no Worker email can skip the signature', () => {
  const web = join(import.meta.dirname, '..');
  // EMAIL is the one send_email binding in both Wrangler configs (config tests pin it). A raw EmailMessage or an
  // email handler's reply would skip the signature, so they count too.
  const SENDS = /\bEMAIL\??\.send\(|\bnew EmailMessage\(|['"]cloudflare:email['"]|\.reply\(\s*new\b/;
  const senders = [join(web, 'worker'), join(web, 'mcp')]
    .flatMap(workerSources)
    .filter((file) => SENDS.test(readFileSync(file, 'utf8')))
    .map((file) => relative(web, file));
  assert.deepEqual(senders, ['worker/signins.ts']);
});
