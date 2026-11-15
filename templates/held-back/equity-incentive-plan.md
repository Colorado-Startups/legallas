---
id: held-back/equity-incentive-plan
title: Equity Incentive Plan, with option notice and exercise form
kind: template
path: startup-forms
level: [colorado, delaware, federal]
entity: [colorado-corporation, delaware-corporation]
statutes:
  - C.R.S. 7-101-401
  - C.R.S. 7-106-202, -205, -207, -208, -301, -401
  - C.R.S. 7-107-104
  - C.R.S. 7-108-206, -501
  - C.R.S. 7-116-102
  - C.R.S. 8-2-113
  - C.R.S. 8-4-101, -102, -105, -109, -121
  - C.R.S. 11-51-307, -308, -501, -604
  - 8 Del. C. 144, 151, 152, 153, 157, 160, 202, 220, 228
  - 15 U.S.C. 77d(a)(2)
  - 15 U.S.C. 78l(g)
  - 18 U.S.C. 1833(b)
  - 26 U.S.C. 22(e)(3), 56(b)(3), 83, 280G(b)(5), 401(a)(28)(C), 409A, 421, 422, 424, 3121(a)(22), 6039
  - 17 CFR 230.144, 230.701
  - 17 CFR 240.10b-5, 240.12g5-1, 240.12h-1, 240.21F-17
  - 26 CFR 1.83-2, 1.83-3, 1.83-7, 1.409A-1, 1.409A-3, 1.421-1, 1.421-2, 1.422-2, 1.422-3, 1.422-4, 1.422-5, 1.424-1
  - 81 Fed. Reg. 40569 (proposed rule, June 22, 2016)
source: Original drafting for Legallas from the statutes listed and first principles. No law firm's plan and no restricted form was read or adapted.
licence: CC0-1.0
date_checked: 2026-11-01
fields:
  - COMPANY_NAME
  - STATE_OF_INCORPORATION
  - BOARD_ADOPTION_DATE
  - STOCKHOLDER_APPROVAL_DATE
  - PLAN_SHARE_RESERVE
  - POST_TERMINATION_MONTHS
  - GOVERNING_STATE
  - COMPANY_ADDRESS
  - HOLDER_NAME
  - HOLDER_ADDRESS
  - GRANT_DATE
  - NUMBER_OF_SHARES
  - EXERCISE_PRICE_PER_SHARE
  - FAIR_MARKET_VALUE_PER_SHARE
  - VALUATION_DATE
  - VESTING_START_DATE
  - EXPIRATION_DATE
  - REMOVAL_ACCELERATION_MONTHS
  - SIGNING_DATE
  - SHARES_EXERCISED
  - TOTAL_EXERCISE_PRICE
  - EXERCISE_DATE
---

# Equity Incentive Plan

> Legallas is an AI agent for legal work, not a lawyer or law firm. Using it creates no attorney-client relationship. AI can be wrong. Have your own lawyer review before you sign, file or rely on anything.
>
> No lawyer has reviewed this template.
>
> **Held back: a lawyer reviews it first.** This plan is not offered in any list. Do not use it before your own lawyer has read it.

## Before you use this

This is how a corporation pays people with options and restricted stock. It also decides what happens to that equity when someone leaves, is removed or is accused of misconduct, when the
company is sold, and when people fight over who controls the board. Exhibit A is the option notice and agreement. Exhibit B is the exercise form.

**Corporations only.** It fits a Colorado or Delaware corporation. An LLC can't use it, and an LLC taxed as a partnership can't grant incentive stock options at all, because those are options on a corporation's stock ([26 U.S.C. 422(b)][us422]). Only an LLC taxed as a corporation for all federal tax purposes counts as a corporation here ([26 CFR 1.421-1(i)(1)][e421-1]). A Colorado LLC uses the Profits Interest Units in Section 13.9 of the [operating agreement](../founders/colorado-llc-operating-agreement.md) instead.

**Founders get their stock elsewhere.** Founder stock goes through the [founder stock purchase agreement](../founders/founder-stock-purchase.md). A founder who holds more than 10% of the vote can get an incentive stock option only at 110% of fair market value with a 5-year term ([422(c)(5)][us422]).

**In order:**

1. Check the charter. It needs enough authorized common stock for the reserve on top of founder stock, and nothing limiting options ([7-106-205(2)][t7]; [157(a)][d8s5]). If Colorado articles elect preemptive rights, read [7-106-301(2)(c)][t7].
2. The board adopts the plan, in section 6 of the [initial board consent](../founders/initial-board-consent.md) or later.
3. The stockholders approve it, within 12 months before or after the board does ([422(b)(1)][us422]), in the way the charter, bylaws and state law require ([26 CFR 1.422-3][e422-3]). Use the [initial stockholder consent](../founders/initial-stockholder-consent.md). In Colorado a consent takes every holder, unless the articles expressly allow less ([7-107-104(1)][t7]). In Delaware it takes the votes needed at a meeting, with notice to the rest ([228(a), (e)][d8s7]).
4. Before the first option, the board determines fair market value as section 6 says. An offer letter promising options doesn't set a price. The grant date is when the corporate action is complete and the number of shares and price are fixed ([1.421-1(c)(1)][e421-1]). If the value has risen by then, so has the price.
5. For each grant: a board resolution, a signed Exhibit A, a copy of this plan to the person ([17 CFR 230.701(e)][e701]) and an updated count against the Rule 701 cap.

**Dates that can't be fixed later:**

- **Stockholder approval:** within 12 months before or after adoption, or there are no incentive stock options.
- **Grants:** incentive stock options only within 10 years after the earlier of adoption and approval ([422(b)(2)][us422]).
- **Option term:** at most 10 years, or 5 for a holder of more than 10% ([422(b)(3), (c)(5)][us422]).
- **Valuation:** never more than 12 months old, and never stale because of later news ([26 CFR 1.409A-1(b)(5)(iv)(B)(1)][e409a]).
- **83(b) election:** 30 days after a transfer of unvested shares ([26 U.S.C. 83(b)(2)][us83]; [26 CFR 1.83-2][e83-2]). This applies to restricted stock and to any early exercise, and it's filed with the IRS, on [Form 15620][f15620] or by a statement.
- **After employment ends:** incentive stock option treatment needs exercise within 3 months, or 1 year for a disabled employee ([422(a)(2), (c)(6)][us422]). A hold under section 11(d) doesn't stop this clock. An estate's exercise after a death follows its own rule ([1.421-2(c)][e421-2]).

**The state-law rules:**

| | Colorado | Delaware |
|---|---|---|
| Who sets option terms | The board, subject to the articles ([7-106-205(2)][t7]) | The charter or a board resolution ([157(b)][d8s5]) |
| Stock price | The board must determine that consideration is adequate before issuing. That's conclusive on valid issue, absent fraud ([7-106-202(3)][t7]) | At least par in value ([153(a)][d8s5]). The board's judgment is conclusive, absent actual fraud ([152(d)][d8s5]) |
| A note for shares | Doesn't count unless negotiable and secured by collateral **other than the shares**, worth at least the principal. A nonrecourse note doesn't count ([7-106-202(5)][t7]) | The board decides the form of consideration ([152(a)][d8s5]). A lawyer should check any note |
| Letting others grant | A committee or officer only within limits the board specifically prescribes ([7-108-206(4)(h)][t7]) | A resolution fixes the maximum shares, the time periods and the minimum consideration, and nobody can grant to themselves ([152(b)][d8s5]; [157(c)][d8s5]) |
| Transfer limits | Bind a person who doesn't know only if noted conspicuously on the certificate or included in the information statement ([7-106-208(2)][t7]; [7-106-207(2)][t7]) | The same, on the certificate or the notice ([202(a)][d8s6]; [151(f)][d8s5]) |
| Buying shares back | It's a distribution ([7-101-401(13)][t7]), limited by the solvency tests ([7-106-401(3)][t7]) | Not if capital is or would be impaired ([160(a)(1)][d8s5]) |

**Read it from both sides.** Today you're writing this for people you're hiring. Later you may hold an award yourself, in a company someone else controls. Pick terms you'd accept in either seat.

## The document

<!-- TEMPLATE START -->

**{{COMPANY_NAME}} EQUITY INCENTIVE PLAN**

The board of directors of {{COMPANY_NAME}}, a {{STATE_OF_INCORPORATION}} corporation (the "Company"), adopted this Plan on {{BOARD_ADOPTION_DATE}}. The Company's stockholders approved it on
{{STOCKHOLDER_APPROVAL_DATE}}.

**1. Purpose.** This Plan pays people for their work with a stake in the Company. Every Award is compensation for service. The Plan is not a way to raise money.

**2. Terms used in this Plan.**

"**Administrator**" means the Board, or a committee of directors the Board has given this power, except where this Plan says the Board or the Disinterested Directors must act.

"**Award**" means an Option or a Restricted Stock Award. An "**Award Agreement**" is the written notice and agreement for an Award, signed by the Company and the Holder.

"**Board**" means the Company's board of directors.

"**Code**" means the Internal Revenue Code of 1986.

"**Common Stock**" means the Company's common stock.

"**Consultant**" means a natural person who provides real services to a Group Company as an adviser or independent contractor. Those services must not be connected with selling securities in a
capital-raising transaction, and must not directly or indirectly promote or maintain a market for the Company's securities.

"**Disability**" means permanent and total disability as section 22(e)(3) of the Code defines it.

"**Group Company**" means the Company, any parent corporation of the Company and any majority-owned subsidiary of the Company.

"**Holder**" means a person who holds an Award or Plan Shares, including a permitted transferee and, after death, the estate or heir.

"**Incentive Stock Option**" means an Option that its Award Agreement calls an incentive stock option and that meets section 422 of the Code. A "**Nonstatutory Option**" is any other Option. An Option
whose Award Agreement doesn't call it an incentive stock option isn't one.

"**Option**" means a right to buy Common Stock from the Company at a fixed price.

"**Plan Shares**" means shares issued under this Plan, and anything received for them in a split, dividend, merger or exchange.

"**Restricted Stock Award**" means shares issued under section 9.

"**Service**" means work for a Group Company as an employee, officer or Consultant. Serving only as a director counts as Service only if the Award Agreement says so. Service does not end because of a
change in title, a move from one of those roles to another, or a leave the Company approved in writing or the law requires.

"**Stockholder**" includes a shareholder, the word Colorado's statute uses.

"**Ten Percent Holder**" means a person who, immediately before an Option is granted, owns or is treated under section 424(d) of the Code as owning stock with more than 10% of the total combined voting
power of all classes of stock of the Company or of its parent or subsidiary corporation.

Section 5 defines Disinterested Directors and Neutral. Section 6 defines Fair Market Value. Section 11 defines Cause. Section 14 defines Change of Control and Good Reason. Section 16 defines Contest Period.

**3. Shares.**

(a) The Company may issue up to {{PLAN_SHARE_RESERVE}} shares of Common Stock under this Plan in total. Up to that same number may be issued on the exercise of Incentive Stock Options. Section 15 adjusts
these numbers.

(b) The Company shall keep enough authorized and unissued shares to cover every outstanding Option.

(c) Shares go back to the reserve and may be issued again if an Award ends without the shares being issued, if unvested Plan Shares are forfeited or bought back, or if shares are surrendered or held
back to pay an exercise price or tax. This does not raise the limit on Incentive Stock Options.

**4. Who can receive Awards.**

(a) The Administrator may grant Awards to employees, officers and directors of a Group Company, and to Consultants.

(b) Only a person who is an employee of the Company, or of a parent or subsidiary corporation as section 424 of the Code defines those terms, on the grant date may receive an Incentive Stock Option.

(c) Nobody has a right to an Award, and Awards need not be the same.

**5. Who runs the Plan.**

(a) **The Board.** The Board runs this Plan. It may give a committee of one or more directors the Administrator's powers, except those this Plan reserves to the Board.

(b) **What only the Board can do.** Only the Board may determine Fair Market Value, set the limits in (c), authorize the Company to buy Plan Shares, or amend this Plan.

(c) **Letting others grant.** The Board may let a committee or an officer grant Awards only by a resolution that fixes the maximum number of shares, the time period for granting the Awards, the time period
for issuing the shares, the minimum consideration for the Awards and for the shares, and the form of Award Agreement. A person given this power may not grant an Award to themselves, to a director or officer,
or to a family member of any of them.

(d) **Awards to insiders.** An Award to a director or officer, and any change to one, needs one of these after the material facts are disclosed: approval by a majority of the Disinterested Directors, or
approval by a majority of the votes cast by stockholders with no stake in it. If neither is available, the Board shall state in writing why the Award is fair to the Company.

(e) **Conflicts.** A director shall not take part in a decision about the director's own Award or Plan Shares, or in any decision under sections 9, 11, 12, 13, 14 or 16 in which the director has a personal
stake. Those decisions belong to the Disinterested Directors.

(f) "**Disinterested Directors**" means the directors other than the Holder, and other than any director who has a personal stake in the decision apart from holding stock on the same terms as other holders.
If there are none, a decision for the Disinterested Directors is made by the holders of a majority of the shares held by stockholders other than the Holder and anyone else with a personal stake. If there
are no such stockholders, it's made by a Neutral. If the Holder is one of only two directors, the other director has a personal stake in any decision about Cause, and a Neutral makes that decision.

(g) "**Neutral**" means an independent lawyer or retired judge who has not worked for the Company or for any director or Holder involved. The Holder and the Disinterested Directors shall choose the Neutral
together within 10 business days. If they don't, a recognized mediation or arbitration provider in the county of the Company's principal office chooses, at either side's request. The Company pays the Neutral.

(h) **Decisions.** The Administrator interprets this Plan in good faith. Its decisions stand unless they are unreasonable or contrary to this Plan. Decisions about Cause are different: section 11(d) applies.

(i) **Duties.** Nothing in this Plan changes a director's duties. If a director concludes, on a lawyer's written advice, that a duty requires something section 16 or 21 forbids, the Company shall tell every
Holder affected in writing what was done and why, and the Holder keeps every remedy.

**6. Fair market value.**

(a) No Option may be granted until the Board has determined the Fair Market Value of the Common Stock as of the grant date, as this section requires. The grant date can't be earlier than the date the Board
makes that determination and completes the action granting the Option.

(b) While the Common Stock is not readily tradable on an established securities market, "**Fair Market Value**" means the value the Board determines by reasonably applying a reasonable valuation method. It
must take into account all available information material to the Company's value, including, as they apply, its assets, its expected cash flows, the market value of similar businesses, recent arm's length
sales of its stock, and discounts for lack of marketability.

(c) The Board shall not use a value calculated as of a date more than 12 months before the grant date, or a value that fails to reflect later information that may materially affect the Company's value. Examples
are a term sheet, a financing, sale talks, a major contract, the outcome of major litigation or the issue of a patent.

(d) While (b) applies, the Board shall base its determination on one of these:

(i) an independent appraisal that meets section 401(a)(28)(C) of the Code, as of a date no more than 12 months before the grant date; or

(ii) a written report that takes the factors in (b) into account, made reasonably and in good faith by a person the Company reasonably determines is qualified by significant knowledge, experience, education or
training, generally including at least five years of relevant experience. The Board may use this report only if, when it's applied: the Company has no material trade or business that it or a predecessor has
conducted for 10 years or more; no class of its equity securities is traded on an established securities market; the stock isn't subject to any put, call or other right or obligation of the Company or anyone
else to buy it, other than a right of first refusal on an offer from a third party unrelated to the Company and the Holder, and other than a lapse restriction as 26 CFR 1.83-3(i) defines it; and neither the
Company nor the Holder may reasonably anticipate a change in control event within the following 90 days, or a public offering within the following 180 days.

(e) Fair Market Value disregards any restriction that may lapse, and takes into account a restriction that by its terms will never lapse.

(f) While the Common Stock is readily tradable on an established securities market, Fair Market Value is its closing price on the grant date or, if there was no sale that day, on the last day before it with a sale.

**7. Option terms.**

(a) Each Award Agreement for an Option states the number of shares, fixed on the grant date, and the exercise price, the vesting terms, the last day it can be exercised (the "**Expiration Date**") and whether
it's an Incentive Stock Option.

(b) **Price.** The exercise price per share must be at least the Fair Market Value on the grant date, and never less than par value. For an Incentive Stock Option granted to a Ten Percent Holder, it must be at
least 110% of the Fair Market Value on the grant date.

(c) **Term.** An Option can't be exercised more than 10 years after its grant date. An Incentive Stock Option granted to a Ten Percent Holder can't be exercised more than 5 years after its grant date.

(d) **$100,000 limit.** To the extent the value of the stock for which a person's Incentive Stock Options first become exercisable in a calendar year, under all plans of the Company and its parent and subsidiary
corporations, is more than $100,000, those Options are Nonstatutory Options. Stock is valued as of each Option's grant date, and Options count in the order they were granted.

(e) **Adequate consideration.** By granting an Option, the Board determines that the exercise price is adequate consideration for the shares. Shares are fully paid and nonassessable once the Company receives that price.

(f) **Nothing extra.** An Option carries no dividends or dividend equivalents, and no feature that defers income past its exercise or, if later, the vesting of the shares.

(g) **Exercise before vesting.** A Holder may exercise an unvested part only if the Award Agreement says so. Shares bought that way are unvested until the Option would have vested, and section 9(c), (d) and (e) apply to them.

**8. Exercising an Option.**

(a) **How.** A Holder exercises by giving the Company the form in Exhibit B, with the exercise price and any tax due under section 17.

(b) **Payment.** A Holder pays by cash, check or wire. If the Award Agreement allows it, a Holder may instead pay with shares the Holder already owns, valued at Fair Market Value or, for a Nonstatutory Option, by having
the Company hold back shares worth the exercise price.

[OPTION A: No promissory notes. Recommended.]
A Holder may not pay with a promissory note.
[END OPTION A]

[OPTION B: Notes only with outside collateral.]
A Holder may pay with a promissory note only if the Disinterested Directors approve it in that case, and it is negotiable, it is full recourse, it bears interest at no less than the rate that avoids imputed interest,
and it is secured by collateral, other than the shares, with a fair market value at least equal to the principal.
[END OPTION B]

(c) **Issuing the shares.** The Company shall record the shares in the Holder's name within 10 business days after a complete exercise. It may refuse or delay only if the exercise is incomplete, section 11(d)
puts that part of the Option on hold, or section 18(e) applies. A dispute with the Holder or a contest for control is not a reason to refuse or delay.

(d) **Other agreements.** The Company may require a Holder to sign a stockholder agreement at exercise only if all holders of 1% or more of the Common Stock are bound by the same terms, and only as section 21(c) allows. A term that adds a right to buy, a new transfer limit or anything else section 21(c) forbids needs the Holder's written consent, and refusing that term isn't a reason to refuse or delay the exercise.

(e) **Rights.** A Holder has no stockholder rights in shares under an Option until they're recorded in the Holder's name. After that, the Holder has the rights of any holder of Common Stock, subject to this Plan.

**9. Restricted stock.**

(a) **Grant.** The Administrator may sell or grant Common Stock subject to vesting. The Award Agreement states the number of shares, the price and the vesting terms.

(b) **What pays for it.** Shares may be issued for cash, for services already performed, or both. Before they are issued, the Board shall determine that the consideration is adequate. Its value must be at least par value
if the law of the state of incorporation requires that.

(c) **Unvested shares.** When a Holder's Service ends for any reason, the Plan Shares still unvested on that date become subject to repurchase at the price the Holder paid in cash per share or, if lower, their Fair Market
Value on that date. If the Holder paid no cash, they are forfeited for no payment. Within 10 days, the Company shall give the Holder a written statement of how many shares are vested and how many aren't, how it
calculated those numbers, and the price. The Company buys or takes back those shares on the later of the 90th day after Service ends and any later date section 11(d) or 14(d) sets, unless the Disinterested Directors
decide otherwise in writing before then. It shall pay any price in cash within 30 days after that.

(d) **Legal limits.** The Company may buy only as the law allows. A purchase must meet the limits on distributions and on buying its own stock in the law of the state where it is incorporated. If those limits prevent it,
the Disinterested Directors may assign the right to buy to the Company's other stockholders in proportion to their holdings, and they may buy on the same terms during the following 90 days. Any unvested shares nobody
buys in that period vest.

(e) **How they're held.** The Company records unvested shares in its stock records with a note of this Plan. The Holder signs a stock power, which the Company may use only to record a purchase this Plan allows, after
giving the statement in (c). The Holder may vote all the shares, vested or not, and receives any dividends, until they are bought. Dividends paid in stock on unvested shares stay unvested.

(f) **83(b) election.** If shares can be forfeited or repurchased, the Holder has **30 days after the transfer** to file an election under section 83(b) of the Code with the Internal Revenue Service, and gives the Company a copy.
That duty is the Holder's alone, even if the Company offers to help.

**10. When Service ends.**

(a) **Unvested Options.** The unvested part of an Option ends on the date Service ends, except as sections 11(d) and 14(d) and the Award Agreement say.

(b) **The statement.** Within 10 days after Service ends, the Company shall give the Holder a written statement of how many shares are vested and how many aren't, how it calculated those numbers, the exercise price, the most
recent Fair Market Value, the last day to exercise, and the last day to exercise and keep Incentive Stock Option treatment. If a Holder of an Incentive Stock Option stops being an employee while Service continues, including on a move to a Consultant role or a leave that (d) treats as ending employment, the Company shall give the same statement within 10 days after employment ends. If a statement is late, the period in (c) runs from the day the Holder receives it, but the time in (d) doesn't move.

(c) **Vested Options.**

[OPTION A: A longer window, set now. Recommended.]
The Holder may exercise the vested part until the earlier of the Expiration Date and {{POST_TERMINATION_MONTHS}} months after Service ends.
[END OPTION A]

[OPTION B: Three months.]
The Holder may exercise the vested part until the earlier of the Expiration Date and 3 months after Service ends.
[END OPTION B]

(d) **Incentive Stock Option treatment.** Whatever (c) says, an Incentive Stock Option exercised more than 3 months after the Holder stops being an employee of the Company or its parent or subsidiary corporation, or more than
1 year after if the Holder stopped because of Disability, is taxed as a Nonstatutory Option. That is so even if Service continues in another role. A leave of more than 3 months with no right to return by statute or contract
ends employment for this purpose on the day after the third month. Tax law sets this time, so nothing in this Plan stops or restarts it. It doesn't apply to an exercise by the estate or an heir after the death of a person who was an employee at death, or who stopped being one within 3 months before death (1 year if because of Disability).

(e) **Death and Disability.** If Service ends because of death or Disability, or the Holder dies during the period in (c), the Holder or the estate or heir may exercise the vested part until the earlier of the Expiration Date
and the later of 12 months after that event and the end of the period in (c).

(f) **Cause.** Section 11 controls if there is a finding of Cause.

(g) **Stopped clock.** If the law, or section 18(e), stops a Holder from exercising, any period in (c) or (e) stops running until 30 days after exercise is allowed again. The time in (d) doesn't stop. No period runs past the Expiration Date.

(h) **No release.** A Holder need not sign a release to keep a vested Award.

**11. Cause.**

(a) "**Cause**" means only that the Holder:

(i) has been convicted of, or pleaded guilty or no contest to, a felony or a crime involving fraud or dishonesty;

(ii) committed fraud or embezzlement against the Company, or intentionally took material Company assets for personal use;

(iii) engaged in willful misconduct that materially harmed the Company, including harassment, unlawful discrimination or unlawful retaliation, as found in written findings by an independent investigator;

(iv) materially breached the Holder's invention assignment or Award Agreement; or

(v) willfully and repeatedly refused to follow a lawful, reasonable and specific written direction of the Board or the Holder's manager that was consistent with the Holder's role.

(b) Cause does not include: disagreement about strategy, poor results, or anything else short of the list above; good faith reporting of a suspected violation of law or cooperating with an investigation; refusing to do
something the Holder reasonably believes is illegal; exercising rights as a stockholder or director, including asking to see records or voting against a proposal; or bringing a claim against the Company.

(c) **The process.** A finding of Cause needs all of these: written notice to the Holder saying which paragraph applies and the facts relied on; for (iv) and (v), 30 days to cure, if the matter can be cured; a chance for the
Holder and the Holder's lawyer to be heard by the Disinterested Directors; and a written decision by two-thirds of the Disinterested Directors, stating its reasons. The Company may place the Holder on paid leave while this
happens, and the leave isn't itself Good Reason. The notice must be given before Service ends or within 30 days after. For (i) or (ii), if the facts were hidden or the conviction or plea came later, it may instead be given within 60 days after
the Disinterested Directors learn them, while any Option remains outstanding.

(d) **When a finding takes effect.** A finding of Cause takes effect only when it's final: 60 days after the written decision if the Holder hasn't started a claim by then, or when a court or arbitrator upholds it or the claim is dropped. A court or
arbitrator decides whether there was Cause on its own view of the facts, without deference to the decision. Until the finding is final, the Company shall not cancel, buy or take back anything because of it. A notice alone doesn't stop exercise. From the written decision until the finding is final, any part of an
Option the finding could end stays outstanding but can't be exercised, and any period in section 10(c) or (e) for exercising that part stops running. This hold applies only if the written decision is made within 60 days after
the notice in (c), and it never runs past the Expiration Date. **The hold doesn't stop the time in section 10(d).** If that time runs out during a hold, an Incentive Stock Option is taxed as a Nonstatutory Option when exercised, even if there was no Cause, and (f) doesn't pay for that.

(e) **What a final finding does.**

[OPTION A: Vested Options end only for crime or fraud. Recommended.]
A final finding under (a)(i) or (a)(ii) ends the unexercised part of the Holder's Options, vested or not. After any other final finding, the unvested part ends, and the Holder may exercise the vested part until the earliest
of the Expiration Date, the last day under section 10 and 3 months after the finding is final.
[END OPTION A]

[OPTION B: Any finding of Cause ends vested Options.]
A final finding of Cause ends the unexercised part of the Holder's Options, vested or not.
[END OPTION B]

Whichever applies, a final finding ends any right to faster vesting under section 14 or the Award Agreement.

(f) **If there was no Cause.** If a court or arbitrator finds there was no Cause, or a finding doesn't become final, the Holder is treated as having left without Cause. Any period in section 10(c) or (e) starts again for its full length
from that date, but never runs past the Expiration Date. The time in section 10(d) doesn't start again. If the Expiration Date passed while an Option was on hold, the Company shall pay the Holder in cash the amount by which the value of the shares on the Expiration Date
exceeded the exercise price. The Company shall restore any Plan Shares it took or pay their value, whichever the Holder chooses if they can no longer be restored. The Company shall pay the Holder's reasonable legal costs of
getting that result.

(g) **What this section doesn't do.** This section decides only what happens to Awards. It does not limit the Company's right to end anyone's Service or to act on a complaint. If a Holder has signed a founder stock purchase
agreement or employment agreement with the Company that defines Cause or its process, a term of that agreement applies here only where it protects the Holder more than this section does. Otherwise this section, including (b), controls.

**12. Vested Plan Shares.**

[OPTION A: No right to buy vested Plan Shares. Recommended.]
The Company has no right to buy vested Plan Shares, except under the right of first refusal in section 13(d). A finding of Cause doesn't take them away.
[END OPTION A]

[OPTION B: Right to buy at fair value, only on a final finding of crime or fraud.]
If there is a final finding of Cause under section 11(a)(i) or (ii), the Company may buy the Holder's vested Plan Shares at their fair market value on the date of that finding, set by an independent appraiser the Disinterested
Directors choose. It must decide within 90 days after the finding is final. This right ends when the transfer limits in section 13 end.
[END OPTION B]

Before the Company or anyone acting with it buys Plan Shares from a Holder other than at the price in section 9(c), the buyer shall disclose to the Holder all material facts it knows about the Company's business, financing and value.

**13. Transfers.**

(a) **Options.** An Option can't be transferred except by will or the laws of descent and distribution, and only the Holder may exercise it during the Holder's lifetime. A Holder may name, in a writing given to the Company, who may
exercise it after the Holder's death. If the Award Agreement allows it, a Nonstatutory Option may also pass to a family member, as 17 CFR 230.701(c)(3) defines that term, by gift or domestic relations order, or be exercised by a
guardian if the Holder can't act. A family member who receives one can't transfer it further. Until the Company files reports under the Securities Exchange Act of 1934, a Holder may not pledge an Option or the shares under it, or
take a short position, put equivalent position or call equivalent position in them.

(b) **Unvested Plan Shares.** A Holder may not transfer unvested Plan Shares, except to a trust or family member for estate planning, where the transferee agrees in writing to be bound by this Plan and the Holder keeps the right to vote them.

(c) **Vested Plan Shares.** A Holder may transfer vested Plan Shares only: (i) by gift or for estate planning to a family member or trust, by will or the laws of descent and distribution, or by domestic relations order; (ii) in a sale
under (d); (iii) to the Company; (iv) in a Change of Control; or (v) with the consent of the Disinterested Directors, which they shall not unreasonably withhold. Except in (iii) and (iv), the transferee must agree in writing to be
bound by this Plan.

(d) **Right of first refusal.** This applies only to a real offer to buy from a third party unrelated to the Company and the Holder. Before selling, the Holder shall give the Company written notice of the buyer, the number of shares,
the price and the other terms. The Company may buy all or part of those shares on the same terms by notice within 30 days. If the price isn't cash, the Company pays its cash value. The Disinterested Directors make this decision,
and they may assign the right to the other stockholders in proportion to their holdings. Any shares not bought may be sold to the named buyer on those terms within the following 60 days, if the buyer agrees in writing to be bound by
this section. After that, the Holder must offer again.

(e) **Refusing a transfer.** The Company shall not record a transfer that breaks this section. It may also refuse a transfer that would break securities law, would require it to register under section 12(g) of the Securities Exchange
Act of 1934, or would go to a direct competitor. A transfer that breaks this section is void.

(f) **Notice of these limits.** The Company shall note these limits conspicuously on the front or back of any certificate, and shall put them in the statement or notice it sends for uncertificated shares, as follows: "These shares are subject to transfer restrictions, a right of first
refusal and, if unvested, a repurchase right under the Company's Equity Incentive Plan, a copy of which the Company will provide without charge on request. They have not been registered under the Securities Act of 1933 and may not be
sold without registration or an exemption."

(g) **When these limits end.** Sections 13(b) to (f) end when the Common Stock is first publicly traded or on a Change of Control, but securities law still applies.

(h) **Public offering.** In the Company's first registered public offering, if the managing underwriter asks and all officers and directors and holders of 1% or more are bound by the same terms, the Holder won't sell any Plan Shares
for up to 180 days after the offering.

**14. Change of Control.**

(a) "**Change of Control**" means a sale of all or substantially all of the Company's assets, or a merger or sale of stock after which the people who held the Company's voting stock just before it hold less than a majority of the voting
power of the Company or its successor. A financing whose main purpose is raising money isn't a Change of Control. A change in who sits on the Board, by itself, isn't one either.

(b) **How Options are treated.** In a Change of Control, the Administrator shall treat each Option in one of these ways, and it shall treat all Options of the same type and vesting status the same way, whoever holds them:

(i) *Taken on.* The successor assumes the Option or replaces it with one on the same vesting and other terms. The spread between the value of the shares and the total exercise price stays the same, and so does the ratio of exercise price
to value per share.

(ii) *Cashed out.* The vested part is cancelled for a payment, per share, of the amount by which the value per share that holders of Common Stock receive exceeds the exercise price. It's paid on the same schedule and terms that apply
to holders of Common Stock, including any escrow, holdback or earn-out, and no later than 5 years after the Change of Control.

(iii) *Exercise or end.* The Company gives at least 15 days' written notice. The Holder may exercise the vested part, and any part that will vest under (d) because of the Change of Control, conditional on closing, and may choose to pay the exercise price and any tax out of what those shares receive at closing. Whatever isn't exercised ends at closing.

An Option whose exercise price is at or above the value per share that holders of Common Stock receive may be cancelled for no payment, on the same notice. Otherwise, no vested Option may be cancelled without payment or the chance in (iii). Anything received
for unvested Plan Shares stays unvested on the same schedule, unless it vests under (d). Payment for any part of an Award on hold under section 11(d) goes into escrow until the finding is final.

(c) "**Good Reason**" means any of these without the Holder's written consent: a material reduction in base pay, other than one applying in the same proportion to all executives; a material reduction in title, authority, duties or
reporting line; moving the Holder's main place of work more than 50 miles; or the Company's material breach of the Award Agreement. The Holder must give written notice within 90 days after the condition first exists, the Company has 30 days
to cure, and the Holder must resign within 30 days after that period ends.

(d) **Faster vesting.**

[OPTION A: If the buyer doesn't take the Award on, or the Holder is pushed out around a sale. Recommended.]
(i) If the successor doesn't assume or replace an Award, its unvested part vests immediately before the Change of Control and only if it closes.

(ii) If the Company or a successor ends a Holder's Service without Cause, or the Holder resigns for Good Reason, within 3 months before or 12 months after a Change of Control, all of the Holder's unvested Awards vest on the later of that
date and the Change of Control. To allow for this, for 3 months after Service ends, the unvested part of an Option doesn't end, though it can't be exercised, and unvested Plan Shares aren't bought.
[END OPTION A]

[OPTION B: Vesting speeds up on a sale alone.]
All unvested Awards vest immediately before a Change of Control and only if it closes.
[END OPTION B]

[OPTION C: Only if the buyer doesn't take the Award on.]
If the successor doesn't assume or replace an Award, its unvested part vests immediately before the Change of Control and only if it closes.
[END OPTION C]

(e) **No release.** Paragraph (d) doesn't require a release.

(f) **Successors.** The Company shall not close a Change of Control unless the successor is bound by this Plan for every Award it assumes.

**15. Adjustments.** If a stock split, reverse split, stock dividend, recapitalization, reclassification or similar event changes the Common Stock, the Board shall adjust the number and kind of shares in section 3, and the number, kind
and exercise price of shares under each Option, in proportion, so no Holder gains or loses by it. It shall do so in the way sections 409A and 424 of the Code allow, and shall round down any fractional share.

**16. Contests for control.**

(a) A "**Contest Period**" starts when a person or group holding 5% or more of the voting stock gives the Company or its stockholders written notice of an effort to remove or replace half or more of the directors, or solicits consents or proxies for that, or when anyone makes a written offer, with evidence of the funds to close it, for a Change of Control the Board hasn't approved. It ends 30 days after that effort or offer ends, and in any case 180 days after it started. The same effort or offer can't start another Contest Period.

(b) During a Contest Period, the Company shall not:

(i) grant an Award to, or speed up, reprice, extend or otherwise improve an Award of, a director, an officer, a holder of 5% or more of the voting stock, or anyone acting with one of them, unless a majority of the votes cast by stockholders
with no stake in it approve after full disclosure;

(ii) grant any other Award, except to new hires and on promotions in the ordinary course, in sizes and on terms it used before the Contest Period;

(iii) use its right of first refusal, except by assigning it to all other stockholders in proportion to their holdings; or

(iv) delay an exercise, a statement or any information this Plan requires.

(c) During a Contest Period, a finding of Cause against a director, an officer or a holder of 5% or more of the voting stock may be made only by a Neutral, in place of the Disinterested Directors. A Neutral already chosen finishes the decision, even if the Contest Period ends first. Paid leave remains available under section 11(c).

(d) At no time may the Company grant, change, end, buy or threaten an Award or Plan Shares because of how a Holder votes or acts in a contest for control. Apart from the terms this Plan requires for a Ten Percent Holder, it may not set terms that shut out or penalize a Holder because of how many shares the Holder owns or offers to buy. Voting is the Holder's choice.

(e) This section doesn't stop vesting or faster vesting under terms already in place, or a new grant a signed contract already requires.

(f) Whoever controls the Board after a contest is bound by this Plan.

**17. Tax.**

(a) **Your own adviser.** The Holder is responsible for the Holder's own taxes and should get the Holder's own tax advice. The Company doesn't promise any tax result, including that an Option is or stays an Incentive Stock Option.

(b) **Nonstatutory Options.** At exercise, the amount by which the shares' value exceeds the exercise price is ordinary income. For an employee or former employee, it's wages subject to withholding. Before shares are issued, the Holder shall
pay that withholding or arrange to pay it. The Company may deduct from pay only as the law allows.

(c) **Incentive Stock Options.** If the rules are met, there is no regular income tax at exercise, though the alternative minimum tax may apply. If the Holder sells the shares within 2 years after the grant date or within 1 year after
exercise, part of the gain is ordinary income. The Holder shall tell the Company within 30 days after any such sale. The Company shall give the statement section 6039 of the Code requires by January 31 of the year after an exercise.

(d) **Section 409A.** Options are meant to stay outside section 409A of the Code, because each is priced at no less than Fair Market Value on its grant date, covers a fixed number of shares of common stock and has no deferral feature. The Company
shall not change an Option in a way that brings it within section 409A without the Holder's written consent.

**18. Securities law.**

(a) **Rule 701.** Awards are meant to qualify under 17 CFR 230.701. The Company shall give each person a copy of this Plan and the Award Agreement before or when an Award is granted.

(b) **The cap.** The Company shall keep a running count. In any 12 months in a row, the total sale price or amount of securities sold under this Plan and any other Rule 701 plan may not exceed the greatest of $1,000,000, 15% of the Company's total assets and 15% of
the outstanding Common Stock, as that rule measures them. An Option counts when granted, at its exercise price and for the shares it covers. A grant above the cap needs another exemption first.

(c) **Above $10 million.** If those sales pass $10 million in any 12 months in a row, then a reasonable time before each sale, and for an Option before exercise, the Company shall give each buyer a summary of this Plan's material terms, information about
the risks, and the financial statements that rule requires, as of a date no more than 180 days before the sale.

(d) **Colorado.** For a person in Colorado, the Company relies on section 11-51-307(1)(i) of the Colorado Revised Statutes and, if that doesn't apply, section 11-51-308(1)(i). Before a grant to a person in another state, the Company shall confirm that state's rule.

(e) **Blocked exercise.** The Company may delay an exercise only if and for as long as securities law requires it. It shall tell the Holder in writing which law and why, and it shall try in good faith to clear the block. Section 10(g) applies.

(f) **Restricted shares.** Plan Shares are restricted securities. They haven't been registered and can't be resold without registration or an exemption. There may never be a market for them. The Company has no duty to register them.

**19. Information.**

(a) **On request.** Within 10 business days after a Holder asks, the Company shall give the Holder a statement of the Holder's Awards and Plan Shares, vested and unvested, and of the most recent Fair Market Value.

(b) **Each year.** Within 120 days after each fiscal year, the Company shall give each Holder with a vested Option or vested Plan Shares its annual financial statements, which need not be audited, and a summary of its outstanding stock, options and other convertible securities.

(c) **Before a decision.** A Holder whose Service has ended may ask once for those items, as most recently prepared, and for the most recent valuation report, before deciding whether to exercise. The Company shall answer within 10 business days.

(d) **If the Company relies on Rule 12h-1(f).** While it relies on 17 CFR 240.12h-1(f), the Company shall give Holders of Options the information 17 CFR 230.701(e)(3), (4) and (5) describes every six months, with financial statements no more than 180 days old.

(e) **Confidentiality.** A Holder shall keep this information confidential and use it only to manage the Holder's Awards and Plan Shares. The Holder may share it with the Holder's lawyers and tax and financial advisers who keep it confidential. The Company may withhold it from a Holder who won't agree to this. Section 23 limits this paragraph.

(f) **Stockholder rights.** This section adds to any inspection right the law gives a stockholder.

**20. Start, approval and end.**

(a) This Plan starts on the date the Board adopts it.

(b) The stockholders must approve it within 12 months before or after that date, as the Company's charter, bylaws and state law require. No Incentive Stock Option may be exercised before that approval. If it isn't given on time, each Option granted as an Incentive Stock Option is a Nonstatutory Option.

(c) No Award may be granted after the 10th anniversary of the earlier of the date the Board adopted this Plan and the date the stockholders approved it, or after the Board ends this Plan if that's sooner. Awards then outstanding go on under their terms.

**21. Amendment.**

(a) The Board may amend or end this Plan at any time, subject to this section.

(b) Stockholders must approve, within 12 months before or after, an increase in the reserve in section 3 other than under section 15, a change in who is eligible for Incentive Stock Options, or a change in the company or stock under this Plan. Until they do, no Incentive Stock Option may be granted that depends on the change.

(c) **No harm without consent.** No amendment of this Plan or an Award Agreement, and no action by the Administrator, may materially harm a Holder's outstanding Award or Plan Shares without that Holder's written consent. That includes shortening an exercise period, raising an exercise price, slowing vesting, adding a right to buy or a new transfer limit, narrowing the protections in sections 11 and 14, adding a condition to exercise, or changing this section.

(d) **What isn't covered.** Paragraph (c) doesn't apply to a change the law requires, if it's the narrowest change that works and applies alike to all Holders in the same position; to an adjustment under section 15; or to treatment that section 14 allows.

(e) **Changing an Incentive Stock Option.** Changing an Incentive Stock Option can end its tax treatment, even if the change only helps. The Company shall tell the Holder this before making any change. An offer to change one shall stay open for fewer than 30 days.

(f) **Enforcing this.** A Holder may enforce this section in court, including by an order stopping a change.

**22. Service and pay.**

(a) Nothing in this Plan is a promise of continued Service. The Board may remove anyone from an office as the law and the Company's bylaws allow. That doesn't affect a Holder's rights under this Plan.

(b) An Award is in addition to wages, and does not replace them. The Company shall pay all wages, overtime, earned vacation and other compensation in the form and at the time the law requires. Nobody may be asked to take an Award in place of wages already earned or in place of pay the law requires. A dispute about an Award doesn't delay any wages.

**23. Protected rights.** Nothing in this Plan limits a right that the law says cannot be waived, or stops a Holder from communicating with a government agency, reporting a possible violation of law, discussing wages or working conditions, or giving truthful testimony, in each case without telling the Company. Under 18 U.S.C. 1833(b), an individual can't be held liable under any federal or state trade secret law for disclosing a trade secret in confidence to a government official or a lawyer solely to report or investigate a suspected violation of law, or in a document filed under seal in a lawsuit or other proceeding.

**24. General.** This Plan and each Award Agreement are governed by the laws of {{GOVERNING_STATE}}, without its conflict of law rules, except that the law of the Company's state of incorporation governs its internal affairs. A dispute starts with written notice and a meeting within 10 business days, then mediation within 30 days after that, and then goes to the courts of {{GOVERNING_STATE}}. A claim about the Company's internal affairs, including a claim that a director, officer or stockholder breached a duty, goes to the courts the Company's charter or bylaws name, if they name any. Either side may go straight to court for urgent relief or to protect a deadline. For a party to a Founders' Agreement, its dispute steps apply instead, and it controls if it conflicts with this Plan while it's in effect, except that section 11(g) decides which Cause terms apply. Notices are in writing and go to the Company at {{COMPANY_ADDRESS}} and to the Holder at the address in the Award Agreement, or to a later address given by notice. Notice by email counts if the recipient confirms it or a copy also goes by tracked courier. This Plan binds successors. If this Plan and an Award Agreement conflict, this Plan controls, unless the Award Agreement gives the Holder more protection. If a court finds a term unenforceable, the rest stands. Award Agreements may be signed in counterparts and electronically.

---

**EXHIBIT A: NOTICE OF OPTION GRANT AND OPTION AGREEMENT**

{{COMPANY_NAME}} grants this Option under its Equity Incentive Plan (the "Plan"). Words the Plan defines mean the same thing here.

| | |
|---|---|
| Holder | {{HOLDER_NAME}} |
| Holder's address | {{HOLDER_ADDRESS}} |
| Grant date | {{GRANT_DATE}} |
| Shares of Common Stock | {{NUMBER_OF_SHARES}} |
| Exercise price per share | ${{EXERCISE_PRICE_PER_SHARE}} |
| Fair Market Value per share on the grant date, as the Board determined it | ${{FAIR_MARKET_VALUE_PER_SHARE}}, based on a valuation as of {{VALUATION_DATE}} |
| Vesting start date | {{VESTING_START_DATE}} |
| Expiration Date | {{EXPIRATION_DATE}} |

**1. Type.**

[OPTION A: Incentive stock option, for an employee who isn't a Ten Percent Holder. Recommended for employees.]
This Option is meant to be an Incentive Stock Option. It can't be exercised after the Expiration Date, which is no more than 10 years after the grant date. It's a Nonstatutory Option to the extent it passes the $100,000 limit in section 7(d) of the Plan.
[END OPTION A]

[OPTION B: Nonstatutory option, for anyone else, including a Consultant or a non-employee director.]
This Option is a Nonstatutory Option and will not be treated as an incentive stock option. It can't be exercised after the Expiration Date, which is no more than 10 years after the grant date.
[END OPTION B]

[OPTION C: Incentive stock option for a Ten Percent Holder.]
This Option is meant to be an Incentive Stock Option. The exercise price is at least 110% of Fair Market Value on the grant date. It can't be exercised after the Expiration Date, which is no more than 5 years after the grant date. It's a Nonstatutory Option to the extent it passes the $100,000 limit in section 7(d) of the Plan.
[END OPTION C]

**2. Vesting.**

[OPTION A: Four years, with a one-year cliff. Recommended for employees.]
25% of the shares vest on the first anniversary of the vesting start date, and 1/48 of the shares vest on each monthly anniversary after that, so all are vested on the fourth anniversary, in each case only if the Holder's Service has not ended before that date.
[END OPTION A]

[OPTION B: Two years, monthly, for a Consultant.]
1/24 of the shares vest on each monthly anniversary of the vesting start date, so all are vested on the second anniversary, in each case only if the Holder's Service has not ended before that date.
[END OPTION B]

[OPTION C: Two years, monthly, for a non-employee director.]
1/24 of the shares vest on each monthly anniversary of the vesting start date, so all are vested on the second anniversary, in each case only if the Holder's Service has not ended before that date. Serving only as a director counts as Service for this Option.
[END OPTION C]

**3. Exercise before vesting.**

[OPTION A: Only after vesting. Recommended.]
The Holder may exercise only the vested part.
[END OPTION A]

[OPTION B: Early exercise allowed.]
The Holder may exercise the unvested part as section 7(g) of the Plan says. The Holder has **30 days after the exercise** to file an election under section 83(b) of the Code for those shares.
[END OPTION B]

**4. Protection if removed.**

[OPTION A: Nothing beyond the Plan. Recommended for most hires.]
Only section 14(d) of the Plan speeds up vesting.
[END OPTION A]

[OPTION B: Added protection, for a senior hire.]
If the Company ends the Holder's Service without Cause, or the Holder resigns for Good Reason, the shares that would have vested in the next {{REMOVAL_ACCELERATION_MONTHS}} months vest on the date Service ends. This doesn't require a release.
[END OPTION B]

**5. Exercise and leaving.** The Holder exercises with the form in Exhibit B to the Plan. Sections 10 and 11 of the Plan say how long the Holder has after Service ends.

[OPTION A: Payment with shares allowed. Recommended.]
Besides cash, check or wire, the Holder may pay with shares the Holder already owns or, if this is a Nonstatutory Option, by having the Company hold back shares, as section 8(b) of the Plan says.
[END OPTION A]

[OPTION B: Cash, check or wire only.]
This Agreement doesn't allow payment with shares or held-back shares.
[END OPTION B]

**6. Transfer.**

[OPTION A: Will or inheritance only. Recommended, and the only choice for an Incentive Stock Option.]
This Option can't be transferred except by will or the laws of descent and distribution, and only the Holder may exercise it during the Holder's lifetime.
[END OPTION A]

[OPTION B: Family transfers too, for a Nonstatutory Option only.]
This Option can't be transferred except by will or the laws of descent and distribution, or to a family member by gift or domestic relations order as section 13(a) of the Plan says. Only the Holder or that family member may exercise it, or a guardian if the Holder can't act.
[END OPTION B]

Section 13 of the Plan also limits transfers of the shares, including by a right of first refusal, and this signature is the Holder's agreement to those limits.

**7. Holder's statements.** The Holder represents that: the Holder is taking this Option and any shares for the Holder's own account for investment and not to resell; the Holder has been able to ask questions about the Company; the Holder can bear the risk of losing whatever the Holder pays; the shares aren't registered and can't be sold without registration or an exemption, and there may never be a market for them; and the address above is where the Holder lives.

**8. Tax.** Section 17 of the Plan is a summary, not advice. The Holder has been advised to get the Holder's own tax advice and isn't relying on the Company for it.

**9. Pay.** This Option is in addition to wages and doesn't replace them. Section 22 of the Plan applies.

**10. The Plan.** The Holder has received a copy of the Plan, which is part of this Agreement. Section 21 of the Plan limits changes to this Option.

{{COMPANY_NAME}}

By: ______________________________ (an officer other than the Holder, if there is one) Date: {{SIGNING_DATE}}

______________________________
{{HOLDER_NAME}}

---

**EXHIBIT B: NOTICE OF EXERCISE**

To: {{COMPANY_NAME}}, attention Secretary

**1. Exercise.** I exercise my Option granted on {{GRANT_DATE}}, for {{SHARES_EXERCISED}} shares at ${{EXERCISE_PRICE_PER_SHARE}} per share, a total of ${{TOTAL_EXERCISE_PRICE}}, on {{EXERCISE_DATE}}.

**2. Payment.** I pay by: ☐ cash, check or wire; ☐ another way my Award Agreement allows, namely: ______________________; ☐ a promissory note the Disinterested Directors approved under section 8(b) of the Plan, only if the Plan allows notes.

**3. What I confirm.**

(a) I'm buying for my own account for investment and not to resell. The shares aren't registered, and I can't sell them without registration or an exemption. There may never be a market for them, and I can bear the risk of losing what I pay.

(b) The shares carry the transfer limits and right of first refusal in section 13 of the Plan.

(c) **Tax.** If this is a Nonstatutory Option, or an Incentive Stock Option I'm exercising more than 3 months after my employment ended (1 year if I stopped because of Disability), the spread is taxed as ordinary income now, and I shall pay any withholding the Company tells me is due. That time limit doesn't apply to an estate or heir exercising after the death of a person section 10(d) of the Plan describes. If this is an Incentive Stock Option I'm exercising in time, I'll tell the Company within 30 days if I sell the shares within 2 years after the grant date or 1 year after today.

(d) **Unvested shares.** If any of these shares are unvested, I have **30 days from today** to file an election under section 83(b) of the Code, and that duty is mine.

______________________________ Date: {{EXERCISE_DATE}}
{{HOLDER_NAME}}, {{HOLDER_ADDRESS}}

*Received by the Company on ______________. The Company shall record the shares within 10 business days (section 8(c) of the Plan).*

Legallas template held-back/equity-incentive-plan version 1. Law checked 2026-11-01. Not reviewed by a lawyer. Have your own lawyer review. Delete this line before signing.

<!-- TEMPLATE END -->

## Drafting notes

| Choice | Options | Recommendation and why | Where a lawyer should look |
|---|---|---|---|
| Size of the reserve | A fixed number; a formula | **A fixed number that covers your next 12 to 24 months of hires.** Stockholders must approve a maximum that can be determined. A plan that only says a percentage of shares outstanding at each grant doesn't qualify ([1.422-2(b)(3)(ii)][e422-2]). Investors usually reset the reserve at a priced round | Any automatic annual increase ([1.422-2(b)(3)(ii)][e422-2]); whether the charter has room |
| Who can receive awards | Employees, directors and natural-person consultants; employees only | **As drafted, but only employees get incentive stock options.** The plan has to name the class for those options separately ([1.422-2(b)(4)][e422-2]). A person must already be an employee on the grant date ([1.421-1(c)(2), (h)(1)][e421-1]), so an unpaid founder or a contractor doesn't qualify. Rule 701 covers consultants only if they're natural persons doing real work unconnected with raising capital or promoting the stock ([230.701(c)(1)][e701]). Don't pay a finder or a consulting company from this plan | Anyone whose employee status is unclear; anyone paid through their own company |
| Incentive or nonstatutory (Exhibit A, part 1) | A, incentive; B, nonstatutory; C, incentive above 10% | **A for employees who aren't above 10%.** No regular income tax at exercise and no Social Security or Medicare tax ([3121(a)(22)][us3121]), though the spread counts for the alternative minimum tax ([56(b)(3)][us56]). Above $100,000 first exercisable in a year, the rest is nonstatutory ([422(d)][us422]). For someone above 10%, counting family stock ([424(d)][us424]), the terms are 110% and 5 years, and if the valuation later proves low there's no good-faith rescue at that price ([1.422-2(f)(1)][e422-2]). Founders usually take nonstatutory options or more stock instead | [1.422-2(e), (f)][e422-2]; [422(c)(1)][us422] |
| How value is set | Independent appraisal; start-up report; the board's judgment alone | **6(d) requires one of the first two, because each is presumed reasonable and the IRS must then show gross unreasonableness** ([1.409A-1(b)(5)(iv)(B)(2)][e409a]). **Use the appraisal once there's a priced round, a term sheet or real revenue.** The start-up report is cheaper, but read its limits as written. The company must have no material business conducted for 10 years or more, and no traded equity. The stock can't be subject to a put, a call or other right to buy, except a right of first refusal on an unrelated third party's offer or a lapse restriction. The rule is lost if a sale is reasonably anticipated within 90 days or a public offering within 180. The writer must be qualified, generally with five years of relevant experience. The formula route in (2)(ii) rarely fits, because it doesn't apply to option stock that's transferable other than through a nonlapse restriction. A low price is costly: outside the exemption, the holder owes income tax, 20% more and interest ([26 U.S.C. 409A(a)(1)][us409a]) | Who is qualified; what news makes a value stale ([1.409A-1(b)(5)(iv)(B)(1)][e409a]); whether a term sheet or sale talks have started the 90-day clock |
| Exit window (10(c)) | A, longer, set now; B, 3 months | **A, with 12 months as a fair start.** The window and the tax rule are separate. An incentive stock option keeps its treatment only if exercised within 3 months after employment ends, or 1 year for a disabled employee ([422(a)(2), (c)(6)][us422]). After that it's taxed as a nonstatutory option, so the spread is ordinary income with withholding. A costs the holder nothing, because they can still exercise in 3 months. It matters most for someone just removed, who must find the price, and perhaps the tax, for stock they can't sell. **B** returns shares to the pool sooner and leaves fewer former staff as holders. **Set it now.** Extending the window later is a modification and a new grant, whether or not the holder benefits ([1.424-1(e)(2), (e)(4)(i)][e424-1]), which usually ends incentive status if the stock has risen. For section 409A, moving the date isn't an extension if it stays within the original latest expiry and 10 years ([1.409A-1(b)(5)(v)(C)(1)][e409a]). Death is different: the estate keeps the treatment, even if it exercises after 3 months, if the holder was employed at death or within 3 months before, or within 1 year if disabled ([421(c)(1)(A)][us421]; [1.421-2(c)][e421-2]) | Withholding for a former employee; what investors will accept |
| Cause | Same list, exclusions and process as the founder stock agreement; broader | **Keep them matched.** Section 11(a) to (c) tracks section 5 of the [founder stock purchase agreement](../founders/founder-stock-purchase.md), because two definitions in one company invite a fight over which applies. That agreement now carries the same Neutral (its 3(e), (f)), the same notice limit (5(c)), the rule that a finding isn't final until any challenge ends and a court owes it no deference (5(d)), and a no-Cause remedy (5(e)). **What still differs here.** 11(a)(v) also counts a direction from the Holder's manager, because a plan covers staff who don't report to the board. The late notice in 11(c) works only while an Option remains outstanding. The hold in 11(d) also stops exercise, so it starts at the written decision, not the notice. 11(e) sets what a final finding does to options. 11(f) goes further than the stock agreement's 5(e): it restarts exercise periods, pays cash if the Expiration Date passed during a hold, and pays the Holder's reasonable legal costs. Under 11(g), another agreement's Cause terms apply only where they protect the Holder more, so a founder keeps the stock agreement's board-only direction test, and an employment agreement can't wipe out 11(b). Section 11 governs awards only, and doesn't limit firing anyone | Whether the no-deference clause holds; whether you want a lighter process for junior staff; whether firing someone to kill an award breaches good faith, which is judge-made; which term protects the Holder more, if that's disputed under 11(g) |
| Cause and vested options (11(e)) | A, only crime or fraud ends them; B, any finding does | **A.** A vested option is pay for work already done, and the people deciding Cause may be the ones who want the holder out. **B** is the stricter term and is easy to use as a weapon, so if investors insist, keep 11(c) and (d). Neither touches shares already bought. The hold in 11(d) is there so nothing has to be cancelled and re-created: a new option at the old price, when the stock is worth more, would be a grant below fair value ([1.409A-1(b)(5)(i)(A)][e409a]). It starts at the written decision, not the notice, because the 3-month limit has no pause ([422(a)(2)][us422]): a notice 30 days after leaving plus a 60-day hold would use nearly all of it. So a holder can exercise between notice and decision, and section 12 lets them keep those shares unless Option B applies. A hold that outlasts the limit still costs incentive treatment, and 11(f) doesn't pay for that | Whether the hold or the cash payment in 11(f) raises a section 409A issue ([1.409A-1(b)(5)(i)(D)][e409a]), which is for your own tax professional |
| Vested shares (12) | A, no right to buy; B, fair value, only on a final finding of crime or fraud | **A, and don't take a below-value buy-back at all.** Four reasons. First, stock subject to a call at a price other than fair market value, unless it's a lapse restriction, isn't "service recipient stock", and an option on stock that isn't can be deferred compensation ([1.409A-1(b)(5)(iii)(A), (i)(C)][e409a]). A [2016 proposed rule][fr409a] would excuse a below-value price on a for-cause firing or a condition within the holder's control, and says taxpayers may rely on it, but that text isn't in the eCFR as of 2026-10-29. Second, even at fair value, a call on vested stock may cost you the start-up report unless it counts as a lapse restriction ([1.409A-1(b)(5)(iv)(B)(2)(iii)][e409a]; [1.83-3(i)][e83-3]). B ends with the transfer limits for that reason, which your own tax professional should confirm. Third, it's a securities purchase, so what the buyer knows must be disclosed ([17 CFR 240.10b-5][e10b5]; [11-51-501, -604][t11]). Fourth, it's a distribution with legal limits ([7-106-401][t7]; [160][d8s5]). Earned stock stays earned | Any call on vested stock; a company's repurchases can also affect qualified small business stock, as the [founder stock agreement](../founders/founder-stock-purchase.md) notes |
| Right of first refusal (13) | Unrelated third-party offers only, as drafted; any transfer | **As drafted.** It's the only kind the start-up report allows ([1.409A-1(b)(5)(iv)(B)(2)(iii)][e409a]), so sales to related people go through a consent, not a right to buy. State law permits both ([7-106-208(4)(a), (c)][t7]; [202(c)(1), (3)][d8s6]), and a consent can't be manifestly unreasonable in Colorado. Options count as shares for this ([7-106-208(5)][t7]). Assigning the right pro rata stops anyone using it to shift control | Whether the consent could itself be a "right or obligation" under that rule; whether the competitor limit in 13(e) is manifestly unreasonable on your facts ([7-106-208(4)(d)][t7]; [202(c)(5)][d8s6]) |
| Vesting on a sale (14(d)) | A, buyer doesn't take it on, or pushed out around a sale; B, sale alone; C, buyer doesn't take it on | **A.** Nobody loses unvested equity because of a buyer's choice, the buyer keeps its retention, and someone fired right after closing is protected. **B** is the form buyers resist, because it leaves them nothing to retain people with. **C** leaves a person fired the day after closing with nothing. Faster vesting isn't a modification ([1.424-1(e)(4)(ii)][e424-1]; [1.409A-1(b)(5)(v)(E)][e409a]), but it counts toward the $100,000 limit in the year it's triggered ([1.422-4(b)(4)][e422-4]). Big payments to insiders may be parachute payments. A private company can clear them with a vote of more than 75% after disclosure ([280G(b)(5)][us280g]) | [280G][us280g]; the Good Reason steps against [1.409A-1(n)(2)][e409a] |
| How a sale treats options (14(b)) | As drafted; the board picks freely | **As drafted.** The same treatment for the same type and status stops a board from favoring friends. An assumption must keep the spread ([424(a)][us424]; [1.424-1(a)][e424-1]; [1.409A-1(b)(5)(v)(D)][e409a]). A cash-out at the spread doesn't hurt incentive status ([1.422-5(d)(3)][e422-5]). Paying on the stockholders' schedule within 5 years fits the section 409A rule for deal payments ([1.409A-3(i)(5)(iv)(A)][e409a3]). Under (iii), a holder can also exercise what will vest under 14(d), so a part sped up at closing can't lapse unexercised | Escrows, earn-outs and any buyer demand for a release |
| Removal protection (Exhibit A, part 4) | A, the plan only; B, months of faster vesting | **A for most hires. B for a senior hire with real exposure.** It matches the [founder stock agreement](../founders/founder-stock-purchase.md), and **12** months is a fair start for someone senior. Investors may push back | Interaction with severance and with [1.409A-1(n)(2)][e409a] |
| What a hostile board can do (21) | Holder's consent for any harm, as drafted; a free hand | **Keep the consent right.** See the list after this table. Both states already keep a new transfer limit from binding existing shares unless the holder agrees ([7-106-208(1)][t7]; [202(b)][d8s6]). 21(e) exists because changing an incentive stock option can cost the treatment even if it only helps ([1.424-1(e)(4)(i), (iii)][e424-1]; [1.422-2(a)(3)][e422-2]), and an offer open fewer than 30 days isn't itself a modification | Whether these limits bind a future board against its duties. 5(i) is the safety valve |
| Who decides when a director is conflicted (5) | Disinterested directors, then disinterested holders, then a Neutral; the full board | **As drafted.** A director's own award is a conflict. Colorado protects it after disclosure by a majority of disinterested directors, a vote of disinterested shareholders, or fairness ([7-108-501(2)][t7]). Delaware is similar, but if most directors aren't disinterested the board route needs a committee of 2 or more disinterested directors ([144(a)(1)][d8s4]). If every director is a founder, use the holder vote or record why it's fair. When the Holder is one of two directors, 5(f) treats the other as having a personal stake in a Cause decision and sends it to a Neutral, because otherwise a rival would decide alone. On a larger board, a rival is caught only if a personal stake can be shown | [144(b), (c)][d8s4] if a director is a controlling stockholder; whether anyone on your board is really disinterested |
| Letting others grant (5(c)) | Board only; a committee; an officer | **Board only until you grant often.** Colorado lets a committee or officer act within limits the board specifically prescribes ([7-108-206(4)(h)][t7]), and creating a committee takes at least a majority of all directors in office ([7-108-206(2)][t7]). Delaware needs the three limits in the resolution, and bars granting to yourself ([152(b)][d8s5]; [157(c)][d8s5]). 5(c) applies the stricter of both. Fair market value stays with the board. In Colorado a committee can't authorize a distribution, and a buy-back is one, so 5(b) keeps that with the board too ([7-108-206(4)(a), (g)][t7]) | Whether Colorado's text reaches options, since [7-106-205(2)][t7] says the board determines their terms. Put the form of award in the resolution |
| Contests for control (16) | Keep; delete | **Keep it.** Equity is a tool in a fight for the board. Incumbents can hand it to friends or take it from opponents, and a new majority can do the same. 16 limits both sides while the fight runs. 16(a) needs a 5% holding, or an offer with evidence of funds, and caps the period at 180 days, so a stray letter can't freeze grants or move a Cause decision to a Neutral. A real 5% holder can still start one after a Cause notice and move the decision to a Neutral, a risk accepted because a Neutral is a fair decider. A fight that outlasts the cap loses 16(b) and (c), but keeps 16(d) and 21. A change of directors isn't a Change of Control (14(a)), because counting it would make awards a defense against a vote. Colorado even lets a board write rights that shut out a "significant shareholder" ([7-106-205(1)(b), (3)][t7]), without changing directors' duties ([7-106-205(4)][t7]). This plan doesn't use that power, and 16(d) rules it out for awards | Delaware courts look hard at board action that affects a contested vote. That's judge-made and wasn't researched here. Check 16, including the 5% and the 180 days, against your actual fight |
| Paying with a note (8(b)) | A, none; B, outside collateral | **A.** In Colorado, a note isn't consideration at all unless it's negotiable and secured by collateral other than the shares, worth at least the principal, and a nonrecourse note doesn't count ([7-106-202(5)][t7]). Few holders have that collateral. A loan to a director is also a conflict ([7-108-501(1)(a)(I)][t7]). Delaware has no such text, but the board must decide the form ([152(a)][d8s5]). If a holder can't pay, the longer window is the better answer | Whether shares paid with a failed note are validly issued; imputed interest; how a nonrecourse note is taxed |
| Paying with stock or held-back shares (8(b), Exhibit A, part 5) | A, allowed; B, cash, check or wire only | **A.** It helps a holder who can't find the cash, and the company pays out nothing for it. Paying an incentive stock option with stock already owned is allowed ([422(c)(4)(A)][us422]; [1.422-5(b)][e422-5]). Holding back shares is limited to nonstatutory options here, since [1.422-5(b)][e422-5] speaks of previously acquired stock. Check the company has cash for any withholding | How held-back shares would work on an incentive stock option |
| Family transfers (13(a), Exhibit A, part 6) | A, will or inheritance only; B, family members too | **A for most hires.** An incentive stock option must be limited to that by its own terms ([422(b)(5)][us422]), so B is only for a nonstatutory option. B stays within what the registration exemption for options allows: gifts or domestic relations orders to a family member, and an executor or guardian on death or disability ([230.701(c)(3)][e701]; [240.12h-1(f)(1)(iv)][e12h1]) | A senior holder's estate planning |
| Exercise before vesting (Exhibit A, part 3) | A, only after vesting; B, early | **A for most hires.** B lets someone start the clock while the value is low, with an 83(b) election within 30 days ([26 U.S.C. 83(b)(2)][us83]). But an option exercisable at once counts all at once toward the $100,000 limit ([1.422-4(b)(4)][e422-4]), and the holder pays cash for stock that may be bought back | Whether the holder understands the risk |
| What restricted stock is paid with (9(b)) | Cash or past services; future services | **Cash or past services.** Colorado's list names "services performed", not a promise of future work ([7-106-202(2)][t7]). Delaware allows any benefit ([152(a)][d8s5]), at no less than par ([153(a)][d8s5]). Stock for services is income under section 83, when it vests or, with an 83(b) election, when it's transferred ([26 U.S.C. 83(a), (b)][us83]), so restricted stock suits the very start, when value is near nothing. After that, options are simpler | Whether a promise of future services can count in Colorado; the 83(b) cost |
| Does board service count as Service? | Not unless the award says so; always | **Not unless it says so.** Same reasoning as the founder stock agreement: a person shouldn't keep vesting by keeping a seat, or every fight becomes about the seat. Exhibit A, part 2, Option C turns it on for an outside director | A founder who stays on as a paid adviser |
| Information (19) | As drafted; only what the law requires | **As drafted.** A person holding only an option isn't a stockholder, so the inspection statutes don't help them ([7-116-102][t7]; [220][d8s7]). They can't decide whether to pay to exercise without information, and a hostile board has no reason to volunteer it. 19(d) is the promise [17 CFR 240.12h-1(f)(1)(vi)][e12h1] needs in the plan or another agreement | Whether 19(c)'s valuation report is too much for your company; confidentiality terms ([240.21F-17][e21f17]; [18 U.S.C. 1833(b)][us1833]) |
| Securities exemptions (18) | Rule 701 and Colorado's exemptions, as drafted; a filed registration | **As drafted.** Rule 701 needs a written compensatory plan, delivery of the plan and a 12-month cap on the aggregate sales price or amount of securities sold: the greatest of $1 million, 15% of total assets or 15% of the class. Options count at grant, at their exercise price and for the shares they cover ([230.701(c), (d), (e)][e701]). For example, options on 2,000,000 shares at $0.10 count as $200,000 against the dollar tests and 2,000,000 shares against the class test, and clearing any one test is enough. Above $10 million, added disclosure is due a reasonable time before sale or exercise ([230.701(e)][e701]). It isn't for raising money ([230.701][e701], preliminary note 5), and fraud law still applies (note 1). Failing it leaves other exemptions (note 3), such as [15 U.S.C. 77d(a)(2)][us77d]. Shares are restricted ([230.701(g)][e701]; [230.144][e144]). In Colorado, [11-51-307(1)(i)][t11] covers securities issued with "an employee's" benefit plan, so for a director or consultant lean on [11-51-308(1)(i)][t11], transactions not involving a public offering | Whether options and non-employees fit 11-51-307(1)(i); whether [11-51-308(1)(p)][t11], with its notice and fee, is needed; every other state where a holder lives |
| Holder count (notes only) | Watch it; ignore it | **Watch it.** A company with over $10 million in assets must register a class held of record by 2,000 people, or by 500 who aren't accredited ([15 U.S.C. 78l(g)(1)(A)][us78l]). It may leave out securities received under an employee plan in exempt transactions ([240.12g5-1(a)(8)][e12g5]), and options can be exempt under conditions ([240.12h-1(f)][e12h1]). 13(a) and 19(d) carry those conditions now, so nothing has to change later. 13(e) lets the company refuse a transfer that would trigger registration ([7-106-208(3)(b)][t7]; [202(d)(2)][d8s6]) | Anyone whose stock came from outside the plan; the count at each financing |
| Wages (22) | As drafted | **Keep it.** Equity isn't a substitute for required pay. In Colorado, wages can't be paid with a note or other paper unless it's negotiable and payable in cash on demand ([8-4-102(1)][t8]), and an agreement to waive wage rights is void ([8-4-121][t8]). Pay counts as wages once earned, vested and determinable ([8-4-101(14)(a)(I)][t8]), and on discharge it's due at once ([8-4-109(1)(a)][t8]). A person who owns 25% or more of the employer can be personally covered as an employer, unless a minority owner has fully delegated control ([8-4-101(6)][t8]). Deductions are limited ([8-4-105(1)][t8]), which is why 17(b) leans on payment by the holder. Don't offer stock to someone you can't pay | Whether a vested award or a promised grant counts as compensation under [8-4-101(14)][t8]; minimum wage rules for anyone paid mostly in equity |
| Forfeiture for competing | None here | **Leave out.** A covenant not to compete is void for most Colorado workers ([8-2-113(2)(a)][t8]), and presenting or trying to enforce a void one brings damages and a $5,000 penalty per worker ([8-2-113(8)][t8]). Whether taking away equity for competing counts as such a covenant wasn't researched, and it's not worth the risk at this stage. The exception for selling a business is narrow for a minority holder who got stock for services ([8-2-113(3)(c)][t8]) | Any request from an investor or buyer to add it |

**What a hostile board can still do.** It can end someone's Service, stop new grants, issue more stock and dilute everyone, refuse to waive anything in a holder's favor, and make a Cause finding through the process in section 11. What it can't do, without the holder's consent, is shorten an exercise period, raise a price, slow vesting, add a right to buy or a new transfer limit, or narrow sections 11 and 14, whether by amendment or in a stockholder agreement required at exercise (8(d)). In a sale, it can't cancel an in-the-money vested option without either paying the spread or giving the chance to exercise out of the proceeds. It can't sit on an exercise, with one exception. A notice of Cause alone doesn't stop exercise, but from a written decision until the finding is final, the part the finding could end can't be exercised. That hold doesn't stop the 3-month limit on incentive stock option treatment ([422(a)(2)][us422]), and 11(f) doesn't pay for that loss, so a board can still cost a holder the tax treatment by deciding Cause soon after employment ends. A holder in that spot should have their own tax professional look at it quickly, and may want to exercise before any decision. These are contract rights, so they're worth what a holder can enforce. That's why 11(f) shifts legal costs and 21(f) names a court order. None of this replaces a lawyer once the fight has started.

**When investors arrive.** Expect a priced round to reset the reserve, ask holders to sign a stockholder agreement, and possibly add a drag-along and revisit sections 10, 12 and 14. Section 8(d) lets the company require an agreement that binds all holders of 1% or more, but under 21(c) a right to buy, a new transfer limit or anything else that harms an outstanding award or Plan Shares needs that holder's written consent. This plan has no drag-along now. Before adding one, or any other right to buy, even with consent, ask whether it's a "right or obligation" that costs the start-up report ([1.409A-1(b)(5)(iv)(B)(2)(iii)][e409a]).

**Not covered.** Accounting for equity pay, ERISA, holders outside the United States and non-U.S. tax.

## What couldn't be checked

- **Enforceability of sections 11(d), 11(f), 16 and 21.** No Colorado or Delaware decision on terms like these was checked. Whether they can bind a future board against its fiduciary duties is for a lawyer.
- **Review of board action in a contest for control** is judge-made in both states and wasn't researched.
- **Tax on the hold and the cash payment in 11(d) and (f), and on Option B of section 12.** Whether a fair-value call that lapses counts as a lapse restriction, and whether the consent in 13(c)(v) is a "right or obligation" under the start-up rule, weren't settled. No ruling was read.
- **The 2016 proposed rule.** Its text was read on the Federal Register. It wasn't in the eCFR section read as of 2026-10-29. Whether later guidance changed it wasn't checked.
- **Colorado's reach.** Nothing was found on whether [7-108-206(4)(h)][t7] covers options as well as shares, or whether [11-51-307(1)(i)][t11] covers options and non-employees. No rule of the Securities Commissioner was read.
- **Whether equity counts as wages,** and whether a forfeiture for competing is a covenant under [8-2-113][t8]. Not found.
- **What's customary.** Statements about what investors or buyers expect are the drafter's general understanding, not data. No law firm's plan or restricted form was read, by design.
- **No lawyer or tax professional has reviewed this.** A second reader compared it with the statutes and rules, but that isn't a lawyer's review.

## Sources

[C.R.S. Title 7][t7], [Title 8][t8] and [Title 11][t11], 2026 edition. [8 Del. C. ch. 1, subch. IV][d8s4], [subch. V][d8s5], [subch. VI][d8s6] and [subch. VII][d8s7], read 2026-11-01. U.S. Code: [15 U.S.C. 77d][us77d], [78l][us78l]; [18 U.S.C. 1833][us1833]; [26 U.S.C. 22][us22], [56][us56], [83][us83], [280G][us280g], [401][us401], [409A][us409a], [421][us421], [422][us422], [424][us424], [3121][us3121], [6039][us6039]. eCFR as of 2026-10-29: [17 CFR 230.144][e144], [230.701][e701], [240.10b-5][e10b5], [240.12g5-1][e12g5], [240.12h-1][e12h1], [240.21F-17][e21f17]; [26 CFR 1.83-2][e83-2], [1.83-3][e83-3], [1.83-7][e83-7], [1.409A-1][e409a], [1.409A-3][e409a3], [1.421-1][e421-1], [1.421-2][e421-2], [1.422-2][e422-2], [1.422-3][e422-3], [1.422-4][e422-4], [1.422-5][e422-5], [1.424-1][e424-1]. [81 Fed. Reg. 40569][fr409a]. [IRS Form 15620][f15620]. Section 22(e)(3), section 401(a)(28)(C) and [1.83-7][e83-7] back sections 2, 6(d) and 17(b).

[t7]: https://olls.info/crs/crs2026-title-07.pdf
[t8]: https://olls.info/crs/crs2026-title-08.pdf
[t11]: https://olls.info/crs/crs2026-title-11.pdf
[d8s4]: https://delcode.delaware.gov/title8/c001/sc04/index.html
[d8s5]: https://delcode.delaware.gov/title8/c001/sc05/index.html
[d8s6]: https://delcode.delaware.gov/title8/c001/sc06/index.html
[d8s7]: https://delcode.delaware.gov/title8/c001/sc07/index.html
[us77d]: https://uscode.house.gov/us/usc/t15/s77d/
[us78l]: https://uscode.house.gov/us/usc/t15/s78l/
[us1833]: https://uscode.house.gov/us/usc/t18/s1833/
[us22]: https://uscode.house.gov/us/usc/t26/s22/
[us56]: https://uscode.house.gov/us/usc/t26/s56/
[us83]: https://uscode.house.gov/us/usc/t26/s83/
[us280g]: https://uscode.house.gov/us/usc/t26/s280G/
[us401]: https://uscode.house.gov/us/usc/t26/s401/
[us409a]: https://uscode.house.gov/us/usc/t26/s409A/
[us421]: https://uscode.house.gov/us/usc/t26/s421/
[us422]: https://uscode.house.gov/us/usc/t26/s422/
[us424]: https://uscode.house.gov/us/usc/t26/s424/
[us3121]: https://uscode.house.gov/us/usc/t26/s3121/
[us6039]: https://uscode.house.gov/us/usc/t26/s6039/
[e144]: https://www.ecfr.gov/current/title-17/section-230.144
[e701]: https://www.ecfr.gov/current/title-17/section-230.701
[e10b5]: https://www.ecfr.gov/current/title-17/section-240.10b-5
[e12g5]: https://www.ecfr.gov/current/title-17/section-240.12g5-1
[e12h1]: https://www.ecfr.gov/current/title-17/section-240.12h-1
[e21f17]: https://www.ecfr.gov/current/title-17/section-240.21F-17
[e83-2]: https://www.ecfr.gov/current/title-26/section-1.83-2
[e83-3]: https://www.ecfr.gov/current/title-26/section-1.83-3
[e83-7]: https://www.ecfr.gov/current/title-26/section-1.83-7
[e409a]: https://www.ecfr.gov/current/title-26/section-1.409A-1
[e409a3]: https://www.ecfr.gov/current/title-26/section-1.409A-3
[e421-1]: https://www.ecfr.gov/current/title-26/section-1.421-1
[e421-2]: https://www.ecfr.gov/current/title-26/section-1.421-2
[e422-2]: https://www.ecfr.gov/current/title-26/section-1.422-2
[e422-3]: https://www.ecfr.gov/current/title-26/section-1.422-3
[e422-4]: https://www.ecfr.gov/current/title-26/section-1.422-4
[e422-5]: https://www.ecfr.gov/current/title-26/section-1.422-5
[e424-1]: https://www.ecfr.gov/current/title-26/section-1.424-1
[fr409a]: https://www.federalregister.gov/documents/2016/06/22/2016-14331/application-of-section-409a-to-nonqualified-deferred-compensation-plans
[f15620]: https://www.irs.gov/pub/irs-pdf/f15620.pdf
