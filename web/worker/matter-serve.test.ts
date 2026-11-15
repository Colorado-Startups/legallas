// SPDX-License-Identifier: Apache-2.0
// serveMatter: dead cites go, entries left uncited go, references to them are pruned, control numbers are joined.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDocFacts } from './doc-facts.ts';
import { serveDocFacts } from './doc-facts-serve.ts';
import { parseMatter } from './matter.ts';
import { serveMatter, type LiveDocs } from './matter-serve.ts';
import type { Matter, ServedMatter } from './matter-types.ts';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures');
const IDS = JSON.parse(readFileSync(join(FIXTURES, 'doc-ids.json'), 'utf8')) as Record<string, string>;
const matter = (): Matter => parseMatter(JSON.parse(readFileSync(join(FIXTURES, 'matter.example.json'), 'utf8')), { now: new Date('2026-10-01T12:00:00Z') });
const docOf = (fragment: string) => IDS[Object.keys(IDS).find((p) => p.includes(fragment))!]!;

/** Every document live, numbered in path order, except the ones named. */
function liveExcept(...fragments: string[]): Map<string, number | null> {
  const dead = new Set(fragments.map(docOf));
  return new Map(Object.keys(IDS).sort().flatMap((path, i) => (dead.has(IDS[path]!) ? [] : [[IDS[path]!, i + 1] as const])));
}

/** Every id a served entry mentions resolves to a served entry. */
function assertResolves(m: ServedMatter) {
  const parties = new Set([...m.people.map((p) => p.id), ...m.orgs.map((o) => o.id)]);
  const orgs = new Set(m.orgs.map((o) => o.id));
  const claims = new Set(m.claims.map((c) => c.id));
  const events = new Set(m.events.map((e) => e.id));
  const money = new Set(m.money.map((x) => x.id));
  const violations = new Set(m.violations.map((v) => v.id));
  const has = (set: Set<string>, id: string | null) => id === null || set.has(id);
  for (const e of m.events) assert.ok(e.actors.every((a) => parties.has(a)) && e.claims.every((c) => claims.has(c)), e.id);
  for (const p of m.people) assert.ok(p.orgs.every((o) => orgs.has(o)), p.id);
  for (const o of m.orgs) assert.ok(has(orgs, o.parent), o.id);
  for (const l of m.links) assert.ok(parties.has(l.from) && parties.has(l.to));
  for (const c of m.claims) assert.ok(c.against.every((a) => parties.has(a)), c.id);
  for (const x of m.money) assert.ok(has(parties, x.from) && has(parties, x.to), x.id);
  for (const d of Object.values(m.docs)) assert.ok([...d.from, ...d.to].every((p) => parties.has(p)));
  for (const v of m.violations) {
    assert.ok(v.actors.every((a) => parties.has(a)) && v.entities.every((o) => orgs.has(o)), v.id);
    assert.ok(v.events.every((e) => events.has(e)) && v.money.every((x) => money.has(x)), v.id);
    for (const s of v.steps) assert.ok(s.entities.every((o) => orgs.has(o)) && s.moves.every((mv) => orgs.has(mv.from) && orgs.has(mv.to)), s.id);
    for (const side of v.contrast ?? []) assert.ok(has(parties, side.speaker), v.id);
  }
  for (const t of m.tracks) {
    assert.ok(t.against.every((a) => parties.has(a)) && t.violations.every((v) => violations.has(v)), t.id);
    assert.ok(t.points.every((p) => t.violations.includes(p.violation)), t.id);
    assert.ok((t.brief?.cast ?? []).every((c) => parties.has(c.id) && has(orgs, c.via)), t.id);
    const points = new Set(t.points.map((p) => p.id));
    for (const c of t.counts ?? []) assert.ok(c.against.every((a) => parties.has(a)) && c.elements.every((el) => el.points.every((p) => points.has(p))), c.id);
  }
  const cites = [
    ...[m.events, m.people, m.orgs, m.links, m.claims, m.money, m.violations].flatMap((list) => list.flatMap((entry) => entry.cites)),
    ...m.links.flatMap((l) => (l.statements ?? []).flatMap((st) => st.cites)),
    ...m.violations.flatMap((v) => (v.contrast ?? []).flatMap((side) => side.cites)),
    ...m.claims.flatMap((c) => c.elements.flatMap((e) => e.proof.map((p) => p.cite))),
    ...m.violations.flatMap((v) => [...v.steps, ...v.figures].flatMap((x) => x.cites)),
    ...m.tracks.flatMap((t) => t.points.flatMap((p) => p.proof.map((x) => x.cite))),
    ...m.tracks.flatMap((t) => [...(t.brief?.hurdles ?? []), ...(t.brief?.dates ?? [])].flatMap((x) => x.cites)),
    ...m.tracks.flatMap((t) => (t.brief?.exhibits ?? []).map((x) => x.cite)),
  ];
  for (const t of m.tracks) {
    for (const entry of [...(t.brief?.hurdles ?? []), ...(t.brief?.dates ?? [])]) assert.ok(entry.cites.length > 0, 'a hurdle or date left uncited is dropped');
  }
  for (const list of [m.violations, ...m.violations.map((v) => v.steps), ...m.violations.map((v) => v.figures)]) {
    for (const entry of list) assert.ok(entry.cites.length > 0, 'an entry left uncited is dropped');
  }
  for (const cite of cites) assert.ok(cite.doc in m.docs, 'every served cite has its document facts');
}

test('with every document live, everything is served with control numbers', () => {
  const live = liveExcept();
  const served = serveMatter(matter(), live);
  assert.equal(served.events.length, 50);
  assert.equal(Object.keys(served.docs).length, 50);
  assert.deepEqual([served.tracks.length, served.violations.length], [2, 4]);
  const cite = served.events[0]!.cites[0]!;
  assert.equal(cite.control, live.get(cite.doc));
  assert.equal(served.docs[cite.doc]!.control, live.get(cite.doc));
  assert.equal(served.meta.operativePleading?.cite.control, live.get(docOf('Amended-Complaint')));
  assertResolves(served);
});

test('a cite note survives the filter', () => {
  const m = matter();
  m.events[0]!.cites[0]!.note = 'Exhibit B';
  m.claims[0]!.elements[0]!.proof[0]!.cite.note = 'Section 4.2';
  const served = serveMatter(m, liveExcept());
  assert.equal(served.events[0]!.cites[0]!.note, 'Exhibit B');
  assert.equal(served.claims[0]!.elements[0]!.proof[0]!.cite.note, 'Section 4.2');
  assert.equal('note' in served.events[1]!.cites[0]!, false);
});

test('control numbers are null before migration 0003 numbers the documents', () => {
  const live: LiveDocs = new Map(Object.values(IDS).map((id) => [id, null]));
  const served = serveMatter(matter(), live);
  assert.equal(served.events.length, 50);
  assert.ok(served.events.every((e) => e.cites.every((c) => c.control === null)));
  assert.ok(Object.values(served.docs).every((d) => d.control === null));
});

test('a removed document takes its cites, and entries left uncited, with it', () => {
  const served = serveMatter(matter(), liveExcept('Bank-Statement__201207', 'Vesting-terms'));
  assert.equal(served.docs[docOf('Vesting-terms')], undefined);
  assert.equal(served.events.some((e) => e.title === 'Roe tells Doe a removal would vest all her shares'), false);
  assert.equal(served.events.length, 48);
  assert.equal(served.orgs.some((o) => o.id === 'org-acme-bank'), false, 'the org cited only to the statement');
  assert.deepEqual(served.money.map((m) => m.id).filter((id) => id === 'usd-12' || id === 'usd-13'), []);
  const misstatement = served.claims.find((c) => c.id === 'claim-5')!;
  assert.equal(misstatement.elements[0]!.proof.length, 0, 'the element stays, now a gap with no proof');
  assertResolves(served);
});

test('references to dropped people and orgs are pruned, never left dangling', () => {
  // Richard Roe is cited only to the stock agreement; Harbor Labs is too.
  const served = serveMatter(matter(), liveExcept('Stock-Agreement__20110607'));
  assert.equal(served.people.some((p) => p.id === 'per-roe'), false);
  assert.equal(served.orgs.some((o) => o.id === 'org-harbor'), false);
  assert.equal(served.orgs.find((o) => o.id === 'org-board')!.parent, null);
  assert.ok(served.events.every((e) => !e.actors.includes('per-roe')));
  assert.ok(served.links.every((l) => l.from !== 'per-roe' && l.to !== 'per-roe'));
  assert.equal(served.money.find((m) => m.id === 'usd-11')!.from, null);
  assert.deepEqual(served.claims.find((c) => c.id === 'claim-2')!.against, []);
  assertResolves(served);
});

test('the meta block stays when its pleading is gone; claims cited only to it go', () => {
  const served = serveMatter(matter(), liveExcept('Amended-Complaint'));
  assert.equal(served.meta.caption, 'Doe v. Harbor Labs, Inc.');
  assert.equal(served.meta.operativePleading, null);
  assert.equal(served.claims.length, 0);
  assert.ok(served.events.every((e) => e.claims.length === 0));
  assertResolves(served);
});

test('money left citing only work product is dropped at serve time too', () => {
  const m = matter();
  const wp = docOf('Claim-Chart__WP');
  m.money[0]!.cites.push({ doc: wp, page: 2 });
  const served = serveMatter(m, liveExcept('Wire__20110613'));
  assert.equal(served.money.some((x) => x.id === 'usd-01'), false);
});

test('removing any one document keeps every reference resolvable', () => {
  for (const path of Object.keys(IDS)) assertResolves(serveMatter(matter(), liveExcept(path)));
  assertResolves(serveMatter(matter(), new Map()));
});

test('the core reads and serves the document facts exactly as the whole manifest does (doc-facts.ts)', () => {
  const raw: unknown = JSON.parse(readFileSync(join(FIXTURES, 'matter.example.json'), 'utf8'));
  const now = new Date('2026-10-01T12:00:00Z');
  const whole = parseMatter(raw, { now });
  const facts = parseDocFacts(raw, now);
  assert.deepEqual(facts, { orgs: whole.orgs, people: whole.people, docs: whole.docs });
  for (const live of [liveExcept(), new Map(), ...Object.keys(IDS).map((path) => liveExcept(path))]) {
    const served = serveMatter(whole, live);
    assert.deepEqual(serveDocFacts(facts, live), { docs: served.docs, people: served.people, orgs: served.orgs });
  }
});

test('a defined term keeps a live pinpoint cite with its control number and loses a dead one', () => {
  const m = matter();
  const live = docOf('Wire__20110613');
  const dead = docOf('Claim-Chart__WP');
  m.meta.definedTerms[0]!.cite = { doc: live, page: 2 };
  m.meta.definedTerms[1]!.cite = { doc: dead, page: 1 };
  const served = serveMatter(m, liveExcept('Claim-Chart__WP'));
  assert.equal(served.meta.definedTerms[0]!.cite?.doc, live);
  assert.equal(typeof served.meta.definedTerms[0]!.cite?.control, 'number');
  assert.equal('cite' in served.meta.definedTerms[1]!, false, 'the term stays; only its dead cite goes');
});

test('violations and tracks lose dead cites, dropped steps and figures, and every dangling id', () => {
  // The conversion schedule is the only cite for the CEO's office and the treasury; the vesting schedule for the unvested shares and
  // figure-c-shares; Roe's letter for step-c3; the amendment for point-b1's proof.
  const served = serveMatter(matter(), liveExcept('Conversion-Schedule', 'Vesting-Schedule', 'Card-charges', 'Note-Amendment'));
  assert.equal(served.orgs.some((o) => o.id === 'org-ceo-office' || o.id === 'org-treasury'), false);
  const c = served.violations.find((v) => v.id === 'viol-repurchase')!;
  assert.deepEqual(c.entities, [], 'the dropped orgs leave the highlight list');
  assert.deepEqual(c.steps.map((s) => s.id), ['step-c1', 'step-c2', 'step-c4', 'step-c5']);
  assert.deepEqual(c.steps.find((s) => s.id === 'step-c5')!.moves, [], 'a move from a dropped org goes');
  assert.deepEqual(c.steps.find((s) => s.id === 'step-c5')!.entities, []);
  assert.deepEqual(c.figures.map((f) => f.id), ['figure-c-price']);
  assert.deepEqual(c.events, ['evt-006', 'evt-025', 'evt-028', 'evt-030']);
  const complaint = served.tracks.find((t) => t.id === 'track-complaint')!;
  assert.deepEqual(complaint.points.find((p) => p.id === 'point-b1')!.proof, [], 'the point stays, now a gap with no proof');
  assertResolves(served);
});

test('a violation left with no live cite goes, and its tracks keep their other violations and points', () => {
  // A cites the meeting notice and the May minutes, D the labor notice and the payroll register: both go.
  const served = serveMatter(matter(), liveExcept('Meeting-Notice__20120507', 'Minutes__20120509', 'Labor-Notice', 'Payroll-Register'));
  assert.equal(served.violations.some((v) => v.id === 'viol-notice'), false);
  const wages = served.tracks.find((t) => t.id === 'track-wages')!;
  assert.deepEqual([wages.violations, wages.points], [[], []], 'a track has no cites of its own, so it stays');
  const complaint = served.tracks.find((t) => t.id === 'track-complaint')!;
  assert.deepEqual([complaint.violations, complaint.points.map((p) => p.id)], [['viol-bridge', 'viol-repurchase'], ['point-b1', 'point-b2', 'point-c1', 'point-c2']]);
  assertResolves(served);
});

test('a manifest without tracks or violations serves empty lists', () => {
  const raw = JSON.parse(readFileSync(join(FIXTURES, 'matter.example.json'), 'utf8'));
  delete raw.tracks;
  delete raw.violations;
  const served = serveMatter(parseMatter(raw, { now: new Date('2026-10-01T12:00:00Z') }), liveExcept());
  assert.deepEqual([served.tracks, served.violations], [[], []]);
});

test('a prior case is served with its pleading cite, which drops when the pleading is not live', () => {
  const raw = JSON.parse(readFileSync(join(FIXTURES, 'matter.example.json'), 'utf8'));
  const { caption, court, operativePleading } = raw.meta;
  raw.meta.priorCase = { caption, court, operativePleading };
  Object.assign(raw.meta, { caption: 'Doe v. Roe', court: 'Not yet filed', operativePleading: null });
  const parsed = parseMatter(raw, { now: new Date('2026-10-01T12:00:00Z') });
  const pleadingDoc = operativePleading.cite.doc as string;
  const served = serveMatter(parsed, liveExcept());
  assert.equal(served.meta.operativePleading, null);
  assert.equal(served.meta.priorCase?.caption, 'Doe v. Harbor Labs, Inc.');
  assert.equal(served.meta.priorCase?.operativePleading?.cite.doc, pleadingDoc);
  const path = Object.keys(IDS).find((p) => IDS[p] === pleadingDoc)!;
  const withoutPleading = serveMatter(parsed, liveExcept(path));
  assert.equal(withoutPleading.meta.priorCase?.caption, 'Doe v. Harbor Labs, Inc.', 'the prior case stays');
  assert.equal(withoutPleading.meta.priorCase?.operativePleading, null, 'its dead cite goes');
});

test('a link statement keeps its live cites, goes when none is left, and the key goes with the last one', () => {
  const m = matter();
  const link = m.links[1]!;
  const wire = docOf('Wire__20110613');
  link.statements = [
    { held: true, since: null, until: null, asOf: '2011-06-13', basis: 'filing', share: null, direct: null, note: null, cites: [{ doc: wire, page: 1 }] },
    { held: false, since: null, until: null, asOf: '2011-07-12', basis: 'document', share: null, direct: null, note: null, cites: [...link.cites, { doc: wire, page: 2 }] },
  ];
  const all = serveMatter(m, liveExcept());
  assert.equal(all.links[1]!.statements?.length, 2);
  assert.equal(typeof all.links[1]!.statements![0]!.cites[0]!.control, 'number', 'statement cites gain control numbers');

  const served = serveMatter(m, liveExcept('Wire__20110613'));
  assert.deepEqual(served.links[1]!.statements!.map((st) => [st.held, st.cites.length]), [[false, 1]]);
  link.statements = link.statements.slice(0, 1);
  assert.equal('statements' in serveMatter(m, liveExcept('Wire__20110613')).links[1]!, false);
  assertResolves(served);
});

test('a contrast keeps its live cites and drops whole when a side has none left; a dropped speaker reads as null', () => {
  const m = matter();
  const a = m.violations.find((v) => v.id === 'viol-notice')!;
  const all = serveMatter(m, liveExcept()).violations.find((v) => v.id === 'viol-notice')!;
  assert.equal(typeof all.contrast![1].cites[0]!.control, 'number', 'side cites gain control numbers');

  const letterOnly = serveMatter(m, liveExcept('Minutes__20120509')).violations.find((v) => v.id === 'viol-notice')!;
  assert.equal('contrast' in letterOnly, false, 'one side alone is no contrast');

  a.contrast![1].cites.push({ doc: docOf('Wire__20110613'), page: 1 });
  const pruned = serveMatter(m, liveExcept('Wire__20110613')).violations.find((v) => v.id === 'viol-notice')!;
  assert.deepEqual(pruned.contrast!.map((side) => side.cites.length), [1, 1], 'a dead cite goes, the side stays');

  a.contrast![0].speaker = 'per-low';
  const served = serveMatter(m, liveExcept('Demand'));
  assert.equal(served.violations.find((v) => v.id === 'viol-notice')!.contrast![0].speaker, null, 'a speaker who leaves the room leaves the side');
  assertResolves(served);
});

test('a brief keeps its live cites, exhibits and drafts; prunes its cast; and its line always stays', () => {
  const live = liveExcept();
  const all = serveMatter(matter(), live).tracks[0]!.brief!;
  assert.deepEqual([all.cast.length, all.hurdles.length, all.dates.length, all.exhibits.length, all.drafts.length], [6, 4, 3, 6, 1]);
  assert.deepEqual(all.drafts, [{ label: 'Draft complaint', doc: docOf('Amended-Complaint'), control: live.get(docOf('Amended-Complaint')) }]);
  assert.equal(all.exhibits[0]!.cite.control, live.get(docOf('Meeting-Notice__20120507')), 'exhibit cites gain control numbers');
  assert.equal(typeof all.hurdles[0]!.cites[0]!.control, 'number');

  // The stock agreement and the draft leave the room: hurdles citing only the agreement go, the exhibit on it goes.
  const served = serveMatter(matter(), liveExcept('Stock-Agreement__20110607', 'Amended-Complaint'));
  const brief = served.tracks[0]!.brief!;
  assert.equal(brief.line, all.line);
  assert.deepEqual(brief.hurdles.map((h) => h.id), ['hurdle-card', 'hurdle-forecast']);
  assert.equal(brief.exhibits.length, 5);
  assert.deepEqual(brief.drafts, [], 'a draft whose document is not live is dropped');
  assertResolves(served);

  // Every date cites Roe's letter, the May minutes or the repurchase notice: with all three gone the dates list empties but the brief stays.
  const quiet = serveMatter(matter(), liveExcept('Team-update', 'Minutes__20120509', 'Repurchase-Notice')).tracks[0]!.brief!;
  assert.deepEqual(quiet.dates, []);
  assert.equal(quiet.line, all.line);
});

test('a brief cast entry whose party is dropped goes, and a dropped via org reads as null', () => {
  const m = matter();
  // Alder Peak is cited only to the investor rights agreement; Moe is cast through it.
  m.orgs.find((o) => o.id === 'org-alder-peak')!.cites = [{ doc: docOf('Investor-Rights'), page: 1 }];
  m.people.find((p) => p.id === 'per-moe')!.cites = [{ doc: docOf('Deposition__20130814'), page: 1 }];
  const served = serveMatter(m, liveExcept('Investor-Rights'));
  const cast = served.tracks[0]!.brief!.cast;
  assert.equal(cast.some((c) => c.id === 'org-alder-peak'), false, 'a party no longer in the room leaves the cast');
  assert.deepEqual(cast.find((c) => c.id === 'per-moe'), { id: 'per-moe', role: 'Defendant; Alder Peak partner on the board', via: null });
  assertResolves(served);
});

test('counts stay, losing parties and points that no longer resolve; an element left with none is a gap', () => {
  const m = matter();
  // The complaint's three violations cite only the last six documents here: with them gone A, B and C drop, and every point of the track with them. The deposition takes Moe out.
  m.people.find((p) => p.id === 'per-moe')!.cites = [{ doc: docOf('Deposition__20130814'), page: 31 }];
  const served = serveMatter(m, liveExcept('Deposition__20130814', 'Meeting-Notice__20120507', 'Minutes__20120509', 'Bridge-Note', 'Conversion-Notice', 'Repurchase-Notice', 'Share-Ledger__20120630'));
  const track = served.tracks[0]!;
  assert.deepEqual(track.points, [], 'the violations are gone, so their points are');
  assert.deepEqual(track.counts!.map((c) => c.id), ['draft-duty', 'draft-notice', 'draft-repurchase', 'draft-letter']);
  assert.ok(track.counts!.every((c) => c.elements.every((el) => el.points.length === 0)));
  assert.deepEqual(track.counts![0]!.against, ['org-alder-peak'], 'Moe left the room');
  assert.equal(track.counts![0]!.kind, 'direct');
  assertResolves(served);
});

test('step notes and figure groups are served as written, and stay absent where absent', () => {
  const served = serveMatter(matter(), liveExcept());
  const [a, b] = served.violations;
  assert.ok(b!.steps.every((s) => typeof s.note === 'string'));
  assert.deepEqual(b!.figures.map((x) => x.group), ['Bridge note', 'Bridge note', 'Bridge top-up', 'Conversion']);
  assert.equal('note' in a!.steps[0]!, false);
  assert.ok(served.tracks.slice(1).every((t) => !('brief' in t) && !('counts' in t)), 'tracks without them leave the keys out');
});
