// SPDX-License-Identifier: Apache-2.0
// The case picture Ask reads with every question: built from the Doe v. Harbor Labs fixture, it names the matter now, fences
// each filing, tags only live proof, names a page-less proof without a tag, and marks the prior case closed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { briefDocIds, caseBrief, complaintFiled, complaintStatus, countTitles, draftComplaintDoc, matterBrief } from './ask-brief.ts';
import { shapeAnswer } from './answer-shape.ts';
import { askTurn } from './ask-turn.ts';
import { citeBook } from './cite-book.ts';
import type { CitableDoc } from './passages.ts';
import { parseMatter } from './matter.ts';
import type { Matter } from './matter-types.ts';
import { MATTER_REMINDER, MATTER_REMINDER_FILED } from './prompt.ts';

const NOW = new Date('2026-10-01T12:00:00Z');
const RAW = readFileSync(join(import.meta.dirname, '..', 'fixtures', 'matter.example.json'), 'utf8');

/** The fixture as the owner's matter now reads: a new caption, not yet filed, with the old case under priorCase. */
function movedOn(): Matter {
  const raw = JSON.parse(RAW);
  const { caption, court, judge, operativePleading } = raw.meta;
  raw.meta.priorCase = { caption, court, caseNumber: 'CV-2013-00317', judge, operativePleading };
  Object.assign(raw.meta, { caption: 'Doe v. Roe', court: 'Not yet filed', division: null, judge: null, filed: null, operativePleading: null });
  return parseMatter(raw, { now: NOW });
}

const allCitable = (m: Matter) => new Map(briefDocIds(m).map((id, i) => [id, { id, name: `Doc ${i}.pdf`, pages: 9 } as CitableDoc]));

test('the brief names the matter now, fences each filing and marks the prior case closed', () => {
  const m = movedOn();
  const brief = caseBrief(m, allCitable(m))!;
  assert.match(brief, /^Matter now: Doe v\. Roe \(Not yet filed\)\./);
  assert.match(brief, /Filing 1 of 2: Doe v\. Harbor Labs, Inc\.\n {3}Kind: complaint\./);
  assert.match(brief, /Would name: Richard Roe, /);
  assert.match(brief, /Status: Not yet filed\. A draft complaint for counsel's review \[doc:[^\]]+ p:1\] pleads 4 counts;/);
  assert.match(brief, /Filing 2 of 2: Regulator filing: unpaid final wages\n[\s\S]*Status: Not yet submitted/);
  assert.equal(brief.match(/^\(end of /gm)?.length, 2, 'each filing closes with its title');
  const first = m.tracks[0]!.points[0]!.proof[0]!;
  assert.ok(brief.includes(`${first.strength} [doc:${first.cite.doc} p:${first.cite.page}]`), 'live proof carries its tag');
  assert.match(brief, /\nViolations:\n- A: /);
  assert.match(brief, /Prior case \(closed; history only, not being pursued\): Doe v\. Harbor Labs, Inc\. District Court/);
  assert.doesNotMatch(brief, /Inc\.\./, 'a caption ending in a period gets no second one');
  assert.match(brief, /Case No\. CV-2013-00317/);
});

test('proof is tagged only when its document is live; a page-less proof is named, not tagged', () => {
  const m = movedOn();
  assert.match(caseBrief(m, new Map())!, /Proof: none in the room yet\./);
  assert.doesNotMatch(caseBrief(m, new Map())!, /\[doc:/);
  const proof = m.tracks[0]!.points[0]!.proof[0]!;
  proof.cite = { ...proof.cite, page: null };
  const brief = caseBrief(m, allCitable(m))!;
  assert.ok(brief.includes(`${proof.strength} (Doc 0.pdf, no page)`));
  assert.ok(!brief.includes(`[doc:${proof.cite.doc} p:null]`));
});

test('no tracks and no prior case: no brief; ids are each proof document and draft complaint once', () => {
  const plain = parseMatter({ ...JSON.parse(RAW), tracks: [] }, { now: NOW });
  assert.equal(caseBrief(plain, new Map()), null);
  const m = movedOn();
  const ids = briefDocIds(m);
  assert.equal(new Set(ids).size, ids.length);
  const proof = m.tracks.flatMap((t) => t.points.flatMap((p) => p.proof.map((x) => x.cite.doc)));
  assert.deepEqual(new Set(ids), new Set([...proof, draftComplaintDoc(m.tracks[0]!)!]));
});

test('matterBrief never throws, returns null without a manifest, and looks documents up in slices under 100', async () => {
  assert.equal(await matterBrief(async () => null, async () => new Map()), null);
  assert.equal(await matterBrief(async () => { throw new SyntaxError('bad'); }, async () => new Map()), null);
  const m = movedOn();
  const extra = Array.from({ length: 95 }, (_, i) => ({ cite: { doc: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, page: 1 }, strength: 'direct' as const, note: null }));
  m.tracks[0]!.points[0]!.proof.push(...extra);
  const slices: number[] = [];
  const got = await matterBrief(async () => m, async (ids) => {
    slices.push(ids.length);
    return new Map(ids.map((id) => [id, { id, name: 'x.pdf', pages: 2 }]));
  });
  assert.ok(slices.every((n) => n <= 90) && slices.length >= 2, `slices ${slices.join(',')}`);
  assert.equal(got?.citable.size, briefDocIds(m).length);
  assert.match(got?.text ?? '', /Matter now: Doe v\. Roe/);
});

test('the complaint status comes from the manifest: undrafted only without counts, a filed matter names its filing', () => {
  const m = movedOn();
  m.tracks[0]!.counts = [];
  assert.match(caseBrief(m, allCitable(m))!, /Status: Not yet filed; its causes of action are not drafted yet/);
  assert.equal(complaintFiled(m), false);
  Object.assign(m.meta, { filed: '2013-11-21', caseNumber: 'CIV-13-5120' });
  assert.equal(complaintFiled(m), true);
  assert.match(caseBrief(m, allCitable(m))!, /Status: Filed 2013-11-21 \(Case No\. CIV-13-5120\); the case picture does not list its counts/);
  const counted = movedOn();
  Object.assign(counted.meta, { filed: '2013-11-21', caseNumber: null });
  const filed = caseBrief(counted, allCitable(counted))!;
  assert.match(filed, /Status: Filed 2013-11-21; it pleads 4 counts\.\n/);
  assert.doesNotMatch(filed, /draft complaint/, 'a filed complaint is not called a draft');
});

test('drafted counts: the draft pleads N counts, is not filed and may be revised; the draft complaint is tagged when live', () => {
  const m = movedOn();
  const track = m.tracks[0]!;
  const draft = draftComplaintDoc(track)!;
  assert.ok(draft, 'the fixture links its draft complaint');
  assert.ok(briefDocIds(m).includes(draft), 'the draft complaint is looked up with the proof');
  const live = allCitable(m);
  const titles = countTitles(track.counts!);
  const tagged = `Not yet filed. A draft complaint for counsel's review [doc:${draft} p:1] pleads 4 counts; it is not filed, and counsel may revise it.${titles}`;
  assert.equal(complaintStatus(track, m, live), tagged);
  const untagged = `Not yet filed. A draft complaint for counsel's review pleads 4 counts; it is not filed, and counsel may revise it.${titles}`;
  live.delete(draft);
  assert.equal(complaintStatus(track, m, live), untagged, 'no tag when the draft is not live');
  track.brief!.drafts = track.brief!.drafts.filter((d) => d.doc !== draft);
  assert.equal(draftComplaintDoc(track), null);
  assert.equal(complaintStatus(track, m, allCitable(m)), untagged, 'counts without a draft link');
  track.counts = track.counts!.slice(0, 1);
  assert.match(complaintStatus(track, m, allCitable(m)), /pleads 1 count;/);
});

test('only a draft link that names the complaint is the draft complaint, and only on a complaint track', () => {
  const track = movedOn().tracks[0]!;
  const drafts = [{ label: 'Draft demand letter', doc: 'aaaaaaaa-0000-4000-8000-000000000001' }, { label: 'Drafting memo', doc: 'aaaaaaaa-0000-4000-8000-000000000002' }];
  assert.equal(draftComplaintDoc({ ...track, brief: { ...track.brief!, drafts } }), null);
  assert.equal(draftComplaintDoc({ ...track, kind: 'regulator' }), null);
});

test('drafted counts are never called undrafted or undecided; the picture names their titles, not their bases or elements', () => {
  const m = movedOn();
  const brief = caseBrief(m, allCitable(m))!;
  const counts = m.tracks[0]!.counts!;
  assert.doesNotMatch(brief, /not drafted|counsel decides its causes/);
  for (const count of counts) {
    assert.ok(!brief.includes(count.basis.replace(/\.$/, '')), 'no count basis');
    for (const element of count.elements) assert.ok(!brief.includes(element.text), 'no count element');
  }
  const names = counts.map((c, i) => `(${i + 1}) ${c.title.replace(/\s*;\s*/g, ', ')}`).join('; ');
  assert.ok(brief.includes(`it is not filed, and counsel may revise it. Counts in counsel's draft: ${names}.\n   Points to prove:`), 'titles in manifest order, on the status line');
  // The old rule ("no count title in the picture") is reversed on purpose; titles still appear nowhere but that line.
  for (const count of counts) {
    const title = count.title.replace(/\s*;\s*/g, ', ');
    assert.equal(brief.split(title).length - 1, 1, `"${title}" only on the status line`);
  }
});

test('count titles: all named in order on one line, bounded, and nothing when there are none', () => {
  assert.equal(countTitles([{ title: 'Breach of the bylaws' }, { title: 'Unjust\nenrichment.' }, { title: 'Wrongful repurchase' }]), " Counts in counsel's draft: (1) Breach of the bylaws; (2) Unjust enrichment; (3) Wrongful repurchase.");
  assert.equal(countTitles([]), '');
  assert.equal(countTitles([{ title: 'Short notice; lost shares' }, { title: 'Wrongful repurchase' }]), " Counts in counsel's draft: (1) Short notice, lost shares; (2) Wrongful repurchase.", 'a semicolon in a title becomes a comma');
  const many = Array.from({ length: 40 }, (_, i) => ({ title: `Count ${i + 1} ${'x'.repeat(80)}` }));
  const bounded = countTitles(many);
  assert.ok(bounded.length < 900, `bounded (${bounded.length})`);
  assert.doesNotMatch(bounded, /\n/);
  assert.match(bounded, /^ Counts in counsel's draft: \(1\) Count 1 x+; \(2\) Count 2 x+;/, 'first titles kept, in order');
  const shown = (bounded.match(/\(\d+\) Count/g) ?? []).length;
  assert.match(bounded, new RegExp(`; and ${40 - shown} more\\.$`), 'the rest are counted');
  const m = movedOn();
  m.tracks[0]!.counts = [];
  assert.doesNotMatch(complaintStatus(m.tracks[0]!, m, allCitable(m)), /Counts in counsel's draft/, 'no counts: unchanged line');
  const filed = movedOn();
  Object.assign(filed.meta, { filed: '2013-11-21' });
  assert.equal(complaintStatus(filed.tracks[0]!, filed, allCitable(filed)), 'Filed 2013-11-21; it pleads 4 counts.', 'a filed complaint keeps its line');
});

test('matterBrief says whether the complaint is filed', async () => {
  const m = movedOn();
  assert.equal((await matterBrief(async () => m, async () => new Map()))?.filed, false);
  Object.assign(m.meta, { caseNumber: 'CIV-13-5120' });
  assert.equal((await matterBrief(async () => m, async () => new Map()))?.filed, true);
});

test('the turn carries the filing status to the matter reminder', async () => {
  const m = movedOn();
  const reminderOf = async () => {
    const brief = await matterBrief(async () => m, async () => new Map());
    const user = askTurn({ question: 'Who is the complaint against?', chunks: [], citable: new Map(), brief }).messages[1]!.content;
    return { unfiled: user.includes(MATTER_REMINDER), filed: user.includes(MATTER_REMINDER_FILED) };
  };
  assert.deepEqual(await reminderOf(), { unfiled: true, filed: false });
  Object.assign(m.meta, { filed: '2013-11-21' });
  assert.deepEqual(await reminderOf(), { unfiled: false, filed: true });
});

test('"Which counts does the current complaint plead?" with no passage of the draft: its tag is citable, Read, and framed as a draft', () => {
  const m = movedOn();
  const draft = draftComplaintDoc(m.tracks[0]!)!;
  const citable = allCitable(m);
  citable.set(draft, { id: draft, name: 'Complaint_FAC__20131107__Jane-Doe__Removal_DRAFT.docx', pages: null, folder: '08-Court-Pleadings/drafts' });
  const text = caseBrief(m, citable)!;
  const book = citeBook([], new Map(), { text, citable });
  const alias = book.entries.get(draft)!.alias;
  const shaped = shapeAnswer(`- CONFIRMED: Roe ran the meeting [doc:${alias} p:1].`, book).text;
  assert.equal(shaped, `- READ: According to a draft complaint, Roe ran the meeting [doc:${draft} p:1].`, 'a draft is never a Fact or a party filing');
  const named = shapeAnswer(`- CONFIRMED: The draft complaint pleads four counts [doc:${alias} p:1].`, book).text;
  assert.equal(named, `- READ: The draft complaint pleads four counts [doc:${draft} p:1].`, 'a claim that names the draft keeps its words');
  assert.deepEqual([book.allows(draft, 1), book.allows(draft, 2)], [true, false], 'only the tagged page is citable');
});
