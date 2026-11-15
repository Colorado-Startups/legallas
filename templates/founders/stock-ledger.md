---
id: founders/stock-ledger
title: Stock Ledger, with notice of uncertificated shares
kind: record
path: startup-forms
level: [colorado, delaware]
entity: [colorado-corporation, delaware-corporation]
statutes:
  - C.R.S. 7-106-206, 7-106-207(2), 7-106-208(2)
  - C.R.S. 7-116-101(3), (4)
  - 8 Del. C. 151(f), 158, 202(a)
  - 8 Del. C. 219(c), 224
source: Original drafting for Legallas from the statutes listed and first principles. No law firm's or company's form was read or adapted.
licence: CC0-1.0
date_checked: 2026-11-13
fields:
  - COMPANY_NAME
  - HOLDER_NAME
  - HOLDER_ADDRESS
  - NUMBER_OF_SHARES
  - SHARE_CLASS
  - ISSUE_DATE
  - AGREEMENT_NAME
  - AGREEMENT_DATE
  - NOTICE_DATE
---

# Stock Ledger, with notice of uncertificated shares

> Legallas is an AI agent for legal work, not a lawyer or law firm. Using it creates no attorney-client relationship. AI can be wrong. Have your own lawyer review before you sign, file or rely on anything.
>
> No lawyer has reviewed this template.

## Before you use this

Part 1 is the corporation's record of every issue and transfer of its shares. Part 2 is the notice each holder gets when shares issue without a certificate.
The [initial board consent](initial-board-consent.md) makes the shares uncertificated. The [capitalization table](capitalization-table.md) summarises this ledger.

| Rule | The law's words, read 2026-11-13 | Source |
|---|---|---|
| Colorado record | "shall maintain a record of the names and addresses of its shareholders, in a form that permits preparation of a list of shareholders that is arranged by voting group and within each voting group by class or series of shares" | [C.R.S. 7-116-101(3)][crs7] |
| Colorado form | "A corporation shall maintain its records in written form." | [C.R.S. 7-116-101(4)][crs7] |
| Delaware record | The stock ledger records "the names of all of the corporation's stockholders of record, the address and number of shares registered in the name of each such stockholder, and all issuances and transfers of stock" | [8 Del. C. 219(c)][del8sc7] |
| Delaware effect | "The stock ledger shall be the only evidence as to who are the stockholders entitled by this section to examine the list required by this section or to vote in person or by proxy at any meeting of stockholders." | [8 Del. C. 219(c)][del8sc7] |
| Delaware form | Electronic records are allowed if they convert "into clearly legible paper form within a reasonable time" | [8 Del. C. 224][del8sc7] |
| Colorado notice | "Within a reasonable time after the issuance or transfer of shares without certificates, the corporation shall send to the shareholder a written statement of the information required on certificates" | [C.R.S. 7-106-207(2)][crs7] |
| Delaware notice | "Within a reasonable time after the issuance or transfer of uncertificated stock, the registered owner thereof shall be given a notice, in writing or by electronic transmission" | [8 Del. C. 151(f)][del8sc5] |
| Colorado restriction | Enforceable if "contained in the information statement required by section 7-106-207 (2). Unless so noted, a restriction is not enforceable against a person without knowledge of the restriction." | [C.R.S. 7-106-208(2)][crs7] |
| Delaware restriction | Unless noted in the notice, a restriction is "ineffective except against a person with actual knowledge of the restriction" | [8 Del. C. 202(a)][del8sc6] |

The restriction line in Part 2 is what lets the repurchase right and right of first refusal in the [founder stock purchase agreement](founder-stock-purchase.md) bind a later buyer.

## The document

<!-- TEMPLATE START -->

**STOCK LEDGER OF {{COMPANY_NAME}}**

**Part 1. Ledger**

One row for each issue, transfer, repurchase or cancellation. Never edit a past row; add a correcting row.

| No. | Date | Holder name | Holder address | Class or series | Shares in (+) or out (-) | Holder's balance after | From or to | Price or other consideration | Approved by (consent and date) | Notice sent (date and how) |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | | | | | | | | | | |

Shares outstanding after the last row: __________

**Part 2. Notice of uncertificated shares**

Date: {{NOTICE_DATE}}

To {{HOLDER_NAME}}, {{HOLDER_ADDRESS}}:

[OPTION A: Colorado corporation.]
{{COMPANY_NAME}} is a corporation incorporated under the law of Colorado. Its records show {{HOLDER_NAME}} as the holder of {{NUMBER_OF_SHARES}} shares of
{{SHARE_CLASS}}, issued on {{ISSUE_DATE}} without a certificate. The corporation will furnish to the shareholder, on request in writing and without charge,
the designations, preferences, limitations and relative rights of each class and series of its shares.
[END OPTION A]

[OPTION B: Delaware corporation.]
{{COMPANY_NAME}} is a Delaware corporation. Its stock ledger shows {{HOLDER_NAME}} as the registered owner of {{NUMBER_OF_SHARES}} shares of {{SHARE_CLASS}},
issued on {{ISSUE_DATE}} as uncertificated stock. The corporation will furnish without charge to each stockholder who so requests the powers, designations,
preferences and relative, participating, optional or other special rights of each class of stock or series, and the qualifications, limitations or
restrictions of those preferences or rights.
[END OPTION B]

**Restrictions.** These shares are subject to transfer restrictions, a repurchase right and a right of first refusal under the {{AGREEMENT_NAME}} dated
{{AGREEMENT_DATE}}, a copy of which the Company will provide without charge on request. They have not been registered under the Securities Act of 1933 and may
not be sold without registration or an exemption.

For the corporation: ______________________________ Title: __________

Legallas template founders/stock-ledger version 1. Law checked 2026-11-13. Not reviewed by a lawyer. Have your own lawyer review. Delete this line before signing.

<!-- TEMPLATE END -->

**Example, invented.** Row 1: on 2027-01-08 Harbor Labs, Inc. issues 6,000,000 common shares to Doe for $600.00, approved by board consent the same day.
Row 2 issues 4,000,000 to a cofounder. Outstanding after row 2: 10,000,000. Each holder gets a Part 2 notice by email on 2027-01-11, filed as DOE-0044.

## Drafting notes

| Choice | Options | Recommendation and why | Where a lawyer should look |
|---|---|---|---|
| Certificates | Uncertificated; paper certificates | **Uncertificated,** with a Part 2 notice. Shares "may, but need not, be represented by certificates" ([C.R.S. 7-106-206(1)][crs7]); in Delaware the board resolves it ([8 Del. C. 158][del8sc5]) | Certificate signing: "any 2 authorized officers" in Delaware |
| Colorado electronic ledger | Paper or printable file; spreadsheet only | **A printed or exported copy on file after each change.** Colorado says "written form" for a corporation's records | Whether an electronic file meets "written form" |
| Notice timing | With the purchase agreement; later | **The same week.** Both statutes say "within a reasonable time" | |
| Class summary | Statement on request; full summary | **On request,** as both statutes allow, while there is one class | A full summary once preferred stock exists |
| Corrections | Edit the row; add a correcting row | **Add a row.** Delaware's ledger records "all issuances and transfers" | |

## What couldn't be checked

- **8 Del. C. 156, 218(a) and 364**, which 151(f) also names, weren't read. They cover partly paid shares, voting trusts and public benefit corporations.
- **"Article 8 of subtitle I of Title 6"**, which 224 names for recording transfers, wasn't read.

## Sources

Read 2026-11-13: [C.R.S. title 7][crs7] (2026 edition); 8 Del. C. chapter 1, [subchapter V][del8sc5], [subchapter VI][del8sc6] and [subchapter VII][del8sc7].

[crs7]: https://olls.info/crs/crs2026-title-07.docx
[del8sc5]: https://delcode.delaware.gov/title8/c001/sc05/index.html
[del8sc6]: https://delcode.delaware.gov/title8/c001/sc06/index.html
[del8sc7]: https://delcode.delaware.gov/title8/c001/sc07/index.html
