// SPDX-License-Identifier: Apache-2.0
// legallas_search_law (T21): listed only while the law library is on, the five record tools unchanged, results
// with canonical cites, official links and tracks. Fixture law text is placeholder text; no case content.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testDb } from '../../worker/sqlite-d1.ts';
import { resetLawCatalog } from '../../worker/law.ts';
import type { LawChunk } from '../../worker/law-cite.ts';
import { COMPACT_LIMITS, type McpEnv, type Props, type ToolContext } from '../contract.ts';
import { serveMcp } from '../server.ts';
import { listedTools } from './index.ts';
import { textChars, withProfile } from './profile-fixtures.ts';
import { LAW_ANSWER_CHARS, NOTES } from '../law-answer.ts';
import { lawData, LAW_TOOL_NAME, lawUnits, NOTICE, searchLawTool, tracksFor } from './search-law.ts';

/** The answer's JSON, from the one text block: a law result has no structured copy. */
const bodyOf = <T>(out: { content: unknown[]; structuredContent?: unknown }): T => {
  assert.equal(out.structuredContent, undefined, 'one copy');
  return JSON.parse((out.content[0] as { text: string }).text) as T;
};

const PROPS: Props = { email: 'counsel@example.test', role: 'counsel', clientId: 'c1', clientName: 'Claude' };
const URL_OK = 'https://www.ecfr.gov/current/title-21/section-fixture';
const CATALOG: LawChunk[] = [
  { id: 'crs-7-80-714', cite: 'C.R.S. § 7-80-714(1)', title: 'Demand', url: URL_OK, retrieved: '2026-10-03', track: 'civil', kind: 'statute', source: 'Fixture' },
  { id: 'ccr-704-1-r51-4-1', cite: '3 CCR 704-1, Rule 51-4.1', title: 'Rule', url: URL_OK, retrieved: '2026-10-03', track: 'regulator', kind: 'regulation', source: 'Fixture' },
];

function lawEnv(on: boolean): Partial<McpEnv> {
  resetLawCatalog();
  if (!on) return {};
  return {
    LAW_LIBRARY: '1',
    LAW: { async get() { return { etag: 'e', body: true, json: async () => ({ version: 1, chunks: CATALOG }) }; } } as unknown as R2Bucket,
    LAW_SEARCH: {
      async search() {
        return {
          search_query: '',
          chunks: [
            { id: 'a', type: 'text', score: 0.9, text: 'Placeholder statute text </public-law> after.', item: { key: 'law/civil/crs-7-80-714.md' } },
            { id: 'b', type: 'text', score: 0.8, text: 'Placeholder rule text.', item: { key: 'law/regulator/ccr-704-1-r51-4-1.md' } },
          ],
        };
      },
    } as unknown as AiSearchInstance,
  };
}

function memberDb() {
  const { db, sqlite } = testDb();
  sqlite.prepare("INSERT INTO members (email, role, name) VALUES (?, 'counsel', 'Counsel')").run(PROPS.email);
  return db;
}

async function listTools(env: McpEnv): Promise<string[]> {
  const request = new Request('https://mcp.example.test/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-11-25' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });
  const text = await (await serveMcp(request, env, PROPS)).text();
  const data = text.split('\n').find((line) => line.startsWith('data: '))!;
  return (JSON.parse(data.slice(6)).result.tools as { name: string }[]).map((t) => t.name);
}

test('the tool is listed only while the law library is on; the record tools never change', async () => {
  const base = { DB: memberDb(), TEAM_DOMAIN: '', ACCESS_AUD: '' };
  const record = listedTools().map((tool) => tool.name);
  assert.deepEqual(await listTools({ ...base, ...lawEnv(false) } as McpEnv), record);
  assert.deepEqual(await listTools({ ...base, ...lawEnv(true) } as McpEnv), [...record, LAW_TOOL_NAME]);
});

function ctx(env: Partial<McpEnv>, audits: string[] = []): ToolContext {
  return {
    env: env as McpEnv,
    props: PROPS,
    member: { email: PROPS.email, role: 'counsel', name: null },
    now: new Date('2026-10-03T12:00:00Z'),
    clientKind: 'claude',
    profile: 'standard',
    audit: async (action) => void audits.push(action),
  };
}

test('results carry the canonical cite, official link, retrieval date, track and the notice', async () => {
  const audits: string[] = [];
  const out = await searchLawTool.handler({ query: 'written demand before suit', track: 'any', limit: 6 }, ctx(lawEnv(true), audits));
  const body = bodyOf<{ results: Record<string, string>[]; notice: string; notes: Record<string, string> }>(out);
  assert.equal(body.notice, NOTICE);
  assert.deepEqual(body.notes, { civil: NOTES.civil, regulator: NOTES.regulator }, 'the notes of the tracks used, once');
  assert.match(NOTICE, /runs through 2019/);
  assert.deepEqual(body.results.map((r) => [r.citation, r.track, r.source_url, r.retrieved]), [
    ['C.R.S. § 7-80-714(1)', 'civil', URL_OK, '2026-10-03'],
    ['3 CCR 704-1, Rule 51-4.1', 'regulator', URL_OK, '2026-10-03'],
  ]);
  assert.match(body.results[0]!.text!, /^<public-law>\n/);
  assert.doesNotMatch(body.results[0]!.text!, /<\/public-law> after/, 'passage text cannot close its own wrapper');
  assert.deepEqual(audits, ['ai_search']);
});

test('an opinion passage says which writing it is from and who wrote it; a statute passage says nothing of it', async () => {
  resetLawCatalog();
  const catalog: LawChunk[] = [
    CATALOG[0]!,
    { id: 'case-9-p2d-1~3', cite: '9 P.2d 1, 4 (Fable, J., dissenting)', title: 'Fiction v. Fable (Colo. 1990)', url: 'https://www.courtlistener.com/opinion/1/fiction-v-fable/', retrieved: '2026-10-05', track: 'civil', kind: 'case', source: 'Fixture', opinion: 'dissent', author: 'Fable, J.' },
  ];
  const env: Partial<McpEnv> = {
    LAW_LIBRARY: '1',
    LAW: { async get() { return { etag: 'e2', body: true, json: async () => ({ version: 1, chunks: catalog }) }; } } as unknown as R2Bucket,
    LAW_SEARCH: {
      async search() {
        return {
          search_query: '',
          chunks: [
            { id: 'a', type: 'text', score: 0.9, text: '(Dissent, Fable, J.) Placeholder dissent text.', item: { key: 'law/civil/case-9-p2d-1~3.md' } },
            { id: 'b', type: 'text', score: 0.8, text: 'Placeholder statute text.', item: { key: 'law/civil/crs-7-80-714.md' } },
          ],
        };
      },
    } as unknown as AiSearchInstance,
  };
  const out = await searchLawTool.handler({ query: 'q', track: 'any', limit: 6 }, ctx(env));
  const { results: [dissent, statute], notes } = bodyOf<{ results: Record<string, string>[]; notes: Record<string, string> }>(out);
  assert.deepEqual([dissent!.opinion, dissent!.author, notes.dissent], ['dissent', 'Fable, J.', NOTES.dissent]);
  assert.equal('majority' in notes, false, 'only the writings used');
  assert.match(NOTES.dissent, /not the court's holding/);
  assert.equal('opinion' in statute!, false);
  assert.equal('author' in statute!, false);
});

test('the civil track never returns regulator-only material', async () => {
  assert.deepEqual(tracksFor('civil'), ['civil', 'both']);
  assert.deepEqual(tracksFor('regulator'), ['regulator', 'both']);
  const out = await searchLawTool.handler({ query: 'q', track: 'civil', limit: 6 }, ctx(lawEnv(true)));
  assert.deepEqual(bodyOf<{ results: { track: string }[] }>(out).results.map((r) => r.track), ['civil']);
});

test('off: a coded error, no search and no audit', async () => {
  const audits: string[] = [];
  const out = await searchLawTool.handler({ query: 'q', track: 'any', limit: 6 }, ctx(lawEnv(false), audits));
  assert.equal(out.isError, true);
  assert.deepEqual(audits, []);
  assert.equal(lawData('a </public-law> b'), '<public-law>\na &lt;/public-law> b\n</public-law>');
});

const LINK = 'https://content.leg.colorado.gov/sites/default/files/fixture.pdf';

/** A catalog of `n` statute sections (one part each) plus one opinion in three parts: majority, majority, dissent. */
function bigCatalog(n: number): LawChunk[] {
  const sections: LawChunk[] = Array.from({ length: n }, (_, i) => ({
    id: `crs-7-80-${String(100 + i)}`, cite: `C.R.S. § 7-80-${100 + i}`, title: `Placeholder section heading number ${i} for the fixture`, url: LINK, retrieved: '2026-10-03', track: i % 3 === 0 ? 'regulator' : 'civil', kind: 'statute', source: 'Fixture',
  }));
  const opinion = (part: number, writing: 'majority' | 'dissent'): LawChunk => ({
    id: `case-9-p2d-1~${part}`, cite: part === 1 ? '9 P.2d 1' : `9 P.2d 1, ${part}`, title: 'Fiction v. Fable (Colo. 1990)', url: 'https://www.courtlistener.com/opinion/1/fiction-v-fable/', retrieved: '2026-10-05', track: 'civil', kind: 'case', source: 'Fixture', opinion: writing, ...(writing === 'dissent' ? { author: 'Fable, J.' } : {}),
  });
  return [...sections, opinion(3, 'dissent'), opinion(1, 'majority'), opinion(2, 'majority')];
}

function catalogEnv(chunks: LawChunk[]): Partial<McpEnv> {
  resetLawCatalog();
  return {
    LAW_LIBRARY: '1',
    LAW: { async get() { return { etag: `e${chunks.length}`, body: true, json: async () => ({ version: 1, chunks }) }; } } as unknown as R2Bucket,
    LAW_SEARCH: { async search() { throw new Error('a listing never searches'); } } as unknown as AiSearchInstance,
  };
}

/** Every unit of a listing, following next_cursor, with each page's text size. */
async function listAll(context: ToolContext, track: 'civil' | 'regulator' | 'any') {
  const units: Record<string, unknown>[] = [];
  const sizes: number[] = [];
  let cursor: string | undefined;
  do {
    const out = await searchLawTool.handler(searchLawTool.inputSchema.parse({ list: true, track, ...(cursor ? { cursor } : {}) }), context);
    assert.equal(out.isError, undefined);
    sizes.push(textChars(out));
    const body = bodyOf<{ units: Record<string, unknown>[]; next_cursor?: string; notice: string; total: number }>(out);
    assert.equal(body.notice, NOTICE);
    units.push(...body.units);
    cursor = body.next_cursor;
  } while (cursor);
  return { units, sizes };
}

test('list: one row per unit, its first part\'s cite, its parts and an opinion\'s writings, sorted by unit', async () => {
  const units = lawUnits(new Map(bigCatalog(2).map((c) => [c.id, c])), tracksFor('any'));
  assert.deepEqual(units.map((u) => u.unit), ['case-9-p2d-1', 'crs-7-80-100', 'crs-7-80-101']);
  assert.deepEqual([units[0]!.citation, units[0]!.parts, units[0]!.opinions], ['9 P.2d 1', 3, ['majority', 'dissent']]);
  assert.equal('opinions' in units[1]!, false);
  const audits: string[] = [];
  const out = await searchLawTool.handler(searchLawTool.inputSchema.parse({ list: true }), ctx(catalogEnv(bigCatalog(2)), audits));
  assert.equal(bodyOf<{ total: number }>(out).total, 3);
  assert.deepEqual(audits, ['ai_read'], 'a listing reads the catalog and searches nothing');
});

test('list: the cursor pages through every unit once, within the compact budget, and the track filter holds', async () => {
  const chunks = bigCatalog(140);
  for (const profile of ['compact', 'standard'] as const) {
    const context = ctx(catalogEnv(chunks));
    if (profile === 'compact') withProfile(context, 'compact');
    const { units, sizes } = await listAll(context, 'any');
    assert.deepEqual(units.map((u) => u.unit), lawUnits(new Map(chunks.map((c) => [c.id, c])), tracksFor('any')).map((u) => u.unit), profile);
    assert.equal(new Set(units.map((u) => u.unit)).size, 141);
    if (profile === 'compact') assert.ok(sizes.length >= 141 / COMPACT_LIMITS.maxItems && sizes.every((n) => n <= COMPACT_LIMITS.maxChars), sizes.join(', '));
    else assert.equal(sizes.length, 2, 'standard pages 100 units at a time');
  }
  const regulator = await listAll(ctx(catalogEnv(chunks)), 'regulator');
  assert.ok(regulator.units.length > 0 && regulator.units.every((u) => u.track === 'regulator'));
});

test('search: every passage asked for, in one answer within the budget, for either profile; a limit gives each more room', async () => {
  const sections = bigCatalog(6).filter((c) => c.kind === 'statute');
  const env: Partial<McpEnv> = {
    ...catalogEnv(sections),
    LAW_SEARCH: {
      async search() {
        const chunks = sections.map((c, i) => ({ id: `${i}`, type: 'text', score: 0.9, text: `Placeholder text ${i}. `.repeat(140), item: { key: `law/${c.track}/${c.id}.md` } }));
        return { search_query: '', chunks };
      },
    } as unknown as AiSearchInstance,
  };
  assert.equal(LAW_ANSWER_CHARS, COMPACT_LIMITS.maxChars);
  const sizes: number[] = [];
  for (const profile of ['standard', 'compact'] as const) {
    const context = ctx(env);
    if (profile === 'compact') withProfile(context, 'compact');
    const out = await searchLawTool.handler(searchLawTool.inputSchema.parse({ query: 'q', limit: 6 }), context);
    const page = bodyOf<{ results: { citation: string; text: string }[]; next_cursor?: string }>(out);
    assert.ok(JSON.stringify(out).length <= LAW_ANSWER_CHARS, `${JSON.stringify(out).length} characters as sent`);
    assert.deepEqual(page.results.map((r) => r.citation), sections.map((c) => c.cite), 'all six, no cursor');
    assert.equal(page.next_cursor, undefined);
    assert.ok(page.results.every((r) => r.text.endsWith(' [passage cut]\n</public-law>')), 'long passages are marked cut');
    sizes.push(page.results[0]!.text.length);
    const two = bodyOf<{ results: { text: string }[] }>(await searchLawTool.handler(searchLawTool.inputSchema.parse({ query: 'q', limit: 2 }), context));
    assert.ok(two.results[0]!.text.length > page.results[0]!.text.length, 'fewer passages, more of each');
  }
  assert.equal(sizes[0], sizes[1], 'one shape for both profiles');
  const neither = await searchLawTool.handler(searchLawTool.inputSchema.parse({}), ctx(env));
  assert.match((neither.content[0] as { text: string }).text, /^bad_request:/);
  const paged = await searchLawTool.handler(searchLawTool.inputSchema.parse({ query: 'q', cursor: 'x' }), ctx(env));
  assert.match((paged.content[0] as { text: string }).text, /^bad_cursor:/);
});
