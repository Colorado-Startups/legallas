# Testing: plan

The owner's words: quality tests, done speedily; test what actually needs testing; don't over-engineer; no test that isn't needed.

## Sources

| Source | What it gives this page |
|---|---|
| `SECURITY.md`, `docs/product.md` | The real risks: who sees what, the room's gate, cites, sync, migrations, PII guard, spend guard, the connector |
| [Stryker: supported mutators](https://stryker-mutator.io/docs/mutation-testing-elements/supported-mutators/) | The mutation operators used here (a subset) |
| [Stryker: thresholds](https://stryker-mutator.io/docs/stryker-js/configuration/#thresholds-object) | Mutation score: low 60, high 80 |
| Petrovic and Ivankovic, [State of Mutation Testing at Google](https://research.google/pubs/state-of-mutation-testing-at-google/) (ICSE SEIP 2018) | Mutate the code that matters, skip "arid" lines such as logging |
| Google Testing Blog, [Flaky Tests at Google](https://testing.googleblog.com/2016/05/flaky-tests-at-google-and-how-we.html) (2016) | Rerun on one commit to find flakes; a flaky test proves nothing |
| Martin Fowler, [Continuous Integration](https://martinfowler.com/articles/continuousIntegration.html), after Kent Beck's ten-minute build | Floor for time to a test result |
| [Node.js test runner](https://nodejs.org/api/test.html), [module.registerHooks](https://nodejs.org/api/module.html#moduleregisterhooksoptions) | Everything runs on Node's own runner: no new framework |

## Ideal state

`ideal.json`, from Git Crafter's `quality/ideals/tests.json` cut to 25 words: fast, trusted tests, every real risk proven by a planted
break, nothing flaky. Its sources are the template's, less GitHub's runners page, which has no date of its own.

The risks, in `risks.ts`, each with its risky functions, its tests and the planted breaks that would do the most harm:

| Risk | Planted break |
|---|---|
| `room_gate` | A token for another audience is accepted; a cross-site write passes |
| `who_sees_what` | A guest sees a privileged document; a revoked invitation stays active |
| `cites_right_page` | A cite to a page the prompt never showed is kept |
| `sync_changes_nothing` | A `_private` folder syncs; a change mid-sync is ignored; a pull replaces an existing file |
| `safe_migrations` | A new migration drops a column; an applied one changes |
| `pii_guard` | A flagged document passes the gate |
| `spend_guard` | A reserve passes the month's limit |
| `connector_contract` | Propose is listed without consent; a removed member's connection keeps working; one member sees another's proposal |

## Metrics

| Metric | Why | Source | Floor | Goal | Weight |
|---|---|---|---|---|---|
| `risks_proven` % | The ideal itself: the share of risks whose every planted break fails one of its tests. Each risk's result is a check in `detail.json` | `collect.ts`, weekly, lab | 0 | 100 | 8 |
| `risk_mutation_score` % | Breadth: every mutant of the risky functions only, against each risk's tests | `collect.ts`, weekly, lab | 60 | 80 | 8 |
| `flaky_tests` count | A flaky test proves nothing | 3 full suite runs on one commit | 5 | 0 | 3 |
| `web_test_step_p50` s | The suite's usual time on a pull request | Actions API: the `Web test` step of the last 30 pull request runs, on the newest run's runner label | 300 | 60 | 1 |
| `web_test_step_p95` s | The suite's worst usual time | Same runs | 300 | 60 | 1 |

One metric for all eight risks keeps the list within Git Crafter's 3 to 10; the risk map still names the unproven risk, from the lane's
detail checks. Quality weights keep the earlier balance: proofs 8, mutants 8, flakes 3.

`risks_proven` stopped being a gate on 2026-11-05 (#645): a risk with no test is test upkeep, not harm to a customer or money. It still scores at weight 8.

Each metric's `goal_source`: Martin Fowler's Continuous Integration, its self-testing build (every risk proven), Stryker's thresholds (80), Google's flaky
tests post (0), Bazel's test encyclopedia (60 s).

| Percent metric | `min_samples`: today's count, on `main` at `c71c733` |
|---|---|
| `risks_proven` | 8 risks |
| `risk_mutation_score` | 745 mutants |

| Can't measure | Reads |
|---|---|
| A test passes alone but fails through `hook.ts`, or fails with its file served unchanged through it: a broken hook would kill every mutant | `risk_mutation_score` missing |
| A planted break matches 0 or 2+ times | That risk unproven |
| Mutants still unrun after 30 minutes, the budget inside core's 40-minute lane limit. On 6 Nov the lane reached that limit and wrote nothing; on 7 Nov 189 of 788 were unrun at 30 minutes | `risk_mutation_score` missing; every other metric still lands. The outcomes so far are cached, so the next run finishes the rest |
| A risky file no test of its risk loads | Its mutants count as survived, unrun (Stryker's "no coverage") |
| A whole-suite run past 8 minutes (CI's `Web test` takes about 3) | That run is stopped and counts no CPU |

Consumption, a third of the total:

| Metric | Why | Source | Floor | Goal | Weight |
|---|---|---|---|---|---|
| `lane_minutes` | This lane's own run | `core/lane` | 30 | 5 | 1 |
| `suite_cpu_minutes` | What one whole web suite run costs, in the Node processes `npm test` starts | `collect.ts`: the CPU its exited children used (`/proc/self/stat`, cutime and cstime) around each of the 3 suite runs; the median | 10 | 2 | 3 |

`suite_cpu_minutes` goal: the ideal's "no more than the speed goals add up to". Bazel's 60 s and 300 s on CI's 2-vCPU runner are
2 and 10 CPU minutes. Not `web_test_billed_minutes`: the `checks` job also type-checks, builds and bundles, and its minutes are
already CI overview's per-job minutes and Actions' `billed_minutes_per_merge`.

Goals: Stryker's thresholds for the mutation score, which the baseline already meets; zero flakes and every risk proven by the
ideal; [Bazel's test timeouts](https://bazel.build/reference/test-encyclopedia#role-test-runner) for the suite, short (60 s) and
moderate (300 s). Every mutant runs, not a sample, so the score moves only when code or tests change. A risk whose tests are missing
or fail with no break proves nothing, and all its mutants count as survived.

How a break or mutant runs, as [Stryker](https://stryker-mutator.io/docs/stryker-js/configuration/) runs one (since 7 Nov):

| Step | Rule |
|---|---|
| Baseline | Each of the risk's test files alone, through `hook.ts`, which records the project files it loads |
| Which tests | A mutant: the files that load its file. A break: every file (a migration is read, not imported) |
| Order | Fastest first; stop at the first that fails |
| Timeout | 1.5 times that file's baseline time, plus 5 s (`timeoutMS` default). Past it counts as killed; the job log counts these apart |
| At once | One mutant per vCPU |
| Cache | A mutant whose file and covering tests' loaded files are unchanged takes its last outcome, as Stryker's [incremental mode](https://stryker-mutator.io/docs/stryker-js/incremental/) does (`cache.ts`, since 8 Nov). Kept in the Actions cache, saved after a stopped run too. The job log counts cached against run |

Before 7 Nov every mutant ran every test of its risk, with one timeout of 5 times the whole set.

Not scored: the second half of the ideal, "nothing else gets a test". No measure tells a needed test from an unneeded one, so a
score of 100 here claims only the first half. The page states the gap in one line and does not claim it; a later change can measure it.

Dropped seeds:

| Seed | Why it is off |
|---|---|
| Coverage | The mutation score on the risky functions is the stronger form; whole-file coverage would ask for tests of glue code, which the owner does not want |
| Bugs that escaped | No reliable marker of a fix in titles; the Pull requests page owns fix-ups within 7 days |
| Tests adding no unique coverage | Covering the same lines is not proof two tests check the same thing; candidates go to the orchestrator |
| Slowest 10 tests' share | A drill-down for `web_test_step_p95`, not a score |
| Time to a test result on a pull request | Run start to the end of the tests includes runner choice, queue, checkout, secret scan and type check, which the Actions and Code pages own |
| Time to first failure | Node's runner reports at the end of a run |
| Cost per run | The Actions page owns spend |
| Swift tests | The Mac minutes cost 10 times Linux; the named risks live in `web/`. Swift tests stay in the jobs that already run them |

## Chart per metric

| Metric | Chart |
|---|---|
| `risks_proven` | The infographic, a risk map: one row per risk from its detail check, caught (check) or not (x), missing in red (`dotMatrix`) |
| `risk_mutation_score`, `flaky_tests`, `web_test_step_p50`, `web_test_step_p95`, `suite_cpu_minutes` | One bullet each against floor and goal, with date and lab or live mark (`metricBullet`) |
| Road to 100 | The fixes below, each worth what its metrics still lack (`roadTo100`) |
| History | The page's score over time (`timeline`), once there is history |
| Every metric | A sortable table with each value, score and run link (`dataTable`) |

Per-risk mutant counts and minutes, each survivor, and the 10 slowest test files with their seconds go to the collector's job
log, for whoever fixes them, not to the page.

## Baseline

2026-11-02, the earlier list of eight per-risk proofs (signed off on #159, for that list only: this list needs its own sign-off on its own pull request) on `main` at `35c58d4`, lab run in a cloud session (4 vCPU, Node
24.22) and the live Actions record. Before #135 merged; the suite-speed fix (#284) had just landed, so a few of the 30 runs have it.

| Metric | Value | Score |
|---|---|---|
| `risks_proven` | 7 of 8 pass (87.5 %): `safe_migrations` fails, no test exists | 87.5 |
| `risk_mutation_score` | 81.8 % (604 of 738) | 100 |
| `flaky_tests` | 0 in 3 runs of the whole web suite | 100 |
| `web_test_step_p50` | 47 s (30 runs) | 100 |
| `web_test_step_p95` | 117 s | 76.3 |
| `suite_cpu_minutes` | Added 2026-11-05: the lane's next run reads it | |
| **Total** | Quality 94.7, Speed 88.1, Consumption 0 (no consumption metric yet): 60 | **60** |

Mutants killed per risk: `room_gate` 61/80, `who_sees_what` 46/49, `cites_right_page` 92/129, `sync_changes_nothing` 143/172,
`pii_guard` 110/131, `spend_guard` 81/86, `connector_contract` 71/91. The slowest 10 test files take 43 % of test time.

Earlier runs, before the list was final: 75 % of risks and 77 % of mutants on the first list, whose weak breaks and narrow test lists
the first reviewer fixed; then, on `1f688d5`, 87.5 % and 81.2 % with suite p50 85 s and p95 98 s. On `35c58d4`, before
`sync-windows.test.ts` joined the sync risk, mutants read 78.3 %: the inbox's copy fallback, new with Windows sync, looked untested.

Redundant tests: 91 of 341 test files add no line of coverage that no other file adds, and 33 are line for line inside one other
file. That is not proof: one of the 33, `mcp/tools/documents-privilege.test.ts`, is the privilege proof for `who_sees_what`, whose
lines `documents.test.ts` runs without its assertions. So no test is listed for removal.

## Fixes

Ranked by score gained.

| Fix | Pull request | Measured | Gain |
|---|---|---|---|
| A test: a new migration only adds, an applied one never changes | #135, open | 3 pass on `main`; fails on a planted `DROP COLUMN` and on an edited applied migration | Quality 94.7 to 100 |
| Web suite 3 files at a time (Node runs 1 on 2 vCPUs), and no politeness pause against the law tests' fake network | #155, merged as #284 | Whole suite on 2 cores: 149 s to 72 s, all 3,010 pass; `Web test` 33 s on its CI run | p95 under 60 s once the 30-run window holds only runs after it: 96 to 100 |
| Fewer test processes: files that change no global, console, clock, timer, root hook or process state share a process (`web/scripts/run-tests.ts`, `--test-isolation=none`), so each module loads once per process, not once per file. A file that loads a registry when imported (`mcp/pro.ts`, `worker/index.ts`) shares only with files that load the same ones. The rest run alone; the 3 slowest start first | `claude/testing-web-shards` | 458 files in 107 processes, not 458. `Web test` on its CI run and the lab run on its head (the pull request) | `suite_cpu_minutes`, `web_test_step_p50`, `web_test_step_p95` |
| Fewer test processes: 33 files are line for line inside one other file, each to check by hand first (Baseline) | none yet | The lane's first reading | `suite_cpu_minutes` toward 2 CPU minutes |
| Access-control survivors of the 7 Nov lab: a test each, the gate's own tests listed on `room_gate`, and `consent-repeat.ts` on `connector_contract` | #915, merged | `headers.ts` 71: 3 mutants served through `hook.ts`, all fail `headers.test.ts`; the rest on the next lab run | `risk_mutation_score` |
| Incremental lab: unchanged mutants take their cached outcome, so a cut-short run finishes on the next | `claude/testing-incremental` | Two lab runs on its head (the pull request) | `risk_mutation_score` reads; `lane_minutes` falls |
| `ruleFor`'s counsel branch (`rooms.ts` 281, 2 survivors): the matter-room tests, which list counsel's documents privileged included, join `who_sees_what` | `claude/testing-incremental` | The lab run on its head | `risk_mutation_score` |

Equivalent mutants: no test can tell them from the code, so each stays a survivor and is named here.

| Where | Mutant | Why no test kills it |
|---|---|---|
| `web/worker/auth.ts` `verifyAccessIdentity`, `if (!token)` | Condition `false` | jose rejects a missing token (`JWSInvalid`) before the key is fetched: same `null` |
| `web/mcp/consent-repeat.ts` `timingSafeEqual`, `i < a.length` | `<=` | Lengths already match; the extra step XORs `NaN` with `NaN`, which is 0 |

## Final

Not reached yet.
