// SPDX-License-Identifier: Apache-2.0
// The quarterly access review's rules, on invented people only (the fictional Doe v. Harbor Labs room).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  FLAG_ACTIONS,
  buildReview,
  guestStatus,
  inCi,
  isMissingRoomsTable,
  parseGrant,
  parseKeyList,
  renderReview,
  stale,
  viaName,
  type GrantRecord,
} from './access-review.ts';

const NOW = new Date('2026-11-06T12:00:00.000Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();
const daysAhead = (days: number) => new Date(NOW.getTime() + days * 86_400_000).toISOString();

const members = [
  { email: 'owner@doe.example', role: 'owner', added_at: daysAgo(400), last_sign_in: daysAgo(2) },
  { email: 'ada@firm.example', role: 'counsel', added_at: daysAgo(300), last_sign_in: daysAgo(120) },
  { email: 'cy@firm.example', role: 'counsel', added_at: daysAgo(10), last_sign_in: null },
  { email: 'bea@firm.example', role: 'counsel', added_at: daysAgo(200), last_sign_in: null },
];
const aiUse = [
  { email: 'ada@firm.example', via: 'Claude', last_use: daysAgo(5) },
  { email: 'ada@firm.example', via: 'Harvey', last_use: daysAgo(150) },
];
const grants: GrantRecord[] = [
  { email: 'ada@firm.example', app: 'Claude', createdAt: daysAgo(200), expiresAt: null },
  { email: 'ada@firm.example', app: 'Harvey', createdAt: daysAgo(200), expiresAt: null },
  { email: 'cy@firm.example', app: 'Claude', createdAt: daysAgo(3), expiresAt: null },
  { email: 'kin@mail.example', app: 'Claude', createdAt: daysAgo(30), expiresAt: null },
  { email: 'cy@firm.example', app: 'Copilot', createdAt: daysAgo(400), expiresAt: daysAgo(1) },
];
const room = { room_id: 'a1b2c3d4-0000-4000-8000-000000000001', room: 'DOE seed round', kind: 'deal', archived_at: null };
const guests = [
  { ...room, email: 'ivy@fund.example', role: 'investor', invited_at: daysAgo(200), accept_by: daysAgo(186), joined_at: daysAgo(190), expires_at: daysAhead(30), last_sign_in: daysAgo(100) },
  { ...room, email: 'uma@fund.example', role: 'investor', invited_at: daysAgo(5), accept_by: daysAhead(9), joined_at: null, expires_at: daysAhead(60), last_sign_in: null },
  { ...room, email: 'bea@angel.example', role: 'investor', invited_at: daysAgo(100), accept_by: daysAgo(86), joined_at: null, expires_at: daysAhead(60), last_sign_in: null },
];

test('stale: more than 90 days ago, or never', () => {
  assert.equal(stale(daysAgo(89), NOW), false);
  assert.equal(stale(daysAgo(91), NOW), true);
  assert.equal(stale(null, NOW), true);
  assert.equal(stale('not a date', NOW), true);
});

test('members: flagged after 90 days without a sign-in, counted from the day they were added when they never signed in', () => {
  const review = buildReview({ members, aiUse, grants, guests }, NOW);
  assert.deepEqual(
    review.members.map((m) => [m.email, m.flag, m.lastAiUse]),
    [
      ['owner@doe.example', null, null],
      ['ada@firm.example', 'no-sign-in', daysAgo(5)],
      ['cy@firm.example', null, null],
      ['bea@firm.example', 'no-sign-in', null],
    ],
  );
});

test('AI connections: only live grants; unused ones and non-members are flagged', () => {
  const review = buildReview({ members, aiUse, grants, guests }, NOW);
  assert.deepEqual(
    review.connections?.map((c) => [c.email, c.app, c.lastUse, c.flag]),
    [
      ['ada@firm.example', 'Claude', daysAgo(5), null],
      ['ada@firm.example', 'Harvey', daysAgo(150), 'ai-unused'],
      ['cy@firm.example', 'Claude', null, null],
      ['kin@mail.example', 'Claude', null, 'ai-not-member'],
    ],
  );
});

test('guests: only those with access are flagged; a lapsed invitation is shown, not flagged', () => {
  const review = buildReview({ members, aiUse, grants, guests }, NOW);
  assert.deepEqual(
    review.guests?.map((g) => [g.email, g.status, g.flag]),
    [
      ['ivy@fund.example', 'joined', 'guest-no-sign-in'],
      ['uma@fund.example', 'pending', null],
      ['bea@angel.example', 'lapsed', null],
    ],
  );
});

test('guestStatus follows worker/rooms.ts: archived and expired end access, kinds the code does not serve give none', () => {
  const base = { kind: 'deal', archived_at: null, joined_at: daysAgo(3), accept_by: daysAgo(1), expires_at: daysAhead(1) };
  assert.equal(guestStatus(base, NOW), 'joined');
  assert.equal(guestStatus({ ...base, archived_at: daysAgo(1) }, NOW), 'archived');
  assert.equal(guestStatus({ ...base, expires_at: daysAgo(1) }, NOW), 'expired');
  assert.equal(guestStatus({ ...base, kind: 'company' }, NOW), 'not served');
  assert.equal(guestStatus({ ...base, kind: 'matter' }, NOW), 'joined');
});

test('no MCP server and no deal rooms: the report says so instead of listing nothing', () => {
  const text = renderReview(buildReview({ members: members.slice(0, 1), aiUse: [], grants: null, guests: null }, NOW), NOW, 'remote');
  assert.match(text, /AI connections: none possible \(no wrangler\.mcp\.jsonc/);
  assert.match(text, /Guest invitations: none possible/);
  assert.match(text, /No flags\./);
});

test('the report lists each flag once, with what to do', () => {
  const text = renderReview(buildReview({ members, aiUse, grants, guests }, NOW), NOW, 'local');
  assert.match(text, /^Access review, 2026-11-06 \(local\)\./);
  assert.match(text, /5 flagged\. What to do:/);
  for (const flag of ['no-sign-in', 'ai-unused', 'ai-not-member', 'guest-no-sign-in']) {
    assert.equal(text.split('\n').filter((line) => line.startsWith(`  ${flag}: `)).length, 1, flag);
  }
  assert.match(text, /npm run member -- remove <email>/);
  assert.match(text, /npm run room -- revoke <room-id> <email>/);
});

test('parseGrant reads who, which app and when, and nothing else', () => {
  const stored = JSON.stringify({
    id: 'g1',
    clientId: 'c1',
    userId: 'Ada@Firm.example',
    scope: ['read'],
    metadata: { clientName: ' Claude ' },
    encryptedProps: 'opaque',
    createdAt: Date.parse(daysAgo(10)) / 1000,
    expiresAt: Date.parse(daysAhead(10)) / 1000,
  });
  assert.deepEqual(parseGrant(stored), { email: 'ada@firm.example', app: 'Claude', createdAt: daysAgo(10), expiresAt: daysAhead(10) });
  assert.equal(parseGrant('{"userId":"ada@firm.example"}'), null);
  assert.equal(parseGrant('not json'), null);
  assert.equal(parseGrant(JSON.stringify({ userId: 'cy@firm.example', createdAt: 1, metadata: null }))?.app, null);
});

test('parseKeyList keeps grant keys only', () => {
  const out = 'banner\n' + JSON.stringify([{ name: 'grant:ada@firm.example:g1' }, { name: 'client:c1' }, { name: 'token:x' }]);
  assert.deepEqual(parseKeyList(out), ['grant:ada@firm.example:g1']);
  assert.throws(() => parseKeyList('no json'), /no JSON/);
});

test('viaName matches how mcp/audit.ts stores the app name', () => {
  assert.equal(viaName('  Claude\u0007  Desktop '), 'Claude Desktop');
  assert.equal(viaName('x'.repeat(90)), 'x'.repeat(80));
  assert.equal(viaName('   '), null);
  assert.equal(viaName(null), null);
});

test('README.md "Quarterly access review" lists every flag with its command', () => {
  const readme = readFileSync(path.resolve(import.meta.dirname, '..', 'README.md'), 'utf8');
  const section = readme.split('### Quarterly access review')[1]?.split(/\n#{2,3} /)[0] ?? '';
  for (const [flag, action] of Object.entries(FLAG_ACTIONS)) {
    const row = section.split('\n').find((line) => line.startsWith(`| \`${flag}\` |`));
    assert.ok(row, `${flag} has a row`);
    for (const command of action.match(/npm run [^,]+<email>|\/connections/g) ?? []) assert.ok(row.includes(command), `${flag}: ${command}`);
  }
});

test('refuses CI, and reads a database without deal rooms as none', () => {
  assert.equal(inCi({ CI: 'true' }), true);
  assert.equal(inCi({ GITHUB_ACTIONS: 'true' }), true);
  assert.equal(inCi({}), false);
  assert.equal(isMissingRoomsTable('✘ no such table: room_members: SQLITE_ERROR'), true);
  assert.equal(isMissingRoomsTable('no such table: members'), false);
});
