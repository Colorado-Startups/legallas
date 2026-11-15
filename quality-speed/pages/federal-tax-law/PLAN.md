# Federal tax law

Page slug `federal-tax-law`. Public law only, no case data. Not tax or legal advice; no lawyer or tax professional has reviewed this
page or its list.

| File | What it holds |
|---|---|
| [`needs.json`](needs.json) | The reviewed list, in the [law kit's format](../../core/law/README.md): 41 needs with source, path and where the product holds each, 12 deadline and fee flags in the IRS's exact words, 34 test questions |
| [`manifest.json`](manifest.json) | 8 metrics: the kit's five, `change_lag`, `lane_minutes` and `law_lookup_tokens_p95` |
| [`page.ts`](page.ts) | The page: bullets against goal, Road to 100, and the law kit's needs charts from `law.json` (`core/law/page.ts`) on a page of their own |
| [`lanes.json`](lanes.json) | Two lanes, daily on Linux: the shared law collector, and `lag.ts` |
| [`lag.ts`](lag.ts) | `change_lag`, with [`lag.test.ts`](lag.test.ts) |

## Sources

Every `irs.gov` source below was opened on 2026-11-05, and each flag's words were found in it. The date is the page's own "Page
Last Reviewed or Updated" line, or a PDF's `Last-Modified`.

| Source | Date | Needs |
|---|---|---|
| [Get an EIN](https://www.irs.gov/businesses/small-businesses-self-employed/get-an-employer-identification-number) | 2026-10-16 | `ein`: "You never have to pay a fee for an EIN" |
| [Limited liability company](https://www.irs.gov/businesses/small-businesses-self-employed/limited-liability-company-llc) | 2026-10-10 | `llc-default-tax` |
| [Form 8832](https://www.irs.gov/pub/irs-pdf/f8832.pdf) (Rev. December 2013) | 2022-08-09 | "can take effect no more than 75 days prior to the date the election is filed" |
| [Instructions for Form 2553](https://www.irs.gov/instructions/i2553) (12/2020) | 2026-04-30 | "No more than 2 months and 15 days after the beginning of the tax year the election is to take effect" |
| [Form 15620, section 83(b) election](https://www.irs.gov/pub/irs-pdf/f15620.pdf) (Rev. 4-2025) | 2025-08-08 | "An 83(b) election must be filed no later than 30 days after the date the property was transferred" |
| [Topic 427, stock options](https://www.irs.gov/taxtopics/tc427) | 2026-09-24 | `incentive-stock-options` |
| [Instructions for Forms 3921 and 3922](https://www.irs.gov/instructions/i3921) | 2026-04-30 | `form-3921` |
| [Publication 550](https://www.irs.gov/publications/p550) | 2026-04-30 | QSBS stock, rollover "during the 60-day period beginning on the date of sale", section 1244 loss |
| [Publication 542](https://www.irs.gov/publications/p542) | 2026-04-30 | Stock for property; estimated tax "due by the 15th day of the 4th, 6th, 9th, and 12th months" |
| [Publication 541](https://www.irs.gov/publications/p541) | 2026-04-30 | Profits interests; publicly traded partnerships |
| [Publication 3402](https://www.irs.gov/publications/p3402) | 2026-04-30 | An LLC's change from partnership to corporation |
| [Publication 15](https://www.irs.gov/publications/p15) | 2026-04-30 | "Form 941 must be filed by the last day of the month that follows the end of the quarter" |
| [Trust fund recovery penalty](https://www.irs.gov/businesses/small-businesses-self-employed/employment-taxes-and-the-trust-fund-recovery-penalty-tfrp) | 2026-10-11 | Two needs |
| [Instructions for Forms 1099-MISC and 1099-NEC](https://www.irs.gov/instructions/i1099mec) | 2026-07-01 | "file Form 1099-NEC on or before January 31"; payments to attorneys |
| [Instructions for Form 1120](https://www.irs.gov/instructions/i1120) | 2026-04-30 | "by the 15th day of the 4th month after the end of its tax year" |
| [Estimated taxes](https://www.irs.gov/businesses/small-businesses-self-employed/estimated-taxes) | 2026-09-25 | Partners and S corporation shareholders |
| [Instructions for Form 6765](https://www.irs.gov/instructions/i6765) | 2026-04-30 | "on or before the due date of the originally filed income tax return (including extensions)" |
| [Instructions for Schedule D](https://www.irs.gov/instructions/i1040sd), [Form 8949](https://www.irs.gov/instructions/i8949), [Schedule K-1 (1065)](https://www.irs.gov/instructions/i1065sk1), [SS-4](https://www.irs.gov/instructions/iss4) | 2026-04-30 | Angels and groups |
| [Instructions for Form 1065](https://www.irs.gov/instructions/i1065) | 2026-04-30 | "by the 15th day of the 3rd month following the date its tax year ended" |
| [Section 1061 FAQs](https://www.irs.gov/businesses/partnerships/section-1061-reporting-guidance-faqs) | 2026-08-21 | "held for more than three years" |
| [Publication 598](https://www.irs.gov/publications/p598); [partnership withholding](https://www.irs.gov/individuals/international-taxpayers/partnership-withholding); [BBA audit regime](https://www.irs.gov/businesses/partnerships/bba-centralized-partnership-audit-regime) | 2026-04-30; 2026-07-21; 2025-11-26 | Funds |

**May machines fetch, may it ship.** The [irs.gov robots file](https://www.irs.gov/robots.txt) disallows search and admin paths only.
The IRS [use of content](https://www.irs.gov/about-irs/use-of-content-from-irsgov) page: content "is not subject to copyright and may
be freely copied. Credit is requested." No seal.

**Opened 2026-11-07.** The 2026-11-05 session's network reached `irs.gov` but not `uscode.house.gov` or `ecfr.gov`. A later
session reached both; their robots files allow these pages. Both 409A needs, 409A severance and the SAFE and QSBS clock carry that
date. `lag.ts` dates them too (2026-11-09): eCFR's versions API gives a section's latest amendment, and a U.S. Code section's
source credit ends with its latest amending law. From 7 to 9 November it read `change_lag` missing, since it dated `irs.gov`
only. **QSBS.** Publication 550 and the Schedule D instructions still say "$50 million" and "held for more than 5 years",
while the plan's `us-tax-founder` note gives the tiers for stock acquired after 2025-07-04. So no QSBS figure is a flag here.

**What changed from #118**, the first draft of this page: every source moved to `irs.gov` and was opened again; flags are three words
or more, as the kit now requires; two estimated tax needs added; `questions`, `search_p95` and `answer_p95` cut, as on the four finished
law pages, since no lane collects them; one question dropped (its pass rule rests on the QSBS asset figure above).

## Ideal state

A founder, angel, group or fund who needs a federal tax rule, form or deadline gets the right, current one, fast, with its official
source and date, and nothing they need is missing.

| Path | Needs | The core of it |
|---|---|---|
| Forming | 18 | EIN, LLC default and elections (8832, 2553), 83(b), options, QSBS, payroll, contractors, returns, estimated tax |
| Raising | 4 | An LLC becoming a corporation, the QSBS clock, 409A after a round, section 382 |
| Angels | 5 | Claiming and rolling over QSBS, section 1244, basis, K-1s |
| Groups | 4 | A vehicle's EIN, return and K-1s, carried interest, QSBS through a vehicle |
| VCs | 7 | The fund's return, carried interest, tax-exempt and foreign partners, transfers, its partnership representative |
| Fights | 3 | 409A severance, settlement reporting, unpaid payroll tax |

## Metrics

The kit computes the five quality metrics from repository files ([`core/law/`](../../core/law/)), and `lane_minutes` for its own
lane; `lag.ts` adds `change_lag`. Total = (Q + S + C) / 3.

| Metric | Lens | Floor | Goal | Weight | Basis |
|---|---|---|---|---|---|
| `coverage` | quality | 0 | 100 | 3 | Nothing they need is missing: the heart of the page |
| `flags` | quality | 0 | 100 | 2 | A wrong date costs a founder money. Each flag is its source's exact words |
| `verified` | quality | 0 | 100 | 1 | With its official source |
| `fresh` | quality | 0 | 100 | 1 | Current, with its date |
| `rights` | quality | 0 | 100 | 1 | Each install may fetch or link it. Already met: the three tax units are federal works |
| `change_lag` | speed, days | 30 | 0 | 1 | The days since an IRS source changed after its need was checked: a page's own date line, or a PDF's `Last-Modified`; the longest over every checked need, 0 when none. 30 is the 83(b) window, so a list that far behind can cost a founder all of it |
| `lane_minutes` | consumption, minutes | 10 | 5 | 1 | The law lane's job minutes, from the kit. 10 is the `linux` lane's limit ([contract](../../contract/README.md)) |
| `law_lookup_tokens_p95` | consumption, tokens | 10,000 | 2,250 | 3 | Tokens in the law tool's answers to this page's questions, p95, from the kit ([`core/law/PLAN.md`](../../core/law/PLAN.md)). Reads only from a law eval run's report, so it reads missing until one feeds the lane |

Every metric: `max_age_hours` 48. `min_samples` is today's count, so dropping a row scores 0 instead of raising a
share: coverage 41, flags 12, verified 3, fresh 25, rights 3, change_lag 36 (the needs with a `checked` date), lane_minutes 1, law_lookup_tokens_p95 10 (runs that retrieve law: half its 34 questions, at most 10).

### Goals

| Id | `goal_source` | The number it states |
|---|---|---|
| `flags` | [Instructions for Form 2553](https://www.irs.gov/instructions/i2553) | The S election's "2 months and 15 days": exact, so 100 |
| `rights` | [IRS use of content](https://www.irs.gov/about-irs/use-of-content-from-irsgov) | "Not subject to copyright and may be freely copied": 100 |
| `change_lag` | [Form 15620](https://www.irs.gov/pub/irs-pdf/f15620.pdf) | "no later than 30 days after the date the property was transferred": floor 30, goal 0 |
| `lane_minutes` | [Fowler, Continuous Integration](https://martinfowler.com/articles/continuousIntegration.html) | The four finished law pages' source for goal 5; not readable from this session |
| `law_lookup_tokens_p95` | [`web/mcp/contract.ts`](https://github.com/Colorado-Startups/legallas/blob/main/web/mcp/contract.ts) | `COMPACT_LIMITS`: 9,000 characters, 2,250 tokens, the room's own budget for one answer. Floor 10,000: Claude Code warns above it ([MCP docs](https://code.claude.com/docs/en/mcp)) |
| `coverage`, `verified`, `fresh` | This section: repo-made goals, from the ideal state | All needs, every unit opened on its host, each checked within 365 days |

**Lanes** ([`lanes.json`](lanes.json)), daily on Linux, no secret: `law`, the shared collector (`../../core/law/collect.ts
federal-tax-law`), repository files only, writing the records and `law.json`; and `lag`, `lag.ts`, one request a second to each of
26 `irs.gov` sources, about 40 seconds. A source off `irs.gov`, a failed request, a redirect, no date, or a run with no run link
writes `change_lag` as missing, never 0. **Known limit:** IRS pages give one date each, so only the latest change shows.

## Chart per metric

| Metric | Chart |
|---|---|
| All eight | Bullets against goal, with the baseline marked, in Quality, Speed and Consumption |
| The fixes | Road to 100: one bar per metric short of its goal, sized by the points it adds |
| `coverage` and every check | The law kit's needs charts on `needs.html`: needs held per path as pictograms, then every need against held, verified, fresh, rights and flags. About 53 KB, so the first view stays under 100 KB |

Checked on a synthetic build with the collector's real `law.json`: the publish guard passes, at most 44 visible words on the first view and
12 on `needs.html`, light and dark, 390 and 1280 wide. At 390 the needs grid scrolls inside its own box, as on the other law pages.

## Baseline

The kit's run on `main` at `d308522`, and `lag.ts` against `irs.gov`, 2026-11-05, before any fix.

| Metric | Value | Score |
|---|---|---|
| `coverage` | 60.97 (25 of 41) | 60.97 |
| `flags` | 25 (3 of 12) | 25 |
| `verified` | 66.66 (2 of 3: `us-tax-founder` is PARTIAL) | 66.66 |
| `fresh` | 100 (25 of 25) | 100 |
| `rights` | 100 (3 of 3) | 100 |
| `change_lag` | 0 days over 36 needs | 100 |
| `lane_minutes` | Reads only in CI | 0 |
| **Quality 62.45, Speed 100, Consumption 0, Total 54** | | |

The three flags found: 83(b) in the checklist, the 60-day rollover and the vehicle's return date in the templates.

## Fixes

Ranked by total points. Law and templates follow the backlog, each in its own small pull request outside this folder.

Done 2026-11-07, each in the IRS's words read that day: fix 2; fix 4; from fix 1, payroll taxes and Form 941, both estimated taxes, the research payroll credit and a vehicle's EIN, in existing checklist items and templates. Coverage and flags 100.

| # | Fix | Points | Size | State |
|---|---|---|---|---|
| 1 | Twelve uncovered needs into the checklist and templates, with their three dates: payroll taxes and Form 941, the trust fund penalty (twice), the company's and owners' estimated tax, the research payroll credit, section 382, a vehicle's EIN, foreign partners, the partnership representative, QSBS through a fund, settlement reporting | +5.7 | Medium | Not filed |
| 2 | The source's words in the checklist: "no more than 75 days", "2 months and 15 days", "15th day of the 4th month", "on or before January 31", "never have to pay a fee for an EIN"; and "15th day of the 3rd month" in the fund calendar | +4.2 | Small | #310, in #383, adds the first three |
| 3 | `us-tax-founder` VERIFIED: Publication 541 for the profits interest rule, in place of Rev. Proc. 93-27 | +1.4 | Small | #312, in #383 |
| 4 | Open the five U.S. Code and eCFR sources from a session that reaches them, and set `checked` | +1.2 | Small | Needs a network that reaches those hosts |

`lane_minutes` reads from the first daily run on `main`: at 5 minutes or less it adds 33.3.

## Final

Not reached yet.
