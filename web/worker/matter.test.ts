// SPDX-License-Identifier: Apache-2.0
// parseMatter: the fixture passes, and every refusal path throws MatterError naming the field, never the value.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isWorkProductType, MatterError, parseMatter } from './matter.ts';

const NOW = new Date('2026-10-01T12:00:00Z');
const FIXTURES = join(import.meta.dirname, '..', 'fixtures');
const RAW = readFileSync(join(FIXTURES, 'matter.example.json'), 'utf8');
const IDS = JSON.parse(readFileSync(join(FIXTURES, 'doc-ids.json'), 'utf8')) as Record<string, string>;

/** A fresh copy of the fixture as plain JSON, to break one field at a time. */
type Json = any;
const fixture = (): Json => JSON.parse(RAW);
const docOf = (fragment: string) => IDS[Object.keys(IDS).find((p) => p.includes(fragment))!]!;
const WORK_PRODUCT_DOC = docOf('Claim-Chart__WP');
const RECORD_DOC = docOf('Wire__20110613');

function refuses(change: (m: Json) => void, pattern: RegExp, name = pattern.source) {
  const m = fixture();
  change(m);
  assert.throws(() => parseMatter(m, { now: NOW }), (error: unknown) => {
    assert.ok(error instanceof MatterError, `${name}: ${String(error)}`);
    assert.match(error.message, pattern, name);
    return true;
  });
}

test('the Doe v. Harbor Labs fixture parses with every list intact', () => {
  const m = parseMatter(fixture(), { now: NOW });
  assert.equal(m.meta.caption, 'Doe v. Harbor Labs, Inc.');
  assert.deepEqual(
    [m.events.length, m.people.length, m.orgs.length, m.links.length, m.claims.length, m.money.length, Object.keys(m.docs).length],
    [50, 12, 15, 24, 5, 15, 50],
  );
  assert.deepEqual([m.tracks.map((t) => t.id), m.violations.map((v) => v.mark)], [['track-complaint', 'track-wages'], ['A', 'B', 'C', 'D']]);
  const strengths = new Set(m.claims.flatMap((c) => c.elements.flatMap((e) => e.proof.map((p) => p.strength))));
  assert.deepEqual([...strengths].sort(), ['circumstantial', 'corroborating', 'direct', 'gap']);
  assert.deepEqual(new Set([...m.people, ...m.orgs].map((p) => p.side)), new Set(['client', 'defendant', 'nominal', 'court', 'third']));
});

test('the fixture doc ids are the stable ones in doc-ids.json (card F9 reuses them)', () => {
  const m = parseMatter(fixture(), { now: NOW });
  assert.deepEqual(Object.keys(m.docs).sort(), Object.values(IDS).sort());
  assert.equal(new Set(Object.values(IDS)).size, Object.keys(IDS).length);
});

test('unknown fields are dropped, repeated cites collapse, and document ids are lowercased', () => {
  const m = fixture();
  m.extra = 'ignored';
  m.events[0].extra = 'ignored';
  m.events[0].cites = [m.events[0].cites[0], { ...m.events[0].cites[0] }, { doc: m.events[0].cites[0].doc.toUpperCase(), page: m.events[0].cites[0].page }];
  const parsed = parseMatter(m, { now: NOW });
  assert.equal('extra' in parsed, false);
  assert.equal('extra' in parsed.events[0]!, false);
  assert.equal(parsed.events[0]!.cites.length, 1);
});

test('the root and version are checked', () => {
  for (const bad of [null, [], 'matter', 1]) assert.throws(() => parseMatter(bad, { now: NOW }), MatterError);
  refuses((m) => (m.version = 2), /matter\.version must be 1/);
  refuses((m) => delete m.meta, /meta must be an object/);
});

test('deadline events are refused: the room is not a deadline tracker', () => {
  refuses((m) => (m.events[3].type = 'deadline'), /events\[3\]\.type is deadline/);
});

test('nothing is dated after the build day', () => {
  refuses((m) => (m.events[0].date = '2026-10-01'), /events\[0\]\.date is after the build date/);
  refuses((m) => (m.events[0].date = '2026-10'), /events\[0\]\.date is after the build date/, 'a later month');
  refuses((m) => (m.events[0].date = '2027'), /events\[0\]\.date is after the build date/, 'a later year');
  refuses((m) => (m.money[0].date = '2026-12-31'), /money\[0\]\.date is after the build date/);
  refuses((m) => (m.meta.filed = '2026-11-02'), /meta\.filed is after the build date/);

  const sameDay = fixture();
  sameDay.events[0].date = '2026-09-30';
  sameDay.money[0].date = '2026-09';
  assert.doesNotThrow(() => parseMatter(sameDay, { now: NOW }));
});

test('the build day is the builder calendar day, and a build stamped in the future is refused', () => {
  const local = fixture();
  local.meta.builtAt = '2026-09-30T22:30:00-06:00';
  local.events[0].date = '2026-09-30';
  assert.doesNotThrow(() => parseMatter(local, { now: NOW }));
  refuses((m) => (m.meta.builtAt = '2026-10-01T13:00:00Z'), /meta\.builtAt is later than the server clock/);
  refuses((m) => (m.meta.builtAt = '2026-09-30'), /meta\.builtAt must be an ISO timestamp/);
  assert.doesNotThrow(() => parseMatter({ ...fixture(), meta: { ...fixture().meta, builtAt: '2026-10-01T12:05:00Z' } }, { now: NOW }), 'small skew');
});

test('money cited only to work product or analysis is refused', () => {
  refuses((m) => (m.money[2].cites = [{ doc: WORK_PRODUCT_DOC, page: 1 }]), /money\[2\] cites only work product/);
  refuses((m) => {
    m.docs[RECORD_DOC].type = 'Business valuation';
    m.money[0].cites = [{ doc: RECORD_DOC, page: 2 }];
  }, /money\[0\] cites only work product/, 'a valuation');

  const mixed = fixture();
  mixed.money[2].cites.push({ doc: WORK_PRODUCT_DOC, page: 3 });
  assert.equal(parseMatter(mixed, { now: NOW }).money[2]!.cites.length, 2, 'a record cite beside work product is kept');
});

test('isWorkProductType reads filename DocTypes and plain types', () => {
  for (const yes of ['Claim_Chart__WP', 'Work product', 'work-product memo', 'Damages model', 'Vesting analysis', 'Valuation', 'Cash flow projections', 'Analyses']) {
    assert.equal(isWorkProductType(yes), true, yes);
  }
  for (const no of [null, 'Bank statement', 'Wire confirmation', 'Email', 'Wipe log', 'Answer', 'Operating agreement']) {
    assert.equal(isWorkProductType(no), false, String(no));
  }
});

test('a cite may carry a neutral note of at most 160 characters', () => {
  const m = fixture();
  m.events[0].cites[0].note = '  Signature page  ';
  m.claims[0].elements[0].proof[0].cite.note = 'x'.repeat(160);
  const parsed = parseMatter(m, { now: NOW });
  assert.equal(parsed.events[0]!.cites[0]!.note, 'Signature page');
  assert.equal(parsed.claims[0]!.elements[0]!.proof[0]!.cite.note!.length, 160);
  assert.equal('note' in parsed.events[1]!.cites[0]!, false, 'no note key when none is given');
  refuses((x) => (x.events[0].cites[0].note = 'x'.repeat(161)), /events\[0\]\.cites\[0\]\.note must be 1 to 160/);
  refuses((x) => (x.meta.operativePleading.cite.note = 42), /meta\.operativePleading\.cite\.note must be a string/);
});

test('every entry must cite a real document page', () => {
  refuses((m) => (m.people[0].cites = []), /people\[0\]\.cites must cite at least one document/);
  refuses((m) => delete m.orgs[1].cites, /orgs\[1\]\.cites must be an array/);
  refuses((m) => (m.events[0].cites[0].doc = 'Folder/file.pdf'), /events\[0\]\.cites\[0\]\.doc must be a document id/);
  refuses((m) => (m.events[0].cites[0].page = 0), /events\[0\]\.cites\[0\]\.page must be a whole number/);
  refuses((m) => (m.links[0].cites[0].page = 1.5), /links\[0\]\.cites\[0\]\.page must be a whole number/);
  refuses((m) => (m.claims[0].elements[0].proof[0].cite = { page: 1 }), /claims\[0\]\.elements\[0\]\.proof\[0\]\.cite\.doc/);
  refuses((m) => (m.meta.operativePleading.cite.doc = 'nope'), /meta\.operativePleading\.cite\.doc/);
});

test('enums follow LegallasCore and the encoding', () => {
  refuses((m) => (m.events[0].type = 'hearing'), /events\[0\]\.type must be one of filing/);
  refuses((m) => (m.people[0].role = 'client'), /people\[0\]\.role must be one of/);
  refuses((m) => (m.people[0].side = 'plaintiff'), /people\[0\]\.side must be one of client, defendant, nominal, court, third/);
  refuses((m) => (m.orgs[0].kind = 'llc'), /orgs\[0\]\.kind must be one of/);
  refuses((m) => (m.claims[0].type = 'negligence'), /claims\[0\]\.type must be one of/);
  refuses((m) => (m.claims[0].elements[0].proof[0].strength = 'strong'), /proof\[0\]\.strength must be one of direct/);
});

test('ids are unique slugs and references resolve', () => {
  refuses((m) => (m.events[1].id = m.events[0].id), /events\[1\]\.id repeats an earlier id/);
  refuses((m) => (m.people[0].id = m.orgs[0].id), /people\[0\]\.id repeats an earlier id/, 'people and orgs share one id space');
  refuses((m) => (m.claims[1].count = m.claims[0].count), /claims\[1\]\.count repeats/);
  refuses((m) => (m.claims[1].elements[0].id = m.claims[0].elements[0].id), /claims\[1\]\.elements\[0\]\.id repeats/);
  refuses((m) => (m.people[0].id = 'Jane Doe'), /people\[0\]\.id must be a lowercase slug id/);
  refuses((m) => m.events[0].actors.push('p-nobody'), /events\[0\]\.actors\[\d+\] names an unknown id/);
  refuses((m) => (m.events[0].claims = ['count-9']), /events\[0\]\.claims\[0\] names an unknown id/);
  refuses((m) => (m.events[0].actors = ['org-board', 'org-board']), /events\[0\]\.actors repeats an id/);
  refuses((m) => (m.claims[0].against = ['p-nobody']), /claims\[0\]\.against\[0\] names an unknown id/);
  refuses((m) => (m.people[0].orgs = ['per-teller']), /people\[0\]\.orgs\[0\] names an unknown id/, 'a person is not an org');
  refuses((m) => (m.orgs[0].parent = m.orgs[0].id), /orgs\[0\]\.parent must name another org/);
  refuses((m) => (m.orgs[0].parent = 'o-nobody'), /orgs\[0\]\.parent must name another org/);
  refuses((m) => (m.links[0].to = 'p-nobody'), /links\[0\]\.to names an unknown id/);
  refuses((m) => (m.links[0].to = m.links[0].from), /links\[0\] links an id to itself/);
  refuses((m) => delete m.links[0].from, /links\[0\] must name both ends/);
  refuses((m) => (m.money[0].from = 'p-nobody'), /money\[0\]\.from names an unknown id/);
  refuses((m) => (m.docs[RECORD_DOC].from = ['p-nobody']), /docs key \d+\.from\[0\] names an unknown id/);
  refuses((m) => (m.money[1].id = m.money[0].id), /money\[1\]\.id repeats/);
});

test('dates, amounts, text and docs keys are checked', () => {
  refuses((m) => (m.events[0].date = '2013-02-30'), /events\[0\]\.date is not a real date/);
  refuses((m) => (m.events[0].date = '23-10'), /events\[0\]\.date must be a date as YYYY/);
  refuses((m) => (m.events[0].date = '1850'), /events\[0\]\.date is not a real date/);
  refuses((m) => (m.money[0].amountCents = -5), /money\[0\]\.amountCents must be whole cents/);
  refuses((m) => (m.money[0].amountCents = 10.5), /money\[0\]\.amountCents must be whole cents/);
  refuses((m) => (m.events[0].title = '   '), /events\[0\]\.title must be 1 to/);
  refuses((m) => (m.meta.caption = 'x'.repeat(301)), /meta\.caption must be 1 to 300/);
  refuses((m) => m.meta.definedTerms.push({ ...m.meta.definedTerms[0] }), /meta\.definedTerms repeats a term/);
  refuses((m) => (m.docs['08-Court-Pleadings/Complaint.pdf'] = { privileged: false }), /docs key \d+ must be a document id/);
  refuses((m) => (m.docs[RECORD_DOC].privileged = 'no'), /docs key \d+\.privileged must be true or false/);
  refuses((m) => (m.events = {}), /events must be an array/);
});

test('error messages name the field, never the matter text', () => {
  const m = fixture();
  m.people[2].side = 'Richard Roe the Elder';
  assert.throws(() => parseMatter(m, { now: NOW }), (error: Error) => !error.message.includes('Roe') && /people\[2\]\.side/.test(error.message));
});

test('money kind is optional, kept when valid, and refused when unknown', () => {
  const m = fixture();
  m.money[0].kind = 'commitment';
  m.money[1].kind = null;
  const parsed = parseMatter(m, { now: NOW });
  assert.equal(parsed.money[0]!.kind, 'commitment');
  assert.equal('kind' in parsed.money[1]!, false, 'a null kind is dropped, not stored');
  refuses((x) => (x.money[0].kind = 'valuation'), /money\[0\]\.kind/);
});

test('a defined term may carry its own pinpoint cite, and a bad one is refused', () => {
  const m = fixture();
  m.meta.definedTerms[0].cite = { doc: RECORD_DOC, page: 2 };
  const parsed = parseMatter(m, { now: NOW });
  assert.deepEqual(parsed.meta.definedTerms[0]!.cite, { doc: RECORD_DOC, page: 2 });
  assert.equal('cite' in parsed.meta.definedTerms[1]!, false, 'a term without a cite stays without one');
  refuses((x) => (x.meta.definedTerms[0].cite = { doc: 'nope', page: 0 }), /meta\.definedTerms\[0\]\.cite/);
});

test('the case number is optional and kept when given', () => {
  const m = fixture();
  assert.equal(parseMatter(m, { now: NOW }).meta.caseNumber, null, 'absent means null');
  m.meta.caseNumber = 'CV-2013-00317';
  assert.equal(parseMatter(m, { now: NOW }).meta.caseNumber, 'CV-2013-00317');
  refuses((x) => (x.meta.caseNumber = 42), /meta\.caseNumber/);
});

test('tracks and violations parse with their steps, moves, figures and points', () => {
  const m = parseMatter(fixture(), { now: NOW });
  const c = m.violations.find((v) => v.id === 'viol-repurchase')!;
  assert.deepEqual(c.period, { from: '2012-05-22', to: '2012-06-30' });
  assert.deepEqual(c.steps[4]!.moves, [{ from: 'org-unvested', to: 'org-treasury', label: 'Repurchased at cost and cancelled' }]);
  assert.deepEqual(c.figures.map((f) => [f.unit, f.value, f.limit]), [['usd', 268355, null], ['count', 214684, null]]);
  const a = m.violations.find((v) => v.id === 'viol-notice')!;
  assert.deepEqual(a.figures.map((f) => [f.value, f.limit]), [[12, 10], [2, 10], [10, 10]]);
  const wages = m.tracks.find((t) => t.id === 'track-wages')!;
  assert.equal(wages.kind, 'regulator');
  assert.equal(wages.points.find((p) => p.id === 'point-d2')!.proof[0]!.strength, 'gap');
  assert.equal(m.tracks[0]!.points[0]!.authority, null, 'the authority is left to counsel');
  assert.equal(m.orgs.find((o) => o.id === 'org-alder-peak')!.formed, '2011-03-22');
  assert.equal(m.orgs.find((o) => o.id === 'org-acme-bank')!.formed, null, 'absent means null');
});

test('a manifest from before tracks and violations parses with empty lists', () => {
  const m = fixture();
  delete m.tracks;
  delete m.violations;
  for (const org of m.orgs) delete org.formed;
  const parsed = parseMatter(m, { now: NOW });
  assert.deepEqual([parsed.tracks, parsed.violations], [[], []]);
  assert.ok(parsed.orgs.every((o) => o.formed === null));
  refuses((x) => (x.tracks = {}), /tracks must be an array/);
  refuses((x) => (x.violations = 'A'), /violations must be an array/);
});

test('violation and track text is capped: headline 90, sentence 200, step label 80', () => {
  refuses((m) => (m.violations[0].title = 'x'.repeat(91)), /violations\[0\]\.title must be 1 to 90/);
  refuses((m) => (m.violations[0].summary = 'x'.repeat(201)), /violations\[0\]\.summary must be 1 to 200/);
  refuses((m) => (m.violations[0].steps[0].label = 'x'.repeat(81)), /violations\[0\]\.steps\[0\]\.label must be 1 to 80/);
  refuses((m) => (m.violations[2].steps[4].moves[0].label = 'x'.repeat(81)), /steps\[4\]\.moves\[0\]\.label must be 1 to 80/);
  refuses((m) => (m.violations[0].figures[0].note = 'x'.repeat(201)), /figures\[0\]\.note must be 1 to 200/);
  refuses((m) => (m.tracks[0].points[0].text = 'x'.repeat(201)), /tracks\[0\]\.points\[0\]\.text must be 1 to 200/);
  refuses((m) => (m.tracks[0].title = 'x'.repeat(91)), /tracks\[0\]\.title must be 1 to 90/);
  refuses((m) => (m.violations = Array.from({ length: 27 }, () => m.violations[0])), /violations has more than 26 entries/);
  const atCap = fixture();
  atCap.violations[0].title = 'x'.repeat(90);
  atCap.tracks[0].points[0].text = 'x'.repeat(200);
  assert.doesNotThrow(() => parseMatter(atCap, { now: NOW }));
});

test('a violation mark is one capital letter, unique across violations', () => {
  for (const bad of ['a', 'AB', '', 1, null]) refuses((m) => (m.violations[0].mark = bad), /violations\[0\]\.mark must be one capital letter/, String(bad));
  refuses((m) => (m.violations[1].mark = 'A'), /violations\[1\]\.mark repeats an earlier mark/);
});

test('violation and track references resolve to the right kind of entry', () => {
  refuses((m) => m.violations[0].actors.push('p-nobody'), /violations\[0\]\.actors\[\d+\] names an unknown id/);
  refuses((m) => (m.violations[0].entities = ['per-roe']), /violations\[0\]\.entities\[0\] names an unknown id/, 'entities are orgs');
  refuses((m) => (m.violations[0].events = ['ev-999']), /violations\[0\]\.events\[0\] names an unknown id/);
  refuses((m) => (m.violations[0].money = ['m-99']), /violations\[0\]\.money\[0\] names an unknown id/);
  refuses((m) => (m.violations[0].steps[0].entities = ['per-roe']), /steps\[0\]\.entities\[0\] names an unknown id/);
  refuses((m) => (m.violations[2].steps[4].moves[0].from = 'per-roe'), /moves\[0\]\.from names an unknown id/, 'moves are between orgs');
  refuses((m) => (m.violations[2].steps[4].moves[0].to = 'org-unvested'), /moves\[0\] moves an org under itself/);
  refuses((m) => delete m.violations[2].steps[4].moves[0].to, /moves\[0\] must name both orgs/);
  refuses((m) => (m.tracks[0].against = ['p-nobody']), /tracks\[0\]\.against\[0\] names an unknown id/);
  refuses((m) => (m.tracks[0].violations = ['v-z']), /tracks\[0\]\.violations\[0\] names an unknown id/);
  refuses((m) => (m.tracks[0].points[0].violation = 'viol-wages'), /tracks\[0\]\.points\[0\]\.violation must name one of its track's violations/);
  refuses((m) => (m.tracks[0].kind = 'arbitration'), /tracks\[0\]\.kind must be one of complaint, regulator/);
});

test('violation, step, figure, track and point ids are unique', () => {
  refuses((m) => (m.violations[1].id = m.violations[0].id), /violations\[1\]\.id repeats/);
  refuses((m) => (m.violations[1].steps[0].id = m.violations[0].steps[0].id), /violations\[1\]\.steps\[0\]\.id repeats/);
  refuses((m) => (m.violations[2].figures[0].id = m.violations[1].figures[0].id), /violations\[2\]\.figures\[0\]\.id repeats/);
  refuses((m) => (m.tracks[1].id = m.tracks[0].id), /tracks\[1\]\.id repeats/);
  refuses((m) => (m.tracks[1].points[0].id = m.tracks[0].points[0].id), /tracks\[1\]\.points\[0\]\.id repeats/);
});

test('figures are whole cents or whole counts, and dates are record facts', () => {
  refuses((m) => (m.violations[2].figures[0].value = 10.5), /figures\[0\]\.value must be whole cents/);
  refuses((m) => (m.violations[0].figures[0].value = -1), /figures\[0\]\.value must be a whole count/);
  refuses((m) => (m.violations[0].figures[0].limit = 1.5), /figures\[0\]\.limit must be a whole count/);
  refuses((m) => (m.violations[0].figures[0].unit = 'percent'), /figures\[0\]\.unit must be one of usd, count/);
  refuses((m) => (m.violations[0].figures[0].cites = []), /figures\[0\]\.cites must cite at least one document/);
  refuses((m) => (m.violations[0].steps[0].cites = []), /steps\[0\]\.cites must cite at least one document/);
  refuses((m) => (m.violations[0].steps[0].date = '2026-10-01'), /steps\[0\]\.date is after the build date/);
  refuses((m) => (m.violations[0].period.to = '2027'), /period\.to is after the build date/);
  refuses((m) => (m.violations[0].period.to = '2011'), /period\.to is before violations\[0\]\.period\.from/);
  refuses((m) => delete m.violations[0].period, /violations\[0\]\.period must be an object/);
  refuses((m) => (m.orgs[0].formed = '2026-10-01'), /orgs\[0\]\.formed is after the build date/);
  refuses((m) => (m.orgs[0].formed = '2013-02-30'), /orgs\[0\]\.formed is not a real date/);
  const open = fixture();
  open.violations[0].period.to = null;
  open.violations[0].period.from = '2012';
  assert.equal(parseMatter(open, { now: NOW }).violations[0]!.period.to, null, 'an open period');
});

test('a prior case parses like the header and stays absent when absent', () => {
  assert.equal('priorCase' in parseMatter(fixture(), { now: NOW }).meta, false, 'absent stays absent');
  const m = fixture();
  const { caption, court, division, judge, filed, operativePleading } = m.meta;
  m.meta.priorCase = { caption, court, caseNumber: 'CV-2013-00317', division, judge, filed, operativePleading };
  Object.assign(m.meta, { caption: 'Doe v. Roe', court: 'Not yet filed', division: null, judge: null, filed: null, operativePleading: null });
  const parsed = parseMatter(m, { now: NOW }).meta;
  assert.deepEqual([parsed.caption, parsed.court, parsed.operativePleading], ['Doe v. Roe', 'Not yet filed', null]);
  assert.equal(parsed.priorCase?.caption, 'Doe v. Harbor Labs, Inc.');
  assert.equal(parsed.priorCase?.caseNumber, 'CV-2013-00317');
  assert.equal(parsed.priorCase?.operativePleading?.title, 'First Amended Complaint');
  refuses((x) => (x.meta.priorCase = { court: 'A court' }), /meta\.priorCase\.caption/);
  refuses((x) => (x.meta.priorCase = { caption: 'Doe v. Harbor Labs', court: 'A court', filed: '2099-01-01' }), /meta\.priorCase\.filed/);
  refuses((x) => (x.meta.priorCase = { caption: 'Doe v. Harbor Labs', court: 'A court', operativePleading: { title: 'FAC', cite: { doc: 'nope', page: 0 } } }), /meta\.priorCase\.operativePleading\.cite/);
  refuses((x) => (x.meta.priorCase = 'closed'), /meta\.priorCase/);
});

test('link statements parse with their defaults, and a link without them keeps its bytes', () => {
  const m = parseMatter(fixture(), { now: NOW });
  const [first, second] = m.links;
  assert.equal(first!.statements?.length, 2);
  assert.deepEqual(first!.statements![0], {
    held: true, since: '2011-02', until: null, asOf: '2011-06-07', basis: 'document', share: { min: 42, max: 42 }, direct: true,
    note: 'The stock agreement lists Doe as the holder of 42 percent of the common stock.', cites: first!.cites,
  });
  assert.equal('statements' in second!, false, 'absent stays absent');

  const raw = fixture();
  raw.links[1].statements = [{ asOf: '2013-02-11', basis: 'filing', share: { min: 40 }, cites: raw.links[1].cites }];
  raw.links[2].statements = [];
  const parsed = parseMatter(raw, { now: NOW });
  assert.deepEqual(parsed.links[1]!.statements, [{
    held: true, since: null, until: null, asOf: '2013-02-11', basis: 'filing', share: { min: 40, max: 40 }, direct: null, note: null,
    cites: raw.links[1].cites,
  }]);
  assert.equal('statements' in parsed.links[2]!, false, 'an empty list is left out');
});

test('link statements are checked: dates, order, source kind, share and cites', () => {
  const with1 = (change: (s: Json) => void) => (m: Json) => {
    const statement = { held: false, asOf: '2013-09-24', basis: 'document', cites: m.links[0].cites };
    change(statement);
    m.links[0].statements = [statement];
  };
  refuses(with1((s) => delete s.asOf), /links\[0\]\.statements\[0\]\.asOf/);
  refuses(with1((s) => (s.asOf = '2026-12-01')), /statements\[0\]\.asOf is after the build date/);
  refuses(with1((s) => { s.since = '2013-06'; s.until = '2013-01'; }), /statements\[0\]\.until is before/);
  refuses(with1((s) => (s.basis = 'rumor')), /statements\[0\]\.basis must be one of/);
  refuses(with1((s) => (s.share = { min: 80, max: 75 })), /share\.max is below/);
  refuses(with1((s) => (s.share = { min: 120 })), /share\.min must be a percent/);
  refuses(with1((s) => (s.held = 'no')), /statements\[0\]\.held must be true or false/);
  refuses(with1((s) => (s.cites = [])), /statements\[0\]\.cites must cite at least one document/);
});

test('a contrast parses as two sides, and a violation without one keeps its bytes', () => {
  const m = parseMatter(fixture(), { now: NOW });
  const a = m.violations.find((v) => v.id === 'viol-notice')!;
  assert.deepEqual(a.contrast!.map((side) => [side.heading, side.date, side.speaker]), [
    ['Letter to the team', '2012-05-11', 'per-roe'], ['Minutes show', '2012-05-09', 'org-board'],
  ]);
  assert.equal(a.contrast![0].cites[0]!.doc, docOf('Team-update'));
  assert.equal('contrast' in m.violations[1]!, false, 'absent stays absent');
  const raw = fixture();
  raw.violations[0].contrast[0].speaker = null;
  assert.equal(parseMatter(raw, { now: NOW }).violations[0]!.contrast![0].speaker, null, 'a side may name no speaker');
});

test('a contrast is checked: two sides, short heading, verbatim quote within 300, a record date, a known speaker, cites', () => {
  const side = (m: Json) => m.violations[0].contrast[0];
  refuses((m) => m.violations[0].contrast.pop(), /violations\[0\]\.contrast must have exactly two sides/);
  refuses((m) => m.violations[0].contrast.push(side(m)), /violations\[0\]\.contrast has more than 2 entries/);
  refuses((m) => (m.violations[0].contrast = { told: 'x' }), /violations\[0\]\.contrast must be an array/);
  refuses((m) => (side(m).heading = 'x'.repeat(41)), /contrast\[0\]\.heading must be 1 to 40/);
  refuses((m) => (side(m).quote = 'x'.repeat(301)), /contrast\[0\]\.quote must be 1 to 300/);
  refuses((m) => (side(m).date = '2026-12-01'), /contrast\[0\]\.date is after the build date/);
  refuses((m) => delete side(m).date, /contrast\[0\]\.date/);
  refuses((m) => (side(m).speaker = 'p-nobody'), /contrast\[0\]\.speaker names an unknown id/);
  refuses((m) => (side(m).cites = []), /contrast\[0\]\.cites must cite at least one document/);
  const atCap = fixture();
  Object.assign(side(atCap), { heading: 'x'.repeat(40), quote: 'x'.repeat(300) });
  assert.doesNotThrow(() => parseMatter(atCap, { now: NOW }));
});

test('a brief and counts parse on the complaint track, and a track without them keeps its bytes', () => {
  const m = parseMatter(fixture(), { now: NOW });
  const [complaint, wages] = m.tracks;
  const brief = complaint!.brief!;
  assert.deepEqual([brief.cast.length, brief.hurdles.length, brief.dates.length, brief.exhibits.length, brief.drafts.length], [6, 4, 3, 6, 1]);
  assert.deepEqual(brief.cast[1], { id: 'per-roe', role: 'Defendant; co-founder and CTO of Harbor Labs', via: 'org-harbor' });
  assert.deepEqual(brief.drafts, [{ label: 'Draft complaint', doc: docOf('Amended-Complaint') }]);
  assert.deepEqual(complaint!.counts!.map((c) => [c.id, c.kind, c.elements.length]), [
    ['draft-duty', 'direct', 2], ['draft-notice', 'direct', 3], ['draft-repurchase', 'direct', 2], ['draft-letter', 'direct', 2],
  ]);
  assert.deepEqual(complaint!.counts![3]!.elements[0]!.points, [], 'an element may have no point yet (a gap)');
  assert.equal('brief' in wages!, false, 'absent stays absent');
  assert.equal('counts' in wages!, false, 'absent stays absent');
  const raw = fixture();
  raw.tracks[0].brief = { line: 'One line.' };
  // The fixture pleads only direct counts: the other kind, in data of this test's own.
  raw.tracks[0].counts[2] = { id: 'draft-other-kind', title: 'A count of the other kind', against: ['org-harbor'], basis: 'A basis of its own', kind: 'derivative', elements: [] };
  const inline = parseMatter(raw, { now: NOW }).tracks[0]!;
  assert.deepEqual(inline.brief, { line: 'One line.', cast: [], hurdles: [], dates: [], exhibits: [], drafts: [] }, 'missing lists read as none');
  assert.deepEqual(inline.counts!.map((c) => c.kind), ['direct', 'direct', 'derivative', 'direct']);
});

test('a brief is checked: lengths, known parties and orgs, record dates, cites, document ids and no repeats', () => {
  const brief = (m: Json) => m.tracks[0].brief;
  refuses((m) => (brief(m).line = 'x'.repeat(201)), /tracks\[0\]\.brief\.line must be 1 to 200/);
  refuses((m) => delete brief(m).line, /tracks\[0\]\.brief\.line must be a string/);
  refuses((m) => (m.tracks[0].brief = []), /tracks\[0\]\.brief must be an object/);
  refuses((m) => (brief(m).cast[0].role = 'x'.repeat(81)), /brief\.cast\[0\]\.role must be 1 to 80/);
  refuses((m) => (brief(m).cast[0].id = 'p-nobody'), /brief\.cast\[0\]\.id names an unknown id/);
  refuses((m) => delete brief(m).cast[0].id, /brief\.cast\[0\]\.id must name a person or org/);
  refuses((m) => (brief(m).cast[0].via = 'per-roe'), /brief\.cast\[0\]\.via names an unknown id/, 'via is an org, never a person');
  refuses((m) => brief(m).cast.push({ ...brief(m).cast[0] }), /brief\.cast names a party twice/);
  refuses((m) => (brief(m).cast = Array(41).fill(brief(m).cast[0])), /brief\.cast has more than 40 entries/);
  refuses((m) => (brief(m).hurdles[0].title = 'x'.repeat(81)), /brief\.hurdles\[0\]\.title must be 1 to 80/);
  refuses((m) => (brief(m).hurdles[0].text = 'x'.repeat(201)), /brief\.hurdles\[0\]\.text must be 1 to 200/);
  refuses((m) => (brief(m).hurdles[0].cites = []), /brief\.hurdles\[0\]\.cites must cite at least one document/);
  refuses((m) => (brief(m).hurdles[1].id = brief(m).hurdles[0].id), /brief\.hurdles\[1\]\.id repeats an earlier id/);
  refuses((m) => (brief(m).hurdles = Array(13).fill(brief(m).hurdles[0])), /brief\.hurdles has more than 12 entries/);
  refuses((m) => (brief(m).dates[0].date = '2026-12-01'), /brief\.dates\[0\]\.date is after the build date/);
  refuses((m) => (brief(m).dates[0].text = 'x'.repeat(121)), /brief\.dates\[0\]\.text must be 1 to 120/);
  refuses((m) => (brief(m).dates[0].cites = []), /brief\.dates\[0\]\.cites must cite at least one document/);
  refuses((m) => (brief(m).exhibits[0].proves = 'x'.repeat(121)), /brief\.exhibits\[0\]\.proves must be 1 to 120/);
  refuses((m) => delete brief(m).exhibits[0].cite, /brief\.exhibits\[0\]\.cite must be an object/);
  refuses((m) => (brief(m).drafts[0].label = 'x'.repeat(81)), /brief\.drafts\[0\]\.label must be 1 to 80/);
  refuses((m) => (brief(m).drafts[0].doc = 'Draft.docx'), /brief\.drafts\[0\]\.doc must be a document id/);
  refuses((m) => brief(m).drafts.push({ label: 'Again', doc: brief(m).drafts[0].doc }), /brief\.drafts names a document twice/);
  const atCap = fixture();
  Object.assign(brief(atCap), { line: 'x'.repeat(200) });
  Object.assign(brief(atCap).hurdles[0], { title: 'x'.repeat(80), text: 'x'.repeat(200) });
  Object.assign(brief(atCap).dates[0], { text: 'x'.repeat(120) });
  Object.assign(brief(atCap).exhibits[0], { proves: 'x'.repeat(120) });
  assert.doesNotThrow(() => parseMatter(atCap, { now: NOW }));
});

test('counts are checked: lengths, kind, known parties, points of their own track and ids unique across tracks', () => {
  const count = (m: Json) => m.tracks[0].counts[0];
  refuses((m) => (count(m).title = 'x'.repeat(91)), /tracks\[0\]\.counts\[0\]\.title must be 1 to 90/);
  refuses((m) => (count(m).basis = 'x'.repeat(121)), /counts\[0\]\.basis must be 1 to 120/);
  refuses((m) => (count(m).kind = 'class'), /counts\[0\]\.kind must be one of direct, derivative/);
  refuses((m) => (count(m).against = ['p-nobody']), /counts\[0\]\.against\[0\] names an unknown id/);
  refuses((m) => (count(m).elements[0].text = 'x'.repeat(121)), /counts\[0\]\.elements\[0\]\.text must be 1 to 120/);
  refuses((m) => (count(m).elements[0].points = ['point-d1']), /counts\[0\]\.elements\[0\]\.points\[0\] must name a point of its own track/);
  refuses((m) => (count(m).elements[0].points = ['point-a1', 'point-a1']), /counts\[0\]\.elements\[0\]\.points repeats an id/);
  refuses((m) => (m.tracks[0].counts[1].id = count(m).id), /tracks\[0\]\.counts\[1\]\.id repeats an earlier id/);
  refuses((m) => (m.tracks[1].counts = [count(m)]), /tracks\[1\]\.counts\[0\]\.elements\[0\]\.points\[0\] must name a point of its own track/);
  refuses((m) => (m.tracks[1].counts = [{ ...count(m), elements: [] }]), /tracks\[1\]\.counts\[0\]\.id repeats an earlier id/, 'count ids are unique across tracks');
  refuses((m) => (m.tracks[0].counts[1].elements[0].id = count(m).elements[0].id), /counts\[1\]\.elements\[0\]\.id repeats an earlier id/);
  refuses((m) => (m.tracks[0].counts = Array(21).fill(count(m))), /tracks\[0\]\.counts has more than 20 entries/);
  refuses((m) => (m.tracks[0].counts = {}), /tracks\[0\]\.counts must be an array/);
});

test('step notes and figure groups parse when present and are left out when absent', () => {
  const m = parseMatter(fixture(), { now: NOW });
  const b = m.violations.find((v) => v.id === 'viol-bridge')!;
  assert.ok(b.steps.every((s) => typeof s.note === 'string' && s.note.length <= 120));
  assert.deepEqual(b.figures.map((x) => x.group), ['Bridge note', 'Bridge note', 'Bridge top-up', 'Conversion']);
  assert.equal('note' in m.violations[0]!.steps[0]!, false, 'absent stays absent');
  assert.equal('group' in m.violations[0]!.figures[0]!, false, 'absent stays absent');
  const raw = fixture();
  raw.violations[1].steps[0].note = '';
  raw.violations[1].figures[0].group = null;
  const blank = parseMatter(raw, { now: NOW }).violations[1]!;
  assert.deepEqual(['note' in blank.steps[0]!, 'group' in blank.figures[0]!], [false, false], 'empty reads as absent');
  refuses((x) => (x.violations[1].steps[0].note = 'x'.repeat(121)), /violations\[1\]\.steps\[0\]\.note must be 1 to 120/);
  refuses((x) => (x.violations[1].figures[0].group = 'x'.repeat(41)), /violations\[1\]\.figures\[0\]\.group must be 1 to 40/);
  refuses((x) => (x.violations[1].steps[0].note = 7), /violations\[1\]\.steps\[0\]\.note must be a string/);
});
