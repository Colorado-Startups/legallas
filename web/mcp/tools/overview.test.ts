// SPDX-License-Identifier: Apache-2.0
// legallas_case_overview on real SQLite with the real migrations, the Doe v. Harbor Labs fixture matter and a fake
// legallas-files bucket that honours conditional gets.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { testDb } from '../../worker/sqlite-d1.ts';
import { MATTER_KEY } from '../../worker/matter-types.ts';
import type { McpEnv, ToolContext } from '../contract.ts';
import {
  decodeCursor, encodeCursor, MAX_DEFINED_TERMS, MAX_ENTRY_CHARS, overviewTool, PAGE_BUDGET_CHARS, PAGE_ENTRIES, pageOf, resetOverviewCache, shrinkEntry,
} from './overview.ts';

import { FENCE, PLANTED_AI } from './untrusted-fixtures.ts';
import { UNTRUSTED_REMINDER } from '../../worker/prompt.ts';
import { COMPACT_LIMITS } from '../contract.ts';

const FIXTURES = join(import.meta.dirname, '..', '..', 'fixtures');
const MATTER = readFileSync(join(FIXTURES, 'matter.example.json'), 'utf8');
const IDS = JSON.parse(readFileSync(join(FIXTURES, 'doc-ids.json'), 'utf8')) as Record<string, string>;
const PLEADING = IDS['08-Court-Pleadings/Amended-Complaint__20130409__Jane-Doe.pdf']!;
const REMOVED = Object.entries(IDS).find(([p]) => p.includes('Vesting-terms'))![1];
const HIDDEN = Object.entries(IDS).find(([p]) => p.includes('Card-charges'))![1];

type Value = Record<string, any>;

beforeEach(() => resetOverviewCache());

function setup(matter: string | null = MATTER, prefix: string | null = 'ABC') {
  const { db, sqlite } = testDb();
  const insert = sqlite.prepare(
    "INSERT INTO documents (id, path, folder, name, kind, content_type, size, r2_key, source, updated_at, removed_at, control_seq) VALUES (?1, ?2, '', ?3, 'pdf', 'application/pdf', 1, ?4, 'mirror', 'now', ?5, ?6)",
  );
  Object.entries(IDS).forEach(([path, id], i) => {
    const name = id === HIDDEN ? 'legallas-visuals.json' : path.split('/').pop()!;
    insert.run(id, path, name, `k-${id}`, id === REMOVED ? 'then' : null, i + 1);
  });
  const state = { downloads: 0 };
  const files = {
    async get(key: string, options?: R2GetOptions) {
      if (key !== MATTER_KEY || matter === null) return null;
      if ((options?.onlyIf as R2Conditional | undefined)?.etagDoesNotMatch === 'e1') return { key, etag: 'e1' };
      state.downloads++;
      return { key, etag: 'e1', body: new Response(matter).body, text: async () => matter };
    },
  };
  const audits: [string, string | null][] = [];
  const ctx: ToolContext = {
    env: { DB: db, FILES: files, CONTROL_PREFIX: prefix ?? undefined } as unknown as McpEnv,
    props: { email: 'counsel@example.test', role: 'counsel', clientId: 'c1', clientName: 'Claude' },
    member: { email: 'counsel@example.test', role: 'counsel', name: null },
    now: new Date('2026-10-01T12:00:00Z'),
    clientKind: 'claude',
    profile: 'standard',
    audit: async (action, documentId) => void audits.push([action, documentId]),
  };
  return { ctx, audits, state };
}

async function call(ctx: ToolContext, args: Record<string, unknown> = {}) {
  const out = await overviewTool.handler(overviewTool.inputSchema.parse(args), ctx);
  return { out, value: out.structuredContent as Value };
}

/** Every entry of a section, following nextCursor to the end. */
async function walk(ctx: ToolContext, section: string): Promise<{ entries: Value[]; pages: Value[] }> {
  const pages: Value[] = [];
  let cursor: string | undefined;
  do {
    const { out, value } = await call(ctx, cursor ? { section, cursor } : { section });
    assert.equal(out.isError, undefined);
    pages.push(value);
    cursor = value.nextCursor ?? undefined;
  } while (cursor);
  return { entries: pages.flatMap((p) => p.entries), pages };
}

test('summary: case header, counts per section and the operative pleading cite', async () => {
  const { ctx, audits } = setup();
  const { out, value } = await call(ctx);
  assert.equal(out.isError, undefined);
  assert.equal(value.section, 'summary');
  assert.equal(value.caption, '<case-record>\nDoe v. Harbor Labs, Inc.\n</case-record>');
  assert.equal(value.definedTermsTotal, value.definedTerms.length);
  assert.equal(value.operativePleading.title, '<case-record>\nFirst Amended Complaint\n</case-record>');
  const control = `ABC-${String(Object.values(IDS).indexOf(PLEADING) + 1).padStart(6, '0')}`;
  assert.deepEqual(value.operativePleading.cite, {
    control, doc: PLEADING, page: 1, link: `https://room.example.com/doc/?id=${PLEADING}#page=1`,
  });
  assert.match(value.definedTerms[0].means, /^<case-record>\n/);
  let calls = 1;
  assert.deepEqual(Object.keys(value.counts), ['tracks', 'violations', 'events', 'people', 'orgs', 'claims', 'money', 'docs'], 'tracks lead');
  for (const section of ['tracks', 'violations', 'events', 'people', 'orgs', 'claims', 'money', 'docs']) {
    const { entries, pages } = await walk(ctx, section);
    assert.equal(value.counts[section], entries.length, section);
    calls += pages.length;
  }
  assert.deepEqual(audits[0], ['ai_read', null]);
  assert.equal(audits.length, calls, 'one audit per call');
});

test('summary: a prior case is labeled closed, after the new header, and the claims note says so', async () => {
  const raw = JSON.parse(MATTER);
  const { caption, court, judge, operativePleading } = raw.meta;
  raw.meta.priorCase = { caption, court, caseNumber: 'CV-2013-00317', judge, operativePleading };
  Object.assign(raw.meta, { caption: 'Doe v. Roe', court: 'Not yet filed', judge: null, operativePleading: null });
  const { ctx } = setup(JSON.stringify(raw));
  const { value } = await call(ctx);
  assert.equal(value.caption, '<case-record>\nDoe v. Roe\n</case-record>');
  assert.deepEqual([value.court, value.caseNumber, value.judge, value.operativePleading], ['Not yet filed', null, null, null]);
  assert.equal(value.priorCase.status, 'closed');
  assert.match(value.priorCase.note, /not being pursued/);
  assert.equal(value.priorCase.caption, '<case-record>\nDoe v. Harbor Labs, Inc.\n</case-record>');
  assert.equal(value.priorCase.caseNumber, 'CV-2013-00317');
  assert.equal(value.priorCase.operativePleading.cite.doc, PLEADING);
  assert.equal(value.next, undefined, 'priorCase says whose claims they are, so no sentence repeats it');
  resetOverviewCache();
  const { value: plain } = await call(setup().ctx);
  assert.equal(plain.priorCase, null, 'a manifest without one says so');
  assert.equal(plain.next, undefined);
});

test('removed and hidden documents drop out of cites and the docs section', async () => {
  const { ctx } = setup();
  const text = JSON.stringify(await Promise.all(['summary', 'events', 'people', 'orgs', 'claims', 'money', 'docs'].map((s) => walk(ctx, s))));
  assert.ok(MATTER.includes(REMOVED) && MATTER.includes(HIDDEN), 'the fixture cites both');
  assert.doesNotMatch(text, new RegExp(`${REMOVED}|${HIDDEN}`));
  const docs = (await walk(ctx, 'docs')).entries;
  assert.ok(docs.every((d) => d.title !== 'legallas-visuals.json'));
});

test('docs page through with a cursor, in control number order, nothing repeated', async () => {
  const { ctx } = setup();
  const { entries, pages } = await walk(ctx, 'docs');
  assert.ok(entries.length > PAGE_ENTRIES, 'the fixture has more documents than one page');
  assert.equal(pages[0]!.entries.length, PAGE_ENTRIES);
  assert.equal(pages[0]!.total, entries.length);
  assert.equal(pages.at(-1)!.nextCursor, null);
  assert.equal(new Set(entries.map((d) => d.id)).size, entries.length);
  const controls = entries.map((d) => d.control as string);
  assert.deepEqual(controls, [...controls].sort());
  assert.match(entries[0]!.link, /^https:\/\/room\.example\.com\/doc\/\?id=/);
  assert.equal(typeof entries[0]!.title, 'string');
  const typed = entries.find((d) => d.type !== null)!;
  assert.match(typed.type, /^<case-record>\n[\s\S]*\n<\/case-record>$/, 'owner-written doc types are case data');
});

test('every cite carries a control number, page and room link; free text is case data', async () => {
  const { ctx } = setup(MATTER, null);
  const [event] = (await walk(ctx, 'events')).entries;
  assert.match(event!.title, /^<case-record>\n[\s\S]*\n<\/case-record>$/);
  const cite = event!.cites[0];
  assert.match(cite.control, /^DOC-\d{6}$/, 'falls back to the neutral room prefix, never the fixture DOE');
  assert.equal(cite.link, `https://room.example.com/doc/?id=${cite.doc}${cite.page ? `#page=${cite.page}` : ''}`);
  const [claim] = (await walk(ctx, 'claims')).entries;
  assert.match(claim!.elements[0].text, /^<case-record>\n/);
  assert.match(claim!.elements[0].proof[0].cite.control, /^DOC-/);
  const money = (await walk(ctx, 'money')).entries;
  assert.match(money[0]!.amount, /^\$[\d,]+\.\d{2}$/);
});

test('relationship links are folded into the party they leave from', async () => {
  const { ctx } = setup();
  const parties = [...(await walk(ctx, 'people')).entries, ...(await walk(ctx, 'orgs')).entries];
  const links = parties.flatMap((p) => p.links);
  assert.ok(links.length > 0);
  assert.match(links[0].label, /^<case-record>\n/);
  // Doe's "owner of" link carries two dated statements, each with served cites; links without any leave the key out.
  const doe = parties.find((p) => p.id === 'per-doe')!;
  const owner = doe.links.find((l: { to: string }) => l.to === 'org-harbor');
  assert.deepEqual(owner.statements.map((st: { basis: string; since: string; asOf: string }) => [st.basis, st.since, st.asOf]), [
    ['document', '2011-02', '2011-06-07'], ['pleadingOurs', '2011-02', '2012-12-18'],
  ]);
  assert.match(owner.statements[0].note, /^<case-record>\n/);
  assert.ok(owner.statements[0].cites[0].control);
  // The fixture gives ten links statements (the stakes, the board seats, the CEO's office and the note); every other link leaves the key out.
  const withStatements = links.filter((l) => 'statements' in l);
  assert.equal(withStatements.length, 10);
  assert.ok(withStatements.every((l) => l.statements.length > 0));
});

test('a bad or foreign cursor is a coded error', async () => {
  const { ctx, audits } = setup();
  for (const cursor of ['not a cursor', encodeCursor('events', 40)]) {
    const { out } = await call(ctx, { section: 'docs', cursor });
    assert.equal(out.isError, true);
    assert.match((out.content[0] as { text: string }).text, /^bad_cursor:/);
  }
  assert.equal(audits.length, 0);
  assert.equal(decodeCursor(encodeCursor('money', 12), 'money'), 12);
  assert.equal(decodeCursor(encodeCursor('money', 12), 'events'), null);
});

test('no published matter is a normal result, not an error', async () => {
  const { ctx, audits } = setup(null);
  const { out, value } = await call(ctx, { section: 'events' });
  assert.equal(out.isError, undefined);
  assert.equal(value.published, false);
  assert.match(value.message, /not published yet/);
  assert.equal(audits.length, 1);
});

test('a malformed matter is a coded error with no matter text', async () => {
  const { out } = await call(setup('{"version": 1, "meta": {"caption": "Secret caption"}}').ctx);
  assert.equal(out.isError, true);
  assert.match((out.content[0] as { text: string }).text, /^overview_unavailable:/);
  assert.doesNotMatch(JSON.stringify(out), /Secret caption/);
});

test('the parsed matter is cached by etag across calls', async () => {
  const { ctx, state } = setup();
  await call(ctx);
  await call(ctx, { section: 'events' });
  assert.equal(state.downloads, 1);
});

test('pageOf stops at the entry and size budgets, always taking one entry', () => {
  const small = Array.from({ length: 100 }, (_, i) => ({ i }));
  assert.deepEqual(pageOf(small, 0).next, PAGE_ENTRIES);
  assert.deepEqual(pageOf(small, 90), { items: small.slice(90), next: null });
  const big = Array.from({ length: 5 }, (_, i) => ({ id: `e${i}`, text: 'x'.repeat(PAGE_BUDGET_CHARS / 3) }));
  assert.deepEqual(pageOf(big, 0), { items: big.slice(0, 2), next: 2 });
  const huge = [{ id: 'h', text: 'x'.repeat(PAGE_BUDGET_CHARS * 2) }];
  const [only] = pageOf(huge, 0).items as { id: string; truncated: boolean }[];
  assert.equal(only!.id, 'h');
  assert.equal(only!.truncated, true);
  assert.equal(typeof shrinkEntry('y'.repeat(MAX_ENTRY_CHARS * 2)), 'string', 'a non-object entry stays its own type');
});

test('the summary lists at most MAX_DEFINED_TERMS defined terms, with the full count', async () => {
  const matter = JSON.parse(MATTER);
  matter.meta.definedTerms = Array.from({ length: 120 }, (_, i) => ({ term: `Term ${i}`, means: `Meaning ${i} `.repeat(30) }));
  const { value } = await call(setup(JSON.stringify(matter)).ctx);
  assert.equal(value.definedTerms.length, MAX_DEFINED_TERMS);
  assert.equal(value.definedTermsTotal, 120);
  assert.ok(JSON.stringify(value).length < 60_000);
});

test('an oversized entry is shrunk under MAX_ENTRY_CHARS, wrappers intact, and flagged', async () => {
  const matter = JSON.parse(MATTER);
  const claim = matter.claims[0];
  const cite = claim.cites[0];
  claim.elements = Array.from({ length: 40 }, (_, i) => ({
    id: `el-${i}`, text: 'Element text. '.repeat(25), authority: 'Authority. '.repeat(30),
    proof: Array.from({ length: 30 }, () => ({ cite, strength: 'direct', note: 'A proof note. '.repeat(20) })),
  }));
  const { entries } = await walk(setup(JSON.stringify(matter)).ctx, 'claims');
  const big = entries.find((c) => c.id === claim.id)!;
  assert.equal(big.truncated, true);
  assert.ok(JSON.stringify(big).length <= MAX_ENTRY_CHARS);
  assert.match(big.elements[0].text, /^<case-record>\n[\s\S]* \[cut\]\n<\/case-record>$/);
  const small = { id: 'x', text: 'short' };
  assert.equal(shrinkEntry(small), small);
});

test('tracks and violations: points with proof, steps with moves, figures in their unit, all as case data', async () => {
  const { ctx } = setup();
  const { entries: tracks } = await walk(ctx, 'tracks');
  assert.deepEqual(tracks.map((t) => [t.id, t.kind]), [['track-complaint', 'complaint'], ['track-wages', 'regulator']]);
  const point = tracks[1].points.find((p: Value) => p.id === 'point-d1');
  assert.match(point.text, /^<case-record>\n/);
  assert.match(point.authority, /Example State Wage Act/);
  assert.match(point.proof[0].cite.control, /^ABC-\d{6}$/);
  assert.equal(tracks[0].points[0].authority, null);
  const { entries: violations } = await walk(ctx, 'violations');
  assert.deepEqual(violations.map((v) => v.mark), ['A', 'B', 'C', 'D']);
  const a = violations[0];
  const c = violations[2];
  assert.deepEqual(c.steps.at(-1).moves.map((m: Value) => [m.from, m.to]), [['org-unvested', 'org-treasury']]);
  // The letter vs minutes pair: headings and quotes are case data, the speaker an id, each side with served cites.
  assert.deepEqual(a.contrast.map((side: Value) => [side.date, side.speaker]), [['2012-05-11', 'per-roe'], ['2012-05-09', 'org-board']]);
  assert.match(a.contrast[0].quote, /^<case-record>\n/);
  assert.match(a.contrast[1].cites[0].control, /^ABC-\d{6}$/);
  assert.equal('contrast' in violations[1], false, 'a violation without one leaves the key out');
  assert.deepEqual(c.figures.map((f: Value) => [f.unit, f.value, f.limit]), [['usd', '$2,683.55', null], ['count', 214684, null]]);
  assert.deepEqual(a.figures.map((f: Value) => [f.value, f.limit]), [[12, 10], [2, 10], [10, 10]]);
  const { entries: orgs } = await walk(ctx, 'orgs');
  assert.equal(orgs.find((o) => o.id === 'org-alder-peak')?.formed, '2011-03-22');
});

test('a track with a brief serves its line, hurdles, dates and counts as case data; one without leaves the keys out', async () => {
  const { ctx } = setup();
  const { entries: tracks } = await walk(ctx, 'tracks');
  const { brief, counts } = tracks[0];
  assert.match(brief.line, /^<case-record>\nThe board removed its CEO/);
  assert.deepEqual(Object.keys(brief), ['line', 'cast', 'hurdles', 'dates', 'exhibits', 'drafts'], 'the whole brief (overview-brief.test.ts covers the rest)');
  assert.deepEqual(brief.hurdles.map((h: Value) => h.id), ['hurdle-cause', 'hurdle-card', 'hurdle-window', 'hurdle-forecast']);
  assert.match(brief.hurdles[0].title, /^<case-record>\nWithout-cause clause/);
  assert.match(brief.hurdles[0].cites[0].control, /^ABC-\d{6}$/);
  assert.deepEqual(brief.dates.map((d: Value) => d.date), ['2012-05-11', '2012-05-09', '2012-06-12']);
  assert.match(brief.dates[0].text, /^<case-record>\n/);
  assert.deepEqual(counts.map((c: Value) => [c.id, c.kind, c.against]), [
    ['draft-duty', 'direct', ['per-moe', 'org-alder-peak']], ['draft-notice', 'direct', ['per-roe', 'org-harbor']],
    ['draft-repurchase', 'direct', ['org-harbor']], ['draft-letter', 'direct', ['per-roe']],
  ]);
  assert.match(counts[0].basis, /^<case-record>\n/);
  assert.deepEqual(counts[1].elements.map((el: Value) => el.points), [['point-a1'], ['point-a1', 'point-a2'], ['point-a3']]);
  assert.equal('brief' in tracks[1], false);
  assert.equal('counts' in tracks[1], false);
  const { entries: violations } = await walk(ctx, 'violations');
  assert.match(violations[1].steps[0].note, /^<case-record>\nAlder Peak holds 18 to 22 percent/);
  assert.deepEqual(violations[1].figures.map((f: Value) => f.group), ['<case-record>\nBridge note\n</case-record>', '<case-record>\nBridge note\n</case-record>', '<case-record>\nBridge top-up\n</case-record>', '<case-record>\nConversion\n</case-record>']);
  assert.equal('note' in violations[0].steps[0], false);
});

test('an entry whose text addresses AI tools is fenced as untrusted and loses its cites; the page notes it and fits compact', async () => {
  const matter = JSON.parse(MATTER);
  const planted = matter.events[0].id as string;
  matter.events[0].summary = PLANTED_AI;
  matter.meta.definedTerms[0].means = PLANTED_AI;
  for (const profile of ['standard', 'compact'] as const) {
    resetOverviewCache();
    const { ctx } = setup(JSON.stringify(matter));
    Object.assign(ctx, { profile });
    const { pages, entries } = await walk(ctx, 'events');
    const event = entries.find((e) => e.id === planted)!;
    assert.equal(event.summary, `${FENCE.ai}${PLANTED_AI}\n</case-record>`, profile);
    assert.deepEqual([event.untrusted, event.cites], ['addressed-to-ai', undefined], profile);
    assert.ok(entries.filter((e) => e.id !== planted).every((e) => e.untrusted === undefined), 'only the planted entry is marked');
    const holding = pages.find((p) => p.entries.some((e: Value) => e.id === planted))!;
    assert.equal(Object.keys(holding)[0], 'untrusted_note', profile);
    assert.equal(holding.untrusted_note, UNTRUSTED_REMINDER, profile);
    const summary = await call(ctx, { section: 'summary' });
    const term = summary.value.definedTerms.find((t: Value) => t.term === 'Doe');
    assert.deepEqual([term.untrusted, term.cite, summary.value.untrusted_note], ['addressed-to-ai', undefined, UNTRUSTED_REMINDER], profile);
    if (profile === 'compact') {
      for (const section of ['events', 'summary']) {
        const { out } = await call(ctx, { section });
        assert.ok((out.content[0] as { text: string }).text.length <= COMPACT_LIMITS.maxChars, section);
      }
    }
  }
});
