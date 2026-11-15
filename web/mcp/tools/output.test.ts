// SPDX-License-Identifier: Apache-2.0
// The connector bar (tools/output.ts) on the fixture room, Doe v. Harbor Labs with prefix DOE, through the real MCP
// handler: a standard caller lists every tool with an outputSchema and the SDK checks each result against it; every
// citable row carries its citation-ready id (control number, and page where it has one), a room link and a retrieved
// date; the text is the structured content minified; a compact caller gets text only, plus a small view for the overview
// and the catalog; and every result is smaller than the indented text and structured copy it replaces.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resetLawCatalog } from '../../worker/law.ts';
import type { LawChunk } from '../../worker/law-cite.ts';
import { MATTER_KEY } from '../../worker/matter-types.ts';
import { MANIFEST_NAME, visualAiKey } from '../../worker/visuals.ts';
import { COMPACT_LIMITS, ROOM_ORIGIN, type McpEnv, type Props } from '../contract.ts';
import '../pro.ts';
import { clearClientKindCache, serveMcp } from '../server.ts';
import { catalogDb, fakeIndex, partsFor } from './doc-fixtures.ts';
import { resetDocumentsCache } from './documents.ts';
import { resetOverviewCache } from './overview.ts';
import { VIEW_TEXT_CHARS } from './output.ts';

type Obj = Record<string, any>;

const FIXTURES = join(import.meta.dirname, '..', '..', 'fixtures');
const MATTER_JSON = readFileSync(join(FIXTURES, 'matter.example.json'), 'utf8');
const DOCS = Object.entries(JSON.parse(readFileSync(join(FIXTURES, 'doc-ids.json'), 'utf8')) as Record<string, string>);
const [FIRST, SECOND] = [DOCS[0]![1], DOCS[1]![1]];
const VISUAL = { id: 'vis-timeline', slug: 'vesting-timeline', text: 'Vesting timeline. 2011: the grant. 2012: the acceleration question.' };
/** The catalog keeps only entries with an official source link (worker/law.ts validEntry), as the law tool's own tests do. */
const LAW: LawChunk[] = [
  { id: 'crs-7-80-714', cite: 'C.R.S. § 7-80-714(1)', title: 'Demand', url: 'https://www.ecfr.gov/current/title-21/section-fixture', retrieved: '2026-10-03', track: 'civil', kind: 'statute', source: 'Fixture' },
];
const CLAUDE = 'https://claude.ai/api/mcp/auth_callback';
const TEAMS = 'https://teams.microsoft.com/api/platform/v1.0/oAuthRedirect';
const MEMBER = { email: 'ada@firm.example', role: 'counsel', clientName: 'Claude', propose: true } as const;
const AS: Record<'standard' | 'compact', Props> = {
  standard: { ...MEMBER, clientId: 'client-claude' },
  compact: { ...MEMBER, clientId: 'client-teams', clientName: 'Microsoft Copilot' },
};

const sha = (text: string) => createHash('sha256').update(text).digest('hex');

/**
 * The fixture room with every tool on: the fictional catalog (DOE-000001 up, in doc-ids.json order), its published
 * matter, a visual binder of one page, two pages of text, a comment thread, a checklist match, the law library and the
 * settings that list the propose, checklist and public records tools.
 */
function fixtureRoom(vars: Record<string, string> = {}): McpEnv {
  resetOverviewCache();
  resetDocumentsCache();
  resetLawCatalog();
  clearClientKindCache();
  const { db, sqlite } = catalogDb([
    ...DOCS.map(([path, id], i) => ({ id, path, controlSeq: i + 1, pages: id === FIRST ? 2 : 3 })),
    { id: 'binder', path: `05-Visuals/${MANIFEST_NAME}`, kind: 'text', controlSeq: 90 },
    { id: VISUAL.id, path: `05-Visuals/${VISUAL.slug}.html`, kind: 'visual', controlSeq: 91 },
  ]);
  const pageSha = sha(VISUAL.slug);
  sqlite.prepare('UPDATE documents SET sha256 = ? WHERE id = ?').run(pageSha, VISUAL.id);
  sqlite.prepare("INSERT INTO members (email, role, name) VALUES (?, 'counsel', 'Ada')").run(MEMBER.email);
  const comment = sqlite.prepare('INSERT INTO comments (id, document_id, author_email, body, created_at, parent_id, page) VALUES (?, ?, ?, ?, ?, ?, ?)');
  comment.run('t1', FIRST, MEMBER.email, 'Compare page two with the term sheet.', '2026-09-01T10:00:00.000Z', null, 2);
  comment.run('r1', FIRST, MEMBER.email, 'Done.', '2026-09-02T10:00:00.000Z', 't1', 2);
  sqlite
    .prepare("INSERT INTO checklist_matches (id, item_id, document_id, signed, doc_date, matched_by, matched_at) VALUES ('m1', 'founders.stock-purchase-agreement', ?, 'yes', '2026-09-20', ?, '2026-09-21T00:00:00Z')")
    .run(SECOND, MEMBER.email);
  const binder = JSON.stringify({
    version: 1,
    sections: [{ slug: 'tab-1', label: 'Tab 1', title: 'Vesting' }],
    visuals: [{ slug: VISUAL.slug, section: 'tab-1', file: `${VISUAL.slug}.html`, title: 'Vesting timeline', overview: false }],
  });
  const objects = new Map([[MATTER_KEY, MATTER_JSON], ['R2-LEAK-binder', binder], [visualAiKey(pageSha, 'txt'), VISUAL.text]]);
  const files = {
    async get(key: string) {
      const text = objects.get(key);
      return text === undefined ? null : { key, etag: 'e1', body: true, size: text.length, text: async () => text, arrayBuffer: async () => new TextEncoder().encode(text).buffer };
    },
  };
  const pages = [{ n: 1, text: 'Vesting terms for the founder grant.' }, { n: 2, text: 'Acceleration on a change of control.' }];
  const chunk = (id: string, page: number, text: string, i: number) => ({ id: `c${i}`, type: 'text', score: 0.9 - i / 10, text: `[[doc:${id} p:${page}]]\n${text}`, item: { key: `text/${id}.p1.md` } });
  return {
    DB: db,
    FILES: files,
    INDEX: fakeIndex(partsFor(FIRST, pages)).bucket,
    SEARCH: { async search() { return { search_query: '', chunks: [chunk(FIRST, 1, pages[0]!.text, 0), chunk(SECOND, 2, 'Questions about acceleration.', 1)] }; } },
    LAW_LIBRARY: '1',
    LAW: { async get() { return { etag: 'e', body: true, json: async () => ({ version: 1, chunks: LAW }) }; } },
    LAW_SEARCH: { async search() { return { search_query: '', chunks: [{ id: 'a', type: 'text', score: 0.9, text: 'Placeholder statute text.', item: { key: 'law/civil/crs-7-80-714.md' } }] }; } },
    OAUTH_PROVIDER: { lookupClient: async (id: string) => ({ clientId: id, redirectUris: [id === AS.standard.clientId ? CLAUDE : TEAMS] }) },
    CONTROL_PREFIX: 'DOE',
    CHECKLIST_ENABLED: '1',
    PROPOSALS_ENABLED: '1',
    PUBLIC_RECORDS: '1',
    TEAM_DOMAIN: '',
    ACCESS_AUD: '',
    ...vars,
  } as unknown as McpEnv;
}

async function rpc(env: McpEnv, props: Props, method: string, params: Record<string, unknown> = {}): Promise<Obj> {
  const request = new Request('https://mcp.example.test/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-11-25' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const text = await (await serveMcp(request, env, props)).text();
  const data = text.split('\n').find((line) => line.startsWith('data: '));
  assert.ok(data, text.slice(0, 200));
  return JSON.parse(data.slice('data: '.length));
}

const SECTIONS = ['summary', 'tracks', 'violations', 'events', 'people', 'orgs', 'claims', 'money', 'docs', 'checklist'];
/** One call of every tool, every overview section and both visual and law modes, on the fixture room. */
const CALLS: [string, Obj][] = [
  ['legallas_search', { query: 'vesting terms', limit: 5 }],
  ...SECTIONS.map((section): [string, Obj] => ['legallas_case_overview', { section }]),
  ['legallas_list_documents', {}],
  ['legallas_get_document', { id: FIRST }],
  ['legallas_read_pages', { id: FIRST }],
  ['legallas_view_visual', {}],
  ['legallas_view_visual', { id: VISUAL.id }],
  ['legallas_get_comments', { id: FIRST }],
  ['legallas_get_file', { id: FIRST }],
  ['legallas_search_law', { query: 'demand' }],
  ['legallas_search_law', { list: true }],
  ['legallas_template', {}],
  ['legallas_template', { path: 'founders/founders-agreement.md', part: 1 }],
  ['legallas_propose_draft', { title: 'Vesting summary', body: 'A short summary.', why: 'Asked for.', sources: [{ document_id: FIRST, page: 1 }] }],
  ['legallas_propose_checklist', { item_id: 'formation.bylaws', applies: false, why: 'An LLC has no bylaws.' }],
  ['legallas_check_public_records', { name: 'Harbor Labs', kind: 'company' }],
];
const TOOLS = [...new Set(CALLS.map(([name]) => name))];

/** The rows a model cites from each read tool's result: list items, or the one document a result is about. */
const ROWS: Record<string, (value: Obj) => Obj[]> = {
  legallas_search: (v) => v.results,
  // A defined term without a cite has nothing to cite. The first part of an entry split across parts holds its head and
  // first cites; later parts continue it.
  legallas_case_overview: (v) => (v.section === 'summary' ? v.definedTerms.filter((t: Obj) => t.cite) : v.entries.filter((e: Obj) => !e.part || e.part === 1)),
  legallas_list_documents: (v) => v.documents,
  legallas_get_document: (v) => [v],
  legallas_read_pages: (v) => v.pages,
  legallas_view_visual: (v) => (v.sections ? v.sections.flatMap((s: Obj) => s.visuals) : [v]),
  legallas_get_comments: (v) => v.threads.flatMap((t: Obj) => [t, ...t.replies]),
  legallas_get_file: (v) => [v],
  legallas_search_law: (v) => v.results ?? v.units,
};

const DOC_LINK = `${ROOM_ORIGIN}/doc/?id=`;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Every object under `value` that links to a room document: the cites a model quotes. */
function docCites(value: unknown, out: Obj[] = []): Obj[] {
  if (Array.isArray(value)) value.forEach((item) => docCites(item, out));
  else if (value && typeof value === 'object') {
    if (typeof (value as Obj).link === 'string' && (value as Obj).link.startsWith(DOC_LINK)) out.push(value as Obj);
    Object.values(value).forEach((item) => docCites(item, out));
  }
  return out;
}

/**
 * A row's provenance: a link (the room's, or the law's official source), every document cite with its control number
 * (its own, or the result's when the result is about one document) and the page its link names, and a retrieved date
 * (its own, or the result's). A row fenced as untrusted has no cites by design (mcp/untrusted.ts).
 */
function assertProvenance(name: string, value: Obj, row: Obj, label: string): void {
  const date = row.retrieved ?? value.retrieved;
  assert.match(String(date), DAY, `${label}: retrieved`);
  if (name === 'legallas_search_law') {
    assert.ok(row.citation && row.source_url, `${label}: citation and source`);
    return;
  }
  if (row.untrusted) return;
  const cites = docCites(row);
  assert.ok(String(row.link ?? '').startsWith(ROOM_ORIGIN) || cites.length > 0, `${label}: a room link`);
  for (const cite of cites) {
    assert.match(String(cite.control ?? value.control), /^DOE-\d{6}$/, `${label}: control number`);
    const page = /#page=(\d+)$/.exec(cite.link)?.[1];
    if (page) assert.equal(cite.page, Number(page), `${label}: the page its link names`);
  }
}

/** What `retrieved` adds to a standard result: the field in the text, escaped, and in the structured copy. */
const DATE_BYTES = '\\"retrieved\\":\\"2026-11-06\\",'.length + '"retrieved":"2026-11-06",'.length;

/** The result as it was before outputSchema: indented text and the same object, without the retrieved date. */
function before(value: Obj): number {
  const { retrieved: _day, ...old } = value;
  return JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(old, null, 2) }], structuredContent: old }).length;
}

test('a standard caller lists every tool with an outputSchema; a compact caller lists none', async () => {
  const env = fixtureRoom();
  const standard = (await rpc(env, AS.standard, 'tools/list')).result.tools as Obj[];
  assert.deepEqual(standard.map((tool) => tool.name).sort(), [...TOOLS].sort());
  // The law search sends its answer once, as text, to every caller (mcp/law-answer.ts): it names no outputSchema.
  for (const tool of standard) assert.equal(tool.outputSchema?.type, tool.name === 'legallas_search_law' ? undefined : 'object', tool.name);
  const compact = (await rpc(env, AS.compact, 'tools/list')).result.tools as Obj[];
  assert.deepEqual(compact.map((tool) => tool.name).sort(), [...TOOLS].sort());
  for (const tool of compact) assert.equal(tool.outputSchema, undefined, tool.name);
});

test('every standard result passes its outputSchema, carries cite, link and date on every row, and costs less in all', async (t) => {
  const env = fixtureRoom();
  const today = new Date().toISOString().slice(0, 10);
  let [was, is] = [0, 0];
  for (const [name, args] of CALLS) {
    const label = `${name} ${JSON.stringify(args).slice(0, 40)}`;
    const out = (await rpc(env, AS.standard, 'tools/call', { name, arguments: args })).result as Obj;
    assert.equal(out.isError, undefined, `${label}: ${out.content?.[0]?.text}`);
    // The law search has no structured copy: its text is the answer, once.
    if (name === 'legallas_search_law') assert.equal(out.structuredContent, undefined, `${label}: no second copy`);
    const value = (name === 'legallas_search_law' ? JSON.parse(out.content[0].text) : out.structuredContent) as Obj;
    assert.ok(value && typeof value === 'object', `${label}: structured content`);
    // The public records check keeps its readable report as text (tools/public-records.ts); every other text is the JSON.
    if (name !== 'legallas_check_public_records') assert.equal(out.content[0].text, JSON.stringify(value), `${label}: minified text`);
    const rows = ROWS[name]?.(value);
    if (!rows) continue;
    assert.ok(rows.length > 0, `${label}: rows`);
    if (name !== 'legallas_search_law') assert.ok([today, new Date().toISOString().slice(0, 10)].includes(value.retrieved), `${label}: today`);
    rows.forEach((row, i) => assertProvenance(name, value, row, `${label} row ${i}`));
    const size = JSON.stringify(out).length;
    // Minifying saves more than the date costs, except on a result too small for the whitespace to outweigh it.
    assert.ok(size <= before(value) + DATE_BYTES, `${label}: ${size} bytes, over ${before(value)} and the date`);
    t.diagnostic(`${label}: ${before(value)} -> ${size} bytes`);
    [was, is] = [was + before(value), is + size];
  }
  t.diagnostic(`read tools, all calls: ${was} -> ${is} bytes (${Math.round((100 * (was - is)) / was)}% fewer)`);
  assert.ok(is < 0.9 * was, `all calls together: ${is} bytes, not 10% under ${was}`);
});

test('a compact caller gets each result once as minified text, the overview and catalog a small view, all within 9,000 characters', async () => {
  const env = fixtureRoom();
  for (const [name, args] of CALLS) {
    const label = `${name} ${JSON.stringify(args).slice(0, 40)}`;
    const out = (await rpc(env, AS.compact, 'tools/call', { name, arguments: args })).result as Obj;
    assert.equal(out.isError, undefined, `${label}: ${out.content?.[0]?.text}`);
    const text = out.content[0].text as string;
    assert.equal(text, JSON.stringify(JSON.parse(text)), `${label}: minified`);
    assert.ok(JSON.stringify(out).length <= COMPACT_LIMITS.maxChars, `${label}: ${JSON.stringify(out).length} characters as sent, text and view together`);
    if (name !== 'legallas_case_overview' && name !== 'legallas_list_documents') {
      assert.equal(out.structuredContent, undefined, label);
      continue;
    }
    const view = out.structuredContent as Obj;
    assert.ok(JSON.stringify(view).length < text.length, `${label}: the view is smaller than the text`);
    assert.equal(view.retrieved, JSON.parse(text).retrieved, `${label}: the view keeps the date`);
    for (const row of view.entries ?? view.documents ?? []) {
      assert.ok(typeof row.id === 'string' || typeof row.title === 'string', `${label}: a row keeps what places it`);
      for (const field of Object.values(row)) if (typeof field === 'string') assert.ok(field.length <= VIEW_TEXT_CHARS + 80, `${label}: short fields`);
    }
  }
});

test('the overview lists its checklist section only while the room has the checklist on', async () => {
  const sectionOf = async (env: McpEnv) => ((await rpc(env, AS.standard, 'tools/list')).result.tools as Obj[]).find((tool) => tool.name === 'legallas_case_overview')!.inputSchema.properties.section;
  const on = await sectionOf(fixtureRoom());
  const off = await sectionOf(fixtureRoom({ CHECKLIST_ENABLED: '0' }));
  assert.ok(on.enum.includes('checklist'));
  assert.deepEqual(off.enum, SECTIONS.slice(0, -1));
  assert.equal(off.description, 'Which part of the case picture to return. "summary" gives counts and the case header.');
  const refused = (await rpc(fixtureRoom({ CHECKLIST_ENABLED: '0' }), AS.standard, 'tools/call', { name: 'legallas_case_overview', arguments: { section: 'checklist' } })).result as Obj;
  assert.equal(refused.isError, true);
});
