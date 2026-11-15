---
id: founders/capitalization-table
title: Capitalization Table
kind: record
path: startup-forms
level: [colorado, delaware]
entity: [colorado-llc, colorado-corporation, delaware-llc, delaware-corporation]
statutes:
  - C.R.S. 7-116-101(3), (4)
  - C.R.S. 7-80-408(1), (4)
  - 8 Del. C. 219(c), 224
  - 6 Del. C. 18-305(h)
source: Original drafting for Legallas from the statutes listed and first principles. No law firm's or company's form was read or adapted.
licence: CC0-1.0
date_checked: 2026-11-13
fields:
  - COMPANY_NAME
  - AS_OF_DATE
  - PREPARED_BY
---

# Capitalization Table

> Legallas is an AI agent for legal work, not a lawyer or law firm. Using it creates no attorney-client relationship. AI can be wrong. Have your own lawyer review before you sign, file or rely on anything.
>
> No lawyer has reviewed this template. This is arithmetic on the numbers you entered. It doesn't say whether the price is fair.

## Before you use this

One page of who holds what today, and what could be issued later. It summarises the legal record; it doesn't replace it.
A corporation's legal record is its [stock ledger](stock-ledger.md). An LLC's is its [member ledger](member-ledger.md). Keep all three in step.

| Entity | What the law says about the holder record, read 2026-11-13 | Source |
|---|---|---|
| Colorado corporation | "shall maintain a record of the names and addresses of its shareholders, in a form that permits preparation of a list of shareholders that is arranged by voting group and within each voting group by class or series of shares" | [C.R.S. 7-116-101(3)][crs7] |
| Colorado corporation | "A corporation shall maintain its records in written form." | [C.R.S. 7-116-101(4)][crs7] |
| Delaware corporation | The stock ledger records "the names of all of the corporation's stockholders of record, the address and number of shares registered in the name of each such stockholder, and all issuances and transfers of stock" | [8 Del. C. 219(c)][del8sc7] |
| Delaware corporation | An electronic ledger is allowed if it converts "into clearly legible paper form within a reasonable time" | [8 Del. C. 224][del8sc7] |
| Colorado LLC | A member may inspect "A current list of the name and last-known business, residence, or mailing address of each member and manager" | [C.R.S. 7-80-408(1)(c)][crs7] |
| Delaware LLC | "A limited liability company shall maintain a current record that identifies the name and last known business, residence or mailing address of each member and manager." | [6 Del. C. 18-305(h)][del6sc3] |

| Count | Holds | Use it for |
|---|---|---|
| Outstanding | Shares or units issued and not cancelled | Votes, the ledger, consents |
| Fully diluted | Outstanding, plus every option, warrant, note or SAFE that could convert, plus the unissued pool | Pricing a round, offer letters |

## The document

<!-- TEMPLATE START -->

**CAPITALIZATION TABLE OF {{COMPANY_NAME}}**

As of {{AS_OF_DATE}}. Prepared by {{PREPARED_BY}}.

[OPTION A: Corporation.]
Counted in shares. The stock ledger is the legal record; this table matches it.
[END OPTION A]

[OPTION B: LLC.]
Counted in units. The operating agreement's schedule of members is the legal record; this table matches it.
[END OPTION B]

**1. Classes authorised**

| Class or series | Authorised | Issued and outstanding | Source document and section |
|---|---|---|---|
| | | | |

**2. Holders of issued shares or units**

| Holder | Class | Number | Date issued | Price paid per share or unit | Vesting (schedule and start date) | Ledger or schedule line |
|---|---|---|---|---|---|---|
| | | | | | | |
| **Total outstanding** | | | | | | |

**3. Rights to acquire** (options, warrants, convertible notes, SAFEs, and the unissued pool)

| Holder or pool | Instrument | Number, or how it converts | Approved by and date | Document |
|---|---|---|---|---|
| | | | | |

**4. Ownership**

| Holder or pool | Number | Percent of outstanding | Percent fully diluted |
|---|---|---|---|
| | | | |
| **Total** | | 100% | 100% |

Each percentage is the row's number divided by the total of its column. Instruments whose conversion number isn't fixed yet are listed in Section 3 and left out of Section 4, with a note.

**5. Tie-out**

| Check | Done |
|---|---|
| Section 2 total equals the outstanding count in the stock ledger or the operating agreement's schedule | [ ] |
| Section 1 issued count isn't more than the authorised count | [ ] |
| Each issue in Section 2 has a board or member approval and a signed purchase or subscription document | [ ] |
| Each holder with vesting has a filing record for a section 83(b) election, or a note why none was filed | [ ] |

Legallas template founders/capitalization-table version 1. Law checked 2026-11-13. Not reviewed by a lawyer. Have your own lawyer review. Delete this line before signing.

<!-- TEMPLATE END -->

**Example, invented.** Harbor Labs, Inc. has 10,000,000 common shares authorised. Doe holds 6,000,000 and a cofounder 4,000,000; the board has set aside a 1,500,000 share pool that isn't issued.
Outstanding: Doe 60.00%, cofounder 40.00%. Fully diluted, 11,500,000 in all: Doe 52.17%, cofounder 34.78%, pool 13.04%. The table is filed in the room as DOE-0043.

## Drafting notes

| Choice | Options | Recommendation and why | Where a lawyer should look |
|---|---|---|---|
| Legal record or summary | This table alone; table plus ledger | **Both.** The ledger is the record the statutes name; this table is the summary investors ask for | Which record a stockholder may inspect |
| Unpriced instruments | In Section 4 at a guessed number; listed only in Section 3 | **Section 3 only,** with how each converts. A guessed number looks like a fact | Conversion terms in each note or SAFE |
| Pool | In fully diluted; left out | **In.** Investors count the pool in fully diluted | Whether the plan is adopted (the equity incentive plan is held back until a lawyer reviews it) |
| Tool | This table; a cap table service | **Either.** Keep one source and export it to the room on each change | |

## What couldn't be checked

- **Securities filings** that depend on holder counts weren't read here; see the [offering record](../raise/offering-record.md).

## Sources

Read 2026-11-13: [C.R.S. title 7][crs7] (2026 edition); [8 Del. C. chapter 1, subchapter VII][del8sc7]; [6 Del. C. chapter 18, subchapter III][del6sc3].

[crs7]: https://olls.info/crs/crs2026-title-07.docx
[del8sc7]: https://delcode.delaware.gov/title8/c001/sc07/index.html
[del6sc3]: https://delcode.delaware.gov/title6/c018/sc03/index.html
