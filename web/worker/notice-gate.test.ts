// SPDX-License-Identifier: Apache-2.0
// The full notice before first use (A3): the gate (notice-gate.ts) through the room's real handle() on real SQLite, as
// the localhost dev identity. full-notice.test.ts pins the words to docs/legal/product-notices.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Env } from './env.ts';
import { FIRST_USE_PRIVILEGE, FULL_NOTICE, NOTICE_TICK, NOTICE_VERSION } from './full-notice.ts';
import { inlineHtml, NOTICE_PATH, NOTICE_TICKS_PATH, safeNext } from './notice-gate.ts';
import { TICKED_TRIGGER } from './notice-fixtures.ts';
import { handle } from './room.ts';
import { testDb } from './sqlite-d1.ts';

test('the file\'s Markdown renders escaped, with A3\'s link to the privilege block and a placeholder as words', () => {
  assert.equal(
    inlineHtml('**Who** <b>x</b> & "y" it\'s [Privacy notice]. [Read more](#a7-privilege-and-confidentiality). [Elsewhere](https://x.example)'),
    '<strong>Who</strong> &lt;b&gt;x&lt;/b&gt; &amp; &quot;y&quot; it&#39;s Privacy notice. <a href="#privilege">Read more</a>. Elsewhere',
  );
});

test('after the tick, a member goes on only to a path on this room', () => {
  for (const path of ['/', '/documents/', '/doc/?id=abc&page=2', '/ask/#top']) assert.equal(safeNext(path), path);
  for (const bad of [null, '', 'documents', '//evil.example/', '/\\evil.example', 'https://evil.example/', '/a\nb', '/notice/', '/notice', '/notice/?next=/x', 'x'.repeat(2001)]) {
    assert.equal(safeNext(bad), '/', String(bad));
  }
});

const HOST = 'http://localhost:8789';
const OWNER = 'founder@example.test';
const COUNSEL = 'ada@firm.example';
const SAME_ORIGIN = { Origin: HOST, 'Sec-Fetch-Site': 'same-origin' };

/** The room with an owner and counsel, neither yet past the notice; `as` makes a request as one of them. */
function room() {
  const { db, sqlite } = testDb();
  sqlite.exec(`DROP TRIGGER ${TICKED_TRIGGER}`);
  sqlite.exec(`INSERT INTO members (email, role, name) VALUES ('${OWNER}', 'owner', 'Founder'), ('${COUNSEL}', 'counsel', NULL)`);
  const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined } as unknown as ExecutionContext;
  const as = (email: string, path: string, init: RequestInit = {}) => {
    const env = {
      ASSETS: { fetch: async () => new Response('<html>APP-SHELL</html>', { headers: { 'Content-Type': 'text/html' } }) },
      DB: db,
      TEAM_DOMAIN: '',
      ACCESS_AUD: '',
      ALLOW_DEV_IDENTITY: '1',
      DEV_IDENTITY_EMAIL: email,
      LEGALLAS_MODEL: 'x',
      DAILY_QUESTION_CAP: '100',
    } as unknown as Env;
    return handle(new Request(`${HOST}${path}`, init), env, ctx);
  };
  const tick = (email: string, fields: Record<string, string>, headers: Record<string, string> = SAME_ORIGIN) =>
    as(email, NOTICE_PATH, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'test-browser' },
      body: new URLSearchParams(fields).toString(),
    });
  const rows = () => sqlite.prepare('SELECT email, version, user_agent FROM notice_acks ORDER BY id').all().map((r) => ({ ...r }));
  return { as, tick, rows, sqlite };
}

test('until the tick, a member reaches only the notice: a page redirects there, anything else is refused', async () => {
  const { as, rows } = room();
  const page = await as(OWNER, '/documents/?q=bylaws');
  assert.equal(page.status, 303);
  assert.equal(page.headers.get('Location'), `${HOST}/notice/?next=${encodeURIComponent('/documents/?q=bylaws')}`);
  assert.equal((await as(OWNER, '/')).headers.get('Location'), `${HOST}/notice/`);
  for (const [path, init] of [['/api/me', {}], ['/api/documents', {}], ['/files/x', {}], ['/api/comments/x', { method: 'PATCH', headers: SAME_ORIGIN, body: '{}' }]] as const) {
    const res = await as(OWNER, path, init);
    assert.equal(res.status, 403, path);
    assert.deepEqual(await res.json(), { error: 'notice_required' }, path);
  }
  assert.deepEqual(rows(), []);
});

test('the notice page shows A3 in full, the privilege block, a required tick and sign-out, and runs no room script', async () => {
  const { as } = room();
  const res = await as(COUNSEL, '/notice/?next=/ask/');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('Content-Security-Policy') ?? '', /form-action 'self'/);
  const html = await res.text();
  assert.match(html, /<h1[^>]*>Before you use Legallas<\/h1>/);
  for (const line of [...FULL_NOTICE.slice(1), ...FIRST_USE_PRIVILEGE.map((line) => line.replace(/^- /, ''))]) assert.ok(html.includes(inlineHtml(line)), line);
  assert.ok(!/\*\*|\]\(|\[Privacy notice\]/.test(html), 'no Markdown left over');
  assert.ok(html.includes('<section class="door-help" id="privilege">') && html.includes('<a href="#privilege">Read more</a>'));
  assert.ok(html.includes(`<input type="checkbox" name="tick" value="1" required> ${inlineHtml(NOTICE_TICK)}`));
  assert.ok(html.includes(`name="version" value="${NOTICE_VERSION}"`) && html.includes('name="next" value="/ask/"'));
  assert.ok(html.includes('href="/cdn-cgi/access/logout">Sign out</a>'));
  assert.ok(!html.includes('<script'), 'no room script before the tick');
});

test('the tick is required on the server, and only for the version on screen', async () => {
  const { tick, rows } = room();
  const unticked = await tick(OWNER, { version: NOTICE_VERSION, next: '/ask/' });
  assert.equal(unticked.status, 400);
  assert.match(await unticked.text(), /Tick the box to continue\./);
  const stale = await tick(OWNER, { version: 'A3-00000000', tick: '1', next: '/ask/' });
  assert.equal(stale.status, 409);
  assert.match(await stale.text(), /This notice changed while you read it\./);
  const crossSite = await tick(OWNER, { version: NOTICE_VERSION, tick: '1' }, { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' });
  assert.equal(crossSite.status, 403);
  assert.deepEqual(rows(), [], 'nothing recorded');
});

test('the tick records the version and date per member, then the room opens; a new version asks again', async () => {
  const { as, tick, rows, sqlite } = room();
  const res = await tick(OWNER, { version: NOTICE_VERSION, tick: '1', next: '/documents/?q=bylaws' });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('Location'), `${HOST}/documents/?q=bylaws`);
  assert.deepEqual(rows(), [{ email: OWNER, version: NOTICE_VERSION, user_agent: 'test-browser' }]);
  const at = sqlite.prepare('SELECT ticked_at FROM notice_acks').get() as { ticked_at: string };
  assert.match(at.ticked_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.equal((await tick(OWNER, { version: NOTICE_VERSION, tick: '1' })).status, 303, 'a second tick is harmless');
  assert.equal(rows().length, 1);

  assert.equal(await (await as(OWNER, '/documents/')).text(), '<html>APP-SHELL</html>');
  const again = await (await as(OWNER, NOTICE_PATH)).text();
  assert.match(again, /You ticked this notice on \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC\./);
  assert.ok(!again.includes('<form'), 'read-only once ticked');
  assert.equal((await as(COUNSEL, '/documents/')).status, 303, 'each member ticks for themselves');

  // The words change: the room's rows hold an older version only, so the member is held back again.
  sqlite.exec(`UPDATE notice_acks SET version = 'A3-00000000'`);
  assert.equal((await as(OWNER, '/documents/')).status, 303);
});

test('the owner sees who ticked which version and when; counsel cannot', async () => {
  const { as, tick, sqlite } = room();
  await tick(OWNER, { version: NOTICE_VERSION, tick: '1' });
  await tick(COUNSEL, { version: NOTICE_VERSION, tick: '1' });
  sqlite.exec(`INSERT INTO members (email, role, name) VALUES ('new@firm.example', 'counsel', NULL)`);
  sqlite.exec(`UPDATE notice_acks SET version = 'A3-00000000' WHERE email = '${COUNSEL}'`);

  assert.equal((await as(COUNSEL, NOTICE_TICKS_PATH)).status, 403, 'counsel, held at the notice');
  sqlite.exec(`INSERT INTO notice_acks (email, version) VALUES ('${COUNSEL}', '${NOTICE_VERSION}')`);
  const refused = await as(COUNSEL, NOTICE_TICKS_PATH);
  assert.equal(refused.status, 403);
  assert.deepEqual(await refused.json(), { error: 'forbidden' });

  sqlite.exec(`DELETE FROM notice_acks WHERE email = '${COUNSEL}' AND version = '${NOTICE_VERSION}'`);
  const res = await as(OWNER, NOTICE_TICKS_PATH);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { current: string; members: { email: string; role: string; version: string | null; ticked_at: string | null; current: boolean }[] };
  assert.equal(body.current, NOTICE_VERSION);
  assert.deepEqual(body.members.map((m) => [m.email, m.role, m.version, m.ticked_at !== null, m.current]), [
    [COUNSEL, 'counsel', 'A3-00000000', true, false],
    [OWNER, 'owner', NOTICE_VERSION, true, true],
    ['new@firm.example', 'counsel', null, false, false],
  ]);
});
