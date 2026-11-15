// SPDX-License-Identifier: Apache-2.0
// Defined-term matching (terms-model.ts): longest match, word boundaries, case, first occurrence, cites and links.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findTerms, indexTerms, isAbbreviation, protectedRanges, sameTerm, type TermDef } from './terms-model.ts';

const TERMS: TermDef[] = [
  { term: 'Roe', means: 'Richard Roe' },
  { term: 'Harbor Labs', means: 'Harbor Labs, Inc., a restaurant group' },
  { term: 'Harbor', means: 'the port the company is named for' },
  { term: 'Company', means: 'Harbor Labs, Inc.' },
  { term: 'CRG', means: 'Copperline Restaurant Group, Inc.' },
  { term: 'HOA', means: 'the homeowners association' },
  { term: 'W-9', means: 'the tax form' },
  { term: 'Supply Agreement', means: 'the Company supply agreement of 2011' },
  { term: 'DOE', means: 'a term that shares the control prefix' },
];

const marked = (text: string, seen = new Set<string>()) => findTerms(text, indexTerms(TERMS), seen).map((m) => m.text);

test('the longest term wins at a place, and a repeat of it still hides the short term inside', () => {
  assert.deepEqual(marked('Harbor Labs paid Roe.'), ['Harbor Labs', 'Roe']);
  const seen = new Set<string>();
  assert.deepEqual(marked('Harbor Labs opened the cafe.', seen), ['Harbor Labs']);
  assert.deepEqual(marked('Later Harbor Labs sold it.', seen), [], 'the repeat consumes "Harbor" too');
  assert.deepEqual(marked('Then Harbor signed.', seen), ['Harbor']);
});

test('only whole words match', () => {
  assert.deepEqual(marked('HOAX and WHOA are not HOA.'), ['HOA']);
  assert.deepEqual(marked('Roebuck, Monroe and Roe2 are other words.'), []);
  assert.deepEqual(marked("Roe's letter"), ['Roe'], 'a possessive keeps the term');
  assert.deepEqual(marked('(CRG)'), ['CRG']);
  assert.deepEqual(marked('the W-9 form'), ['W-9'], 'inner punctuation is part of the term');
  assert.deepEqual(marked('CRG-1 filed'), ['CRG'], 'a hyphen ends a word');
});

test('abbreviations match exactly; other terms keep their first letter and ignore case after it', () => {
  assert.equal(isAbbreviation('CRG'), true);
  assert.equal(isAbbreviation('W-9'), true);
  assert.equal(isAbbreviation('Roe'), false);
  assert.equal(isAbbreviation('1-2'), false, 'no letters is not an abbreviation');
  assert.deepEqual(marked('Crg and crg are not the abbreviation.'), []);
  assert.deepEqual(marked('the company signed'), [], 'lower-case "company" is the plain word');
  assert.deepEqual(marked('the Supply agreement'), ['Supply agreement']);
  assert.equal(sameTerm('COMPANY', 'Company'), true);
  assert.equal(sameTerm('company', 'Company'), false);
  assert.equal(sameTerm('Compan', 'Company'), false);
});

test('each term is marked once per scope', () => {
  assert.deepEqual(marked('CRG paid CRG, and CRG again.'), ['CRG']);
  const seen = new Set(['CRG']);
  assert.deepEqual(marked('CRG paid Roe.', seen), ['Roe'], 'a term marked earlier on the page stays plain');
  assert.deepEqual([...seen].sort(), ['CRG', 'Roe']);
});

test('cites and written-out links are never marked', () => {
  assert.deepEqual(marked('See DOE-000412 at 3 and DOE-000413.'), []);
  assert.deepEqual(marked('See DOE-000412 at 3-4. DOE is defined here.'), ['DOE']);
  assert.deepEqual(marked('Harbor Labs DOE-000412 at 3'), ['Harbor Labs'], 'a term right before a cite still counts');
  assert.deepEqual(marked('At https://example.test/CRG/Roe the file.'), []);
  assert.deepEqual(protectedRanges('a DOE-000412 at 12 b'), [[2, 18]]);
});

test('matches report where they are and what they mean', () => {
  const [hit] = findTerms('Under the Supply Agreement, CRG', indexTerms(TERMS), new Set());
  assert.deepEqual(hit, {
    start: 10,
    end: 26,
    text: 'Supply Agreement',
    term: { term: 'Supply Agreement', means: 'the Company supply agreement of 2011' },
  });
});

test('blank and repeated definitions are ignored; the first definition wins', () => {
  const index = indexTerms([
    { term: '  ', means: 'nothing' },
    { term: 'Menu', means: '' },
    { term: 'Roe', means: 'first' },
    { term: 'Roe', means: 'second' },
  ]);
  assert.deepEqual(findTerms('Menu and Roe', index, new Set()).map((m) => m.term.means), ['first']);
  assert.deepEqual(findTerms('', index, new Set()), []);
});
