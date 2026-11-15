# Launch readiness: plan

| | |
|---|---|
| Slug | `launch-readiness` |
| Status | Quality, Speed and Consumption; needs a new sign-off on this pull request |
| Lanes | `daily` (`linux`, `GH_TOKEN`) |

## Sources

| Source | What it settles |
|---|---|
| #32, body and comments | 12 gates before going public: 11 in the body, 1 in a comment. Closed when features moved to the board (2026-11-02); its text is still the source |
| The legal review's launch call, `docs/legal/review.md` in a private repository | The conditions before any listing or sale. Private: only counts and our own labels here |
| The owner's answers, `docs/brief.md` in a private repository, summed up on #32 | Win over the review: settle some rows, add launch states, set the terms (who can buy, refund window) |
| [`docs/legal/product-notices.md`](../../../docs/legal/product-notices.md) | The public wording the notices and copy conditions point at |

## Ideal state

`ideal.json`, drawn by core. Sources: dated documents only. Undated pages are only a metric's `goal_source`. End state, not yet measured: main's rules allow no bypass (returns with `main_rules`).

## The reviewed list

`conditions.json`: 39 conditions, each with a label, group, `owner`, origin (`gate`, `review`, `brief`), optional `after`, `evidence`, and optional `eval`.

| Group | All | Owner | Card | Scored | After go-ahead |
|---|---|---|---|---|---|
| Regulatory | 5 | 1 | 2 | 2 | 1 |
| Claims | 4 | 0 | 0 | 4 | 0 |
| AI | 6 | 0 | 0 | 6 | 0 |
| IP | 5 | 1 | 1 | 3 | 1 |
| Third party | 3 | 3 | 0 | 0 | 0 |
| Contracts | 2 | 0 | 0 | 2 | 0 |
| Privacy | 5 | 0 | 1 | 4 | 1 |
| Filing | 3 | 0 | 0 | 3 | 0 |
| Security | 6 | 1 | 0 | 5 | 5 |
| **Total** | **39** | **6** | **4** | **29** | **8** |

| Cut | Rows |
|---|---|
| Merged (gate and review ask the same) | Trademark search, description |
| Out | Rows the owner's answers settled (IP assignment: the code was always Colorado Startups', owner 2026-11-13); owner-only steps beyond the launch call; non-blocking rows |
| Folded | Lookup safeguards into one row; who can buy and refund window into the terms; the rename into the fresh repository |
| After the go-ahead | 8 rows with `"after": "go_ahead"`; not open for speed until it is met. Met by #993 (owner, 2026-11-13) |

| Evidence | Met when | Met date | Scored |
|---|---|---|---|
| Pull request number here | Merged into `main` | The merge | Yes |
| Issue number here | Closed as completed | The close | Yes |
| None | Never | | Yes, open |
| None, with `eval` (a path) | Never; the row links the eval | | Yes, open |
| `{ "card": <id> }`, Project 1 | Not read | | **No**: shown as "Board" |
| Owner's row | Has evidence | | No: shown as "Needs the owner" |

Anything else is open: not planned, duplicate, merged elsewhere, reopened. Never a number from a private repository.

**Card rows** (`answers`, `lookups`, `retention`, `templates`): their issues (#19, #24, #25, #16) closed as not planned on 2026-11-02, and
no lane token reads Project 1, so they are out of scoring. Each returns when a pull request or issue that covers it exists.

## Metrics

| Id | Lens | Measures | Floor | Goal | Goal source | Weight | Min samples |
|---|---|---|---|---|---|---|---|
| `conditions_met` | quality | Scored conditions met, % | 0 | 100 | [Open Source Guides](https://opensource.guide/starting-a-project/): "Check all the boxes? You're ready to go!" | 3 | 29 |
| `days_to_clear` | speed | Open / met in last 28 days, x 28, cap 365 | 365 | 30 | [Quick Check](https://dora.dev/quickcheck/): lead time band "One week to one month" | 1 | 29 |
| `lane_minutes` | consumption | The `daily` job's minutes (`core/lane`) | 30 | 5 | [Fowler, Continuous Integration](https://martinfowler.com/articles/continuousIntegration.html) | 1 | 1 |

| Repo-set number | Derivation |
|---|---|
| `days_to_clear` floor 365 | No closure in 28 days: no pace. A year caps it |
| `lane_minutes` floor 30 | Six times the goal: a lane that slow is broken |
| Weights | 1 each; `conditions_met` 3, since Quality is the list |
| Min samples 29 | Today's scored count |

| Consumption, 2026-11-05, #645 | Why `lane_minutes` stays alone |
|---|---|
| `api_calls` | At most 2 reads per condition with an issue or pull request number: 0 today, 80 for all 40, against the job token's 15,000 an hour on an Enterprise Cloud organization (GitHub Docs, Rate limits). The 2026-11-05 job took 13 s |
| What launch costs | Filing and outside fees: the owner's billing decisions, never in this repository, so nothing a session can read or act on |

## Collectors

| Lane | Collector | Reads | Missing when |
|---|---|---|---|
| `daily` | `collect.ts` | `GET .../issues/{n}`, and `.../pulls/{n}` for a pull request, per scored evidence number, with `GH_TOKEN`; then `laneRecord` | Any failed read; no run id. `lane_minutes`: outside CI, or no started job |

## Reads ok today

| Metric | Today |
|---|---|
| `conditions_met` | `ok`: 3 of 29, 10.34 % (`copy` #791, `name_filter` #725, `sources_dates` #775, each merged 2026-11-06). Before 2026-11-09, no row had evidence: 0 % |
| `days_to_clear` | `ok`: 18 open over 3 met in 28 days, 168. Back to 365 after 2026-12-04 unless more are met |
| `lane_minutes` | `ok` in the `daily` job, from this run's jobs list |

## Board cards to file

| Card | Done when |
|---|---|
| Admin job writes ruleset read-outs | It saves `GET /repos/Colorado-Startups/legallas/rulesets/{id}` for each ruleset on main as `admin-read/repository-rulesets-<id>.txt`, beside the keys read-outs |
| `main_rules` returns | After the card above: quality gate, the 7 launch rules main holds, % (pull request; squash only; `ci-ok`, `dco`; signed commits; no force push; no deletion; no bypass actor), on an `admin` lane, goal 100 from [Scorecard](https://github.com/ossf/scorecard/blob/main/docs/checks.md) |

## Chart per metric

| Metric | Chart (kit) |
|---|---|
| `conditions_met` | A row of check marks per group (`pictogram`), from the lane's checks; `bullets` |
| `lane_minutes` | `bullets` |
| `days_to_clear` | `metricTile`; `bullets` |
| Owner's 7 | Their own row at the top (`pictogram`) |
| Every condition | `dataTable`: label, group, needs (Owner, Board, Go-ahead), met or open, evidence |
| Page | Core's ring and ideal; `roadTo100` |

## Baseline

Not yet taken for this list.

## Fixes

One scored condition: +2.3 total. Ranked by points.

| Fix | Conditions | Points | Where |
|---|---|---|---|
| After the go-ahead | 8 | +18.4 | #32, #31 |
| Guard on person decisions, scope, use policy, claims file, release test | 5 | +11.5 | #785 (`people_guard`), new issues |
| Terms at install, marketing matches, privacy notice | 3 | +6.9 | New issues |
| Filings: consent, approver, ink | 3 | +6.9 | #22 |
| Notices | 1 | +2.3 | New issue |
| No nonprofit wording | 1 | +2.3 | New issue |
| Marks, trademark search | 2 | +4.6 | #32 |
| New description | 1 | +2.3 | #163 |
| Rules card for each AI | 1 | +2.3 | #115 |
| Matter rooms | 1 | +2.3 | #20, #110 |
| A steady pace | `days_to_clear` | +33.3 | All of the above |

## Final

Not reached.
