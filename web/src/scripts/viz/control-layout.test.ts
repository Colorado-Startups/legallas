// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { drawnRows } from './control-geometry.ts';
import { parseMatter } from '../../../worker/matter.ts';
import type { LinkStatement } from '../../../worker/matter-types.ts';
import {
  byDate, changesAt, compareDates, controllersFor, controlModel, layoutControl, notFormedYet, shareWords, tieAt,
  type ControlLink, type ControlParty, type Rect,
} from './control-layout.ts';

const RAW = readFileSync(join(import.meta.dirname, '..', '..', '..', 'fixtures', 'matter.example.json'), 'utf8');
const matter = parseMatter(JSON.parse(RAW), { now: new Date('2026-10-01T12:00:00Z') });
const A = matter.violations.find((v) => v.id === 'viol-notice')!;
const B = matter.violations.find((v) => v.id === 'viol-bridge')!;
const C = matter.violations.find((v) => v.id === 'viol-repurchase')!;

const parties = new Map<string, ControlParty>([
  ...matter.people.map((p) => [p.id, { id: p.id, name: p.name, side: p.side, kind: 'person', parent: null, formed: null }] as const),
  ...matter.orgs.map((o) => [o.id, { id: o.id, name: o.name, side: o.side, kind: 'org', parent: o.parent, formed: o.formed, cites: o.cites }] as const),
]);
const links: ControlLink[] = matter.links.map((l) => ({ from: l.from, to: l.to, label: l.label, statements: l.statements ?? [] }));
const link = (from: string, to: string, label: string) => links.find((l) => l.from === from && l.to === to && l.label === label)!;
const along = (l: ControlLink, steps: readonly { date: string }[] = B.steps) => steps.map((s) => {
  const tie = tieAt(l, s.date);
  return tie && [tie.state, tie.words];
});

const st = (over: Partial<LinkStatement>): LinkStatement => ({
  held: true, since: null, until: null, asOf: '2012-01-01', basis: 'filing', share: null, direct: null, note: null, cites: [], ...over,
});
const tie = (statements: LinkStatement[]): ControlLink => ({ from: 'a', to: 'b', label: 'owner of', statements });

test('partial dates compare by the period they cover', () => {
  assert.equal(byDate('2012-01', '2012-01-01'), true, 'January could have started by its first day');
  assert.equal(byDate('2013', '2013-06-30'), true);
  assert.equal(byDate('2013-02', '2013-01-31'), false);
  assert.equal(byDate('2014-06-15', '2014-06'), true);
  assert.ok(compareDates('2012-01-01', '2012') < 0, 'on the same start the more precise date leads');
  assert.ok(compareDates('2013-03', '2013-02-28') > 0);
  assert.equal(shareWords({ min: 65, max: 65 }), '65%');
  assert.equal(shareWords({ min: 50, max: 75 }), '50 to 75%');
});

test("B's Alder Peak stake: not drawn before it began, then each cap table's band", () => {
  const stake = link('org-alder-peak', 'org-harbor', 'holds preferred in');
  assert.equal(tieAt(stake, '2011-06-01'), null);
  const before = ['record', 'holds preferred in, 18 to 22%'];
  assert.deepEqual(along(stake), [before, before, ['record', 'holds preferred in, 31 to 36%']]);
  assert.deepEqual(tieAt(stake, B.steps[2]!.date)!.basis.map((s) => s.asOf), ['2012-10-26', '2011-12-31'], 'latest first');
});

test('a tie takes each state in turn: claimed, denied, then record', () => {
  // A source that speaks late dates the tie before a denial made in between: claimed, then denied with the claim beside it, then record.
  const tenancy: ControlLink = { from: 'a', to: 'b', label: 'tenant of', statements: [
    st({ held: false, asOf: '2012-07-03', basis: 'document' }),
    st({ since: '2012-02', asOf: '2012-11-08', note: 'County rent roll' }),
  ] };
  assert.deepEqual(['2012-03-01', '2012-09-04', '2012-12-01'].map((d) => {
    const at = tieAt(tenancy, d);
    return at && [at.state, at.words];
  }), [
    ['claimed', 'Claimed Nov. 8, 2012 (County rent roll): tenant of, since Feb. 2012'],
    ['denied', 'tenant of, denied July 3, 2012'],
    ['record', 'tenant of'],
  ]);
  assert.equal(tieAt(tenancy, '2012-09-04')!.later, 'Claimed Nov. 8, 2012 (County rent roll): tenant of, since Feb. 2012');
});

test("the other ties: an account is alleged, a tie dated later is not drawn, a document is in the record from its date", () => {
  assert.deepEqual(along(link('org-alder-peak', 'org-bridge-note', 'funded')), Array(3).fill(['alleged', 'funded, alleged']));
  const seated = ['record', 'sits on'];
  assert.deepEqual(along(link('per-moe', 'org-board', 'sits on'), A.steps), [null, seated, seated, seated]);
  const moe = along(link('per-moe', 'org-alder-peak', 'partner of'), A.steps);
  assert.deepEqual(moe.map((x) => x?.[0]), [undefined, 'record', 'record', 'record']);
  assert.equal(moe[3]![1], 'partner of');
});

test('tie rules at the edges: same-day record beats a denial, a later denial wins, ended ties and inferences are not drawn', () => {
  const denied = st({ held: false, asOf: '2013-03-01', basis: 'document' });
  assert.equal(tieAt(tie([st({ asOf: '2013-03-01' }), denied]), '2013-04-01')!.state, 'record');
  assert.equal(tieAt(tie([st({ asOf: '2012-01-01' }), denied]), '2013-04-01')!.state, 'denied', 'no record as late as the denial');
  assert.equal(tieAt(tie([st({ asOf: '2012-01-01' }), denied]), '2013-02-01')!.state, 'record', 'the denial is not made yet');
  assert.equal(tieAt(tie([st({ until: '2013-03-01' })]), '2013-03-01'), null, 'a tie that ends on the date is not held through it');
  assert.equal(tieAt(tie([st({ until: '2013-03' })]), '2013-02-28')!.state, 'record');
  assert.equal(tieAt(tie([st({ basis: 'inference' })]), '2013-06-01'), null);
  assert.equal(tieAt(tie([st({ basis: 'pleadingTheirs', since: null, asOf: '2013-06-01' })]), '2013-05-01'), null, 'an undated allegation speaks from its own date');
  assert.equal(tieAt(tie([st({ basis: 'pleadingOurs', since: '2012', asOf: '2014-05-08' })]), '2013-05-01')!.words, 'owner of, alleged');
  assert.equal(tieAt(tie([st({ since: null, asOf: '2014-01-01' })]), '2013-05-01'), null, 'a later source that gives no start claims nothing earlier');
  const long = tieAt(tie([st({ since: '2012', asOf: '2014-01-01', note: 'Deed book entry with the full parcel description attached', basis: 'settlement' })]), '2013-05-01')!;
  assert.equal(long.words, 'Claimed Jan. 1, 2014 (settlement communication): owner of, since 2012', 'a long note gives way to the source kind');
});

test('the picture for A: people on top, the holding org, then the entities in tiers; one place per party', () => {
  const model = controlModel(A, parties, links);
  const names = model.rows.map((row) => [row.kind, row.ids]);
  assert.deepEqual(names, [
    ['people', ['per-moe', 'per-roe', 'per-doe']],
    ['holders', ['org-alder-peak']],
    ['entities', ['org-board']],
    ['entities', ['org-ceo-office']],
  ]);
  assert.equal(model.links.length, 7, "six dated ties, and the CEO's office as part of the board");
  assert.ok(!model.parties.has('per-smith'), 'a party with no dated tie to the story stays out');
  assert.equal(model.ties.length, 4);
  assert.ok(model.ties.every((step) => step.length === model.links.length));
});

test('run by, per the record: directly, or through one org; claimed and alleged ties do not count', () => {
  const model = controlModel(B, parties, links);
  const at = (i: number) => controllersFor(model, i, B.steps[i]!);
  assert.deepEqual(at(0), ['per-moe', 'per-doe'], "Doe owns the issuer; Moe's fund holds preferred in it");
  assert.deepEqual(at(1), ['per-moe', 'per-doe', 'per-roe'], 'All three sit on the board that step names');
  assert.deepEqual(at(2), ['per-moe', 'per-doe'], 'The same two, at the conversion');
  assert.deepEqual(controllersFor(controlModel(C, parties, links), 0, C.steps[0]!), [], "Roe's seat is not in the record until the voting agreement");
});

test('run by reaches up a chain of "part of" ties; a claimed, alleged or ended tie does not count', () => {
  const org = (id: string, parent: string | null): ControlParty => ({ id, name: id, side: 'nominal', kind: 'org', parent, formed: null });
  const chain = new Map<string, ControlParty>([
    ['p', { id: 'p', name: 'p', side: 'defendant', kind: 'person', parent: null, formed: null }],
    ['o-top', org('o-top', null)], ['o-mid', org('o-mid', 'o-top')], ['o-low', org('o-low', 'o-mid')],
  ]);
  const step = { date: '2013-06-01', label: 'x', entities: ['o-low'], moves: [] };
  const run = (statement: Partial<LinkStatement>) => {
    const tie: ControlLink = { from: 'p', to: 'o-top', label: 'runs', statements: [st(statement)] };
    return controllersFor(controlModel({ actors: ['p'], entities: ['o-low'], steps: [step] }, chain, [tie]), 0, step);
  };
  assert.deepEqual(run({ since: '2012', asOf: '2012-01-01' }), ['p'], 'two levels up the chain, from the record');
  assert.deepEqual(run({ since: '2012', asOf: '2014-01-01' }), [], 'a source that speaks later only claims the tie');
  assert.deepEqual(run({ since: '2012', asOf: '2012-01-01', basis: 'account' }), [], 'an account only alleges it');
  assert.deepEqual(run({ since: '2012', asOf: '2012-01-01', until: '2013-01-01' }), [], 'a tie that ended before the step reaches nothing');
  const band = { from: 'a', to: 'b', label: 'holds', statements: [st({ since: '2011', asOf: '2012-06-01', note: 'Cap table', share: { min: 5, max: 10 } })] };
  assert.equal(tieAt(band, '2012-01-15')!.state, 'claimed', 'a band is only claimed before its source speaks');
  assert.equal(tieAt(band, '2012-07-01')!.words, 'holds, 5 to 10%', 'and on the record after it');
});

test('what changed is said in words, and an org formed after a date is not formed yet', () => {
  const model = controlModel(A, parties, links);
  assert.deepEqual(changesAt(model, 0, A.steps[0]!), []);
  assert.deepEqual(changesAt(model, 1, A.steps[1]!), [
    'Mark Moe to Alder Peak Ventures, L.P.: partner of.',
    'Alder Peak Ventures, L.P. to Board of Directors: holds a seat on.',
    'Mark Moe to Board of Directors: sits on.',
    'Richard Roe to Board of Directors: sits on.',
    'Jane Doe to Board of Directors: sits on.',
  ]);
  assert.deepEqual(changesAt(model, 2, A.steps[2]!), ['Jane Doe to Office of the CEO: serves in, denied May 9, 2012.']);
  assert.deepEqual(changesAt(controlModel(C, parties, links), 4, C.steps[4]!), [
    "Doe's Unvested Shares to Company Treasury: Repurchased at cost and cancelled.",
  ]);
  const alderPeak = parties.get('org-alder-peak');
  assert.equal(notFormedYet(alderPeak, '2011-03-20'), true);
  assert.equal(notFormedYet(alderPeak, '2011'), false, 'formed within the period');
  assert.equal(notFormedYet(parties.get('per-moe'), '2011'), false, 'people are never unformed');
  assert.equal(notFormedYet(parties.get('org-acme-bank'), '2011'), false, 'an undated org is drawn as formed');
});

test('layout: a list below 600px; above it, every node inside the width with no overlaps, labels clear of nodes', () => {
  const hit = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  for (const model of [controlModel(A, parties, links), controlModel(B, parties, links), controlModel(C, parties, links)]) {
    assert.equal(layoutControl(model, 599), null);
    for (const width of [600, 900, 1200]) {
      const g = layoutControl(model, width)!;
      const nodes = [...g.nodes.values()];
      assert.equal(nodes.length, model.parties.size);
      assert.ok(nodes.every((n) => n.x >= 0 && n.x + n.w <= width && n.y >= 0 && n.y + n.h <= g.height), `in bounds at ${width}`);
      assert.ok(nodes.every((a, i) => nodes.every((b, j) => i === j || !hit(a, b))), `no overlaps at ${width}`);
      assert.equal(g.edges.length, model.links.length);
      assert.ok(g.edges.every((e) => nodes.every((n) => !hit(e.label, n))), `labels clear of nodes at ${width}`);
      const labels = g.edges.map((e) => e.label);
      assert.ok(labels.every((a, i) => labels.every((b, j) => i === j || !hit(a, b))), `labels clear of each other at ${width}`);
      assert.ok(g.edges.every((e) => /^M[\d.-]+ [\d.-]+[LQ]/.test(e.d) && /Z$/.test(e.head)));
    }
    assert.deepEqual(layoutControl(model, 1000), layoutControl(model, 1000), 'the same width gives the same picture');
  }
});

test('"part of": A and C show their structure from the record and who ran it', () => {
  const a = controlModel(A, parties, links);
  const lines = (m: typeof a) => m.links.map((l) => [l.from, l.label, l.to, Boolean(l.structural)]);
  assert.deepEqual(lines(a), [
    ['per-moe', 'partner of', 'org-alder-peak', false],
    ['org-alder-peak', 'holds a seat on', 'org-board', false],
    ['per-moe', 'sits on', 'org-board', false],
    ['per-roe', 'sits on', 'org-board', false],
    ['per-doe', 'sits on', 'org-board', false],
    ['per-doe', 'serves in', 'org-ceo-office', false],
    ['org-ceo-office', 'part of', 'org-board', true],
  ]);
  assert.deepEqual(a.ties[0]!.map((t) => t && [t.state, t.words]), [null, null, null, null, null, ['record', 'serves in'], ['record', 'part of']]);
  assert.deepEqual(a.rows.map((r) => [r.kind, r.ids]), [
    ['people', ['per-moe', 'per-roe', 'per-doe']], ['holders', ['org-alder-peak']], ['entities', ['org-board']], ['entities', ['org-ceo-office']],
  ]);
  assert.deepEqual(controllersFor(a, 2, A.steps[2]!), ['per-moe', 'per-roe', 'per-doe'], "The CEO's office is part of the board, which all three sit on");
  assert.equal(a.links[6]!.cites![0]!.doc, matter.orgs.find((o) => o.id === 'org-ceo-office')!.cites[0]!.doc, 'the line cites the org record');

  const c = controlModel(C, parties, links);
  assert.ok(c.parties.has('org-harbor'), 'the chain climbs to a parent the violation does not name');
  assert.deepEqual(c.links.filter((l) => l.structural).map((l) => `${l.from} > ${l.to}`).sort(), [
    'org-board > org-harbor', 'org-treasury > org-harbor',
  ]);
  assert.deepEqual(controllersFor(c, 4, C.steps[4]!), [], 'The treasury is part of the company, and no tie in the record runs to it');
  const early = controlModel({ ...C, steps: [{ ...C.steps[4]!, date: '2011-03' }] }, parties, links);
  const treasury = early.links.findIndex((l) => l.from === 'org-treasury');
  assert.equal(early.ties[0]![treasury], null, 'no line to an org not formed yet');
});

test('"part of" never speaks over a dated tie: B keeps only its dated ties, and a reached org gets no parent line', () => {
  assert.ok(controlModel(B, parties, links).links.every((l) => !l.structural));
  const org = (id: string, parent: string | null): ControlParty => ({ id, name: id, side: 'nominal', kind: 'org', parent, formed: null });
  const small = new Map([['o-a', org('o-a', 'o-p')], ['o-p', org('o-p', null)], ['o-q', org('o-q', null)]]);
  const dated: ControlLink = { from: 'o-q', to: 'o-a', label: 'owner of', statements: [st({})] };
  const model = controlModel({ actors: [], entities: ['o-a'], steps: [{ date: '2013-06-01', label: 'x', entities: ['o-a'], moves: [] }] }, small, [dated]);
  assert.deepEqual(model.links.map((l) => l.label), ['owner of']);
  assert.ok(!model.parties.has('o-p'), 'the record parent is not drawn');
  const loop = new Map([['o-a', org('o-a', 'o-b')], ['o-b', org('o-b', 'o-a')]]);
  assert.equal(controlModel({ actors: [], entities: ['o-a'], steps: [] }, loop, []).links.length, 2, 'a parent loop ends');
});

test('a lone leaf on the last row moves up beside the row above when it fits and has no tie to it', () => {
  // The fixture's pictures tie their lone leaves to the row above, so the leaf that moves is this test's own.
  const org = (id: string, parent: string | null): ControlParty => ({ id, name: id, side: 'nominal', kind: 'org', parent, formed: null });
  const small = new Map([['o-top', org('o-top', null)], ['o-mid', org('o-mid', null)], ['o-leaf', org('o-leaf', 'o-mid')]]);
  const held: ControlLink = { from: 'o-top', to: 'o-leaf', label: 'holds', statements: [st({})] };
  const picture = { actors: [], entities: ['o-mid', 'o-leaf'], steps: [] };
  const model = controlModel(picture, small, [held]);
  assert.deepEqual(drawnRows(model, 1200).slice(-2).map((r) => r.ids), [['o-top'], ['o-mid', 'o-leaf']]);
  assert.equal(layoutControl(model, 1200)!.nodes.get('o-leaf')!.y, layoutControl(model, 1200)!.nodes.get('o-mid')!.y);
  assert.deepEqual(model.rows.at(-1)!.ids, ['o-leaf'], 'the model keeps its tiers; only the drawing moves the node');
  const tied = controlModel(picture, small, [held, { from: 'o-mid', to: 'o-leaf', label: 'parent of', statements: [st({})] }]);
  assert.deepEqual(drawnRows(tied, 1200).at(-1)!.ids, ['o-leaf'], 'a tie to the row above keeps it below');
});
