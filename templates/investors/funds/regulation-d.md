---
id: investors/funds/regulation-d
title: Regulation D for a venture fund's own offering
path: vcs-invest
kind: explainer
level: [federal, colorado]
entity: [fund-lp, fund-llc]
statutes:
  - 15 U.S.C. 77d(a)(2), 77d(b) (Securities Act 4(a)(2), 4(b))
  - 15 U.S.C. 77r(b)(4)(F), 77r(c)(2) (covered securities and state notice filings)
  - 17 CFR 230.152 (integration)
  - 17 CFR 230.501, 230.502, 230.503, 230.506
  - 17 CFR 275.206(4)-8
  - C.R.S. 11-51-308(1)(p); 3 CCR 704-1, Rule 51-3.7
source: Original drafting for Legallas from the statutes and rules listed.
licence: CC0-1.0
date_checked: 2026-11-01
fields:
  offering_route: Rule 506(b) or Rule 506(c)
  minimum_commitment: The fund's minimum commitment per investor
  covered_persons: The people and entities the bad actor rule covers for this fund
---

# Regulation D for the fund's own offering

**Legallas is an AI agent for legal work, not a lawyer or law firm. Using it creates no attorney-client relationship. AI can be wrong. Have your own lawyer review before you sign, file or rely on anything. No lawyer has reviewed this.**

## In one screen

When a fund sells interests to its limited partners, the fund is the issuer, selling securities. Almost every venture
fund uses Rule 506 of Regulation D, because it has no dollar limit and its securities are "covered securities", so
states can require only a notice filing and fee, not a review ([15 U.S.C. 77r(b)(4)(F), (c)(2)][us77r]). The main choice
is between **Rule 506(b)**, which bars general solicitation, and **Rule 506(c)**, which allows it but requires every
investor to be verified as accredited. Either way the fund files Form D and state notices, checks for bad actors, and is
liable for anything misleading in what it tells investors.

## Rule 506(b) or Rule 506(c)

| | Rule 506(b) | Rule 506(c) |
|---|---|---|
| Talking about the fund publicly (websites, podcasts, social media, events open to the public) | Not allowed. SEC staff interpretations treat offers to people with whom the manager has a substantive pre-existing relationship as not general solicitation (staff view) | Allowed |
| Who may invest | Accredited investors, plus up to 35 sophisticated non-accredited investors across the fund's Rule 506(b) sales in any 90-day period | Accredited investors only |
| Checking status | A reasonable belief, usually from a questionnaire | Reasonable steps to verify each investor |
| Non-accredited investors | Must receive specified disclosure, including financial statements ([Rule 502(b)][e502]) | Not allowed |
| Effect on the Investment Company Act exclusion | None | None: a Rule 506 offering isn't a public offering because of general solicitation ([15 U.S.C. 77d(b)][us77d]) |
| Source | [Rule 506(b)][e506]; [Rule 502(c)][e502] | [Rule 506(c)][e506] |

The SEC's 2025 staff letter on high minimum investments gives a 506(c) fund a lighter way to verify larger investors:
written statements plus a high minimum, with no contrary facts known. A binding capital commitment, rather than money paid
up front, is a point to check with a lawyer. See [Accredited investor rules](../angels/accredited-investor.md).

## Bad actors

A fund can't use Rule 506 if a "covered person" had a disqualifying event (certain criminal convictions, court
injunctions, regulatory orders and similar) within the look-back periods, unless an exception applies; events before
2013-09-23 must instead be disclosed to investors ([Rule 506(d), (e)][e506]). For a fund, covered persons include the
fund's general partner and managing members, the investment manager and its directors, executive officers and managing
members, 20% beneficial owners of the fund's voting equity, promoters, and anyone paid to solicit investors. The fund is
protected if it didn't know, and with reasonable care couldn't have known, of an event. That is why funds collect signed
questionnaires before the first sale and before each later closing.

## Integration

Two offerings that are really one can't be split to fit separate exemptions. Rule 152 gives the framework and safe
harbours for deciding whether offerings are integrated ([17 CFR 230.152][e152]). It matters when a manager runs parallel
funds, a fund and co-investment vehicles, or moves from a 506(b) to a 506(c) offering mid-raise.

## What the fund tells investors

No rule requires a private placement memorandum when every investor is accredited. But anything said to investors is
covered by anti-fraud rules, including Rule 206(4)-8 for the adviser ([17 CFR 275.206(4)-8][e206-8]) and Rule 10b-5.
**Recommendation:** give a memorandum that covers strategy, risks, fees and expenses, conflicts, the team, and key
partnership agreement terms, and keep the pitch deck consistent with it.

## Resale limits

Interests sold under Rule 506 are restricted ([Rule 502(d)][e502]). The partnership agreement adds its own transfer
limits.

## Filings

- Form D within 15 days after the first sale ([Rule 503][e503]). The Form D instructions define the date of first sale as the
  date the first investor is irrevocably contractually committed (as the SEC's 2008 adopting release describes them),
  which for a fund is usually the first close.
- State notice filings where investors live, including Colorado through the national electronic system with a fee, by
  the same deadline, and a Colorado amendment each year while the offering continues. Colorado's exemption for Rule 506 offerings
  requires the issuer to file this notice and pay the fee ([C.R.S. 11-51-308(1)(p)][t11]; [3 CCR 704-1, Rule 51-3.7][ccr]).
- See [Form D and the Colorado notice](form-d-and-colorado-notice.md).

Legallas template investors/funds/regulation-d version 1. Law checked 2026-11-01. Not reviewed by a lawyer. Have your own lawyer review. Delete this line before signing.

## Drafting notes

### Choice: Rule 506(b) or Rule 506(c): `{{offering_route}}`

**Recommendation:** Rule 506(b) for a first fund raised from people the manager already knows; it keeps verification
simple. Choose Rule 506(c) if the manager wants to market the fund publicly, and plan verification from the start; with a
high minimum (`{{minimum_commitment}}`), the staff letter route can make it easy. Don't switch from 506(b) to 506(c)
mid-raise without a lawyer.

**Where a lawyer should look:** what counts as general solicitation (conference talks, newsletters, social posts), and
integration with any other offering.

### Choice: non-accredited investors

**Recommendation:** none. The disclosure required for even one non-accredited investor under Rule 506(b), including
financial statements, is out of proportion for most funds.

### Choice: bad actor questionnaires

**Recommendation:** collect them from every covered person (`{{covered_persons}}`) before the first sale, refresh them
before each later closing, and keep them with the fund's records.

## Sources

Primary:

- [15 U.S.C. 77d][us77d]; [77r][us77r]
- [17 CFR 230.152][e152]; [230.501][e501]; [230.502][e502]; [230.503][e503]; [230.506][e506]
- [17 CFR 275.206(4)-8][e206-8]
- [3 CCR 704-1][ccr], Rule 51-3.7

[us77d]: https://uscode.house.gov/us/usc/t15/s77d/
[us77r]: https://uscode.house.gov/us/usc/t15/s77r/
[e152]: https://www.ecfr.gov/current/title-17/section-230.152
[e501]: https://www.ecfr.gov/current/title-17/section-230.501
[e502]: https://www.ecfr.gov/current/title-17/section-230.502
[e503]: https://www.ecfr.gov/current/title-17/section-230.503
[e506]: https://www.ecfr.gov/current/title-17/section-230.506
[e206-8]: https://www.ecfr.gov/current/title-17/section-275.206(4)-8
[t11]: https://olls.info/crs/crs2026-title-11.pdf
[ccr]: https://www.coloradosos.gov/CCR/DisplayRule.do?action=ruleinfo&ruleId=2207

## What couldn't be verified

Nothing this document cites was left open on the date checked. Statutes and rules were read through a legal research
database, because the official sites couldn't be reached from this session. Points marked for a lawyer above stay open.
