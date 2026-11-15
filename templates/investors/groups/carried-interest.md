---
id: investors/groups/carried-interest
title: Carried interest, and who can take it
path: angels-create-groups
kind: explainer
level: [federal, colorado]
entity: [angel-group-llc, spv-llc, spv-lp]
statutes:
  - 15 U.S.C. 80b-5(a)(1), (b)(4), (e) (Advisers Act 205)
  - 17 CFR 275.205-3; SEC order of 2026-04-28 adjusting its dollar tests (91 FR 23520)
  - 15 U.S.C. 80b-2(a)(11); 80b-3(l), (m)
  - 15 U.S.C. 78c(a)(4), 78o(a); 77d(c)
  - 17 CFR 230.506(d)
  - 3 CCR 704-1, Rule 51-4.11(IA); C.R.S. 11-51-401
  - C.R.S. 7-133-101 (nonprofit corporations and distributions)
  - 26 U.S.C. 1061
source: Original drafting for Legallas from the statutes and rules listed. No vehicle agreement was read or adapted.
licence: CC0-1.0
date_checked: 2026-11-01
fields:
  vehicle_name: The vehicle's name
  manager_name: The managing member or general partner that receives carried interest
  carry_percent: The carried interest percentage (for example, 20%)
  preferred_return: Any hurdle rate investors receive before carried interest, or "none"
  carry_recipients: The individuals who share in the manager's carried interest, and their shares
---

# Carried interest, and who can take it

**Legallas is an AI agent for legal work, not a lawyer or law firm. Using it creates no attorney-client relationship. AI can be wrong. Have your own lawyer review before you sign, file or rely on anything. No lawyer has reviewed this.** Have your own lawyer look before anyone
is paid.

## In one screen

Carried interest ("carry") is a share of a vehicle's profits paid to the person who runs it, usually 20%, after
investors get their money back. It is the most common way a syndicate lead or fund manager is paid. Three bodies of law
decide who can take it: **adviser law** (a share of gains is a performance fee), **broker law** (pay tied to a deal can
look like a commission), and **tax law** (carry is taxed as long-term gain only after three years). A group itself that
is a nonprofit can't take carry and pass it to members.

## How carry works

A one-deal vehicle's operating agreement sets a "waterfall": the order in which money from an exit is paid out.

1. Investors get back the money they put in.
2. If there is a preferred return (a hurdle), investors get that next.
3. Profits above that are split: the carry percentage to the manager, the rest to investors.

**Example, with invented figures.** Members put $500,000 into a vehicle that buys one company's shares. Years later the
shares sell for $2,000,000, after expenses. Members first get back $500,000. The $1,500,000 profit is split 20% to the
manager ($300,000) and 80% to the members ($1,200,000).

In a pooled fund with many deals, carry is usually measured across the whole fund, so losses on some deals offset gains
on others before the manager is paid. A "clawback" makes the manager return carry if later losses mean it was overpaid.

## Who can take it

### Adviser law: is carry a performance fee?

Section 205(a)(1) of the Advisers Act bars a performance fee (pay based on a share of capital gains) **for an adviser
registered or required to be registered with the SEC** ([15 U.S.C. 80b-5(a)][us80b5]). Since 2010 the section has used
those words; before, it reached every adviser not exempt under section 203(b). Two consequences:

- **A manager who is an exempt reporting adviser** (relying on the venture capital fund exemption or the private fund
  exemption under $150 million) is not "registered or required to be registered", so section 205(a)(1) doesn't reach it
  by its words ([80b-3(l), (m)][us80b3]).
- **A manager registered with the SEC** may charge carry to a fund relying on 3(c)(7) ([80b-5(b)(4)][us80b5]), or to
  "qualified clients" under Rule 205-3 ([17 CFR 275.205-3][e205-3]). For a fund relying on 3(c)(1), each investor is
  treated as a client. From 2026-06-29 a qualified client must have at least $1,400,000 under the adviser's management,
  or a net worth over $2,700,000 (excluding the primary residence), or be a qualified purchaser
  ([SEC order, 91 FR 23520][fr-205]).

**Colorado.** A manager exempt from a Colorado licence under Rule 51-4.11(IA) who advises a 3(c)(1) fund that is not a
venture capital fund must meet extra conditions, including that each investor be a qualified client (net worth measured
without the primary residence), with written disclosures to each investor and audited financial statements every year
([3 CCR 704-1][ccr]). A venture capital fund avoids those extra conditions. So a
Colorado manager of a non-venture one-deal vehicle taking carry has a qualified client test to meet even when the
federal rule doesn't apply.

### Broker law: is carry a commission?

Carry paid on one deal looks more like pay tied to a transaction than carry measured across a fund. SEC staff allowed a
carry-only structure on the facts of the 2013 AngelList letters, for an adviser that charged no management fee
and no fee from companies ([AngelList letter][angellist], staff view). Without those facts, a person who finds the deal,
gathers the investors and takes carry should get a lawyer's view on broker registration
([15 U.S.C. 78c(a)(4), 78o(a)][us78o]) and Colorado licensing ([C.R.S. 11-51-401][t11]). The JOBS Act carve-out for
platforms requires no compensation in connection with the sale ([15 U.S.C. 77d(c)][us77d]), and carry is an economic
benefit, so don't rely on the carve-out for a person taking carry.

### Who in the group

| Person | Can take carry? | Notes |
|---|---|---|
| The vehicle's manager (managing member or general partner) | Yes, as the vehicle's agreement provides | The manager is the one with the adviser question |
| Individuals who do the work (the lead, the diligence team) | Through the manager, by the manager's own agreement | Each individual's share should be in writing, with vesting if the work continues |
| The group, if a nonprofit corporation | Not to pass on to members | A Colorado nonprofit corporation may not make distributions except as its act allows ([C.R.S. 7-133-101][t7]) |
| The group, if an LLC | Yes, if it is the manager | Then the group is the adviser |
| A member who only invests | No | Members get their pro rata share of profits |
| Anyone with a disqualifying event | Avoid | If the vehicle's manager or its officers have a bad actor event, the vehicle can lose Rule 506 ([17 CFR 230.506(d)][e506]) |

## Tax: the three-year rule

Gain allocated on carry ("an applicable partnership interest", held in connection with services in the business of
raising or returning capital and investing) is long-term capital gain only if the asset was held for more than three
years, not the usual one year ([26 U.S.C. 1061][us1061]). Gain on capital the manager itself invested follows the normal
rules. Carry only works through an entity taxed as a partnership.

## Fill-in clause: distributions with carried interest (one-deal vehicle)

For the operating agreement of a one-deal vehicle. Original drafting; a lawyer must fit it to the rest of the agreement.

> **Distributions.** The Manager will distribute Distributable Cash of {{vehicle_name}} within 90 days after receiving
> it, in the following order:
>
> (a) first, to the Members in proportion to their Capital Contributions, until each Member has received an amount equal
> to its Capital Contributions;
>
> (b) second, *[if there is a preferred return]* to the Members in proportion to their Capital Contributions, until each
> has received a return of {{preferred_return}} on its unreturned Capital Contributions; and
>
> (c) then, {{carry_percent}} to {{manager_name}} (the "Carried Interest") and the rest to the Members in proportion to
> their Capital Contributions.
>
> "Distributable Cash" means cash received from the sale of or distributions on the Portfolio Investment, less expenses
> and reserves the Manager reasonably sets aside for the Company's liabilities. Securities distributed in kind are valued
> at fair value and distributed as if they were cash.
>
> The Manager will report to each Member, with each distribution, the amounts paid under each of (a), (b) and (c).

Legallas template investors/groups/carried-interest version 1. Law checked 2026-11-01. Not reviewed by a lawyer. Have your own lawyer review. Delete this line before signing.

## Drafting notes

### Choice: how much carry, and on what

| Option | Notes |
|---|---|
| 20% of profit, no hurdle | Common on one-deal vehicles (practice) |
| 20% after a preferred return | More protective for members; more common in funds |
| Lower carry, such as 10% to 15% | Sometimes used where the manager also charges a fee |
| No carry; costs shared | Keeps the group simplest under broker and adviser law |

**Recommendation:** for a group's own vehicles, either take no carry (costs shared at actual cost), or take carry only
through a manager that files as an exempt reporting adviser and charges no fee from companies. Disclose the carry and
every other payment to the manager in the vehicle's documents before anyone subscribes.

**Where a lawyer should look:** broker exposure of a lead paid by carry on one deal; Colorado's qualified client
condition for a non-venture vehicle; who in the group receives a share of carry and whether any of them need a licence.

### Choice: who shares in the manager's carry: `{{carry_recipients}}`

**Recommendation:** put each person's share and vesting terms in the manager's own
written agreement. **Where a lawyer should look:** whether any recipient is "in the business" of advising or of
effecting securities transactions on their own account.

## Sources

Primary:

- [15 U.S.C. 80b-5][us80b5] (Advisers Act 205); [80b-3][us80b3]
- [17 CFR 275.205-3][e205-3]; [SEC order adjusting the qualified client dollar tests, 91 FR 23520 (2026-05-01)][fr-205]
- [15 U.S.C. 77d][us77d]; [78o][us78o]
- [17 CFR 230.506][e506]
- [3 CCR 704-1][ccr], Rule 51-4.11(IA); [C.R.S. title 11][t11]
- [C.R.S. 7-133-101][t7]
- [26 U.S.C. 1061][us1061]

Staff view:

- [SEC staff no-action letter, AngelList (2013)][angellist]

## What couldn't be verified

- The AngelList letters couldn't be opened from this session; their facts are as the design map recorded them.
- No authority says how carry on a one-deal vehicle is treated under the broker rules outside the AngelList facts.
- An SEC proposal published 2026-10-06, "Investment Adviser Performance-Based Compensation Modernization" (91 FR 63676),
  may change the qualified client test; it was too large for the research tool to analyze and wasn't read.

[us80b5]: https://uscode.house.gov/us/usc/t15/s80b-5/
[us80b3]: https://uscode.house.gov/us/usc/t15/s80b-3/
[e205-3]: https://www.ecfr.gov/current/title-17/section-275.205-3
[fr-205]: https://www.federalregister.gov/documents/2026/05/01/2026-08480
[us77d]: https://uscode.house.gov/us/usc/t15/s77d/
[us78o]: https://uscode.house.gov/us/usc/t15/s78o/
[e506]: https://www.ecfr.gov/current/title-17/section-230.506
[ccr]: https://www.coloradosos.gov/CCR/DisplayRule.do?action=ruleinfo&ruleId=2207
[t11]: https://olls.info/crs/crs2026-title-11.pdf
[t7]: https://olls.info/crs/crs2026-title-07.pdf
[us1061]: https://uscode.house.gov/us/usc/t26/s1061/
[angellist]: https://www.sec.gov/divisions/marketreg/mr-noaction/2013/angellist-15a1.pdf
