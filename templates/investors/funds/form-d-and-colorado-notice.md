---
id: investors/funds/form-d-and-colorado-notice
title: Form D and the Colorado notice filing
path: vcs-invest
kind: checklist
level: [federal, colorado, delaware]
entity: [fund-lp, fund-llc]
statutes:
  - 17 CFR 230.503 (Form D)
  - 17 CFR 239.500 (the form)
  - 17 CFR 232.10 and Regulation S-T (EDGAR access)
  - 15 U.S.C. 77r(c)(2) (state notice filings for covered securities)
  - C.R.S. 11-51-308(1)(p), 11-51-707; 3 CCR 704-1, Rule 51-3.7 (Colorado notice)
  - Delaware Securities Act Rules (Delaware notice and fee); 6 Del. C. 73-208
  - 17 CFR 230.507
source: Original drafting for Legallas from the rules listed and the agencies' filing pages as recorded in the design map.
licence: CC0-1.0
date_checked: 2026-11-01
fields:
  first_sale_date: The date the first investor became irrevocably contractually committed (the Form D instructions' definition)
  related_persons: The general partner, its managing members, the investment manager and its executive officers, and promoters
  exemption_boxes: The exemptions checked in Item 6 (for example, Rule 506(b) and Investment Company Act 3(c)(1))
  offering_amount: Total offering amount, or "indefinite"
  states_sold: The states where investors live
  sales_compensation: Anyone paid for sales, with their broker number, or "none"
---

# Form D and the Colorado notice filing

**Legallas is an AI agent for legal work, not a lawyer or law firm. Using it creates no attorney-client relationship. AI can be wrong. Have your own lawyer review before you sign, file or rely on anything. No lawyer has reviewed this.** Legallas prepares the values and steps; a
person signs and files.

## In one screen

Form D is a short public notice the issuer files with the SEC within 15 days after its first sale in a Regulation D
offering ([17 CFR 230.503][e503]). There is no SEC fee. States then require a copy, a fee and consent to service through
the national electronic filing system run by the North American Securities Administrators Association (NASAA), by state deadlines that usually match the federal one. Colorado's
rule requires the notice and fee no later than the federal deadline, and an amendment each year while the offering
continues ([3 CCR 704-1, Rule 51-3.7][ccr]). Plan EDGAR access weeks ahead: the first filing needs a notarized form and
SEC review.

## Steps

| Step | What | Who | Notes |
|---|---|---|---|
| 1. Access to EDGAR, the SEC's filing system | Form ID, with a notarized authentication document, on the SEC's filer management site | The authorized person, under their own Login.gov account with multi-factor sign-in | SEC staff review it; allow lead time before the first sale. The issuer receives an SEC identification number (CIK) and access codes |
| 2. Gather the facts | Issuer details; related persons (`{{related_persons}}`); exemptions (`{{exemption_boxes}}`); amount (`{{offering_amount}}`); sales compensation (`{{sales_compensation}}`); investor counts; date of first sale (`{{first_sale_date}}`) | Legallas prepares | For a fund, Item 6 includes the Investment Company Act exclusion box |
| 3. Approve | The signer reviews every value | The signer | Nothing is filed without approval |
| 4. File Form D on EDGAR | Online form or upload | The signer, under their own login | Due 15 days after the first sale; if the 15th day is a weekend or holiday, the next business day |
| 5. State notices | Through the NASAA electronic filing system, after EDGAR accepts the Form D: each state in `{{states_sold}}` | A person, on the system's own site | The system's terms bar automated filing, and it has a human check |
| 6. Pay | System fee plus each state's fee, by bank transfer | The person filing | Colorado and Delaware amounts below |
| 7. Calendar | Annual amendment while the offering continues; amendments for material changes | Legallas reminds | Federal and Colorado |

## Fees and deadlines, Colorado and Delaware

| | Colorado | Delaware |
|---|---|---|
| Deadline | No later than the federal Form D deadline ([Rule 51-3.7][ccr]) | No later than 15 days after the first sale in Delaware ([Delaware Securities Act Rules][derules]) |
| Fee | The issuer files a notification "and pay an exemption fee to be determined and collected pursuant to section 11-51-707" ([C.R.S. 11-51-308(1)(p)][t11], read 2026-11-09). "The division shall set the amount of each fee" ([11-51-707(3)(a)][t11]). Rule 51-3.7 says only "by paying a filing fee" ([3 CCR 704-1][ccr], read 2026-11-09). The [Division's fee table][fees] lists "Regulation D Exemptions" at $50 (read 2026-11-12) | One half of 1% of the maximum offering amount in Delaware, at least $200 and at most $1,000 ([Delaware Securities Act Rules][derules]; [6 Del. C. 73-208][d73s2]) |
| Annual filing | An amendment on or before each anniversary while the offering continues ([Rule 51-3.7][ccr]) | Check the rules for renewal |
| System fee | The national system charges its own fee per filing, reported as $160 (secondary) | Same |

## When to amend Form D

- At least once a year, on or before the anniversary of the last filing, while the offering continues.
- To correct a material mistake of fact or error.
- For certain changes in the information given, such as a change in the offering amount beyond stated tolerances, new
  related persons, or a change in sales compensation; some changes don't need an amendment ([Rule 503][e503]).

Legallas template investors/funds/form-d-and-colorado-notice version 1. Law checked 2026-11-01. Not reviewed by a lawyer. Have your own lawyer review. Delete this line before signing.

## Drafting notes

### Choice: file Form D at all?

Filing Form D is not a condition of the Rule 506 exemption, but it is required by the rule, and a court order for not
filing bars future use of Regulation D ([17 CFR 230.507][e507]). States also expect it. **Recommendation:** always file,
on time.

### Choice: the offering amount

**Recommendation:** state the fund's target or maximum, or "indefinite" for an open-ended raise, and amend when the
amount changes beyond what the form allows.

**Where a lawyer should look:** related persons and sales compensation entries; whether any placement agent is registered.

## Sources

Primary:

- [17 CFR 230.503][e503]; [230.507][e507]; [239.500][e239]
- [15 U.S.C. 77r][us77r]
- [3 CCR 704-1][ccr], Rule 51-3.7
- [C.R.S. 11-51-308(1)(p), 11-51-707(3)][t11], read 2026-11-09
- [Division of Securities, Forms and Fees][fees], read 2026-11-12
- [3 CCR 704-1][ccr], Rule 51-3.7, current version, read 2026-11-09
- Colorado fees, crowdfunding and interpretive opinions: [Colorado securities filings and fees](../../raise/colorado-securities-filings.md)
- [Delaware Securities Act Rules][derules]; [6 Del. C. 73-208][d73s2]

Filing pages (agency pages, read through the design map, not opened from this session):

- [SEC Form D][formd]; [NASAA electronic filing depository][efd]

## What couldn't be verified

- The system's $160 fee comes from a secondary source.
- The Form D item list and amendment details are from the design map's reading of the SEC's pages and the rule; the
  SEC's form instructions couldn't be opened from this session.
- Whether Delaware requires a yearly renewal of a Rule 506 notice wasn't settled.

[e503]: https://www.ecfr.gov/current/title-17/section-230.503
[e507]: https://www.ecfr.gov/current/title-17/section-230.507
[e239]: https://www.ecfr.gov/current/title-17/section-239.500
[us77r]: https://uscode.house.gov/us/usc/t15/s77r/
[ccr]: https://www.coloradosos.gov/CCR/DisplayRule.do?action=ruleinfo&ruleId=2207
[t11]: https://olls.info/crs/crs2026-title-11.htm
[derules]: https://regulations.delaware.gov/AdminCode/title6/Rules
[d73s2]: https://delcode.delaware.gov/title6/c073/sc02/index.html
[formd]: https://www.sec.gov/files/formd.pdf
[efd]: https://www.nasaaefd.org/
[fees]: https://securities.colorado.gov/division-of-securities-forms-and-fees
