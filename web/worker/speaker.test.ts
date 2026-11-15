// SPDX-License-Identifier: Apache-2.0
// Who wrote a letter or an email, by kind, from the manifest's people and organizations (fictional Doe fixture).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Matter } from './matter-types.ts';
import { speakerOf, speakerPhrase, speakersOf } from './speaker.ts';

const person = (name: string, role: string, side: string) => ({ id: name, name, role, side, title: null, orgs: [], cites: [] });
const org = (name: string, kind: string, side: string) => ({ id: name, name, kind, side, parent: null, formed: null, cites: [] });
const matter = {
  people: [
    person('Dan Q. Dee', 'defenseCounsel', 'defendant'),
    person('Rita Dee', 'defendant', 'defendant'),
    person('Jane Doe', 'plaintiff', 'client'),
    person('Nina Note', 'plaintiffCounsel', 'client'),
    person('Pat Teller', 'other', 'third'),
    person('Kim Teller', 'defendant', 'defendant'),
  ],
  orgs: [org('Harbor Labs, Inc.', 'company', 'defendant'), org('Note & Low LLP', 'firm', 'client'), org('Moe Produce, Inc.', 'supplier', 'third')],
} as unknown as Pick<Matter, 'people' | 'orgs'>;
const speakers = speakersOf(matter);
const keys = new Map(speakers.map((s) => [s.key, s.kind]));

test('writers by kind: full names and surnames that only one kind of writer carries', () => {
  assert.equal(keys.get('dan dee'), 'opposing-counsel');
  assert.equal(keys.get('rita dee'), 'opposing-party');
  assert.equal(keys.has('dee'), false, 'a surname that writers of two kinds share names no one');
  assert.equal(keys.has('teller'), false, 'a third party shares it too');
  assert.equal(keys.get('kim teller'), 'opposing-party');
  assert.equal(keys.get('jane doe'), 'client');
  assert.equal(keys.has('doe'), false, 'keys shorter than 4 letters are dropped');
  assert.equal(keys.get('note'), 'client-counsel');
  assert.equal(keys.get('harbor labs'), 'opposing-party');
  assert.equal(keys.get('note low'), 'client-counsel');
  assert.equal(keys.has('moe produce'), false, 'a third party names no kind');
});

test("an email's writer comes from its From lines; a thread of mixed writers names none", () => {
  const email = { name: 'EML__20120529__Roof-Photos.pdf', kind: 'email' as const };
  assert.equal(speakerOf(email, ['From: Dan Dee <dd@example.com>\nSent: Aug 17\nWe decline.'], speakers), 'opposing-counsel');
  assert.equal(speakerOf(email, ['| **From** | Jane Doe <jd@example.com> |\n| **To** | Rita Dee |'], speakers), 'client');
  assert.equal(speakerOf(email, ['From\nNina Note\nTo\nJane Doe'], speakers), 'client-counsel');
  assert.equal(speakerOf(email, ['From: Jane Doe\nThanks.\n> From: Rita Dee <rd@example.com>'], speakers), null);
  assert.equal(speakerOf(email, ['No header on this page.'], speakers), null);
  assert.equal(speakerOf(email, ['From: Pat Teller <pt@example.com>'], speakers), null, 'a third party');
  assert.equal(speakerOf(email, ['From: Dan Dee'], []), null, 'no manifest, no speaker');
});

test("a plain letter's writer comes from its Party segment; a demand or engagement letter's does not", () => {
  assert.equal(speakerOf({ name: 'LTR__20120618__Rita-Dee__Repair-Dates.pdf', kind: 'letter' }, [], speakers), 'opposing-party');
  assert.equal(speakerOf({ name: 'Letter__20120503__Nina-Note__Site-Plan.pdf', kind: 'letter' }, [], speakers), 'client-counsel');
  assert.equal(speakerOf({ name: 'Engagement_Letter__20121114__Dan_Dee.pdf', kind: 'letter' }, [], speakers), null);
  assert.equal(speakerOf({ name: 'Demand_Letter_LTR__20120915__Jane_Doe.docx', kind: 'letter' }, [], speakers), null);
  assert.equal(speakerOf({ name: 'LTR__20120711__Unknown__Site-Plan.pdf', kind: 'letter' }, [], speakers), null);
});

test('the words for each kind of writer', () => {
  assert.equal(speakerPhrase('opposing-counsel'), "the other side's counsel");
  assert.equal(speakerPhrase('opposing-party'), 'the other side');
  assert.equal(speakerPhrase('client-counsel'), "the client's counsel");
  assert.equal(speakerPhrase('client'), 'the client');
  assert.equal(speakerPhrase('court'), 'the court');
  assert.equal(speakerPhrase(null), null);
});
