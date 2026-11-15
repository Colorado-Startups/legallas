// SPDX-License-Identifier: Apache-2.0
// Every automatic alert, through its real entry point: a room with no matter is never called a counsel room, and a live
// case room's alerts keep their words. EMAIL is a mock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { notifyConnected, notifyRefusedRedirect, notifySignInFailure } from '../mcp/alert.ts';
import { recordSignIn } from './signins.ts';
import { testDb } from './sqlite-d1.ts';

interface Sent {
  from: { name: string };
  subject: string;
  text: string;
  html?: string;
}

const NOW = new Date(Date.UTC(2026, 6, 4, 18, 30));

async function sendAll(extra: Record<string, unknown>): Promise<Sent[]> {
  const sent: Sent[] = [];
  const env = { EMAIL: { send: async (m: Sent) => void sent.push(m) }, ...extra } as never;
  await recordSignIn(
    { ...(env as object), DB: testDb().db as unknown as D1Database } as never,
    { email: 'ada@firm.example', sub: 'sub-ada', iat: NOW.getTime() / 1000, country: 'US' },
    new Request('https://legallas.example.test/'),
  );
  await notifyConnected(env, { email: 'ada@firm.example', clientName: 'Claude', redirectHost: 'claude.ai' }, NOW);
  await notifyRefusedRedirect(env, 'https://evil.example/cb');
  await notifySignInFailure(env, { where: 'token', code: 'invalid_grant', host: 'claude.ai' }, NOW);
  return sent;
}

const bucket = (head: () => Promise<unknown>) => ({ head }) as unknown as R2Bucket;

test('with no matter, no alert says "counsel room" in its From name, text or HTML', async () => {
  const sent = await sendAll({ COMPANY_ROOM_ENABLED: '1', FILES: bucket(async () => null) });
  assert.equal(sent.length, 4);
  for (const mail of sent) {
    assert.equal(mail.from.name, 'Legallas room');
    assert.doesNotMatch(`${mail.subject}\n${mail.text}\n${mail.html}`, /counsel room/i);
  }
});

test("a room with a matter, the setting off or a failed lookup keeps today's words", async (t) => {
  t.mock.method(console, 'error', () => undefined);
  for (const room of [
    { COMPANY_ROOM_ENABLED: '1', FILES: bucket(async () => ({ key: 'meta/matter.json' })) },
    { FILES: bucket(async () => null) },
    { COMPANY_ROOM_ENABLED: '1', FILES: bucket(async () => { throw new TypeError('away'); }) },
  ]) {
    const sent = await sendAll(room);
    for (const mail of sent) assert.equal(mail.from.name, 'Legallas counsel room');
    assert.ok(sent[0]!.text.startsWith('New sign-in to the Legallas counsel room.\n'));
  }
});
