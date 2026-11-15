---
id: founders/delaware-franchise-tax
title: Delaware Franchise Tax Estimate Worksheet
kind: record
path: startup-forms
level: [delaware]
entity: [delaware-corporation]
statutes:
  - 8 Del. C. 502(a)
  - 8 Del. C. 503(a), (b), (c), (c)(4), (d), (i)
  - 8 Del. C. 504(a), (c)
  - 8 Del. C. 510
source: Original drafting for Legallas from the statutes and Division of Corporations pages listed, and first principles. No law firm's or filing service's form was read or adapted.
licence: CC0-1.0
date_checked: 2026-11-13
fields:
  - COMPANY_NAME
  - TAX_YEAR
  - DUE_DATE
  - AUTHORIZED_SHARES
  - PAR_VALUE
  - ISSUED_SHARES
  - GROSS_ASSETS
  - AUTHORIZED_SHARES_TAX
  - ASSUMED_PAR
  - ASSUMED_PAR_VALUE_CAPITAL
  - APVC_TAX
  - TAX_DUE
---

# Delaware Franchise Tax Estimate Worksheet

> Legallas is an AI agent for legal work, not a lawyer or law firm. Using it creates no attorney-client relationship. AI can be wrong. Have your own lawyer review before you sign, file or rely on anything.
>
> No lawyer has reviewed this template. This shows the tax law with its source, read by AI. You aren't receiving tax advice from a licensed tax professional. Have your own tax professional review before you file, elect or pay.

## Before you use this

Every Delaware corporation files an annual report and pays franchise tax by March 1. The tax is the lesser of two methods. A startup with millions of authorized shares often gets a large bill under the first method and pays far less under the second. This worksheet runs both before the online filing.

| Rule | The law's or the Division's words, read 2026-11-13 | Source |
|---|---|---|
| When | "Annually on or before March 1, every corporation" "shall make an annual franchise tax report to the Secretary of State" | [8 Del. C. 502(a)][del8c5] |
| Which method | "whichever of the applicable amounts prescribed by paragraphs (a)(1) and (a)(2) of this section is the lesser" | [503(a)][del8c5] |
| Authorized shares | "where the authorized capital stock does not exceed 5,000 shares, $175; where the authorized capital stock exceeds 5,000 shares, but is not more than 10,000 shares, $250; and the further sum of $85 on each 10,000 shares or part thereof" | [503(a)(1)][del8c5] |
| Assumed par value capital | "add $400 for each $1,000,000 or fraction thereof in excess of $1,000,000 of an assumed par value capital, found by multiplying the number of authorized shares of capital stock having par value by the quotient resulting from dividing the amount of the total assets of the corporation" "by the total number of issued shares" | [503(a)][del8c5] |
| Under $1,000,000 | "the amount that bears the same relation to $400 that the amount of the assumed par value capital bears to $1,000,000" | [503(a)][del8c5] |
| Without the figures | Without issued shares and total gross assets on the report, the tax is "computed in the manner prescribed by paragraph (a)(1)" | [503(b)][del8c5] |
| Limits | (a)(1): not "more than $200,000 nor less than $175"; (a)(2): not "more than $200,000 nor less than $400" | [503(c)][del8c5] |
| Large corporate filer | "the Secretary of State shall fix the annual franchise tax for such taxable year at $250,000." It applies where the tax "would otherwise be $200,000" and the corporation "Had a class or series of stock listed on a national securities exchange" and meets the revenue and asset tests in 503(c)(2). A startup with no listed stock is outside it | [503(c)(1), (2), (4)][del8c5] |
| Part year | "shall be prorated for the portion of the year during which the corporation was in existence" | [503(d)][del8c5] |
| Gross assets | "Total Gross Assets shall be those “total assets” reported on the U.S. Form 1120, Schedule L" | [Calculation page][frtaxcalc] |
| Steps | "Divide your total gross assets by your total issued shares carrying to 6 decimal places." Then the capital is "rounded up to the next million if it is over $1,000,000" | [Calculation page][frtaxcalc] |
| $5,000 or more | 40% June 1, 20% September 1, 20% December 1, the rest March 1 | [504(a)][del8c5] |
| Late | The report late: "the corporation shall pay the sum of $200". Tax late: interest "for each month or portion thereof until fully paid" | [502(a)][del8c5]; [504(c)][del8c5] |
| Report fee and rate | "For an Annual Report or Amended Annual Report for non-exempt domestic corporations the filing fee is $50." "Interest at 1.5% per month is applied to any unpaid tax balance." | [Franchise tax page][corpfr] |
| How | "Delaware has mandated electronic filing of domestic corporations Annual Reports." | [Franchise tax page][corpfr] |
| A year unpaid | "the charter of the corporation shall be void" | [510][del8c5] |

## The document

<!-- TEMPLATE START -->

**DELAWARE FRANCHISE TAX ESTIMATE FOR {{COMPANY_NAME}}, TAX YEAR {{TAX_YEAR}}**

Report and tax due: {{DUE_DATE}}.

**Part 1. Figures, at the end of the tax year**

| Figure | Amount | From |
|---|---|---|
| Authorized shares, all classes | {{AUTHORIZED_SHARES}} | Certificate of incorporation |
| Par value per share | {{PAR_VALUE}} | Certificate of incorporation |
| Issued shares, treasury shares included | {{ISSUED_SHARES}} | Stock ledger |
| Total gross assets | {{GROSS_ASSETS}} | Form 1120, Schedule L, or the balance sheet |

**Part 2. Authorized shares method**

| Step | Amount |
|---|---|
| 5,000 shares or fewer: $175. 5,001 to 10,000: $250 | |
| Each further 10,000 shares or part: $85 × __________ | |
| Tax, at least $175 and at most $200,000 ($250,000 for a large corporate filer) | {{AUTHORIZED_SHARES_TAX}} |

**Part 3. Assumed par value capital method**

| Step | Amount |
|---|---|
| Assumed par: gross assets ÷ issued shares, to 6 decimal places | {{ASSUMED_PAR}} |
| Shares with par below the assumed par × the assumed par | |
| Shares with par above the assumed par × their par | |
| Assumed par value capital, the two rows added | {{ASSUMED_PAR_VALUE_CAPITAL}} |
| Over $1,000,000: $400 per million, rounded up. Under: $400 × capital ÷ $1,000,000 | |
| Tax, at least $400 and at most $200,000 ($250,000 for a large corporate filer) | {{APVC_TAX}} |

**Part 4. What to pay**

| Item | Amount |
|---|---|
| Lesser of Part 2 and Part 3 | {{TAX_DUE}} |
| Prorated, if the company existed only part of the year | |
| Annual report fee | $50 |
| $5,000 or more next year: instalments June 1, September 1, December 1 | Yes / No |

**Part 5. Filing record**

| Step | Done | Date | Proof |
|---|---|---|---|
| Issued shares and gross assets entered on the report | [ ] | __________ | Screenshot |
| Report filed and paid online | [ ] | __________ | Receipt |
| Director names and addresses current on the report | [ ] | __________ | |

Legallas template founders/delaware-franchise-tax version 1. Law checked 2026-11-13. Not reviewed by a lawyer. Have your own lawyer review. Delete this line before signing.

<!-- TEMPLATE END -->

**Example, invented.** Harbor Labs, Inc. has 10,000,000 authorized shares at $0.0001 par, all issued. Its gross assets on 2028-12-31 are $250,000. The authorized shares method gives $250 + 999 × $85 = $85,165. The assumed par is $0.025000, so the capital is $250,000 and the tax is $100, raised to the $400 minimum. Doe pays $400 plus the $50 fee, $450, by 2029-03-01. The receipt is filed as DOE-0052.

## Drafting notes

| Choice | Options | Recommendation and why | Where a lawyer should look |
|---|---|---|---|
| Which method | Accept the first bill; run both | **Run both, every year.** The first method alone can be far above the lesser amount | |
| Gross assets | Tax return figure; books | **The Form 1120 Schedule L figure,** as the Division's page says | Assets net of the allowances in 503(i) |
| First year | Full tax; prorated | **Ask the tax professional.** 503(d) prorates, and the minimums may interact | How the minimum applies to a part year |
| More shares later | Amend now; amend when needed | **Count the tax first.** More authorized shares raise the first method's figure | Amending the certificate of incorporation |
| The online notice | Pay as billed; enter the figures | **Enter issued shares and gross assets,** or 503(b) applies the first method | |

## What couldn't be checked

- **The Division's Franchise Tax Calculator** wasn't run: it is an interactive page.
- **8 Del. C. 503(e) to (h)**, other special rates, weren't read in full.
- **How proration and the minimums combine** in a first year wasn't found in the statute's words.

## Sources

Read 2026-11-13: [8 Del. C. chapter 5][del8c5]; Delaware Division of Corporations [franchise tax page][corpfr] and [franchise tax calculation page][frtaxcalc].

[del8c5]: https://delcode.delaware.gov/title8/c005/index.html
[corpfr]: https://corp.delaware.gov/frtax/
[frtaxcalc]: https://corp.delaware.gov/frtaxcalc/
