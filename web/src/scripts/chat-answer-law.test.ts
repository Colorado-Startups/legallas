// SPDX-License-Identifier: Apache-2.0
// The law library on screen (T21): LAW claims form the Law group, sources split into Record and Law, law links
// only to official sources, and neither side can stand behind the other's claims. Fictional fixture data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answerSources, answerText, answerView, COMPANY_LAW_NOT_FACT, COMPANY_RECORD_NOT_LAW, LAW_NOT_FACT, LAW_NOTICE, RECORD_NOT_LAW, SEPARATE_LABELS, SEPARATE_NOTE, type AnswerPart } from './chat-answer.ts';
import { DROPPED_NOTE, hrefsOf, lawIndex, PENDING_NOTE, renderAnswer } from './sanitize.ts';
import { RECOMMENDATION_NOTE } from '../../worker/product-notices.ts';

/** `text` as a regular expression that matches it literally. */
const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const CITES = [{ id: 'doc-a', page: 1, name: 'Fixture memo.pdf', control_seq: 12, quote: null }];
const LAW = [
  { id: 'crs-7-80-714', cite: 'C.R.S. § 7-80-714(1)', title: 'Derivative proceeding - demand', url: 'https://content.leg.colorado.gov/sites/default/files/images/olls/crs2024-title-07.pdf', track: 'civil', kind: 'statute' },
  { id: 'ccr-704-1-r51-4-1', cite: '3 CCR 704-1, Rule 51-4.1', title: 'Fixture rule', url: 'https://www.sos.state.co.us/CCR/x', track: 'regulator', kind: 'regulation' },
];
const OPTS = { dontKnow: false, prefix: 'DOE', law: LAW };

const ANSWER = [
  '- CONFIRMED: The fixture memo mentions a demand [doc:doc-a p:1].',
  '- READ: A fact cited to law is not a fact [law:crs-7-80-714].',
  '- INFERENCE: The memo and the statute read together [doc:doc-a p:1] [law:crs-7-80-714].',
  '',
  'Law (from the law library)',
  '- LAW: A member makes a written demand first [law:crs-7-80-714].',
  '- LAW: A pleading is not law [doc:doc-a p:1].',
  '- LAW: A regulator rule [law:ccr-704-1-r51-4-1].',
  '- LAW: Never retrieved [law:crs-7-80-999].',
  '',
  'General background (not from the case files)',
  'Courts read statutes as a whole.',
  'General information, read by AI. Have your own lawyer review before relying on it.',
].join('\n');

const kinds = (parts: readonly AnswerPart[]) => parts.map((p) => (p.kind === 'claim' ? p.claim : p.kind));
const notes = (part: AnswerPart) => (part.kind === 'claim' ? part.inline.filter((t) => t.kind === 'note').map((t) => (t as { text: string }).text) : []);

test('LAW claims and the law section form the Law group, between the record and the background', () => {
  const view = answerView(ANSWER, CITES, OPTS);
  assert.deepEqual(kinds(view.body), ['fact', 'read', 'inference']);
  assert.deepEqual(kinds(view.law), ['law', 'law', 'law', 'law']);
  assert.equal(view.background.length, 1);
});

test('a law cite never stands behind a Fact or Read claim, and a record cite never behind a LAW claim', () => {
  const view = answerView(ANSWER, CITES, OPTS);
  assert.deepEqual(notes(view.body[1]!), [LAW_NOT_FACT]);
  const inference = view.body[2]!;
  assert.ok(inference.kind === 'claim' && inference.inline.some((t) => t.kind === 'law') && inference.inline.some((t) => t.kind === 'cite'), 'an inference may cite both');
  assert.deepEqual(notes(view.law[1]!), [RECORD_NOT_LAW]);
  assert.deepEqual(notes(view.law[3]!), [DROPPED_NOTE]);
});

test('a company room (card 11.3): the same two notes name no case', (t) => {
  (globalThis as { document?: unknown }).document = { documentElement: { dataset: { roomShape: 'company' } } };
  t.after(() => delete (globalThis as { document?: unknown }).document);
  const view = answerView(ANSWER, CITES, OPTS);
  assert.deepEqual(notes(view.body[1]!), [COMPANY_LAW_NOT_FACT]);
  assert.deepEqual(notes(view.law[1]!), [COMPANY_RECORD_NOT_LAW]);
  assert.doesNotMatch(`${COMPANY_LAW_NOT_FACT} ${COMPANY_RECORD_NOT_LAW}`, /\b(case|counsel|matter)\b/i);
});

test('sources come in two groups: the record pages, then the law with its official links', () => {
  const { record, law } = answerSources(answerView(ANSWER, CITES, OPTS));
  assert.deepEqual(record.map((r) => r.label), ['DOE-000012 at 1']);
  assert.deepEqual(law.map((l) => [l.label, l.href, l.track]), [
    ['C.R.S. § 7-80-714(1)', LAW[0]!.url, 'civil'],
    ['3 CCR 704-1, Rule 51-4.1', LAW[1]!.url, 'regulator'],
  ]);
});

test('with the library on, law cites are pending while streaming and dropped when not validated', () => {
  const streaming = renderAnswer('- LAW: x [law:crs-7-80-714].', null, undefined, []);
  assert.ok(JSON.stringify(streaming).includes(PENDING_NOTE));
  const unvalidated = answerView('- LAW: x [law:crs-7-80-404].', CITES, OPTS);
  assert.deepEqual(notes(unvalidated.law[0]!), [DROPPED_NOTE]);
});

test('with the library off, nothing law-shaped changes the answer: no Law group, no notice, plain text tags', () => {
  const answer = ['- CONFIRMED: x [doc:doc-a p:1].', '', 'Law (from the law library)', 'The agreement governs [doc:doc-a p:1].', '', 'Law:', '- LAW: A rule [law:crs-7-80-714].'].join('\n');
  const off = answerView(answer, CITES, { dontKnow: false, prefix: 'DOE' });
  assert.deepEqual(off.law, []);
  assert.ok(off.body.every((part) => part.kind !== 'claim' || part.claim !== 'law'));
  const text = JSON.stringify(off);
  assert.match(text, /\[law:crs-7-80-714\]/, 'the tag stays plain text, as before the library existed');
  assert.doesNotMatch(text, new RegExp(escapeRegex(DROPPED_NOTE)));
  assert.deepEqual(answerSources(off).law, []);
});

test('an unlabelled paragraph in the record may not carry a law cite, nor one in the Law group a record cite', () => {
  const answer = ['The memo and the rule agree [law:crs-7-80-714].', '', 'Law (from the law library)', '- LAW: A rule [law:crs-7-80-714].', 'A plain line citing a record page [doc:doc-a p:1].'].join('\n');
  const view = answerView(answer, CITES, OPTS);
  const tokens = (part: AnswerPart) => (part.kind === 'p' ? part.inline : part.kind === 'claim' ? part.inline : []);
  assert.ok(tokens(view.body[0]!).some((t) => t.kind === 'note' && t.text === LAW_NOT_FACT));
  assert.ok(view.law.flatMap(tokens).some((t) => t.kind === 'note' && t.text === RECORD_NOT_LAW));
  assert.ok(!view.law.flatMap(tokens).some((t) => t.kind === 'cite'));
});

test('two sections sharing one official PDF stay two sources', () => {
  const law = [LAW[0]!, { ...LAW[0]!, id: 'crs-7-80-404', cite: 'C.R.S. § 7-80-404' }];
  const view = answerView('- LAW: one [law:crs-7-80-714].\n- LAW: two [law:crs-7-80-404].', CITES, { ...OPTS, law });
  assert.deepEqual(answerSources(view).law.map((l) => l.label), ['C.R.S. § 7-80-714(1)', 'C.R.S. § 7-80-404']);
});

test('only official https links survive, whatever the server list says', () => {
  const index = lawIndex([
    ...LAW,
    { id: 'crs-7-80-404', cite: 'x', title: 'x', url: 'https://evil.example/x', track: 'civil' },
    { id: 'crs-7-80-405', cite: 'x', title: 'x', url: 'javascript:alert(1)', track: 'civil' },
    { id: '../x', cite: 'x', title: 'x', url: LAW[0]!.url, track: 'civil' },
    { id: 'crs-7-80-406', cite: 'x', title: 'x', url: LAW[0]!.url, track: 'record' },
  ]);
  assert.deepEqual([...index.keys()], ['crs-7-80-714', 'ccr-704-1-r51-4-1']);
  const blocks = renderAnswer('See [law:crs-7-80-714] and [law:crs-7-80-404] and https://evil.example.', CITES, undefined, LAW);
  assert.deepEqual(hrefsOf(blocks), [LAW[0]!.url]);
});

test('copy with cites keeps the Law group and its notice', () => {
  const text = answerText(answerView(ANSWER, CITES, OPTS));
  assert.match(text, new RegExp(`Law\\. ${escapeRegex(LAW_NOTICE)}`));
  assert.match(text, /Law: A member makes a written demand first \(C\.R\.S\. § 7-80-714\(1\)\)/);
});

test('the law notice names the year case law runs through', () => {
  assert.match(LAW_NOTICE, /have your own lawyer review how it applies\. Case law here runs through 2019; check newer authority\.$/);
  assert.doesNotMatch(LAW_NOTICE, /legal advice/i, 'product notices A1');
});

test('a LAW claim resting only on a dissent or concurrence is shown as that writing, never as the holding', () => {
  const url = 'https://www.courtlistener.com/opinion/1/fiction-v-fable/';
  const opinion = (id: string, writing: string, cite: string) => ({ id, cite, title: 'Fiction v. Fable (Colo. 1990)', url, track: 'civil', kind: 'case', opinion: writing });
  const law = [
    opinion('case-9-p2d-1~2', 'majority', '9 P.2d 1, 3'),
    opinion('case-9-p2d-1~8', 'dissent', '9 P.2d 1, 6 (Fable, J., dissenting)'),
    opinion('case-9-p2d-1~9', 'concurrence', '9 P.2d 1, 7 (Other, J., concurring)'),
  ];
  const answer = [
    'Law (from the law library)',
    '- LAW: The court held the fictional rule [law:case-9-p2d-1~2].',
    '- LAW: A two-year period applies [law:case-9-p2d-1~8].',
    '- LAW: The dissent argued for a two-year period [law:case-9-p2d-1~8].',
    '- LAW: The rule, which the dissent disputes [law:case-9-p2d-1~2] [law:case-9-p2d-1~8].',
    '- LAW: Two writings agree [law:case-9-p2d-1~8] [law:case-9-p2d-1~9].',
  ].join('\n');
  const view = answerView(answer, CITES, { ...OPTS, law });
  const separate = view.law.map((p) => (p.kind === 'claim' ? (p.separate ?? null) : 'not a claim'));
  assert.deepEqual(separate, [null, 'dissent', 'dissent', null, 'separate'], 'a claim that also rests on the court\'s opinion stays Law');
  assert.deepEqual(notes(view.law[1]!), [SEPARATE_NOTE], 'unlabelled in its own words, it is labelled for it');
  assert.deepEqual(notes(view.law[2]!), [], 'a claim that says "the dissent argued" needs no note');
  const text = answerText(view);
  assert.match(text, /\nDissent: \[a separate opinion, not the court's holding\] A two-year period applies \(9 P\.2d 1, 6 \(Fable, J\., dissenting\)\)/);
  assert.match(text, /\nLaw: The court held the fictional rule \(9 P\.2d 1, 3\)/);
  assert.equal(SEPARATE_LABELS.separate, 'Separate opinion');
  assert.deepEqual(lawIndex([{ ...law[1]!, opinion: 'plurality' }]).get('case-9-p2d-1~8')?.opinion, undefined, 'an unknown writing is never trusted as one');
});

test('an answer without law looks as it always has', () => {
  const view = answerView('- CONFIRMED: x [doc:doc-a p:1].', CITES, { dontKnow: false, prefix: 'DOE' });
  assert.deepEqual(view.law, []);
  assert.deepEqual(answerSources(view).law, []);
});

test('the options and recommendation form their own group after the Law group, keeping record and law cites (issue #19)', () => {
  const answer = [
    '- CONFIRMED: The fixture memo mentions a demand [doc:doc-a p:1].',
    '',
    'Law (from the law library)',
    '- LAW: A member makes a written demand first [law:crs-7-80-714].',
    '',
    'Options and recommendation',
    '- OPTION: Make the demand first [doc:doc-a p:1] [law:crs-7-80-714].',
    '- RECOMMENDATION: Make the demand first, because the memo and the statute agree [doc:doc-a p:1] [law:crs-7-80-714].',
    '- NOT VERIFIED: Whether a demand was already sent.',
    'Have your own lawyer review this before you act on it.',
  ].join('\n');
  const view = answerView(answer, CITES, OPTS);
  assert.deepEqual(kinds(view.law), ['law'], 'the options stay out of the Law group');
  assert.deepEqual(kinds(view.options), ['ul', 'p']);
  const items = view.options[0]!.kind === 'ul' ? view.options[0]!.items : [];
  for (const item of items.slice(0, 2)) {
    assert.ok(item.some((t) => t.kind === 'cite') && item.some((t) => t.kind === 'law'), 'an option keeps both its sources');
    assert.equal(item.some((t) => t.kind === 'note'), false, 'no source is swapped for a note');
  }
  assert.match(answerText(view), /Options and recommendation\. Draft for your review\./);
  assert.ok(answerText(view).includes(RECOMMENDATION_NOTE), 'the A4 note goes with the options');
});

test('the options keep their sources whatever comes between them, and open without their heading', () => {
  const lawLines = ['- CONFIRMED: The fixture memo mentions a demand [doc:doc-a p:1].', '', 'Law (from the law library)', '- LAW: A member makes a written demand first [law:crs-7-80-714].', ''];
  const option = '- OPTION: Make the demand first [doc:doc-a p:1] [law:crs-7-80-714].';
  const recommendation = '- RECOMMENDATION: Make the demand first [doc:doc-a p:1] [law:crs-7-80-714].';
  const swapped = (parts: readonly AnswerPart[]) =>
    parts.flatMap((p) => (p.kind === 'ul' ? p.items.flat() : p.kind === 'claim' || p.kind === 'p' ? p.inline : [])).filter((t) => t.kind === 'note');
  for (const [name, lines] of [
    ['a labelled line between them', [...lawLines, 'Options and recommendation', option, '- INFERENCE: The memo and the statute agree [doc:doc-a p:1] [law:crs-7-80-714].', recommendation]],
    ['a plural heading', [...lawLines, 'Options and recommendations', option, recommendation]],
    ['no heading at all', [...lawLines, option, recommendation]],
  ] as const) {
    const view = answerView(lines.join('\n'), CITES, OPTS);
    assert.deepEqual(kinds(view.law), ['law'], `${name}: the options stay out of the Law group`);
    assert.equal(view.body.length, 1, `${name}: and out of the body`);
    assert.deepEqual(swapped(view.options), [], `${name}: no source is swapped for a note`);
  }
});
