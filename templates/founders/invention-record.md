---
id: founders/invention-record
title: Invention Record
kind: record
path: startup-forms
level: [federal]
entity: [colorado-llc, colorado-corporation, delaware-llc, delaware-corporation]
statutes:
  - 35 U.S.C. 116
  - 37 CFR 1.16(d)
source: Original drafting for Legallas from the statutes, rules and USPTO pages listed and first principles. No law firm's or company's form was read or adapted.
licence: CC0-1.0
date_checked: 2026-11-09
fields:
  - COMPANY_NAME
  - INVENTION_TITLE
  - RECORD_DATE
  - INVENTORS
  - PROBLEM_AND_SOLUTION
  - FIRST_DISCLOSURE
  - ASSIGNMENT_STATUS
---

# Invention Record

> Legallas is an AI agent for legal work, not a lawyer or law firm. Using it creates no attorney-client relationship. AI can be wrong. Have your own lawyer review before you sign, file or rely on anything.
>
> No lawyer has reviewed this template.

## Before you use this

A dated record of an invention, who made it and when it was first shown. A patent lawyer or agent uses it to decide whether
and when to file. It describes the invention before any filing, so limit who sees it; in the room, mark it privileged.

| Rule | The law's or the USPTO's words, read 2026-11-09 | Source |
|---|---|---|
| Joint inventors | "When an invention is made by two or more persons jointly, they shall apply for patent jointly and each make the required oath" | [35 U.S.C. 116(a)][us116] |
| Who counts | Inventors may apply jointly even though "(1) they did not physically work together or at the same time, (2) each did not make the same type or amount of contribution, or (3) each did not make a contribution to the subject matter of every claim of the patent" | [35 U.S.C. 116(a)][us116] |
| Grace period | "a provisional application can be filed up to 12 months following an inventor's public disclosure of the invention" | [Provisional application][prov] |
| Provisional's life | "a pendency lasting 12 months from the date the provisional application is filed". "The 12-month pendency period cannot be extended" | [Provisional application][prov] |

| Provisional filing fee | Amount | Rule |
|---|---|---|
| "By a small entity (§ 1.27(a))" | $130.00 | [37 CFR 1.16(d)][e116] |
| "By a micro entity (§ 1.29)" | $65.00 | [37 CFR 1.16(d)][e116] |
| "By other than a small or micro entity" | $325.00 | [37 CFR 1.16(d)][e116] |

- **Inventorship is a fact, not a title.** A founder who didn't contribute to a claim isn't an inventor; an engineer who did is.
  Errors can be corrected ([35 U.S.C. 116(c)][us116]).
- **Ownership is separate.** Each inventor assigns to the company in the [invention assignment](invention-assignment.md); record it with
  the [short-form assignment](ip-recordation.md).

## The document

<!-- TEMPLATE START -->

**INVENTION RECORD**

| | |
|---|---|
| Company | {{COMPANY_NAME}} |
| Working title | {{INVENTION_TITLE}} |
| Date of this record | {{RECORD_DATE}} |

**1. Inventors.** Each person who contributed to the idea, with what each contributed.

{{INVENTORS}}

**2. The problem and the solution.** What it does, how it works, and what is new. Attach sketches, code references or test results.

{{PROBLEM_AND_SOLUTION}}

**3. First disclosure.** The earliest date it was shown, sold, offered, published or demoed outside the company, and where. "None" if never.

{{FIRST_DISCLOSURE}}

**4. Assignment.** Whether each inventor has signed an invention assignment to the company.

{{ASSIGNMENT_STATUS}}

**5. Next step.**

[OPTION A: Send to a patent lawyer or agent. Recommended when anything was disclosed.]
The company sends this record to a registered patent practitioner before the 12-month date in Section 3 runs.
[END OPTION A]

[OPTION B: Keep as a trade secret.]
The company keeps the invention confidential and doesn't file. It limits who sees this record.
[END OPTION B]

Each inventor signs and dates below.

______________________________ Date: __________

______________________________ Date: __________

Legallas template founders/invention-record version 1. Law checked 2026-11-09. Not reviewed by a lawyer. Have your own lawyer review. Delete this line before signing.

<!-- TEMPLATE END -->

**Example, invented.** Doe and a Harbor Labs engineer build a sensor calibration method. Doe demos it at a meetup in March. The record shows both as inventors and starts the 12-month count from the demo.

## Drafting notes

| Choice | Options | Recommendation and why | Where a lawyer should look |
|---|---|---|---|
| Next step | A, file; B, trade secret | **A once anything was disclosed.** The grace period runs from the disclosure ([provisional page][prov]) | Foreign filing: many countries have no grace period |
| Fee tier | Small; micro; other | **Check the company's tier before paying.** $130.00 small, $65.00 micro, $325.00 other ([37 CFR 1.16(d)][e116]) | Whether a licence or an investor ends small entity status |
| Inventors listed | Everyone on the team; only contributors | **Only contributors,** each with what they added ([35 U.S.C. 116(a)][us116]) | Inventorship once claims are drafted |

## What couldn't be checked

- **Small and micro entity tests** (37 CFR 1.27 and 1.29) were not read.
- **35 U.S.C. 102** was read only as the USPTO's provisional page states it.
- **Foreign filing rules,** where public disclosure may bar a patent.

## Sources

Read 2026-11-09: [35 U.S.C. 116][us116] (current through Public Law 119-138); [37 CFR 1.16][e116] (eCFR, up to date as of 2026-11-05);
the [USPTO fee schedule][fees], row 1005/2005/3005 (last revised 2026-11-01); [Provisional application for patent][prov] (last updated 2023-12-15).

[us116]: https://uscode.house.gov/us/usc/t35/s116/
[e116]: https://www.ecfr.gov/current/title-37/section-1.16
[fees]: https://www.uspto.gov/learning-and-resources/fees-and-payment/uspto-fee-schedule
[prov]: https://www.uspto.gov/patents/basics/apply/provisional-application
