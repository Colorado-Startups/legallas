// SPDX-License-Identifier: Apache-2.0
// Folder guides (worker/agent-files.ts) through the MCP, as the room treats them: legallas_list_documents leaves them
// out of its rows and its total with cursors still walking every case document once, get and read answer with what a
// guide is (never the photo-or-scan note, never an audit or an index read). Pro's overview never lists one either:
// overview-folder-guides.test.ts.
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { LIST_PAGE_SIZE } from '../contract.ts';
import { getDocumentTool, listDocumentsTool, resetDocumentsCache } from './documents.ts';
import { body, catalogDb, fakeIndex, partsFor, toolCtx, words, type DocSeed } from './doc-fixtures.ts';
import { readPagesTool } from './pages.ts';

beforeEach(() => resetDocumentsCache());

/** The Doe v. Roe folder guides: the root one first by path and control number, as in the live room. */
const GUIDES: DocSeed[] = [
  { id: 'g-root', path: 'CLAUDE.md', kind: 'markdown', pages: null, controlSeq: 1 },
  { id: 'g-plead', path: '04-Letters/CLAUDE.md', kind: 'markdown', pages: null, controlSeq: 4 },
  { id: 'g-agents', path: '05-Inspection/AGENTS.md', kind: 'markdown', pages: null, controlSeq: 6 },
  { id: 'g-dot', path: '05-Inspection/.claude/notes.md', kind: 'markdown', pages: null, controlSeq: 7 },
];
const CASE: DocSeed[] = [
  { id: 'd-a', path: '02-Invoices/Doe invoice.pdf', controlSeq: 2 },
  { id: 'd-b', path: '04-Letters/Demand Letter.pdf', controlSeq: 3 },
  { id: 'd-notes', path: '04-Letters/CLAUDE-notes.md', kind: 'markdown', pages: null, controlSeq: 5 },
  { id: 'd-up', path: 'from-counsel/d-up/Roe delivery schedule.pdf', source: 'counsel', controlSeq: 8 },
];
const SEEDS = [...GUIDES, ...CASE];

const ids = (out: Record<string, any>) => out.documents.map((d: { id: string }) => d.id);
const errorText = (result: { content: unknown[] }) => (result.content[0] as { text: string }).text;
const FOLDER_GUIDE = /^folder_guide: This is a folder guide for AI tools, not part of the case record; it is not indexed\. Open it in the room: https:\/\/room\.example\.com\/doc\/\?id=g-[a-z]+$/;

test('list leaves folder guides out of its documents and its total, with folder and since too', async () => {
  const { ctx } = toolCtx(catalogDb(SEEDS).db);
  const all = body(await listDocumentsTool.handler({}, ctx));
  assert.deepEqual(ids(all), ['d-a', 'd-notes', 'd-b', 'd-up'], 'a look-alike name stays listed');
  assert.equal(all.total, CASE.length);
  const letters = body(await listDocumentsTool.handler({ folder: '04-Letters' }, ctx));
  assert.deepEqual([ids(letters), letters.total], [['d-notes', 'd-b'], 2]);
  const inspection = body(await listDocumentsTool.handler({ folder: '05-Inspection' }, ctx));
  assert.deepEqual([ids(inspection), inspection.total], [[], 0], 'a folder holding only guides lists nothing');
  const since = body(await listDocumentsTool.handler({ since: '2020-01-01' }, ctx));
  assert.deepEqual([ids(since), since.total], [ids(all), CASE.length]);
  assert.doesNotMatch(JSON.stringify(all), /CLAUDE\.md|AGENTS\.md|\.claude\//);
});

test('a cursor walks every case document once, with folder guides at the page edge and between pages', async () => {
  const docs: DocSeed[] = Array.from({ length: LIST_PAGE_SIZE + 5 }, (_, i) => ({ id: `doc-${String(i).padStart(3, '0')}`, path: `Box/File ${String(i).padStart(3, '0')}.pdf` }));
  // By path: one before every document, one right after the last row of page one, one inside it and one at the end.
  const guides: DocSeed[] = ['Box/AGENTS.md', `Box/File ${String(LIST_PAGE_SIZE - 1).padStart(3, '0')}/CLAUDE.md`, 'Box/File 050/.claude/plan.md', 'Box/Z/CLAUDE.md']
    .map((path, i) => ({ id: `guide-${i}`, path, kind: 'markdown', pages: null }));
  const { ctx } = toolCtx(catalogDb([...guides, ...docs]).db);
  const first = body(await listDocumentsTool.handler({}, ctx));
  assert.equal(first.documents.length, LIST_PAGE_SIZE);
  assert.equal(first.total, docs.length);
  const second = body(await listDocumentsTool.handler({ cursor: first.next_cursor }, ctx));
  assert.equal(second.total, docs.length, 'the total holds across pages');
  assert.equal(second.next_cursor, undefined);
  assert.deepEqual([...ids(first), ...ids(second)], docs.map((d) => d.id));
  const again = body(await listDocumentsTool.handler({ cursor: first.next_cursor }, ctx));
  assert.deepEqual(ids(again), ids(second), 'the same cursor gives the same page');
});

test('get on a folder guide says what it is, with no details and no audit', async () => {
  const { ctx, audits } = toolCtx(catalogDb(SEEDS).db);
  for (const guide of GUIDES) {
    const result = await getDocumentTool.handler({ id: guide.id }, ctx);
    assert.equal(result.isError, true, guide.path);
    assert.match(errorText(result), FOLDER_GUIDE, guide.path);
    assert.ok(errorText(result).endsWith(`?id=${guide.id}`), 'its own room link');
    assert.equal(result.structuredContent, undefined);
  }
  assert.deepEqual(audits, []);
  assert.equal(body(await getDocumentTool.handler({ id: 'd-notes' }, ctx)).title, 'CLAUDE-notes.md', 'a look-alike name is a document');
});

test('read on a folder guide says what it is, not the photo-or-scan note, and never reads the index', async () => {
  // Even text in the index (the sync never writes any for a guide) is not read.
  const index = fakeIndex(partsFor('g-root', [{ n: 1, text: words('guide', 40) }]));
  const { ctx, audits } = toolCtx(catalogDb(SEEDS).db, index.bucket);
  for (const guide of GUIDES) {
    const result = await readPagesTool.handler({ id: guide.id, from: 1 }, ctx);
    assert.equal(result.isError, true, guide.path);
    assert.match(errorText(result), FOLDER_GUIDE, guide.path);
    assert.doesNotMatch(errorText(result), /photo|scan|guidew/);
  }
  assert.deepEqual([index.calls.list, index.calls.get, audits], [0, [], []]);
  const notes = body(await readPagesTool.handler({ id: 'd-notes', from: 1 }, ctx));
  assert.match(notes.note, /no extracted text/, 'a look-alike with no text keeps the usual note');
});
