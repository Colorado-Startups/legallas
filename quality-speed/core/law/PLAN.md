# Law kit plan

The shared collector behind the law and regulator pages, every `PAGE_GROUPS.law` page but `templates` in `contract/pages.ts`. It has no score of its own: each page scores its body with it.

## Sources

All in this repository, read as files, but for one read-only call. No secret beyond the lane's own token, no install.

| File | What the kit reads |
|---|---|
| `docs/design/law-pack-plan.toml` | Each unit's `status`, `as_of`, `ship`, `take` and `host`; each host's `fetch`; the plan's `checked` date |
| `docs/checklist/baseline.toml` | Each item, and the file's `drafted` date |
| `templates/**/*.md` | Each file's `date_checked` or `checked`, and its text |
| A law eval report from `web/scripts/law/eval.ts` | Each row's `verdict`, answer, `answered` mark and `neurons`, for the page's own questions. The `law-eval` job's artifact, or `--eval` |
| The lane's last run, `$PREV_DIR/facts/law-runs.json` | Each question's newest turn with the model, carried for 60 days |
| The law library beside that report, `<law folder>/out` | `catalog.json` and each part a run retrieved, to rebuild the law tool's answer |
| `quality-speed/pages/<slug>/needs.json` | The page's reviewed list (format in `README.md`) |
| The run's jobs, `GET /actions/runs/{id}/jobs` with the lane's `$GH_TOKEN` | This lane's job, `<slug> (<lane id>)`, and its `started_at` |

## Ideal state

A founder or investor who needs a document or rule from this body gets the right, current one, fast, with its official source and date,
and nothing they need is missing.

Consumption: looking the law up costs the AI few tokens, the daily check bills about a minute, and checking the answers spends little of the free daily model allocation.

## Metrics

Ids every law page uses in its `manifest.json`. Percent metrics count each source once, however many needs rely on it.

| Id | Lens | Measures | Why | Suggested floor, goal |
|---|---|---|---|---|
| `coverage` | quality | Needs on the list the product holds: at least one reference, every reference resolves (a unit only if a default room builds it, so not one with `flag = "next"`), and the need's own source checked within 365 days | Nothing they need is missing | 0, 100 |
| `verified` | quality | Relied-on law units opened on the official host: plan `status` `VERIFIED`, or `PARTIAL`, read there in part. A `PARTIAL` unit adds coverage, so it never lowers the reading (#871). `SECONDARY` and `UNVERIFIED` fail | With its official source | 0, 100 |
| `fresh` | quality | Relied-on units, templates and checklist items checked within 365 days, no date in the future. A unit's `as_of` must also name a year, up to this one, and none older than last year | The current one, with its date | 0, 100 |
| `rights` | quality | Relied-on law units each install may fetch or link by itself. Fails `after-permission`, and a unit stored whole from a host that refuses machines (`fetch` is `no` or `browser-only`). The other ship verdicts only matter if text ever ships, and the plan ships none | Each source's right to ship or fetch | 0, 100 |
| `flags` | quality | Deadlines and fees on the list, three words or more, whose exact wording, case and spacing aside, appears in a template or checklist item the need relies on. A plan note can't vouch for itself | Deadlines and fees flagged correctly | 0, 100 |
| `questions` | quality | The page's test questions whose newest turn with the model, within 60 days, answered and passed every check in `eval-score.ts`. A question with no turn fails; a row marked retrieval-only, or errored with no answer, is no turn | Answered with the right citation | 0, 100 |
| `search_p95` | speed | Milliseconds, lower: each page question's law search, as the law eval times its retrieval (`search_ms`, the embedding call included), 95th percentile over a report's runs. A question with no timed run, skipped or failed, counts as slower than any, so a percentile landing on one reads missing | Fast | Set by each page |
| `open_p95`, `answer_p95`, `change_lag` | speed | Document open, answer time, lag from an official change to the pack | Fast | Set by each page |

### Consumption

| Id | Unit | Measures | Why | Floor, goal | `goal_source` |
|---|---|---|---|---|---|
| `lane_minutes` | `minutes`, lower | This lane's job time when the collector ends, rounded up to the whole minute. The upload after it can add one billed minute | The daily check costs as little as it can | 10, 1 | [GitHub Actions runner pricing](https://docs.github.com/en/billing/reference/actions-runner-pricing): a job's partial minute bills as a whole, so 1 is the least a lane can cost. 10 is the `linux` lane's limit |
| `law_lookup_tokens_p95` | `tokens`, lower | The law tool's answer to the page's questions, 95th percentile over a law eval report's runs. Each run's first six passages, rebuilt from the library beside the report with the tool's own builder (`web/mcp/law-answer.ts`): every client gets the JSON once, as text, cut to 9,000 characters as sent. Characters over four, as the data room counts. A run that retrieved nothing is skipped | Looking the law up costs the AI few tokens | 10,000, 2,250 | [Claude Code MCP](https://code.claude.com/docs/en/mcp): a warning above 10,000 tokens of tool output, so the floor. Goal: [`COMPACT_LIMITS`](https://github.com/Colorado-Startups/legallas/blob/main/web/mcp/contract.ts), 9,000 characters, 2,250 tokens counted this way: the room's own budget for one answer to Copilot |
| `eval_usd` | `usd`, lower | Workers AI spend to answer every page question once: the mean neurons of its questions' newest answered turns, times its questions. The daily job answers a slice, so the mean stands in for the rest | Answers cost little to check | 0.11, 0.011 | [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/): $0.011 per 1,000 neurons, 10,000 free a day. Goal: 1,000 neurons, a tenth of the day, since ten law pages share it. Floor: the whole day |

Both goal sources were checked on 2026-11-04 through a web search that quoted these lines. The pages themselves weren't opened, because this session's network refused their hosts. The Claude Code page was fetched on 2026-11-05; its limits section came back summarized, not verbatim.

A metric with nothing to count, 0 of 0, reads missing, never 100, and so does every record written outside CI.

## What waits

Until its row is done, a metric has no record and reads missing, as the format requires.

| Metric | Needs | Waits on |
|---|---|---|
| `search_p95` in a manifest | The collector writes it to `law.json` from the `law-eval` report (#869). It times the library the eval searches, not the live room | Each page's floor and goal |
| `open_p95`, `answer_p95` | A timed run of each page's questions against the live sample room, in an owner-merged keyed job (#361) | S5, S6 |
| `questions`, `eval_usd`, `law_lookup_tokens_p95` | The `law-eval` job in `quality-speed.yml`: the library built, all questions retrieved, 10 answered a day on the sample room's free neurons (214 questions on 6 Nov, at about 450 each, do not fit the 7,000 a day the spend lease gives scripts) | The sample room's first deploy, which makes the D1 `spend_counters` the lease counts in. `live-room`'s `up` starts the job (data-room/live/README.md). `LIVE_ROOM_CLOUDFLARE_TOKEN` needs Workers AI Read |
| `lane_minutes`, `eval_usd` in a manifest | `consumption` as a lens | qsc-core's Consumption pull request |
| `change_lag` | An official change feed per body | A page's own collector |

Cut after review: `notices`. The product notices give templates A5, not A2, every template already carries A2, and a notice isn't part
of the ideal state. The date it would have checked is in `fresh`.

## Chart per metric

| Metric | Chart |
|---|---|
| `coverage` | Bar per customer path: needs held against needs listed |
| `verified`, `rights` | Stacked bar of sources by plan `status`, or by ship verdict |
| `fresh` | Dot per source on a days-since-checked axis, with the 365-day line |
| `flags`, `questions` | Tick grid, one cell per flag or question |
| `law_lookup_tokens_p95` | Meter from floor to goal, marked at the reading |
| All | The per-need table, and Road to 100 from the kit's fix list |

## Baseline

Each page takes its own, before any fix.

## Fixes

Each page ranks its own. The kit lists them: every gap it finds is a fix with the metric it moves and by how much.

## Final

Each page records its own.
