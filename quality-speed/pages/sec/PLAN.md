# Securities and Exchange Commission

Plan for the `sec` page of the Quality and Speed site. Not legal advice. No lawyer has reviewed it. It measures what Legallas holds
for founders, angels, groups and funds from the Securities and Exchange Commission, and lists what to add.

## Sources

Every source below was opened on its official host on 2026-11-02. All are federal works, so each may ship with its source and date
(17 U.S.C. 105; 1 CFR 2.6 for the eCFR; sec.gov says its public information may be copied with credit and no seal). The reviewed list,
[`needs.json`](needs.json), names one of these for each need, with the day it was opened.

| Source | Host | Date it shows | Status |
|---|---|---|---|
| 17 CFR 230.144(d), 148, 152, 501 to 503, 506, 507 | govinfo eCFR bulk file | AMDDATE 2026-10-19; Part 230 last amended 2026-07-20 | Verified |
| 17 CFR 232.10, 239.63, 239.500 | govinfo eCFR bulk file | Part 232 last amended 2026-10-06 | Verified |
| 17 CFR 270.2a51-1, 3c-1, 3c-5, 3c-6, 3c-7 | govinfo eCFR bulk file | 3c-7 last amended 2024-09-30 | Verified |
| 17 CFR 275.203(l)-1, 203(m)-1, 204-4 | govinfo eCFR bulk file | Part 275 last amended 2025-03-12 | Verified |
| 15 U.S.C. 77d, 77r, 78o, 80a-3, 80b-3; 5 U.S.C. 553(d) | uscode.house.gov | Through P.L. 119-136 | Verified |
| Form D and General Instructions | sec.gov | OMB 3235-0076, expires 2027-07-31 | Verified |
| Filing a Form D notice; Rule 506(b); Rule 506(c); Accredited investors | sec.gov | Reviewed 2026-03-17, 2026-09-21, 2026-03-17, 2026-04-24 | Verified |
| Bad actor small entity compliance guide | sec.gov | Reviewed 2013-12-05 | Verified |
| Form ID how-to; EDGAR Next questions; annual confirmation guide | sec.gov | Reviewed 2025-12-22, 2025-12-22, 2025-09-15 | Verified |
| Form ADV General Instructions; Form ADV and IARD questions | sec.gov | SEC 1707 (07-24); answers to 2023-10-26 | Verified |
| Staff letter on Rule 506(c) verification | sec.gov | 2025-03-12 | Verified, a staff view |
| Corporation Finance interpretations 256.35, 256.36, 257.07, 260.39 | sec.gov | Page updated 2026-10-15 | Verified, staff views |

Not opened, so nothing here rests on them: the EDGAR Filer Manual and the Form ID instructions PDF.

## Ideal state

A founder, angel, group manager or fund manager who needs a rule, form or deadline from the SEC gets the right, current one, fast,
with its official source and date, and nothing they need is missing.

### What each path needs

| Path | Needs | The core of it |
|---|---|---|
| Raising | 13 | Rule 506(b) or 506(c), accredited buyers, integration, Form D in 15 days, Form ID and EDGAR first, bad actor check, finders |
| Angels investing | 5 | Accredited status, what a 506(c) issuer may ask for, restricted shares, SPV exclusion, a paid SPV lead |
| Groups | 4 | Demo days and what an angel group is under Rule 148, the broker question, each vehicle's Form D, exempt reporting for a paid manager |
| Funds | 7 | The fund's own Rule 506 offering and Form D, EDGAR access, the two adviser exemptions, exempt reporting, 3(c)(1) or 3(c)(7) |

[`needs.json`](needs.json) is in the shared law kit's format (`quality-speed/core/law/README.md`, PR #81): each need names its official
source, the day it was opened, where the product holds it (`unit:`, `template:`, `item:`) and each deadline's exact words from the
source. A reference that doesn't resolve leaves its need uncovered and names the fix. The 30 test questions sit in the same file.

## Metrics

The kit's ids, so every law page reads the same. The kit measures the five quality metrics from repository files; `collect.ts` adds
`change_lag`.

| Id | Lens | What | Floor | Goal | Weight | Why |
|---|---|---|---|---|---|---|
| `coverage` | Quality | Needs held: every reference resolves | 0 | 100 | 3 | Nothing they need is missing |
| `verified` | Quality | Relied-on pack units marked VERIFIED in the plan | 0 | 100 | 1 | With its official source. The status is the repository's own word, so the reviewer recomputes a sample |
| `fresh` | Quality | Relied-on units, templates and checklist items checked within 365 days, units dated | 0 | 100 | 1 | The current one, with its date |
| `rights` | Quality | Relied-on units each install may fetch or link | 0 | 100 | 1 | Already 100: every SEC unit is a federal work (17 U.S.C. 105) from a host that allows machines |
| `flags` | Quality | Deadlines whose exact words from the source appear in a document the need relies on | 0 | 100 | 2 | A missed Form D or Form ADV date can't be undone. No flag on this list passes on a plan entry alone |
| `change_lag` | Speed | Days since the first eCFR amendment to a relied-on part that its `as_of` in the plan doesn't reflect; 0 when none | 30 | 0 | 1 | A substantive rule is published at least 30 days before it takes effect (5 U.S.C. 553(d)), so the record can be current by then; exemptive rules may take effect at once, which a goal of 0 also catches |
| `law_lookup_tokens_p95` | Consumption | Tokens in the law tool's answers to this page's questions, p95, from the kit ([`core/law/PLAN.md`](../../core/law/PLAN.md)). Reads only from a law eval run's report, so it reads missing until one feeds the lane | 10,000 | 2,250 | 3 | Claude Code warns above 10,000 tokens of tool output; 2,250 is the room's own budget for one answer |

Every metric: `max_age_hours` 48. `min_samples` is today's count, so dropping a row scores 0 instead of raising a share:
coverage 29, verified 10, fresh 24, rights 10, flags 14, change_lag 6 (the CFR parts it watches), law_lookup_tokens_p95 10 (runs that
retrieve law: half its 30 questions, at most 10).

### Goals

| Id | `goal_source` | The number it states |
|---|---|---|
| `rights` | [17 U.S.C. 105](https://www.copyright.gov/title17/92chap1.html) | No copyright in a federal work, so every SEC unit may ship: 100 |
| `flags` | [17 CFR 230.503](https://www.ecfr.gov/current/title-17/section-230.503) | Form D within 15 days of the first sale: a missed date can't be undone, so 100 |
| `change_lag` | [5 U.S.C. 553](https://uscode.house.gov/us/usc/t5/s553/) | 30 days' notice before a rule takes effect (553(d)): floor 30, goal 0 |
| `coverage`, `verified`, `fresh` | This section: repo-made goals, from the ideal state | Nothing missing (all needs), every unit opened on its host, each checked within 365 days |
| `law_lookup_tokens_p95` | [`web/mcp/contract.ts`](https://github.com/Colorado-Startups/legallas/blob/main/web/mcp/contract.ts) | `COMPACT_LIMITS`: 9,000 characters, 2,250 tokens, the room's own budget for one answer. Floor 10,000: Claude Code warns above it ([MCP docs](https://code.claude.com/docs/en/mcp)) |

Cut after review (#422): `questions` and `search_p95`. No lane collects either today.

**What runs where.** [`lanes.json`](lanes.json), in `quality-speed/core/lanes.ts`'s format: two daily Linux lanes, no secret.
- `law` runs the law kit's collector for this page (`../../core/law/collect.ts sec`): the six quality metrics from repository files, and
  the `law.json` the page draws, through `$DETAIL_DIR/page/`.
- `lag` runs `collect.ts`, which needs nothing from the kit: it reads the eCFR versions API, which the eCFR robots file allows, and
  writes `change_lag`, or `missing` when it can't read the source or has no run link.

**Known limit.** Each install fetches CFR text from govinfo's bulk file, which can trail the eCFR by days. `change_lag` measures the
product's own record (`as_of`), not that trail.

**Question set.** Written by an agent that never opened the product's code, from the official text it read; its expected citations
checked again by a second agent, whose five fixes are in. 30 questions: raising 13, angels 6, groups 5, funds 6.

## Chart per metric

The build runs `page.ts` fenced inside `quality-speed/`, so it draws from `render()`'s metrics, this folder's `needs.json`, and the
`law.json` the law kit's collector writes beside `metrics.json` (#81, `readView`).

| Metric | Chart |
|---|---|
| SEC clock, the infographic | Every deadline on the list in three lanes (raising; angels and groups; funds) and five moments (before the sale, the sale, 15 days, 60 days, yearly): filled when the product states it, a red ring when not or before the collector has run |
| Every metric | A bullet against its goal, with the baseline marked |
| `coverage`, `verified`, `fresh`, `rights`, `flags` | The kit's needs charts, on a drill-down page (about 40 KB, so the first view stays under 100 KB) |
| All | Road to 100 from the build's scores |

Checked on `main` at `1df1fd1`, with both lanes run for real through the daily workflow's steps (`core/collect.ts`, `core/merge.ts
--copy-page-files`, `core/build.ts --state`, `core/guard.ts`): first view 24 KB, 52 visible words outside tables, publish guard passes,
no console errors, light and dark, 390 and 1280 wide, no sideways scroll. The drill-down page widens to 541 at 390 because of the chart
kit's grid (#292).

## Baseline

Retaken on `main` at `23a5a4c`, 2026-11-04, with the law kit: the six metrics on the manifest. `change_lag` is the `lag` lane's last
real run (`1df1fd1`, 0 days): this session's network can't reach the eCFR.

| Metric | Baseline | Score |
|---|---|---|
| `coverage` | 17 of 29 needs | 58.6 |
| `verified` | 9 of 10 units (Part 270 is PARTIAL) | 90 |
| `fresh` | 24 of 24 | 100 |
| `rights` | 10 of 10 | 100 |
| `flags` | 10 of 14 | 71.4 |
| `change_lag` | 0 days | 100 |

Quality 76.1, Speed 100, Consumption 0 (no consumption metric yet), total 58.

## Fixes

Gains are total points, from the manifest's weights.

| Rank | Fix | Moves | Total gain | Where |
|---|---|---|---|---|
| 1 | Founder templates: Regulation D record, bad actor questionnaire, Form D and EDGAR access | 8 needs, 4 flags | 11.7 | #125 |
| 2 | A pack unit for Form D and its instructions, `us-sec-form-d` | 3 needs | 2.6 | `web/scripts/law/` and the plan, #15 |
| 3 | Checklist item `financing.edgar-access` | 1 need | 0.9 | `docs/checklist/` |
| 4 | Read all 193 sections of Part 270 and mark it VERIFIED | `verified` | 0.8 | #123 |

Fixes 1 to 3, 2026-11-07: the founder templates landed as `raise/offering-record` and `raise/bad-actor-questionnaire`, with the
funds Form D steps; Form D sits in `us-sec-parts-232-239`. The needs point there: coverage 29 of 29. Left: the 506(c) flag, "within
the prior three months", in the offering record.

Fix 2, 2026-11-13: `us-sec-form-d` stores the form's terms and instructions. Six Form D needs point there too. The rule naming the
form, 239.500, stays in `us-sec-parts-232-239`.

## Final

Not reached yet.
