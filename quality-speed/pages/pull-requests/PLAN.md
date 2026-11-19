# Pull requests: plan

Converted to Git Crafter's model (2026-11-04) from Git Crafter's `pull-requests` ideal and targets. It takes over draft pull request 169, whose session has stopped, and keeps its nine metrics, collector, rework check and page. Road to 100 passes no cap: since 2026-11-05 no metric here is a gate (#645).

Lane: `lanes.json`, one `linux` lane with `daily` cadence, so it runs on the schedule and on every merge. The collector is `src/collect.ts`, run by `core/collect.ts` with the job's read-only token and no secrets. The facts it keeps for its next run go to `$DETAIL_DIR/facts/` and come back as `$PREV_DIR`; they are never published. The checkout has `main`'s full history, which rework's `git blame` needs.

## Rescope, 2026-11-09: GitHub's Pull requests tab

The owner's decision (Project card "Pull requests page: pull requests, review, merge queue, stacks"). Wins over the sections below where they disagree.

| Section | Metrics | From |
|---|---|---|
| Pull requests | `required_gates_on_merged_head`, `ci_green_first_time`, `no_rework_7d`, `small_changes`, `template_complete`, `open_to_merge_p50/p90`, `lane_minutes` | Kept |
| | `pushes_per_merge`, `final_push_to_merge_p50` | CI overview, same goals |
| Review | `no_blocking_findings`, `review_result_p90` | Kept |
| | `review_rounds`: verdicts per merge, last 7 days, goal 1.2, floor 3 | CI overview's `reviews_per_merge`; three rounds then rethink ([Claude Code team, 2026-10-15](https://claude.dev/blog/solving-code-review-at-anthropic)) |
| | `review_tokens_p50`: each verdict's line 2, `Tokens: n`, last 7 days, goal 50K, floor 200K | New. No public token figure: goal set here, the orchestrator's call at sign-off |
| Merge queue | `queue_*` | Kept |
| Stacks | `big_changes_stacked`: stack layers over (layers + lone merges over 400 lines); none of either reads `no_events`, proven by `small_changes` | New |

| Fact (v8) | Read from |
|---|---|
| `ci_heads` | Distinct heads of the branch's CI runs |
| `final_push_minutes` | First run on the merged head to the merge |
| `verdicts`, `review_tokens` | Issue comments: first line `Review: MERGE at <sha>` (or BLOCK), line 2 `Tokens: n` |
| `stacked` | A `base_ref_changed` event, or another pull request targets the branch |

## Gates, 2026-11-19 (#87)

`claude-review` was retired on 2026-11-05, and the ruleset's status checks aren't strict (merge queue). Facts v9:

| Fact | Read from |
|---|---|
| `gate_misses` | A `Review: MERGE at <merged head>` verdict and no `BLOCK` there; `ci.yml` and `dco.yml` green on the head. No behind-main check |
| `ci_green_first_time` | The head of the first CI run at or after "ready"; with none, unmeasured, never a miss |
| `review_result_minutes` | Facts v10 (#91): the first run on a verdict's head to the verdict comment |
| `review_tokens_p50` | Retired (#91): a private measurement here, so it could never read; verdicts carry no `Tokens:` line |
| `drew_blocking` | A `Review: BLOCK` verdict too. A verdict naming a commit GitHub can't find is skipped in the same-change check |

## Sources

Primary sources, read on 2026-11-02, unless marked secondary.

| Source | What it gives this page |
|---|---|
| GitHub Docs, [About status checks](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/about-status-checks) | "A job that is skipped will report its status as "Success". It will not prevent a pull request from merging, even if it is a required check." `claude-review` skips drafts and most bot pull requests, so its check conclusion alone never proves a review ran: the collector reads the job's steps in every attempt. |
| DevOps Research and Assessment, *Accelerate State of DevOps Report 2024*, page 13 (on the program's own site) | Elite: change fail rate 5%. High: 20% (the 2024 clusters put High's fail rate above Medium's 10%; 20% is used only as a floor). |
| DevOps Research and Assessment, *software delivery metrics* guide (on the program's own site) | Deployment rework rate: "deployments that are unplanned but happen as a result of an incident in production". DevOps Research and Assessment publishes no rework threshold, and says it added the metric because change fail rate acted as a proxy for rework, so the fail rate tiers stand in. |
| GitClear, *Coding on Copilot* (2024), secondary summaries only | Code churn: lines changed or reverted within two weeks of being written, whoever changes them and whether or not they say so. The basis for counting a rewrite as rework without needing the later pull request to name the earlier one. This page uses 7 days, the plan's seed, and finds the lines by position with `git blame`. |
| GitHub REST: [repository activities](https://docs.github.com/en/rest/repos/repos#list-repository-activities), [workflow runs](https://docs.github.com/en/rest/actions/workflow-runs) | Pushes and force pushes to a branch with server timestamps (a commit's own date can be set to anything); a merged pull request is `pr_merge`. Run numbers count up per workflow, so a missing number is a deleted run. |
| Sadowski et al., [Modern Code Review: A Case Study at Google](https://research.google/pubs/modern-code-review-a-case-study-at-google/) (ICSE SEIP 2018, DOI 10.1145/3183519.3183525), secondary summaries of the paper's figures | Median wait for first feedback under an hour for small changes; median for the whole review under 4 hours. |
| Google, [Small CLs](https://google.github.io/eng-practices/review/developer/small-cls.html) | "100 lines is usually a reasonable size for a CL, and 1000 lines is usually too large." |
| Google, [Speed of Code Reviews](https://google.github.io/eng-practices/review/reviewer/speed.html) | "One business day is the maximum time it should take to respond to a code review request." |
| SmartBear and Cisco code review study (Cohen, *Best Kept Secrets of Peer Code Review*, 2006), secondary summaries | Reviewers are most effective on at most 200 to 400 lines at a time; defect discovery falls above that. Agrees with Google's guidance above. |
| CircleCI, [2024 State of Software Delivery](https://circleci.com/resources/2024-state-of-software-delivery/), page 12 | Benchmarks: success rate "90% on the main branch", average workflow "10 minutes"; feature branches average 70.1%, "expected given higher levels of experimentation". |
| This repo: `CLAUDE.md`, `REVIEW.md`, `.github/workflows/claude-review.yml`, `.github/pull_request_template.md`, `.claude/skills/pull-request/SKILL.md` | The required checks (`ci-ok`, `dco`, `claude-review`); the merge rule (head unchanged since review, 0 commits behind `main`, CI green); "A Blocking finding is never overridden"; "push when you expect green"; the template; the review job's 30-minute timeout. |

## Ideal state

`ideal.json`, Git Crafter's pull-requests ideal cut to 25 words: every change lands in a small pull request that passes its checks and review at its head, merges within a day, and is rarely reworked. Its five sources were read 2026-11-04 (GitHub Docs from their source in `github/docs`; none shows a date, so each is dated the day read): About protected branches, Best practices for Projects, Creating a pull request template, Claude Code best practices and Claude Code GitHub Actions.

| Metric | `goal_source` |
|---|---|
| `required_gates_on_merged_head` | GitHub Docs: About protected branches |
| `ci_green_first_time`, `review_result_p90` | CircleCI 2024 State of Software Delivery |
| `no_blocking_findings` | Claude Code: GitHub Actions (the review it scores). The 95 % is the draft's stated reason: every Blocking rule is written in `REVIEW.md` before work starts |
| `no_rework_7d` | Accelerate State of DevOps Report 2024 |
| `small_changes` | Google: Small CLs |
| `template_complete` | GitHub Docs: Creating a pull request template |
| `open_to_merge_p50`, `open_to_merge_p90` | Sadowski et al., Modern Code Review at Google |
| `queue_ejections_pct`, `queue_wait_p50`, `queue_wait_p90`, `queue_minutes_per_merge`, `queue_prs_per_group_p50` | GitHub Docs: [Managing a merge queue](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue), for what is measured. It gives no minute or percent figures, so each floor and goal below has a stated reason |
| `api_calls` (Consumption, follow-up) | REST calls one daily read makes, once `consumption` is a lens |

CircleCI, Google, the Google paper and the State of DevOps report were read by draft 169 on 2026-11-02; this session can't reach those hosts, so their quotes below are the draft's.

## Metrics

**Window:** pull requests merged or closed in the last 28 days (four whole weeks, so weekdays weigh the same). Rework uses merges 7 to 35 days old, so each one's 7 days are over. **Samples:** at least 20 per metric, or it scores 0: with fewer, one pull request moves a rate by more than 5 points and a p90 is just the slowest one. **Age:** a reading older than 48 hours scores 0 (`max_age_hours`, enforced by core's scorer, `core/score.ts`). These and the 400-line size limit are constants in `src/metrics.ts` and `src/facts.ts`; changing them goes through the same review as the manifest.

**Who counts,** decided here and never at run time:
- Pull requests into another branch are left out everywhere: they did not change `main`.
- This site's own work is never counted (`quality-speed/BRIEF.md`):
  - A pull request whose every changed file is under `quality-speed/` or is a site workflow, `.github/workflows/quality-speed*.yml`, is left out of every metric, the gate included.
  - In a pull request that mixes site files with others, the site files' lines count neither toward size nor as rework. The pull request itself still counts, so adding one site file hides nothing.
- The gate counts every other merge into `main`. Every push or force push to `main` that was not a pull request merge, and every deleted CI, DCO or review run, is a miss.
- Pull requests closed without merging count in CI green first time and No Blocking once they were ready for review, so closing and reopening cannot hide a red run or a finding. Their open time, and the age of open pull requests that were ever ready, are lower bounds in the time percentiles.
- Bot pull requests (Dependabot) count everywhere except the template, which a bot cannot fill in.
- No metric is per person: one GitHub login does all the work.

| Id | Lens | What and why | Source (REST, read-only) | Floor | Goal | Weight | Chart |
|---|---|---|---|---|---|---|---|
| `required_gates_on_merged_head` | Quality | Share of merges whose merged head passed every required gate: a `claude-review` job that really ran with `Review` and `Verdict` both `success`; no Blocking verdict in any attempt on that head, nor on an earlier head carrying the same change (an empty commit or main merged in cannot rerun one away); `claude-review.yml` not changed by the pull request (such a change can replace the reviewer); the newest CI and DCO runs green (DCO skipped only for bots); and the head 0 commits behind `main` at merge. Pushes to `main` without a pull request and deleted CI, DCO or review runs (missing run numbers) count as misses. A miss is a required gate bypassed. It stopped capping the page at 59 on 2026-11-05 (#645): CI upkeep, not harm to a customer or money | runs by branch and time, `jobs?filter=all`, `compare/main...{head}` (file states and blob ids), `commits/{merge}`, `compare/{parent}...{head}`, `activity?ref=refs/heads/main`, `actions/workflows/{ci,dco,claude-review}.yml/runs` | 90% | 100%: `CLAUDE.md`'s merge rule and "A Blocking finding is never overridden" | 3 | Bullet; The gate, one glyph per merge |
| `ci_green_first_time` | Quality | Share of submitted pull requests whose head at "ready for review" passed CI and DCO on the first attempt. A rerun, a cancel (pushed again before it finished) or a failure is not first time | timeline (ready time), runs, `attempts/1` | 70%: CircleCI's feature-branch average | 90%: CircleCI's main-branch benchmark. A pull request marked ready claims to be mergeable as is, so it is held to the main-branch standard; `CLAUDE.md` asks for the same ("push when you expect green") | 2 | Bullet |
| `no_blocking_findings` | Quality | Share of submitted pull requests that never drew a Blocking finding in any review round: a Blocking verdict (Review `success`, Verdict `failure`) in any run or attempt, which also catches findings left only in the summary, or a bot's inline `Blocking:` comment | jobs, `pulls/{n}/comments` | 80%: one in five breaking a written rule | 95%: at most one in twenty. Stated reason: every Blocking rule is written in `REVIEW.md` before the work starts, so a ready pull request should rarely break one | 2 | Bullet |
| `no_rework_7d` | Quality | Share of merges not reverted and not rewritten within 7 days: a later merge into `main` deleted or changed a non-blank line it wrote, whether or not it says so, found by position (`git blame` at the later merge's parent, over the lines its squash commit deletes or changes, with moves detected so a moved file counts only its changed lines; lock and generated files left out), or a commit says "This reverts commit" its merge commit. Adding next to its lines is building on it, not rework | a clone with `main`'s history, `pulls/{n}/commits` | 80%: DevOps Research and Assessment High fail rate 20% | 95%. Stated reason: DevOps Research and Assessment publishes no rework threshold; its Elite fail rate, 5%, is the nearest published bar, and since this counts every rewrite, not only failures, it is stricter than the source | 3 | Bullet |
| `small_changes` | Quality | Share of merges changing at most 400 lines (added plus deleted), lock, `linguist-generated` and this site's own files left out | `pulls/{n}/files`, `.gitattributes` at the base commit | 50%: half of all changes above the size reviewers handle well | 90%: SmartBear and Cisco's 400-line limit and Google's guidance; one in ten left for changes that cannot be split | 2 | Bullet |
| `template_complete` | Quality | Share of merges by people or sessions whose body, as written against the template at its base commit, has every section (a `## ` heading, or a table row's first cell) with text in it (HTML comments do not count), at least as many checklist lines, and every "No ..." line ticked. An edit after the passing review on the merged head started fails it, since editing a body does not start a new review. A body that could not be checked for edits (outside Actions) never counts as complete | `pulls`, template at the base commit, GraphQL `lastEditedAt` (Actions only) | 50% | 100%: the `pull-request` skill requires the template | 1 | Bullet |
| `open_to_merge_p50` | Speed | Median minutes from opening to merge. The larger of the median over merges and the median over merges plus the lower bounds above, so a bound can only raise it; with no merges it is missing, and samples count merges only | `pulls` | 1440 (one day). Stated reason: Google's maximum to respond to a review is one business day; a change waiting longer for its merge has missed it | 60: Google's median first feedback on small changes, under an hour | 2 | Bullet |
| `open_to_merge_p90` | Speed | 90th percentile, the same way | `pulls` | 10080 (one week). Stated reason: one in ten taking more than a week is a stalled queue | 240. Stated reason: the slowest tenth held to Google's median for a whole review, under 4 hours, which is stricter than the source | 1 | Bullet |
| `review_result_p90` | Speed | 90th percentile of minutes from the event that started a review run to its verdict. A run with no verdict (crash, timeout, cancel with no newer run) counts as 30; a run cancelled because a newer one started is left out | runs, jobs | 30: the job's `timeout-minutes`, where GitHub cancels it | 10. Stated reason: the slowest tenth held to CircleCI's average workflow, 10 minutes, which is stricter than the source | 1 | Bullet |
| `queue_ejections_pct` | Quality | Share of pull requests ever added to the merge queue, merged or closed in the window, removed from it without merging at least once. GitHub logs a removal with each merge in the same second, often listed after `merged`, so the last queue event, a removal within a minute of the merge, is the merge. Queue events after the merge (a merged pull request queued again) don't count | timeline: `added_to_merge_queue`, `removed_from_merge_queue`; `merged_at` | 20%. Stated reason: one in five, this page's rework floor | 5%. Stated reason: each ejection costs a rebase, a new review and a rerun of the groups behind it; one in twenty, this page's bar for Blocking findings and rework. 2026-11-05: 1 of the 40 latest merges | 1 | Bullet |
| `queue_wait_p50` | Speed | Median minutes in the merge queue over merges through it: each add to the removal that ends it, or to the merge, summed, so time out of the queue after an ejection doesn't count | timeline, as above | 20. Stated reason: about three of the slowest runs ahead of it | 5. Stated reason: its own group's CI run with no group ahead, even a slow one (30 merge-group CI runs on 2026-11-05: 1.3 to 6.2 minutes, median 1.6; 3 to 9 job minutes, median 4) | 1 | Bullet |
| `queue_wait_p90` | Speed | 90th percentile, the same way | timeline | 40. Stated reason: about six of the slowest runs ahead, a stalled queue | 10. Stated reason: one group ahead, twice the median's goal | 1 | Bullet |
| `queue_prs_per_group_p50` | Speed | Median merged pull requests per queue merge, 14 days. A group is the queued merges sharing one merge second: main moves once per group. Speed, not consumption: each entry still gets its own `merge_group` run | `pulls`, timeline queue events | 1. Stated reason: one by one, no grouping | 3. Stated reason: the queue merges up to 10 per group (`HEADGREEN`, 2026-11-05); 3 means half the merges land with 2 others or more | 1 | None |
| `queue_minutes_per_merge` | Consumption | Job minutes of completed `merge_group` runs created in the window (every attempt, each job rounded up as GitHub bills it, skipped jobs 0) over merges through the queue. Runs for pull requests this page leaves out are left out; no run read is missing, never 0 | `actions/runs?event=merge_group`, one query a day (a query lists at most 1,000 runs; a fuller day fails the read); `jobs?filter=all`; read runs kept in the lane's facts | 15. Stated reason: three passes per merge, as when ejections rerun the groups behind | 5. Stated reason: one pass, no rerun (30 merge-group CI runs on 2026-11-05: 1.3 to 6.2 minutes, median 1.6; 3 to 9 job minutes, median 4) | 1 | None |

**Infographic:** "The gate", one check glyph per merge in the window, solid where every required gate held on the merged head and an empty red outline where one didn't. Past 100 merges it switches to one glyph per percent, so the first view stays small. It is built from the reading and its sample size, because the site build hands a page its readings, never per pull request facts.

**Road to 100:** the kit's waterfall, one bar per fix below. Each fix adds its metric's weight share of the Quality ring, times the points core's scorer says that metric has left, so the bars update with every run.

**Also on the page:** the build's score ring, then one bullet per metric against its floor and goal, each linking to the run that measured it. Trend lines come once the daily history exists.

**Checked** on 2026-11-02, with the baseline readings in a site build (`core/build.ts`, inside its permission fence):
- the publish guard passes, and so does the synthetic build;
- the first view is 26 KB, within the 80-word budget;
- no sideways scroll at 390 or 1280 pixels, in light or dark;
- no console errors;
- axe-core 4.10.2 finds no violations in light or dark.

| Read budget | |
|---|---|
| Job token | 1,000 REST calls an hour per repository, 15,000 on Enterprise Cloud (GitHub Docs, rate limits for `GITHUB_TOKEN`), plus secondary limits |
| Cold read, 2026-11-05 | 279 merged pull requests and 455 `merge_group` runs: past the budget, a 403 on run 42123417981 |
| Rate-limited | Keeps the facts read, exits 0 so core carries them, every metric still missing; the next run reads only the rest |

A reading counts as `ok` only with a CI run link (the shared format), so a local run like the baseline's reads as missing on the site. Only the lane's runs can score.

### Independent review

First review (2026-11-02): no sign-off, 10 required changes. Taken: 1 (only all-site pull requests are excluded, never from the gate), 2a to 2e (every review attempt, the review workflow unchanged, CI and DCO on the head, 0 behind, direct pushes), 3 (Blocking verdicts as well as comments; DevOps Research and Assessment citation dropped), 4 (closed-unmerged and open pull requests), 6 (rework counts any rewrite, named or not; lock and generated files left out), 7 (crashes and timeouts count as 30), 8a and 8c (template at the base commit; "No ..." lines ticked), 9 (floors and goals re-cited as stated reasons where the source measures something else), 10 (age enforced). Optional: directory globs in `.gitattributes` handled; the program's High and Medium order noted.

Answered, not taken:
- **5, measure first-time at the first CI run, draft or not.** Drafts are this repo's sanctioned work-in-progress state: `claude-review` skips them by design, the rollout keeps page pull requests as drafts until their slot, and sessions are told to push often so work survives. Counting draft runs would score work in progress, not the change as submitted. CI minutes spent on drafts are the Actions page's to measure (spend per job).
- **8b, the body as it was at merge.** Taken in the second round: see below.
- **Optional, a view weighted by lines; deletions counted in size.** Left for the page's drill-down, not the score.

Second review (2026-11-02): no sign-off; items 1, 2a to 2e, 3, 7, 8a, 8c, 9, 10 and the answer to 5 accepted. Seven more, all taken:
1. Lower bounds can only raise a percentile (the larger of merges alone and merges plus bounds).
2. A Blocking verdict on an earlier head with the same change as the merged head (same files, states and blob ids against `main`) is a gate miss.
3. Deleted review runs, found as missing run numbers, are gate misses.
4. Direct pushes come from the activity API's server timestamps; force pushes count.
5. Rework is found by position with `git blame`, not by matching line text.
6. The template's edit check compares with the start of the passing review on the merged head; an unchecked body never counts as complete, and unchecked facts are read again in Actions.
7. `lanes.json` names `metrics.json`, runs daily and on every push to `main`, and checks out full history for blame.

Suggestions taken: a stated reason for the rework goal. Left to core and the chart kit: showing "too few samples" instead of a value below `min_samples`.

Third review (2026-11-02): no sign-off; second-round items 1, 2, 4 and 6 accepted as written. Four more, all taken:
1. The rework diff parser reads `--- ` as a file header only before a file's first hunk, so a deleted SQL comment (`-- ...`) no longer breaks the run.
2. Moves are detected (`git diff -M`): a pure rename is not rework, edits after it are.
3. Deleted runs are found for `ci.yml` and `dco.yml` as well as `claude-review.yml`. Checked on 2026-11-02: run numbers 1 to 219, 1 to 194 and 1 to 194 have no gaps, so GitHub leaves none of its own here.
4. A lower bound never stands in for a merge: no merges means missing, and samples count merges only.

Suggestion taken: a merge newer than the clone (merged within 15 minutes, after the checkout) is left for the next run instead of failing it; any older missing merge commit is an error.

Fourth review (2026-11-02, commit c7f1aab): **signed off**, no required changes. Both suggestions taken: a `--- ` path with a trailing tab (a space in the name) or C quotes is read correctly; and a merge git cannot read fails closed on its own (every earlier merge in its 7-day window counts as reworked, flagged `rework_unknown`) instead of taking every metric down. The sign-off was posted on draft 169 as comment 6570142349, which was then its manifest's `signoff_comment`.

Fresh review against `quality-speed/BRIEF.md` (2026-11-02, a different reviewer): not signed off, 2 required changes, both taken:
1. This site's own work is never counted on this page, the gate included, as BRIEF's Never list says. Site-only merges leave the gate, and site files leave size and rework in mixed pull requests.
2. The research program's four-letter acronym is written out in full, because its letters are the banned acronym of the Colorado regulatory department. The source links on that program's site went with it.

Optional, taken: the unused `files_changed` fact is gone. Optional, not taken: tightening the speed goals. They come from outside benchmarks, and faster merges would trade against the quality metrics this page exists for.

Re-check (commit a6cc82c): **signed off**, no required changes. Its suggestion is taken: open pull requests use the same `isSite()` test. The verdict was posted on draft 169 as comment 6571562440, which was then its manifest's `signoff_comment`.

Converted 2026-11-04: those reviews were of draft 169. The list moved to #439 with a `goal_source` on each metric and was signed off there at `3217bed` in comment 6643840239, now `manifest.json`'s `signoff_comment`.

## Baseline

Taken before any fix, on the signed-off list, by `src/collect.ts` through `gh api` and a full clone, measured at 2026-11-02 05:16 UTC. 44 pull requests closed in the window (40 merged into `main` and counted, 1 merged into a release branch, 3 closed unmerged), 39 open, no direct pushes, no deleted runs. Local run, so the template's edit check (GraphQL, Actions only) could not run.

| Metric | Value | n | Score |
|---|---|---|---|
| `required_gates_on_merged_head` | 47.5%. Misses: 20 merged behind `main` (#2, #4, #10, #11, #13, #34, #35, #38, #41, #44, #47, #49, #50, #52, #55, #57, #61 to #64); review not run on the head for #2, #4, #5, #34; a Blocking verdict on the head for #34 | 40 | Bullet; column "Gates" in The gate, one cell per merge |
| `ci_green_first_time` | 79.1% (misses: #3, #6, #9, #36, #40, #43, #54, #78, #87) | 43 | Bullet; column "Green" in The gate |
| `no_blocking_findings` | 88.4% (#8, #11, #34, #35, #47) | 43 | Bullet; column "Clean" in The gate |
| `no_rework_7d` | missing: no merge is 7 days old yet | 0 | Bullet; column "Kept" in The gate (blank until a merge is 7 days old) |
| `small_changes` | 52.5% (median 358 lines; 19 over 400, 14 over 1000) | 40 | Bullet; column "Small" in The gate; lines per merge in the table |
| `template_complete` | 0%: no body could be checked for edits outside Actions. The body alone is complete for 23 of 37 (62%) | 37 | Bullet |
| `open_to_merge_p50` | 13.7 minutes | 40 | Bullet; minutes per merge in the table |
| `open_to_merge_p90` | 45.8 minutes | 40 | Bullet |
| `review_result_p90` | 2.3 minutes | 86 runs | Bullet |

**Total: 38** (Quality 16.5, Speed 100, Consumption 0, no consumption metric yet).

The baseline predates leaving this site's own files out of size and rework (fresh review, below). That changes at most one merge here, #69, whose 932 lines include site files. No merge in the window was site-only, so the gate is unchanged. The first lane run gives the live numbers.

Provisional, not scored: 15 of 40 merges were already rewritten by a later merge within 7 days (#9, #10, #13, #14, #35, #36, #38, #42, #46, #49, #50, #54, #59, #60, #67). The docs move (#10) alone was rewritten by eight later merges.

What the misses show:
- The merge rule's "0 commits behind `main`" is not enforced by anything: half the merges went in behind, so the code that merged was never tested as it landed.
- The three Dependabot merges went in while their review job failed, and #34, a change to `REVIEW.md`, merged with its review failing on 4 Blocking findings. All four were in the repo's first hour.
- First-time misses are mostly the author pushing again within seconds of opening (#40, #54), which cancels the first CI run.
- Rework is mostly follow-up pull requests rewriting one merged minutes earlier: a consent check added after merge (#42 by #50, #50 by #52), wording corrected after review (#59 by #63, #60 by #64).
- Template misses are custom headings ("How it was checked" for "How it was verified"), a missing section, or an unticked "No ..." line.

## Fixes

Ranked by score gained (Quality points, then the total moves by two thirds of that). The fixes outside this folder are for the `pull-request` skill and `quality-speed/BRIEF.md`; this session may push only its own branch, so the pull request's "Orchestrator to do" carries their exact text.

| # | Fix | Metric | Gain | Where |
|---|---|---|---|---|
| 1 | Before merging, confirm the head is 0 commits behind `main` (`gh api repos/Colorado-Startups/legallas/compare/main...<head> --jq .behind_by` reads 0) and that `claude-review` ran, not skipped, on that head. Then the first-day misses leave the window by 2026-11-30 | `required_gates_on_merged_head` | +23.1 Quality | skill, hand-off step |
| 2 | Finish a change before merging it: no follow-up pull request that rewrites what merged minutes earlier; take review wording into the same pull request | `no_rework_7d` | up to +23.1 Quality, measurable once 20 merges are 7 days old (from about 2026-11-09) | skill; BRIEF |
| 3 | Split work into pull requests of at most 400 changed lines | `small_changes` | up to +14.4 Quality | skill; BRIEF |
| 4 | Push the final commit before opening or marking ready, so the first CI run is not cancelled | `ci_green_first_time` | up to +8.4 Quality | skill |
| 5 | Fill the template headings exactly as written, tick each "No ..." line, and don't edit the body after the review starts; the edit check then runs in Actions | `template_complete` | up to +7.7 Quality | skill |
| 6 | Read `REVIEW.md`'s Blocking list before opening | `no_blocking_findings` | up to +6.8 Quality | skill |
| 7 | Rebase onto a fresh `origin/main` before queueing, and don't queue two pull requests that touch the same files, so a conflict doesn't eject one | `queue_ejections_pct` | up to +7.1 Quality | skill |

Speed is at 100 already, on goals cited from outside sources.

## Final

Not reached yet.
