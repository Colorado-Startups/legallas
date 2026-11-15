// SPDX-License-Identifier: Apache-2.0
// The CSV index (worker/export.ts, D17): formula cells are defused, and GET /api/documents/index.csv lists exactly
// what /api/documents shows the member, through the real gate in room.ts on real SQLite with migrations applied.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SignJWT, generateKeyPair } from 'jose';
import { parseCsv } from '../src/scripts/csv.ts';
import { docTitle } from '../src/scripts/doc-titles.ts';
import { resetDocFactsCache } from './doc-facts-serve.ts';
import type { Env, Role } from './env.ts';
import { COMPANY_INDEX_HEADER, csvCell, exportPrefix, INDEX_CSV_PATH, INDEX_HEADER, indexCsv } from './export.ts';
import { addLeftoverFamily } from './gate-fixtures.ts';
import { handle } from './room.ts';
import { MATTER_KEY } from './matter-types.ts';
import { testDb } from './sqlite-d1.ts';

const HOST = 'http://localhost:8789';
// A production-shaped host: the dev identity never applies there, so requests carry a locally signed Access token.
const ROOM_HOST = 'https://legallas.example.test';
const TEAM = 'https://legallas-test.cloudflareaccess.com';
const AUD = 'aud-tag-1';
const { publicKey, privateKey } = await generateKeyPair('RS256');
const PEOPLE: Record<Role, string> = { owner: 'founder@example.test', counsel: 'ada@firm.example' };
const KIN = 'kin@mail.example';
const FIXTURES = join(import.meta.dirname, '..', 'fixtures');
const MATTER = readFileSync(join(FIXTURES, 'matter.example.json'), 'utf8');
// Two fixture documents the DOE manifest has facts for (an email, 2011-05-18; the stock agreement, 2011-06-07).
const PITCH = '3ca16727-48f1-428a-a97b-d50f2c50eed4';
const AGREEMENT = 'c9d5082d-fa62-4459-aec7-d33805164eca';

beforeEach(() => resetDocFactsCache());

test('csvCell defuses every formula start and quotes every field', () => {
  const formulas = [
    '=1+1', '+1', '-2', '@SUM(A1)', '\t=1', '\r=1', '\n=1', '\uFF1D1', '=HYPERLINK("https://x.test","y")',
    ' =1', '   +SUM(A1)', '\u00A0=1', '\u3000@x', ' \uFF0B1', '\tplain', '\rplain', '\nplain',
  ];
  for (const value of formulas) {
    const cell = csvCell(value);
    assert.ok(cell.startsWith(`"'`), `${JSON.stringify(value)} -> ${cell}`);
  }
  assert.equal(csvCell('=HYPERLINK("a")'), `"'=HYPERLINK(""a"")"`, 'the apostrophe goes inside the quotes; inner quotes doubled');
  assert.equal(csvCell(' =1'), `"' =1"`, 'leading whitespace does not hide a formula');
  assert.equal(csvCell('Email, Richard Roe, Vesting terms'), '"Email, Richard Roe, Vesting terms"');
  assert.equal(csvCell('two\nlines'), '"two\nlines"');
  assert.equal(csvCell('DOE-000001'), '"DOE-000001"', 'a control number is not a formula');
  assert.equal(csvCell('2011-05-18'), '"2011-05-18"');
  assert.equal(csvCell('  indented title'), '"  indented title"', 'whitespace before plain text is left alone');
  assert.equal(csvCell('a = b'), '"a = b"', 'only the start of a cell counts');
  assert.equal(csvCell(''), '""');
});

test('indexCsv: a byte order mark, the header, CRLF lines, and Yes or No for the marks', () => {
  const csv = indexCsv([
    { control: 'DOE-000001', title: '-draft', name: '-draft.pdf', folder: 'a', date: '', type: '', parties: '', privileged: true, key: false, link: 'https://x.test/doc/?id=1' },
  ]);
  assert.ok(csv.startsWith('﻿"Control no.","Title"'));
  assert.ok(csv.endsWith('\r\n'));
  const { rows } = parseCsv(csv, 10);
  assert.deepEqual(rows[0], [...INDEX_HEADER]);
  assert.deepEqual(rows[1], ['DOE-000001', "'-draft", "'-draft.pdf", 'a', '', '', 'Yes', 'No', 'https://x.test/doc/?id=1']);
  assert.equal(rows.length, 2);
});

type Seed = { id: string; path: string; source?: 'mirror' | 'counsel'; removed?: boolean; key?: boolean; seq?: number | null };

const ROOM: Seed[] = [
  { id: PITCH, path: '04-Letters/Email__20110518__Richard-Roe__Vesting-terms.pdf', key: true },
  { id: AGREEMENT, path: '01-Corporate-Records/Stock-Agreement__20110607__Harbor-Labs.pdf' },
  { id: 'call', path: '07-Lawyer-Notes-PRIVILEGED/witness-call.pdf' },
  { id: 'named', path: '04-Letters/memo-privileged.pdf' },
  { id: 'formula', path: '02-Board-Minutes/=HYPERLINK("https:x.test")+1.pdf' },
  { id: 'guide', path: '02-Board-Minutes/CLAUDE.md' },
  { id: 'binder', path: 'Visuals/legallas-visuals.json' },
  { id: 'gone', path: '02-Board-Minutes/old.pdf', removed: true },
  { id: 'up', path: 'from-counsel/up/notes.pdf', source: 'counsel' },
  { id: 'later', path: '02-Board-Minutes/unnumbered.pdf', seq: null },
];

interface RoomOptions {
  matter?: string | null;
  /** The CONTROL_PREFIX secret; "DOE" unless given (undefined leaves it unset). */
  prefix?: string | undefined;
  /** Serve on a production-shaped host behind a signed Access token instead of the localhost dev identity. */
  production?: boolean;
  /** Sign in as this email, holding a members row with the retired family role (only a row from before 0010 can). */
  leftover?: string;
  /** Room settings, such as COMPANY_ROOM_ENABLED and CHECKLIST_ENABLED. */
  settings?: Record<string, string>;
  /** Checklist matches: a document matched to an item, with the key facts a person entered. */
  matches?: { item: string; doc: string; date?: string; parties?: string }[];
}

/** Real SQLite with the two members and the room, a legallas-files fake holding the manifest, and a GET helper. */
function room(as: Role, options: RoomOptions = {}) {
  const { matter = MATTER, production = false } = options;
  const prefix = Object.hasOwn(options, 'prefix') ? options.prefix : 'DOE';
  const signedIn = options.leftover ?? PEOPLE[as];
  const { db, sqlite } = testDb();
  for (const [role, email] of Object.entries(PEOPLE)) sqlite.prepare('INSERT INTO members (email, role, name) VALUES (?1, ?2, NULL)').run(email, role);
  if (options.leftover) addLeftoverFamily(sqlite, options.leftover);
  const insert = sqlite.prepare(
    'INSERT INTO documents (id, path, folder, name, kind, content_type, size, pages, r2_key, source, updated_at, removed_at, control_seq, key_at, key_by) ' +
      "VALUES (?1, ?2, ?3, ?4, 'pdf', 'application/pdf', 4, 1, ?5, ?6, '2026-10-01T00:00:00.000Z', ?7, ?8, ?9, ?10)",
  );
  ROOM.forEach((d, i) => {
    const slash = d.path.lastIndexOf('/');
    const key = d.key ? '2026-10-06T00:00:00.000Z' : null;
    insert.run(d.id, d.path, d.path.slice(0, slash), d.path.slice(slash + 1), `k-${d.id}`, d.source ?? 'mirror',
      d.removed ? '2026-10-03T00:00:00.000Z' : null, d.seq === undefined ? i + 1 : d.seq, key, key && PEOPLE.counsel);
  });
  const match = sqlite.prepare(
    "INSERT INTO checklist_matches (id, item_id, document_id, doc_date, parties, matched_by, matched_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, '2026-10-05T00:00:00.000Z')",
  );
  options.matches?.forEach((m, i) => match.run(`m${i}`, m.item, m.doc, m.date ?? null, m.parties ?? null, PEOPLE.owner));
  const files = {
    async get(key: string) {
      if (key !== MATTER_KEY || matter === null) return null;
      return { key, etag: 'e1', size: matter.length, body: new Response(matter).body, text: async () => matter };
    },
    // A room with no published matter is a company room while COMPANY_ROOM_ENABLED is "1" (room-shape.ts).
    async head(key: string) {
      return key === MATTER_KEY && matter !== null ? { key, etag: 'e1', size: matter.length } : null;
    },
  };
  // ALLOW_DEV_IDENTITY stays "1" on the production host too: it must not reopen the dev fallback there.
  const env = {
    ASSETS: { fetch: async () => new Response('shell') }, DB: db, FILES: files, ALERTS_ENABLED: '0',
    TEAM_DOMAIN: production ? TEAM : '', ACCESS_AUD: production ? AUD : '', ALLOW_DEV_IDENTITY: '1', DEV_IDENTITY_EMAIL: signedIn,
    ...(prefix === undefined ? {} : { CONTROL_PREFIX: prefix }),
    ...options.settings,
  } as unknown as Env;
  const ctx = { waitUntil: () => undefined, passThroughOnException() {} } as unknown as ExecutionContext;
  const get = async (headers: Record<string, string> = { 'Sec-Fetch-Site': 'same-origin' }) => {
    if (!production) return handle(new Request(`${HOST}${INDEX_CSV_PATH}`, { headers }), env, ctx);
    const jwt = await new SignJWT({ email: signedIn, type: 'app', country: 'US' })
      .setProtectedHeader({ alg: 'RS256' }).setIssuer(TEAM).setAudience(AUD).setIssuedAt().setExpirationTime('5m').sign(privateKey);
    const request = new Request(`${ROOM_HOST}${INDEX_CSV_PATH}`, { headers: { ...headers, 'Cf-Access-Jwt-Assertion': jwt } });
    return handle(request, env, ctx, async () => publicKey);
  };
  const audits = () => sqlite.prepare('SELECT email, action, document_id, via FROM audit_log').all().map((r) => ({ ...r }));
  return { get, audits };
}

async function exported(as: Role): Promise<{ rows: string[][]; audits: Record<string, unknown>[]; response: Response }> {
  const r = room(as);
  const response = await r.get();
  assert.equal(response.status, 200, as);
  return { rows: parseCsv(await response.text(), 1000).rows, audits: r.audits(), response };
}

const byLink = (rows: string[][], id: string) => rows.find((row) => row[8] === `${HOST}/doc/?id=${encodeURIComponent(id)}`);

test('owner and counsel: hidden, removed rows and folder guides are left out; the rest are listed in control-number order', async () => {
  for (const role of ['owner', 'counsel'] as const) {
    const { rows } = await exported(role);
    assert.deepEqual(rows[0], [...INDEX_HEADER], role);
    const links = rows.slice(1).map((row) => row[8]);
    const want = [PITCH, AGREEMENT, 'call', 'named', 'formula', 'up', 'later'].map((id) => `${HOST}/doc/?id=${encodeURIComponent(id)}`);
    assert.deepEqual(links, want, 'control-number order, unnumbered last');
    const text = rows.flat().join('\n');
    for (const word of ['legallas-visuals', 'old.pdf', 'CLAUDE.md']) assert.equal(text.includes(word), false, `${role}: ${word}`);
  }
});

test('a family row left from before migration 0010 is refused the export at the gate, and nothing is audited', async () => {
  for (const production of [false, true]) {
    const r = room('owner', { leftover: KIN, production });
    const response = await r.get();
    assert.equal(response.status, 403, `production ${production}`);
    assert.doesNotMatch(await response.text(), /DOE-0000|witness-call|Vesting-terms/);
    assert.deepEqual(r.audits(), []);
  }
});

test('counsel and owner: every live document, with privileged ones designated', async () => {
  for (const role of ['counsel', 'owner'] as const) {
    const { rows } = await exported(role);
    assert.equal(rows.length - 1, 7, role);
    assert.equal(byLink(rows, 'call')![6], 'Yes', 'a privileged folder');
    assert.equal(byLink(rows, 'named')![6], 'Yes', 'a privileged file name');
    assert.equal(byLink(rows, 'guide'), undefined, 'a folder guide is the folder guide, not a row');
    assert.equal(byLink(rows, 'binder'), undefined);
    assert.equal(byLink(rows, 'gone'), undefined);
  }
});

test('rows carry the table designations, control numbers, Key and a room link', async () => {
  const { rows } = await exported('counsel');
  const pitch = byLink(rows, PITCH)!;
  assert.deepEqual(pitch, [
    'DOE-000001', docTitle('Email__20110518__Richard-Roe__Vesting-terms.pdf'), 'Email__20110518__Richard-Roe__Vesting-terms.pdf', '04-Letters',
    '2011-05-18', 'Email', 'No', 'Yes', `${HOST}/doc/?id=${PITCH}`,
  ]);
  const agreement = byLink(rows, AGREEMENT)!;
  assert.deepEqual([agreement[0], agreement[4], agreement[7]], ['DOE-000002', '2011-06-07', 'No']);
  assert.equal(byLink(rows, 'up')![3], 'from-counsel', 'counsel uploads share their folder');
  assert.equal(byLink(rows, 'later')![0], '', 'an unnumbered document has a blank control number');
  const formula = byLink(rows, 'formula')!;
  assert.ok(formula[1]!.startsWith("'=") && formula[2]!.startsWith("'="), 'a formula-shaped name is defused in every cell');
  assert.deepEqual([formula[4], formula[5]], ['', ''], 'no manifest facts: blank date and type');
});

test('one download audit row per export, via index-csv, with no document id', async () => {
  const r = room('counsel');
  await r.get();
  await r.get();
  assert.deepEqual(r.audits(), [
    { email: PEOPLE.counsel, action: 'download', document_id: null, via: 'index-csv' },
    { email: PEOPLE.counsel, action: 'download', document_id: null, via: 'index-csv' },
  ]);
});

test('a download: CSV type, attachment name, sandboxed and never cached', async () => {
  const { response } = await exported('owner');
  assert.equal(response.headers.get('Content-Type'), 'text/csv; charset=utf-8');
  assert.match(response.headers.get('Content-Disposition') ?? '', /^attachment; filename="DOE-index-\d{4}-\d{2}-\d{2}\.csv"/);
  assert.match(response.headers.get('Content-Security-Policy') ?? '', /^sandbox;/);
  assert.match(response.headers.get('Cache-Control') ?? '', /\bno-store\b/);
});

test('another site cannot trigger the export: refused, and nothing audited', async () => {
  const r = room('counsel');
  for (const site of ['cross-site', 'same-site']) {
    const response = await r.get({ 'Sec-Fetch-Site': site });
    assert.equal(response.status, 403, site);
  }
  assert.deepEqual(r.audits(), []);
});

test('no manifest, or a bad one: the index still lists every document, without facts', async () => {
  for (const matter of [null, '{"version":0}']) {
    resetDocFactsCache();
    const response = await room('counsel', { matter }).get();
    assert.equal(response.status, 200, String(matter));
    const pitch = byLink(parseCsv(await response.text(), 1000).rows, PITCH)!;
    assert.deepEqual([pitch[0], pitch[4], pitch[5], pitch[7]], ['DOE-000001', '', '', 'Yes']);
  }
});

// The stock agreement matched on the checklist, with key facts a person entered (invented, as the fixture is).
const COMPANY = { COMPANY_ROOM_ENABLED: '1', CHECKLIST_ENABLED: '1' };
const MATCHED = [{ item: 'founders.stock-purchase-agreement', doc: AGREEMENT, date: '2011-06-10', parties: 'Harbor Labs and its two founders' }];

test('a company room writes its table: no control numbers, and dates and parties from the checklist, else the file name (#902)', async () => {
  for (const checklist of ['1', '0']) {
    const r = room('owner', { matter: null, settings: { ...COMPANY, CHECKLIST_ENABLED: checklist }, matches: MATCHED });
    const response = await r.get();
    assert.equal(response.status, 200, checklist);
    const { rows } = parseCsv(await response.text(), 1000);
    assert.deepEqual(rows[0], [...COMPANY_INDEX_HEADER]);
    const at = (id: string) => rows.find((row) => row[8] === `${HOST}/doc/?id=${encodeURIComponent(id)}`)!;
    // Date and Parties (columns 3 and 5): the checklist's while it is on; with it off, the file name's, as the table reads them.
    const agreement = checklist === '1' ? ['2011-06-10', 'Harbor Labs and its two founders'] : ['2011-06-07', 'Harbor Labs'];
    assert.deepEqual([at(AGREEMENT)[3], at(AGREEMENT)[5]], agreement, `checklist ${checklist}`);
    assert.deepEqual([at(PITCH)[3], at(PITCH)[5]], ['2011-05-18', 'Richard Roe'], 'no match: the file name');
    assert.deepEqual([at('formula')[3], at('formula')[5]], ['', ''], 'a name with neither');
    assert.equal(rows.length - 1, 7, 'the same documents as a case room');
    assert.ok(rows.every((row) => row.length === COMPANY_INDEX_HEADER.length && !row.some((cell) => cell.startsWith('DOE-'))));
    assert.deepEqual(r.audits(), [{ email: PEOPLE.owner, action: 'download', document_id: null, via: 'index-csv' }]);
  }
});

test('a room with a matter writes the same bytes with the company room and checklist on (#902)', async () => {
  // Bytes, not text(): text() decodes as UTF-8 and drops the byte order mark the file starts with.
  const bytes = async (response: Response) => new Uint8Array(await response.arrayBuffer());
  const before = await bytes(await room('counsel').get());
  resetDocFactsCache();
  const after = await bytes(await room('counsel', { settings: COMPANY, matches: MATCHED }).get());
  assert.deepEqual([...before.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'a UTF-8 byte order mark first');
  assert.ok(new TextDecoder().decode(before.subarray(3)).startsWith('"Control no.",'));
  assert.deepEqual(after, before);
});

test('exportPrefix: the CONTROL_PREFIX secret, and the neutral DOC fallback only for the localhost dev identity', () => {
  const local = new URL(`${HOST}/x`);
  const live = new URL(`${ROOM_HOST}/x`);
  assert.equal(exportPrefix({ CONTROL_PREFIX: 'ABC' }, live), 'ABC');
  assert.equal(exportPrefix({ CONTROL_PREFIX: 'ABC', ALLOW_DEV_IDENTITY: '1' }, local), 'ABC', 'a set secret wins in dev too');
  for (const bad of [undefined, '', 'abc', 'A', 'TOOLONG', 'D0E', 'DOE ']) {
    assert.equal(exportPrefix({ CONTROL_PREFIX: bad }, live), null, `production, ${JSON.stringify(bad)}`);
    assert.equal(exportPrefix({ CONTROL_PREFIX: bad, ALLOW_DEV_IDENTITY: '1' }, live), null, 'the dev flag alone never applies off localhost');
    assert.equal(exportPrefix({ CONTROL_PREFIX: bad, ALLOW_DEV_IDENTITY: '1' }, local), 'DOC', 'local dev, never the fixture DOE');
    assert.equal(exportPrefix({ CONTROL_PREFIX: bad }, local), null, 'localhost without the dev identity');
  }
});

test('production without a valid CONTROL_PREFIX: 503 not_configured, before any audit row', async () => {
  for (const prefix of [undefined, '', 'doe', 'TOOLONG']) {
    const r = room('counsel', { production: true, prefix });
    const response = await r.get();
    assert.equal(response.status, 503, String(prefix));
    assert.deepEqual(await response.json(), { error: 'not_configured' });
    assert.deepEqual(r.audits(), [], 'nothing was exported, so nothing is audited');
  }
});

test('production with the secret: every number and the file name carry the real prefix', async () => {
  const r = room('counsel', { production: true, prefix: 'ABC' });
  const response = await r.get();
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Content-Disposition') ?? '', /^attachment; filename="ABC-index-\d{4}-\d{2}-\d{2}\.csv"/);
  const rows = parseCsv(await response.text(), 1000).rows.slice(1);
  assert.ok(rows.every((row) => row[0] === '' || row[0]!.startsWith('ABC-')), 'no DOE number anywhere');
  assert.equal(rows.find((row) => row[8] === `${ROOM_HOST}/doc/?id=${PITCH}`)?.[0], 'ABC-000001');
  assert.equal(r.audits().length, 1);
});

test('local dev with no secret falls back to the neutral DOC, as the page does', async () => {
  const response = await room('owner', { prefix: undefined }).get();
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.ok(text.includes('"DOC-000001"'));
  assert.ok(!text.includes('"DOE-0'), 'never the fixture prefix');
});
