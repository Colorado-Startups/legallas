// SPDX-License-Identifier: Apache-2.0
// legallas-mcp and privileged folders (worker/privilege.ts). The read-only family role is retired: a family row left
// from before migration 0010 is no member, so every tool call is refused before its handler runs. Behind that, a
// handler reached with the role refuses it again, or answers a privileged id as a missing one, so it never lists,
// finds, reads or cites a privileged document; owner's and counsel's results are unchanged. Pro's tools:
// overview-privilege.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Role } from '../../worker/env.ts';
import { addLeftoverFamily } from '../../worker/gate-fixtures.ts';
import { testDb } from '../../worker/sqlite-d1.ts';
import type { McpEnv, Props, ToolContext } from '../contract.ts';
import { runTool } from '../server.ts';
import { body, catalogDb, fakeIndex, partsFor, toolCtx } from './doc-fixtures.ts';
import { getDocumentTool, listDocumentsTool } from './documents.ts';
import { listedTools } from './index.ts';
import { readPagesTool } from './pages.ts';
import { searchLawTool } from './search-law.ts';
import { searchTool } from './search.ts';

const RETIRED = 'family' as Role;

/** A handler's answer to the retired role: an error that names no privileged document. */
function refused(out: { isError?: boolean; content: unknown[] }, label: string, names: RegExp = /doc-note|doc-mail|PRIVILEGED/): void {
  assert.equal(out.isError, true, label);
  assert.doesNotMatch(JSON.stringify(out.content), names, label);
}

test('a family row left from before migration 0010 is refused every tool before it runs, and no call is counted', async () => {
  const { db, sqlite } = testDb();
  addLeftoverFamily(sqlite, 'kin@mail.example', 'Kin');
  const props: Props = { email: 'kin@mail.example', role: RETIRED, clientId: 'c1', clientName: 'Claude' };
  const env = { DB: db, TEAM_DOMAIN: '', ACCESS_AUD: '' } as unknown as McpEnv;
  for (const tool of [...listedTools(), searchLawTool]) {
    const handler = async () => assert.fail(`${tool.name} ran for family`);
    const out = await runTool({ ...tool, handler }, {}, env, props, undefined, new Date());
    assert.equal(out.isError, true, tool.name);
    assert.match((out.content[0] as { text: string }).text, /^not_a_member:/);
  }
  assert.equal((sqlite.prepare('SELECT count(*) AS n FROM usage').get() as { n: number }).n, 0);
});

const PRIVILEGED = ['doc-note', 'doc-mail'];
const SEEDS = [
  { id: 'doc-open', path: '01-Contracts/Supply-Agreement.pdf', controlSeq: 1 },
  { id: 'doc-note', path: '07-Lawyer-Notes-PRIVILEGED/Lawyer-Note.pdf', controlSeq: 2 },
  { id: 'doc-mail', path: '04-Letters/Counsel-PRIVILEGED/Advice.pdf', controlSeq: 3 },
];

/** The catalog above, its index text, a search answering with a passage from every document, and a context for `role`. */
function room(role: Role): ToolContext {
  const parts = new Map(SEEDS.flatMap((s) => [...partsFor(s.id, [{ n: 1, text: `Text of ${s.id}.` }])]));
  const { ctx } = toolCtx(catalogDb(SEEDS).db, fakeIndex(parts).bucket, role);
  const chunks = SEEDS.map((s, i) => ({ id: `c${i}`, type: 'text', score: 0.9, text: `[[doc:${s.id} p:1]]\nText of ${s.id}.`, item: { key: `text/${s.id}.p1.md` } }));
  (ctx.env as { SEARCH: unknown }).SEARCH = { search: async () => ({ search_query: '', chunks }) };
  return ctx;
}

const ids = (items: { id: string }[]) => items.map((item) => item.id).sort();

test('legallas_search and legallas_list_documents: owner and counsel see all; the retired role is refused', async () => {
  for (const role of ['owner', 'counsel'] as const) {
    const ctx = room(role);
    const want = SEEDS.map((s) => s.id).sort();
    const found = body(await searchTool.handler(searchTool.inputSchema.parse({ query: 'cooler repair' }), ctx));
    assert.deepEqual(ids(found.results), want, `${role} search`);
    const listed = body(await listDocumentsTool.handler({}, ctx));
    assert.deepEqual(ids(listed.documents), want, `${role} list`);
    assert.equal(listed.total, want.length);
    const folder = body(await listDocumentsTool.handler({ folder: '07-Lawyer-Notes-PRIVILEGED' }, ctx));
    assert.equal(folder.total, 1, `${role} folder filter`);
  }
  const retired = room(RETIRED);
  refused(await searchTool.handler(searchTool.inputSchema.parse({ query: 'cooler repair' }), retired), 'search');
  refused(await listDocumentsTool.handler({}, retired), 'list');
  refused(await listDocumentsTool.handler({ folder: '07-Lawyer-Notes-PRIVILEGED' }, retired), 'folder filter');
});

test('legallas_get_document and legallas_read_pages: a privileged id answers the retired role as a missing id does', async () => {
  const family = room(RETIRED);
  const missing = await getDocumentTool.handler({ id: 'no-such-doc' }, family);
  const missingRead = await readPagesTool.handler(readPagesTool.inputSchema.parse({ id: 'no-such-doc' }), family);
  refused(missing, 'missing');
  for (const id of PRIVILEGED) {
    assert.deepEqual(await getDocumentTool.handler({ id }, family), missing, id);
    const read = await readPagesTool.handler(readPagesTool.inputSchema.parse({ id }), family);
    refused(read, id);
    assert.deepEqual(read, missingRead, id);
  }
  const counsel = room('counsel');
  for (const id of PRIVILEGED) {
    assert.equal(body(await getDocumentTool.handler({ id }, counsel)).id, id);
    const read = body(await readPagesTool.handler(readPagesTool.inputSchema.parse({ id }), counsel));
    assert.match(JSON.stringify(read.pages), new RegExp(`Text of ${id}`));
  }
});
