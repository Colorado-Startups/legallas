// SPDX-License-Identifier: Apache-2.0
// What a claim's words ask of its sources (fictional Doe fixture wording only).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claimsRuling, isEvaluative, NO_WORD, namesSource, PLEADING_OPENER, selfDescribedCourtRuling, selfDescribedOfficialRecord, selfDescribedWorkProduct } from './provenance.ts';

test('a claim that a court ruled is read as one, however it is put', () => {
  for (const claim of [
    'The court found the freezer invoice overstated by $1,204.17',
    'Yes, a court has ruled on the late deliveries',
    'Judge Smith granted the request to inspect the cooler on March 12, 2013',
    'the County Court (case no. CV-2013-88, Div. 2) entered a minute order finding the ticket genuine',
    'The motion to compel was granted on April 18, 2013',
    'the dishwasher lease agreement was declared invalid at the hearing',
    'it ends the walk-in freezer claim with a dismissal with prejudice',
    'The agreed schedule ends: IT IS SO ORDERED.',
    'The clerk entered judgment on the freezer invoice',
    // A case number that opens with letters, with no period after "No", is not a denial.
    'The Superior Court (C.A. No N99C-01-001 ABC) granted the motion to inspect the cooler',
  ]) {
    assert.equal(claimsRuling(claim), true, claim);
  }
});

test('record facts that only mention a court, a denial of any ruling, or a request for one are not rulings', () => {
  for (const claim of [
    'The adjuster approved the gutter estimate on October 9, 2012',
    'Copperline entered into the supply agreement with Harbor Labs',
    'The court has not ruled on the cooler claim',
    'No order granting the inspection appears in the register',
    'The log does not show that Judge Smith granted the inspection',
    'The motion asks the court to strike the temperature logs',
    "The Motion to Compel was filed 2013-02-19",
    'The lease rider calls for conversion to month-to-month by order granting possession',
    'The court held a hearing on April 11',
    'The complaint was filed in county court on June 4',
    'The judge assigned to the case is Judge Smith',
    'The schedule was framed for the county court matter, so its rules were designed for that case',
  ]) {
    assert.equal(claimsRuling(claim), false, claim);
  }
});

test('a characterization in the answer’s own voice is evaluative; a document’s words or a claim’s name are not', () => {
  for (const claim of [
    "Roe's late payment shows bad faith",
    'The email proves Roe knew of the cooler failure',
    'The late patch is a breach of section 4.1',
    'The repair ticket was backdated to July 2',
    'This demonstrates that Roe controlled the commissary',
  ]) {
    assert.equal(isEvaluative(claim), true, claim);
  }
  for (const claim of [
    'The warranty provides that coverage on a flooded roof is void',
    'Carol Count balanced the books on May 31, 2012',
    'The weather report shows rain on May 17',
    'The insurance policy covers claims for breach of warranty',
    'The motion alleges fraud by Mark Moe',
    'The file is labelled "Invoice Void" in the folder',
    'The draft complaint pleads breach of warranty',
    'The negligence claims were reviewed on August 23',
    "Doe's June 15 email (re: Notice of Entry) was addressed to Roe",
    'The repair log is on the last page of 03-Job-Records/logs/Repair-Log__20120405__Tally-Payroll.xlsx',
  ]) {
    assert.equal(isEvaluative(claim), false, claim);
  }
});

test('a claim that opens with its source already says where it comes from', () => {
  for (const claim of [
    'The email of May 1 was addressed to Moe',
    "Doe's own May 22, 2012 email to her lawyer corroborates the delivery count",
    'Dan Dee\'s June 2013 responses, as summarized in the case picture, confirm the crew left by noon',
    'Per the case picture, the invoice is due September 6',
    'Nothing in the retrieved passages shows a repair',
    'A May 7, 2012 supplier email listed three delivery dates',
    'In his August letter, Roe set out the late deliveries',
    'According to Roe, the cafe closed',
    'The job memo states the patch covers the north gutter',
  ]) {
    assert.equal(namesSource(claim), true, claim);
  }
  for (const claim of [
    'The cafe closed after the notice was sent',
    'Tally Payroll sent no letters that week',
    'The gutters were replaced in 2012',
    'The lease provides a 14-day cure',
    'Moe was on the thread: the email was addressed to him',
    'The prior case was dismissed on March 8; the email was sent the next day',
  ]) {
    assert.equal(namesSource(claim), false, claim);
  }
});

test('a pleading attribution at the start of a claim is found with its "that"', () => {
  const cases: [string, string][] = [
    ['The amended complaint alleges that the roof inspection took two hours', 'the roof inspection took two hours'],
    ['The complaint alleges, on information and belief, that Roe leased the freezer', 'Roe leased the freezer'],
    ['The amended complaint pleads Roe leased it', 'Roe leased it'],
  ];
  for (const [claim, rest] of cases) {
    const match = PLEADING_OPENER.exec(claim);
    assert.ok(match, claim);
    assert.equal(claim.slice(match[0].length), rest);
  }
  assert.equal(PLEADING_OPENER.exec("Moe's letter alleges that the roof inspection took two hours"), null);
});

test('a passage that labels itself counsel’s work product is found; the doctrine named in an agreement is not', () => {
  for (const text of [
    "PRIVILEGED AND CONFIDENTIAL. ATTORNEY WORK PRODUCT. Note to file from plaintiff's counsel, June 30, 2013.",
    '# Work Product / Attorney-Client Privileged. Doe v. Roe.',
    'MEMORANDUM TO FILE. Re: cooler repair.',
    "Counsel's notes on the call of April 9",
    'CLAIM CHART. ATTORNEY WORK PRODUCT - PRIVILEGED - PREPARED AT DIRECTION OF COUNSEL',
  ]) {
    assert.equal(selfDescribedWorkProduct(text), true, text);
  }
  for (const text of [
    'the hearing officer shall apply all relevant privileges and the attorney work product doctrine',
    'a supplier that objects based on attorney/client privilege, work product protection, or any other privilege',
    '"Menu Items" means all recipes, work product and other materials delivered to Client',
    'This message may contain confidential information.',
  ]) {
    assert.equal(selfDescribedWorkProduct(text), false, text);
  }
});

test('a passage that presents itself as an official record is found; one that refers to or denies such a record is not', () => {
  for (const text of [
    'STATE OF MAINE, DEPARTMENT OF STATE. CERTIFICATE OF FACT. I, the Secretary of State of the State of Maine, hereby certify that Roe Commissary, LLC is DELINQUENT.',
    'CERTIFICATE OF GOOD STANDING. Moe Produce, Inc. is in good standing.',
    'I, Nina Note, as the Secretary of State of the State of Maine, do certify that the attached is a true copy.',
    'Filing Receipt. Document number 20110417. Copperline Restaurant Group, Inc.',
    'FILED in the office of the Secretary of State, March 1, 2011.',
    'STATE OF MAINE DIVISION OF FOOD SAFETY. Re: Roe Commissary, LLC.',
    'UNITED STATES SECURITIES AND EXCHANGE COMMISSION Washington, D.C. 20549 Records request for the Harbor Street Grill',
    "COUNTY COURT. MINUTE ORDER (Clerk's entry). The Court FINDS the dishwasher lease ENDED.",
    'The spoilage claims against Moe are dismissed with prejudice. IT IS SO ORDERED.',
    'Dated May 1, 2013. BY THE COURT: County Court Judge',
    'C.A. No N99C-01-001 ABC MINUTE ORDER The Court FINDS the dishwasher lease ENDED.',
  ]) {
    assert.equal(selfDescribedOfficialRecord(text), true, text);
  }
  for (const text of [
    'At signing, the Supplier shall deliver a certificate of good standing for the Company.',
    'The Articles of Organization were filed with the Secretary of State on March 1, 2011.',
    'THERE IS NO CERTIFICATE OF GOOD STANDING ON FILE FOR THE COMMISSARY.',
    'No filing receipt was ever issued for the registered name.',
    'THESE GIFT CARDS HAVE NOT BEEN APPROVED OR DISAPPROVED BY THE UNITED STATES SECURITIES AND EXCHANGE COMMISSION.',
    'The undersigned, Secretary of Roe Commissary, LLC, hereby certifies that the attached repair budget was adopted.',
    'I hereby certify that on May 1, 2013 I filed the foregoing with the Clerk of Court.',
    'INSPECTION REPORT OF THE SAFETY COMMITTEE OF COPPERLINE RESTAURANT GROUP, INC. RESULT, the fire exits are clear.',
    'The managers asked whether a minute order had issued.',
    'Case no longer active, and there was no minute order.',
  ]) {
    assert.equal(selfDescribedOfficialRecord(text), false, text);
  }
});

test('a passage that presents itself as a court order is found; one that discusses, requests or denies an order is not', () => {
  const orders = [
    "DISTRICT COURT, EXAMPLE COUNTY, MAINE. Case No. CV-2013-00041, Div. 1. ORDER RE: DEFENDANT'S MOTION TO COMPEL. The Court GRANTS the Motion in full. SO ORDERED this 1st day of January, 2013. Ann Smith, District Court Judge.",
    'IN THE SUPERIOR COURT OF EXAMPLE COUNTY\nCase Number: 12-000417\nMINUTE ORDER\nThe produce claim is dismissed without prejudice.',
    'Civil Action No. 1:12-cv-00417\nIT IS HEREBY ORDERED that the inspection may proceed.\nBY THE COURT:\nA. Smith',
    'UNITED STATES BANKRUPTCY COURT FOR THE DISTRICT OF EXAMPLE. Case No. 12-10417. The Court hereby converts the Moe Produce case to chapter 7.',
    // "if" or "whether" before its words, and a case number without a period, do not hide an order.
    'As if issued by the DISTRICT COURT, EXAMPLE COUNTY Case No 13-CV-00041 ORDER RE: COSTS whether or not The Court GRANTS the Motion',
    // Numbers that open with letters, in the forms Delaware's trial courts print (fictional numbers).
    'IN THE SUPERIOR COURT OF THE STATE OF DELAWARE\nC.A. No. N99C-01-001 ABC CCLD\nORDER GRANTING THE MOTION TO COMPEL',
    'SUPERIOR COURT Case No S99A-01-001 XYZ ORDER RE: COSTS. The Court GRANTS the Motion.',
    'C.A. No N99C-01-001 ABC\nIT IS SO ORDERED.',
    'Docket No. CV-2013-00041\nIT IS SO ORDERED.',
    'C.A. No. 2099-0001-ABC\nIT IS SO ORDERED.',
  ];
  const others = [
    'The county court has not ruled on the motion; no order has entered in Case No. CV-2013-00041.',
    'Plaintiff asks that the Court grant the inspection. DISTRICT COURT, EXAMPLE COUNTY. Case No. CV-2013-00041.',
    'The parties consent to the jurisdiction of the County Court for any dispute under this Supply Agreement.',
    'Judge Smith ordered the parties to inspect the cooler, Doe wrote in her email of May 3.',
    'DISTRICT COURT, EXAMPLE COUNTY. Case No. CV-2013-00041. PLAINTIFF\'S RESPONSE TO THE MOTION TO COMPEL.',
    'ORDER RE: catering for the wedding dinner. The committee GRANTS the request for a larger room.',
    'No order has entered in C.A. No. N99C-01-001 ABC.',
    'C.A. No. N99C-01-001 ABC. PLAINTIFF\'S RESPONSE TO THE MOTION TO COMPEL.',
    // "No" that is a word beside words that are not a number: a denial still, and no case number.
    'SUPERIOR COURT. There is no ORDER RE: COSTS, and no order granting the motion.',
    'Case no longer pending. The committee wrote SO ORDERED on the minutes.',
    'Docket number pending. IT IS SO ORDERED is what the clerk would write.',
  ];
  for (const text of orders) assert.equal(selfDescribedCourtRuling(text), true, text);
  for (const text of others) assert.equal(selfDescribedCourtRuling(text), false, text);
});

test('"No." is the label of a number only when a digit-bearing number follows it (#51)', () => {
  const denial = new RegExp(String.raw`^${NO_WORD}\b`, 'i');
  for (const label of ['No. 12', 'No.12', 'No: 12', 'No #12', 'No 12', 'No. CV-2013-00041', 'No N99C-01-001 ABC', 'no. 2099-0001-ABC']) {
    assert.doesNotMatch(label, denial, label);
  }
  for (const word of ['No. Order granting the motion', 'No. The court has not ruled', 'no order', 'no longer', 'No.']) {
    assert.match(word, denial, word);
  }
});

test('a "No." that ends a sentence never hides the next sentence\'s ruling, nor a case number\'s claim', () => {
  for (const claim of [
    'The court answered No. Then it granted the stay',
    'Judge Smith said No. Order granting the motion followed on March 12, 2013',
    'The court in Case No. 13 granted the motion',
    'The court in Case No.13 granted the motion',
    'The court in Case No #13 granted the motion',
    'The court in Case No: 13 granted the motion',
  ]) {
    assert.equal(claimsRuling(claim), true, claim);
  }
  // A denial in the ruling's own sentence still denies it.
  assert.equal(claimsRuling('Asked again, the court has not ruled. It has not granted the stay'), false);
});

test('a "No:", "No #", quoted "No." or "No." before a non-space stays a label, so no ruling or order hides behind it', () => {
  for (const claim of [
    'The court said "No." and then granted the stay',
    'The court said \u201cNo.\u201d Then it granted the stay',
    'The court (answer: No.) granted the stay',
    'The court in Case No.CV/13 granted the motion',
    'The court in Case No: CV/13 granted the motion',
    'Judge Smith (Docket No: unassigned) granted the stay',
    'The court in Case No #CV/13 granted the motion',
    'The motion in Case No: pending was granted',
    'The court said no! It granted the stay',
  ]) {
    assert.equal(claimsRuling(claim), true, claim);
  }
  for (const text of [
    'DISTRICT COURT, EXAMPLE COUNTY Ref No #DOE BY THE COURT: The motion is granted',
    'DISTRICT COURT, EXAMPLE COUNTY Ref No #A/1 IT IS SO ORDERED',
    'DISTRICT COURT Docket No # TBD The Court GRANTS the Motion',
  ]) {
    assert.equal(selfDescribedCourtRuling(text), true, text);
  }
  for (const text of ['Ref No #ABC MINUTE ORDER', 'File No #X CERTIFICATE OF GOOD STANDING']) assert.equal(selfDescribedOfficialRecord(text), true, text);
});

test('an abbreviation\'s period does not end the sentence, so the denial before it still counts', () => {
  for (const claim of [
    'The court has not yet, as of Jan. 5, 2013, ruled on the motion',
    'The court has not, in Doe v. Harbor Labs, granted the stay',
    'The judge has never, per Mr. Doe, ruled',
    'Judge J. Smith has not ruled',
    'The court has not, under Cal. Civ. Code, ruled',
    'The court has not, per Hon. Doe, ruled',
  ]) {
    assert.equal(claimsRuling(claim), false, claim);
  }
});
