# Actions: plan

**Ideal state:** a green run means the change is safe, it says so within minutes, and the month's CI allowance never runs out.

## Sources

Read 2026-11-01 and 2026-11-02.

| Source | What it gives this page |
|---|---|
| [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions) | Enterprise Cloud includes an amount of compute each month, "a monetary amount, not a fixed number of minutes". Pages and Dependabot listed as free |
| [Actions runner pricing](https://docs.github.com/en/billing/reference/actions-runner-pricing) | Per minute: Linux 2-core $0.006, Linux 1-core $0.002, Linux arm $0.005, Windows $0.010, macOS $0.062. Each job rounds up to a whole minute. No 2x or 10x multipliers appear |
| [Billing cycles](https://docs.github.com/en/billing/concepts/billing-cycles) | Metered products reset at 00:00 UTC on the first of each month |
| [Set up budgets](https://docs.github.com/en/billing/how-tos/set-up-budgets) | At a stop budget, hosted runners are blocked until the next cycle. So running out means CI stops, and the required checks with it |
| [Continuous Integration, Fowler](https://martinfowler.com/articles/continuousIntegration.html) | The XP guideline of a ten minute build. An effective team should rarely see a red mainline |
| DevOps Research and Assessment, continuous integration capability | Feedback in a few minutes, with an upper limit of about 10. A broken build takes priority over other work |
| [Eradicating non-determinism, Fowler](https://martinfowler.com/articles/nonDeterminism.html) | A non-deterministic test can destroy the value of a regression suite, because a red run stops meaning anything |
| [Secure use reference, GitHub](https://docs.github.com/en/actions/reference/security/secure-use) | Pin actions to a full-length commit SHA. Give the token the least it needs |
| [OpenSSF Scorecard checks](https://github.com/ossf/scorecard/blob/main/docs/checks.md) | Pinned-Dependencies covers unpinned dependencies in workflows and shell scripts |
| [Workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax) and [Actions limits](https://docs.github.com/en/actions/reference/limits) | A job's default timeout is 360 minutes. Hosted jobs can run for up to 6 hours |
| [REST rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) | A job's token gets 15,000 reads an hour on an Enterprise Cloud repository, per repository |
| [Blacksmith runners](https://docs.blacksmith.sh/blacksmith-runners/overview) | 3,000 free minutes a month per organization. The page doesn't say what happens past them; `CLAUDE.md` records that it bills |
| `.github/scripts/build_minutes_guard.py` | How job records are read, and the guard: this repository stops at 1,800 of those minutes and the organization's other repository at 900 |

### What the money reading rests on

- **The billing report had no rows until November.** On 2026-11-01 and 11-02 it answered HTTP 200 with `usageItems: []` for this organization and its enterprise. On 2026-11-06 the organization's November summary had rows for `actions_linux`, `actions_linux_slim`, `actions_macos`, `actions_windows` and `actions_storage`, none of it billed (#237). October still has none. The page keeps reading job records, which need no billing scope; an empty list still means unknown, never $0.
- **The stop-usage budget covers `ubuntu-slim`.** The organization's budgets (read 2026-11-06) are product-level `ProductPricing` with `prevent_further_usage` on `actions`, `codespaces`, `packages` and `git_lfs`. The report books `actions_linux_slim` under product `Actions`, so the `actions` budget stops it too (#263).
- **Job records recover the bill.** On an account whose report does have rows, the same rule matched the billed minutes within one minute on each runner (2026-11-02). That includes Dependabot's minutes, so they count here too, even though the billing page lists Dependabot as free.
- **What this page works to.** The owner, 2026-11-06: "You are authorized to use all the action credits as needed". So the ceiling is the whole included amount. The lane passes it in (`ACTIONS_INCLUDED_USD`), so no account's figure sits in this public tree; with none, the page draws no gauge. The stop is the enterprise's Stop-usage budget on Actions: past the included amount, CI stops instead of billing. There is no hold below it.
- **The blind spot.** A job's token sees only this repository, so the reading leaves out the organization's other private repositories, and their share of Blacksmith's minutes. They held under 1% of the first day's spend, but another repository's site is about to share the allowance. The gap between the goal and the ceiling is partly for this, and Fixes has a row to close it.

## Metrics

Each metric has a floor (scores 0), a goal (scores 100) and a weight. All read within 48 hours. Windows are in `measure.ts`.

### Quality

| Metric | Why it proves the ideal | Source | Floor | Goal | Weight | Min samples |
|---|---|---|---|---|---|---|
| `allowance_forecast_usd` | Running out stops CI, so where the month will end matters more than where it is | Job records priced by runner: month so far, plus the last 7 days' daily pace for the days left | 90% of the included amount | 60% of it | 4 | 30 product jobs |
| `main_green_pct` | A red main means green stopped meaning safe | CI on main, 14 days, green on the first attempt. A rerun can't erase a red, and a run open at 2 hours counts against | 90 | 100 | 3 | 10 runs |
| `gates_ran_pct` | A run can be green because the gate that mattered never ran | Per merged product pull request, 14 days: the secret scan always, the web check, test, build and dry runs when `web/` changed, both Swift jobs on Swift paths, the workflow lint on `.github/` | 90 | 100 | 3 | 10 merges |
| `planted_failures_caught_pct` | Green only means safe if red still happens | The repository's own gates, run on planted failures in throwaway folders, plus their wiring in `ci.yml` | 50 | 100 | 3 | 29 plants, all of them |
| `flaky_trees_pct` | A flake teaches everyone to ignore red | Same files, same job, both passed and failed, 30 days, over the trees with something to compare. A pass only counts if its tests ran, and a failure always counts | 5 | 0 | 3 | 20 trees |
| `runs_deleted` | A deleted run takes its spend and any red with it, from every number on this page | Gaps in each workflow's run numbers, 31 days. No deny can prove this, since `gh` in a session's Bash tool is all one can catch | 1 | 0 | 2 | 30 runs |
| `usd_per_merge` | The forecast alone could be met by merging nothing | Dollars over merged product pull requests, 14 days | $0.50 | $0.10 | 2 | 10 merges |
| `blacksmith_minutes_31d` **gate** | Blacksmith bills past its free minutes, against the owner's rule, and the guard is its only stop | Job records, counted as the guard counts them, with a CI run still going at its worst case of 25 minutes | 2,100 | 1,900 | 2 | 30 product jobs |
| `unpinned_dependencies` | A tag or a piped download can change under a green run | Workflow and script files: actions not on a SHA, downloads piped into a shell | 5 | 0 | 2 | 20 |
| `workflow_lint_pass` | The repository's own lint: actionlint and zizmor | `.github/scripts/lint-workflows.sh`, today, on the commit. CI only runs it when workflows change | 0 | 1 | 2 | 1 |
| `jobs_with_timeout_pct` | The 360-minute default means one hung Mac job costs $22.32 | Workflow files: a job limit of 60 minutes or less | 80 | 100 | 1 | 10 |
| `workflows_proven_pct` | A workflow that has never run can't be trusted to work when needed | A successful run in 90 days, for every workflow but `replica-eval.yml` | 50 | 100 | 1 | 8 |

`gates_ran_pct` and `planted_failures_caught_pct` stopped being gates on 2026-11-05 (#645): a miss is CI upkeep, not harm to a customer or money. They still score. `blacksmith_minutes_31d` stays a gate: past it, CI bills.

### Speed

| Metric | Why it proves the ideal | Source | Floor | Goal | Weight | Min samples |
|---|---|---|---|---|---|---|
| `green_minutes_p50` | "Green" that takes an hour gets skipped | Push to every required check green, for pushes that ran tests and passed first time, 14 days | 20 | 5 | 3 | 20 |
| `green_minutes_p95` | The slow run is the one people remember | The same | 30 | 10 | 3 | 20 |
| `slowest_job_minutes_p95` | One slow job sets the wait for everyone | Worst p95 among jobs on pull requests, each with at least 3 runs, 14 days | 20 | 5 | 1 | 20 |

### Consumption

| Metric | Why it proves the ideal | Source | Floor | Goal | Weight | Min samples |
|---|---|---|---|---|---|---|
| `billed_minutes_per_merge` | Runner time is the resource CI uses, whatever runner it lands on, so this counts Blacksmith's free minutes too | Billed minutes, each job rounded up, of product runs over merged product pull requests, 14 days | 83 | 17 | 1 | 10 merges |

### Why the goals are where they are

- **`allowance_forecast_usd`:** the floor is 90% of the ceiling, close enough that one burst late in the month would reach the stop-usage budget and stop CI. The goal is 60%, near what the owner first expected (2026-11-02), which leaves room for a burst and the other repositories this page can't see. Stated reason, no outside standard exists.
- **`runs_deleted`:** GitHub's [contexts reference](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts) says `github.run_number` begins at 1 for a workflow's first run and increments with each new run, and 825 runs on 2026-11-02 had no gap, so a gap means a deletion. One is enough to score 0, because the evidence is gone and can't be scored around. It counts every run, the site's too. Like any metric at goal, it adds to the score while it reads 0: adding it lifted the first baseline from 85 to 86. **Its limit:** a deleted newest run leaves no gap until that workflow runs again, and a deleted oldest run in the window leaves none at all.
- **`usd_per_merge`:** a month at the pace of the busiest 24 hours so far, over that day's merges, is about $0.10 a merge. So even a month at the rollout's pace stays inside the forecast's goal. The floor is five times that.
- **`green_minutes_p50` and `p95`:** The DevOps research program's "a few minutes", and the ten-minute limit it and Fowler both name. Baseline already meets both, which the sources justify. Goals only tighten, so these can move down later.
- **`billed_minutes_per_merge`:** `usd_per_merge`'s goal and floor, $0.10 and $0.50, in minutes at GitHub's Linux rate of $0.006 a minute (Actions runner pricing): 17 and 83.
- **`slowest_job_minutes_p95`:** half of the ten-minute budget, since one job can't be allowed to use the whole of it.
- **`main_green_pct`:** Fowler and the DevOps research program, as above. The floor is one red run in ten.
- **`flaky_trees_pct`:** Fowler, as above. The floor of 5% is one flake in twenty comparisons, well past the point where people stop trusting red.
- **`blacksmith_minutes_31d`:** Blacksmith's page gives the 3,000 free minutes. The guard stops this repository at 1,800, and the other repository's stops at 900. A few jobs in flight can pass the stop, so the goal is 1,900. The floor is 2,100, where this repository's use plus the other repository's full share reaches the free limit, so past it the organization can start to bill. It's a gate because the owner never allows per-use billing.
- **`jobs_with_timeout_pct`:** $22.32 is 360 minutes at $0.062, from one hung job. Today's longest limit is 30 minutes, so 60 leaves room without allowing an hour-long hang to pass unnoticed twice.
- **`unpinned_dependencies`, `workflow_lint_pass`:** GitHub's secure use reference and Scorecard, both above.
- **`gates_ran_pct`, `planted_failures_caught_pct`, `workflows_proven_pct`:** all must be whole. There's no safe share of gates that didn't run or plants that got through. The drill's sample minimum equals its plant count, so deleting a plant reads as too few samples, not a clean score.

### Tab rescope, 2026-11-09

The page mirrors GitHub's Actions tab: Workflows, then Management. Logic in `moved.ts`, on product runs, pull requests and workflows only.

| Metric | From | Lens | Floor | Goal | Weight | Min | Window |
|---|---|---|---|---|---|---|---|
| `gates_intact` | CI overview | Q | 5 | 6 | 1 | 1 | Merges, 2 days |
| `repeat_runs_per_merge` | CI overview | Q | 1 | 0 | 1 | 10 | Merges, 2 days |
| `app_token_runs_passing` | GitHub App | Q | 50 | 100 | 1 | 1 | 30 days |
| `app_token_job_seconds_p50` | GitHub App | S | 300 | 60 | 1 | 1 | 30 days |
| `queue_seconds_p90` | New | S | 300 | 30 | 1 | 20 | 14 days |

| Decision | Why | Reverse |
|---|---|---|
| `gates_intact` counts six gates, not eight | `claude-review` retired in #555; its two gates can never pass | Restore them in `GATES` |
| `app_token_*` leave out `quality-speed.yml` | BRIEF: this site's own workflow never counts here | Read every workflow in `appWorkflows` |
| `queue_seconds_p90` scores, overruling the seed below | The owner's card, 9 Nov, goal 30 | Remove the metric |

| Section | Not yet scored | Why |
|---|---|---|
| Caches | `cache_hit_pct` | The REST API gives cache size, not hits |
| Deployments | `deploy_success_pct` | Pages deploys come from this site's own workflow |
| Attestations | `releases_attested_pct` | No releases yet |
| Lockfile | `actions_locked_pct` | `unpinned_dependencies` holds until GitHub's lockfile covers this repo |
| Performance | `job_failure_pct` | No goal with a source yet |

### Seeds changed

| Seed | Decision | Why |
|---|---|---|
| Mac share of spend | Cut as a score, kept in the spend chart | It improves if Linux spending rises, so it can read better while things get worse. `usd_per_merge` and the forecast catch Mac cost with no such flaw |
| Allowance left | Became `allowance_forecast_usd` | What's left today says little on day 3. Where the month ends is what stops CI |
| Flaky reruns | Became `flaky_trees_pct` | Counting reruns reads clean when nobody reruns. A merged pull request that was up to date runs on the same tree on its branch and on main, so comparisons build up with no rerun. It held for 16 of the first 37 merges, because the rest merged behind `main` |
| Success on main | Kept, plus `gates_ran_pct` and the drill | Success alone can't tell a passing gate from a gate that never ran or can't fail |
| Workflow lint clean | Kept | |
| Job time | Became `slowest_job_minutes_p95` | The worst job sets the wait |
| Queue time | Cut as a score, shown by runner in a table | The baseline already met any goal with no published target behind it. Mac is 4% of jobs, so a shared p95 would read 17 s while every Mac job waited an hour. Queue time is already inside the time to green |

### What this page doesn't cover

The Testing page owns test quality, coverage and test timing. This page owns workflows, runners, queue time, reliability and spend, so `flaky_trees_pct` reads whole jobs, not single tests, and `gates_ran_pct` only asks whether tests ran. `qs-ci-overview` makes the CI map and does the optimizing, and reads this page's numbers.

### What's excluded, and the one exception

- **This site's own runs never count:** `quality-speed.yml`, and any pull request whose files are all under `quality-speed/` or that workflow, on its branch and after its merge. A pull request with even one other file is a product change, so a site file can't hide it. The site's own workflow is left out of the share counts and the lint.
- **A red main stays red.** `main_green_pct` reads every run and drops only the site's green ones, because a red main is a red main whoever caused it, and a site merge can replace a product run.
- **Dollars and Blacksmith minutes are the exception.** `allowance_forecast_usd` and `blacksmith_minutes_31d` count everything, because that's what is really left, and building the site can only lower them. Their sample counts take product jobs only, so site jobs can't lift a quiet week over the minimum.
- **`replica-eval.yml` is never run or required here,** because it reads from a real room.

### The drill

29 plants, and each gate has a control, so a gate that always fails can't read as catching everything. A control that goes wrong, or a tool that can't start or times out, makes the reading missing. A scanner's plant only counts when it names what it found, because a scanner that stops on its own error also exits non-zero.

| Gate | Planted | Must |
|---|---|---|
| `ci-ok`, run as written | Every gate it reads, failed and cancelled, read from `ci.yml` so a new gate joins by itself; `checks` skipped; `swift` ran with no `swift-ocr` | Fail |
| `ci-ok` and the gates, as wired in `ci.yml` | It waits for every job, reads the real results, always runs, has no `if` on its step; no gate job has `continue-on-error` | Hold |
| `dco`, run as written | A commit with no sign-off | Fail |
| `changed-paths.sh`, push mode | A change to web, Swift, the app, a workflow or an office-reader file; an unknown base | Mark that area changed, so its jobs aren't skipped |
| `changed-paths.sh`, pull request mode | A Swift change in a test merge. This mode decides the only Mac run, since main skips them once tested | Mark Swift changed |
| `build_minutes_guard.py` | Its own stop; unknown minutes | Choose GitHub-hosted |
| `secret-scan.sh` | A token added then removed, generated at run time so none is ever in this repository, in full-history and pull request modes | Fail and name it |
| `lint-workflows.sh` | A workflow with a template injection | Fail and name it |

## Chart per metric

| Metric | Chart |
|---|---|
| `allowance_forecast_usd` | Fuel gauge infographic: month so far, the forecast, the goal, the hold, the ceiling. Also a bullet |
| `usd_per_merge`, `blacksmith_minutes_31d`, `green_minutes_p50`, `green_minutes_p95`, `slowest_job_minutes_p95` | Bullet against goal |
| `main_green_pct`, `gates_ran_pct`, `planted_failures_caught_pct`, `flaky_trees_pct`, `jobs_with_timeout_pct`, `workflows_proven_pct` | Tile. The plants also get a pictogram, and the whole page a score trend |
| `unpinned_dependencies`, `workflow_lint_pass` | Pass or count tile |

Spend by job, spend by day, queue time by runner and the plants come from `detail.json`, in sortable tables, a running total and a pictogram. Only jobs in the checkout keep their names and the rest read as "other", so a branch's job name can't carry text to the site.

## Baseline

Read 2026-11-02 at 08:36 UTC in CI, by the real lane in [run 41413382412](https://github.com/Colorado-Startups/legallas/actions/runs/41413382412), and scored by `core/score.ts`. That pass read 3,729 runs and 187 pull requests in 2,546 reads and took 5.5 minutes. It replaces a first reading of 86 taken from a laptop through a cache. Before the first dispatches, `fixture-room.yml` and `claude-confinement.yml` had 0 runs and `workflows_proven_pct` read 62.5.

| Metric | Baseline | Samples | Score |
|---|---|---|---|
| `allowance_forecast_usd` | private | 2,462 jobs | 0 |
| `main_green_pct` | 100 | 71 runs | 100 |
| `gates_ran_pct` | 100 | 73 merges | 100 |
| `planted_failures_caught_pct` | 100 | 29 plants | 100 |
| `flaky_trees_pct` | 0 | 41 trees | 100 |
| `runs_deleted` | 0 | 3,729 runs | 100 |
| `usd_per_merge` | private | 73 merges | private |
| `blacksmith_minutes_31d` | 1,417 | 2,462 jobs | 100 |
| `unpinned_dependencies` | 0 | 33 | 100 |
| `workflow_lint_pass` | pass | 1 | 100 |
| `jobs_with_timeout_pct` | 100 | 17 jobs | 100 |
| `workflows_proven_pct` | 90 | 10 | 80 |
| `green_minutes_p50` | 2.73 | 214 pushes | 100 |
| `green_minutes_p95` | 7.42 | 214 pushes | 100 |
| `slowest_job_minutes_p95` | 3.02 | 2,151 jobs | 100 |

**Quality 81, Speed 100, Consumption 0 (no consumption metric yet), total 60.** 993 of the 3,729 runs were the site's own. Queue p95 by runner, shown and not scored: Linux 104 s, 1-core Linux 154 s, macOS 36 s, Windows 39 s, Blacksmith 8 s.

The forecast is the largest gap. It rests on under a day of the rollout's heaviest traffic, divided as one whole day, so it overstates until a week of data has built up.

The organization's spend, by job and in total, stays off this public tree; the page's spend table shows it where the lane runs.

### First runs of the by-hand workflows

| Workflow | Result | Time |
|---|---|---|
| `fixture-room.yml` | Passed: seed, build, screenshots and MCP smoke | 4 min 22 s |
| `claude-confinement.yml` | Passed | 50 s |

## Fixes

Ranked by score gained, on the baseline above.

| Fix | Gain | How | Status |
|---|---|---|---|
| The forecast and `usd_per_merge` | Quality up to 18 | The rollout's pace has to fall, and the week's data has to build up. `qs-ci-overview` does the optimizing, and this page keeps measuring | #241, watching |
| Prove `claude.yml` | Quality up to 1 | It asks for `OWNER` and this login reads `MEMBER`, so it takes the organization owner's own login | #234, waits on the owner |
| Read cap | Stops 11 metrics going missing together | `ledger.ts` keeps each finished run's jobs in `facts/runs-ledger.json.gz`, so a pass reads only new and rerun runs; 40,000 invented runs gzip to 252 KB, under the 2 MiB facts cap. A pass that leaves a run unread reads missing, never an estimate, since Blacksmith is a gate, and keeps its ledger so the next pass carries on | #240, fixed by the ledger |
| Read the other repositories | Closes the blind spot | Sum their spend through the metrics key once it exists, or read the billing report if it starts answering | Project 1, order 934 |
| The review's other suggestions | None scored, each closes a way to read better than the truth | | Project 1, order 935 |

Done already:
- `fixture-room.yml` and `claude-confinement.yml` run for real, which took `workflows_proven_pct` from 25 to 75.
- #82 moved the three small jobs to the 1-core runner, about 19% of spend on the first 7 hours' job records.
- #316 replaced the confinement check's piped installer with a checksum check, which took `unpinned_dependencies` to 0.

## Final

Not reached yet.
