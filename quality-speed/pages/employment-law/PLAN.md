# Employment law, Colorado and federal

> Research for a quality page. Not legal advice. No lawyer has reviewed it. Statements are checked against the official source on
> the date shown, and marked unverified where that source couldn't be opened.

The reviewed list is [`needs.json`](needs.json), in the shared law kit's format (`quality-speed/core/law/README.md`): 26 needs by
customer path, each with its official source, the day it was opened, and where the product holds it, plus 20 test questions. A need
names the pack unit that should hold its law; until that unit exists, the need reads as a gap and the kit lists it as a fix.

## Sources

| Host | Opened 2026-11-02 | What it gave |
|---|---|---|
| `olls`, Colorado Revised Statutes 2026: titles 8, 24, 26 and the constitution | Yes | Wage Act, minimum wage, equal pay, sick leave and FAMLI, unemployment insurance, workers' compensation, new hire reports, hiring limits, non-competes. The 2026 session is in |
| `govinfo-ecfr`, eCFR bulk: title 29 to 2026-09-30, title 8 to 2026-10-14 | Yes | 29 CFR 516, 541, 795; 8 CFR 274a |
| `uscode`, through Pub. L. 119-136 | Yes | 29 U.S.C. 206, 207; 8 U.S.C. 1324a; 42 U.S.C. 653a; 17 U.S.C. 101, 201; 35 U.S.C. 261; 18 U.S.C. 1833 |
| Federal Register and govinfo | Yes | FTC non-compete rule removed (91 FR 6507); federal exempt salary restored to $684 a week (91 FR 27833) |
| `colorado-labor`, Division of Labor Standards and Statistics | **Refused this cloud** (HTTP 403, a headless browser too). A person read it in a browser on the Mac for the orchestrator, the same day (pull request comment 6570248460) | COMPS Order #40 and the 2026 pay calculation order, both adopted 2025-12-08, effective 2026-02-01 after a temporary order for January; the 2027 orders, proposed, hearing 2026-11-02, not adopted; no reuse terms beyond "© 2026 State of Colorado" |
| `colorado-ccr`, Code of Colorado Regulations | Not tried: its terms bar robots | |

**Opened again 2026-11-13**, for the 7 flagged deadlines: `olls` titles 8 and 26 (`.htm` and `.docx`, title 8 `Last-Modified`
2026-10-02), and govinfo's eCFR title 8 bulk file (amended through 2026-10-14). eCFR's own page sent the fetch to its unblock page,
and its robots file bars `/api/versioner/v1/full/`, so 8 CFR 274a.2 was read on govinfo. The six needs behind the flags carry that date.

**Opened 2026-11-13 for the units (card 370):**

| Host | What was read |
|---|---|
| `olls`, title 8 (`Last-Modified` 2026-10-02) | Articles 2 (8-2-126 to -131), 6, 40 (8-40-202, -203), 70 (8-70-115) and 72 (8-72-114), each stored section read in full. Articles 5, 13.3, 44 and 76 opened again: section counts and 2025 and 2026 source notes match the 2026-11-02 read |
| `uscode`, through Pub. L. 119-138 | 29 U.S.C. 201 to 219 and 8 U.S.C. 1324a |
| govinfo annual edition files | 29 CFR 516 and 795, revised as of 2025-07-01; 8 CFR 274a, revised as of 2025-01-01 |
| eCFR's versions list | No change to 29 CFR 795 since 2024-03-11, or to 516 since 2021-04-30 |
| `colorado-labor` | 403 again: the two orders stay cited and UNVERIFIED |

**The units the needs name.** All `take = "whole"` unless marked. Card 370 added the rows marked new.

| Unit | Law | Host, status, ship |
|---|---|---|
| `co-minimum-wage`, new | C.R.S. 8-6-101 to 8-6-120. Colo. Const. art. XVIII, sec. 15 isn't held | `olls`, VERIFIED, after-statement |
| `co-equal-pay` | C.R.S. 8-5-101 to 8-5-203, with the wage history ban in 8-5-102(2) | On `main` since #185, VERIFIED |
| `co-hiring-limits`, new | C.R.S. 8-2-126 to 8-2-131: credit reports, devices, Social Security numbers, personnel files, criminal history, age | `olls`, VERIFIED, after-statement |
| `co-family-leave` | C.R.S. 8-13.3-201 to 8-13.3-524 | On `main` since #185, VERIFIED |
| `co-unemployment` | C.R.S. 8-76-101 to 8-76-116, premiums and coverage | On `main` since #185, VERIFIED |
| `co-unemployment-general`, new | C.R.S. 8-70-115, the contractor test, and 8-72-114, misclassification fines | `olls`, VERIFIED, after-statement |
| `co-workers-comp` | C.R.S. 8-44-101 to 8-44-206, the insurance article | On `main` since #185, VERIFIED |
| `co-workers-comp-general`, new | C.R.S. 8-40-202 and 8-40-203: who is an employee, with the contractor test, and who is an employer | `olls`, VERIFIED, after-statement |
| `co-new-hire` | C.R.S. 26-13-125 | On `main` since #185, VERIFIED |
| `co-comps-order`, new | 7 CCR 1103-1, COMPS Order #40, `take = "cite-only"` | `colorado-labor`, UNVERIFIED, cite-only. A person read rules 2.2.11, 2.5.1, 2.5.2 and 3.1 on 2026-11-02 |
| `co-pay-calc-order`, new | 7 CCR 1103-14, `take = "cite-only"` | `colorado-labor`, UNVERIFIED, cite-only. A person read Rule 1.2.1 on 2026-11-02 |
| `us-flsa` | 29 U.S.C. 213(a)(1); 29 CFR Part 541, cited only | On `main`; holds the exemptions as a citation |
| `us-flsa-act`, new | 29 U.S.C. 201 to 219, the 21 sections with text | `uscode`, PARTIAL, bundle |
| `us-flsa-rules`, new | 29 CFR 516.1, 516.2, 516.5, 516.6 and Part 795. 516.4, the posting rule, isn't stored | `govinfo-cfr`, PARTIAL, bundle |
| `us-i9`, new | 8 U.S.C. 1324a. 8 CFR 274a.2 read, not stored | `uscode`, VERIFIED, bundle |

**Amounts to keep as dated data**, each needing its source opened before use.

| Amount | Cite | Status |
|---|---|---|
| FAMLI premium 0.88% of wages in 2026; 0.86% from 2027-01-01 | C.R.S. 8-13.3-507(3); 7 CCR 1107-1 | 2026 VERIFIED; 2027 from the FAMLI Division's rules page, read by a person; the rule's redline not opened |
| Division wage claims up to $13,000, 2026-07-01 to 2027-12-31 | C.R.S. 8-4-111(2)(a)(I) | VERIFIED |
| Misclassification fines per employee: $5,000, $10,000, $25,000, $50,000 (wage law); up to $5,000, then $25,000 (unemployment law) | C.R.S. 8-4-113(1)(a)(I.5); 8-72-114 | VERIFIED |
| $5,000 per worker for presenting a void covenant | C.R.S. 8-2-113(8)(b) | VERIFIED |
| Federal minimum wage $7.25; exempt salary $684 a week | 29 U.S.C. 206; 29 CFR 541.600 | VERIFIED |
| 2026, from 2026-02-01: Colorado minimum wage $15.16 an hour; exempt salary $1,111.23 a week ($57,784 a year); highly compensated $130,014, the line 8-2-113(2) points to | 7 CCR 1103-14 Rule 1.2.1, rows (A), (E), (G); COMPS rules 3.1, 2.5.1, 2.2.11 | Read by a person on the Division's PDF |
| 2027: Colorado minimum wage $15.71 an hour | Proposed 2027 pay order, Statement of Basis | Proposed only; the exempt salary and highly compensated lines not confirmed |
| Denver minimum wage $19.29 (2026) | Denver ordinance | Search results only: unverified |

**By path.** First hires are running the company, which the kit's path list doesn't name, so they sit under forming: the founder's
own install. Investors raising check the same forming needs (contractor classification, lawful non-competes) and have none of their
own. Angels, groups and VCs have no needs of their own; their staff follow the same list.

| Path | Needs | Held at `ededebb` | Held on `main` at `1df1fd1` | Held with card 370, 2026-11-13 |
|---|---|---|---|---|
| Forming, with first hires | 21 | 5 | 11 | 21 |
| Fights | 5 | 3 | 3 | 5 |

**Left to other pages, so nothing counts twice:** C.R.S. 24-34 discrimination and nondisclosure limits (Colorado Department of
Regulatory Agencies page); copyright, patent and trade secret law, invention assignments and the whistleblower notice (intellectual
property page), whose questions stay there;
withholding, W-4, 1099-NEC and the IRS employee test (tax pages); Rule 701 (SEC). Delaware's wage and non-compete law reaches only
people working in Delaware. Title VII, the ADA, the ADEA and the FMLA start at 15, 20 or 50 employees.

**Watch:** the Department of Labor proposed replacing the federal contractor test (29 CFR 795) on 2026-02-27 (91 FR 9932); comments
closed 2026-04-28; eCFR showed no change to Part 795 on 2026-11-13. Colorado adopts new pay and COMPS orders each year: the 2026 ones took effect
2026-02-01, and the 2027 ones had their hearing 2026-11-02, not yet adopted. No metric here catches a missed order, because `fresh`
accepts last year's `as_of`, so a person reads each order's own dates and figures when it is adopted.

## Ideal state

A Colorado founder hiring a first employee or contractor, or an investor checking that hire, gets the right, current Colorado or
federal employment rule fast, with its official source and date, and nothing they need is missing.

## Metrics

The law kit's ids and definitions (`quality-speed/core/law/PLAN.md`). The kit measures the quality six from repository files, daily.

| Id | Lens | Unit | Floor | Goal | Weight | Max age | Min samples | Why this goal |
|---|---|---|---|---|---|---|---|---|
| `coverage` | quality | percent | 0 | 100 | 3 | 48 h | 1 | The ideal state: nothing missing |
| `verified` | quality | percent | 0 | 100 | 2 | 48 h | 1 | The status rule in `docs/design/law-pack-plan.toml` `[fields]`: checked only when opened on the official host |
| `flags` | quality | percent | 0 | 100 | 2 | 48 h | 1 | A deadline not in the law's own words can be misread (`docs/legal/product-notices.md` A6) |
| `fresh` | quality | percent | 0 | 100 | 1 | 48 h | 1 | Colorado resets wage, salary and FAMLI numbers every year |
| `rights` | quality | percent | 0 | 100 | 1 | 48 h | 1 | Both COMPS hosts refuse machines: the Division's site answers with 403, and `law-pack-plan.toml`'s `colorado-ccr` terms bar robots. 100 then needs a host each install may fetch, or COMPS taken `cite-only` |
| `change_lag` | speed | days | 30 | 0 | 1 | 48 h | 1 | Lag from an official change to the pack. A federal rule is published at least 30 days before it takes effect (5 U.S.C. 553(d)), so the record can be current by then: goal 0, floor 30 |
| `law_lookup_tokens_p95` | consumption | tokens | 10,000 | 2,250 | 3 | 48 h | 10 | Tokens in the law tool's answers to this page's questions, p95, from the kit ([`core/law/PLAN.md`](../../core/law/PLAN.md)). Reads only from a law eval run's report, so it reads missing until one feeds the lane. Claude Code warns above 10,000 tokens of tool output; 2,250 is the room's own budget for one answer |

`min_samples` is today's count: coverage 26, verified 9, flags 7, fresh 22, rights 9, change_lag 4 (the feeds it watches), law_lookup_tokens_p95 10 (runs that retrieve law: half its 20 questions, at most 10).

### Goals

| Id | `goal_source` | The number it states |
|---|---|---|
| `flags` | [C.R.S. title 8](https://olls.info/crs/crs2026-title-08.htm) | The exact pay, job posting, noncompete and wage claim deadlines in title 8: 100 |
| `rights` | [C.R.S. title 2](https://olls.info/crs/crs2026-title-02.pdf) | 2-5-118: the statutes may be fetched and linked. Federal units: no copyright (17 U.S.C. 105). 100 |
| `change_lag` | [5 U.S.C. 553](https://uscode.house.gov/us/usc/t5/s553/) | 30 days' notice before a federal rule takes effect: floor 30, goal 0 |
| `coverage`, `verified`, `fresh` | This section: repo-made goals, from the ideal state | All needs, every unit opened on its host, each checked within 365 days |
| `law_lookup_tokens_p95` | [`web/mcp/contract.ts`](https://github.com/Colorado-Startups/legallas/blob/main/web/mcp/contract.ts) | `COMPACT_LIMITS`: 9,000 characters, 2,250 tokens, the room's own budget for one answer. Floor 10,000: Claude Code warns above it ([MCP docs](https://code.claude.com/docs/en/mcp)) |

Cut after review (#445): `questions`, `search_p95`. No lane collects them today. `change_lag` moved from 365 and 30 to 30 and 0, a
publicly sourced goal.

Two daily `linux` lanes (`lanes.json`): `law`, the kit's collector, measures the quality
metrics and writes `law.json` beside `page.ts` for the build; `lag` measures `change_lag`.

`change_lag`, this page's own lane (`lag.ts`): the days since an official change to law the list relies on that the law pack plan
doesn't reflect yet, the worst over every feed, 0 when there is none. Two official feeds, both open to machines: eCFR's versions
API for each relied-on C.F.R. part (29 CFR 541, 16 CFR 910), against the date its unit's `as_of` names; and the olls.info C.R.S.
file for each relied-on Colorado title (8, 26), whose `Last-Modified`, and next year's edition once posted, are checked against the
plan's `checked` date. A feed it can't read, or a run with no run link, records `missing`, never 0. The Division's pay and COMPS
orders refuse machines, so a person still checks those each year.

**Questions:** 20 in `needs.json`, two of them traps (the removed FTC rule, a Delaware choice-of-law clause), written by a subagent
that never opened anything under `web/`, from the official texts only. Its four copyright, patent and trade secret questions were
cut: that law belongs to the intellectual property page. The I-9 question cites 8 U.S.C. 1324a(b), which `us-i9` stores. The
citation reader does read 8 CFR 274a.2 (`cfr-8-274a-2`, checked 2026-11-13); the pack's annual edition reader doesn't take that
section yet (fix 7).

## Chart per metric

What `page.ts` draws, after the ring the site puts on every page.

| Metric | Chart |
|---|---|
| `coverage` | The infographic below, the kit's pictogram per path (needs held against listed), and the Held column of the kit's needs grid |
| `verified`, `fresh`, `rights`, `flags` | A column each of the kit's needs grid: a check, a cross, or hatched where it doesn't apply |
| `change_lag` | Its bar on Road to 100, and the ring; a missing one scores 0, so its bar shows what it would add |
| `lane_minutes`, `law_lookup_tokens_p95` | Bullets against goal, in Consumption |
| All | Road to 100: one bar per metric short of its goal, started from the exact lens scores so the bars add up to 100 |

**Infographic: a first hire.** The 12 first-hire checklist items this page scores, as a founder meets them, each against Colorado
and federal law: a check when every need behind it at that level is held, a cross when one isn't, hatched when none. A need's level
comes from its units' ids. `page.ts` reads only its folder: `needs.json` for which needs sit behind each item, and the collector's
`law.json` for what is held; with no `law.json` yet, both read as red tiles. Checked 2026-11-02 on `main` at `1df1fd1`, with the
kit merged (#81): the fenced synthetic build and the publish guard pass, a 48 KB page, no sideways scroll on desktop. On a 390 px
phone the kit's needs grid scrolls the page sideways (#291, #292).

## Baseline

The kit's `collect.ts` and this page's `lag.ts`, run for real on the cloud VM on 2026-11-02 against this `needs.json`, as the daily
lanes run them (`--out`, `$DETAIL_DIR`). `change_lag` joined the list after the kit merged, so the page has a speed reading that
isn't waiting on the live sample room; its baseline reads the feeds behind the units relied on at `ededebb`. The baseline is before any fix, at `main` `ededebb`. Now is `main` at `1df1fd1`: #185 added five of the units this
list names, and #316 verified them. CI's daily lane takes over from the next run on `main` after this merges.

| Metric | Baseline | Now | Score now | Card 370: the kit's `assess` on its branch, 2026-11-13 |
|---|---|---|---|---|
| `coverage` | 30.76 (8 of 26) | 53.84 (14 of 26) | 53.8 | 100 (26 of 26) |
| `verified` | 100 (4 of 4 units) | 100 (9 of 9) | 100 | 88.88 (16 of 18): the two Division orders are UNVERIFIED |
| `flags` | 0 (0 of 7) | 100 (7 of 7), the kit's `lawView` on this change, 2026-11-13 | 100 | 100 (7 of 7) |
| `fresh` | 94.11 (16 of 17) | 95.45 (21 of 22): `us-flsa` names a 2023 edition | 95.5 | 100 (31 of 31) |
| `rights` | 100 (4 of 4) | 100 (9 of 9) | 100 | 100 (18 of 18) |
| `change_lag` | 0 days (3 feeds) | 0 days (4 feeds) | 100 | Not rerun. 5 feeds: `us-flsa-rules` adds 29 CFR 795, unchanged since 2024-03-11 |
| **Total**, retaken with the six metrics on `main` at `23a5a4c`, 2026-11-04 | | **53** (Quality 61.9, Speed 100, Consumption 0, no consumption metric yet) | | Not retaken |

## Fixes

Ranked by points on today's total. One need is worth 0.9. Law goes into the default pack, each its own small pull request in
`web/scripts/law/default-pack-units.ts` and `docs/design/law-pack-plan.toml`, on the Project 1 cards filed from this page.

| Rank | Fix | Gain | Waits on |
|---|---|---|---|
| 1 | **Done 2026-11-13.** Quote the law's words for the 7 flagged deadlines in the checklist items the needs rely on. `wage-claims` now also relies on `people.colorado-wage-rules`, where a founder reads the 14-day demand rule | flags 0 to 100: +14.8 | |
| 2 | **Done 2026-11-13, card 370.** Add `co-minimum-wage`, `co-hiring-limits`, `us-i9`, `us-flsa-act` | 4 needs | |
| 3 | **Cited 2026-11-13, card 370.** `co-comps-order` and `co-pay-calc-order` hold their needs as citations, UNVERIFIED. Left: a person reads each adopted order, the 2027 ones included, and the plan records what was read | verified 88.88 to 100 | A person |
| 4 | **Done 2026-11-13, card 370.** Add `us-flsa-rules`. `workplace-notices` now names `us-flsa-act`, which holds the 218b notice, since 516.4 isn't stored | 1 need | |
| 5 | **Done 2026-11-13, card 370.** Add `co-unemployment-general` and `co-workers-comp-general` | 2 needs | |
| 6 | Fix `us-flsa`'s edition, `co-wage-act`'s paths and the Division host's notes (#299) | fresh reads 100 on card 370's branch | |
| 7 | Store 29 CFR 516.4 and 8 CFR 274a.2: `cfr-annual.ts` stops at 516.4's extract block and 274a.2's effective date note, and its section pattern rejects a lettered part | The posting rule and the I-9 timing rule as stored text | A reader change |

Done by others since the baseline: #185 added `co-equal-pay`, `co-family-leave`, `co-workers-comp`, `co-unemployment` and
`co-new-hire`, and #316 verified them.

## Final

Not reached.
