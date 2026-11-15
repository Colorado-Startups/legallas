// SPDX-License-Identifier: Apache-2.0
// The investor's landing page and view page (routes/rooms.ts), end to end through the gate on real SQLite. The Data
// room page's rows point at these test names (quality-speed/pages/data-room/list.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACCESS_ADD } from '../scripts/room.ts';
import { resetDocFactsCache } from './doc-facts-serve.ts';
import { GUEST_NOTICE } from './guest-notice.ts';
import { connectLink } from './invite.ts';
import { handle } from './index.ts';
import type { Env } from './env.ts';
import { DOC, HOST, invite, IVY, ROOM_A, roomsDb, roomsEnv } from './rooms-fixtures.ts';

const ctx = { waitUntil: () => undefined } as unknown as ExecutionContext;

function client(db: D1Database) {
  const assets: string[] = [];
  const as = async (path: string) => {
    resetDocFactsCache();
    const made = roomsEnv(db, IVY);
    const response = await handle(new Request(`${HOST}${path}`), made.env, ctx);
    assets.push(...made.assets);
    return response;
  };
  return { as, assets };
}

test('an investor\'s landing page puts the deck and summary first, one click away, wherever they sit in the folders', async () => {
  const { db, sqlite } = roomsDb();
  const add = (n: number, path: string) => {
    const slash = path.lastIndexOf('/');
    sqlite
      .prepare("INSERT INTO documents (id, path, folder, name, kind, content_type, size, r2_key, source, updated_at) VALUES (?1, ?2, ?3, ?4, 'pdf', 'application/pdf', 10, ?5, 'mirror', '2026-02-01T00:00:00.000Z')")
      .run(`00000000-0000-4000-8000-0000000002${n}`, path, path.slice(0, slash), path.slice(slash + 1), `r2-${n}`);
    return `00000000-0000-4000-8000-0000000002${n}`;
  };
  const summary = add(10, 'Deals/Harbor Seed/Overview/Executive Summary.pdf');
  const deck = add(11, 'Deals/Harbor Seed/Pitch/2026/Harbor Labs Pitch Deck.pdf');
  add(12, 'Deals/Harbor Seed/Decking contract.pdf');
  const { as, assets } = client(db);

  const home = await (await as('/')).text();
  // Ivy is in two rooms that show the same folder (the fixture's ROOM_C); each lists its own Start here.
  const lists = [...home.matchAll(/<ul class="door-steps" data-start-here>(.*?)<\/ul>/g)].map((m) => m[1]!);
  const start = lists.find((list) => list.includes(`/rooms/${ROOM_A}/`)) ?? '';
  const hrefs = [...start.matchAll(/<a href="([^"]+)">([^<]+)<\/a>/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(hrefs, [
    [`/rooms/${ROOM_A}/view/${deck}`, 'Harbor Labs Pitch Deck.pdf'],
    [`/rooms/${ROOM_A}/view/${summary}`, 'Executive Summary.pdf'],
  ], 'the deck, then the summary, from nested folders, and never a name that only contains "deck"');
  assert.ok(home.indexOf('data-start-here') < home.indexOf(DOC.term.path.split('/').pop()!), 'before the rest of the room');

  // One click: the link is the document's view page, which draws the PDF with no download button.
  const view = await as(`/rooms/${ROOM_A}/view/${deck}`);
  assert.equal(view.status, 200);
  const page = await view.text();
  assert.match(page, new RegExp(`data-src="/api/rooms/${ROOM_A}/files/${deck}"`));
  assert.match(page, /<script type="module" src="\/guest\/viewer\.js"><\/script>/);
  assert.doesNotMatch(page, /download/i);
  assert.equal((await as(`/rooms/${ROOM_A}/view/${DOC.otherCase.id}`)).status, 404, 'a document outside the room reads as missing');

  // The viewer's three files are the only assets a guest is served; anything else under /guest/ is a 404.
  for (const path of ['/guest/viewer.js', '/guest/pdf.min.mjs', '/guest/pdf.worker.min.mjs']) assert.equal((await as(path)).status, 200, path);
  assert.equal((await as('/guest/other.js')).status, 404);
  assert.deepEqual(assets, ['/guest/viewer.js', '/guest/pdf.min.mjs', '/guest/pdf.worker.min.mjs']);
});

test('a viewer file missing from the build is a plain 404 for a guest, never the room\'s own 404 page', async () => {
  const { db } = roomsDb();
  resetDocFactsCache();
  const { env } = roomsEnv(db, IVY);
  const missing = { ...env, ASSETS: { fetch: async () => new Response('<html>APP-SHELL 404</html>', { status: 404 }) } } as unknown as Env;
  const res = await handle(new Request(`${HOST}/guest/viewer.js`), missing, ctx);
  assert.equal(res.status, 404);
  assert.doesNotMatch(await res.text(), /APP-SHELL/);
});

test('from invitation to first document in 3 steps or fewer, with no account to create', async () => {
  const { db, sqlite } = roomsDb();
  const NIA = 'nia@fund.example';
  const now = Date.now();
  invite(sqlite, { room: ROOM_A, email: NIA, invitedAt: new Date(now - 3_600_000).toISOString(), acceptBy: new Date(now + 86_400_000).toISOString(), joinedAt: null });
  const as = async (path: string) => {
    resetDocFactsCache();
    return handle(new Request(`${HOST}${path}`), roomsEnv(db, NIA).env, ctx);
  };
  // Step 1: open the room link the owner sent. Step 2: sign in with Access's one-time PIN, the only sign-in there is
  // (the gate below sees its verified email). Both land on the guest's page, which needs no account or setup.
  const landing = await as('/');
  assert.equal(landing.status, 200);
  const first = /<a href="(\/rooms\/[^"]+)">/.exec(await landing.text())?.[1];
  assert.ok(first, 'the landing page links straight to a document');
  // Step 3: one click opens it.
  const view = await as(first);
  assert.equal(view.status, 200);
  assert.match(await view.text(), /data-src="\/api\/rooms\/|<img class="guest-image"|opens here soon/);
  assert.deepEqual(sqlite.prepare('SELECT email FROM members WHERE email = ?1').all(NIA), [], 'no account is made');
  assert.ok((sqlite.prepare('SELECT joined_at FROM room_members WHERE email = ?1').get(NIA) as { joined_at: string | null }).joined_at, 'the first request used the invitation');
});

test('the landing page lists every folder, a last-updated date and a named contact', async () => {
  const { db, sqlite } = roomsDb();
  // A nested folder shared on its own, with a newer file, and a shared folder with nothing in it yet.
  for (const folder of ['Deals/Harbor Seed/Financials', 'Board/Consents']) {
    sqlite.prepare("INSERT INTO room_folders (id, room_id, folder, added_by) VALUES (?1, ?2, ?3, 'owner-cli')").run(`${ROOM_A}:${folder}`, ROOM_A, folder);
  }
  sqlite
    .prepare("INSERT INTO documents (id, path, folder, name, kind, content_type, size, r2_key, source, updated_at) VALUES (?1, ?2, ?3, ?4, 'pdf', 'application/pdf', 10, 'r2-model', 'mirror', '2026-03-05T09:00:00.000Z')")
    .run('00000000-0000-4000-8000-000000000301', 'Deals/Harbor Seed/Financials/Operating model.pdf', 'Deals/Harbor Seed/Financials', 'Operating model.pdf');
  const { as } = client(db);
  const home = await (await as('/')).text();
  const section = home.split('<h2').find((part) => part.includes('Harbor Labs seed</h2>')) ?? '';

  assert.match(section, /data-updated>Last updated 2026-03-05\.</, 'the room\'s newest file');
  const heads = [...section.matchAll(/data-folder><strong>([^<]+)<\/strong>, ([^<]+)<\/p>/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(heads, [
    ['Consents', 'no documents yet'],
    ['Harbor Seed', 'updated 2026-02-01'],
    ['Financials', 'updated 2026-03-05'],
  ], 'every shared folder, by its own name, never the path above it');
  assert.doesNotMatch(section, /Deals\//);
  assert.equal(section.split('Operating model.pdf').length - 1, 1, 'a file is listed once, under its nearest shared folder');
  assert.match(home, /data-contact>Questions about this room: <a href="mailto:email@example\.com">email@example\.com<\/a>/);
});

test('the first page and the invitation carry the confidentiality and logging statements', async () => {
  const { db } = roomsDb();
  const { as } = client(db);
  const home = await (await as('/')).text();
  assert.match(GUEST_NOTICE, /^Confidential\./);
  assert.match(GUEST_NOTICE, /logs each document you open, with your email and the time/);
  const notice = home.indexOf(`data-notice>${GUEST_NOTICE}</p>`);
  assert.ok(notice > 0, 'on the first page');
  assert.ok(notice < home.indexOf('<a href="/rooms/'), 'before any document link');
  assert.ok(ACCESS_ADD(IVY, 'investor').includes(GUEST_NOTICE), 'in what the owner is told to send with the link');
});

test('an investor\'s first page leads with Connect your AI, after the notice and before any document', async () => {
  const { db } = roomsDb();
  const { as } = client(db);
  const home = await (await as('/')).text();
  const link = `<a class="door-button" href="${connectLink('investor')}" data-connect>Connect your AI</a>`;
  assert.equal(home.split(link).length - 1, 1, 'one button, to the investor\'s panel');
  assert.ok(home.indexOf('data-notice') < home.indexOf(link) && home.indexOf(link) < home.indexOf('<a href="/rooms/'), 'notice, AI, documents');
  const invite = ACCESS_ADD(IVY, 'investor');
  assert.ok(invite.includes(connectLink('investor')) && invite.indexOf(connectLink('investor')) < invite.indexOf(GUEST_NOTICE), 'the invitation: the link, then the notice');
  assert.ok(!ACCESS_ADD(IVY, 'counsel').includes('/connect'), 'a matter room\'s counsel may not connect yet: the room link alone');
});
