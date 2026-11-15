---
id: investors/funds/fund-formation
title: Venture fund formation checklist
path: vcs-invest
kind: checklist
level: [colorado, delaware, federal]
entity: [fund-lp, fund-llc, general-partner, management-company]
statutes:
  - 6 Del. C. 17-201, 17-1109 (Delaware limited partnership certificate and annual tax)
  - 6 Del. C. 18-201, 18-1107 (Delaware LLC certificate and annual tax)
  - C.R.S. 7-62-201, 7-62-303 (Colorado limited partnership)
  - C.R.S. 7-80 (Colorado LLC); C.R.S. 7-90-801 (foreign entity authority)
  - 15 U.S.C. 80a-3(c)(1), (c)(7), (c)(7)(E); 15 U.S.C. 80b-3(l), (m)
  - 17 CFR 230.503, 230.506; 17 CFR 275.203(l)-1, 275.204-4, 275.206(4)-5
  - 3 CCR 704-1, Rule 51-4.11(IA); C.R.S. 11-51-402
  - 29 CFR 2510.3-101 (plan assets)
  - 26 U.S.C. 1061, 7704
  - 17 CFR 230.152 (integration)
  - 6 Del. C. 17-303, 17-1101; C.R.S. 7-62-403
source: Original drafting for Legallas from the statutes and rules listed. No fund's documents were read or adapted. Model forms are linked, not copied.
licence: CC0-1.0
date_checked: 2026-11-01
fields:
  fund_vehicle: Delaware LP, Colorado LP, Colorado limited liability limited partnership, or LLC
  fund_exemption: 3(c)(1) (100 holders), 3(c)(1) qualifying venture capital fund (250 holders, $12 million), or 3(c)(7)
  adviser_route: Venture capital fund adviser (203(l)), private fund adviser (203(m)), or registered
  offering_route: Rule 506(b) or Rule 506(c)
---

# Venture fund formation checklist

**Legallas is an AI agent for legal work, not a lawyer or law firm. Using it creates no attorney-client relationship. AI can be wrong. Have your own lawyer review before you sign, file or rely on anything. No lawyer has reviewed this.** A first fund needs a fund lawyer; this list
is for knowing what they will ask and keeping track.

## In one screen

A venture fund usually has three entities: the **fund** (most often a Delaware limited partnership), the **general
partner** that controls it (usually an LLC, which receives carried interest), and the **management company** that
employs the team, receives the management fee and is the investment adviser. Before the first close, the manager makes
four legal choices that set everything else: the fund's vehicle and state, its Investment Company Act exclusion, the
adviser's registration route, and the offering exemption. Then come the documents, the filings and the compliance setup.

## 1. The four choices

- [ ] **Vehicle:** `{{fund_vehicle}}`. See the drafting notes below.
- [ ] **Investment Company Act exclusion:** `{{fund_exemption}}`. See
  [Investment Company Act exemptions](investment-company-act.md).
- [ ] **Adviser route:** `{{adviser_route}}`. See [Advisers Act exempt reporting](exempt-reporting-adviser.md).
- [ ] **Offering exemption:** `{{offering_route}}`. See [Regulation D for the fund](regulation-d.md).

## 2. Entities

- [ ] Fund: certificate of limited partnership (Delaware: signed by every general partner ([6 Del. C. 17-201][d17s2]), $200 to file
  ([fee schedule][defee]); Colorado: [C.R.S. 7-62-201][t7]).
- [ ] General partner: certificate of formation for a Delaware LLC, $110 to file ([6 Del. C. 18-201][d18s2]; [fee schedule][defee]),
  or articles of organization for a Colorado LLC ([C.R.S. 7-80][t7]).
- [ ] Management company: same.
- [ ] A Delaware entity that transacts business in Colorado files a statement of foreign entity authority
  ([C.R.S. 7-90-801][t7]).
- [ ] An employer identification number for each entity.
- [ ] Bank accounts in each entity's name.

## 3. Documents

| Document | Who signs | Notes |
|---|---|---|
| Limited partnership agreement | General partner and each limited partner | See the [outline](partnership-agreement-outline.md). The Institutional Limited Partners Association's (ILPA) and VC Lab's models are link only ([ILPA model][ilpa-lpa]; [VC Lab][vclab]) |
| General partner LLC agreement | The principals | Splits carried interest, funds the general partner's commitment, shares any clawback |
| Management company operating agreement | The owners | Owns the adviser, staff and fee income |
| Investment management agreement | Fund or general partner, and the management company | Delegates advisory work; sets the fee flow |
| Private placement memorandum | Issued by the general partner | Not required when every investor is accredited, but anti-fraud rules apply to everything said to investors ([17 CFR 275.206(4)-8][e206-8]); most funds give one |
| Subscription agreement and investor questionnaire | Each investor; the general partner accepts | Accredited status; qualified purchaser status for a 3(c)(7) fund; qualified client status where needed; benefit plan investor status; tax and foreign status; source of funds |
| Side letters | General partner and an investor | Keep a list; a most favoured nation clause lets others elect terms |
| Advisory committee terms | In the partnership agreement | Limited partners on a committee that reviews conflicts |

## 4. Filings and compliance setup

| Item | When | Source |
|---|---|---|
| Access to EDGAR, the SEC's filing system (Form ID) | Well before the first sale; it needs a notarized form and SEC review | [Form D and the Colorado notice](form-d-and-colorado-notice.md) |
| Form D for the fund, with the 3(c) box in Item 6 | Within 15 days after the first sale | [17 CFR 230.503][e503] |
| State notice filings (Colorado and every state where investors live) | Usually within 15 days after the first sale in that state | [Form D and the Colorado notice](form-d-and-colorado-notice.md) |
| Bad actor questionnaires for the general partner, manager, its principals and others covered | Before the first sale | [17 CFR 230.506(d)][e506] |
| Form ADV as an exempt reporting adviser | Within 60 days after first relying on the exemption | [17 CFR 275.204-4][e204-4] |
| Colorado private fund adviser exemption | With the Form ADV | [3 CCR 704-1, Rule 51-4.11(IA)][ccr]; [C.R.S. 11-51-402][t11] |
| Delaware adviser position | Before acting, if the manager has a Delaware place of business or Delaware clients | A lawyer point; see [Advisers Act exempt reporting](exempt-reporting-adviser.md) |
| Insider trading policy and code of ethics | From the start | See [Advisers Act exempt reporting](exempt-reporting-adviser.md) |
| Pay-to-play policy | Before soliciting any government investor | [17 CFR 275.206(4)-5][e206-5]; proposed for rescission on 2026-09-10, still in force |
| Benefit plan investor monitoring, or management rights letters | Before taking pension or retirement plan money | [29 CFR 2510.3-101][e2510] |
| Tax setup: partnership return, Schedule K-1s, Colorado composite return | First tax year | [Compliance calendar](compliance-calendar.md); have your own tax professional review the setup |

Legallas template investors/funds/fund-formation version 1. Law checked 2026-11-01. Not reviewed by a lawyer. Have your own lawyer review. Delete this line before signing.

## Drafting notes

### Choice: the fund vehicle

| Option | For it | Against it |
|---|---|---|
| Delaware limited partnership | What investors and their lawyers expect; Delaware law lets the agreement shape duties broadly; a safe-harbour list for limited partners on an advisory committee ([6 Del. C. 17-303][d17s3], [17-1101][d17s11]) | A second state's fees and annual tax; Colorado authority if it does business here |
| Colorado limited partnership | Home-state filing and lower cost ([C.R.S. 7-62-201][t7]) | Less familiar to investors; Colorado keeps the control test, and its list of activities that aren't control is shorter, though not exhaustive, with no safe harbour for serving on an advisory committee ([7-62-303][t7]) |
| Colorado limited liability limited partnership | A limited partner isn't liable for obligations incurred while the partnership is registered as one, without depending on the control rule ([C.R.S. 7-62-303(1)(b)][t7]), and a general partner has the liabilities of a partner in a limited liability partnership ([7-62-403][t7]) | Same familiarity question; registration steps and the reach of the shield are lawyer points |
| LLC | One entity type throughout | Less common for funds; some investors' tax and legal teams prefer partnerships |

**Recommendation:** a Delaware limited partnership for a fund raising from institutions or out-of-state investors.
A small fund raising mostly from Colorado individuals can reasonably use a Colorado limited partnership and save the
second state's costs; tell investors why. Either way, use LLCs for the general partner and management company.

**Where a lawyer should look:** limited partner liability and the control rule under the chosen state's act; how
duties are restricted; whether the general partner entity's Colorado activities need registration.

### Choice: one fund or parallel funds

**Recommendation:** one fund, which is simpler. Some managers run a 3(c)(7) fund beside a 3(c)(1) fund when their
investors include both qualified purchasers and others. The Act says the SEC won't treat the two as a single issuer, and
each fund must still meet its own exclusion (15 U.S.C. 80a-3(c)(7)(E)). **Where a lawyer should look:** any parallel
structure, and integration under Rule 152.

### Choice: taking retirement plan money

**Recommendation:** either keep benefit plan investors under 25% of each class of interests, or operate as a venture
capital operating company with management rights in portfolio companies ([29 CFR 2510.3-101][e2510]). Decide before
the first close, because it shapes every investment's paperwork.

## Sources

Primary:

- [6 Del. C. chapter 17][d17s2], [17-303][d17s3], [17-1101][d17s11]; [chapter 18][d18s2]
- [Delaware Division of Corporations fee schedule, revised 2026-08-01][defee], read 2026-11-06, still the schedule the fee page links
- [C.R.S. title 7][t7]; [C.R.S. title 11][t11]; [3 CCR 704-1][ccr]
- [17 CFR 230.503][e503], [230.506][e506]; [275.204-4][e204-4]; [275.206(4)-5][e206-5]; [275.206(4)-8][e206-8]
- [29 CFR 2510.3-101][e2510]

Model forms, linked only:

- [ILPA model limited partnership agreement][ilpa-lpa] (written for a buyout fund; its terms give readers no rights)
- [VC Lab Cornerstone documents][vclab] (free to use; no redistribution)

[d17s2]: https://delcode.delaware.gov/title6/c017/sc02/index.html
[d17s3]: https://delcode.delaware.gov/title6/c017/sc03/index.html
[d17s11]: https://delcode.delaware.gov/title6/c017/sc11/index.html
[d18s2]: https://delcode.delaware.gov/title6/c018/sc02/index.html
[t7]: https://olls.info/crs/crs2026-title-07.pdf
[t11]: https://olls.info/crs/crs2026-title-11.pdf
[ccr]: https://www.coloradosos.gov/CCR/DisplayRule.do?action=ruleinfo&ruleId=2207
[e503]: https://www.ecfr.gov/current/title-17/section-230.503
[e506]: https://www.ecfr.gov/current/title-17/section-230.506
[e204-4]: https://www.ecfr.gov/current/title-17/section-275.204-4
[e206-5]: https://www.ecfr.gov/current/title-17/section-275.206(4)-5
[e206-8]: https://www.ecfr.gov/current/title-17/section-275.206(4)-8
[e2510]: https://www.ecfr.gov/current/title-29/section-2510.3-101
[ilpa-lpa]: https://ilpa.org/industry-guidance/templates-standards-model-documents/model-limited-partnership-agreement/
[vclab]: https://govclab.com/cornerstone-lpa

## What couldn't be verified

- The 60-day first filing for Form ADV rests on secondary copies of the SEC's instructions, which couldn't be opened from
  this session.
- Statutes and rules were read through a legal research database, because the official sites couldn't be reached from
  this session. Points marked for a lawyer above stay open.

[defee]: https://corpfiles.delaware.gov/Fee_Schedule/AugustFee2026.pdf
