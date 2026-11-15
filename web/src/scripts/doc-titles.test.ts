// SPDX-License-Identifier: Apache-2.0
// Card Q2 (R64). Readable titles from filename DocTypes: generic legal types only, fixture names only.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { docTitle, docTypeTitle } from './doc-titles.ts';

test('docTypeTitle spells out the abbreviations the owner named', () => {
  assert.equal(docTypeTitle('Order Compel'), 'Order compelling discovery');
  assert.equal(docTypeTitle('WP'), 'Work product');
  assert.equal(docTypeTitle('Order MTD'), 'Order on the motion to dismiss');
  assert.equal(docTypeTitle('Response to MTD'), 'Response to motion to dismiss', 'a code after "to" is part of the type');
  assert.equal(docTypeTitle('RFP'), 'Requests for production');
  assert.equal(docTypeTitle('NDA'), 'Nondisclosure agreement');
});

test('docTypeTitle drops the file Abbr when it is only the file code', () => {
  assert.equal(docTypeTitle('Operating_Agreement_OA'), 'Operating agreement', 'initials');
  assert.equal(docTypeTitle('Email_EML'), 'Email', 'the code repeats the type');
  assert.equal(docTypeTitle('Memo_MEM'), 'Memo');
  assert.equal(docTypeTitle('Order_Compel_OC'), 'Order compelling discovery');
  assert.equal(docTypeTitle('Exhibit_B_EB'), 'Exhibit B', 'a single capital stays');
  assert.equal(docTypeTitle('Delivery_Schedule_XQZ'), 'Delivery schedule', 'an unknown code is the file code');
  assert.equal(docTypeTitle('Complaint_FAC'), 'First amended complaint', 'the code names a more specific form');
});

test('docTypeTitle turns filename Title Case into sentence case and leaves written types alone', () => {
  assert.equal(docTypeTitle('Operating Agreement'), 'Operating agreement');
  assert.equal(docTypeTitle('Repair-Ticket'), 'Repair ticket');
  assert.equal(docTypeTitle('W-9'), 'W-9');
  assert.equal(docTypeTitle('Claim Chart (work product)'), 'Claim chart (work product)');
  assert.equal(docTypeTitle('Letter from outside counsel'), 'Letter from outside counsel', 'already written as prose');
  assert.equal(docTypeTitle('email'), 'Email');
  assert.equal(docTypeTitle('  '), '');
});

test('docTitle reads the filename convention: type, then parties and qualifiers, no dates', () => {
  assert.equal(docTitle('Order-Compel__20130924__Court.pdf'), 'Order compelling discovery, Court');
  assert.equal(docTitle('Order-MTD__20130813__Court.pdf'), 'Order on the motion to dismiss, Court');
  assert.equal(docTitle('Response-to-MTD__20130617__Moe.pdf'), 'Response to motion to dismiss, Moe');
  assert.equal(docTitle('Service_Contract_SC__20110809__Tally-Payroll__Final.pdf'), 'Service contract, Tally Payroll, Final');
  assert.equal(docTitle('Complaint_FAC__20131021__Moe__Second-Copy.pdf'), 'First amended complaint, Moe, Second Copy');
  assert.equal(docTitle('Email__20120621__Moe__Gutter-quote.pdf'), 'Email, Moe, Gutter quote');
  assert.equal(docTitle('Deposition-Transcript__20130408__Acme.pdf'), 'Deposition transcript, Acme');
  assert.equal(docTitle('Invoice-Register__20110907-20111130__Fall-Range.pdf'), 'Invoice register, Fall Range');
  assert.equal(docTitle('Statement__201109__Moe.pdf'), 'Statement, Moe', 'a month stamp is a date');
  assert.equal(docTitle('W-9__2011__Tally-Payroll.pdf'), 'W-9, Tally Payroll', 'a year stamp is a date');
  assert.equal(docTitle('Moisture-Analysis__20120925.pdf'), 'Moisture analysis', 'a type and a date only');
});

test('hyphens and underscores inside the DocType read as spaces before abbreviations map (F9 fixtures)', () => {
  assert.equal(docTypeTitle('Amended-Complaint'), 'Amended complaint');
  assert.equal(docTypeTitle('Amended_Complaint'), 'Amended complaint');
  assert.equal(docTypeTitle('Order-Compel'), 'Order compelling discovery');
  assert.equal(docTypeTitle('Order_MTD'), 'Order on the motion to dismiss');
  assert.equal(docTypeTitle('Response-to-MTD'), 'Response to motion to dismiss');
  assert.equal(docTitle('Amended-Complaint__20131009__Moe.pdf'), 'Amended complaint, Moe');
  assert.equal(docTitle('Return-of-Service__20130603__Moe.pdf'), 'Return of service, Moe');
});

test('docTitle shows a work-product marker as part of the type', () => {
  assert.equal(docTitle('Claim-Chart__WP__20130710.xlsx'), 'Claim chart (work product)');
  assert.equal(docTitle('Claim_Chart__AC-WP__20130812.xlsx'), 'Claim chart (work product)');
});

test('docTitle leaves names outside the convention alone but for the extension', () => {
  assert.equal(docTitle('notes_from_call.md'), 'notes from call');
  assert.equal(docTitle('README'), 'README');
  assert.equal(docTitle('Letter_LTR.pdf'), 'Letter LTR', 'no "__", so no convention');
});
