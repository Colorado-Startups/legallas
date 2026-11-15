// SPDX-License-Identifier: Apache-2.0
// The catalog's designations, `since` and cursors against privileged folders (worker/privilege.ts), with the fictional
// manifest published: owner's and counsel's results keep a privileged document. The read-only family role is retired
// and cannot connect at all (privilege.test.ts); this checks that the handlers behind that refusal refuse it too and
// name no privileged document or party to it.
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Role } from '../../worker/env.ts';
import { encodeCursor } from '../format.ts';
import { body, catalogDb, toolCtx } from './doc-fixtures.ts';
import { cursorRow, findLiveDocument, getDocumentTool, listDocumentsTool, listPage, resetDocumentsCache } from './documents.ts';
import { DOC_IDS, MATTER, matterFiles } from './profile-fixtures.ts';

beforeEach(() => resetDocumentsCache());

const LETTER = DOC_IDS['04-Letters/Email__20110518__Richard-Roe__Vesting-terms.pdf']!;
/** Richard Roe's cites in the fixture manifest: one document, and not the letter above. */
const ROE_CITE = (JSON.parse(MATTER) as { people: { id: string; cites: { doc: string }[] }[] }).people.find((p) => p.id === 'per-roe')!.cites;
const PRIVILEGED = ROE_CITE[0]!.doc;
const OPEN = DOC_IDS['04-Letters/Email__20110527__Jane-Doe__Acceleration-questions.pdf']!;

/** The fixture catalog with Roe's only cited document moved into a privileged folder, the manifest published. */
function room(role: Role) {
  const seeds = Object.entries(DOC_IDS).map(([path, id], i) => ({
    id,
    path: id === PRIVILEGED ? `04-Letters/Counsel-PRIVILEGED/${path.split('/').pop()}` : path,
    controlSeq: i + 1,
  }));
  const { db, sqlite } = catalogDb(seeds);
  sqlite.prepare("UPDATE documents SET updated_at = '2026-09-01T00:00:00Z'").run();
  sqlite.prepare("UPDATE documents SET updated_at = '2026-10-05T00:00:00Z' WHERE id IN (?1, ?2)").run(PRIVILEGED, OPEN);
  const { ctx } = toolCtx(db, undefined, role);
  (ctx.env as { FILES: unknown }).FILES = matterFiles(MATTER).bucket;
  return ctx;
}

const ids = (out: Record<string, any>) => out.documents.map((d: { id: string }) => d.id);
const RETIRED = 'family' as Role;

/** A handler's answer to the retired role: an error naming neither the privileged document nor its only party. */
function refused(out: { isError?: boolean; content: unknown[] }, label: string): void {
  assert.equal(out.isError, true, label);
  assert.doesNotMatch(JSON.stringify(out.content), new RegExp(`Richard Roe|${PRIVILEGED}`), label);
}

test('fixture: Roe is cited to exactly one document, which the letter he sent does not depend on', () => {
  assert.equal(ROE_CITE.length, 1);
  assert.notEqual(PRIVILEGED, LETTER);
});

test('a party cited only to a privileged document is named to owner and counsel; the retired role is refused list and get', async () => {
  for (const role of ['owner', 'counsel'] as const) {
    const ctx = room(role);
    resetDocumentsCache();
    const listed = body(await listDocumentsTool.handler({}, ctx)).documents.find((d: { id: string }) => d.id === LETTER);
    const got = body(await getDocumentTool.handler({ id: LETTER }, ctx));
    for (const letter of [listed, got]) {
      assert.deepEqual(letter.from, ['Richard Roe'], role);
      assert.deepEqual(letter.to, ['Jane Doe'], role);
    }
  }
  resetDocumentsCache();
  const retired = room(RETIRED);
  refused(await listDocumentsTool.handler({}, retired), 'list');
  refused(await getDocumentTool.handler({ id: LETTER }, retired), 'get');
});

test('since returns a privileged document to owner and counsel, and nothing to the retired role', async () => {
  refused(await listDocumentsTool.handler({ since: '2026-10-04' }, room(RETIRED)), 'since');
  for (const role of ['owner', 'counsel'] as const) {
    const seen = body(await listDocumentsTool.handler({ since: '2026-10-04' }, room(role)));
    assert.deepEqual(new Set(ids(seen)), new Set([OPEN, PRIVILEGED]), role);
  }
});

test('a list cursor carrying a privileged id answers the retired role as an unknown one does; owner and counsel may page from it', async () => {
  const cursor = encodeCursor([PRIVILEGED]);
  const family = await listDocumentsTool.handler({ cursor }, room(RETIRED));
  refused(family, 'cursor');
  assert.deepEqual(family, await listDocumentsTool.handler({ cursor: encodeCursor(['no-such-doc']) }, room(RETIRED)));
  for (const role of ['owner', 'counsel'] as const) {
    assert.equal((await listDocumentsTool.handler({ cursor }, room(role))).isError, undefined, role);
  }
});

// The second wall, which the refusal above shadows: every catalog query (documents.ts live) keeps privilegeFilter, so
// a role without viewPrivileged never lists, pages to or opens a privileged document, whatever the handler checks.
test('each catalog query leaves a privileged document out for the retired role; owner and counsel get it', async () => {
  const db = room('counsel').env.DB;
  const page = (role: Role, args: Record<string, unknown> = {}, since: string | null = null) =>
    listPage(db, role, listDocumentsTool.inputSchema.parse(args), { since, after: null, size: 100 });
  const all = await page('counsel');
  const retired = await page(RETIRED);
  assert.ok(all.rows.some((row) => row.id === PRIVILEGED));
  assert.deepEqual(retired.rows.map((row) => row.id), all.rows.map((row) => row.id).filter((id) => id !== PRIVILEGED));
  assert.equal(retired.total, all.total - 1);
  const since = await page(RETIRED, {}, '2026-10-04T00:00:00Z');
  assert.deepEqual([since.rows.map((row) => row.id), since.total], [[OPEN], 1]);
  for (const role of ['owner', 'counsel'] as const) {
    assert.deepEqual(new Set((await page(role, {}, '2026-10-04T00:00:00Z')).rows.map((row) => row.id)), new Set([OPEN, PRIVILEGED]), role);
  }
  const folder = { folder: '04-Letters/Counsel-PRIVILEGED' };
  assert.deepEqual([(await page(RETIRED, folder)).total, (await page('counsel', folder)).total], [0, 1], 'folder filter');
  const cursor = encodeCursor([PRIVILEGED]);
  assert.equal(await cursorRow(db, RETIRED, cursor), null, 'a cursor on a privileged id leads nowhere');
  assert.equal((await cursorRow(db, 'counsel', cursor))?.id, PRIVILEGED);
  assert.equal(await findLiveDocument(db, PRIVILEGED, RETIRED), null, 'get, read_pages, comments and files read through this');
  assert.equal((await findLiveDocument(db, PRIVILEGED, 'owner'))?.id, PRIVILEGED);
});
