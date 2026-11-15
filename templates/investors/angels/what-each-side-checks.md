---
id: investors/angels/what-each-side-checks
title: What a founder and an investor should each check
path: angels-invest
kind: checklist
level: [federal, colorado, delaware]
entity: [natural-person]
statutes:
  - 17 CFR 230.501(a), 230.503, 230.506(c), (d), (e)
  - 15 U.S.C. 78o(a); C.R.S. 11-51-401
  - C.R.S. 7-90-801
  - 17 CFR 230.501(e), 230.507
  - 17 U.S.C. 201, 204, 408; 35 U.S.C. 122, 261; 15 U.S.C. 1060; 37 CFR 2.71
source: Original drafting for Legallas. Public record notes come from the agencies' own pages as recorded in the design map.
licence: CC0-1.0
date_checked: 2026-11-01
fields:
  company_state: State of formation
  expected_stake: The investor's expected voting stake after the round, as a percentage
---

# What a founder and an investor should each check

**Legallas is an AI agent for legal work, not a lawyer or law firm. Using it creates no attorney-client relationship. AI can be wrong. Have your own lawyer review before you sign, file or rely on anything. No lawyer has reviewed this.**

## In one screen

Both sides of a private round take a risk on the other. The founder needs to know the investor can lawfully buy, isn't a
bad actor who would spoil the company's exemption, and won't cause trouble later. The investor needs to know the company
is what it says, owns what it says, and has followed the securities rules in earlier rounds. This checklist puts both
sides on one page so each knows what the other will ask.

## What the founder checks about the investor

| Check | Why | Source |
|---|---|---|
| Accredited status, by the round's standard | The company must believe (Rule 506(b)) or verify (Rule 506(c)) it | [230.501(a), 230.506][e506] |
| Bad actor questions, if the investor will hold 20% or more of the voting equity | A disqualifying event of a 20% beneficial owner can take away the Rule 506 exemption, or require disclosure | [230.506(d), (e)][e506] |
| Who is paid for the introduction | Paying an unregistered person on the deal can create broker and rescission problems for the company | [15 U.S.C. 78o(a)][us78o]; [C.R.S. 11-51-401][t11] |
| Sanctions screening | A sanctioned person can't be dealt with, and the 50% rule reaches companies they own | [Treasury's Office of Foreign Assets Control (OFAC) search][ofac] |
| For a vehicle or fund: how it counts | A vehicle formed for this purchase whose owners aren't all accredited counts each owner toward Rule 506(b)'s 35-person limit | [230.501(e)][e501] |
| For a vehicle or fund: who runs it and whether they are a registered or exempt reporting adviser | The manager will hold the rights, and the company will deal with them for years | [SEC adviser search (IAPD)][iapd] |
| The investor's other holdings | Investments in competitors, and what information they would expect | Practice |
| What the investor expects later | Board seat, pro rata, information, follow-on money | Practice |

## What the investor checks about the company

| Check | Why | Source |
|---|---|---|
| The entity exists and is in good standing in its state: `{{company_state}}` | A lapsed company can't sign | [Colorado business search][co-biz]; [Delaware entity search][de-search] |
| If formed in Delaware and working in Colorado, whether it filed for authority in Colorado | Required if transacting business in Colorado | [C.R.S. 7-90-801][t7] |
| The charter and bylaws (or LLC agreement) match the capitalization table | What you buy is defined there | Practice |
| Every founder, employee and contractor assigned their inventions | Without it, the company may not own its product: apart from an employee's work made for hire, copyright transfers need a signed writing, and patent rights a written instrument | [17 U.S.C. 201(b)][us201], [204(a)][us204]; [35 U.S.C. 261][us261] |
| Patent and trademark filings, and any assignments of them, are in the company's name | An assignment not recorded at the USPTO within 3 months can lose to a later buyer. A trademark application filed by someone who didn't own the mark is void | [35 U.S.C. 261][us261]; [15 U.S.C. 1060(a)(4)][us1060]; [37 CFR 2.71(d)][e271]; the USPTO searches below |
| Founder vesting and repurchase rights | A founder leaving early shouldn't keep all their shares | Practice |
| Earlier rounds filed Form D when due | A missed filing doesn't by itself lose the exemption, but it signals sloppiness and can bring a court order barring future use | [230.503][e503], [230.507][e507] |
| Earlier rounds' investor rights | Pro rata rights, most favoured nation, board seats held by others | Practice |
| Anyone paid to raise money | Same broker risk, from your side | [15 U.S.C. 78o(a)][us78o] |
| Claims, threatened or filed | Disclosure and value | [PACER, the federal courts' records system][pacer]; Colorado court records through the official vendors |
| The founders | Their history: regulators, courts, prior companies | Lookups below |

## Public records: what each shows, and what "nothing found" means

A block, a timeout or a bot check means "couldn't check", never "nothing found". Nothing found clears no one. A call to
the state securities regulator is often the real check.

| Record | Shows | Nothing found means only |
|---|---|---|
| [EDGAR company search][edgar] (the SEC's filing system) | Filings by company or person, including Form D notices | No electronic filer under that spelling. Try former names |
| [Form D on EDGAR][formd] | The company's exempt offerings, officers, directors, promoters, and people paid for sales | No Form D under that name. Investor names aren't listed, only counts |
| [SEC adviser search (IAPD)][iapd] | Registered and exempt reporting advisers | Not found under that name; ask the state. Many angel group leads won't appear |
| [BrokerCheck][brokercheck], run by the Financial Industry Regulatory Authority (FINRA) | Registered brokers and firms. Link out; its terms bar building it into software | Not registered under that name. A finder may never appear |
| [SEC Action Lookup][sali] | Individuals in SEC actions with a judgment or order | It can't clear anyone; it lags and omits firms |
| [Colorado business search][co-biz] | Name, status, agent, filings | Not registered in Colorado under that name. The state doesn't verify filings |
| [Delaware entity search][de-search] | Name, file number, formation date, agent. Status costs a fee | No Delaware entity under that spelling. Free results show no status |
| [Colorado Division of Securities][co-sec] | Enforcement actions; points to FINRA tools | Call the Division |
| [OFAC search][ofac] | Sanctions lists | Not on the list on that date. Hits need comparing |
| [PACER][pacer] | Federal court records, paid | No federal party under that spelling |
| [USPTO trademark search][tmsearch] | Federal trademark applications and registrations, with owner and status | No federal filing under that search. Marks used without a filing never appear |
| [TSDR][tsdr] (the USPTO's status and documents system) | One trademark filing's status, owner and documents, by number | Check the number |
| [USPTO Assignment Center][assign] | Recorded assignments of patents and trademarks | Nothing recorded. An unrecorded assignment can still bind the parties to it |
| [Patent Public Search][ppubs] | Published applications and granted patents | Nothing published. Most applications stay confidential until about 18 months after filing |
| [Copyright Public Records System][cprs] | Registrations and recorded transfers | Nothing registered. Copyright doesn't depend on registration |

## The fight clauses both sides should read now

Decisions made in this round decide later fights over a founder's departure or control of the board. Both sides should
read [What your documents should say beforehand](../fights/before-the-fight.md) before signing.

Legallas template investors/angels/what-each-side-checks version 1. Law checked 2026-11-01. Not reviewed by a lawyer. Have your own lawyer review. Delete this line before signing.

## Drafting notes

### Choice: how much to check

| Option | When |
|---|---|
| Records lookups only | Very small checks, known founders |
| Lookups plus document review in the data room | Most angel checks |
| Lookups, document review and a background check by a licensed firm | Leading a round or taking a board seat |

**Recommendation:** for any check you would mind losing, do the lookups and the document review, and write down what you
looked at. **Where a lawyer should look:** whether running a background check on a named person brings in consumer
report or privacy rules. That wasn't researched here.

### Choice: bad actor questions for a large investor

**Recommendation for the founder:** if the investor's expected voting stake (`{{expected_stake}}`) is 20% or more, ask
for a signed bad actor questionnaire before closing. **Where a lawyer should look:** how voting equity is counted, and
whether an investor's affiliates should answer too.

## Sources

Primary:

- [17 CFR 230.501][e501], [230.503][e503], [230.506][e506], [230.507][e507]
- [15 U.S.C. 78o][us78o]; [C.R.S. title 11][t11]; [C.R.S. title 7][t7]
- [17 U.S.C. 201][us201], [204][us204], [408][us408]; [35 U.S.C. 122][us122], [261][us261]; [15 U.S.C. 1060][us1060]; [37 CFR 2.71][e271], checked 2026-11-02

Records (agency pages; the first group read through the design map, the second opened on the date shown):

- [EDGAR][edgar], [Form D search][formd], [IAPD][iapd], [BrokerCheck][brokercheck], [SEC Action Lookup][sali],
  [Colorado business search][co-biz], [Delaware entity search][de-search], [Colorado Division of Securities][co-sec],
  [OFAC][ofac], [PACER][pacer]
- [USPTO trademark search][tmsearch], [TSDR][tsdr], [Assignment Center][assign], [Patent Public Search][ppubs] and the
  [Copyright Public Records System][cprs]: each answered on 2026-11-02. The [USPTO's terms][uspto-terms] say heavy use, automated or
  manual, may be denied access, so the product links to these and doesn't read them

## What couldn't be verified

- None of the record sites could be opened from this session. Their descriptions come from the design map's research on
  the same date. Check each site's current terms before building any lookup into the product.

[e501]: https://www.ecfr.gov/current/title-17/section-230.501
[e503]: https://www.ecfr.gov/current/title-17/section-230.503
[e506]: https://www.ecfr.gov/current/title-17/section-230.506
[e507]: https://www.ecfr.gov/current/title-17/section-230.507
[us78o]: https://uscode.house.gov/us/usc/t15/s78o/
[t7]: https://olls.info/crs/crs2026-title-07.pdf
[t11]: https://olls.info/crs/crs2026-title-11.pdf
[edgar]: https://www.sec.gov/search-filings
[formd]: https://www.sec.gov/search-filings
[iapd]: https://adviserinfo.sec.gov/
[brokercheck]: https://brokercheck.finra.org/
[sali]: https://www.sec.gov/litigations/sec-action-look-up
[co-biz]: https://www.sos.state.co.us/biz/BusinessEntityCriteriaExt.do
[de-search]: https://icis.corp.delaware.gov/ecorp/entitysearch/namesearch.aspx
[co-sec]: https://securities.colorado.gov/
[ofac]: https://sanctionssearch.ofac.treas.gov/
[pacer]: https://pacer.uscourts.gov/
[us201]: https://uscode.house.gov/us/usc/t17/s201/
[us204]: https://uscode.house.gov/us/usc/t17/s204/
[us408]: https://uscode.house.gov/us/usc/t17/s408/
[us122]: https://uscode.house.gov/us/usc/t35/s122/
[us261]: https://uscode.house.gov/us/usc/t35/s261/
[us1060]: https://uscode.house.gov/us/usc/t15/s1060/
[e271]: https://www.ecfr.gov/current/title-37/section-2.71
[tmsearch]: https://tmsearch.uspto.gov/
[tsdr]: https://tsdr.uspto.gov/
[assign]: https://assignmentcenter.uspto.gov/
[ppubs]: https://ppubs.uspto.gov/pubwebapp/
[cprs]: https://publicrecords.copyright.gov/
[uspto-terms]: https://www.uspto.gov/terms-use-uspto-websites
