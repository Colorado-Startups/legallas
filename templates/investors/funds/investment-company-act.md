---
id: investors/funds/investment-company-act
title: Investment Company Act exemptions for a venture fund
path: vcs-invest
kind: explainer
level: [federal]
entity: [fund-lp, fund-llc]
statutes:
  - 15 U.S.C. 80a-3(a), (c)(1), (c)(7), (c)(7)(E) (Investment Company Act 3)
  - 15 U.S.C. 80a-2(a)(51) (qualified purchaser)
  - 17 CFR 270.2a51-1, 270.3c-1, 270.3c-5, 270.3c-6, 270.3c-7
  - 15 U.S.C. 77d(b) (Rule 506 offerings and general solicitation)
  - 15 U.S.C. 78l(g) (holders of record)
source: Original drafting for Legallas from the statutes and rules listed.
licence: CC0-1.0
date_checked: 2026-11-01
fields:
  fund_exemption: The exclusion the fund relies on
  holder_count: Beneficial owners counted so far
---

# Investment Company Act exemptions

**Legallas is an AI agent for legal work, not a lawyer or law firm. Using it creates no attorney-client relationship. AI can be wrong. Have your own lawyer review before you sign, file or rely on anything. No lawyer has reviewed this.**

## In one screen

A fund that invests in securities is an "investment company" and would have to register with the SEC, which no venture
fund does, unless it fits an exclusion. Almost every venture fund uses one of two: **3(c)(1)**, which limits how many
investors the fund has, or **3(c)(7)**, which limits who they are. Both forbid a public offering of the fund's
interests, though a Rule 506(c) offering with general solicitation isn't treated as a public offering for this purpose.

| | 3(c)(1) | 3(c)(1) qualifying venture capital fund | 3(c)(7) |
|---|---|---|---|
| Who may invest | Anyone the offering exemption allows (in practice, accredited investors) | Same | Only qualified purchasers |
| How many | No more than 100 beneficial owners | No more than 250 beneficial owners | No limit in the Act; the Exchange Act's holder-of-record threshold still matters |
| Size limit | None | No more than $12 million of aggregate capital contributions and uncalled committed capital | None |
| Other conditions | No public offering | Must be a venture capital fund under the Advisers Act rule; no public offering | No public offering |
| Source | [80a-3(c)(1)][us80a3] | [80a-3(c)(1)(C)][us80a3]; [Rule 3c-7][e3c7] | [80a-3(c)(7)][us80a3]; [80a-2(a)(51)][us80a2] |

## 3(c)(1): counting to 100 (or 250)

- **Each investor counts as one**, with exceptions below.
- **Look-through for funds.** If a company owning 10% or more of the fund's outstanding voting securities is itself an
  investment company, or would be but for 3(c)(1) or 3(c)(7), its own holders are counted ([80a-3(c)(1)(A)][us80a3]).
  A fund-of-funds or another private fund taking a large stake can break the count.
- **Knowledgeable employees** of the fund or its manager (such as executives and investment staff) aren't counted
  ([Rule 3c-5][e3c5]).
- **Transfers by gift, death, divorce and similar events** don't add a holder ([Rule 3c-6][e3c6]).
- **A vehicle formed to invest in the fund** may be looked through to its owners under SEC staff positions, which this
  file didn't check. Ask a lawyer before admitting one. (Rule 3c-1 is only a narrow grandfather rule for 10% holdings
  that existed on 1997-04-01 ([Rule 3c-1][e3c1]).)

## The qualifying venture capital fund route (250 holders)

A 3(c)(1) fund may have up to 250 beneficial owners if it is a "qualifying venture capital fund": a venture capital fund
as defined under the Advisers Act rule with no more than $12 million in aggregate capital contributions and uncalled
committed capital ([80a-3(c)(1)(C)][us80a3]; [Rule 3c-7][e3c7], which set the current amount). Fit for small
community and emerging-manager funds with many small investors. Watch the cap: commitments above $12 million end the
route.

## 3(c)(7): qualified purchasers only

A qualified purchaser is, among others, a natural person who owns at least $5 million in investments, or a company
acting for itself or other qualified purchasers that owns and invests at least $25 million in investments
([80a-2(a)(51)][us80a2]). "Investments" is defined by rule and excludes, for example, a personal residence
([Rule 2a51-1][e2a51]). A 3(c)(7) fund has no 100-holder limit, but an issuer with total assets over $10 million and a class of equity held of record by 2,000 persons
(or 500 who aren't accredited) must register that class under the Exchange Act ([15 U.S.C. 78l(g)][us78l]).

## No public offering

Both exclusions require that the fund not make or propose a public offering of its securities. Offers and sales under
Rule 506 aren't deemed public offerings under the federal securities laws because of general advertising or
solicitation ([15 U.S.C. 77d(b)][us77d]), so a Rule 506(c) fund can advertise without losing its exclusion.

Legallas template investors/funds/investment-company-act version 1. Law checked 2026-11-01. Not reviewed by a lawyer. Have your own lawyer review. Delete this line before signing.

## Drafting notes

### Choice: which exclusion: `{{fund_exemption}}`

| Option | Good when | Watch for |
|---|---|---|
| 3(c)(1), 100 holders | Most first funds | The count, including look-through and later transfers |
| 3(c)(1) qualifying venture capital fund, 250 holders | Many small checks; total fund at or under $12 million | The $12 million cap counts uncalled commitments; the fund must stay a venture capital fund |
| 3(c)(7) | Investors are institutions or very wealthy people | Every investor must be a qualified purchaser; a larger subscription questionnaire |
| Parallel 3(c)(1) and 3(c)(7) funds | Investors include both qualified purchasers and others | The Act says the SEC won't treat the two as a single issuer (15 U.S.C. 80a-3(c)(7)(E)); each must meet its own exclusion |

**Recommendation:** 3(c)(1). Use the 250-holder route only if the fund will stay at or under $12 million and remain a
venture capital fund. **Where a lawyer should look:** the holder count at each closing (`{{holder_count}}`), any investor
taking 10% or more that is itself a fund, and parallel fund structures.

### Choice: subscription questionnaire

**Recommendation:** ask every investor whether it is itself a fund relying on 3(c)(1) or 3(c)(7), whether it was formed to
invest in this fund, and its percentage, so the look-through can be checked.

## Sources

Primary:

- [15 U.S.C. 80a-2][us80a2]; [80a-3][us80a3]; [77d][us77d]; [78l][us78l]
- [17 CFR 270.2a51-1][e2a51]; [270.3c-1][e3c1]; [270.3c-5][e3c5]; [270.3c-6][e3c6]; [270.3c-7][e3c7]

[us80a2]: https://uscode.house.gov/us/usc/t15/s80a-2/
[us80a3]: https://uscode.house.gov/us/usc/t15/s80a-3/
[us77d]: https://uscode.house.gov/us/usc/t15/s77d/
[us78l]: https://uscode.house.gov/us/usc/t15/s78l/
[e2a51]: https://www.ecfr.gov/current/title-17/section-270.2a51-1
[e3c1]: https://www.ecfr.gov/current/title-17/section-270.3c-1
[e3c5]: https://www.ecfr.gov/current/title-17/section-270.3c-5
[e3c6]: https://www.ecfr.gov/current/title-17/section-270.3c-6
[e3c7]: https://www.ecfr.gov/current/title-17/section-270.3c-7

## What couldn't be verified

Nothing this document cites was left open on the date checked. Statutes and rules were read through a legal research
database, because the official sites couldn't be reached from this session. Points marked for a lawyer above stay open.
