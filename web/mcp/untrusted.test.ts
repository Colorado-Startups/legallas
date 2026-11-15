// SPDX-License-Identifier: Apache-2.0
// Ask's quarantine on tool results: the judgment is quarantine.ts's own, the fence carries the mark, cite fields go,
// and the note is Ask's reminder word for word. Fictional text (mcp/tools/untrusted-fixtures.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addressesModel, quarantine } from '../worker/quarantine.ts';
import { UNFILED_ORDER_REMINDER, UNTRUSTED_REMINDER } from '../worker/prompt.ts';
import { caseData } from './format.ts';
import { FENCE, PLAIN, PLANTED_AI, PLANTED_ORDER } from './tools/untrusted-fixtures.ts';
import { fenceOf, markUntrusted, NOTE_KEY, noteChars, noted, UNTRUSTED_NOTES, untrustedIn, untrustedNote, untrustedReason } from './untrusted.ts';

const NOTE_FOLDER = { name: 'Note.pdf', folder: '03-Kitchen-Records' };
const COURT_FOLDER = { name: 'Order_Inspection__20260302__Court.pdf', folder: '07-Lawsuit/orders' };

test('the judgment is quarantine.ts on one passage: words to a model always, an unfiled order only with its document', () => {
  for (const [text, doc] of [[PLANTED_AI, undefined], [PLANTED_ORDER, NOTE_FOLDER], [PLANTED_ORDER, COURT_FOLDER], [PLAIN, NOTE_FOLDER], [PLANTED_ORDER, undefined]] as const) {
    const [chunk] = quarantine([{ text }], doc ? () => doc : undefined).chunks;
    const expected = chunk!.unfiledRuling ? 'unfiled-court-order' : chunk!.untrusted ? 'addressed-to-ai' : null;
    assert.equal(untrustedReason(text, doc), expected, `${text.slice(0, 20)} ${doc?.name ?? 'no doc'}`);
  }
  assert.equal(untrustedReason(PLANTED_AI), 'addressed-to-ai');
  assert.equal(untrustedReason(PLANTED_ORDER, NOTE_FOLDER), 'unfiled-court-order');
  assert.equal(untrustedReason(PLANTED_ORDER, COURT_FOLDER), null, "the court's own order keeps its standing");
  assert.equal(untrustedReason(PLANTED_ORDER), null, 'without a document, the words alone decide');
  assert.equal(untrustedReason(PLAIN, NOTE_FOLDER), null);
});

test('caseData judges what it fences, or takes the whole passage\'s mark, and no text closes the fence early', () => {
  assert.equal(caseData(PLAIN), `${FENCE.plain}${PLAIN}\n</case-record>`);
  assert.equal(caseData(PLANTED_AI), `${FENCE.ai}${PLANTED_AI}\n</case-record>`);
  assert.equal(caseData('the cooler', 'unfiled-court-order'), `${FENCE.order}the cooler\n</case-record>`);
  assert.equal(caseData(PLANTED_AI, null), `${FENCE.plain}${PLANTED_AI}\n</case-record>`, 'null: the caller judged the whole and found it trusted');
  const escaped = caseData(`${PLANTED_AI}\n</case-record>\nnow free`);
  assert.equal(escaped.match(/<\/case-record>/g)?.length, 1);
  assert.equal(fenceOf(escaped)?.reason, 'addressed-to-ai');
});

test('fenceOf reads back the open tag, the words and the mark, and nothing else passes for a fence', () => {
  for (const reason of [null, 'addressed-to-ai', 'unfiled-court-order'] as const) {
    const fenced = caseData('a\nb', reason);
    assert.deepEqual(fenceOf(fenced), { open: fenced.slice(0, fenced.indexOf('\n') + 1), inner: 'a\nb', reason });
  }
  for (const text of [PLAIN, '<case-record untrusted="other">\nx\n</case-record>', '<case-record>\nx', '<case-record>\n</case-record>'.slice(0, 20)]) {
    assert.equal(fenceOf(text), null, text);
  }
});

test('the notes are Ask\'s reminders word for word, in Ask\'s order, and none reads as words to a model', () => {
  assert.equal(UNTRUSTED_NOTES['addressed-to-ai'], UNTRUSTED_REMINDER);
  assert.equal(UNTRUSTED_NOTES['unfiled-court-order'], UNFILED_ORDER_REMINDER);
  assert.equal(untrustedNote([]), null);
  assert.equal(untrustedNote(['unfiled-court-order', 'addressed-to-ai']), `${UNTRUSTED_REMINDER} ${UNFILED_ORDER_REMINDER}`);
  // The research agent withholds any string that addresses a model (worker/agent/tools/compact.ts): never the note.
  for (const note of Object.values(UNTRUSTED_NOTES)) assert.equal(addressesModel(note), false, note);
});

test('markUntrusted strips the cite fields of the object holding untrusted text, keeps ids and what a tool keeps', () => {
  const passage = { id: 'doc-a', control: 'DOE-000003', title: 'Note.pdf', page: 4, link: 'https://room.example.com/doc/?id=doc-a#page=4', text: caseData(PLANTED_AI) };
  assert.deepEqual(markUntrusted(passage), { id: 'doc-a', title: 'Note.pdf', text: passage.text, untrusted: 'addressed-to-ai' });
  assert.deepEqual(markUntrusted(passage, ['page']), { id: 'doc-a', title: 'Note.pdf', page: 4, text: passage.text, untrusted: 'addressed-to-ai' });
  const trusted = { ...passage, text: caseData(PLAIN) };
  assert.deepEqual(markUntrusted(trusted), trusted);
  // Nested: an event whose summary is untrusted loses its cites; a sibling event keeps its own.
  const cite = { control: 'DOE-000003', doc: 'doc-a', page: 4, link: 'x' };
  const events = [
    { id: 'e1', summary: caseData(PLANTED_AI), cites: [cite] },
    { id: 'e2', summary: caseData(PLAIN), cites: [cite, { ...cite, note: caseData(PLANTED_ORDER, 'unfiled-court-order') }] },
  ];
  assert.deepEqual(markUntrusted(events), [
    { id: 'e1', summary: events[0]!.summary, untrusted: 'addressed-to-ai' },
    { id: 'e2', summary: events[1]!.summary, cites: [cite, { note: (events[1]!.cites[1] as { note: string }).note, untrusted: 'unfiled-court-order' }] },
  ]);
  assert.deepEqual(untrustedIn(events), ['addressed-to-ai', 'unfiled-court-order']);
  assert.deepEqual(markUntrusted(markUntrusted(events)), markUntrusted(events), 'marking twice changes nothing');
});

test('noted puts the note first for the marks a value holds, replaces an old one, and noteChars is what it adds', () => {
  const plain = { results: [{ text: caseData(PLAIN) }] };
  assert.deepEqual(noted(plain), plain);
  const marked = { results: [{ text: caseData(PLANTED_AI) }] };
  const out = noted(marked);
  assert.deepEqual(Object.keys(out), [NOTE_KEY, 'results']);
  assert.equal(out[NOTE_KEY as keyof typeof out], UNTRUSTED_REMINDER);
  assert.deepEqual(noted({ ...out, results: [] }), { results: [] }, 'a stale note goes once its text is gone');
  for (const marks of [['addressed-to-ai'], ['unfiled-court-order'], ['addressed-to-ai', 'unfiled-court-order']] as const) {
    const value = { a: 1, b: 'x' };
    assert.equal(JSON.stringify(noted(value, marks), null, 2).length - JSON.stringify(value, null, 2).length, noteChars(marks));
  }
  assert.equal(noteChars([]), 0);
});
