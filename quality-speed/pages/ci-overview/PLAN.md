# CI overview: plan

Slug `ci-overview`. Session `qs-ci-overview`. Lane: `daily`, `linux` (Blacksmith first, 10 minutes), in `lanes.json`; the drill-down goes to `$DETAIL_DIR/page/rows.json`. It reads job records with the job's own token and no
secret, so it can run on any runner the daily workflow picks.

## Sources

Read on 2026-11-02 unless marked.

| Fact | Value | Source |
|---|---|---|
| GitHub-hosted price a minute | Linux 2-core $0.006, `ubuntu-slim` 1-core $0.002, Windows $0.010, macOS (M1, `macos-26`, `xcode-27`) $0.062 | docs.github.com/en/billing/reference/actions-runner-pricing |
| Rounding | Each job rounds up to a whole minute | Same page |
| Included usage | A dollar pool: Enterprise Cloud $300 a month, "about 50,000 minutes" of Linux. No multipliers | docs.github.com/en/billing/concepts/product-billing/github-actions |
| What we work to | The whole $300; the $0 Stop-usage budget is the stop, no hold below it. "You are authorized to use all the action credits as needed" | The owner, 2026-11-06 |
| `ubuntu-slim` | 1 CPU, 5 GB, a container, 15-minute job cap; git, Python 3.12, Node 24, jq, gh | runner reference; runner-images `ubuntu-slim-Readme.md` |
| Blacksmith | 3,000 free x64 2-vCPU minutes a month per organization; Windows 2x; macOS 20x; then $0.004 a minute; alerts only, no hard stop; free colocated cache | docs.blacksmith.sh/blacksmith-runners/overview, blacksmith.sh/pricing |
| The guard | `.github/scripts/build_minutes_guard.py` moves CI off Blacksmith at 2,700 minutes in 31 days | This repo |
| Self-hosted charge | GitHub's $0.002 a minute for self-hosted runners was postponed, roadmap closed "Not planned" | github.blog changelog 2025-12-16; github/roadmap#1197 |
| Cloud sessions | Run on Anthropic's VMs, no Actions minutes; their pushes still trigger workflows | code.claude.com/docs/en/claude-code-on-the-web |
| Hugging Face Jobs | CPU Basic $0.01 an hour, billed by the minute; PRO's ~$2 credit. Spaces stay off CI by the owner's rule (#87 cites the content policy's abuse clause) | huggingface.co/docs/hub/jobs-pricing |
| REST limits | A personal token: 5,000 an hour, also on Enterprise Cloud. An Enterprise-owned app and `GITHUB_TOKEN`: 15,000. A `304` to a conditional request is free | docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api, best practices page |
| Draft runs | `pull_request` runs on drafts; `ready_for_review` runs only when listed | events-that-trigger-workflows |
| Required checks | `ci-ok`, `dco`, `claude-review`; up-to-date branches not required by the ruleset (the 0-behind rule is `CLAUDE.md`'s) | `GET /repos/.../rules/branches/main` |
| Gate standard | `REVIEW.md` rule 7 | This repo |

## Ideal state

`ideal.json`, from code-os's `quality/ideals/actions.json` cut to 25 words: every push gets a trustworthy result within ten minutes,
runs only the checks its change needs, once, cheaply, with every gate intact.

| `sources` | |
|---|---|
| Fowler's Continuous Integration | Dated 2024-01-18, its own date |
| DevOps Research and Assessment's capability page, GitHub's pricing page | Left out: their dates were the days read. Still in Sources above; the first is also a `goal_source` |

## Metrics

Window: the last 2 days. Runs are listed 1 more day back, and a merged head still without a CI run has its runs read by SHA. Merges: pull requests merged in
the window. Distinct from the Actions page (allowance, success on main, reruns, job and queue time, Mac share) and the Testing page
(suite time, cost per run), whose numbers this page shows but does not score again.

| Id | Lens | Unit | Dir | Floor | Goal | Weight | Why it matters | Source | Goal's reason |
|---|---|---|---|---|---|---|---|---|---|
| `gates_intact` | Q | count | higher | 7 | 8 | 1 | No optimization may loosen a gate, and a skipped job reads as passed | Rules API: `ci-ok`, `dco`, `claude-review` required, commit signatures required. Every merged head, latest attempt: `ci-ok` and `checks` passed with the secret scan step passing; `dco` passed (people); the `claude-review` job ran and passed. `ci.yml` runs `lint-workflows.sh` whenever `.github/` changes. No merge in the window reads missing | `REVIEW.md` rule 7: all eight, always |
| `ci_usd_per_merge` | Consumption, in a follow-up | usd | lower | 0.40 | 0.12 | 3 | What each merge costs | The drill-down's span: the newest 600 runs. Its `pull_request` runs' and `main` pushes' jobs, over its merges. Cancelled jobs that started count. Each is rounded up to a minute and priced by its label (below). The whole window needs every run's jobs, too many for the lane (2026-11-06) | Bottom-up ideal: two pushes, one review, one Mac run per Swift change (24 % of merges), at list prices |
| `pushes_per_merge` | Q | ratio | lower | 6 | 2 | 1 | Every push runs four workflows | Distinct head SHAs of CI `pull_request` runs, every pull request in the window, over merges. Missing if a merged head has no CI run | One push when green is expected, plus one rebase (`CLAUDE.md`: batch commits; the 0-behind rule) |
| `reviews_per_merge` | Q | ratio | lower | 4 | 1.2 | 1 | Each review is an orchestrator's read of the whole diff | Review verdicts posted in the window, every pull request, over merges. A verdict is a comment whose first line is exactly `Review: MERGE at <sha>` or `Review: BLOCK at <sha>` (the `merging` skill; code-os `github-reviews.mjs` `MARKER`). Its author is a person with access, never a bot. Missing if a merged pull request has no verdict. Since 2026-11-06; before, `claude-review` jobs, retired in #555 | One review on the final head, plus one Blocking fix in five merges |
| `repeat_runs_per_merge` | Q | ratio | lower | 1 | 0 | 1 | A run on an unchanged head checks nothing new | `pull_request` runs with at least one job on a runner, beyond the first per workflow and head SHA | Zero by definition |
| `final_push_to_merge_p50` | S | minutes | lower | 20 | 3 | 1 | Merges go one at a time, so this paces every merge, handoff included | Each merged pull request: its final head's first run created to `merged_at` | The slowest required check on a docs or web push ends in about 2.5 minutes (path chart), plus 30 seconds to merge |

`gates_intact` stopped being a gate on 2026-11-05 (#645): a miss is CI upkeep, not harm to a customer or money. It still scores.

`ci_usd_per_merge` is dollars spent, Consumption, so it leaves the list until the manifest holds that lens; `compute.ts` still
measures it and `changes.json` keeps its effects for then. Each listed metric's `goal_source`: GitHub's rulesets (every gate),
DevOps Research and Assessment's continuous integration capability (small batches: pushes and reviews per merge), GitHub's workflow events (no rerun on an
unchanged head) and Fowler's Continuous Integration (final push to merge). Pushes, reviews and the 3-minute merge are this repo's
own derivations on those sources, as the Goal's reason column says.

Prices a minute, by label: `ubuntu-slim` $0.002; `ubuntu-latest`, `ubuntu-NN.NN` $0.006; `windows-latest`, `windows-NNNN` $0.010;
`macos-latest`, `macos-NN`, `xcode-NN` $0.062; `blacksmith-Nvcpu-ubuntu-NNNN` $0.006 x N / 2. Any other label: missing.

Minimum samples: 10 merges for each per-merge metric and the speed metric, 1 for the gates. Age limit 48 hours. Any failed read (after
three tries on a 5xx, a 429 or a 403 that says when to retry), more than 4,000 job reads, or an unknown label makes every metric `missing`.

Shown, not scored: force pushes per merge (the 0-behind rule's rebases, with self-squashes), because each is already a push and a review
above. API calls: the sessions' shared login can't be read from CI, so the page shows the dated samples only.

Reads: runs are listed by event (`pull_request`, `push`, `workflow_dispatch`), so skipped comment runs are never read. A filtered
listing stops at 1,000 runs, and paging it lost 393 of 1,730 runs in a live read on 2026-11-02, hidden by duplicates. So a listing
is never paged: a time range holding more than 100 runs is halved until each half fits one page, and a page must hold exactly the
runs it counts, or every metric reads missing (about 70 calls for 1,700 runs). Jobs are read only where a reading needs them
(`jobReads`): CI and DCO on merged heads (the gates), runs sharing a workflow and head (the repeats), and the newest 600 runs in the
window (the drill-down, which covers only those; the page scales it to a day). Then one timeline per merged pull request, and the
comment pages from the lookback's start, keeping only verdicts. Ten reads at a time, under GitHub's secondary limit of 900 a minute.

| Date | Reads | Lane |
|---|---|---|
| 2026-11-06 07:28 UTC | Every run's jobs, 8 at a time: about 2,700 runs, inferred as twice the 1,333 listed for the day to 16:26 UTC. 255 timelines one at a time | Collector 8.5 minutes; `pushes_per_merge` and `reviews_per_merge` missing |
| 2026-11-06 15:46 UTC | The same, 9 hours busier | Cancelled at the 10-minute cap; every metric missing |
| From this change | About 1,500 (an estimate from those counts and 255 merges in two days) | Read on the next scoring run |

Why the two metrics were missing even when the lane finished: four merged heads (2026-11-04 to 06) had their CI run on 2 and 3 November,
before the lookback, so `pushes_per_merge` saw a merged head without CI; and `claude-review`, retired in #555, never runs, so no merged
head had a review. Verdict comments cover every merge since 2026-11-05 22:00 UTC (a read of the API on 2026-11-06).

Earlier sign-off, of the six-metric list on #189 only (this five-metric list needs its own on its own pull request): approved on 2026-11-02, comment 6570635324 (#189), after three passes; the changes above are its required ones (gate evidence on merged heads,
distinct SHAs, all pull requests in the numerators, rebases unscored, repeats only for runs that got a runner, cost scope and prices,
final push to merge, a read cap), and from its second pass: a 2-day window so reads fit the cap, a rerun's latest attempt, no merges
reading missing; and its suggestions to count cancelled reviews and the lint step's condition. Third pass: the run listing in
slices, checked against each slice's count; since tightened to never page a listing, after a live read showed paging loses runs.

## Chart per metric

| Metric | Chart |
|---|---|
| `gates_intact` | `dotMatrix`, eight gates, pass or fail |
| `ci_usd_per_merge` | `metricBullet`, with baseline |
| `pushes_per_merge`, `reviews_per_merge`, `repeat_runs_per_merge` | `bullets` under "Per merge", with rebases as a tile beside them |
| `final_push_to_merge_p50` | `metricTile` |
| Infographic: one push, three paths | Docs, web and Swift tabs (CSS only), a Gantt of each job's measured start and end from the push, one lane per runner, cost a push |
| Runners and third parties | `dataTable`s: job, runner, p50, billed minutes and dollars in the window; each provider's price, free pool and stop |
| Pools and API | `meter`s: Blacksmith minutes and GitHub dollars a day against a day's share; API tiles, two dated `rate_limit` samples, unscored |
| Changes | `roadTo100` toggles, and a ranked `dataTable` with each change's measured saving a day |

## Baseline

Job records for every workflow run in the repository, 2026-11-01 19:02 to 2026-11-02 04:55 UTC (9.9 hours, 947 runs, 567 job reads, 38
merges, 59 pull requests). Read once into a local dump; `compute.ts` turns it into the numbers below.

| Metric | Baseline | Score |
|---|---|---|
| `gates_intact` | 7 of 8: four merges on 2026-11-01 have a failed `claude-review` on their final head. From the ruleset's history (orchestrator, #189): #2, #4 and #5 merged at 19:18, before the check became required at 19:24; #34 (`REVIEW.md`) merged at 20:04 through the admin route `claude-review.yml` names for that file. The metric stays as signed off | 0 |
| `ci_usd_per_merge` | $0.232 | 60 |
| `pushes_per_merge` | 3.21 | 70 |
| `reviews_per_merge` | 2.74 | 45 |
| `repeat_runs_per_merge` | 0.79 | 21 |
| `final_push_to_merge_p50` | 4.0 minutes (38 merges) | 94 |
| Rebases per merge, unscored | 0.92 | |

The 9.9-hour dump has 38 merges, past the 10-merge minimum, though not 7 days. `baseline/` holds the records `collect.ts` wrote from it.

Where the money went in that window, GitHub-hosted at list price: $7.38, plus 343 Blacksmith minutes. macOS $4.65 (CI's three Mac jobs
$3.09, by-hand and probe runs the rest); `claude-review` $0.83; Labeler $0.82, DCO $0.80, `choose-runner` $0.79, each about 6 to 11
seconds billed as a whole minute. Blacksmith: 343 minutes in 9.9 hours, against 87 a day that keep it free all month.

API: the cloud sessions' shared app login used about 6,000 calls in the hour to 05:04 UTC (40 % of its 15,000) by two `rate_limit`
reads, which are free. The local login's limit is 5,000, and it hit 0 at 04:48 UTC.

### Live read, 2026-11-02 07:40 UTC

`collect.ts` against the API from this session's VM, after #82 and #160 merged: 66 merges, 12.6 hours of history, about 2,500 calls.
Not from a CI run, so not a scoring record; the daily lane's first run will be.

| Metric | Live | Score |
|---|---|---|
| `gates_intact` | 7 of 8 (the same four merges) | 0 |
| `ci_usd_per_merge` | $0.352 | 17 |
| `pushes_per_merge` | 7.18: 474 head SHAs over 66 merges, most on open drafts | 0 |
| `reviews_per_merge` | 3.42 | 21 |
| `repeat_runs_per_merge` | 0.58 | 42 |
| `final_push_to_merge_p50` | 4.2 minutes | 93 |
| Total | | **41** (Q 16, S 92); without cost, Q 16 and the cap still hold |

In those 12.6 hours: $23.47 GitHub-hosted and 1,180 Blacksmith minutes, of which `ci-ok` was 450 and `checks` 729. `office-mac` ran 34
times at 7 seconds, each billed a whole Mac minute ($2.11). The fixture room's by-hand runs cost $2.67.

**Fixes ranked by score gained, on the live read and the earlier six-metric list** (cost per merge, #6, moves no score until it
returns as Consumption):

| # | Fix | Total gained | Where |
|---|---|---|---|
| 1 | The four 2026-11-01 merges leave the window (2026-11-03) | +9.5, and the cap lifts | Time |
| 2 | Fewer pushes per merge: batch commits, push when green is expected, hold draft pushes | up to +9.5 | Sessions; the skill (#160) |
| 3 | One review per merge: rebase, then ready | up to +7.6 | Sessions; the skill (#160) |
| 4 | DCO and Labeler skip `ready_for_review` | +5.6 | #187 |
| 5 | `ci-ok` on the 1-core runner | +1.7 (+2.8 on the live job totals) | #187 |
| 6 | Cost to goal: next candidate is `office-mac`, a 7-second test billed a Mac minute 34 times; fold it into `swift-ocr` when both run | up to +23.7 for all of cost | Next pull request, after the co-occurrence is measured |

## Fixes

Replayed on the baseline window's job records: each change applied to the jobs it touches, re-rounded and re-priced. A day is the window
times 24 / 9.9. Simplest and biggest first.

| # | Change | Saving a day, list price | State |
|---|---|---|---|
| 1 | DCO, Labeler and `choose-runner` on `ubuntu-slim` | $3.90 | Merged in #82 (another session) |
| 2 | `ci-ok` on `ubuntu-slim`, off Blacksmith: GitHub +$0.36, Blacksmith -315 minutes | $1.53 | #187 |
| 3 | DCO and Labeler stop rerunning on `ready_for_review`, an unchanged head | $0.12, and repeats to 0.08 | #187 |
| 4 | Pull request skill: check once, `gh api --cache`, no watch loops; rebase just before ready | API calls; reviews per merge | Merged in #160 |
| 5 | Rebase before marking ready, so one review per merge | ~$0.58 | In the skill (#160); the orchestrator's slot practice |
| Cost | The 0-behind rule: about one rebase per merge, each rerunning CI, DCO, Labeler and often the review | ~$3.40 | Recorded, not a fix: the rule stays (`CLAUDE.md`); the merge queue's combined pull requests are what cut it |
| No | Mac jobs skip drafts: $1.21 gross, less the rerun on ready | ~$0.68 | A green `ci-ok` could stand on a head Mac never checked; Swift drafts lose their only Mac signal |
| No | `office-mac` folded into `swift-ocr` | $0.29 | 2 runs in the sample; recheck at 7 days |
| No | npm cache | ~$0.16 | Install is 6 s on Blacksmith; a cache adds a poisoning surface |
| No | Skip web checks on Markdown-only changes | ~$0.11 | 2 of 59 pull requests; web tests read Markdown |
| No | Cancel superseded runs | $0 | Already on CI, review and Labeler; DCO costs $0.002 a run after #1 |
| No | Move secret-free lanes (Law pack) to Blacksmith | $0 net | Blacksmith is the scarcest pool: at this pace its 3,000 last about 3 days |

## Final

Filled in after the fixes merge and a 2-day live window from the daily lane.
