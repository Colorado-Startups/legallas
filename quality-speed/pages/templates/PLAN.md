# Templates and agreements: plan

Slug `templates`. Session `qs-templates`. Status: re-landed from #132 in the Quality, Speed and Consumption model; list awaiting sign-off on this pull request.

## Sources

| Source | What it settles |
|---|---|
| `docs/checklist/baseline.toml` (118 items) | What a company needs |
| `docs/design/document-set-and-law.md`, paths 1 to 5 and "How the baseline checklist maps" | Each document's path, whether the product prepares or signs it, and each form's licence verdict |
| #16 | Founder done-when: every document row in paths 1 and 2 has a bundled form or an original draft |
| #26 | Rows marked Prepare or Sign get a template; Review, Track or Gated don't; investor files still keep their own format |
| `templates/README.md` | The format, the fields, the notice, the footer, the option blocks |
| `templates/bundled-forms.md` | Which public forms may ship |
| `docs/legal/product-notices.md`, A1, A2, A5 | Required lines and banned claims |
| `templates/investors/README.md` | "A document older than a year should be rechecked before use" |
| [Series Seed documents](https://github.com/seriesseed/equity) | A standard set of documents for a seed round, shipped whole: `coverage` aims at every needed document |
| [web.dev, the RAIL model](https://web.dev/articles/rail) (updated 2023-01-06) | "Complete a transition initiated by user input within 100 ms, so users feel like the interactions are instantaneous": `fill_ms_p95` |
| [Martin Fowler, Continuous Integration](https://martinfowler.com/articles/continuousIntegration.html) | A fast build: `lane_minutes`. Not readable from this session (proxy refuses the host); the reviewer chose it |
| [Claude Code docs, MCP](https://code.claude.com/docs/en/mcp) (read 2026-11-05) | "Claude Code displays a warning when MCP tool output exceeds 10,000 tokens and limits output to 25,000 tokens by default": `template_part_tokens_max`, as the data room's `search_result_tokens_p95` |
| [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/legalcode) | The licence original templates carry, and what `right_to_ship` checks for. Code stays Apache-2.0 |
| [WCAG 2.2](https://www.w3.org/TR/WCAG22/) (2024-12-12), 3.3.4 Error Prevention (Legal, Financial, Data) | Input for a legal commitment is checked for errors: `fields_work` |
| [Anthropic Usage Policy](https://www.anthropic.com/legal/aup) (effective 2025-09-15), high-risk use case requirements | Legal guidance is high risk: a qualified professional reviews it, and people are told AI was used: `wording` |

No lawyer has read any template. Nothing here calls one verified or reviewed.

## Ideal state

`ideal.json`, drawn by the build atop the page: every template a founder or investor needs exists, may ship, fills cleanly,
and never claims a lawyer reviewed it.

## Metrics

**What counts as needed** (`needed.json`). One rule on every path: a document needs a template when the map's last column says
Prepare or Sign and not Review, Track or Gated (#26). The unit is each of the baseline's 118 items, in the path the map assigns
it, plus every map row of paths 1 to 5 the baseline lacks (#16). A baseline item with no map row counts when the company drafts,
fills or signs it. Groups: startup forms, startup raises, running the company (the map's 24 items outside the five paths), angels
invest, angels create groups, VCs invest. On 2026-11-13: 129 needed, 55 excluded. The five `financing.*` business items #430 added (deck, summary, model, use of funds, metrics) have no map row and the founder drafts them, so they count, with no template yet.

| Excluded because | Meaning |
|---|---|
| `not-prepare` | The map's last column has neither Prepare nor Sign, or says Review or Track |
| `search` | A search, not a document |
| `account` | An account to open |
| `record` | A running record the product keeps from the room (#17), with no map row marked Prepare |
| `third-party` | Someone else's paper: a valuation, a policy, a state certificate, a return, a review of past agreements |
| `payroll` | Payroll paperwork the provider handles |
| `practice` | A way of working, not a document |
| `notices-bar` | Product notices A5 bar a non-compete clause |

An item is covered when its listed templates exist and it has no `gap`. A template serves only the entity types in its own
`entity` list, so a company-side item applying to a type no listed template names carries a gap.

**What counts as a template:** every `.md` under `templates/` except `README.md` files, `bundled-forms.md` and `held-back/` (the equity plan, not offered until a lawyer reviews it), which is the licence
record `right_to_ship` reads. A file that fails to parse fails every check. A metric with no files to check reads `missing`.

Each check belongs to one metric, and each metric's `goal_source` in `manifest.json` is the public page its goal comes from (Sources above).

| Id | Lens | Checks | Floor | Goal | Weight |
|---|---|---|---|---|---|
| `coverage` | quality | Needed items covered, % | 0 | 100 | 4 |
| `right_to_ship` | quality | `licence` is CC0-1.0 and `source` begins "Original drafting for Legallas" or "Original analysis for Legallas" and never says, unnegated, that it was adapted, copied, derived, based on or modified, or `bundled-forms.md` links the file, as `(<id>.md)`, under May ship, % | 0 | 100 | 2 |
| `fields_work` | quality | Of files with template markers or `{{` in the body: `fields` (a list or a map) equals the fields used, option blocks pair up, and a sample fill leaves no `{{` or option marker, % | 0 | 100 | 2 |
| `wording` | quality | The A2 line, "No lawyer has reviewed", the A5 footer with the file's id and date when it has fields, and no banned claim, % | 0 | 100 | 2 |
| `fill_ms_p95` | speed | Daily: each template read, parsed, every `{{field}}` filled with an invented sample value ("Sample <field>") and option markers dropped, timed; 95th percentile, nearest rank, of all 53. One failed render reads `missing` for the run | 1000 | 100 | 1 |
| `lane_minutes` | consumption | The `daily` job's minutes, from `core/lane/collect.ts` (`laneRecord`); `missing` outside CI | 30 | 5 | 1 |
| `template_part_tokens_max` | consumption | Tokens in the largest part one `legallas_template` read returns: every template split as the tool splits it (`web/worker/template-parts.ts`), characters over four (the data room's rule, `data-room/lab/journeys.ts`); the largest part of any template | 25000 | 10000 | 3 |

**Goals, and where each number comes from:**

| Metric | Goal | Source states | Derivation |
|---|---|---|---|
| `coverage` | 100 % | Series Seed: one standard set for a seed round | Every needed item (#16, #26) has its template, so all 129 of 129 |
| `right_to_ship` | 100 % | CC0 1.0: no conditions, so the check is that the file declares it | Each shipped file meets them or is a May ship form, so 53 of 53 |
| `fields_work` | 100 % | WCAG 2.2, 3.3.4: input for a legal commitment is checked | Applies to every fillable file, so 50 of 50 |
| `wording` | 100 % | Usage Policy: anyone given legal guidance is told AI was used | Applies to every file, so 53 of 53 |
| `fill_ms_p95` | 100 ms | RAIL: "Complete a transition initiated by user input within 100 ms" | The number as stated. Floor 1000: RAIL, "Beyond 1000 milliseconds (1 second), users lose focus" |
| `lane_minutes` | 5 min | Fowler: a fast build (reviewer's source, unread here) | Reviewer set goal 5, floor 30 |
| `template_part_tokens_max` | 10,000 tokens | Claude Code MCP: warns above 10,000 tokens of tool output, cuts at 25,000 | Goal at the warning, floor at the cut: a part past 25,000 can't reach an AI through the room. The data room's goal and floor for one search result |

**Samples and ages:**

| Metric | `min_samples` (today's count) | Max age | Lane |
|---|---|---|---|
| `coverage` | 129 needed items | 48 h | `daily` |
| `right_to_ship` | 53 templates | 48 h | `daily` |
| `wording` | 53 templates | 48 h | `daily` |
| `fields_work` | 50 templates with fields | 48 h | `daily` |
| `fill_ms_p95` | 53 templates | 48 h | `daily` |
| `lane_minutes` | 1 | 48 h | `daily` |
| `template_part_tokens_max` | 69 templates | 48 h | `daily` |
The fill test's 5 templates are fixed here: `founders/founders-agreement`, `founders/founder-stock-purchase`,
`founders/invention-assignment`, `founders/initial-board-consent` and `founders/delaware-corporation-certificate`. Its one model is
fixed in the job's settings; changing either is a change-log entry.

**Dropped from #132:** `sourced_and_current` (a source and a check within a year), as no public page readable from a cloud session
backs the one-year rule, so it waits for one (Board cards to file); and `format` (the README's keys and section order), which checks
house style, has no public source for its goal, and adds nothing `wording` and `fields_work` don't already catch.

**Banned claims** (A1): a lawyer, attorney or law firm "reviewed", "verified", "approved" or "vetted" it; "lawyer-grade";
"replaces a lawyer"; "no need for a lawyer"; "saves you legal fees"; "pay less for lawyers"; "your legal agent"; "for
informational purposes only"; "does not give legal advice". A clause ends at a stop, colon, semicolon or "but". A no, not, none, never, nothing or n't negates the phrase only in its own clause:
at most ten words before it, with no comma between them except the commas of a list, and no new clause with its own subject
("and our", "yet the"), so "Nothing to sign yet and our attorney approved it" fails, so "No lawyer, attorney or law firm has reviewed this template" passes and "This is not
a toy: a lawyer reviewed it" fails. Each clause is also checked with any phrase set off by two commas dropped, so "A lawyer, hired last
year, has reviewed it" fails. Ordinary legal words such as "privileged" or "verified as accredited" aren't banned.

**Left out:** whether original drafting copied a restricted form (no text to compare against), and a lawyer's review (none exists).

**CI lane** (`lanes.json`): one lane, `daily`, on `linux`, running `collect.ts`, with no secret or network, in about a second.
`lane_minutes` reads the job from the workflow's `GITHUB_RUN_ID`, `LANE` and `GH_TOKEN`.

**Sign-off:** pending. The list in #132 was signed off there; this pull request changes it (one metric dropped, goal sources
added), so an independent reviewer signs it off here before `signoff_comment` is set.

## Chart per metric

| Metric | Chart (kit) |
|---|---|
| `coverage` | The infographic: one row of document icons per group, filled when covered, red outline when not (`pictogram`), plus `bullets` |
| `right_to_ship`, `fields_work`, `wording` | `bullets` |
| `fill_ms_p95`, `lane_minutes`, `template_part_tokens_max` | `bullets`; `template_part_tokens_max` also on `roadTo100` as Shorter reads |
| Page | The build's `ring`; `roadTo100` for the fixes left |

`page.ts` exports `render()`: numbers from the build's validated readings, rows of documents from `needed.json` beside it, so it runs
inside the build's fence. A per-template matrix would need files outside `quality-speed/`, so it isn't on the page; the collector
shows the same detail when run. `node quality-speed/core/build.ts --synthetic` and a build on today's readings both pass the publish
guard: 35 KB, 51 visible words, no console errors at 1280 and 390 wide, light and dark, no sideways scroll.

## Baseline

Taken 2026-11-02 at `origin/main` `ededebb`, lab, before any fix: `node quality-speed/pages/templates/collect.ts`.

| Metric | Value | Sample | Score |
|---|---|---|---|
| `coverage` | 20.69 % | 116 needed, 24 covered | 20.69 |
| `right_to_ship` | 100 % | 34 | 100 |
| `fields_work` | 100 % | 33 | 100 |
| `wording` | 38.24 % | 34: the 21 investor files have fields but no A5 footer | 38.24 |
| `fill_ms_p95` | not yet a metric | | |

Quality 55.92, Speed 0, **total 37**, on today's list of five metrics.

Covered by group: startup forms 10 of 30, startup raises 2 of 26, running the company 2 of 10, angels invest 5 of 11, angels
create groups 5 of 13, VCs invest 0 of 26.

## Now

2026-11-13, lab, on `main` `f770c72` plus the coverage mapping: `node quality-speed/pages/templates/collect.ts`.

| Metric | Before the mapping | Now | Sample | Score |
|---|---|---|---|---|
| `coverage` | 11.63 % (15) | 20.16 % (26) | 129 needed | 20.16 |
| `right_to_ship`, `wording` | 100 % | 100 % | 53 | 100 |
| `fields_work` | 100 % | 100 % | 50 | 100 |
| `fill_ms_p95` | 0.24 ms | 0.08 to 0.14 ms, 2 runs | 53 | 100 |
| `template_part_tokens_max` (was `template_tokens_p95`) | 16,655, whole files, p95 | 9,917, largest part | 69 | 100 |
| `lane_minutes` | missing outside CI | | | |

Quality 68.06, Speed 100. By group: forming 6 of 36, raising 9 of 33, running 0 of 10, angels 5 of 11, groups 5 of 13, VCs 1 of 26.
The daily lane's run on `main` records the score the site shows.

**The mapping.** 24 rows gained the templates that exist for them. 11 are covered: trademark filing, ROFR and co-sale, both
management rights letter rows, director indemnification, bad actor certifications, and five rows on the offering record (exemption,
solicitation log, 506(c) verification, demo days, holder count). Delaware LLC joined the offering record's and bad actor
questionnaire's entity lists: both are federal text with no entity rule. 13 keep a gap:

| Gap | Rows |
|---|---|
| Delaware LLC | Advisor agreement, convertible note, conversion to a Delaware corporation, LLC investor admission |
| Both LLCs | Financing consents |
| Delaware corporation: Series Seed 3.2 is a bundled form, not a template file | Term sheet, stock purchase, restated charter, investors' rights, voting |
| The document itself (Hand off in the index) | 502(b) disclosure, finder agreement |
| A fund's own offering: no investment manager | VC bad actor questionnaires |

103 needed rows stay uncovered.

**`template_part_tokens_max`** replaced `template_tokens_p95` on 2026-11-13 (#986). The old p95 of whole files read 9,808 on 69
templates, under the goal, while three files ran past 10,000 tokens: small templates diluted it. `legallas_template` now returns a
template in parts of at most 10,000 tokens, so the metric reads the largest part any one read returns. In each of the three the
signed text between the template markers is past 10,000 alone:

| Template | Whole file | Signed text | Guidance | Parts |
|---|---|---|---|---|
| Delaware corporation bylaws | 21,740 | 12,117 | 9,623 | 9,326 / 4,051 / 8,364 |
| Colorado LLC operating agreement | 21,734 | 14,353 | 7,382 | 9,917 / 5,958 / 5,860 |
| Colorado corporation bylaws | 16,655 | 10,397 | 6,259 | 9,624 / 7,032 |

No trim reaches the goal without cutting signed text, so parts reach it instead. The Colorado bylaws' guidance, read in full, was
left whole: its repeats (the two-seat limit, for one) each sit beside a different section. It is the keyless read half of the board
card's `fill_tokens_p50`.

**How an AI reaches a template**, read in the code on 2026-11-13 with #986 (not tried in a live room):

| Path | Carries the text |
|---|---|
| An MCP tool | Yes. `legallas_template` lists all 69 and returns one a part at a time. `legallas_propose_draft` takes any path it serves (`TEMPLATE_PATHS`). Not for room guests (`GUEST_TOOLS`) |
| `/templates/founders/<file>` | Yes, as a static file behind the Access gate (`worker/room.ts`), for the template page and its download. An AI's own web tool holds no Access session |
| `templates/investors/`, `templates/raise/` | Through `legallas_template` only: `integrations/template-assets.mjs` copies `founders/` only |
| A part reader | `legallas_template`'s `part` and `next_part`: at most 10,000 tokens a part for Claude, 9,000 characters as sent for Copilot |

So every template reaches a member's AI, and the Claude Code warning the goal cites (re-read 2026-11-13) binds each part.
Before #986 no MCP output carried a template.

## Fixes

Ranked by total points gained, from now. Each lands as its own small pull request outside this folder.

| Fix | Points | Where |
|---|---|---|
| Notices, then right to ship, on any day either is short | Its Quality weight is the largest of the failing rows | `wording` to goal, then `right_to_ship` |
| Render time back under 100 ms, on any day it misses | up to +33.3 | `collect.ts` render path |
| Every needed document gaining a template | +0.18 each, +19.5 for all 108 | Backlog order: public forms that may ship, founder drafts (#16), investor drafts (#26). #125, #127, #154 and #167 add raise and advisor templates |
| Delaware LLC in the entity lists of templates that already fit one | +0.18 per item it closes | Check the invention assignment and founders' agreement text first |
| Shorter reads, on any day a template's largest part passes 10,000 tokens | Consumption weight 3 of 4 (`manifest.json`) | Split its longest section under a new heading, in `templates/` |

Done: #192 (from #111 and #141) and #316 (from #221) put the footer on all 21 investor files, lifting `wording` to 100. #986 serves
templates in parts, so `template_part_tokens_max` reads 9,917, within the 10,000 goal.

## Final

Not reached.

## Board cards to file

- Bring back `sourced_and_current` (each template names its source and is checked within a year) once a public page readable
  from a cloud session states the one-year rule.
- Build the weekly keyed fill job and collector for `fill_tokens_p50`: input plus output tokens per filled template, median (needs the owner's Claude key; [token counting](https://platform.claude.com/docs/en/build-with-claude/token-counting)).
