# Delaware tax law

Page slug `delaware-tax-law`. Public law only, no case data. Not legal or tax advice; no lawyer or tax professional has reviewed this page or its list.

| File | What it holds |
|---|---|
| [`needs.json`](needs.json) | The reviewed list, in the [law kit's format](../../core/law/README.md): 23 needs with source, path and where the product holds each, 17 deadline and fee flags in the statutes' exact words, 21 test questions |
| [`manifest.json`](manifest.json) | 8 metrics: the kit's five, `change_lag`, `lane_minutes` and `law_lookup_tokens_p95` |
| [`page.ts`](page.ts) | The page: the law kit's needs charts from `law.json` (`core/law/page.ts`), bullets against goal in Quality, Speed and Consumption, Road to 100 |
| [`lanes.json`](lanes.json) | Two lanes, daily on Linux: the shared law collector, and `lag.ts` |
| [`lag.ts`](lag.ts) | `change_lag`, with [`lag.test.ts`](lag.test.ts) |

## Sources

Every source below was opened on its official host on 2026-11-05. Every flag in `needs.json` is quoted from the page its need names.

| Source | What it settles | Flags quoted from it |
|---|---|---|
| [8 Del. C. ch. 5](https://delcode.delaware.gov/title8/c005/index.html) | Franchise tax: report and payment, the two methods, minimums and maximum, total assets, penalty and interest, estimates, proration, refund, good standing, void charter | "on or before March 1" (502(a)); "the sum of $200" (502(c)); "does not exceed 5,000 shares, $175", "add $400 for each $1,000,000" (503(a)); "more than $200,000" (503(c)); "on June 1 of the current year" (504(a)(1)); "March 1 of the second calendar year" (505(a)) |
| [8 Del. C. ch. 1, subch. XVIII](https://delcode.delaware.gov/title8/c001/sc18/index.html) | 391(a)(18): the report fee, $50, or $25 if exempt | "a fee of $50" |
| [8 Del. C. ch. 1, subch. XII](https://delcode.delaware.gov/title8/c001/sc12/index.html) | 312(g): revival pays the back tax, or 3 times the tax after 5 years void | |
| [6 Del. C. ch. 18, subch. XI](https://delcode.delaware.gov/title6/c018/sc11/index.html) | 18-1107: LLC tax $400, $100 per registered series, due June 1, $200 late, good standing; 18-1108 cancellation; 18-1109 revival | "in the amount of $400", "$100 per registered series" (b); "the first day of June" (c); "the sum of $200" (e) |
| [6 Del. C. ch. 17, subch. XI](https://delcode.delaware.gov/title6/c017/sc11/index.html) | 17-1109: LP tax $400, due June 1, $200 late; 17-1111 revival | "in the amount of $400" (a); "on June 1 following the close of the calendar year" (b); "the sum of $200" (d) |
| [30 Del. C. ch. 19](https://delcode.delaware.gov/title30/c019/index.html) | 1902(b)(6): no income tax for a corporation with only a statutory office | |
| [Delaware Code home page](https://delcode.delaware.gov/) | "This version includes all acts enacted as of October 01, 2026" | |

**Could not be opened from this session** (the network refused the hosts): the Division of Corporations (`corp.delaware.gov`), the Division of Revenue (`revenue.delaware.gov`), and HB 400, 85 Del. Laws c. 273 (`legis.delaware.gov`). So nothing here rests on them, and three needs from the first list (#91) are left out until a read: the tax running until dissolution and no other Delaware tax without operations (both from the Division's FAQ), and the 2026 start of the $400 LLC and LP tax (the session law). Four more are cut to keep the page under its 100 KB first view: who signs the report and the half rate (procedure), how Delaware classes an LLC (income tax), and the unclaimed property report (not a tax, 12 Del. C. ch. 11, which #144 adds to the plan).

**Scope.** What a founder, angel group or fund needs from Delaware's entity taxes: the corporation franchise tax and annual report, the LLC and LP annual tax, their late penalties, refunds, revival, and the income tax a company with only a statutory office doesn't owe. Entity law itself is the Delaware business law page's.

## Ideal state

A founder, angel group or fund gets the right, current Delaware franchise, LLC or LP tax rule fast, with its official source and date. ([`ideal.json`](ideal.json))

| Path | Needs | What |
|---|---|---|
| Startup forms | 12 | Report and tax by March 1, the report fee, both methods and the gap, minimums and maximum, total assets, the late penalty, refunds, income tax, a founder's LLC tax |
| Startup raises | 3 | Estimates from $5,000, good standing at closing, a share change mid-year |
| Angels invest | 1 | An SPV's LLC or LP tax |
| Angels create a group | 3 | The group's LLC tax, $100 per registered series, the late LLC tax |
| VCs invest | 2 | Fund, general partner and manager tax, the late LP tax |
| Fights | 2 | Void charter, revival |

## Metrics

The kit computes the five quality metrics from repository files ([`core/law/`](../../core/law/)); `lag.ts` adds `change_lag`; the kit's lane adds `lane_minutes`. Total = (Q + S + C) / 3.

| Metric | Lens | Floor | Goal | Weight | Basis |
|---|---|---|---|---|---|
| `coverage` | quality | 0 | 100 | 3 | Nothing they need is missing |
| `flags` | quality | 0 | 100 | 2 | A missed date costs at once: $200 and interest each month (502(c), 504(c); 18-1107(c), (e); 17-1109(b), (d)) |
| `verified` | quality | 0 | 100 | 1 | With its official source |
| `fresh` | quality | 0 | 100 | 1 | Current, with its date |
| `rights` | quality | 0 | 100 | 1 | Each install may fetch or link it by itself |
| `change_lag` | speed, days | 30 | 0 | 1 | Days from the oldest "Enacted through" date among this page's units in the pack plan to the date on the Code home page's line "includes all acts enacted as of". It grows when Delaware adds acts and falls when someone re-checks the units |
| `lane_minutes` | consumption, minutes | 10 | 5 | 1 | The law lane's own job time, from the kit |
| `law_lookup_tokens_p95` | consumption, tokens | 10,000 | 2,250 | 3 | Tokens in the law tool's answers to this page's questions, p95, from the kit ([`core/law/PLAN.md`](../../core/law/PLAN.md)). Reads only from a law eval run's report, so it reads missing until one feeds the lane |

`max_age_hours` is 48, for the daily lanes. `min_samples` is today's count: coverage 23, flags 17, verified 5, fresh 11, rights 5, change_lag 5 (the units it reads), lane_minutes 1, law_lookup_tokens_p95 10 (runs that retrieve law: half its 21 questions, at most 10).

### Goals

| Id | `goal_source` | The number it states |
|---|---|---|
| `flags` | [8 Del. C. ch. 5](https://delcode.delaware.gov/title8/c005/index.html) | The deadline and penalty are exact words, "on or before March 1" and "the sum of $200" (502(a), (c)): exact, so 100 |
| `change_lag` | [Delaware Code home page](https://delcode.delaware.gov/) | Its "includes all acts enacted as of" date is the official currency: 0 days behind it is the goal. 30 days, one month of a stale record, is the floor, as on the SEC and Colorado business law pages |
| `lane_minutes` | [Continuous Integration](https://martinfowler.com/articles/continuousIntegration.html) | The other law pages' source, signed off on #449: goal 5, floor 10. Not opened here: the network refused the host |
| `law_lookup_tokens_p95` | [`web/mcp/contract.ts`](https://github.com/Colorado-Startups/legallas/blob/main/web/mcp/contract.ts) | `COMPACT_LIMITS`: 9,000 characters, 2,250 tokens, the room's own budget for one answer. Floor 10,000: Claude Code warns above it ([MCP docs](https://code.claude.com/docs/en/mcp)) |
| `coverage`, `verified`, `fresh`, `rights` | This section: repo-made goals, from the ideal state | All needs held, every unit opened on its host, each checked within 365 days, each fetchable by an install |

Left off, as on the other law pages (#444): `questions`, `search_p95`, `answer_p95`, until a lane collects them. The questions stay in `needs.json` for the law eval.

**Lanes** ([`lanes.json`](lanes.json)), daily on Linux, no secret: `law`, the shared collector (`../../core/law/collect.ts delaware-tax-law`), repository files only, writing the records to `--out` and `law.json` for the page; and `lag`, `lag.ts`, one GET of the Code home page, which has no robots file. A failed request, a redirect, a unit with no date or dated after the Code, or a run with no run link writes `change_lag` as missing, never 0.

## Chart per metric

| Metric | Chart |
|---|---|
| `coverage` and every check | **The infographic,** from the law kit: needs held on each customer path as pictograms, then every need against held, verified, fresh, rights and flags. Before the collector has run, a red tile |
| The six quality and speed metrics | Bullets against goal, with the baseline marked, as on the other law pages |
| `lane_minutes`, `law_lookup_tokens_p95` | Bullets against goal, in Consumption |
| The fixes | Road to 100: one bar per metric short of its goal, sized by the points it adds |

Checked on a synthetic build with the collector's real `law.json`: the publish guard passes, unsigned with every reading missing (45 visible words, 93 KB first view) and signed off at goal (40 words, 91 KB), and light and dark, phone and desktop render with no console errors. At phone width the needs grid scrolls inside its own box.

## Baseline

The kit and `lag.ts`, through the lane runner (`node quality-speed/core/collect.ts --page delaware-tax-law --lane law`, then `--lane lag`) on `main` at `9b9511c`, 2026-11-05, before any fix. Lab: a local run has no run link, so the records read missing until the daily run on `main`.

| Metric | Value | Score |
|---|---|---|
| `coverage` | 23 of 23 | 100 |
| `flags` | 0 of 17 | 0 |
| `verified` | 5 of 5 | 100 |
| `fresh` | 11 of 11 | 100 |
| `rights` | 5 of 5 | 100 |
| `change_lag` | 0 days: every unit and the Code read 2026-10-01 | 100 |
| `lane_minutes` | Needs a CI run | 0 |
| **Quality 75, Speed 100, Consumption 0, Total 58.** With a lane of 5 minutes or less, 91 | | |

No flag is found: the templates and checklist give each deadline and fee in their own words, not the statutes'.

## Fixes

Ranked by total points. Each is a small pull request outside this folder that quotes the statute's words where the need relies on them.

| # | Fix | Flags | Points | Where |
|---|---|---|---|---|
| 1 | The first daily run on `main`, for `lane_minutes` | | +33.3 | The kit's lane |
| 2 | The franchise report deadline, penalty, estimates and refund (#363 adds the refund's words) | 4 | +2.0 | `templates/founders/delaware-corporation-certificate.md` |
| 3 | The report fee, the authorized shares minimum, the assumed par value rate and the maximum | 4 | +2.0 | `templates/founders/entity-comparison.md` |
| 4 | The group's LLC tax, due date, series tax and late penalty | 4 | +2.0 | `templates/investors/groups/manager-annual-duties.md` |
| 5 | The fund's LP tax, due date and late penalty | 3 | +1.5 | `templates/investors/funds/compliance-calendar.md` |
| 6 | A founder's LLC tax and due date | 2 | +1.0 | `docs/checklist/baseline.toml`, `delaware-llc-annual-tax` |

A person's read of the Division's pages and the session law would bring back the three needs left out for want of a source.

## Final

Not reached yet.
