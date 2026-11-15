// SPDX-License-Identifier: Apache-2.0
// Source kinds from folder and file name only (fictional Doe fixture names).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attributionNoun, draftNoun, isDraft, isOfficialHome, isPosition, isRulingRecord, isWorkProduct, sourceKind } from './source-kind.ts';

const kind = (folder: string, name: string) => sourceKind({ folder, name });

test("a party's court papers are filings; the court's own records are not", () => {
  assert.equal(kind('07-Lawsuit', 'Complaint__20130514__Moe.pdf'), 'filing');
  assert.equal(kind('07-Lawsuit', 'Amended-Complaint__20131009__Moe.pdf'), 'filing');
  assert.equal(kind('07-Lawsuit', 'Motion-for-Site-Entry__20130626__Acme.pdf'), 'filing');
  assert.equal(kind('07-Lawsuit', 'Response-to-Motion__20130718__Moe.pdf'), 'filing');
  assert.equal(kind('07-Lawsuit/site-entry/as-filed', 'Proposed_Order__20130626__Acme.pdf'), 'filing');
  assert.equal(kind('07-Lawsuit/drafts', 'Complaint_FAC__20130228__Moe.docx'), 'filing');
  assert.equal(kind('10-Rulings', 'Order-Site-Entry__20130905__Court.pdf'), 'record');
  assert.equal(kind('07-Lawsuit/site-entry/order', 'Ruling__20130905__Court.pdf'), 'record');
  assert.equal(kind('07-Lawsuit', 'Summons__20130521__Moe.pdf'), 'record');
  assert.equal(kind('07-Lawsuit', 'Return-of-Service__20130603__Moe.pdf'), 'record');
  assert.equal(kind('10-Court-Procedural', 'Register_of_Actions__20131112.pdf'), 'record');
});

test('an exhibit is the underlying document, wherever it is filed', () => {
  assert.equal(kind('07-Lawsuit/site-entry/exhibits', 'Roof_Photo__20120419__Tally-Payroll.pdf'), 'record');
  assert.equal(kind('07-Lawsuit/site-entry', 'Exhibit_B__20130626__Acme.pdf'), 'record');
});

test('emails, letters and press items are kinds of their own; a side letter is an agreement', () => {
  assert.equal(kind('04-Letters', 'Email__20120417__Moe__Flashing-quote.pdf'), 'email');
  assert.equal(kind('05-Site-Visit', 'EML__20120522__Acme__Adjuster-visit.pdf'), 'email');
  assert.equal(kind('03-Office/saved', 'VendorMails.md'), 'email');
  assert.equal(kind('04-Letters', 'Letter__20120503__Dee__Repair-Dates.pdf'), 'letter');
  assert.equal(kind('04-Letters', 'Cover_Letter__20121114__Acme.pdf'), 'letter');
  assert.equal(kind('06-Vendor-Correspondence/hosting', 'Note__20120402__Cloudline.pdf'), 'letter');
  assert.equal(kind('06-Vendor-Correspondence/hosting', 'ATT__20120402__Cloudline__Invoice.pdf'), 'record');
  assert.equal(kind('01-Agreements', 'Side-Letter__20111012__Tally-Payroll.pdf'), 'record');
  assert.equal(kind('10-Background-Research/media', 'Tribune__20120511__Storm-coverage.pdf'), 'press');
});

test("the room's own notes and analysis are summaries", () => {
  assert.equal(kind('09-Room-Orientation', 'chronology.csv'), 'summary');
  assert.equal(kind('', 'CLAUDE.md'), 'summary');
  assert.equal(kind('11-Leak-Analysis', 'Moisture-Readings__20120606.pdf'), 'summary');
  assert.equal(kind('12-Building/Maps', 'Drain_Layout.md'), 'summary');
  assert.equal(kind('10-Background-Research', 'Spoilage_Rates.md'), 'summary');
});

test('evidence and unknown shapes are records; without a folder the name alone decides', () => {
  assert.equal(kind('01-Agreements', 'Service-Contract__20110809__Tally-Payroll.pdf'), 'record');
  assert.equal(kind('02-Bills', 'Permit-Filing__20110727__Harbor-Street.pdf'), 'record');
  assert.equal(kind('02-Bills', 'Receipt__20120418__Tally-Payroll.pdf'), 'record');
  assert.equal(sourceKind({ name: 'Motion-for-Site-Entry__20130626__Acme.pdf' }), 'filing');
  assert.equal(sourceKind({ name: 'Minutes__20110218__Copperline.pdf', folder: null }), 'record');
});

test('positions, drafts and the attribution wording', () => {
  assert.deepEqual((['record', 'filing', 'letter', 'email', 'press', 'summary'] as const).map(isPosition), [false, true, true, true, true, false]);
  assert.equal(isDraft({ folder: '07-Lawsuit/drafts', name: 'Complaint__x.docx' }), true);
  assert.equal(isDraft({ folder: '07-Lawsuit/as-filed', name: 'Complaint__x.pdf' }), false);
  assert.equal(attributionNoun(['filing']), "a party's filing");
  assert.equal(attributionNoun(['filing'], true), 'a draft filing');
  assert.equal(attributionNoun(['email', 'email']), 'an email');
  assert.equal(attributionNoun(['letter']), 'a letter');
  assert.equal(attributionNoun(['press']), 'a press report');
  assert.equal(attributionNoun(['email', 'filing']), 'the cited documents');
});

test('a DRAFT mark in the name makes a draft wherever it is filed; a lower-case subject word does not', () => {
  assert.equal(isDraft({ folder: '05-Site-Visit/Tally-Payroll', name: 'Complaint_FAC__20130222__Acme__Patch_Work_DRAFT.docx' }), true);
  assert.equal(isDraft({ name: 'Memo_MEM__20120305__Dee__Leak_Repair_DRAFT.pdf' }), true);
  assert.equal(isDraft({ folder: '04-Letters', name: 'EML__20120611__Draft_Patch_Estimate.pdf' }), false);
  assert.equal(isDraft({ folder: '05-Site-Visit', name: 'Drawing__20110926__Moe__Draftproof_Seals.pdf' }), false);
  assert.equal(draftNoun([{ name: 'Complaint_FAC__20130222__Acme__Patch_Work_DRAFT.docx' }]), 'a draft complaint');
  assert.equal(draftNoun([{ name: 'Amended_Complaint_FAC__20130912__Moe__Draft.docx' }]), 'a draft complaint');
  assert.equal(draftNoun([{ name: 'Motion-for-Site-Entry__x.docx' }, { name: 'Complaint__x.docx' }]), 'a draft filing');
  assert.equal(draftNoun([{ name: 'Notice__x_DRAFT.docx' }]), 'a draft filing');
  assert.equal(attributionNoun(['filing'], 'a draft complaint'), 'a draft complaint');
  assert.equal(attributionNoun(['letter'], 'a draft complaint'), 'a letter', 'only a filing takes the draft noun');
});

test('only a court record that carries a ruling supports a claim that a court ruled', () => {
  const ruling = (folder: string, name: string) => isRulingRecord({ folder, name });
  assert.equal(ruling('10-Rulings', 'Order-Site-Entry__20130905__Court.pdf'), true);
  assert.equal(ruling('10-Court-Procedural', 'Register_of_Actions__20131112.pdf'), true);
  assert.equal(ruling('07-Lawsuit/site-entry/order', 'Ruling__20130905__Court.pdf'), true);
  assert.equal(ruling('03-Title/public-records', 'Judgment_JDG__20131021__Acme.pdf'), true);
  assert.equal(ruling('10-Court-Procedural', 'Minute_Order__20131204.pdf'), true);
  assert.equal(ruling('07-Lawsuit', 'Summons__20130521__Moe.pdf'), false);
  assert.equal(ruling('07-Lawsuit', 'Return-of-Service__20130603__Moe.pdf'), false);
  assert.equal(ruling('07-Lawsuit', 'Certificate_of_Service__20130610__Moe.pdf'), false);
  assert.equal(ruling('07-Lawsuit/site-entry/as-filed', 'Proposed_Order__20130626__Acme.pdf'), false);
  assert.equal(ruling('03-Company-Records', 'Minutes__20110218__Copperline.pdf'), false);
  assert.equal(ruling('', 'Note.pdf'), false, 'a document that calls itself an order is not filed as one');
});

test('a file marked as work product is a summary; a privileged folder alone does not make one', () => {
  assert.equal(isWorkProduct({ name: 'Claim_Chart__WP__20130503.xlsx' }), true);
  assert.equal(isWorkProduct({ name: 'Memo__20130617__AC-WP.pdf' }), true);
  assert.equal(isWorkProduct({ name: 'Work_Product_Index.md' }), true);
  assert.equal(isWorkProduct({ name: 'Network_Product__20120314.pdf' }), false);
  assert.equal(kind('05-Site-Visit', 'Claim_Chart__WP__20130503.xlsx'), 'summary');
  assert.equal(kind('11-Leak-File/work-product', 'Stain-Source__20120719.md'), 'summary');
  assert.equal(kind('11-Memos', 'Stain-Source__20120719.md'), 'summary');
  assert.equal(kind('02-Site-PRIVILEGED/storage/unit-nine', 'Storage_Agreement__20110823__Moe.pdf'), 'record');
  assert.equal(kind('06-Insurer-PRIVILEGED/adjuster', 'EML__20130411__Site-Visit.pdf'), 'email');
});

test("the attribution wording names a letter's or email's writer when known", () => {
  assert.equal(attributionNoun(['letter'], false, "the other side's counsel"), "a letter from the other side's counsel");
  assert.equal(attributionNoun(['email', 'email'], false, 'the client'), 'an email from the client');
  assert.equal(attributionNoun(['filing'], false, 'the other side'), "a party's filing");
  assert.equal(attributionNoun(['email', 'letter'], false, 'the other side'), 'the cited documents');
});

test('official records live in public records, filings with a regulator, the court-procedural tab and the court record', () => {
  const home = (folder: string | null, name: string) => isOfficialHome({ folder, name });
  assert.equal(home('03-Title/public-records/County', 'Deed__20110518__Harbor-Street.pdf'), true);
  assert.equal(home('03-Title/regulatory-filings/Fire_Marshal', 'Permit_Renewal__20110905__Copperline.pdf'), true);
  assert.equal(home('10-Court-Procedural', 'Minute_Order__20131204.pdf'), true);
  assert.equal(home('07-Lawsuit/site-entry/order', 'Ruling__20130905__Court.pdf'), true);
  assert.equal(home(null, 'Order-Site-Entry__20130905__Court.pdf'), true, "the court's ruling record, by its name");
  assert.equal(home('07-Lawsuit', 'Summons__20130521__Moe.pdf'), true);
  assert.equal(home('05-Site-Visit', 'Note.pdf'), false);
  assert.equal(home(null, 'Note.pdf'), false);
  assert.equal(home('03-Company-Records', 'Minutes__20110218__Copperline.pdf'), false);
  assert.equal(home('03-Title/licenses', 'Certificate_of_Occupancy__20110331__City.pdf'), false, 'a name alone is not a filing place');
  assert.equal(home('03-Title/public-records-notes', 'Note.pdf'), false);
});
