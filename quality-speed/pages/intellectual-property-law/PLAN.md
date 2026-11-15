# Intellectual property law

Page slug `intellectual-property-law`. Public law only, no case data. Not legal advice; no lawyer has reviewed this page or its list.

| File | What it holds |
|---|---|
| [`needs.json`](needs.json) | The reviewed list, in the [law kit's format](../../core/law/README.md): 23 needs with source, path and where the product holds each, 10 deadline flags in their sources' exact words, 8 test questions |
| [`manifest.json`](manifest.json) | 8 metrics: the kit's five, `change_lag`, `lane_minutes` and `law_lookup_tokens_p95` |
| [`page.ts`](page.ts) | The IP map (the infographic), the kit's needs charts, a bullet per metric with its baseline, Road to 100; [`page.test.ts`](page.test.ts) |
| [`lanes.json`](lanes.json) | Two daily Linux lanes, no secret: `law`, the shared collector, and `lag` |
| [`lag.ts`](lag.ts) | `change_lag`, with [`lag.test.ts`](lag.test.ts) |

## Sources

Every source below was opened on its official host on 2026-11-05. The date is the one the page itself states.

| Source | Date it shows | What was read |
|---|---|---|
| [Provisional application for patent](https://www.uspto.gov/patents/basics/apply/provisional-application) | Updated 2023-12-15 | The 12-month pendency, restoration to 14 months under 37 CFR 1.78, conversion under 37 CFR 1.53(c)(3), the one-year grace period under 35 U.S.C. 102(b)(1) |
| [MPEP 301](https://www.uspto.gov/web/offices/pac/mpep/s301.html) | Last modified 2026-03-09, R-01.2024 | 35 U.S.C. 261 and 262 as quoted: assignable by an instrument in writing; void against a later buyer unless recorded within three months; what each joint owner may do alone |
| [Patents assignments: change and search ownership](https://www.uspto.gov/patents/maintain/patents-assignments-change-search-ownership); [assignments FAQs](https://www.uspto.gov/learning-and-resources/transferring-ownership-assignments-faqs) | 2026-02-11; 2024-04-30 | Recording through Assignment Center; the assignment search from 1980; no title search before recording |
| [Why search](https://www.uspto.gov/trademarks/basics/why-search-similar-trademarks); [filing basis](https://www.uspto.gov/trademarks/basics/application-filing-basis) | 2023-11-30; 2023-11-30 | Clearance search before filing; use in commerce or intent to use |
| [Intent to use applications](https://www.uspto.gov/trademarks/apply/intent-use-itu-applications) | 2026-03-25 | Statement of Use within six months of the Notice of Allowance, five extensions, 36 months at most |
| [Response time period](https://www.uspto.gov/trademarks/apply/response-time-period) | 2023-03-24 | Three months to answer an office action, one three-month extension |
| [Keeping your registration alive](https://www.uspto.gov/trademarks/maintain/keeping-your-registration-alive) | 2026-11-01 | Section 8 and 9 windows, the six-month grace period |
| [Maintain your patent](https://www.uspto.gov/patents/maintain) | 2025-09-02 | The maintenance fee windows and their grace periods |
| [Trade secret policy](https://www.uspto.gov/ip-policy/trade-secret-policy) | 2026-07-29 | The three elements of a trade secret |
| [C.R.S. 2026, title 7](https://olls.info/crs/crs2026-title-07.pdf) | `Last-Modified` 2026-10-02 | 7-71-101, -102 (trade names); 7-74-101, -102, -107 (trade secrets), in the Word file of the same edition |

**Rights.** The USPTO's [terms](https://www.uspto.gov/terms-use-uspto-websites) (2026-08-13): most government-produced material on the site is in the public domain and may be copied, with the USPTO credited; access that denies or decreases service may be blocked. Its robots file disallows none of the paths above. `olls.info` disallows only `/crs-archive/`.

**Opened 2026-11-07:** copyright.gov ([Circular 30](https://www.copyright.gov/circs/circ30.pdf); no robots file) and uscode.house.gov ([18 U.S.C. 1833](https://uscode.house.gov/us/usc/t18/s1833/); its robots file bars one crawler only). The 2026-11-05 session's network refused both hosts; this one reached them, so both needs carry that date.

**Opened 2026-11-13 for the units (card 380):** each stored section read in full.

| Host | What was read |
|---|---|
| `olls`, C.R.S. 2026 title 7, Word file | 7-70-101 to 7-70-109, all 9 sections |
| `delcode`, enacted as of 2026-10-01 | 6 Del. C. 2001 to 2009; 19 Del. C. 801 to 805 |
| `uscode`, through Pub. L. 119-138 | 35 U.S.C. 119; 15 U.S.C. 1052, 1058, 1059, 1062. 35 U.S.C. 41, the fees, read, not stored |
| govinfo annual edition, revised as of 2025-07-01 | 37 CFR 1.12, 1.53, 1.78, 1.362, 2.34, 2.62, 2.88, 2.89, 2.160, 2.182, 3.11, 3.54. None stopped at a block |
| eCFR's versions list | No later change to those sections |
| `govinfo-fr` | 88 FR 16190 and 90 FR 54636, whole. The second rescinds 89 FR 10043 |

| Unit | Law | Host, status, ship | Needs |
|---|---|---|---|
| `co-trademarks` | C.R.S. 7-70-101 to 7-70-109 | `olls`, VERIFIED, after-statement | None yet |
| `de-trade-secrets` | 6 Del. C. ch. 20 | `delcode`, VERIFIED, after-counsel | 2 |
| `de-employee-inventions` | 19 Del. C. ch. 8: 805, with 801 to 804 on the same page | `delcode`, VERIFIED, after-counsel | 1 |
| `us-patent-act` | 35 U.S.C. 119 | `uscode`, VERIFIED, bundle | 1 |
| `us-patent-rules` | 37 CFR 1.12, 1.53, 1.78, 1.362, 3.11, 3.54 | `govinfo-cfr`, VERIFIED, bundle | 4 |
| `us-trademark-act` | 15 U.S.C. 1052, 1058, 1059, 1062 | `uscode`, VERIFIED, bundle | 3 |
| `us-trademark-rules` | 37 CFR 2.34, 2.62, 2.88, 2.89, 2.160, 2.182 | `govinfo-cfr`, VERIFIED, bundle | 4 |
| `us-ai-authorship-guidance` | 88 FR 16190 | `govinfo-fr`, cite-only | None yet |
| `us-ai-inventorship-guidance` | 90 FR 54636 | `govinfo-fr`, cite-only | None yet |

Card 380 also pointed needs at units already on `main`: `us-patent-basics` (10), `us-copyright-basics` (4), `us-trademark-basics` (2).

| Next slice | Why not now |
|---|---|
| `us-copyright-act`, `us-copyright-rules`: 17 U.S.C., 37 CFR 201, 202 | No need here reads past `us-copyright-basics` |
| The rest of 35 U.S.C., with 41 | Store 41 beside the fee rules, 37 CFR 1.16 to 1.21, so no amount stands alone |
| The rest of 15 U.S.C. ch. 22 and 37 CFR Parts 1 to 3 | Sections only, until a need reads further |

**Scope.** Who owns what founders, staff and contractors build; patent, trademark and trade secret steps and deadlines; Colorado trade names; what investors check; trade secrets and joint patent owners in a fight.

| On another page | Page |
|---|---|
| Non-competes and customer non-solicits | [Employment law](../employment-law/) |
| Entity filings | [Colorado business law](../colorado-business-law/) |

Left out: fee amounts, foreign filing and priority, Madrid filings, copyright registration, domain names and open-source licences (no official `.gov` source for the last two).

**Earlier draft.** This replaces draft #152 (2026-11-02). Several of its flags are shorter than the kit's three-word minimum, most of its references name units and templates that aren't on `main`, and most of its sources are on hosts this session can't reach. Two of its needs are kept, from pages read here: patent maintenance and joint owners.

## Ideal state

A founder or investor who needs a patent, trademark or trade secret rule or deadline gets the right, current one, fast, with its official source and date, and nothing they need is missing.

| Path | Needs | The core of it |
|---|---|---|
| Forming | 13 | Written assignments from founders, staff and contractors; trademark search, basis, deadlines; trade name; trade secrets |
| Raising | 4 | The one-year grace period, the provisional's 12 months, recording an assignment, maintenance fees |
| Angels, groups, VCs | 4 | Signed assignments, USPTO records, a clean chain of title |
| Fights | 2 | The trade secret claim and its limit; what a joint patent owner may do |

## Metrics

The kit's ids, so every law page reads the same. Total = (Q + S + C) / 3.

| Id | Lens | Floor | Goal | Weight | Why |
|---|---|---|---|---|---|
| `coverage` | quality | 0 | 100 | 3 | Nothing they need is missing |
| `flags` | quality | 0 | 100 | 2 | A missed patent or trademark date can't be undone. Each flag is its source's exact words |
| `verified` | quality | 0 | 100 | 1 | With its official source |
| `fresh` | quality | 0 | 100 | 1 | The current one, with its date |
| `rights` | quality | 0 | 100 | 1 | Each install may fetch or link it |
| `change_lag` | speed, days | 30 | 0 | 1 | Days since a source on the list changed after the day it was read; 0 when none |
| `lane_minutes` | consumption, minutes | 10 | 5 | 1 | The daily check costs little. 10 is the `linux` lane's limit |
| `law_lookup_tokens_p95` | consumption, tokens | 10,000 | 2,250 | 3 | Tokens in the law tool's answers to this page's questions, p95, from the kit ([`core/law/PLAN.md`](../../core/law/PLAN.md)). Reads only from a law eval run's report, so it reads missing until one feeds the lane |

Every metric: `max_age_hours` 48. `min_samples` is today's count: coverage 23, verified 3, fresh 15, rights 3, flags 10, change_lag 12 (the sources it watches), lane_minutes 1, law_lookup_tokens_p95 4 (runs that retrieve law: half its 8 questions).

### Goals

| Id | `goal_source` | The number it states |
|---|---|---|
| `flags` | [Provisional application](https://www.uspto.gov/patents/basics/apply/provisional-application) | "The 12-month pendency period cannot be extended": exact, so 100 |
| `rights` | [C.R.S. title 2](https://olls.info/crs/crs2026-title-02.pdf) | 2-5-118: the statute may be fetched and linked; shipping needs its statement. 100 |
| `change_lag` | [5 U.S.C. 553](https://uscode.house.gov/us/usc/t5/s553/) | 30 days' notice before a rule takes effect (553(d)): floor 30, goal 0. As on the SEC and Employment law pages; not opened here |
| `lane_minutes` | [Fowler, Continuous Integration](https://martinfowler.com/articles/continuousIntegration.html) | A fast build: goal 5, as on the other law pages |
| `law_lookup_tokens_p95` | [`web/mcp/contract.ts`](https://github.com/Colorado-Startups/legallas/blob/main/web/mcp/contract.ts) | `COMPACT_LIMITS`: 9,000 characters, 2,250 tokens, the room's own budget for one answer. Floor 10,000: Claude Code warns above it ([MCP docs](https://code.claude.com/docs/en/mcp)) |
| `coverage`, `verified`, `fresh` | This section: repo-made, from the ideal state | All needs, every unit opened on its host, each checked within 365 days |

**Lanes** ([`lanes.json`](lanes.json)). `law` runs `../../core/law/collect.ts intellectual-property-law`: the five quality metrics from repository files, `lane_minutes` from the run's jobs, and the `law.json` the page draws. `lag` runs [`lag.ts`](lag.ts): one HEAD per watched source, and a GET for a USPTO page, which states its own date (`dcterms.modified`, or the MPEP's "Last Modified" line) instead of a `Last-Modified` header. A source with no date, a redirect, or a run with no run link writes `missing`, never 0.

**Questions.** 8 in `needs.json`, each citing what the fetched text cites. Five cite 35 U.S.C. or 37 CFR: `us-patent-basics` holds 102 and 261, and `us-patent-rules` holds 1.53 and 1.78. No trademark question: the trademark pages cite only the TMEP. Not scored: no lane runs them. `law_lookup_tokens_p95` reads from them once a law eval run feeds the lane.

**Sign-off:** needed.

## Chart per metric

| Metric | Chart |
|---|---|
| The IP map, the infographic | Each right (patent, trademark, copyright, trade secret, trade name) against each step (own, protect, deadlines, check, fight). A cell passes when every need in it is held with its deadlines stated; hatched when none belongs there; a red tile before the collector has run |
| `coverage` and every check | The kit's needs charts: needs held per path, then every need against each check |
| All eight | Bullets against goal, the baseline marked |
| The fixes | Road to 100 |

Checked on a synthetic build with the collector's real `law.json`: the publish guard passes, 47 visible words, 55 KB first view, light and dark at 390 and 1280 wide. At 390 the needs grid scrolls inside its own box (#292).

## Baseline

The kit and `lag.ts` on `main` at `dcb1a8e`, 2026-11-05, before any fix. `change_lag` read the 12 sources for real from this session; `lane_minutes` has no reading outside CI.

| Metric | Value | Score |
|---|---|---|
| `coverage` | 18 of 23 | 78.26 |
| `verified` | 3 of 3 units | 100 |
| `fresh` | 14 of 15 (`us-trade-secrets` as of the 2023 edition) | 93.33 |
| `rights` | 3 of 3 | 100 |
| `flags` | 0 of 10 | 0 |
| `change_lag` | 0 days | 100 |
| **Quality 66.01, Speed 100, Consumption 0 (no reading yet), Total 55** | | |

No flag is found: nothing holds the maintenance windows yet, and the checklist states each other deadline in its own words ("6-month grace period", "the fifth and sixth year after registration", "12 months to file").

**Card 380, 2026-11-13.** The collector's law values, `main` at `eb31b057` against this branch:

| Value | Before | After |
|---|---|---|
| Needs naming a law unit | 6 of 23 | 23 of 23 |
| `verified` | 100, 4 units | 100, 12 units |
| `fresh` | 100, 21 sources | 100, 29 sources |
| `rights` | 100, 4 units | 100, 12 units |
| `coverage`, `flags` | 100, 100 | 100, 100 |

## Fixes

Ranked by total points, from the manifest's weights. Each is a small pull request outside this folder.

Fixes 1 to 5 done 2026-11-07, each in the USPTO's words read that day: 3 in `patent-filings` instead of a new item, 5 in the existing `patent-assignment-recording` item; coverage and flags 100.

| # | Fix | Moves | Points |
|---|---|---|---|
| 1 | Checklist `intellectual-property.trademark-registration` in the USPTO's words: Statement of Use, office action, both maintenance windows, the grace period | 5 flags | +4.2 |
| 2 | Checklist `intellectual-property.patent-filings` in the USPTO's words: the grace period and the provisional's 12 months | 2 flags | +1.7 |
| 3 | A checklist item for patent maintenance fees, in the USPTO's words, added to `covered_by` | 1 need, 1 flag | +1.4 |
| 4 | A person opens Circular 30 and 18 U.S.C. 1833 | 2 needs | +1.1 |
| 5 | "within three months from its date" in a document the recording need relies on: #383's `founders/ip-recordation`, added to `covered_by` once merged | 1 flag | +0.8 |
| 6 | "within three years after the misappropriation is discovered" (C.R.S. 7-74-107) in `investors/fights/when-it-happens` | 1 flag | +0.8 |
| 7 | What a joint patent owner may do (35 U.S.C. 262) in `investors/fights/when-it-happens`, added to `covered_by` | 1 need | +0.5 |
| 8 | #383's IP records check in `investors/angels/what-each-side-checks`, added to `covered_by` once merged | 1 need | +0.5 |
| 9 | Read 18 U.S.C. 1833 and 1836 in the current edition; update `us-trade-secrets`'s `as_of` | `fresh` | +0.3 |

## Final

Not reached yet.
