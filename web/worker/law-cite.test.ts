// SPDX-License-Identifier: Apache-2.0
// Citation normalization and law ids for the law library (T21). Citations here are public law; no case content.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseCitation, caseIdFor, citationsIn, citedLaw, isLawId, isOfficialLink, lawFromKey, lawKey, normalizeCitation, unitIdFor, unitOf } from './law-cite.ts';

test('loose statute, rule and instruction cites read as one canonical spelling', () => {
  const cases: [string, string][] = [
    ['CRS 7-80-714(1)', 'C.R.S. § 7-80-714(1)'],
    ['C.R.S. §7-80-404 (1)(a)', 'C.R.S. § 7-80-404(1)(a)'],
    ['Colo. Rev. Stat. § 11-51-604(3)', 'C.R.S. § 11-51-604(3)'],
    ['C.R.S.A. 7-80-408', 'C.R.S. § 7-80-408'],
    ['17 CFR 230.506(b)', '17 C.F.R. § 230.506(b)'],
    ['17 C.F.R. § 240.10b-5', '17 C.F.R. § 240.10b-5'],
    ['15 USC 80b-6', '15 U.S.C. § 80b-6'],
    ['15 U.S.C. § 80b-6(4)', '15 U.S.C. § 80b-6(4)'],
    ['Rule 506(b) of Regulation D', '17 C.F.R. § 230.506(b)'],
    ['SEC Rule 506(c)', '17 C.F.R. § 230.506(c)'],
    ['Regulation D, Rule 502(c)', '17 C.F.R. § 230.502(c)'],
    ['SEC Rule 10b-5(b)', '17 C.F.R. § 240.10b-5(b)'],
    ['Advisers Act section 206(4)', '15 U.S.C. § 80b-6(4)'],
    ['CJI-Civ 6:1', 'CJI-Civ 6:1'],
    ['CJI Civ. 4th 9:1', 'CJI-Civ 9:1'],
    ['3 CCR 704-1, Rule 51-4.1', '3 CCR 704-1, Rule 51-4.1'],
    ['3 C.C.R. 704-1', '3 CCR 704-1'],
    ['412 P. 2d 77', '412 P.2d 77'],
    ['214 P.3d 1086', '214 P.3d 1086'],
    ['2019 coa 152', '2019 COA 152'],
    ['2016 CO 4', '2016 CO 4'],
  ];
  for (const [raw, want] of cases) assert.equal(normalizeCitation(raw), want, raw);
});

test('text that is not a citation reads as null', () => {
  for (const raw of ['the operating agreement', 'page 4', 'Rule 12(b)(6)', '', 'DOE-000412', 'Rule 501', 'Rule 502(b)', 'SEC Rule 5010', 'Rule 5081 of Regulation D']) {
    assert.equal(normalizeCitation(raw), null, raw);
  }
});

test('baseCitation drops the pinpoint, so a pinpointed cite matches its unit', () => {
  assert.equal(baseCitation('C.R.S. § 7-80-714(1)(a)'), 'C.R.S. § 7-80-714');
  assert.equal(baseCitation('17 C.F.R. § 230.506(b)(2)(ii)'), '17 C.F.R. § 230.506');
  assert.equal(baseCitation('CJI-Civ 6:1'), 'CJI-Civ 6:1');
  assert.equal(baseCitation('C.R.S. § 7-80-404(3)-(6)'), 'C.R.S. § 7-80-404');
});

test('unit ids come from canonical cites; cases get theirs from the reporter cite', () => {
  assert.equal(unitIdFor('C.R.S. § 7-80-714(1)'), 'crs-7-80-714');
  assert.equal(unitIdFor('C.R.S. § 7-80-803.3'), 'crs-7-80-803-3');
  assert.equal(unitIdFor('17 C.F.R. § 230.506(b)'), 'cfr-17-230-506');
  assert.equal(unitIdFor('17 C.F.R. § 240.10b-5'), 'cfr-17-240-10b-5');
  assert.equal(unitIdFor('15 U.S.C. § 80b-6'), 'usc-15-80b-6');
  assert.equal(unitIdFor('26 U.S.C. § 409A'), 'usc-26-409a');
  assert.equal(unitIdFor(normalizeCitation('26 U.S.C. 6041A(a)') ?? ''), 'usc-26-6041a');
  assert.equal(unitIdFor('CJI-Civ 6:1A'), 'cji-6-1a');
  assert.equal(unitIdFor('3 CCR 704-1, Rule 51-4.1'), 'ccr-704-1-r51-4-1');
  assert.equal(unitIdFor('412 P.2d 77'), null);
  assert.equal(caseIdFor('412 P. 2d 77'), 'case-412-p2d-77');
  assert.equal(caseIdFor('2019 COA 152'), 'case-2019-coa-152');
  assert.equal(caseIdFor('not a cite'), null);
  for (const id of ['crs-7-80-714', 'cfr-17-240-10b-5', 'case-412-p2d-77', 'cji-6-1a', 'crs-7-80-404~2']) assert.ok(isLawId(id), id);
});

test('SEC rules named for a subsection, the 1940 Acts\' sections and adviser rules read as their own units', () => {
  const cases: [string, string][] = [
    ['17 CFR 275.203(l)-1', '17 C.F.R. § 275.203(l)-1'],
    ['17 C.F.R. § 275.203(m)-1(a)(1)', '17 C.F.R. § 275.203(m)-1(a)(1)'],
    ['17 C.F.R. 275.204-4', '17 C.F.R. § 275.204-4'],
    ['Advisers Act section 203(l)', '15 U.S.C. § 80b-3(l)'],
    ['Investment Advisers Act of 1940 § 203A', '15 U.S.C. § 80b-3a'],
    ['Investment Company Act section 3(c)(7)', '15 U.S.C. § 80a-3(c)(7)'],
    ['Investment Company Act of 1940 § 2(a)(51)', '15 U.S.C. § 80a-2(a)(51)'],
    ['3 CCR 704-1, Rule 51-4.11(ia)', '3 CCR 704-1, Rule 51-4.11(IA)'],
  ];
  for (const [raw, want] of cases) assert.equal(normalizeCitation(raw), want, raw);
  for (const raw of ['Advisers Act section 2061', 'Investment Company Act section 36', 'Advisers Act § 215']) assert.equal(normalizeCitation(raw), null, raw);
  assert.equal(baseCitation('17 C.F.R. § 275.203(l)-1(a)(2)'), '17 C.F.R. § 275.203(l)-1');
  assert.equal(unitIdFor('17 C.F.R. § 275.203(l)-1(a)'), 'cfr-17-275-203-l-1');
  assert.equal(unitIdFor('17 C.F.R. § 275.204-4'), 'cfr-17-275-204-4');
  assert.equal(unitIdFor('15 U.S.C. § 80a-3(c)(7)'), 'usc-15-80a-3');
  assert.equal(baseCitation('3 CCR 704-1, Rule 51-4.11(IA)(B)'), '3 CCR 704-1, Rule 51-4.11(IA)');
  assert.equal(baseCitation('3 CCR 704-1, Rule 51-4.1(A)'), '3 CCR 704-1, Rule 51-4.1');
  assert.equal(unitIdFor('3 CCR 704-1, Rule 51-4.11(IA)'), 'ccr-704-1-r51-4-11-ia');
  assert.notEqual(unitIdFor('3 CCR 704-1, Rule 51-4.1(IA)'), unitIdFor('3 CCR 704-1, Rule 51-4.1'), 'the adviser rule is not the broker-dealer rule');
  assert.equal(unitIdFor('3 CCR 704-1, Rule 51-2.1.1'), 'ccr-704-1-r51-2-1-1');
  for (const id of ['cfr-17-275-203-l-1', 'ccr-704-1-r51-4-11-ia', 'ccr-704-1-r51-4-11-ia~2']) assert.ok(isLawId(id), id);
});

test('law ids are never paths, and keys round-trip through their track folder', () => {
  for (const bad of ['../x', 'crs/7', 'CRS-7-80', 'crs', 'crs-7-80-714~0', 'a-b~1000', `${'a-'.repeat(60)}b`]) assert.equal(isLawId(bad), false, bad);
  assert.equal(lawKey({ id: 'crs-7-80-714', track: 'civil' }), 'law/civil/crs-7-80-714.md');
  assert.deepEqual(lawFromKey('law/regulator/ccr-704-1-r51-4-1.md'), { id: 'ccr-704-1-r51-4-1', track: 'regulator' });
  for (const key of ['text/abc.p1.md', 'law/other/crs-7-80-714.md', 'law/civil/../x.md', 'catalog.json']) assert.equal(lawFromKey(key), null, key);
  assert.throws(() => lawKey({ id: '../x', track: 'civil' }));
  assert.equal(unitOf('crs-7-80-404~2'), 'crs-7-80-404');
});

test('the model\'s law tags are read in ASCII and fullwidth brackets, in order', () => {
  assert.deepEqual(citedLaw('A [law:crs-7-80-714] and 【law:cfr-17-230-506~2】, again [law:crs-7-80-714]; [law:../etc] is not one.'), [
    'crs-7-80-714',
    'cfr-17-230-506~2',
    'crs-7-80-714',
  ]);
});

test('SEC rule numbers with letters inside them read whole, in their official capitals or not', () => {
  assert.equal(normalizeCitation('17 CFR 240.15c3-1(a)'), '17 C.F.R. § 240.15c3-1(a)');
  assert.equal(normalizeCitation('17 C.F.R. § 230.144A(d)'), '17 C.F.R. § 230.144a(d)');
  assert.equal(normalizeCitation('17 CFR 240.15Ga-1'), '17 C.F.R. § 240.15ga-1');
  assert.equal(normalizeCitation('17 CFR 275.202(a)(11)(G)-1'), '17 C.F.R. § 275.202(a)(11)(g)-1');
  // What already read keeps reading the same.
  assert.equal(normalizeCitation('17 CFR 230.506(b)'), '17 C.F.R. § 230.506(b)');
  assert.equal(normalizeCitation('17 CFR 275.206(4)-2'), '17 C.F.R. § 275.206(4)-2');
  assert.equal(normalizeCitation('17 CFR 240.10b-5(b)'), '17 C.F.R. § 240.10b-5(b)');
  for (const [cite, id] of [
    ['17 C.F.R. § 230.506', 'cfr-17-230-506'],
    ['17 C.F.R. § 275.203(l)-1', 'cfr-17-275-203-l-1'],
    ['17 C.F.R. § 230.144A', 'cfr-17-230-144a'],
    ['17 C.F.R. § 240.15Ga-1', 'cfr-17-240-15ga-1'],
    ['17 C.F.R. § 275.202(a)(11)(G)-1', 'cfr-17-275-202-a-11-g-1'],
  ] as const) {
    assert.equal(unitIdFor(cite), id, cite);
    assert.ok(isLawId(unitIdFor(cite)!), cite);
  }
});

test('Delaware Code citations read in their usual forms, and their ids are law ids', () => {
  for (const [raw, cite] of [
    ['8 Del. C. § 141(a)', '8 Del. C. § 141(a)'],
    ['8 Del.C. 141', '8 Del. C. § 141'],
    ['6 Del. C. § 18-1101(c)', '6 Del. C. § 18-1101(c)'],
    ['Del. Code Ann. tit. 8, § 141(k)', '8 Del. C. § 141(k)'],
    ['DGCL § 251(c)', '8 Del. C. § 251(c)'],
    ['DLLCA § 18-305', '6 Del. C. § 18-305'],
  ] as const) {
    assert.equal(normalizeCitation(raw), cite, raw);
  }
  assert.equal(normalizeCitation('8 Del. C. 1953, § 101'), null);
  assert.equal(baseCitation('6 Del. C. § 18-1101(c)'), '6 Del. C. § 18-1101');
  for (const [cite, id] of [
    ['8 Del. C. § 141(a)', 'del-8-141'],
    ['6 Del. C. § 18-1101', 'del-6-18-1101'],
    ['19 Del. C. § 1102A', 'del-19-1102a'],
  ] as const) {
    assert.equal(unitIdFor(cite), id, cite);
    assert.ok(isLawId(id), cite);
  }
  assert.ok(isOfficialLink('https://delcode.delaware.gov/title8/c001/sc04/index.html#141'));
});

test('SEC staff interpretations and the Form ADV instructions read, and their ids are law ids', () => {
  for (const [raw, cite] of [
    ['C&DI 256.23', 'SEC CFI, Securities Act Rules, Question 256.23'],
    ['Securities Act Rules C&DI Question 110.01', 'SEC CFI, Securities Act Rules, Question 110.01'],
    ['CFI 510.01', 'SEC CFI, Securities Act Rules, Interpretive Response 510.01'],
  ] as const) {
    assert.equal(normalizeCitation(raw), cite, raw);
  }
  assert.equal(unitIdFor('SEC CFI, Securities Act Rules, Question 256.23'), 'cfi-sar-256-23');
  assert.equal(unitIdFor('SEC CFI, Securities Act Rules, Interpretive Response 510.01'), 'cfi-sar-510-01');
  assert.equal(unitIdFor('Form ADV, Instructions for Part 1A'), 'form-adv-instructions-for-part-1a');
  assert.ok(isLawId('cfi-sar-256-23') && isLawId('form-adv-glossary-of-terms'));
  assert.ok(isOfficialLink('https://www.sec.gov/files/formadv-instructions.pdf'));
  assert.ok(isOfficialLink('https://uscode.house.gov/us/usc/t26/s1202/'));
});

test('Form D\'s parts read in their usual forms, apart from the rule that names it, and their ids are law ids', () => {
  for (const [raw, cite] of [
    ['Form D, Item 7', 'Form D, Item 7'],
    ['Form D Item 6', 'Form D, Item 6'],
    ['Form D, Instructions to Item 7', 'Form D, Item 7'],
    ['Item 13 of Form D', 'Form D, Item 13'],
    ['Form D, General Instructions', 'Form D, General Instructions'],
    ['Form D Terms of Submission', 'Form D, Terms of Submission'],
    ['Form D, Signature and Submission', 'Form D, Signature and Submission'],
    ['17 CFR 239.500(a)(1)', '17 C.F.R. § 239.500(a)(1)'],
  ] as const) {
    assert.equal(normalizeCitation(raw), cite, raw);
  }
  for (const raw of ['Form D notice', 'Form D', 'Item 7', 'Form DX, Item 7', 'Form D, Item 0', 'Form D, Item 17', 'Item 17 of Form D', 'Item 7 of Form D-1']) assert.equal(normalizeCitation(raw), null, raw);
  assert.equal(unitIdFor('Form D, Item 17'), null);
  for (const [cite, id] of [
    ['Form D, Item 7', 'form-d-item-7'],
    ['Form D, Item 16', 'form-d-item-16'],
    ['Form D, General Instructions', 'form-d-general-instructions'],
    ['Form D, Terms of Submission', 'form-d-terms-of-submission'],
    ['Form D, Signature and Submission', 'form-d-signature-and-submission'],
  ] as const) {
    assert.equal(unitIdFor(cite), id, cite);
    assert.ok(isLawId(id), cite);
  }
  assert.equal(unitIdFor('17 C.F.R. § 239.500'), 'cfr-17-239-500');
  assert.deepEqual(citationsIn('File a Form D notice; see Form D, Item 7 and Item 6 of Form D.').map((hit) => hit.cite), ['Form D, Item 7', 'Form D, Item 6']);
  assert.ok(isOfficialLink('https://www.sec.gov/files/formd.pdf'));
});

test('a federal rule read from its uscourts.gov print gets an id per rule, decimal rules included', () => {
  for (const [cite, id] of [
    ['Fed. R. Civ. P. 4.1', 'frcp-4-1'],
    ['Fed. R. Civ. P. 87', 'frcp-87'],
    ['Fed. R. Evid. 1103', 'fre-1103'],
  ] as const) {
    assert.equal(unitIdFor(cite), id, cite);
    assert.ok(isLawId(id), cite);
  }
  assert.ok(isOfficialLink('https://www.uscourts.gov/sites/default/files/document/federal-rules-of-civil-procedure.pdf'));
});

test('law links are https on an official host only', () => {
  assert.ok(isOfficialLink('https://www.ecfr.gov/current/title-17/section-230.506'));
  assert.ok(isOfficialLink('https://www.courtlistener.com/opinion/1/x/'));
  for (const bad of ['http://www.ecfr.gov/x', 'https://evil.example/x', 'javascript:alert(1)', 'https://user:pw@www.ecfr.gov/', 'https://www.ecfr.gov:8443/', 'not a url']) {
    assert.equal(isOfficialLink(bad), false, bad);
  }
});

test('court rules read in their usual forms, and their ids are law ids (#331)', () => {
  const cases: [string, string, string][] = [
    ['Fed. R. Civ. P. 26', 'Fed. R. Civ. P. 26', 'frcp-26'],
    ['FRCP 37(e)', 'Fed. R. Civ. P. 37(e)', 'frcp-37'],
    ['Fed. R. Civ. P. 26(b)(1)', 'Fed. R. Civ. P. 26(b)(1)', 'frcp-26'],
    ['Fed. R. Evid. 502(b)', 'Fed. R. Evid. 502(b)', 'fre-502'],
    ['FRE 408', 'Fed. R. Evid. 408', 'fre-408'],
    ['C.R.C.P. 16.1', 'C.R.C.P. 16.1', 'crcp-16-1'],
    ['C.R.C.P. 26(b)(1)', 'C.R.C.P. 26(b)(1)', 'crcp-26'],
    ['C.R.C.P. 121, § 1-15', 'C.R.C.P. 121 § 1-15', 'crcp-121-1-15'],
    ['Ct. Ch. R. 37(e)', 'Ct. Ch. R. 37(e)', 'ctch-37'],
    ['Court of Chancery Rule 26', 'Ct. Ch. R. 26', 'ctch-26'],
    ['D.C.COLO.LCivR 7.1(a)', 'D.C.COLO.LCivR 7.1(a)', 'dcolo-lcivr-7-1'],
    ['D. Colo. L. Civ. R. 26.1', 'D.C.COLO.LCivR 26.1', 'dcolo-lcivr-26-1'],
  ];
  for (const [raw, cite, id] of cases) {
    assert.equal(normalizeCitation(raw), cite, raw);
    assert.equal(unitIdFor(cite), id, cite);
    assert.ok(isLawId(id), id);
  }
  for (const text of ['free 500 meals', 'Rule 26', 'C.R.S. 26']) assert.equal(normalizeCitation(text), null, text);
});

test('a C.F.R. part with a letter reads, and its id is a law id (#298)', () => {
  assert.equal(normalizeCitation('8 CFR 274a.2(b)(1)(ii)'), '8 C.F.R. § 274a.2(b)(1)(ii)');
  assert.equal(unitIdFor('8 C.F.R. § 274a.2(b)(1)(ii)'), 'cfr-8-274a-2');
  assert.equal(unitIdFor('17 C.F.R. § 230.506(b)'), 'cfr-17-230-506');
});

test('citationsIn finds each citation in running text: where it starts, how far it runs, its canonical form', () => {
  const text = 'Under C.R.S. § 7-80-714(1), and 26 U.S.C. § 83(b). See Rule 10b-5; free 500 meals; 3 CCR 704-1, Rule 51-4.1.';
  const found = citationsIn(text).map(({ index, length, cite }) => [text.slice(index, index + length), cite]);
  assert.deepEqual(found, [
    ['C.R.S. § 7-80-714(1)', 'C.R.S. § 7-80-714(1)'],
    ['26 U.S.C. § 83(b)', '26 U.S.C. § 83(b)'],
    ['Rule 10b-5', '17 C.F.R. § 240.10b-5'],
    ['3 CCR 704-1, Rule 51-4.1', '3 CCR 704-1, Rule 51-4.1'],
  ]);
  assert.deepEqual(citationsIn('No citation here, only 2019 and page 3.'), []);
});
