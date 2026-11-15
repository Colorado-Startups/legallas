// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pinpointQuote } from '../../worker/citations.ts';
import { pageSegments } from '../../worker/passages.ts';
import { buildParts } from '../../scripts/indexparts.ts';
import { locateQuote } from './files-format.ts';
import { exemptionLabel, money, renderFormD } from './formd.ts';
import { FORM_D_FIXTURE_NAME, FORM_D_FIXTURE_XML } from './formd.test-data.ts';

// The fictional Sample Copper Works Form D/A only (formd.test-data.ts); never case content.
const text = renderFormD(FORM_D_FIXTURE_XML, FORM_D_FIXTURE_NAME) ?? '';
const lines = text.split('\n');
const has = (line: string) => assert.ok(lines.includes(line), `missing line: ${line}`);

test('a Form D/A is one page of labelled fields, with the accession number and date from the file name', () => {
  assert.ok(text.startsWith('SEC Form D/A, Notice of Exempt Offering of Securities (amendment)\nIssuer: Sample Copper Works, Inc. (CIK 0009990007)\n'));
  has('Accession number (from the file name): 0009990007-12-000031');
  has('Date in the file name: 2012-09-18');
  has('EDGAR: https://www.sec.gov/Archives/edgar/data/9990007/000999000712000031/');
  has("Set out as text by the room from the filing's EDGAR XML; the XML file is the original.");
});

test('the indexed text never says "counsel room", so a room with no matter cannot quote it (#215)', () => {
  assert.doesNotMatch(text, /counsel room/i);
});

test('the items counsel ask about read as on the form', () => {
  // Item 1
  has('Name of issuer: Sample Copper Works, Inc.');
  has('CIK (filer ID number): 0009990007');
  has('Jurisdiction of incorporation or organization: NEVADA');
  has('Entity type: Corporation');
  has('Year of incorporation or organization: 2010 (within the last five years)');
  // Item 3: EDGAR's "N/A" first name on an entity is dropped; several relationships and a middle name are kept.
  has('1. Sample Copper Holdings, Inc.');
  has('   Relationship: Executive Officer');
  has('2. Morgan Reyes');
  has('   Relationship: Executive Officer, Director');
  has('3. Alex B. Quinn');
  has('   Clarification: President and Director of the Issuer');
  // Items 5 to 7
  has('Revenue range: $1,000,001 - $5,000,000');
  has('Rule 506(c) (code 06c)');
  has('Securities Act Section 4(a)(5) (code 4a5)');
  has('New notice or amendment: Amendment');
  has('Previous accession number: 0009990007-11-000018');
  has('Date of first sale: 2012-02-27');
  // Items 11 to 16
  has('Minimum investment accepted from any outside investor: $12,500');
  has('1. Sample Placement Corp. (CRD 9990005)');
  has('   Associated broker-dealer: None (CRD None)');
  has('   States of solicitation: NM, UT');
  has('Total offering amount: $2,640,000');
  has('Total amount sold: $1,185,750');
  has('Total remaining to be sold: $1,454,250');
  has('Total number of investors who already have invested in the offering: 14');
  has('Sales commissions: $4,200 (estimate)');
  has("Finders' fees: $975");
  has("Clarification: Sample Copper Holdings, Inc. & the officers listed in Item 3 may receive salaries paid from the issuer's proceeds.");
  // Signature
  has('Name of signer: Morgan Reyes');
  has('Title: President of the Issuer');
  has('Date: 2012-09-11');
  assert.ok(!text.includes('Other fields in the XML'), 'every field of the fixture has a place on the page');
});

test('the glance restates the key fields near the issuer name, so one retrieved chunk carries both', () => {
  const glance = text.slice(text.indexOf('At a glance'), text.indexOf("Item 1. Issuer's identity"));
  for (const fact of [
    '- Form D/A for Sample Copper Works, Inc., CIK 0009990007; jurisdiction NEVADA; entity type Corporation.',
    '- Exemptions claimed: Rule 506(c); Securities Act Section 4(a)(5).',
    '- Total amount sold $1,185,750; total offering amount $2,640,000; investors 14.',
    '- Date of first sale 2012-02-27; total remaining $1,454,250.',
    '- Related persons: Sample Copper Holdings, Inc.; Morgan Reyes; Alex B. Quinn.',
    '- Signed 2012-09-11 by Morgan Reyes, President of the Issuer.',
  ]) {
    assert.ok(glance.includes(fact), fact);
  }
  assert.ok(text.indexOf('At a glance') < 600, 'the glance opens the page');
});

test('a field the renderer does not know is listed, never dropped', () => {
  const xml = FORM_D_FIXTURE_XML.replace('<totalNumberAlreadyInvested>', '<futureField>seven</futureField><totalNumberAlreadyInvested>');
  const out = renderFormD(xml, FORM_D_FIXTURE_NAME) ?? '';
  assert.ok(out.endsWith('Other fields in the XML (not set out above)\nofferingData/investors/futureField: seven\n'));
});

test('a new notice with no sale yet and an indefinite offering; a pooled fund, its net asset value and its exclusions', () => {
  const xml = FORM_D_FIXTURE_XML.replace('<isAmendment>true</isAmendment>', '<isAmendment>false</isAmendment>')
    .replace(/<previousAccessionNumber>[^<]*<\/previousAccessionNumber>/, '')
    .replace('<value>2012-02-27</value>', '<yetToOccur>true</yetToOccur>')
    .replace('<submissionType>D/A</submissionType>', '<submissionType>D</submissionType>')
    .replace('<totalOfferingAmount>2640000</totalOfferingAmount>', '<totalOfferingAmount>Indefinite</totalOfferingAmount>')
    // What this corporation's filing does not reach: a pooled fund's industry group, net asset value, exclusions and interests.
    .replace('<industryGroupType>Construction</industryGroupType>', '<industryGroupType>Pooled Investment Fund</industryGroupType><investmentFundInfo><investmentFundType>Other Investment Fund</investmentFundType><is40Act>false</is40Act></investmentFundInfo>')
    .replace(/<revenueRange>[^<]*<\/revenueRange>/, '<aggregateNetAssetValueRange>Decline to Disclose</aggregateNetAssetValueRange>')
    .replace('<item>4a5</item>', '<item>3C</item><item>3C.5</item>')
    .replace('<isEquityType>true</isEquityType>', '<isPooledInvestmentFundType>true</isPooledInvestmentFundType>');
  const out = (renderFormD(xml, 'FormD__2011-10-25__Sample_Copper_Works__0009990007-11-000018.xml') ?? '').split('\n');
  assert.equal(out[0], 'SEC Form D, Notice of Exempt Offering of Securities');
  for (const line of [
    'New notice or amendment: New notice',
    'Date of first sale: Yet to occur',
    'Total offering amount: Indefinite',
    'Date in the file name: 2011-10-25',
    'Industry group: Pooled Investment Fund',
    'Investment fund type: Other Investment Fund',
    'Registered or required to register under the Investment Company Act of 1940: No',
    'Aggregate net asset value range: Decline to Disclose',
    'Investment Company Act Section 3(c) (code 3C)',
    'Investment Company Act Section 3(c)(5) (code 3C.5)',
    '- Exemptions claimed: Rule 506(c); Investment Company Act Section 3(c); Investment Company Act Section 3(c)(5).',
    'Pooled investment fund interests',
  ]) {
    assert.ok(out.includes(line), line);
  }
  assert.ok(!out.some((line) => line.startsWith('Previous accession number') || line.startsWith('Other fields in the XML')));
});

test('an element the filing leaves out reads "not given", never "None" or "New notice"', () => {
  const xml = FORM_D_FIXTURE_XML.replace(/<federalExemptionsExclusions>[\s\S]*?<\/federalExemptionsExclusions>/, '')
    .replace(/<newOrAmendment>[\s\S]*?<\/newOrAmendment>/, '')
    .replace(/<relatedPersonsList>[\s\S]*?<\/relatedPersonsList>/, '')
    .replace(/<salesCompensationList>[\s\S]*?<\/salesCompensationList>/, '')
    .replace(/<issuerSize>[\s\S]*?<\/issuerSize>/, '')
    .replace(/<totalAmountSold>[^<]*<\/totalAmountSold>/, '')
    .replace(/<investors>[\s\S]*?<\/investors>/, '');
  const out = renderFormD(xml, FORM_D_FIXTURE_NAME) ?? '';
  const lines = out.split('\n');
  for (const line of [
    '- Exemptions claimed: not given.',
    '- Related persons: not given.',
    '- Total amount sold not given; total offering amount $2,640,000; investors not given.',
    'Exemptions and exclusions: not given',
    'New notice or amendment: not given',
    'Related persons: not given',
    'Recipients: not given',
    'Issuer size: not given',
    'Total amount sold: not given',
    'Securities sold to non-accredited investors: not given',
    'Total number of investors who already have invested in the offering: not given',
  ]) {
    assert.ok(lines.includes(line), line);
  }
  assert.ok(!lines.some((line) => line.endsWith(': New notice')), 'never "New notice" without isAmendment false');
  assert.ok(!out.includes('Previous accession number'));
  const section = (title: string) => out.slice(out.indexOf(title), out.indexOf('\n\n', out.indexOf(title)));
  for (const title of ['Item 3.', 'Item 6.', 'Item 7.', 'Item 12.', 'Item 13.', 'Item 14.', 'At a glance']) {
    assert.doesNotMatch(section(title), /\bnone\b/i, title);
  }
});

test('an element present and empty reads "None"; isAmendment false reads "New notice"', () => {
  const xml = FORM_D_FIXTURE_XML.replace(/<federalExemptionsExclusions>[\s\S]*?<\/federalExemptionsExclusions>/, '<federalExemptionsExclusions></federalExemptionsExclusions>')
    .replace(/<relatedPersonsList>[\s\S]*?<\/relatedPersonsList>/, '<relatedPersonsList/>')
    .replace('<isAmendment>true</isAmendment>', '<isAmendment>false</isAmendment>');
  const lines = (renderFormD(xml, FORM_D_FIXTURE_NAME) ?? '').split('\n');
  for (const line of ['- Exemptions claimed: none.', '- Related persons: none listed.', 'None listed', 'New notice or amendment: New notice']) {
    assert.ok(lines.includes(line), line);
  }
  const item6 = lines.indexOf('Item 6. Federal exemptions and exclusions claimed');
  assert.equal(lines[item6 + 1], 'None');
});

test('hostile input is refused (null), never thrown on', () => {
  const body = FORM_D_FIXTURE_XML.replace('<?xml version="1.0"?>', '');
  const deep = (n: number) => FORM_D_FIXTURE_XML.replace('<offeringData>', `<offeringData>${'<x>'.repeat(n)}leaf${'</x>'.repeat(n)}`);
  const cases: [string, string][] = [
    ['nesting past the limit', deep(70)],
    ['nesting far past the limit', deep(150_000)],
    ['a DOCTYPE with an entity', `<?xml version="1.0"?><!DOCTYPE edgarSubmission [<!ENTITY x "boom">]>${body.replace('<testOrLive>LIVE', '<testOrLive>&x;')}`],
    ['entity expansion', `<?xml version="1.0"?><!DOCTYPE d [<!ENTITY a "aaaa"><!ENTITY b "&a;&a;&a;&a;">]>${body}`],
    ['a bare DOCTYPE', `<?xml version="1.0"?><!DOCTYPE edgarSubmission>${body}`],
    ['an unterminated comment', FORM_D_FIXTURE_XML.replace('<offeringData>', '<offeringData><!-- never closed')],
    ['an unterminated CDATA', FORM_D_FIXTURE_XML.replace('<offeringData>', '<offeringData><![CDATA[ never closed')],
  ];
  for (const [label, xml] of cases) assert.equal(renderFormD(xml, FORM_D_FIXTURE_NAME), null, label);
  const within = renderFormD(deep(50), FORM_D_FIXTURE_NAME) ?? '';
  assert.ok(within.includes(`offeringData/${'x/'.repeat(49)}x: leaf`), 'nesting within the limit still renders, the field listed');
});

test('a byte order mark, as Node reads one and the browser does not, changes nothing', () => {
  assert.equal(renderFormD(`﻿${FORM_D_FIXTURE_XML}`, FORM_D_FIXTURE_NAME), text);
});

test('without an accession number in the file name there is no EDGAR link and no invented one', () => {
  const out = renderFormD(FORM_D_FIXTURE_XML, 'primary_doc.xml') ?? '';
  assert.ok(out.startsWith('SEC Form D/A'));
  assert.ok(!/Accession number \(from|EDGAR: |Date in the file name/.test(out));
});

test('anything that is not a well-formed Form D is left alone (null)', () => {
  const cases: [string, string][] = [
    ['another EDGAR form', FORM_D_FIXTURE_XML.replace('<submissionType>D/A</submissionType>', '<submissionType>13F-HR</submissionType>')],
    ['another root', '<?xml version="1.0"?><catalog><book>One</book></catalog>'],
    ['unbalanced tags', FORM_D_FIXTURE_XML.replace('</primaryIssuer>', '')],
    ['two roots', `${FORM_D_FIXTURE_XML}<edgarSubmission></edgarSubmission>`],
    ['text after the root', `${FORM_D_FIXTURE_XML}trailing`],
    ['plain text', 'Not XML at all.'],
    ['empty', ''],
    ['too large', FORM_D_FIXTURE_XML + ' '.repeat(1_000_001)],
  ];
  for (const [label, xml] of cases) assert.equal(renderFormD(xml, FORM_D_FIXTURE_NAME), null, label);
});

test('entities decode once, as XML says, and a stray ampersand stays', () => {
  const xml = FORM_D_FIXTURE_XML.replace('<entityName>Sample Copper Works, Inc.</entityName>', '<entityName>Reyes &#38; Quinn &#x2116;1 &amp;#8453; A&amp;B &bogus; &#0;</entityName>');
  assert.ok((renderFormD(xml, FORM_D_FIXTURE_NAME) ?? '').includes('Name of issuer: Reyes & Quinn №1 &#8453; A&B &bogus; &#0;'));
});

test('exemption codes and amounts', () => {
  assert.equal(exemptionLabel('06b'), 'Rule 506(b)');
  assert.equal(exemptionLabel('3C.1'), 'Investment Company Act Section 3(c)(1)');
  assert.equal(exemptionLabel('3C.14'), 'Investment Company Act Section 3(c)(14)');
  assert.equal(exemptionLabel('4a5'), 'Securities Act Section 4(a)(5)');
  assert.equal(exemptionLabel('04.2'), 'Rule 504(b)(1)(ii)');
  assert.equal(exemptionLabel('99z'), 'Code 99z');
  assert.equal(money('1234567890'), '$1,234,567,890');
  assert.equal(money('1234.50'), '$1,234.50');
  assert.equal(money('0'), '$0');
  assert.equal(money('Indefinite'), 'Indefinite');
});

test('a cite into a Form D gets a pinpoint quote the viewer can find on the page', () => {
  // The index text is the rendered page (scripts/extract.ts) and the viewer shows the same (doc-views.ts showText).
  const chunks = buildParts('doc-formd', [{ n: 1, text }]).map((part) => ({ docId: 'doc-formd', text: part.body }));
  const segments = pageSegments(chunks, 'doc-formd', 1);
  for (const [carrier, expected] of [
    ['Sample Copper Works reported $1,185,750 sold to 14 investors', '$1,185,750'],
    ['The corporation claimed Securities Act Section 4(a)(5)', 'Section 4(a)(5)'],
    ['Morgan Reyes signed the amendment on 2012-09-11', 'Signed 2012-09-11'],
  ] as const) {
    const quote = pinpointQuote(segments, carrier);
    assert.ok(quote?.includes(expected), `${carrier} -> ${quote}`);
    assert.ok(locateQuote(text, quote ?? ''), `the viewer finds: ${quote}`);
  }
});
