// SPDX-License-Identifier: Apache-2.0
// The SSN detector's three rules. Every number here is synthetic and is joined at run time, so no Social
// Security shaped literal sits in the source. VOIDED and VOIDED_TOO are the SSA's famously voided samples, and areas
// 000, 666 and 900 to 999 are never issued as SSNs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findPii, findPiiSync, hasSsnForm, LABEL_WINDOW, labelledHits, maskDigits, maskPath, nineDigitRuns, pathHits, ssnFormHits, type KnownMatcher } from './pii.ts';

const n = (sep: string, ...groups: string[]) => groups.join(sep);
const VOIDED = ['078', '05', '1120'] as const;
const VOIDED_TOO = ['219', '09', '9999'] as const;
const rules = (text: string) => findPiiSync(text).map((hit) => hit.rule);

test('ssn-form: the dashed, spaced and dotted forms are caught, masked to the last four digits', () => {
  for (const sep of ['-', ' ', '.', '\u2013', ' - ', '\u00a0', '  ']) {
    const text = `Taxpayer record ${n(sep, ...VOIDED)} on file.`;
    const hits = ssnFormHits(text);
    assert.equal(hits.length, 1, JSON.stringify(sep));
    assert.equal(hits[0].masked, '***-**-1120');
    assert.equal(text.slice(hits[0].start, hits[0].end), n(sep, ...VOIDED));
  }
  assert.equal(ssnFormHits(`${n('-', ...VOIDED)} and ${n('-', ...VOIDED_TOO)}`).length, 2);
  assert.equal(maskDigits(VOIDED.join('')), '***-**-1120');
  assert.equal(hasSsnForm(`(${n('-', ...VOIDED)})`), true, 'brackets are not digits');
});

test('ssn-form: numbers the SSA never issues are left alone', () => {
  for (const groups of [['000', '12', '3456'], ['666', '12', '3456'], ['900', '12', '3456'], ['999', '99', '9999'], ['078', '00', '1120'], ['078', '05', '0000']]) {
    for (const sep of ['-', ' ', '.']) assert.equal(hasSsnForm(`no. ${n(sep, ...groups)}`), false, n(sep, ...groups));
  }
});

test('ssn-form: the form inside a longer number is not an SSN', () => {
  const longer = [
    `1-${n('-', ...VOIDED)}`, `${n('-', ...VOIDED)}-7`, `1${n('-', ...VOIDED)}`, `${n('-', ...VOIDED)}1`,
    `12 ${n(' ', ...VOIDED)}`, `${n(' ', ...VOIDED)} 2012`, `1.${n('.', ...VOIDED)}`, `${n('.', ...VOIDED)}.5`,
    `${n('-', '078', '05')} 1120`, `${n('-', '0078', '05', '1120')}`, `${n('-', '078', '05', '11200')}`,
  ];
  for (const text of longer) assert.equal(hasSsnForm(text), false, text);
  assert.equal(hasSsnForm(`rows: 12 ${n('-', ...VOIDED)} 2012`), true, 'another separator class does not join it');
});

test('ssn-form: a percent escape in a URL is not the start of an SSN', () => {
  // %20 then a date (1.14.2012) reads as 201.14.2012 without the escape.
  const url = `https://example.gov/files/Health%20Code%20effective%${n('.', '201', '14', '2012')}.pdf`;
  assert.equal(hasSsnForm(url), false, url);
  for (const sep of ['-', ' ', '.']) assert.equal(hasSsnForm(`see /files/a%${n(sep, ...VOIDED)}`), false, sep);
  assert.equal(hasSsnForm(`50% ${n('-', ...VOIDED)}`), true, 'a space after the percent sign ends the escape');
  assert.equal(hasSsnForm(`5%${n('-', ...VOIDED)}`), true, 'a percentage, not an escape: a digit before the %');
  assert.equal(hasSsnForm(`rate%${n('-', ...VOIDED)}`), true, 'no URL: no / in the token before the %');
  assert.equal(hasSsnForm(`/files/a x%${n('-', ...VOIDED)}`), true, 'the / must be in the same unbroken token');
  for (const token of ['n/a', 'a/b', 'example.gov/files']) assert.equal(hasSsnForm(`${token}%${n('-', ...VOIDED)}`), true, `not URL-shaped: ${token}`);
  assert.equal(hasSsnForm(`effective ${n('.', '201', '14', '2012')}`), true, 'without the escape the form still counts');
});

test('false positives: phones, dates, ZIP+4, CRD, EINs, control and accession numbers raise nothing', () => {
  const ordinary = [
    'Call 303-555-0123, (303) 555-0123, 303.555.0123 or +1 303 555 0123; fax 1-303-555-0199.',
    'Signed 2012-11-22, 11/22/2012, 22.11.2012, Nov. 22, 2012 at 10:30:45; period 2011-2012.',
    'Denver, CO 80202-1234; Boulder 80302 4321; ZIP+4 802021234 on the envelope.',
    'CRD# 1234567, IARD 7654321, SEC file 801-12345 and CIK 0001234567.',
    `Vendor EIN ${n('-', '12', '3456789')}; the employer identification number is ${n('-', '98', '7654321')}.`,
    'Control numbers DOE-000412, DOE-000919 at 3 and XYZ-000005.',
    'Filing accession 0001234567-24-000123, file Invoice__2011-11-08__Tally-Payroll__0009990001-24-000002.xml.',
    'C.R.S. 7-80-714 and 4-2-309; 6 CCR 1010-2; 15 U.S.C. 80b-6; Rule 10b-5; case 1:12-cv-01234.',
    'Card 4111 1111 1111 1111; IP 192.168.10.1; ISBN 978-3-16-148410-0; version 1.2.3.',
    'Paid $1,234.56, 78.90 and 12.00; balance 5,000.00; units 100 25 1000 1500 2000.',
    'Account ending 1234; reference 123456789012; wire 2012121700012345.',
  ];
  for (const text of ordinary) assert.deepEqual(rules(text), [], text);
});

test('labelled: nine digits after a label, in EIN grouping, plain, or digit boxes', () => {
  const digits = ['900', '12', '3456'];
  const cases = [
    `Social security number: ${n('-', '90', '0123456')}`,
    `Social Security No. ${digits.join('')}`,
    `Soc. Sec. # ${n(' ', ...digits)}`,
    `SSN ${n('-', '90', '0123456')}`,
    `S.S.N.: ${digits.join('')}`,
    `SS# ${digits.join('')}`,
    `Taxpayer Identification Number (TIN) ${n('-', '90', '0123456')}`,
    `ITIN ${digits.join('')}`,
    `Partner's identifying number ${n('-', '90', '0123456')}`,
    `Shareholder's identifying number\n${n('-', ...digits)}`,
    `Social security number\n${n(' ', ...digits.join(''))}`,
    `Social security number\n9 0 0\n1 2\n3 4 5 6\nor\nEmployer identification number\n`,
    `SSN | ${n(' | ', ...digits.join(''))} |`,
    `Partner's SSN or TIN (Do not use TIN of a disregarded entity. See instructions.)\n${n('-', '90', '0123456')}`,
  ];
  for (const text of cases) {
    const hits = labelledHits(text);
    assert.equal(hits.length, 1, text);
    assert.equal(hits[0].masked, '***-**-3456', text);
  }
});

test('labelled: the label must come first, within the window, in capitals for the abbreviations', () => {
  const nine = n('-', '90', '0123456');
  assert.deepEqual(labelledHits(`${nine} is the SSN`), [], 'digits before the label');
  assert.equal(labelledHits(`SSN${' '.repeat(LABEL_WINDOW)}${nine}`).length, 1, 'at the edge of the window');
  assert.deepEqual(labelledHits(`SSN${' '.repeat(LABEL_WINDOW + 1)}${nine}`), [], 'past the window');
  for (const text of [`a tin roof ${nine}`, `Martin ${nine}`, `ssn ${nine}`, `SETTING ${nine}`, `lessons ${nine}`, `Partnership's employer identification number ${nine}`]) {
    assert.deepEqual(labelledHits(text), [], text);
  }
  for (const filler of [n('-', '000', '00', '0000'), '000000000', n('-', '123', '00', '4567'), n('-', '123', '45', '0000')]) {
    assert.deepEqual(labelledHits(`SSN: ${filler}`), [], `a blank form's filler ${maskDigits(filler)}`);
  }
  assert.deepEqual(labelledHits(`SSN: XXX-XX-${'3456'}`), [], 'a masked number');
  assert.equal(labelledHits(`SSN or EIN: ${n('-', '900', '12', '3456')} / ${n('-', '91', '2345678')}`).length, 2);
});

test('nine-digit runs: whole groups joined by short separators; cents and long numbers end a run', () => {
  const digitsOf = (text: string) => nineDigitRuns(text).map((run) => run.digits);
  assert.deepEqual(digitsOf(`${n('-', '666', '12', '3456')}`), ['666123456']);
  assert.deepEqual(digitsOf(`${n(' ', ...'666123456')}`).slice(0, 1), ['666123456']);
  assert.deepEqual(digitsOf(`${n('\n', '666', '12', '3456')}`), ['666123456']);
  assert.deepEqual(digitsOf('1,234.56 78.90 12.00'), [], 'amounts');
  assert.deepEqual(digitsOf('6661234567'), [], 'ten digits are another number');
  assert.deepEqual(digitsOf(`${n('.', '666', '12', '3456')}`), ['666123456'], 'a dotted SSN is not cents');
  assert.deepEqual(digitsOf('666 12 345'), [], 'eight digits');
});

test('known-hash: any grouping of a known number, async and sync alike', async () => {
  const secret = '666123456';
  const asked: string[] = [];
  const known: KnownMatcher = {
    matches: async (digits) => (asked.push(digits), digits === secret),
    matchesSync: (digits) => digits === secret,
  };
  const groupings = [secret, n('-', '666', '12', '3456'), n('-', '66', '6123456'), n(' ', ...secret), n('\n', '666', '12', '3456'), `${n(' ', '666', '12')}\n3456`];
  for (const form of groupings) {
    const text = `Record of ${form} kept.`;
    const hits = await findPii(text, known);
    assert.deepEqual(hits.map((hit) => [hit.rule, hit.masked]), [['known-hash', '***-**-3456']], JSON.stringify(form));
    assert.deepEqual(findPiiSync(text, known), hits);
  }
  assert.deepEqual(await findPii(`EIN ${n('-', '12', '3456789')}`, known), [], 'another number is no hit');
  assert.ok(asked.includes('123456789'), 'every nine-digit run is asked');
});

/** Invented: its digits simply count up. */
const INVENTED = ['123', '45', '6789'] as const;

test('ssn-form: a spaced dash beside the form does not make it a longer number', () => {
  const number = n('-', ...INVENTED);
  for (const text of [`Founder 1 - ${number}`, `Founder 1 \u2013 ${number}`, `${number} - 500 shares`, `${number} \u2013 40%`, `Holder 12 - ${number} - 500 shares`]) {
    assert.equal(hasSsnForm(text), true, text);
  }
  for (const text of [`1-${number}`, `${number}-7`, `1\u2013${number}`]) assert.equal(hasSsnForm(text), false, text);
});

test('every width of digit, dash and space reads as the plain one', () => {
  const fullwidth = (text: string) => [...text].map((c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0)).join('');
  for (const text of [n('\uff0d', ...INVENTED), INVENTED.map(fullwidth).join('-'), INVENTED.map(fullwidth).join('\uff0d'), n('\u2009', ...INVENTED), n('\u202f', ...INVENTED), n('\u2007', ...INVENTED)]) {
    assert.equal(hasSsnForm(`Holder ${text} on file`), true, JSON.stringify(text));
  }
  assert.deepEqual(findPiiSync(`SSN ${INVENTED.join('').split('').map(fullwidth).join('')}`).map((hit) => hit.rule), ['labelled']);
});

test('a path: dashes and underscores only separate words, escapes are decoded, a label counts in any case', () => {
  const number = n('-', ...INVENTED);
  for (const rel of [`W-9-${number}.pdf`, `2024-01-15-${number}.pdf`, `Roe-${number}-2024.pdf`, `W-9%20${number}.pdf`, `W9_${INVENTED.join('_')}.pdf`, `ssn-${INVENTED.join('')}.pdf`, `${number}/notes.txt`]) {
    assert.ok(pathHits(rel).length > 0, rel);
    assert.equal(/\d/.test(maskPath(rel)), false, rel);
  }
  for (const rel of ['Invoice__2011-11-08__Tally-Payroll__0009990001-24-000002.xml', 'Deck 2024-01-15.pdf', 'Order 123456789.pdf', 'W-9.pdf']) {
    assert.deepEqual(pathHits(rel), [], rel);
    assert.equal(maskPath(rel), rel);
  }
  const known: KnownMatcher = { matches: async () => true, matchesSync: (digits) => digits === INVENTED.join('') };
  assert.equal(maskPath(`Order ${INVENTED.join('')}.pdf`, known), 'Order #########.pdf', 'a known number in a name');
});

test('a format character inside a number does not hide it: soft hyphen, zero-width space', () => {
  const SHY = '\u00ad';
  const ZWSP = '\u200b';
  const number = n('-', ...INVENTED);
  assert.equal(findPiiSync(`Holder ${number} signed`).length, 1);
  for (const text of [`Holder 123-45-67${SHY}89 signed`, `Holder 123-45-67${ZWSP}89 signed`, `Holder 123${ZWSP}-45-6789 signed`, `Holder 1${SHY}2${ZWSP}3-45-6789 signed`]) {
    assert.deepEqual(rules(text), ['ssn-form'], JSON.stringify(text));
  }
  assert.deepEqual(rules(`SSN: 123${ZWSP}45${SHY}6789`), ['labelled']);
  const known: KnownMatcher = { matches: async () => true, matchesSync: (digits) => digits === INVENTED.join('') };
  const rel = `W9/holder_123${ZWSP}45${ZWSP}6789.pdf`;
  assert.deepEqual(pathHits(rel, known).map((hit) => hit.rule), ['known-hash'], 'a known number in a name');
  assert.equal(maskPath(rel, known), `W#/holder_###${ZWSP}##${ZWSP}####.pdf`);
  assert.ok(pathHits(`W9/holder_123${SHY}-45-6789.pdf`).length > 0, 'a printed form in a name');
});

test('a path: a format character written as a UTF-8 escape is dropped too, a whole code point at a time (#37)', () => {
  const number = n('-', ...INVENTED);
  for (const rel of [`W9/holder_123-45-67%C2%AD89.pdf`, `W9/holder_123-45-67%E2%80%8B89.pdf`, `W9/holder_123%e2%80%8b-45-6789.pdf`, `W9/holder_123-45-67%AD89.pdf`, `Caf%C3%A9 ${number}.pdf`]) {
    assert.ok(pathHits(rel).some((hit) => hit.rule === 'ssn-form'), rel);
    assert.equal(/\d/.test(maskPath(rel)), false, rel);
  }
  const known: KnownMatcher = { matches: async () => true, matchesSync: (digits) => digits === INVENTED.join('') };
  assert.deepEqual(pathHits(`W9/holder_123%E2%80%8B45%E2%80%8B6789.pdf`, known).map((hit) => hit.rule), ['known-hash'], 'escaped zero-width spaces');
  for (const rel of ['Deck%202024-01-15.pdf', 'Order%20123456789.pdf', 'bad%E2%80.pdf', 'bad%FF%FE.pdf']) assert.deepEqual(pathHits(rel), [], rel);
});
