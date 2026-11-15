// SPDX-License-Identifier: Apache-2.0
// legallas_case_overview's track briefs on the Doe v. Harbor Labs fixture: the whole brief (cast, key exhibits, drafts) with
// every cite in structured fields, the proof grouped per violation, and the room's filters (removed documents) applied
// to all of it. Owner and counsel keep privileged exhibits; the retired family role is refused the overview itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { docLink } from '../format.ts';
import type { Role } from '../../worker/env.ts';
import { overviewTool } from './overview.ts';
import { DOC_IDS, entriesOf, MATTER_JSON, overviewCtx, type Value } from './overview-fixtures.ts';

const RAW = JSON.parse(MATTER_JSON);
const BRIEF = RAW.tracks[0].brief;
const IDS = Object.values(DOC_IDS);
const control = (doc: string) => `DOE-${String(IDS.indexOf(doc) + 1).padStart(6, '0')}`;
const DRAFT = BRIEF.drafts[0].doc as string;
const WRAPPED = /^<case-record>\n[\s\S]+\n<\/case-record>$/;

async function complaint(setup: Parameters<typeof overviewCtx>[0] = {}): Promise<Value> {
  const tracks = await entriesOf(overviewCtx(setup), 'tracks');
  return tracks.find((t) => t.id === 'track-complaint')!;
}

test('the brief carries its cast with names, roles as case data and the org each acts through', async () => {
  const { brief } = await complaint();
  const people = await entriesOf(overviewCtx(), 'people');
  const orgs = await entriesOf(overviewCtx(), 'orgs');
  const names = new Map([...people, ...orgs].map((p) => [p.id, p.name]));
  assert.deepEqual(brief.cast.map((c: Value) => [c.id, c.via]), BRIEF.cast.map((c: Value) => [c.id, c.via]));
  for (const [i, c] of brief.cast.entries()) {
    assert.equal(c.name, names.get(c.id), 'the party name, from the people and orgs sections');
    assert.equal(c.role, `<case-record>\n${BRIEF.cast[i].role}\n</case-record>`);
  }
});

test('key exhibits: what each proves as case data, the cite as control number, document, page and room link', async () => {
  const { brief } = await complaint();
  assert.equal(brief.exhibits.length, BRIEF.exhibits.length);
  for (const [i, exhibit] of brief.exhibits.entries()) {
    const { doc, page } = BRIEF.exhibits[i].cite;
    assert.equal(exhibit.proves, `<case-record>\n${BRIEF.exhibits[i].proves}\n</case-record>`);
    assert.deepEqual(exhibit.cite, { control: control(doc), doc, page, link: docLink(doc, page) });
  }
});

test('drafts: the label as case data, the document by name, control number, id and room link', async () => {
  const { brief } = await complaint();
  const path = Object.keys(DOC_IDS).find((p) => DOC_IDS[p] === DRAFT)!;
  assert.deepEqual(brief.drafts, [{
    label: '<case-record>\nDraft complaint\n</case-record>', title: path.split('/').pop(), control: control(DRAFT), doc: DRAFT, link: docLink(DRAFT),
  }]);
});

test('every free text field of a brief is case data; ids, dates and cites are plain fields', async () => {
  const { brief } = await complaint();
  assert.match(brief.line, WRAPPED);
  for (const h of brief.hurdles) [h.title, h.text].forEach((s) => assert.match(s, WRAPPED));
  for (const d of brief.dates) assert.match(d.text, WRAPPED);
  for (const c of brief.cast) assert.match(c.role, WRAPPED);
  const cites = [...brief.hurdles, ...brief.dates].flatMap((x: Value) => x.cites).concat(brief.exhibits.map((x: Value) => x.cite));
  assert.ok(cites.length > 10);
  for (const cite of cites) {
    assert.match(cite.control, /^DOE-\d{6}$/);
    assert.equal(cite.link, docLink(cite.doc, cite.page));
  }
});

test('proof per violation: each violation of a track with its points, their strongest proof and the gaps', async () => {
  const tracks = await entriesOf(overviewCtx(), 'tracks');
  const marks = new Map(RAW.violations.map((v: Value) => [v.id, v.mark]));
  const rank = ['gap', 'circumstantial', 'corroborating', 'direct'];
  for (const [i, track] of tracks.entries()) {
    const raw = RAW.tracks[i];
    assert.deepEqual(track.proofByViolation.map((g: Value) => g.violation), raw.violations);
    for (const group of track.proofByViolation) {
      assert.equal(group.mark, marks.get(group.violation));
      const own = raw.points.filter((p: Value) => p.violation === group.violation);
      const best = (p: Value) => p.proof.map((x: Value) => x.strength).sort((a: string, b: string) => rank.indexOf(b) - rank.indexOf(a))[0] ?? 'gap';
      assert.deepEqual(group.points, own.map((p: Value) => ({ id: p.id, strength: best(p) })));
      assert.equal(group.gaps, group.points.filter((p: Value) => p.strength === 'gap').length);
    }
  }
  assert.ok(tracks.some((t) => t.proofByViolation.length > 1), 'the fixture has a track over several violations');
  assert.equal('brief' in tracks[1], false, 'a track without a brief still has its proof per violation');
});

test('a point whose only proof left the room reads as a gap in its violation', async () => {
  const point = RAW.tracks[0].points[0];
  assert.equal(point.proof.length, 1);
  const track = await complaint({ removed: [point.proof[0].cite.doc] });
  const group = track.proofByViolation.find((g: Value) => g.violation === point.violation);
  assert.deepEqual(group.points.find((p: Value) => p.id === point.id), { id: point.id, strength: 'gap' });
  assert.ok(group.gaps >= 1);
});

test('exhibits and drafts follow the room: a removed draft is gone; owner and counsel keep privileged exhibits; the retired role is refused', async () => {
  assert.deepEqual((await complaint({ removed: [DRAFT] })).brief.drafts, []);
  const exhibit = BRIEF.exhibits[0].cite.doc as string;
  for (const role of ['owner', 'counsel'] as const) {
    const seen = await complaint({ privileged: [exhibit, DRAFT], role });
    assert.ok(seen.brief.exhibits.some((x: Value) => x.cite.doc === exhibit), `${role} keeps privileged exhibits`);
    assert.equal(seen.brief.drafts.length, 1, role);
  }
  const retired = overviewCtx({ privileged: [exhibit, DRAFT], role: 'family' as Role });
  const refused = await overviewTool.handler(overviewTool.inputSchema.parse({ section: 'tracks' }), retired);
  assert.equal(refused.isError, true);
  assert.doesNotMatch(JSON.stringify(refused), new RegExp(`${exhibit}|${DRAFT}`));
});
