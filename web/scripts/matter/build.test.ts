// SPDX-License-Identifier: Apache-2.0
// Card F4. Assembly on the Doe v. Harbor Labs fixture: resolution to ids, the merge order, determinism, and refusals.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { assemble, buildFromDisk, serialize } from './build.ts';
import { CATALOG_REL, parseCatalog } from './catalog.ts';
import { loadFragments, mergeFragments, type LoadedFragment } from './fragments.ts';
import { sha256 } from './paths.ts';
import { loadResolver } from './resolve.ts';
import { FRAGMENTS, NOW, SOURCE_ROOT, fakeD1, id, tempCache } from './testkit.ts';

/** assemble, asserting that parseMatter accepted the result. */
function assembled(...args: [Parameters<typeof assemble>[0], Parameters<typeof assemble>[1], Parameters<typeof assemble>[2]]) {
  const built = assemble(...args, NOW);
  assert.equal(built.info.validation, null);
  assert.ok(built.matter);
  return { matter: built.matter, info: built.info };
}

async function inputs() {
  const catalog = parseCatalog(await readFile(path.join(SOURCE_ROOT, CATALOG_REL), 'utf8'), SOURCE_ROOT);
  const fragments = await loadFragments(FRAGMENTS);
  const resolver = await loadResolver(fakeD1(), SOURCE_ROOT);
  return { catalog, fragments, resolver };
}

const OA = '01-Corporate-Records/Stock_Agreement_SA__20110607__Harbor-Labs__Countersigned.pdf';
const FAC = '08-Court-Pleadings/Complaint_FAC__20130409__Jane-Doe__First-Amended.pdf';
const BANK = '06-Cap-Table/Bank_Statement_BS__20120730__Harbor-Labs__July.pdf';
const EMAIL = '04-Letters/Email_EML__20120507__Mark-Moe__Meeting-Plan.pdf';

test('assemble: the fixture builds clean, with every cite resolved to a documents.id', async () => {
  const { catalog, fragments, resolver } = await inputs();
  const { matter, info } = assembled(catalog, fragments, resolver);
  assert.deepEqual(info.counts, { tracks: 2, violations: 1, events: 2, people: 2, orgs: 1, links: 1, claims: 1, money: 1, docs: 7, definedTerms: 1 });
  assert.deepEqual([info.unresolved, info.unresolvedDocs, info.problems, info.exclusions, info.validation], [[], [], [], [], null]);
  assert.deepEqual(info.catalog, { rows: 8, skipped: 1, notInRoom: 1 });
  assert.equal(matter.meta.builtAt, NOW.toISOString());
  assert.deepEqual(matter.meta.operativePleading, { title: 'First Amended Complaint', cite: { doc: id(FAC), page: null } });
  // Events sort by date, then id; cites carry ids and the optional note.
  assert.deepEqual(matter.events.map((e) => e.id), ['ev-0001', 'ev-0002']);
  assert.deepEqual(matter.events[0].cites, [{ doc: id(OA), page: 3, note: 'Signature page.' }]);
  assert.deepEqual(matter.claims[0].elements[1].proof[0].cite, { doc: id(EMAIL), page: 1 });
  assert.deepEqual(matter.money[0].cites, [{ doc: id(BANK), page: 2 }]);
  // Orgs carry their formation date; tracks and violations resolve their nested cites.
  assert.equal(matter.orgs[0].formed, '2011-02-08');
  assert.deepEqual(matter.violations[0].steps[0].cites, [{ doc: id(EMAIL), page: 1 }]);
  assert.deepEqual(matter.violations[0].figures[0].cites, [{ doc: id(BANK), page: 2 }]);
  assert.deepEqual(matter.tracks[0].points[0].proof[0].cite, { doc: id(OA), page: 4 });
  // Nothing carries a path.
  assert.doesNotMatch(serialize(matter), /"path"|\.pdf"|Shared-with-Counsel/);
});

test('assemble: catalog facts win, fragments fill only the empty fields, privilege only turns on', async () => {
  const { catalog, fragments, resolver } = await inputs();
  const { matter } = assembled(catalog, fragments, resolver);
  assert.deepEqual(matter.docs[id(OA)], {
    date: '2011-06-07', type: 'Stock Agreement', from: ['p-doe', 'p-roe'], to: [],
    summary: 'Stock agreement among Harbor Labs, Inc., Doe and Roe, signed by Doe and Roe.', privileged: false,
  });
  // M5 supplies a document that is not in the catalog.
  assert.deepEqual(matter.docs[id(BANK)], { date: '2012-07-30', type: 'Bank Statement', from: ['org-harbor'], to: ['p-doe'], summary: 'July statement.', privileged: false });
  assert.equal(matter.docs[id('07-Lawyer-Notes-PRIVILEGED/Memo_MEM__20120528__Lisa-Low__Removal-Summary.pdf')].privileged, true);
  // The catalog itself follows no convention and has no facts.
  assert.equal(matter.docs[id('00-Orientation/Document_Catalog.csv')], undefined);
  assert.deepEqual(Object.keys(matter.docs), [...Object.keys(matter.docs)].sort());
});

test('assemble: the same inputs give the same bytes', async () => {
  const { catalog, fragments, resolver } = await inputs();
  const a = serialize(assembled(catalog, fragments, resolver).matter);
  const b = serialize(assembled(catalog, [...fragments].reverse(), resolver).matter);
  assert.equal(sha256(a), sha256(serialize(assembled(catalog, fragments, resolver).matter)));
  // Fragment order only matters for first-wins doc fields and link order; lists are sorted by id.
  assert.deepEqual(JSON.parse(a).events, JSON.parse(b).events);
});

test('assemble: a cite to a file that is not in the room is dropped and listed', async () => {
  const { catalog, fragments, resolver } = await inputs();
  const extra: LoadedFragment = {
    name: 'M9',
    fragment: {
      card: 'M9',
      events: [{ id: 'ev-0009', date: '2012-01-04', title: 'x', summary: null, type: 'meeting', actors: [], claims: [], cites: [{ path: '11-Missing/Gone.pdf', page: 2 }, { path: FAC, page: 1 }] }],
      docs: { '11-Missing/Other.pdf': { summary: 'x' } },
    },
  };
  const { matter, info } = assembled(catalog, [...fragments, extra], resolver);
  assert.deepEqual(info.unresolved, [{ where: 'events:ev-0009', path: '11-Missing/Gone.pdf', page: 2 }]);
  assert.deepEqual(info.unresolvedDocs, ['11-Missing/Other.pdf']);
  assert.deepEqual(matter.events.find((e) => e.id === 'ev-0009')?.cites, [{ doc: id(FAC), page: 1 }]);
});

test('assemble: a prior case resolves its pleading path, and a manifest without one leaves the key out', async () => {
  const { catalog, fragments, resolver } = await inputs();
  assert.equal('priorCase' in assembled(catalog, fragments, resolver).matter.meta, false, 'same bytes as before for old fragments');
  const extra: LoadedFragment = {
    name: 'M9',
    fragment: {
      card: 'M9',
      meta: { priorCase: { caption: 'Doe v. Harbor Labs, Inc.', court: 'District Court, Example County', caseNumber: 'CV-2013-00317', operativePleading: { title: 'First Amended Complaint', cite: { path: FAC, page: 1 } } } },
    } as unknown as LoadedFragment['fragment'],
  };
  const { matter } = assembled(catalog, [...fragments, extra], resolver);
  assert.deepEqual(matter.meta.priorCase, {
    caption: 'Doe v. Harbor Labs, Inc.', court: 'District Court, Example County', caseNumber: 'CV-2013-00317', division: null, judge: null, filed: null,
    operativePleading: { title: 'First Amended Complaint', cite: { doc: id(FAC), page: 1 } },
  });
});

test('assemble: tracks sort complaint first, then by id; violations sort by mark', async () => {
  const { catalog, fragments, resolver } = await inputs();
  const cite = [{ path: FAC, page: 1 }];
  const extra: LoadedFragment = {
    name: 'X',
    fragment: {
      card: 'X',
      violations: [{ id: 'v-0000', mark: 'B', title: 'x', summary: 'x', period: { from: '2012', to: null }, cites: cite }],
      tracks: [{ id: 'tr-a', kind: 'regulator', title: 'x', forum: 'x', violations: ['v-0000'] }],
    },
  };
  const { matter } = assembled(catalog, [...fragments, extra], resolver);
  assert.deepEqual(matter.tracks.map((t) => t.id), ['tr-0001', 'tr-0000', 'tr-a']);
  assert.deepEqual(matter.violations.map((v) => v.mark), ['A', 'B']);
  assert.deepEqual(matter.violations[1].steps, [], 'absent nested lists parse as empty');
});

test('assemble: a nested cite in a step, a figure, a contrast side or a point that is not in the room is dropped and listed', async () => {
  const { catalog, fragments, resolver } = await inputs();
  const gone = { path: '11-Missing/Gone.pdf', page: 3 };
  const patched = fragments.map((f) => {
    if (f.name !== 'M6') return f;
    const fragment = structuredClone(f.fragment) as { violations: Record<string, any>[]; tracks: Record<string, any>[] };
    fragment.violations[0].steps[0].cites.push(gone);
    fragment.violations[0].figures[0].cites.push(gone);
    fragment.tracks[1].points[0].proof.push({ cite: gone, strength: 'gap', note: null });
    fragment.violations[0].contrast = [
      { heading: 'Letter to the team', date: '2012-05-11', speaker: 'p-roe', quote: 'The board voted unanimously.', cites: [{ path: OA, page: 4 }, gone] },
      { heading: 'Minutes show', date: '2012-05-09', speaker: null, quote: 'Vote: 2 to 1.', cites: [{ path: FAC, page: 2 }] },
    ];
    return { name: f.name, fragment } as unknown as LoadedFragment;
  });
  const { matter, info } = assembled(catalog, patched, resolver);
  assert.deepEqual(info.unresolved.map((u) => u.where), [
    'tracks:tr-0001/pt-0001/proof', 'violations:v-0001/st-0001', 'violations:v-0001/fig-0001', 'violations:v-0001/contrast/0',
  ]);
  assert.equal(matter.tracks[0].points[0].proof.length, 1);
  assert.equal(matter.violations[0].steps[0].cites.length, 1);
  assert.deepEqual(matter.violations[0].contrast!.map((side) => side.cites.map((c) => c.doc)), [[id(OA)], [id(FAC)]]);
});

test('assemble: a later fragment adds a brief and counts to a track; brief cites and draft paths resolve, and what is not in the room is dropped and listed', async () => {
  const { catalog, fragments, resolver } = await inputs();
  const gone = { path: '11-Missing/Gone.pdf', page: 3 };
  const email = EMAIL;
  const extra = {
    name: 'M7',
    fragment: {
      card: 'M7',
      tracks: [{
        id: 'tr-0001',
        brief: {
          line: 'The board removed its CEO on two days of notice.',
          cast: [{ id: 'p-roe', role: 'CTO of Harbor Labs', via: 'org-harbor' }],
          hurdles: [{ id: 'h-1', title: 'Card charges', text: 'Roe says the card charges were cause for the removal.', cites: [{ path: OA, page: 4 }, gone] }],
          dates: [{ date: '2012-05-07', text: 'The meeting plan email.', cites: [{ path: email, page: 1 }] }],
          exhibits: [{ cite: { path: OA, page: 4 }, proves: 'The stock agreement binds the company.' }, { cite: gone, proves: 'Not in the room.' }],
          drafts: [{ label: 'Draft complaint', path: FAC }, { label: 'Missing draft', path: '11-Missing/Draft.docx' }],
        },
        counts: [{ id: 'cnt-1', title: 'Breach of the stock agreement', against: ['p-roe'], basis: 'The stock agreement', kind: 'direct', elements: [{ id: 'el-1', text: 'The company bought back vested shares.', points: ['pt-0001'] }] }],
      }],
    },
  } as unknown as LoadedFragment;
  const { matter, info } = assembled(catalog, [...fragments, extra], resolver);
  assert.deepEqual(info.problems, []);
  assert.deepEqual(info.unresolved.map((u) => u.where), ['tracks:tr-0001/brief/hurdles/h-1', 'tracks:tr-0001/brief/exhibits/1', 'tracks:tr-0001/brief/drafts/1']);
  const track = matter.tracks.find((t) => t.id === 'tr-0001')!;
  assert.equal(track.title, 'Current complaint', 'the earlier fragment keeps the rest of the track');
  assert.equal(track.points.length, 1);
  assert.deepEqual(track.brief!.hurdles[0]!.cites, [{ doc: id(OA), page: 4 }]);
  assert.deepEqual(track.brief!.dates[0]!.cites, [{ doc: id(email), page: 1 }]);
  assert.deepEqual(track.brief!.exhibits, [{ cite: { doc: id(OA), page: 4 }, proves: 'The stock agreement binds the company.' }]);
  assert.deepEqual(track.brief!.drafts, [{ label: 'Draft complaint', doc: id(FAC) }]);
  assert.deepEqual(track.counts!.map((c) => c.elements[0]!.points), [['pt-0001']]);
  assert.equal(info.paths[id(FAC)], FAC, 'the report can name the draft by path');
  assert.doesNotMatch(serialize(matter), /"path"|\.docx"/);
});

test('mergeFragments: a track supplement adds only a missing brief or counts; anything else is a duplicate', () => {
  const track = { id: 'tr-1', kind: 'complaint', title: 'T', forum: 'F', against: [], violations: [], points: [], counts: [] };
  const a = { name: 'A', fragment: { card: 'A', tracks: [track] } } as unknown as LoadedFragment;
  const b = { name: 'B', fragment: { card: 'B', tracks: [{ id: 'tr-1', brief: { line: 'One.' } }] } } as unknown as LoadedFragment;
  const c = { name: 'C', fragment: { card: 'C', tracks: [{ id: 'tr-1', brief: { line: 'Two.' }, counts: [] }] } } as unknown as LoadedFragment;
  const d = { name: 'D', fragment: { card: 'D', tracks: [{ id: 'tr-1', title: 'Renamed', brief: { line: 'Three.' } }] } } as unknown as LoadedFragment;
  const draft = mergeFragments([a, b, c, d]);
  assert.deepEqual(draft.problems, [
    'C: tracks id tr-1 already has brief from B',
    'C: tracks id tr-1 already has counts from A',
    'D: tracks id tr-1 is already used by A',
  ]);
  assert.deepEqual(draft.lists.tracks, [{ ...track, brief: { line: 'One.' } }]);
  assert.equal('brief' in track, false, 'the earlier fragment object is left as loaded');
});

test('mergeFragments: duplicate ids, conflicting meta, unknown fields and bad cites are problems', async () => {
  const { catalog, resolver } = await inputs();
  const a: LoadedFragment = { name: 'A', fragment: { card: 'A', meta: { caption: 'Doe v. Harbor Labs, Inc.' }, people: [{ id: 'p-1', cites: [{ path: FAC, page: 0 }] }] } };
  const b = { name: 'B', fragment: { card: 'B', meta: { caption: 'Other' }, people: [{ id: 'p-1' }, { name: 'no id' }], extra: 1 } } as unknown as LoadedFragment;
  const draft = mergeFragments([a, b]);
  assert.deepEqual(draft.problems, [
    'B: unknown field extra',
    'B: meta.caption conflicts with an earlier fragment',
    'B: people id p-1 is already used by A',
    'B: people[1] has no id',
  ]);
  const { info } = assemble(catalog, [a, b], resolver, NOW);
  assert.ok(info.validation);
  assert.ok(info.problems.includes('people:p-1: a cite page must be a whole number from 1, or null'));
});

test('assemble: deadline and future events and money from work product are removed before validation and listed', async () => {
  const { catalog, fragments, resolver } = await inputs();
  const cite = [{ path: FAC, page: 1 }];
  const extra: LoadedFragment = {
    name: 'X',
    fragment: {
      card: 'X',
      events: [
        { id: 'ev-d', date: '2013-01-03', title: 'x', summary: null, type: 'deadline', actors: [], claims: [], cites: cite },
        { id: 'ev-f', date: '2026-10-06', title: 'x', summary: null, type: 'order', actors: [], claims: [], cites: cite },
        { id: 'ev-m', date: '2026-10', title: 'x', summary: null, type: 'order', actors: [], claims: [], cites: cite },
      ],
      money: [
        { id: 'm-wp', date: '2013-05-02', amountCents: 100, from: null, to: null, label: 'x', cites: [cite[0], { path: '10-Lawyer-Analysis/Claim_Chart__WP__20130312.xlsx', page: null }] },
        { id: 'm-none', date: '2013-05-02', amountCents: 100, from: null, to: null, label: 'x', cites: [{ path: '11-Missing/Gone.pdf', page: 1 }] },
      ],
    },
  };
  const { matter, info } = assembled(catalog, [...fragments, extra], resolver);
  assert.deepEqual(info.exclusions, [
    { rule: 'deadline-event', where: 'events:ev-d' },
    { rule: 'future-event', where: 'events:ev-f' },
    { rule: 'no-cite', where: 'money:m-none' },
    { rule: 'money-cites-work-product', where: 'money:m-wp' },
  ]);
  // A month that has begun is not in the future.
  assert.deepEqual(matter.events.map((e) => e.id), ['ev-0001', 'ev-0002', 'ev-m']);
  assert.deepEqual(matter.money.map((m) => m.id), ['m-0001']);
});

test('assemble: a violation naming an excluded event or money entry loses only that reference', async () => {
  const { catalog, fragments, resolver } = await inputs();
  const cite = [{ path: FAC, page: 1 }];
  const extra: LoadedFragment = {
    name: 'X',
    fragment: {
      card: 'X',
      events: [{ id: 'ev-d', date: '2013-01-03', title: 'x', summary: null, type: 'deadline', actors: [], claims: [], cites: cite }],
      money: [{ id: 'm-wp', date: '2013-05-02', amountCents: 100, from: null, to: null, label: 'x', cites: [{ path: '10-Lawyer-Analysis/Claim_Chart__WP__20130312.xlsx', page: null }] }],
      violations: [{ id: 'v-x', mark: 'Z', title: 'x', summary: 'x', period: { from: '2012' }, events: ['ev-0001', 'ev-d'], money: ['m-wp', 'm-0001'], cites: cite }],
    },
  };
  const { matter, info } = assembled(catalog, [...fragments, extra], resolver);
  assert.deepEqual(info.exclusions.map((e) => e.where), ['events:ev-d', 'money:m-wp']);
  const v = matter.violations.find((x) => x.id === 'v-x')!;
  assert.deepEqual([v.events, v.money], [['ev-0001'], ['m-0001']]);
});

test('assemble: a draft parseMatter refuses comes back without a manifest, naming the field only', async () => {
  const { catalog, fragments, resolver } = await inputs();
  const extra: LoadedFragment = { name: 'X', fragment: { card: 'X', people: [{ id: 'p-x', name: 'Roe Junior', role: 'witness', side: 'third', title: null, orgs: [], cites: [] }] } };
  const { matter, info } = assemble(catalog, [...fragments, extra], resolver, NOW);
  assert.equal(matter, null);
  assert.match(info.validation ?? '', /^people\[\d\]\.cites must cite at least one document$/);
  assert.doesNotMatch(info.validation ?? '', /Roe/);
  assert.equal(info.counts.people, 3);
});

test('buildFromDisk: reads the catalog under sourceRoot and the fragments under the cache', async () => {
  const cache = await tempCache();
  const resolver = await loadResolver(fakeD1(), SOURCE_ROOT);
  const { info } = await buildFromDisk(SOURCE_ROOT, cache, resolver, NOW);
  assert.equal(info.counts.events, 2);
  await assert.rejects(buildFromDisk(path.join(SOURCE_ROOT, 'nowhere'), cache, resolver, NOW), /Missing 00-Orientation/);
});

test('assemble: link statements resolve their cites; one that is not in the room is dropped and listed', async () => {
  const { catalog, fragments, resolver } = await inputs();
  const gone = { path: '11-Missing/Gone.pdf', page: 3 };
  const patched = fragments.map((f) => {
    if (f.name !== 'M2') return f;
    const fragment = structuredClone(f.fragment) as { links: Record<string, any>[] };
    fragment.links[0].statements = [
      { held: true, since: '2011-06', asOf: '2011-06-14', basis: 'document', cites: [{ path: OA, page: 4 }, gone] },
      { held: false, asOf: '2013-04-23', basis: 'pleadingTheirs', cites: [{ path: FAC, page: 2 }] },
    ];
    return { name: f.name, fragment } as unknown as LoadedFragment;
  });
  const { matter, info } = assembled(catalog, patched, resolver);
  assert.deepEqual(info.unresolved.map((u) => u.where), ['links:0/0']);
  const statements = matter.links[0].statements!;
  assert.deepEqual(statements.map((st) => [st.basis, st.cites.length, st.since]), [['document', 1, '2011-06'], ['pleadingTheirs', 1, null]]);
  assert.equal(statements[0].cites[0].doc, id(OA));
});
