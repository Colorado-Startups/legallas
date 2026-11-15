// SPDX-License-Identifier: Apache-2.0
// What the reader sees: cites mapped back, labels held to the record, the same text however the deltas split.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answerShaper, shapeAnswer, shapeDeltas } from './answer-shape.ts';
import { citeBook } from './cite-book.ts';
import type { CitableDoc } from './passages.ts';

const doc = (id: string, name: string, folder: string, pages: number | null = 9): [string, CitableDoc] => [id, { id, name, pages, folder }];
const docs = new Map<string, CitableDoc>([
  doc('rec', 'Kitchen-Log__20120405__Copperline.pdf', '03-Daily-Records'),
  doc('mtd', 'Motion-for-Site-Entry__20130626__Acme.pdf', '07-Lawsuit'),
  doc('eml', 'Email__20120417__Moe__Flashing-quote.pdf', '04-Letters'),
  doc('ltr', 'Letter__20120503__Dee__Repair-Dates.pdf', '04-Letters'),
  doc('sum', 'chronology.csv', '07-Lawyer-Notes-PRIVILEGED', null),
  doc('drf', 'Complaint__20130228__Moe.docx', '07-Lawsuit/drafts', null),
]);
const chunks = [...docs.keys()].map((id) => ({ docId: id, text: `[[doc:${id} p:2]]\nText.` }));
const brief = { text: '[doc:rec p:5]', citable: new Map([doc('rec', 'Kitchen-Log__20120405__Copperline.pdf', '03-Daily-Records')]) };
const book = () => citeBook(chunks, docs, brief);
// Aliases: rec D1 (the case picture), then mtd D2, eml D3, ltr D4, sum D5, drf D6.
const shape = (answer: string, policy?: { attributedCommunications: boolean }) => shapeAnswer(answer, book(), policy).text;

test('a Fact on a record page that reached the prompt stays a Fact, its cite mapped back', () => {
  assert.equal(shape('- CONFIRMED: The cooler failed on July 9 [doc:D1 p:2].'), '- CONFIRMED: The cooler failed on July 9 [doc:rec p:2].');
});

test('a Fact without a passage behind it is shown as Read', () => {
  assert.equal(shape('- CONFIRMED: The cooler failed [doc:D1 p:5].'), '- READ: The cooler failed [doc:rec p:5].', 'a proof tag alone');
  assert.equal(shape('- CONFIRMED: The cooler failed [doc:D1 p:3].'), '- READ: The cooler failed [doc:rec p:3].', 'a page not in the prompt');
  assert.equal(shape('- CONFIRMED: The cooler failed [doc:D9 p:2].'), '- READ: The cooler failed [doc:D9 p:2].', 'an unknown id');
  assert.equal(shape('- CONFIRMED: Events in order [doc:D5 p:1].'), '- READ: Events in order [doc:sum p:1].', 'a summary');
  assert.equal(shape('**CONFIRMED**: The cooler failed.'), '**READ**: The cooler failed.', 'no cite at all');
});

test("a claim resting only on a party's filing is attributed, never a Fact", () => {
  assert.equal(shape('- CONFIRMED: The cafe was closed in 2012 [doc:D2 p:2].'), "- READ: According to a party's filing, the cafe was closed in 2012 [doc:mtd p:2].");
  assert.equal(shape('- CONFIRMED: The motion argues the deliveries were late [doc:D2 p:2].'), '- READ: The motion argues the deliveries were late [doc:mtd p:2].');
  assert.equal(shape('- READ: Tally Payroll sent no crew that week [doc:D2 p:2].'), "- READ: According to a party's filing, Tally Payroll sent no crew that week [doc:mtd p:2].");
  assert.equal(shape('- READ: Moe is liable [doc:D6 p:1].'), '- READ: According to a draft complaint, Moe is liable [doc:drf p:1].');
  assert.equal(shape('- CONFIRMED: The cooler failed [doc:D1 p:2] [doc:D2 p:2].'), '- CONFIRMED: The cooler failed [doc:rec p:2] [doc:mtd p:2].', 'record support keeps the Fact');
});

test('emails and letters: what they say may be a Fact in those words; their content as truth is attributed', () => {
  assert.equal(shape('- CONFIRMED: Moe wrote that the crew left early [doc:D3 p:2].'), '- CONFIRMED: Moe wrote that the crew left early [doc:eml p:2].');
  assert.equal(shape('- CONFIRMED: The crew left early [doc:D3 p:2].'), '- READ: According to an email, the crew left early [doc:eml p:2].');
  assert.equal(shape('- CONFIRMED: Low demanded the delivery logs [doc:D4 p:2].'), '- CONFIRMED: Low demanded the delivery logs [doc:ltr p:2].');
  assert.equal(shape('- READ: Interest is owed [doc:D4 p:2] [doc:D3 p:2].'), '- READ: According to the cited documents, Interest is owed [doc:ltr p:2] [doc:eml p:2].', 'only a common opener is lower-cased');
  assert.equal(
    shape('- CONFIRMED: Moe wrote that the crew left early [doc:D3 p:2].', { attributedCommunications: false }),
    '- READ: Moe wrote that the crew left early [doc:eml p:2].',
  );
});

test('inferences, law and plain text are only mapped', () => {
  const text = "I don't know. Try [doc:D3 p:2].\n- INFERENCE: So it follows [doc:D2 p:2].\n- LAW: A rule [law:crs-7-80-714].\nREADING ahead [doc:D1 p:2]";
  assert.equal(shape(text), "I don't know. Try [doc:eml p:2].\n- INFERENCE: So it follows [doc:mtd p:2].\n- LAW: A rule [law:crs-7-80-714].\nREADING ahead [doc:rec p:2]");
});

test('the shaped text is the same however the deltas split, and plain text streams before its line ends', () => {
  const answer = 'Intro line [doc:D1 p:2] here.\n- CONFIRMED: The cafe closed [doc:D2 p:2].\n- READ: Cooler failed [doc:D1 p:2]\n1. CONFIRMED: Done [doc:D3 p:2].';
  const whole = shape(answer);
  for (const size of [1, 2, 3, 5, 7, 11]) {
    const shaper = answerShaper(book());
    let out = '';
    for (let i = 0; i < answer.length; i += size) out += shaper.push(answer.slice(i, i + size));
    assert.equal(out + shaper.end(), whole, `pieces of ${size}`);
  }
  const shaper = answerShaper(book());
  assert.equal(shaper.push('Intro.\n'), 'Intro.\n');
  assert.equal(shaper.push('Next line [doc:D'), 'Next line', 'an unfinished bracket waits (with the space before it); the text before it streams');
  assert.equal(shaper.push('1 p:2] here'), ' [doc:rec p:2] here');
  assert.equal(shaper.push('.\n- CONFIRMED: The cafe'), '.\n', 'a labelled claim waits for its line to end');
  assert.equal(shaper.push(' closed [doc:D2 p:2].\n'), "- READ: According to a party's filing, the cafe closed [doc:mtd p:2].\n");
  assert.deepEqual([shaper.stats.unresolved, shaper.stats.relabelled, shaper.stats.attributed], [0, 1, 1]);
});

test('shapeDeltas passes the stop reason through and flushes what was held', async () => {
  async function* model(): AsyncGenerator<string, string> {
    yield '- CONFIRMED: The cooler ';
    yield 'failed [doc:D1 p:2]';
    return 'length';
  }
  const shaper = answerShaper(book());
  const out: string[] = [];
  const deltas = shapeDeltas(model(), shaper);
  let next = await deltas.next();
  for (; !next.done; next = await deltas.next()) out.push(next.value);
  assert.deepEqual(out, ['- CONFIRMED: The cooler failed [doc:rec p:2]']);
  assert.equal(next.value, 'length');
});

// A cite id outside a cite ("the draft counterclaim itself (doc:D1) is not among the retrieved passages"): the
// reader never sees a per-request alias in prose.
test('a cite id in prose is rendered: with a page as the cite, without one removed, an unknown one removed', () => {
  assert.equal(shape('The full email (doc:D3 p:2) was not retrieved.'), 'The full email ([doc:eml p:2]) was not retrieved.');
  assert.equal(shape('See doc:D1 p:2 for the reading.'), 'See [doc:rec p:2] for the reading.');
  assert.equal(shape('The letter (doc:D4, pages 2-3 per the case picture) is short.'), 'The letter ([doc:ltr p:2] per the case picture) is short.');
  assert.equal(shape('The draft counterclaim itself (doc:D6) is not among the retrieved passages.'), 'The draft counterclaim itself is not among the retrieved passages.');
  assert.equal(shape('It was flagged on 2012-04-20 [doc:D5].'), 'It was flagged on 2012-04-20.');
  assert.equal(shape('The motion, doc:D2, argues delay.'), 'The motion, Motion-for-Site-Entry__20130626__Acme.pdf, argues delay.', 'standing in the sentence, its name');
  assert.equal(shape('The missing exhibit (doc:D9) and doc:D9 p:2 are gone.'), 'The missing exhibit and are gone.', 'an unknown id');
  assert.equal(shape('Cases held [proof tag at doc:D1 p:2].'), 'Cases held [proof tag at [doc:rec p:2]].', 'inside a bracket that is no cite');
});

test('a cite id in prose leaves labels, bracketed cites and ordinary "doc:" text alone', () => {
  assert.equal(shape('- CONFIRMED: The cooler failed (doc:D1 p:2).'), '- READ: The cooler failed ([doc:rec p:2]).', 'the label is decided before');
  assert.equal(shape('- READ: Moe sent no crew (doc:D9) [doc:D2 p:2].'), "- READ: According to a party's filing, Moe sent no crew [doc:mtd p:2].");
  for (const text of [
    'Cited [doc:D9 p:2] and [doc:rec p:2] and [law:crs-7-80-714].',
    'See https://example.com/doc:D1 and my-doc:D1 and notes.doc:D1 p:2.',
    'A doc:Draft, doc:D1x, doc:D12-b and doc: notes.',
  ]) {
    assert.equal(shape(text), text);
  }
});

test('a cite id in prose is the same however the deltas split', () => {
  const answer =
    'The email (doc:D3 p:2) and the draft (doc:D6) are named; see https://example.com/doc:D1 too.\n' +
    '- CONFIRMED: Cases held [proof tag at doc:D1 p:2] (doc:D9).\nThe motion, doc:D2, argues; doc:D4 pp. 2-3 says more';
  const whole = shape(answer);
  assert.doesNotMatch(whole.replace('example.com/doc:D1', ''), /doc:D[0-9]/);
  for (const size of [1, 2, 3, 4, 5, 7, 11, 13]) {
    const shaper = answerShaper(book());
    let out = '';
    for (let i = 0; i < answer.length; i += size) out += shaper.push(answer.slice(i, i + size));
    assert.equal(out + shaper.end(), whole, `pieces of ${size}`);
  }
  const shaper = answerShaper(book());
  assert.equal(shaper.push('The draft ('), 'The draft', 'what may open a mention waits');
  assert.equal(shaper.push('doc:D'), '');
  assert.equal(shaper.push('6) is'), ' is');
  assert.equal(shaper.push(' gone; doc:D3 p:2'), ' gone;', 'a page may yet go on');
  assert.equal(shaper.push(' says so.'), ' [doc:eml p:2] says so.');
});
