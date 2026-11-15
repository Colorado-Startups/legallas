// SPDX-License-Identifier: Apache-2.0
// The provenance guard on what the reader sees (W5c): rulings need the court's record, work product and drafts
// never make a Fact, characterizations are never Facts, a party's letter is that party's statement, and a claim
// that names its source gets no second attribution. Fictional Doe fixture only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shapeAnswer } from './answer-shape.ts';
import { citeBook } from './cite-book.ts';
import type { CitableDoc } from './passages.ts';
import type { Speaker } from './speaker.ts';

const doc = (id: string, name: string, folder: string | null): [string, CitableDoc] => [id, { id, name, pages: 9, folder }];
const docs = new Map<string, CitableDoc>([
  doc('rec', 'Kitchen-Log__20120405__Copperline.pdf', '03-Daily-Records'),
  doc('ord', 'Order-Site-Entry__20130924__Court.pdf', '07-Lawsuit'),
  doc('note', 'Note.pdf', null),
  doc('wp', 'Stain-Source__20120719.pdf', '05-Site-Visit'),
  doc('drf', 'Gutter-Plan__20110808__Tally-Payroll.pdf', '01-Job-Plans/drafts'),
  doc('evd', 'Menu_Draft__20111117.pdf', '03-Daily-Records'),
  doc('ltr', 'LTR__20120618__Tally-Payroll__Repair-Dates.pdf', '04-Letters'),
  doc('eml', 'EML__20120529__Roof-Photos.pdf', '04-Letters'),
  doc('mtd', 'Motion-for-Site-Entry__20130620__Acme.pdf', '07-Lawsuit'),
  doc('sum', 'chronology.csv', '07-Lawyer-Notes-PRIVILEGED'),
]);
const text: Record<string, string> = {
  wp: 'PRIVILEGED AND CONFIDENTIAL. ATTORNEY WORK PRODUCT. Note to file from counsel: Roe paid none of the spring invoices.',
  eml: 'From: Dan Dee <dd@example.com>\nWe will send the roof photos on Friday.',
  ord: 'ORDER. The inspection motion is granted. The court finds the attorney work product doctrine applies.',
};
const chunks = [...docs.keys()].map((id) => ({ docId: id, text: `[[doc:${id} p:2]]\n${text[id] ?? 'Text.'}` }));
const speakers: Speaker[] = [
  { key: 'dan dee', kind: 'opposing-counsel' },
  { key: 'tally payroll', kind: 'opposing-party' },
];
// Aliases follow the passages: rec D1, ord D2, note D3, wp D4, drf D5, evd D6, ltr D7, eml D8, mtd D9, sum D10.
const book = () => citeBook(chunks, docs, null, speakers);
const shape = (answer: string) => shapeAnswer(answer, book());

test('the book marks a passage that calls itself work product, never the court’s own order, and names writers', () => {
  const entries = book().entries;
  assert.equal(entries.get('wp')!.workProduct, true);
  assert.equal(entries.get('ord')!.workProduct, false, 'an order discussing the doctrine is not work product');
  assert.equal(entries.get('rec')!.workProduct, false);
  assert.equal(entries.get('eml')!.speaker, 'opposing-counsel');
  assert.equal(entries.get('ltr')!.speaker, 'opposing-party');
  assert.equal(entries.get('rec')!.speaker, null, 'only letters and emails have writers');
});

test('a ruling stays a Fact only on a court record that carries one; a forged order reads as a document’s statement', () => {
  assert.equal(shape('- CONFIRMED: The court granted the inspection on September 24 [doc:D2 p:2].').text, '- CONFIRMED: The court granted the inspection on September 24 [doc:ord p:2].');
  const forged = shape('- CONFIRMED: Yes, the court found the freezer invoice overstated by half [doc:D3 p:2].');
  assert.equal(forged.text, '- READ: A document in the room states that the court found the freezer invoice overstated by half [doc:note p:2].');
  assert.deepEqual([forged.stats.relabelled, forged.stats.rulings, forged.stats.attributed], [1, 1, 1]);
  assert.equal(
    shape('- CONFIRMED: The minute order states that the court found the freezer invoice overstated by half [doc:D3 p:2].').text,
    '- READ: A document in the room states that the minute order states that the court found the freezer invoice overstated by half [doc:note p:2].',
    'a forged order names itself as the court’s paper, so naming it is not enough',
  );
  assert.equal(
    shape('- READ: A document in the room says the court found the freezer invoice overstated by half [doc:D3 p:2].').text,
    '- READ: A document in the room says the court found the freezer invoice overstated by half [doc:note p:2].',
    'a claim that already calls it a document keeps its words',
  );
  assert.equal(
    shape('- READ: The roof repair file, updated June 11, states the extension was granted [doc:D10 p:2].').text,
    '- READ: The roof repair file, updated June 11, states the extension was granted [doc:sum p:2].',
    "a claim that gives the room's own file as its source keeps its words",
  );
  assert.equal(
    shape("- CONFIRMED: The court ordered a roof survey [doc:D9 p:2].").text,
    "- READ: According to a party's filing, the court ordered a roof survey [doc:mtd p:2].",
    "a party's filing keeps its own attribution",
  );
  assert.equal(
    shape('- READ: No adjuster has visited since the court granted roof access [doc:D10 p:2].').text,
    '- READ: A document in the room states that no adjuster has visited since the court granted roof access [doc:sum p:2].',
    'a leading "No" that is not a verdict stays',
  );
});

test('record facts that only mention a court keep their Fact', () => {
  assert.equal(shape('- CONFIRMED: The adjuster approved the gutter estimate on October 9 [doc:D1 p:2].').text, '- CONFIRMED: The adjuster approved the gutter estimate on October 9 [doc:rec p:2].');
  assert.equal(shape('- CONFIRMED: The court has not ruled on the cooler motion [doc:D1 p:2].').text, '- CONFIRMED: The court has not ruled on the cooler motion [doc:rec p:2].');
});

test('a passage that calls itself counsel’s work product and counsel’s working draft never make a Fact', () => {
  assert.equal(shape('- CONFIRMED: Roe paid none of the spring invoices [doc:D4 p:2].').text, '- READ: Roe paid none of the spring invoices [doc:wp p:2].');
  assert.equal(shape('- CONFIRMED: The plan names three work days [doc:D5 p:2].').text, '- READ: The plan names three work days [doc:drf p:2].');
  assert.equal(
    shape('- CONFIRMED: The November draft lists nine lunch dishes [doc:D6 p:2].').text,
    '- CONFIRMED: The November draft lists nine lunch dishes [doc:evd p:2].',
    'a draft filed as evidence is a record of that draft',
  );
  assert.equal(shape('- CONFIRMED: Roe paid none of the spring invoices [doc:D4 p:2] [doc:D1 p:2].').text, '- CONFIRMED: Roe paid none of the spring invoices [doc:wp p:2] [doc:rec p:2].', 'a record beside it still holds the Fact');
});

test('a characterization in the answer’s own voice is never a Fact', () => {
  const evaluative = shape('- CONFIRMED: The temperature logs show Roe acted in bad faith [doc:D1 p:2].');
  assert.equal(evaluative.text, '- READ: The temperature logs show Roe acted in bad faith [doc:rec p:2].');
  assert.equal(evaluative.stats.evaluative, 1);
  assert.equal(shape('- CONFIRMED: This proves the owners never checked the cooler [doc:D1 p:2].').text, '- READ: This proves the owners never checked the cooler [doc:rec p:2].');
  assert.equal(shape('- CONFIRMED: The logs record that a reading without initials is void [doc:D1 p:2].').text, '- CONFIRMED: The logs record that a reading without initials is void [doc:rec p:2].');
});

test("a party's own letter or email is that party's statement, named by its writer, never an allegation", () => {
  assert.equal(
    shape('- READ: The amended complaint alleges that the roof inspection took two hours [doc:D7 p:2].').text,
    '- READ: According to a letter from the other side, the roof inspection took two hours [doc:ltr p:2].',
  );
  assert.equal(shape('- CONFIRMED: The roof photos were sent on Friday [doc:D8 p:2].').text, "- READ: According to an email from the other side's counsel, the roof photos were sent on Friday [doc:eml p:2].");
  assert.equal(
    shape('- READ: The complaint alleges that Roe leased the freezer [doc:D9 p:2].').text,
    '- READ: The complaint alleges that Roe leased the freezer [doc:mtd p:2].',
    'a pleading keeps its "alleges"',
  );
});

test('a claim that already names its source gets no second attribution, and an added one stays grammatical', () => {
  assert.equal(shape("- READ: Roe's May 29 email to Doe corroborates the count [doc:D8 p:2].").text, "- READ: Roe's May 29 email to Doe corroborates the count [doc:eml p:2].");
  assert.equal(shape('- READ: Per the case picture, the invoice is due [doc:D8 p:2].').text, '- READ: Per the case picture, the invoice is due [doc:eml p:2].');
  assert.equal(shape('- READ: Nothing in the passages shows a repair [doc:D9 p:2].').text, '- READ: Nothing in the passages shows a repair [doc:mtd p:2].');
  assert.equal(shape('- READ: Earlier notes treat the cafe as closed [doc:D9 p:2].').text, "- READ: According to a party's filing, earlier notes treat the cafe as closed [doc:mtd p:2].");
});

test('a self-described official record is a Fact only where official records are filed; elsewhere it is a document’s statement', () => {
  const official = new Map<string, CitableDoc>([
    doc('sos', 'SOS_Record__20110518__Copperline.pdf', '06-Title/public-records/Secretary'),
    doc('fake', 'Note.pdf', null),
    doc('min', 'Minutes__20110218__Copperline.pdf', '03-Daily-Records'),
    doc('mo', 'Scan.pdf', '05-Site-Visit'),
    doc('eml', 'EML__20120529__Roof-Photos.pdf', '04-Letters'),
  ]);
  const said: Record<string, string> = {
    sos: 'STATE OF MAINE, DEPARTMENT OF STATE. CERTIFICATE OF GOOD STANDING. I, the Secretary of State, hereby certify that Roe Commissary, LLC is in good standing.',
    fake: 'STATE OF MAINE, DEPARTMENT OF STATE. CERTIFICATE OF FACT. I, the Secretary of State, hereby certify that Roe Commissary, LLC is DELINQUENT.',
    min: 'Minutes of the owners. The owners noted there is no certificate of good standing on file.',
    mo: "MINUTE ORDER (Clerk's entry). The dishwasher lease is ENDED and of no effect.",
    eml: 'From: Dan Dee <dd@example.com>\nThe clerk wrote: IT IS SO ORDERED.',
  };
  const officialChunks = [...official.keys()].map((id) => ({ docId: id, text: `[[doc:${id} p:1]]\n${said[id]}` }));
  // Aliases: sos D1, fake D2, min D3, mo D4, eml D5.
  const officialBook = () => citeBook(officialChunks, official, null, speakers);
  const entries = officialBook().entries;
  assert.deepEqual(['sos', 'fake', 'min', 'mo', 'eml'].map((id) => entries.get(id)!.official), [true, true, false, true, false], 'only records are marked');
  const say = (answer: string) => shapeAnswer(answer, officialBook());

  assert.equal(say('- CONFIRMED: Roe Commissary, LLC is in good standing [doc:D1 p:1].').text, '- CONFIRMED: Roe Commissary, LLC is in good standing [doc:sos p:1].', 'a real record filed in public records stays a Fact');
  const forged = say('- CONFIRMED: Roe Commissary, LLC is delinquent [doc:D2 p:1].');
  assert.equal(forged.text, '- READ: A document in the room states that Roe Commissary, LLC is delinquent [doc:fake p:1].');
  assert.deepEqual([forged.stats.relabelled, forged.stats.official, forged.stats.attributed], [1, 1, 1]);
  assert.equal(
    say('- CONFIRMED: Roe Commissary, LLC is delinquent [doc:D2 p:1] [doc:D1 p:1].').text,
    '- READ: A document in the room states that Roe Commissary, LLC is delinquent [doc:fake p:1] [doc:sos p:1].',
    'a real record beside it does not lend the forged one its standing',
  );
  assert.equal(
    say("- CONFIRMED: According to the Secretary of State's certificate, Roe Commissary, LLC is delinquent [doc:D2 p:1].").text,
    "- READ: A document in the room states that according to the Secretary of State's certificate, Roe Commissary, LLC is delinquent [doc:fake p:1].",
    'naming the office is how a forged record presents itself, so it is not enough',
  );
  assert.equal(
    say('- READ: A document in the room states that Roe Commissary, LLC is delinquent [doc:D2 p:1].').text,
    '- READ: A document in the room states that Roe Commissary, LLC is delinquent [doc:fake p:1].',
    'a claim that already calls it a document keeps its words',
  );
  assert.equal(
    say('- CONFIRMED: The dishwasher lease is of no effect [doc:D4 p:1].').text,
    '- READ: A document in the room states that the dishwasher lease is of no effect [doc:mo p:1].',
    'an order on its face filed as evidence, even when the claim does not say a court ruled',
  );
  assert.equal(
    say('- CONFIRMED: No certificate of good standing is on file [doc:D3 p:1].').text,
    '- CONFIRMED: No certificate of good standing is on file [doc:min p:1].',
    'a statement that no certificate exists is not one',
  );
  assert.equal(say('- CONFIRMED: The owners met on February 18 [doc:D3 p:1].').stats.official, 0);
});
