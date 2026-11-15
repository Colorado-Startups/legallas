---
id: investors/angels/safe-and-convertible-note
title: SAFE and convertible note explained, from the investor's side
path: angels-invest
kind: explainer
level: [federal, colorado, delaware]
entity: [natural-person]
statutes:
  - 17 CFR 230.502(d), 230.506 (the round's exemption)
  - 26 U.S.C. 1202 (qualified small business stock clock)
  - C.R.S. 7-116-102; 8 Del. C. 220 (stockholder records rights, which a SAFE holder lacks)
  - 6 Del. C. 2708 (choosing Delaware law)
source: Original drafting for Legallas. The Y Combinator SAFE and the Angel Capital Association model note are linked, not copied.
licence: CC0-1.0 (this file). Linked forms keep their own terms.
date_checked: 2026-11-01
fields:
  valuation_cap: The valuation cap, if any, and whether it is pre-money or post-money
  discount: The discount to the next round's price, if any
  interest_rate: For a note, the yearly interest rate and whether simple or compound
  maturity_date: For a note, the date it falls due
  qualified_financing: For a note, the size of round that triggers automatic conversion
---

# SAFE and convertible note explained

**Legallas is an AI agent for legal work, not a lawyer or law firm. Using it creates no attorney-client relationship. AI can be wrong. Have your own lawyer review before you sign, file or rely on anything. No lawyer has reviewed this.**

## In one screen

A SAFE (simple agreement for future equity) and a convertible note both let you pay now and get shares later, usually
when the company sells preferred stock in a priced round. The price you get is set by a valuation cap, a discount, or
both. The difference: **a note is debt**, with interest, a maturity date and a creditor's claim; **a SAFE is not debt**,
has no interest or maturity, and gives you no vote and no right to information. Both are securities, sold under the
company's exemption, usually Rule 506, and both are restricted: you can't freely resell them ([17 CFR 230.502(d)][e502]).

| | SAFE | Convertible note | Priced preferred stock |
|---|---|---|---|
| What you hold | A contract right to future shares | A loan that converts | Shares |
| Interest | None | Yes, usually simple | No (dividends only if declared or stated) |
| Due date | None | Maturity date | None |
| If the company fails | Paid after creditors, if anything is left, as the form ranks it | An unsecured creditor, unless secured | Paid after creditors, by preference |
| Vote | None | None | Yes, as the charter says |
| Information | None, unless a side letter adds it | Only what the note says | Investors' rights agreement, plus state law |
| Price at conversion | Cap, discount, or both | Cap, discount, or both | Set now |
| Paperwork | Short | Short to medium | Long: charter, purchase, investors' rights, voting, first refusal |

## The forms

- **Y Combinator SAFE.** The most used form. YC publishes post-money versions with a valuation cap, a discount, or most
  favoured nation terms, and a separate pro rata side letter ([Y Combinator SAFE page][ycsafe]). The design map records
  YC's forms as shareable only unmodified, so Legallas links to them instead of copying, and you always get the current
  version. The forms
  are written for a Delaware corporation; a Colorado corporation using one should have its lawyer check the references to
  Delaware law. Whether filling in the blanks changes the form under its licence is on the legal review's list.
  Delaware's statute upholding a choice of Delaware law doesn't apply to a contract under $100,000 ([6 Del. C. 2708][d6c27]),
  so for a SAFE under that amount, have your own lawyer check what law the clause brings in.
- **Convertible note.** The Angel Capital Association publishes a model note behind an access form
  ([model note page][aca-note]). Legallas links to it; there is no openly licensed note form.

## How conversion works, with numbers

All examples use invented figures.

**Post-money SAFE with a cap.** You invest $100,000 at a $10,000,000 post-money valuation cap. When the priced round
comes, you get roughly 1% of the company as it stood just before the new money (your amount divided by the cap), and
then you are diluted by the new investors like everyone else. If the round sells 20% of the company to new investors,
you end near 0.8%. The point of "post-money": your percentage before the round is fixed, whatever other SAFEs the company
sells, because the company's other SAFEs dilute the founders, not you.

**Pre-money SAFE.** The cap is measured before the SAFEs convert, so every other SAFE the company sells dilutes you too.
Your final percentage isn't knowable until the round.

**Discount.** With a 20% discount and a Series A price of $2.00 a share, your price is $1.60. Your $100,000 buys 62,500
shares instead of 50,000. Where a SAFE has both a cap and a discount, you get whichever price is lower.

**Note.** You lend $100,000 at 6% simple interest. The company raises a qualified round after 18 months. Principal and
interest, $109,000, convert at the discounted or capped price. If no round comes by maturity, the note says what happens:
repayment, conversion at a set price, or a vote of noteholders to extend.

## What to check before you sign

### Either instrument

- [ ] The cap, and whether it is pre-money or post-money: `{{valuation_cap}}`.
- [ ] The discount: `{{discount}}`.
- [ ] What happens if the company is sold before converting. Most forms give you the greater of your money back or what
  your shares would have been worth at the cap.
- [ ] How the form defines the company's capitalization for the cap, including the option pool. This decides how much
  dilution you absorb.
- [ ] What else is outstanding. Ask for the list of every SAFE and note, with caps and discounts. Investors with better
  terms on the same instrument may trigger your most favoured nation right, if you have one.
- [ ] Who can amend it. Notes often let a majority of noteholders amend all of them, including yours.
- [ ] A pro rata side letter and an information side letter, if you want either. See [Side letter basics](side-letter.md).

### SAFE only

- [ ] That you understand you have no vote, no board seat and no right to see the company's books. A stockholder of a
  Colorado or Delaware corporation has statutory inspection rights ([C.R.S. 7-116-102][t7], [8 Del. C. 220][d8s7]); a
  SAFE holder isn't a stockholder until conversion.
- [ ] Which events convert it (a priced round of any size, or above a threshold), and what you get on a dissolution.

### Note only

- [ ] Interest rate and whether it is simple or compound: `{{interest_rate}}`.
- [ ] Maturity date: `{{maturity_date}}`, and what happens then.
- [ ] The qualified financing threshold that converts it automatically: `{{qualified_financing}}`.
- [ ] Whether it is secured or subordinated to bank debt.
- [ ] Any premium on a sale of the company (for example, twice the principal).

## Tax points to keep in mind

- **The qualified small business stock clock.** The gain exclusion in [26 U.S.C. 1202][us1202] turns on when you acquired
  stock. A note is debt, so the clock almost certainly starts at conversion. Whether a SAFE is stock for section 1202 has
  no IRS answer, so the safe assumption is that the clock starts at conversion too. Keep the SAFE's date and the
  conversion date.
- **Accrued interest on a note** may be taxable to you as interest when it converts, even though you receive shares, not
  cash. Ask your own tax professional (practice point; no source checked here).

Legallas template investors/angels/safe-and-convertible-note version 1. Law checked 2026-11-01. Not reviewed by a lawyer. Have your own lawyer review. Delete this line before signing.

## Drafting notes

### Choice: which instrument to accept

| Option | Good for the investor when | Watch for |
|---|---|---|
| Post-money SAFE with a cap | Small early checks; you want certainty about your percentage | No vote, no information, no maturity |
| Post-money SAFE with a cap and a discount | You want protection both ways | Companies resist giving both |
| Most favoured nation SAFE (no cap) | You trust the company to set fair later terms | No price protection at all |
| Convertible note | You want a creditor's claim and a maturity date as leverage | Maturity rarely leads to repayment; majority amendment |
| Priced seed round | You are leading or putting in a large amount and want governance rights | Higher legal cost, and someone has to set the price |

**Recommendation:** for a small early check, accept a post-money SAFE with a cap, and ask for a pro rata side letter
and an information side letter. If you are leading the round or putting in an amount large enough to want a board seat,
press for a priced round. The Series Seed documents are openly licensed ([Series Seed][ss]).

**Where a lawyer should look:** the definitions that drive conversion (the company's capitalization, liquidity events,
dissolution ranking), any amendment clause that binds you to a majority vote, and for notes, state limits on interest
and any security interest.

### Choice: post-money or pre-money cap

**Recommendation:** prefer post-money. It gives you a known percentage before the round. A founder may prefer pre-money
for the same reason, so expect a discussion over the cap figure itself.

## Sources

Primary:

- [17 CFR 230.502][e502] (resale limits), [230.506][e506]
- [26 U.S.C. 1202][us1202]
- [C.R.S. 7-116-102][t7] (Colorado shareholder inspection rights)
- [8 Del. C. 220][d8s7] (Delaware stockholder inspection rights)
- [6 Del. C. 2708][d6c27] (choosing Delaware law), read 2026-11-02

Forms, linked:

- [Y Combinator SAFE documents][ycsafe] (recorded as shareable unmodified only)
- [Angel Capital Association model convertible note][aca-note] (behind an access form)
- [Series Seed][ss] (openly licensed priced-round documents)

## What couldn't be verified

- The Y Combinator SAFE page couldn't be opened from this session (the host was blocked), so the form's dissolution
  ranking and its licence weren't read. One third-party site tags a YC SAFE with a Creative Commons NoDerivatives licence;
  no YC source confirmed it. Read the current form before relying on the description above.
- The Angel Capital Association model note sits behind an access form and wasn't read.
- No IRS ruling settles whether a SAFE is stock for section 1202.

[e502]: https://www.ecfr.gov/current/title-17/section-230.502
[e506]: https://www.ecfr.gov/current/title-17/section-230.506
[us1202]: https://uscode.house.gov/us/usc/t26/s1202/
[t7]: https://olls.info/crs/crs2026-title-07.pdf
[d8s7]: https://delcode.delaware.gov/title8/c001/sc07/index.html
[ycsafe]: https://www.ycombinator.com/safe
[aca-note]: https://angelcapitalassociation.org/model-convertible-note/
[ss]: https://github.com/seriesseed/equity
[d6c27]: https://delcode.delaware.gov/title6/c027/sc01/index.html
