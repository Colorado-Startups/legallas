// SPDX-License-Identifier: Apache-2.0
// The checklist's routes through the real gate on real SQLite. Invented fixture (Harbor Labs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ChecklistView } from './checklist.ts';
import { removeMatch } from './checklist-store.ts';
import type { ServedChecklist } from './company-settings.ts';
import type { Env } from './env.ts';
import { roleWithout } from './gate-fixtures.ts';
import { handle } from './room.ts';
import { testDb } from './sqlite-d1.ts';

const HOST = 'http://localhost:8789';
const OWNER = 'founder@example.test';
const COUNSEL = 'counsel@example.test';

function room(signedInAs = OWNER, enabled: string | null = '1') {
  const { db, sqlite } = testDb();
  sqlite.exec(`
    INSERT INTO members (email, role, name) VALUES ('${OWNER}', 'owner', 'Founder'), ('${COUNSEL}', 'counsel', 'Counsel');
    INSERT INTO documents (id, path, folder, name, kind, content_type, size, r2_key, source, updated_at, removed_at) VALUES
      ('doc-1', 'Company/Bylaws.pdf', 'Company', 'Bylaws.pdf', 'pdf', 'application/pdf', 1, 'k1', 'mirror', '2026-03-01T00:00:00.000Z', NULL),
      ('doc-gone', 'Company/Old.pdf', 'Company', 'Old.pdf', 'pdf', 'application/pdf', 1, 'k2', 'mirror', '2026-03-01T00:00:00.000Z', '2026-04-01T00:00:00.000Z'),
      ('doc-data', 'legallas-visuals.json', '', 'legallas-visuals.json', 'text', 'application/json', 1, 'k3', 'mirror', '2026-03-01T00:00:00.000Z', NULL);
  `);
  const env = {
    ASSETS: { fetch: async () => new Response('shell') },
    DB: db,
    TEAM_DOMAIN: '',
    ACCESS_AUD: '',
    ALLOW_DEV_IDENTITY: '1',
    DEV_IDENTITY_EMAIL: signedInAs,
    ...(enabled === null ? {} : { CHECKLIST_ENABLED: enabled }),
  } as unknown as Env;
  const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
    handle(
      new Request(`${HOST}${path}`, {
        method,
        headers: { ...(method === 'GET' ? {} : { Origin: HOST, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' }), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      env,
      {} as ExecutionContext,
    );
  const count = (table: string) => (sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  return { call, rows: () => count('checklist_matches'), saves: () => count('company_settings') };
}

const ROUTES: [string, string][] = [
  ['GET', '/api/checklist'],
  ['GET', '/api/checklist/summary'],
  ['GET', '/api/checklist/questions'],
  ['POST', '/api/checklist/matches'],
  ['DELETE', '/api/checklist/matches/some-id'],
  ['PUT', '/api/checklist/items/formation.bylaws/applies'],
  ['PUT', '/api/checklist/company'],
];
const MATCH = { itemId: 'formation.bylaws', documentId: 'doc-1' };

test('off, every route answers exactly like a path that does not exist', async () => {
  for (const value of [null, '0', 'true']) {
    const { call } = room(OWNER, value);
    for (const [method, path] of ROUTES) {
      const off = await call(method, path, method === 'GET' ? undefined : {});
      const unknown = await call(method, path.replace('checklist', 'no-such-thing'), method === 'GET' ? undefined : {});
      assert.deepEqual([off.status, await off.text()], [unknown.status, await unknown.text()], `${value} ${method} ${path}`);
    }
    assert.equal(Object.hasOwn((await (await call('GET', '/api/me')).json()) as object, 'checklist'), false);
  }
});

test('a stranger gets nothing, and another site can neither write nor download', async () => {
  const stranger = room('stranger@example.test');
  for (const [method, path] of ROUTES) assert.equal((await stranger.call(method, path, method === 'GET' ? undefined : {})).status, 403, path);
  const { call, rows, saves } = room();
  const cross = { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' };
  assert.equal((await call('POST', '/api/checklist/matches', MATCH, cross)).status, 403);
  assert.equal((await call('PUT', '/api/checklist/company', { entityType: 'colorado-llc' }, cross)).status, 403);
  assert.equal((await call('GET', '/api/checklist/questions', undefined, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal(rows(), 0);
  assert.equal(saves(), 0);
});

test('a person matches a document, the list says where it lives, and removing the match leaves the document', async () => {
  const { call, rows } = room();
  const list = async () => (await (await call('GET', '/api/checklist')).json()) as ChecklistView;
  assert.equal((await call('POST', '/api/checklist/matches', { ...MATCH, signed: 'yes', date: '2026-10-20', parties: 'Jane Doe', amount: '$400' })).status, 200);
  let bylaws = (await list()).items.find((item) => item.id === 'formation.bylaws');
  assert.equal(bylaws?.status, 'in_place');
  const match = bylaws?.matches[0];
  assert.deepEqual([match?.where, match?.href, match?.parties, match?.amount, match?.matchedBy], ['Company/Bylaws.pdf', '/doc/?id=doc-1', 'Jane Doe', '$400', OWNER]);
  // The same pair again updates the one row, and a fact left out keeps what's on record.
  await call('POST', '/api/checklist/matches', { ...MATCH, signed: 'no' });
  assert.equal(rows(), 1);
  bylaws = (await list()).items.find((item) => item.id === 'formation.bylaws');
  assert.equal(bylaws?.status, 'check');
  assert.deepEqual([bylaws?.matches[0]?.date, bylaws?.matches[0]?.parties], ['2026-10-20', 'Jane Doe']);
  assert.equal((await call('DELETE', `/api/checklist/matches/${match?.id}`)).status, 200);
  bylaws = (await list()).items.find((item) => item.id === 'formation.bylaws');
  assert.deepEqual(bylaws?.matches, []);
});

test('a match can name only a live, listed document, and bad input is refused', async () => {
  const { call, rows } = room();
  for (const documentId of ['doc-gone', 'doc-data', 'no-such-doc']) assert.equal((await call('POST', '/api/checklist/matches', { ...MATCH, documentId })).status, 404, documentId);
  assert.deepEqual(await (await call('POST', '/api/checklist/matches', { ...MATCH, date: '2026-02-30' })).json(), { error: 'invalid_request', field: 'date' });
  assert.equal((await call('POST', '/api/checklist/matches', { itemId: 'no.such-item', documentId: 'doc-1' })).status, 400);
  assert.equal(rows(), 0);
});

test('removing a match that is not there answers 404 and removes nothing', async () => {
  const { call, rows } = room();
  assert.equal((await call('POST', '/api/checklist/matches', MATCH)).status, 200);
  const missing = await call('DELETE', '/api/checklist/matches/no-such-match');
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: 'not_found' });
  assert.equal(rows(), 1);
});

test('removing a match applies the privilege check, like every read and save', async () => {
  // No role with `flag` lacks viewPrivileged today, so this calls the store as the retired family role, which the gate
  // would refuse first, to prove the second wall holds on its own.
  const { db, sqlite } = testDb();
  sqlite.exec(`
    INSERT INTO documents (id, path, folder, name, kind, content_type, size, r2_key, source, updated_at) VALUES
      ('doc-open', 'Company/DOE-bylaws.pdf', 'Company', 'DOE-bylaws.pdf', 'pdf', 'application/pdf', 1, 'k1', 'mirror', '2026-03-01T00:00:00.000Z'),
      ('doc-priv', 'Counsel-PRIVILEGED/DOE-memo.pdf', 'Counsel-PRIVILEGED', 'DOE-memo.pdf', 'pdf', 'application/pdf', 1, 'k2', 'mirror', '2026-03-01T00:00:00.000Z');
    INSERT INTO checklist_matches (id, item_id, document_id, matched_by, matched_at) VALUES
      ('m-open', 'formation.bylaws', 'doc-open', '${OWNER}', '2026-03-02T00:00:00.000Z'),
      ('m-priv', 'formation.bylaws', 'doc-priv', '${OWNER}', '2026-03-02T00:00:00.000Z');
  `);
  const left = () => (sqlite.prepare('SELECT id FROM checklist_matches ORDER BY id').all() as { id: string }[]).map((row) => row.id);
  const retired = roleWithout('viewPrivileged');
  assert.equal(await removeMatch(db, retired, 'm-priv', OWNER, new Date()), false);
  assert.equal(await removeMatch(db, retired, 'no-such-match', OWNER, new Date()), false);
  assert.deepEqual(left(), ['m-open', 'm-priv']);
  assert.equal(await removeMatch(db, retired, 'm-open', OWNER, new Date()), true);
  assert.equal(await removeMatch(db, 'owner', 'm-priv', OWNER, new Date()), true);
  assert.deepEqual(left(), []);
});

test('a person says an item does not apply, and can take it back', async () => {
  const { call } = room();
  const status = async () => ((await (await call('GET', '/api/checklist')).json()) as ChecklistView).items.find((item) => item.id === 'formation.bank-account')?.status;
  await call('PUT', '/api/checklist/items/formation.bank-account/applies', { applies: false });
  assert.equal(await status(), 'not_applicable');
  await call('PUT', '/api/checklist/items/formation.bank-account/applies', { applies: true });
  assert.equal(await status(), 'missing');
});

test('the questions download as an attachment that says what it is', async () => {
  const { call } = room();
  const response = await call('GET', '/api/checklist/questions');
  assert.equal(response.headers.get('content-type'), 'text/markdown; charset=utf-8');
  assert.match(response.headers.get('content-disposition') ?? '', /^attachment; filename="questions-for-your-lawyer-/);
  assert.match(await response.text(), /not a lawyer or law firm/);
});

test('the owner sets the company facts with no redeploy, and the items and dates follow', async () => {
  const { call, saves } = room();
  const list = async () => (await (await call('GET', '/api/checklist')).json()) as ServedChecklist;
  const has = (view: ChecklistView, id: string) => view.items.some((item) => item.id === id);
  let view = await list();
  assert.deepEqual([view.company.entityType, view.company.formationDate, view.company.reportMonth, view.company.setBy, view.company.editable], [null, null, null, null, true]);
  assert.ok(view.company.entityTypes.some((type) => type.id === 'colorado-llc' && type.label.length > 0));
  assert.ok(has(view, 'formation.bylaws') && has(view, 'formation.operating-agreement'), 'nothing set: every item shows');

  const saved = await call('PUT', '/api/checklist/company', { entityType: 'delaware-c-corporation', formationDate: '2026-02-10', reportMonth: '9' });
  assert.equal(saved.status, 200);
  view = (await saved.json()) as ServedChecklist;
  assert.deepEqual([view.company.reportMonth, view.company.setBy], [9, OWNER]);
  assert.equal(saves(), 1);
  // The next read, as any page or AI would make it, says the same.
  view = await list();
  assert.deepEqual([view.formationDate, view.reportMonth, view.company.entityType], ['2026-02-10', 9, 'delaware-c-corporation']);
  assert.ok(has(view, 'formation.bylaws'));
  assert.equal(has(view, 'formation.operating-agreement'), false, 'a corporation keeps no operating agreement');
  const report = view.items.find((item) => item.id === 'compliance-and-governance.colorado-periodic-report');
  assert.notEqual(report?.status, 'if_applies', 'a report month means Colorado authority');
  assert.match(report?.dates[0]?.opens ?? '', /-07-01$/, 'the window opens two months before September');
  assert.match(report?.dates[0]?.date ?? '', /-11-30$/, 'and closes two months after');
  const summary = (await (await call('GET', '/api/checklist/summary')).json()) as { reportMonth: unknown; formationDate: unknown };
  assert.deepEqual([summary.formationDate, summary.reportMonth], ['2026-02-10', 9]);

  // An LLC: the items change on the very next read.
  view = (await (await call('PUT', '/api/checklist/company', { entityType: 'colorado-llc' })).json()) as ServedChecklist;
  assert.deepEqual([has(view, 'formation.bylaws'), has(view, 'formation.operating-agreement')], [false, true]);
  assert.equal(view.formationDate, '2026-02-10', 'a fact left out keeps what is in force');
});

test('only the owner may change the facts: counsel reads them, is refused, and nothing is saved', async () => {
  const { call, saves } = room(COUNSEL);
  const view = (await (await call('GET', '/api/checklist')).json()) as ServedChecklist;
  assert.equal(view.company.editable, false);
  const refused = await call('PUT', '/api/checklist/company', { entityType: 'colorado-llc' });
  assert.equal(refused.status, 403);
  assert.deepEqual(await refused.json(), { error: 'forbidden' });
  assert.equal(saves(), 0);
});

test('a fact the list cannot use is refused by name, and nothing is saved', async () => {
  const { call, saves } = room();
  const bad: [Record<string, unknown>, string][] = [
    [{ entityType: 'nevada-llc' }, 'entityType'],
    [{ formationDate: '2026-02-30' }, 'formationDate'],
    [{ formationDate: '2999-01-01' }, 'formationDate'],
    [{ reportMonth: 13 }, 'reportMonth'],
  ];
  for (const [body, field] of bad) {
    const response = await call('PUT', '/api/checklist/company', body);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.deepEqual(await response.json(), { error: 'invalid_request', field });
  }
  assert.equal((await call('PUT', '/api/checklist/company', [])).status, 400);
  assert.equal(saves(), 0);
});
