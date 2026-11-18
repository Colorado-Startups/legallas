// SPDX-License-Identifier: Apache-2.0
// One annual-edition section file: the section number's hyphen may be printed as a dash. Invented text only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cfrAnnualSection } from './cfr-annual.ts';

const granule = (sectno: string) =>
  [
    '<?xml version="1.0"?>',
    '<CFRGRANULE>',
    '    <FDSYS>',
    '        <CFRTITLE>99</CFRTITLE>',
    '        <DATE>2099-04-01</DATE>',
    '    </FDSYS>',
    '    <SECTION>',
    `        <SECTNO>${sectno}</SECTNO>`,
    '        <SUBJECT>Widget elections.</SUBJECT>',
    '        <P>(a) An election is due within 2 months after the transfer.</P>',
    '    </SECTION>',
    '</CFRGRANULE>',
  ].join('\n');

test('a section number printed with a dash is the same section', () => {
  for (const dash of ['-', '\u2010', '\u2011', '\u2013', '\u2014', '\u2212']) {
    const { section } = cfrAnnualSection(granule(`§ 9.12${dash}3`), 99, '9.12-3');
    assert.equal(section.number, '9.12-3');
    assert.equal(section.heading, 'Widget elections');
  }
});

test('another section still fails, whatever its dash', () => {
  assert.throws(() => cfrAnnualSection(granule('§ 9.12\u20134'), 99, '9.12-3'), /holds § 9\.12\u20134/);
  assert.throws(() => cfrAnnualSection(granule('§ 9.123'), 99, '9.12-3'), /holds § 9\.123/);
});
