// SPDX-License-Identifier: Apache-2.0
// Sign-in alerts through the real gate with locally signed Access tokens, real SQLite and a mock
// EMAIL binding. No real email is ever sent.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SignJWT, generateKeyPair } from 'jose';
import { verifyAccessIdentity } from './auth.ts';
import type { Env } from './env.ts';
import { handle } from './room.ts';
import { addLeftoverFamily } from './gate-fixtures.ts';
import { ALERT_FROM, ALERT_HEADERS, ALERT_TO, alertSignature, alertTime, OWNER_FAMILIAR_DAYS, signInEmail } from './signins.ts';
import { MIN_SIGNIN_DAYS } from './data-retention.ts';
import { testDb } from './sqlite-d1.ts';
import { summarizeUserAgent } from './user-agent.ts';
import { definedSetting, readWranglerConfig } from './wrangler-config.ts';

const TEAM = 'https://legallas-test.cloudflareaccess.com';
const AUD = 'aud-tag-1';
const ROOM = 'https://legallas.example.test';
const OWNER = 'founder@example.test';
const COUNSEL = 'ada@firm.example';
const FAMILY = 'kin@home.example';
const SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15';
const DAY = 86_400;
// 2026-07-04 18:30 UTC is 12:30 PM in Denver (MDT).
const JULY_4 = Date.UTC(2026, 6, 4, 18, 30) / 1000;

const { publicKey, privateKey } = await generateKeyPair('RS256');
const getKey = async () => publicKey;

function token(claims: { email?: string; sub?: string; country?: string; iat?: number }) {
  const { iat = JULY_4, ...rest } = claims;
  return new SignJWT({ email: OWNER, type: 'app', country: 'US', ...rest })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(TEAM)
    .setAudience(AUD)
    .setIssuedAt(iat)
    .setExpirationTime('5m')
    .sign(privateKey);
}

/** A D1 statement whose query fails, as in a D1 outage. */
function failing() {
  const statement = {
    bind: () => statement,
    all: async () => {
      throw new TypeError('D1_ERROR: unavailable');
    },
  };
  return statement;
}

interface Sent {
  to: string;
  from: { email: string; name: string };
  subject: string;
  text: string;
  headers?: Record<string, string>;
}

function room(options: { alerts?: string; send?: (m: Sent) => Promise<unknown>; failHistory?: boolean; timeZone?: string } = {}) {
  const { db, sqlite } = testDb();
  sqlite.exec(`
    INSERT INTO members (email, role, name) VALUES ('${OWNER}', 'owner', 'Founder'), ('${COUNSEL}', 'counsel', NULL);
    INSERT INTO documents (id, path, folder, name, kind, content_type, size, r2_key, source, updated_at) VALUES
      ('d1', 'Secret-Folder/Deposition-Exhibit-12.pdf', 'Secret-Folder', 'Deposition-Exhibit-12.pdf', 'pdf', 'application/pdf', 1, 'k1', 'mirror', '2026-01-01');
    INSERT INTO comments (id, document_id, author_email, body) VALUES ('c1', 'd1', '${OWNER}', 'Remember the cooler logs');
  `);
  addLeftoverFamily(sqlite, FAMILY); // a row from before migration 0010
  const sent: Sent[] = [];
  // failHistory breaks only the owner's sign-in history query, so the insert still lands.
  const history = (sql: string) => options.failHistory && sql.includes('SELECT DISTINCT user_agent');
  const env = {
    ASSETS: { fetch: async () => new Response('shell') },
    DB: { ...db, prepare: (sql: string) => (history(sql) ? failing() : db.prepare(sql)) },
    EMAIL: { send: options.send ?? (async (m: Sent) => void sent.push(m)) },
    TEAM_DOMAIN: TEAM,
    ACCESS_AUD: AUD,
    ...(options.alerts === undefined ? {} : { ALERTS_ENABLED: options.alerts }),
    ...(options.timeZone === undefined ? {} : { TIME_ZONE: options.timeZone }),
  } as unknown as Env;
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p), passThroughOnException() {} } as unknown as ExecutionContext;
  const visit = (jwt: string, path = '/', userAgent = SAFARI) =>
    handle(new Request(`${ROOM}${path}`, { headers: { 'Cf-Access-Jwt-Assertion': jwt, 'User-Agent': userAgent, 'CF-Connecting-IP': '203.0.113.7' } }), env, ctx, getKey);
  const settle = () => Promise.all(pending);
  const signIns = () => sqlite.prepare('SELECT email, sub, iat, country, ip FROM sign_ins ORDER BY id').all().map((r) => ({ ...r }));
  return { sent, visit, settle, signIns };
}

test('ten parallel requests in one new session record one sign-in and send one email', async () => {
  const { sent, visit, settle, signIns } = room();
  const jwt = await token({ sub: 'sub-founder' });
  const paths = ['/', '/api/me', '/_astro/a.js', '/_astro/b.css', '/favicon.svg', '/api/visuals', '/', '/x', '/y', '/z'];
  const responses = await Promise.all(paths.map((p) => visit(jwt, p)));
  await settle();
  assert.ok(responses.every((r) => r.status !== 403));
  assert.equal(sent.length, 1);
  assert.deepEqual(signIns(), [{ email: OWNER, sub: 'sub-founder', iat: JULY_4, country: 'US', ip: '203.0.113.7' }]);

  await visit(jwt, '/later');
  await settle();
  assert.equal(sent.length, 1, 'the same session never alerts twice');
});

test('a new login (new iat) alerts again, the same person included', async () => {
  const { sent, visit, settle, signIns } = room();
  await visit(await token({ email: COUNSEL, sub: 'sub-ada' }));
  await visit(await token({ email: COUNSEL, sub: 'sub-ada', iat: JULY_4 + 3600 }));
  await settle();
  assert.equal(sent.length, 2);
  assert.equal(signIns().length, 2);
});

test('a token without sub falls back to the email as the session key', async () => {
  const { sent, visit, settle, signIns } = room();
  const noSub = await token({});
  await Promise.all([visit(noSub), visit(noSub), visit(noSub)]);
  await visit(await token({ email: COUNSEL }));
  await settle();
  assert.deepEqual(signIns().map((r) => [r.email, r.sub]), [[OWNER, null], [COUNSEL, null]]);
  assert.equal(sent.length, 2, 'one per person, not one per request, and not merged across people');
});

test("the time reads in the room's TIME_ZONE after UTC; unset or a name Intl rejects reads Mountain", async () => {
  const when = new Date(JULY_4 * 1000);
  assert.match(alertTime(when, 'America/New_York'), /^2026-07-04 18:30 UTC \(Jul 4, 2026, 2:30\sPM EDT\)$/);
  for (const zone of [undefined, '', 'Mountain', 'America/Nowhere']) {
    assert.match(alertTime(when, zone), /^2026-07-04 18:30 UTC \(Jul 4, 2026, 12:30\sPM MDT\)$/, String(zone));
  }
  const { sent, visit, settle } = room({ timeZone: 'Europe/London' });
  await visit(await token({ email: COUNSEL, sub: 'sub-ada' }));
  await settle();
  assert.match(sent[0]?.text ?? '', /When: +2026-07-04 18:30 UTC \(Jul 4, 2026, 7:30\sPM GMT\+1\)/);
});

test('the email says who, when (UTC and Mountain), country and browser, and nothing about documents', async () => {
  const { sent, visit, settle } = room();
  await visit(await token({ email: COUNSEL, sub: 'sub-ada', country: 'US' }), '/api/documents/d1/comments');
  await settle();
  const [mail] = sent;
  assert.ok(mail);
  assert.equal(mail.to, ALERT_TO);
  assert.equal(mail.from.email, ALERT_FROM);
  assert.equal(mail.subject, `Legallas: new sign-in by ${COUNSEL}`);
  assert.match(mail.text, /Who: +ada@firm\.example/);
  assert.match(mail.text, /When: +2026-07-04 18:30 UTC \(Jul 4, 2026, 12:30\s?PM MDT\)/);
  assert.match(mail.text, /Country: +US/);
  assert.match(mail.text, /Browser: +Safari on macOS/);
  assert.match(mail.text, /https:\/\/legallas\.example\.test\/activity\/$/m);
  assert.doesNotMatch(mail.text + mail.subject, /Deposition|Exhibit|Secret|cooler logs|d1|\/api\/|203\.0\.113/);
  assert.doesNotMatch(mail.text, /\u2014/, 'no em dashes');
  assert.ok(mail.text.endsWith(`/activity/\n${alertSignature({}).text}`), 'the assistant signs off once, after the activity link');
});

test('a failed send is logged by code only and never breaks the request', async (t: TestContext) => {
  const errors = t.mock.method(console, 'error', () => {});
  const failing = async () => {
    throw Object.assign(new Error(`cannot send to ${ALERT_TO}`), { code: 'E_SENDER_NOT_VERIFIED' });
  };
  const { visit, settle, signIns } = room({ send: failing });
  const res = await visit(await token({ sub: 'sub-founder' }), '/api/me');
  assert.equal(res.status, 200);
  await settle();
  assert.equal(signIns().length, 1, 'the sign-in is still recorded');
  const logged = errors.mock.calls.map((c) => c.arguments.join(' ')).join('\n');
  assert.match(logged, /E_SENDER_NOT_VERIFIED/);
  assert.doesNotMatch(logged, /example|example\.test|cannot send/);
});

test('ALERTS_ENABLED=0 records the sign-in but sends nothing; unset means on', async () => {
  const off = room({ alerts: '0' });
  await off.visit(await token({ sub: 'sub-founder' }));
  await off.settle();
  assert.equal(off.sent.length, 0);
  assert.equal(off.signIns().length, 1);

  const unset = room();
  await unset.visit(await token({ sub: 'sub-founder' }));
  await unset.settle();
  assert.equal(unset.sent.length, 1);
});

test('non-members and the localhost dev identity record nothing', async () => {
  const { visit, settle, signIns, sent } = room();
  const res = await visit(await token({ email: 'stranger@example.test', sub: 'sub-x' }));
  assert.equal(res.status, 403);
  await settle();
  assert.equal(signIns().length, 0);
  assert.equal(sent.length, 0);

  const dev = await verifyAccessIdentity(new Request('http://localhost:8789/'), { TEAM_DOMAIN: '', ACCESS_AUD: '', ALLOW_DEV_IDENTITY: '1', DEV_IDENTITY_EMAIL: OWNER });
  assert.deepEqual(dev, { email: OWNER, sub: null, iat: null, country: null, secondFactor: null });
});

test('verifyAccessIdentity returns sub, iat and country, and drops a malformed country', async () => {
  const env = { TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD };
  const req = async (claims: Parameters<typeof token>[0]) =>
    new Request(`${ROOM}/`, { headers: { 'Cf-Access-Jwt-Assertion': await token(claims) } });
  assert.deepEqual(await verifyAccessIdentity(await req({ sub: 's1', country: 'US' }), env, getKey), {
    email: OWNER,
    sub: 's1',
    iat: JULY_4,
    country: 'US',
    secondFactor: false,
  });
  assert.equal((await verifyAccessIdentity(await req({ country: 'United States\n' }), env, getKey))?.country, null);
});

test('summarizeUserAgent names common browsers and systems', () => {
  const cases: [string | null, string][] = [
    [SAFARI, 'Safari on macOS'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 Edg/141.0', 'Edge on Windows'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0 Mobile/15E148 Safari/604.1', 'Chrome on iPhone'],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:142.0) Gecko/20100101 Firefox/142.0', 'Firefox on Linux'],
    ['Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36', 'Chrome on Android'],
    ['curl/8.7.1', 'Unknown browser'],
    [null, 'Unknown browser'],
  ];
  for (const [ua, want] of cases) assert.equal(summarizeUserAgent(ua), want, String(ua));
});

test('signInEmail handles an unknown country and browser', () => {
  const { text } = signInEmail({ email: OWNER, iat: JULY_4, country: null, userAgent: null }, 'https://room.example/activity/');
  assert.match(text, /Country: +Unknown/);
  assert.match(text, /Browser: +Unknown browser/);
});

test('wrangler.jsonc locks the EMAIL binding to the alert sender and recipient; dev turns alerts off', () => {
  // The room's file, or the example in a checkout without one: either must name the addresses signins.ts sends with.
  const { config } = readWranglerConfig('wrangler');
  assert.deepEqual(config.send_email, [{ name: 'EMAIL', destination_address: definedSetting(config, 'ROOM_ALERT_TO', ALERT_TO), allowed_sender_addresses: [definedSetting(config, 'ROOM_ALERT_FROM', ALERT_FROM)] }]);
  assert.equal(config.vars.ALERTS_ENABLED, '1');
  const devVars = readFileSync(join(import.meta.dirname, '..', '.dev.vars.example'), 'utf8');
  assert.match(devVars, /^ALERTS_ENABLED=0$/m);
});

const CHROME_WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';
const SAFARI_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
const SAFARI_NEWER = SAFARI.replace('Version/26.0', 'Version/26.1');

test("the owner's sign-in from a familiar browser, system and country sends no email, and is still recorded", async () => {
  const { sent, visit, settle, signIns } = room();
  await visit(await token({ sub: 'sub-founder' }));
  await visit(await token({ sub: 'sub-founder', iat: JULY_4 + 3600 }));
  await visit(await token({ sub: 'sub-founder', iat: JULY_4 + 2 * DAY }), '/', SAFARI_NEWER);
  await settle();
  assert.equal(sent.length, 1, 'only the first; a browser update is the same browser');
  assert.equal(signIns().length, 3);
});

test("the owner's sign-in alerts for a new browser, system or country", async () => {
  const { sent, visit, settle } = room();
  await visit(await token({ sub: 'sub-founder' }));
  await visit(await token({ sub: 'sub-founder', iat: JULY_4 + 60 }), '/', CHROME_WINDOWS);
  await visit(await token({ sub: 'sub-founder', iat: JULY_4 + 120 }), '/', SAFARI_IPHONE);
  await visit(await token({ sub: 'sub-founder', iat: JULY_4 + 180, country: 'CA' }));
  await visit(await token({ sub: 'sub-founder', iat: JULY_4 + 240, country: 'CA' }));
  await settle();
  assert.deepEqual(
    sent.map((m) => [/Browser: +(.+)/.exec(m.text)?.[1], /Country: +(.+)/.exec(m.text)?.[1]]),
    [['Safari on macOS', 'US'], ['Chrome on Windows', 'US'], ['Safari on iPhone', 'US'], ['Safari on macOS', 'CA']],
  );
});

test(`the owner's familiar set covers the last ${OWNER_FAMILIAR_DAYS} days of sessions`, async () => {
  assert.equal(OWNER_FAMILIAR_DAYS, 30);
  const { sent, visit, settle } = room();
  await visit(await token({ sub: 'sub-founder' }));
  await visit(await token({ sub: 'sub-founder', iat: JULY_4 + 29 * DAY }));
  await settle();
  assert.equal(sent.length, 1, '29 days later is still familiar');
  await visit(await token({ sub: 'sub-founder', iat: JULY_4 + 60 * DAY }));
  await settle();
  assert.equal(sent.length, 2, '31 days after the last use is new again');
});

test("the owner always hears about a browser that cannot be named", async () => {
  const { sent, visit, settle } = room();
  const osOnly = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Unnamed/1.0';
  for (const [i, ua] of ['curl/8.7.1', 'curl/8.7.1', osOnly, osOnly].entries()) {
    await visit(await token({ sub: 'sub-founder', iat: JULY_4 + i * 60 }), '/', ua);
  }
  await settle();
  assert.deepEqual(
    sent.map((m) => /Browser: +(.+)/.exec(m.text)?.[1]),
    ['Unknown browser', 'Unknown browser', 'A browser on macOS', 'A browser on macOS'],
  );
});

test("counsel sign-ins alert every time, and never make the owner's browser familiar", async () => {
  const { sent, visit, settle } = room();
  for (const [i, email] of [COUNSEL, COUNSEL].entries()) {
    await visit(await token({ email, sub: `sub-${email}`, iat: JULY_4 + i * 60 }));
  }
  await visit(await token({ sub: 'sub-founder', iat: JULY_4 + 600 }));
  await settle();
  assert.deepEqual(sent.map((m) => m.subject), [COUNSEL, COUNSEL, OWNER].map((e) => `Legallas: new sign-in by ${e}`));
});

test('a family row left from before migration 0010 is refused like a non-member and records no sign-in', async () => {
  const { sent, visit, settle, signIns } = room();
  const res = await visit(await token({ email: FAMILY, sub: 'sub-kin' }));
  await settle();
  assert.equal(res.status, 403);
  assert.deepEqual([sent, signIns()], [[], []]);
});

test("a failed history check sends the owner's alert anyway and logs the error name only", async (t: TestContext) => {
  const errors = t.mock.method(console, 'error', () => {});
  const { sent, visit, settle, signIns } = room({ failHistory: true });
  await visit(await token({ sub: 'sub-founder' }));
  await visit(await token({ sub: 'sub-founder', iat: JULY_4 + 60 }));
  await settle();
  assert.equal(sent.length, 2);
  assert.equal(signIns().length, 2);
  assert.deepEqual(errors.mock.calls.map((c) => c.arguments[0]), Array(2).fill(JSON.stringify({ event: 'signin.history_failed', code: 'TypeError' })));
});

test('the alert carries Auto-Submitted and List-Id for mail filters', async () => {
  const { sent, visit, settle } = room();
  await visit(await token({ email: COUNSEL, sub: 'sub-ada' }));
  await settle();
  assert.deepEqual(sent[0]?.headers, { 'Auto-Submitted': 'auto-generated', 'List-Id': 'Legallas alerts <alerts.room.example.com>' });
  assert.deepEqual(sent[0]?.headers, ALERT_HEADERS);
});

test('the retention sweep never removes sign-ins the familiar check still reads (worker/data-retention.ts)', () => {
  assert.equal(MIN_SIGNIN_DAYS, OWNER_FAMILIAR_DAYS);
});
