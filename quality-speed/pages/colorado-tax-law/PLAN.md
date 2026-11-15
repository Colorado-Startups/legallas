# Colorado tax law

Page slug `colorado-tax-law`. Public law only, no case data. Not legal or tax advice; no lawyer or tax professional has reviewed this page or its list.

| File | What it holds |
|---|---|
| [`needs.json`](needs.json) | The reviewed list, in the [law kit's format](../../core/law/README.md): 17 needs with source, path and where the product holds each, 10 deadline and fee flags in the law's exact words, 22 test questions |
| [`manifest.json`](manifest.json) | 8 metrics: the kit's five, `change_lag`, `lane_minutes` and `law_lookup_tokens_p95` |
| [`ideal.json`](ideal.json) | The ideal state, its three official sources, and a line per lens |
| [`page.ts`](page.ts) | The page: the law kit's needs charts from `law.json` (`core/law/page.ts`), bullets against goal, Road to 100 |
| [`lanes.json`](lanes.json) | Two lanes, daily on Linux: the shared law collector, and `collect.ts` |
| [`collect.ts`](collect.ts) | `change_lag`, with [`collect.test.ts`](collect.test.ts) |

## Sources

| Source | Read 2026-11-05 | Machines may fetch | Right to ship its text |
|---|---|---|---|
| [C.R.S. 2026, title 39](https://olls.info/crs/crs2026-title-39.htm), [title 24](https://olls.info/crs/crs2026-title-24.htm), [title 2](https://olls.info/crs/crs2026-title-02.htm), `olls.info` | The sections below. Title 39 `Last-Modified` 2026-10-02, title 24 the same day | Yes: the robots file reads `Disallow: /crs-archive/` only | Cite-only here. Shipping text needs the statement in C.R.S. 2-5-118(2)(a)(I) |
| [HB 26-1223](https://leg.colorado.gov/bills/hb26-1223), `leg.colorado.gov` | "06/04/2026 Governor Signed"; "applies to the sale, storage, use, and consumption of tangible personal property on or after January 1, 2027." Read with `Accept: text/html`; without it the site answers 406 | Yes: `Allow: /`, and no `Disallow` line covers `/bills/` pages | Cited only |
| `tax.colorado.gov`, Department of Revenue | **Refused curl**: HTTP 403, a "Just a moment..." challenge, `robots.txt` too | No, today | Nothing here rests on it |

**Flags, each quoted from its need's source.**

| Need | Kind | Exact words | Where |
|---|---|---|---|
| Annual withholding statements | deadline | "on or before the date established pursuant to section 6071 of the internal revenue code" | 39-22-604(6)(a) |
| C corporation return | deadline | "fifteenth day of the fifth month following the close of the taxable year" | 39-22-608(2)(b) |
| C corporation estimates | deadline | "four required installments for each taxable year", due "April 15", "June 15", "September 15", "December 15" | 39-22-606(4)(a) |
| Sales tax license | fee | "a fee of sixteen dollars" | 39-26-103(1)(c) |
| Sales tax license | fee | "an additional fifty-dollar deposit" | 39-26-103(1)(c) |
| Sales tax license | deadline | "until December 31 of the year following the year in which it is issued" | 39-26-103(1)(a) |
| Remote seller | deadline | "the first day of the month after the ninetieth day" | 39-26-102(3)(c)(I)(B) |
| Software | deadline | "on or after January 1, 2027" | HB 26-1223's page; C.R.S. 39-26-102, editor's note (9) |
| Business equipment | deadline | "no later than the April 15 next following" | 39-5-108 |
| Advanced Industries credit | deadline | "within ninety days after making a qualified investment" | 24-48.5-112(2)(b) |

**Left out, unsourced:** the withholding account's fee and the withholding return schedule. Both were on #95's list from `tax.colorado.gov`, which refused this read. 39-22-604 gives no schedule in its own words: (4)(a) reads "Repealed."

**Reused from #95** (open, unmerged): its 16 needs and 22 questions, each cited section reopened in the 2026 text. Changed: an estimated tax need added; sources moved from `tax.colorado.gov` to the statute; `questions` and `search_p95` cut, as on the other law pages, since no lane collects them; `change_lag` on the Colorado business law page's rule.

**On other pages, so each need has one owner:** wage law, unemployment and FAMLI premiums ([Employment law](../employment-law/)); entity filings ([Colorado business law](../colorado-business-law/)); federal tax ([Federal tax law](../federal-tax-law/)). Left out: the retail delivery fee, enterprise zone and job growth credits, city-collected taxes, real property and excise taxes.

## Ideal state

A founder or investor gets the right, current Colorado tax rule, deadline and fee fast, with its official source and date, nothing missing.

## Metrics

The kit computes the five quality metrics from repository files ([`core/law/`](../../core/law/)); `collect.ts` adds `change_lag`, and the kit's lane `lane_minutes`. Total = (Q + S + C) / 3.

| Metric | Lens | Floor | Goal | Weight | Basis |
|---|---|---|---|---|---|
| `coverage` | quality | 0 | 100 | 5 | Nothing they need is missing: the heart of the page |
| `flags` | quality | 0 | 100 | 2 | A wrong deadline or fee costs a founder money |
| `verified` | quality | 0 | 100 | 1 | With its official source |
| `fresh` | quality | 0 | 100 | 1 | Current, with its date |
| `rights` | quality | 0 | 100 | 1 | Each install may fetch or link it by itself |
| `change_lag` | speed, days | 90 | 0 | 1 | Days since the first `olls.info` change to a relied-on C.R.S. title (its `Last-Modified`) after the plan's `checked` date, or since the next edition was posted while the units still name this one; 0 when none |
| `lane_minutes` | consumption, minutes | 10 | 5 | 1 | The kit's lane time, as on the other law pages (#449). 10 is the `linux` lane's limit |
| `law_lookup_tokens_p95` | consumption, tokens | 10,000 | 2,250 | 3 | Tokens in the law tool's answers to this page's questions, p95, from the kit ([`core/law/PLAN.md`](../../core/law/PLAN.md)). Reads only from a law eval run's report, so it reads missing until one feeds the lane |

`min_samples` is today's count: coverage 17, flags 10, verified 2, fresh 7, rights 2, change_lag 1 (title 39, the one relied-on title), lane_minutes 1, law_lookup_tokens_p95 10 (runs that retrieve law: half its 22 questions, at most 10).

### Goals

| Id | `goal_source` | The number it states |
|---|---|---|
| `flags` | [C.R.S. title 39](https://olls.info/crs/crs2026-title-39.htm) | The deadlines and fees above, in its words: 100 |
| `rights` | [C.R.S. title 2](https://olls.info/crs/crs2026-title-02.htm) | 2-5-118(1)(b)(IV): the committee "Recognizes that other persons ... may, from time to time, also publish ... the statutes ... without the use of the statutory database"; the units here are cite-only: 100 |
| `change_lag` | [HB 26-1223](https://leg.colorado.gov/bills/hb26-1223) | Applies "on or after January 1, 2027", 91 days after title 39's 2026 file was posted (2026-10-02). A record 90 days behind a posted edition misses such a change the day it applies: floor 90, goal 0 |
| `lane_minutes` | [Continuous Integration](https://martinfowler.com/articles/continuousIntegration.html) | Floor 10, goal 5, as the other law pages |
| `law_lookup_tokens_p95` | [`web/mcp/contract.ts`](https://github.com/Colorado-Startups/legallas/blob/main/web/mcp/contract.ts) | `COMPACT_LIMITS`: 9,000 characters, 2,250 tokens, the room's own budget for one answer. Floor 10,000: Claude Code warns above it ([MCP docs](https://code.claude.com/docs/en/mcp)) |
| `coverage`, `verified`, `fresh` | This section: repo-made goals, from the ideal state | All needs, every unit opened on its host, each checked within 365 days |


**Sign-off:** none yet. `signoff_comment` is set once an independent reviewer signs off this list.

**Lanes** ([`lanes.json`](lanes.json)), daily on Linux, no secret: `law`, the shared collector (`../../core/law/collect.ts colorado-tax-law`), repository files only, writing the records to `--out` and `law.json` for the page; and `lag`, this folder's `collect.ts`, one HEAD request per relied-on title and edition to `olls.info`. A failed request, a redirect, or a run with no run link writes `change_lag` as missing, never 0.

## Chart per metric

| Metric | Chart |
|---|---|
| `coverage` and every check | **The infographic,** from the law kit: needs held on each customer path as pictograms, then every need against held, verified, fresh, rights and flags. Before the collector has run, a red tile |
| All eight | Bullets against goal, with the baseline marked, by lens |
| The fixes | Road to 100: one bar per metric short of its goal, sized by the points it adds |

Checked on a synthetic build with the collector's real `law.json`: the publish guard passes, 43 visible words, 43 KB.

## Baseline

The kit's run on `main` at `dcb1a8e`, before any fix, 2026-11-05, scored with `core/score.ts`, and the same on `e739ec1`: nothing merged since touches what it reads. `change_lag` from `collect.ts` the same day. `lane_minutes` reads missing outside CI.

| Metric | Value | Score |
|---|---|---|
| `coverage` | 35.29 (6 of 17) | 35.29 |
| `flags` | 0 (0 of 10) | 0 |
| `verified` | 100 (2 of 2) | 100 |
| `fresh` | 85.71 (6 of 7: `co-angel-credit`'s `as_of` names no year up to this one) | 85.71 |
| `rights` | 100 (2 of 2) | 100 |
| `change_lag` | 0 days | 100 |
| `lane_minutes` | missing | 0 |
| **Quality 46.2, Speed 100, Consumption 0, Total 48**; 82 once the daily lane records its minutes | | |

| Path | Held |
|---|---|
| Forming | 3 of 12 |
| Angels | 1 of 2 |
| Groups, VCs | 2 of 2 |
| Fights | 0 of 1 |

## Fixes

Ranked by points on the total, with `lane_minutes` at goal. Each is product work in its own small pull request outside this folder.

| # | Fix | Points |
|---|---|---|
| 1 | Pack units for the 11 needs with none: #144 (open) proposes `co-tax-code` (title 39, articles 21, 22 and 26) and `co-business-property-tax` (39-3-118, 39-3-119.5, 39-5-108); once it merges, the needs point at them | +10.8 |
| 2 | The 10 flags' exact words in the checklist items and templates their needs rely on, with new items for the sales tax license, withholding statements and estimated tax. Done 2026-11-07: estimated tax, the return date and the property schedule sit in `compliance-and-governance.tax-returns` instead of a new item; flags 100 | +6.7 |
| 3 | `co-angel-credit`'s `as_of` names its edition (#306) | +0.5 |

## Final

Not reached yet.
