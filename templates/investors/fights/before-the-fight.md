---
id: investors/fights/before-the-fight
title: What an investor's documents should say before any fight
path: fights
kind: explainer
level: [colorado, delaware, federal]
entity: [natural-person, fund-lp, fund-llc]
statutes:
  - C.R.S. 7-107-102, 7-107-104, 7-107-302, 7-108-108, 7-108-303, 7-108-304, 7-109-104, 7-116-102, 7-114-301, 7-114-305, 7-102-102(2)(d), (e), 7-102-108
  - C.R.S. 7-80-108, 7-80-401, 7-80-408 (Colorado LLC)
  - 8 Del. C. 102(b)(7), 115, 122(17), 141(k), 142, 145, 212(e), 218(c), 220, 228
  - 6 Del. C. 18-302, 18-305 (Delaware LLC)
  - C.R.S. 8-4-101(6) (Colorado Wage Act employer definition); C.R.S. 8-2-113 (restrictive covenants)
  - 17 CFR 240.21F-17
source: Original drafting for Legallas from the statutes listed and the design map's fights section. NVCA, Series Seed and Y Combinator forms are named for comparison and linked, not copied.
licence: CC0-1.0
date_checked: 2026-11-01
fields:
  board_seats: How the board is made up after the round (for example, two common, one investor, one independent)
---

# What your documents should say beforehand

**Legallas is an AI agent for legal work, not a lawyer or law firm. Using it creates no attorney-client relationship. AI can be wrong. Have your own lawyer review before you sign, file or rely on anything. No lawyer has reviewed this.** Have your own lawyer review these terms
before you sign.

## In one screen

Four fights come up again and again between founders and investors: founders falling out with each other, a founder
removed, investors acting on a founder's bad behaviour, and investors (or some of them) trying to take control. Who wins
is mostly decided by documents signed long before, at formation and at each raise. This guide lists, from the investor's
side, the clauses that decide those fights, what each should say, and where Colorado and Delaware law differ.

**A SAFE gives you none of these rights.** If you hold only a SAFE, you have no vote, no board seat and no information
right until conversion. Ask for an information side letter at least ([Side letter basics](../angels/side-letter.md)).

## The clauses, by fight

### Who sits on the board, and who can remove them

| Clause | Where | What it decides | Investor-side position | Law to know |
|---|---|---|---|---|
| Board composition | Voting agreement | Who designates each seat: `{{board_seats}}` | Seats by class, with an independent seat both sides approve | Voting agreements are enforceable: [8 Del. C. 218(c)][d8s7]; [C.R.S. 7-107-302][t7] |
| Removal of a designee | Voting agreement | Only the holders who designate a seat can remove its director | Yes, so a majority can't strip your seat | Delaware: holders of a majority of voting shares may remove directors, with or without cause, unless the board is classified or voting is cumulative ([141(k)][d8s4]). Colorado: shareholders may remove at a meeting called for that purpose, and the votes cast for must exceed the votes cast against ([C.R.S. 7-108-108][t7]); whether removal by written consent works is not explicit, so don't assume Delaware-style removal by consent |
| Irrevocable proxy | Voting agreement | Lets the voting agreement be enforced if a party won't vote | Yes | [8 Del. C. 212(e)][d8s7] |
| Officer removal and hiring | Bylaws; charter protective provision | Board removes officers; investor director's consent to hire or fire the chief executive | An approval right over hiring and firing the chief executive is common in priced rounds (practice) | Colorado: the board may remove officers unless bylaws differ, and removal doesn't affect contract rights ([C.R.S. 7-108-303, 7-108-304][t7]). Delaware: bylaws or board ([8 Del. C. 142][d8s4]) |

### Who can act fast

| Clause | Where | Investor-side position | Law to know |
|---|---|---|---|
| Stockholder action by written consent | Charter or articles | Know the default before you sign | **Opposite defaults.** Delaware allows action by written consent of the holders of the votes needed, with no meeting, unless the charter says otherwise, and prompt notice afterward to those who didn't consent ([8 Del. C. 228][d8s7]). Colorado requires every shareholder to consent unless the articles expressly allow less, and non-unanimous action needs notice to those who didn't consent ([C.R.S. 7-107-104][t7]) |
| Special meetings | Bylaws | Investors usually want the right to call one | Colorado: holders of 10% can demand a special meeting ([C.R.S. 7-107-102][t7]) |
| Consent mechanics in an LLC | Operating agreement | Spell them out | Colorado's LLC act has no consent procedure, so the agreement must supply it ([C.R.S. 7-80-401][t7]); Delaware allows consent by the votes needed unless the agreement differs ([6 Del. C. 18-302][d18s3]) |

### What you can see

| Clause | Where | Investor-side position | Law to know |
|---|---|---|---|
| Information rights | Investors' rights agreement or side letter | Annual audited or reviewed statements, quarterly statements, an annual budget, and inspection | Statutory rights exist for stockholders but need a demand and a proper purpose: Colorado ([C.R.S. 7-116-102][t7]), which articles and bylaws can't cut; Delaware ([8 Del. C. 220][d8s7]) |
| LLC member information | Operating agreement | Don't accept a clause that unreasonably restricts it | Colorado bars unreasonable restriction ([C.R.S. 7-80-408, 7-80-108][t7]); Delaware lets the agreement shape it, including the 5 business days the LLC has to answer a demand, which it can set at no more than 30 business days ([6 Del. C. 18-305][d18s3]) |
| Confidentiality | Investors' rights agreement | Keep a carve-out for sharing with your own fund and advisers, and for reports to regulators | A confidentiality term can't stop anyone talking to SEC staff ([17 CFR 240.21F-17][e21f17]) |

### What a departing founder keeps

| Clause | Where | Investor-side position |
|---|---|---|
| Vesting and repurchase | Founder stock agreement | Founder shares vest over time; the company can buy back unvested shares when a founder leaves. Investors often ask for vesting to be confirmed or reset at the first priced round |
| "Cause" | Founder stock or employment agreement | An objective definition (fraud, a felony, wilful misconduct, a material uncured breach after notice) so a finding can stand up |
| Acceleration | Founder stock agreement | Double trigger (a sale and a termination) rather than single trigger |
| Non-compete | Employment agreement | Don't rely on one for a founder working in Colorado: most are void, and Colorado law governs for workers primarily in Colorado regardless of a Delaware clause ([C.R.S. 8-2-113][t8]) |

### Who controls a sale or new money

| Clause | Where | Investor-side position |
|---|---|---|
| Protective provisions | Charter | Your class's approval for new senior stock, a sale, charter changes that hurt your class, and big debt |
| Drag-along | Voting agreement | Binds all holders to a sale approved by the board and a stated majority, with protections for minority holders (same price per share, limited liability) |
| Right of first refusal and co-sale | Separate agreement | Lets the company or investors buy, or sell alongside, when a founder sells |
| Pay-to-play | Charter | Penalizes investors who don't join later rounds. Be sure you can meet it |

### Protecting your director

| Clause | Where | Investor-side position | Law to know |
|---|---|---|---|
| Exculpation | Charter or articles | Yes, to the extent allowed | Delaware covers directors and officers, with limits ([8 Del. C. 102(b)(7)][d8s1]); Colorado covers directors only, with different exceptions ([C.R.S. 7-102-102(2)(d)][t7]) |
| Indemnification and advancement | Indemnification agreement and bylaws | Mandatory advancement of legal costs | Delaware advancement is permissive unless made mandatory ([145][d8s4]); Colorado's is permissive too, needs a written affirmation of good faith and an undertaking, and becomes mandatory only by the articles, bylaws or a contract ([C.R.S. 7-109-104][t7]) |
| Corporate opportunities | Charter, or a board action in Delaware | Renounce opportunities that come to the investor's people outside their role as director | [8 Del. C. 122(17)][d8s2]; [C.R.S. 7-102-102(2)(e)][t7] |
| Forum | Charter or bylaws | A single forum for internal disputes | [8 Del. C. 115][d8s1]; [C.R.S. 7-102-108][t7] |

### Two Colorado traps for investors

- **Wage liability for 25% owners.** Under the Colorado Wage Act, "employer" includes each individual who owns or controls
  at least 25% of the ownership interests in an employer, unless a minority owner shows full delegation of authority over
  day-to-day operations ([C.R.S. 8-4-101(6)][t8]). An individual angel with a large stake in a Colorado company could be
  named in a departing founder's wage claim. Stay out of day-to-day control, and document that you delegated it.
- **Deadlock and oppression.** A Colorado shareholder can ask a court to dissolve the company for deadlock or for
  illegal, oppressive or fraudulent conduct by those in control, and the company or other holders can elect to buy the
  petitioner out ([C.R.S. 7-114-301, 7-114-305][t7]). Delaware's statute has no oppression ground. Know which law applies before
  pressing a founder.

Legallas template investors/fights/before-the-fight version 1. Law checked 2026-11-01. Not reviewed by a lawyer. Have your own lawyer review. Delete this line before signing.

## Drafting notes

### Choice: how much control to ask for

| Option | Notes |
|---|---|
| Information rights only | Fits a small check; you can't act, but you can see |
| One board seat plus protective provisions | Usual for a lead investor in a priced round (practice) |
| Board control | Rare at seed; founders resist, and a controlling investor takes on more duty risk in a later fight (judge-made) |

**Recommendation:** match control to your stake. For a lead investor in a priced round: one seat, removal only by the
designating holders, protective provisions, information rights, mandatory advancement, and a balanced board with an
independent seat. **Where a lawyer should look:** the written consent default in the company's state; removal mechanics;
how "cause" is defined in the founders' agreements.

### Choice: a Colorado corporation's articles

**Recommendation:** read the articles for two things before investing in a Colorado corporation: whether shareholders
may act by less than unanimous written consent, and whether cumulative voting is on. Both change who can move fast and
who can hold a seat ([C.R.S. 7-107-104][t7]; [7-108-108][t7]).

## Sources

Primary:

- [C.R.S. title 7][t7]; [C.R.S. title 8][t8]
- [8 Del. C. 102, 115][d8s1]; [122][d8s2]; [141, 142, 145][d8s4]; [212, 218, 220, 228][d8s7]
- [6 Del. C. 18-302, 18-305][d18s3]
- [17 CFR 240.21F-17][e21f17]

Forms named for comparison, linked only:

- [National Venture Capital Association (NVCA) model documents][nvca] (no licence stated); [Series Seed][ss]; [Y Combinator SAFE][ycsafe]

## What couldn't be verified

- Market practice notes are from general practice, not a survey checked for this file.
- Whether drag-along clauses and waivers of appraisal rights are enforceable is judge-made and not covered here.

[t7]: https://olls.info/crs/crs2026-title-07.pdf
[t8]: https://olls.info/crs/crs2026-title-08.pdf
[d8s1]: https://delcode.delaware.gov/title8/c001/sc01/index.html
[d8s2]: https://delcode.delaware.gov/title8/c001/sc02/index.html
[d8s4]: https://delcode.delaware.gov/title8/c001/sc04/index.html
[d8s7]: https://delcode.delaware.gov/title8/c001/sc07/index.html
[d18s3]: https://delcode.delaware.gov/title6/c018/sc03/index.html
[e21f17]: https://www.ecfr.gov/current/title-17/section-240.21F-17
[nvca]: https://nvca.org/model-legal-documents/
[ss]: https://github.com/seriesseed/equity
[ycsafe]: https://www.ycombinator.com/safe
