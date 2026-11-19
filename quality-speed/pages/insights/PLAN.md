# Insights: plan

Converted to Git Crafter's model (2026-11-04). Git Crafter has no delivery template, so this page starts from its own ideal state, as `ideal.json`. It takes over draft pull request 117, whose session has stopped, and keeps its seven metrics, collector, failure drill, reviewed list and page. The list moved to #440 and was signed off there at `3cbb1d7` in comment 6643841137, now `manifest.json`'s `signoff_comment`. Rounds 1 to 7 below were on draft 117.

| Metric | `goal_source` |
|---|---|
| `change_failure_rate`, `rework_rate`, `failure_drill`, `change_frequency`, `lead_time_p50`, `recovery_time_p50` | Accelerate State of DevOps Report 2024, through its host page (p. 13's levels, as below) |
| `merges_tied_to_issue` | GitHub Docs: Linking a pull request to an issue |
| `api_calls` (dropped 2026-11-05, #645) | Not added. The calls this page's own read makes (508 on 2026-11-05, run 42067834620) are a cost of measuring, like `lane_minutes`, not of delivery. Delivery's runner cost is the Actions page's billed minutes per merge. So `lane_minutes` stays this page's only Consumption metric. Reading only new merges would still cut the job's time |

`ideal.json`'s GitHub Docs were read 2026-11-04 from their source in `github/docs` (they show no date, so each is dated the day read). The report was read by draft 117 on 2026-11-02. It is dated 2024-10-22, its release; this session can't open the PDF to check the date printed on it. Its host page's address doesn't hold the programme's acronym.

## Sources

Read for this plan on 2026-11-02.

| Source | What it gave |
|---|---|
| *Accelerate State of DevOps Report 2024*, v. 2024.3, the PDF from the delivery research programme's site | p. 10: the four keys' definitions. p. 11: the rework rate question ("how many deployments in the last six months were not planned but were performed to address a user-facing bug"), and that rework rate and change failure rate together form one stability factor. p. 12: throughput is lead time, deployment frequency and recovery time; stability is change failure rate and rework rate. p. 13: the performance levels (below). p. 14: "Improving should be more important to a team than reaching a particular performance level." p. 16, note 1: a change failure is one that "causes an issue after landing in production". p. 74: the metrics are not for comparing teams, "and certainly not to compare individuals" |
| The programme's guide to its software delivery performance metrics (updated 2026-01-05) | Current definitions of the five metrics, and the caution that metrics set as goals invite gaming |
| The programme's history of its software delivery metrics | Rework rate added in 2024; "time to restore" renamed failed deployment recovery time in 2023, so a failure means one caused by a change |
| The programme's 2025 survey questions | The same five questions, still asked of "the primary application or service you work on" |
| This repository: `CLAUDE.md`, `REVIEW.md`, `.github/workflows/ci.yml`, the merged pull requests and CI runs on `main` | How changes reach `main`, and the history measured below |

The 2024 performance levels, as printed on p. 13 (clusters found in that year's survey, not targets the report sets):

| Level | Change lead time | Deployment frequency | Change fail rate | Failed deployment recovery time |
|---|---|---|---|---|
| Elite | Less than one day | On demand (multiple deploys per day) | 5% | Less than one hour |
| High | Between one day and one week | Between once per day and once per week | 20% | Less than one day |
| Medium | Between one week and one month | Between once per week and once per month | 10% | Less than one day |
| Low | Between one month and six months | Between once per month and once every six months | 40% | Between one week and one month |

No rework rate levels are published there, and no other number from the report is used on this page.

The programme's acronym matches a protected word in this repository, so this plan names it only by its work, and leaves
out its site's addresses, which hold the acronym; each source is findable by its title.

## Ideal state

Delivery health is visible and improving: every change that reaches `main` is counted the day after, the share that needed
repair and the time to repair it are known, and each number moves toward its goal.

**What a change is here.** The repository ships no service of its own: each customer installs a room from `main`. So a
pull request merged into `main` is this repository's deployment, and "production" is `main`. Left out: pull requests into
other branches, and this site's own work: a pull request that touches `quality-speed/` or a site workflow
(`.github/workflows/quality-speed*.yml`), whose every other file is on a short list of files the site's rollout shares (CI
areas, labels, `REVIEW.md`, `CLAUDE.md`, `CONTRIBUTING.md`, the review workflow), and that repairs no change that counts.
So a site follow-up to site work is left out too. One that also
changes the product counts like any other change, and so do fixes page sessions make outside the folder. Each excluded
number is listed in `detail.json`.

**No per-person metrics.** One GitHub login does all the work, and the report says not to compare individuals (p. 74).

## Metrics

Seven metrics, all read from GitHub's REST API by `collect.ts` with the workflow's read-only token. Windows end at the
time of the run. Any API error, short read or low rate limit writes every metric as `missing`. A reading needs the
Actions run that made it (`contract/README.md`, "Run link"), so a run by hand writes every record as `missing` and prints
the readings instead.

| Metric | Lens | Why it proves the ideal | How it is measured | Floor | Goal | Weight | Min samples |
|---|---|---|---|---|---|---|---|
| `change_failure_rate` | Quality | The report's stability metric: how often a change needed immediate repair | Percent of changes merged 7 to 35 days ago that later needed repair: reverted, fixed or followed up by a change naming them within 7 days, or whose own CI run on `main` went red. Waiting 7 days means a change's failure state can't change after it is counted | 40 % (the report's low level, p. 13) | 5 % (its elite level, p. 13) | 3 | 20 changes |
| `rework_rate` | Quality | The report's second stability metric: deployments "not planned but performed to address a user-facing bug" (p. 11) | Percent of changes in the last 28 days that repair an earlier merged pull request (see "How a repair is found"), or fix a bug: closing an issue labelled `bug`, or saying "Repairs: a bug" | 40 % | 5 % | 2 | 20 changes |
| `merges_tied_to_issue` | Quality | `CLAUDE.md`: bugs, errors and quick fixes are GitHub issues, and features and improvements are cards on the org's Project board. Work that traces to either is visible work | Percent of changes in the last 28 days tied to the backlog: an issue by a closing keyword ("Closes #n", "Fixes #n", "Resolves #n") or an `Issue: #n` line, a link to a card on the Legallas board on that `Issue:` line (its project number pinned in `reviewed.json` as `backlog_board`: Project 1, as the orchestrator named it on #117, comment 6571406045 (#117), and as other pull requests cite it; unverified until the board can be read, and Project 1 may hold other codebases' cards, which would tie too), or by repairing a change that is tied. A passing mention ties nothing, and neither does the issue that orders the backlog (`reviewed.json`). Dependabot's updates, found by its own login, follow its schedule, so they are left out | 50 % | 90 % | 2 | 10 changes |
| `failure_drill` | Quality | Proves failure detection works, so a clean record can read "no events" (`contract/README.md`) | Every run: (1) copies the live history, plants three invented failures shaped like GitHub's records (a revert made with GitHub's button, a follow-up fix, a red CI run on `main`) and finds all three with their exact recovery times, the real results unchanged; (2) finds every real repair on the reviewed list, whatever its age, and the list was refreshed within 35 days; (3) finds a CI result on `main` for every real change of the last 35 days. Any check failing makes the three failure metrics `missing` too | 0 | 1 | 1 | 1 |
| `change_frequency` | Speed | The report's deployment frequency, counted so one busy day can't hide a stall | Days with at least one change, per week, over the last 28 completed UTC days (fewer while the repository is younger) | 1 a week (the report's high to medium line, p. 13) | 5 a week | 2 | 7 days observed |
| `lead_time_p50` | Speed | The report's change lead time | Median hours from a change's first commit, or its opening if earlier, to its merge into `main`, over the last 28 days | 168 h (one week: past the report's high level, p. 13) | 24 h (its elite level, "less than one day", p. 13) | 2 | 10 changes |
| `recovery_time_p50` | Speed | The report's failed deployment recovery time | Median hours from a failed change's merge to its first repair merging, or to the end of the next green CI run on `main`, over recoveries in the last 28 days. A failure still open counts at its age so far, so a red `main` can't read as good news. None at all: `no_events`, which scores only while `failure_drill` passes | 24 h (past the report's high and medium "less than one day", p. 13) | 1 h (its elite level, p. 13) | 1 | 1 recovery |

**How a repair is found.** A merged pull request repairs an earlier merged one (into any branch) when it says so:
repair words directly before the number ("Reverts #n", "A follow-up to #n", "Follows #n", "Fixes #n", "Repairs: #n"),
"the same fixes as #n", a sentence that calls itself a follow-up and names `#n`, GitHub's `revert-<n>-` branch, or "This
reverts commit" with a merged commit. Only a repaired change merged into `main` counts as a failure. HTML comments and
fenced code are skipped.

**The reviewed list** (`reviewed.json`, numbers and one date) holds the real repairs found by reading every merged pull
request up to `reviewed_through` (`#36`, `#40`, `#57`, from the 2026-11-19 review of this repository's 57 merges: the
first review's numbers were the earlier private repository's, so recall failed here), the issue that
orders the backlog (`#33`, a number from that repository too: here a pull request, so it excludes nothing), and the Legallas board's project number (`backlog_board`, 1). The detector reads only a pull request's text and merge order, and the pull request list holds
every one, so the drill checks every entry whatever its age, and fails on a miss or an empty list: a change to the
detector or to GitHub's records that loses real repairs shows as red. The drill also fails once `reviewed_through` is more
than 35 days old, so "no events" keeps resting on current phrasing. Refreshing it is a monthly task: read every pull
request merged since, add each real repair, move the date, and have an independent reviewer sign the change in the pull
request. Removing an entry, moving the date without reading, or setting or changing `backlog_board` is a loosening and
needs that reviewer's sign-off, like any goal (`contract/README.md`, "goals only tighten"). New entries come from review, never from the collector.

Why these goals:

- **Failure rate and recovery time** take the report's elite values from p. 13 as goals, and its low or high edges as floors.
  The report warns that levels are not targets (p. 14, p. 74), so the trend charts carry as much weight as the score.
- **Rework rate** has no published levels. The report finds it moves with failure rate as one factor (p. 11), and here each
  repair points at the change it repairs, so it takes the same floor and goal.
- **Lead time** takes the report's elite edge, less than one day, as its goal, and one week as its floor (p. 13). The baseline
  already meets it (median 0.27 h), which the cited source allows; the goal tightens once a month of trend backs a
  stated reason.
- **Change frequency**: the report's elite level deploys on demand, several times a day. For one owner and the sessions they start, a
  change landing on 5 days of 7 is the stated target; the floor is the report's once-a-week line (p. 13). The baseline of 7 a
  week rests on one completed day, below the 7-day minimum, so it doesn't count as meeting the goal.
- **Tied to the backlog**: 90 % leaves room for small chores with neither an issue nor a card; below half, the backlog no longer explains most
  of the work.
- **Sample minimums** are counts, met within one busy day at today's pace. That is enough for a median or a share, and the
  28-day window keeps one day from deciding it.

What was considered and left off:

- **Per-person anything**: one login, and the report advises against it.
- **Open to merge time and first-pass green**: the Pull requests page measures those. Lead time here runs from the first
  commit, so today it is that page's open-to-merge time plus a few minutes, and failure rate and rework count the same
  events as that page's reverts and fix-ups within 7 days. The master plan gives both pages these metrics; the overlap is
  kept, and both pages should share one repair detector (`references()` in `delivery.ts`), moved into `core/` when that
  lands.
- **Main's CI success rate**: the Actions page measures it; here a red run only marks the change that caused it.
- **Counting follow-ups by matching changed files**: iterative work touches the same files on purpose, so it would count
  planned work as rework.

### Known limits

- A repair is found by its words. A bug fix that names no earlier pull request and closes no issue labelled `bug` (for
  example `#7` and `#11`, which fixed code from the first import) is missed, so rework reads low rather than high. The
  `bug` label is in use (`#39`, `#51` and `#58` carry it) and the collector reads it; fixes 2 and 3 below make the rest
  exact for new work. A bug filed without the label hides its fix from rework.
- An `Issue:` line naming a broad issue ties anything to it. Only the order issue is refused by number. A board card link
  is matched by its shape and the pinned board number, not looked up: reading the board needs the org Projects key (the
  owner's step 2), so a link to a card that doesn't exist on that board would still count.
- Lead time starts at the oldest commit still on the pull request. A branch rebuilt from scratch starts later than the
  work did.
- A failure is counted on `main`, before any customer installs it, which is earlier than the report's "after landing in
  production" (p. 16, note 1). For this repository that is the honest line: `main` is what customers install.
- A planted drill proves the mechanics on live records; the recall check is what proves real phrasing is still found, and
  it covers only reviewed repairs.

## Chart per metric

Forms chosen with the `dataviz` method and built from the chart kit, which sets colors, tooltips and dark mode
(`page.ts`). Daily series come from `detail.json`: merged history doesn't change, so each run rebuilds its own trend.

| Metric | Chart |
|---|---|
| `change_failure_rate` | Bullet against floor and goal, baseline marked |
| `rework_rate` | Bullet; daily trend line with goal and baseline |
| `merges_tied_to_issue` | Bullet; daily trend line with goal and baseline |
| `failure_drill` | Bullet reading pass or fail, with the run link |
| `change_frequency` | Bullet; **the infographic** (`calendar.ts`): the last 28 days as a calendar, a week to a row, a real table in the kit's heatmap classes, darker for more changes merged that day, blank for none, the kit's alert mark on a day whose changes later needed repair |
| `lead_time_p50` | Bullet; daily median trend line with goal and baseline |
| `recovery_time_p50` | Bullet; a table of every failure: the change, what repaired it (or "open", or "green CI"), and the hours |
| Road to 100 | The kit's waterfall, one step per fix below: "A week", "Issue line", "Review first" and the rest, each its metrics' share of the points short |

Also on the page: the mark key and a sortable table of every metric with its value, samples, score and state; the build
adds the title and the score ring. A trend with fewer than two days reads "Too few", the kit's empty state. The calendar,
trends and recoveries read the collector's drill-down rows: the daily lane (`lanes.json`) writes them to
`$DETAIL_DIR/page/detail.json`, and the workflow puts that file beside `page.ts` before the build (`core/detail.ts`). With
no rows, the calendar is a red "missing" tile and the rest is left off.

**Checked** inside the site build (`node quality-speed/core/build.ts`), on synthetic numbers and on a live run with its
drill-down rows, served locally: the publish guard passes, light and dark, phone (390 px) and desktop (1280 px), no
sideways scroll and no console errors (Chromium through Playwright), no axe-core violations, 60 visible words with the
build's title, 30 KB. All quality-speed tests pass and the type check is clean.

## Baseline

Taken before any fix, reading `main` at `c37b9168fc83441187c64ce7ec3c549e6a9fad3a` as it stood on 2026-11-02 at
04:38:11 UTC, with the revised definitions: `node quality-speed/pages/insights/collect.ts --now 2026-11-02T04:38:11Z`
(79 API calls; drill passed). The first draft's run at that moment read the same history. Scored by the plan's rule: a
straight line between floor and goal, and 0 below the sample minimum.

| Metric | Value | Samples | Score |
|---|---|---|---|
| `change_failure_rate` | missing: no change is 7 days old yet | 0 | 0 |
| `rework_rate` | 17.14 % (`#50`, `#52`, `#55`, `#57`, `#63`, `#64`) | 35 | 65.3 |
| `merges_tied_to_issue` | 3.13 % (only `#43` closes an issue) | 32 | 0 |
| `failure_drill` | pass | 1 | 100 |
| `change_frequency` | 7 a week, from 1 completed day | 1 day | 0 (needs 7 days) |
| `lead_time_p50` | 0.272 h | 35 | 100 |
| `recovery_time_p50` | 0.12 h (`#41`, `#42`, `#50`, `#59`, `#60`) | 5 | 100 |

Quality 28.8, Speed 60.0, Consumption 0 (no lane reading yet). The first review recomputed rework, lead time and recovery time from the API and
matched them.

**Latest reading**, 2026-11-02 07:40 UTC, live, by hand (so the records are `missing` until the workflow runs it): rework
16.95 % of 59 (new since the baseline: `#181` follows up on `#68`'s review; `#182`, `#183` and `#271` close issues labelled
`bug`), tied 7.14 % of 56, lead time 0.454 h, recovery 0.144 h over 6, change frequency 7 a week from 1 day, failure rate
still without matured changes; drill passed. This site's `#69`, `#76`, `#105`, `#164` and `#165` are left out. Total 38.

**Through the workflow's own steps**, 2026-11-02 08:28 UTC, run in a cloud session with a placeholder run id that was never
published (`core/collect.ts`, `core/merge.ts`, `core/build.ts`, `core/guard.ts`): 7 records kept and 0 dropped, the rows
reached the page, the guard passed, and the page scored **36** (Quality 24, Speed 60). The first run on `main` records the
real score.

## Fixes

Ranked by score gained. Time alone lifts two metrics, and nothing can hurry it.

| # | Fix | Metric | Gain on the total | Where |
|---|---|---|---|---|
| 1 | Time: the first changes mature on 2026-11-08, and 7 days are observed that day | `change_failure_rate`, `change_frequency` | About +8.5 and +13, if today's rates hold | Nothing to do |
| 2 | An `Issue: #n` line in the pull request template, and the pull-request skill says to fill it | `merges_tied_to_issue` | Up to +8 | Separate small pull request (`.github/pull_request_template.md`, `.claude/skills/pull-request/SKILL.md`) |
| 3 | A `Repairs:` line in the same template (`#n`, "a bug", or "none"), so rework is declared, not guessed from prose | `rework_rate`, `change_failure_rate` (accuracy, may lower the score) | 0 or less: makes the numbers true | Same pull request as fix 2 |
| 4 | Merge only once the independent review of the final head has finished, so its findings land before the merge, not in a follow-up (`#50`, `#55` and `#63` all say the review arrived after the merge) | `rework_rate`, `change_failure_rate` | Up to +7 | The merge flow: for the orchestrator and the Pull requests and Agents pages |

## Sign-off

| Round | Date | Reviewer | Result |
|---|---|---|---|
| 1 | 2026-11-02 | Independent subagent, given the code and sources only | Changes needed: 8, all made (open failures, mixed pull requests, 35-day CI coverage and missing on a failed drill, recall check, bug fixes as rework, cited lead-time goal, strict issue ties, overlap stated) |
| 2 | 2026-11-02 | The same reviewer, replaying the baseline and running the detector over all merged pull requests (no false repairs) | Changes needed: 3, all made (recall over every reviewed repair at any age with a 35-day freshness date, the `bug` label fact, records in the contract's eight fields with a run link) |
| 3 | 2026-11-02 | The same reviewer, at `452728d` | **Signed off** (comment on #117). Open, not blocking: only review enforces the reviewed-list loosening rule; the lead-time goal should tighten once a month of trend supports it |
| 4 | 2026-11-02 | The same reviewer, after `CLAUDE.md` moved features onto the org's Project board | Changes needed: 1, made (a board card on the `Issue:` line ties a change only on the board `reviewed.json` pins as `backlog_board`, null until the board exists) |
| 5 | 2026-11-02 | The same reviewer, at `0929426` | **Signed off** (comment on #117, the manifest's `signoff_comment`) |
| 6 | 2026-11-02 | The same reviewer, against `quality-speed/BRIEF.md` and the board pin | The list passes the brief's three tests. Changes needed: 3, made (every site workflow left out, a site follow-up to site work left out, the board pin's source and limits stated) |
| 7 | 2026-11-02 | The same reviewer, at `06784bf` | **Signed off** the board pin and the brief check (comment on #117); the list's numbers are unchanged, so `signoff_comment` keeps the round-5 comment. Open, not blocking: `#181` joins `reviewed.json` at the next monthly refresh |
| 8 | 2026-11-04 | The orchestrator, on #440 at `3cbb1d7` | **Signed off** (comment on #440, the manifest's `signoff_comment`) |

## Final

Not reached. Filled in when the page reads 100 from live measurements.
