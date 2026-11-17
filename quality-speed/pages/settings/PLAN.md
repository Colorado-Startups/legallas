# Settings: plan

Converted to Git Crafter's model (2026-11-04). Git Crafter has no settings template, so this page starts from its own ideal state below. It takes over draft pull request 96, whose session has stopped, and keeps its expected-settings file, reads, drill, guard, lane and page. The admin lane's rules are unchanged.

## Sources

| Source | What it gives | Read |
|---|---|---|
| legitify GitHub policies, `policies/github/{repository,actions,organization,member}.rego` at commit `038aa49473a6974a3ef79f6c76b949b689d23282` (Legit Security, open source) | The security baseline: 24 repository, 4 Actions and 7 organization policies with severity, rationale and pass condition | 2026-11-02 |
| GitHub docs, [Secure use reference](https://docs.github.com/en/actions/reference/security/secure-use) | Pin actions to a full-length commit SHA; least privilege for tokens and secrets; workflows must not approve pull requests | 2026-11-02 |
| GitHub docs, [Managing GitHub Actions settings for a repository](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository) | "Require actions to be pinned to a full-length commit SHA"; allowlist syntax `owner/repo@*` | 2026-11-02 |
| GitHub docs, [Available rules for rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets) | Push rulesets for private repositories: restrict file paths (fnmatch), file size | 2026-11-02 |
| GitHub REST description, `github/rest-api-description` `api.github.com.json` | Exact request and response bodies: `sha_pinning_required`, selected actions, rulesets, budgets, immutable releases | 2026-11-02 |
| GitHub docs, [Permissions required for fine-grained personal access tokens](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens) | Which key permission reads which endpoint; that ruleset history needs write, Codespaces secrets need write, and the audit log isn't open to fine-grained keys at all | 2026-11-02 |
| `anthropics/claude-code-action` `action.yml` at the SHA main pins | It is a composite action that calls `oven-sh/setup-bun`, so the allowlist must name both | 2026-11-02 |
| The repository itself: `CLAUDE.md`, `REVIEW.md`, `SECURITY.md`, `.gitignore`, `.github/workflows/*`, the pull-request skill | The working constraints: squash only, DCO, signed commits, the three required checks, the owner's merge route, no case data | 2026-11-02 |
| Live REST reads through this session's proxy | Repository object, both rulesets, immutable releases. Everything admin-only returned 403 here | 2026-11-02 |
| The orchestrator's brief | SHA pinning off, any action allowed, default token read, forking off, squash only, 2FA required, four $0 stop budgets | Read by the orchestrator 2026-11-02 |

Not used: OpenSSF Scorecard (the Security page owns it) and CIS's GitHub benchmark, whose full text is paywalled; legitify maps to
the same controls and its pass conditions are public.

## Ideal state

`ideal.json`, in 25 words: every setting that guards the repository reads at its safest working value, proven by a daily read, and any drift is fixed within two days. Its four sources are GitHub Docs, read 2026-11-04 from their source in `github/docs` (they show no date, so each is dated the day read): Secure use reference, Available rules for rulesets, Setting up budgets to control spending on metered products, and Events that trigger workflows ("The `schedule` event can be delayed during periods of high loads").

`expected-settings.json` is the source of truth: 74 settings, 17 of them gates, each with its expected value, why, source and the read
that proves it; 8 settings not scored, each with its reason; and the 14 legitify policies this repository doesn't follow, with why. A
value that would stop every merge, such as a required approval when one login opens every pull request, is not the safest working value,
and the file says what covers that risk instead. `guard.ts` fails a loosening of the file that has no signed-off entry in its `changes`
list; it enforces nothing until CI runs main's copy of it, which is on the orchestrator's list.

## Metrics

Draft 96's list, signed off there in comment 6571534388, is kept as it was, with a `goal_source` on each metric; this pull request needs its own sign-off. Each reading is `collect.ts` reading GitHub's REST API, linked to the run that read it.

| id | `goal_source` |
|---|---|
| `settings_drift_count` | Available rules for rulesets |
| `gates_intact`, `planted_drift_detected`, `drift_fix_hours` | Secure use reference |
| `stop_budgets_ok` | Setting up budgets to control spending on metered products |
| `read_gap_hours` | Events that trigger workflows |
| `lane_minutes` alone in Consumption (2026-11-05, #645) | No `api_calls`: the read is the closed list in `reads.ts`, so its count can't drift, and it runs on the GitHub App's token, 10,000 calls an hour on an Enterprise Cloud organization (GitHub Docs, Rate limits). The 2026-11-05 job took 18 s. Money the settings guard sits with `stop_budgets_ok`, and CI spend with the Actions page |

Each link is the source of the control the metric checks. The numbers come from the expected-settings file (0 drift, every gate) and the daily cadence (one day to act, so 48 hours to fix), as below. The Sources table's dates are draft 96's reads on 2026-11-02; `ideal.json` dates the same GitHub Docs by this session's read, since the pages show no date.

| id | Lens | Why | Unit, direction | Floor | Goal | Weight | Min samples |
|---|---|---|---|---|---|---|---|
| `settings_drift_count` | quality | Settings whose live value differs from the expected file. Missing unless all 74 were read | count, lower | 10 | 0 | 3 | no | 74 |
| `gates_intact` | quality | 1 when all 17 gates read as expected. A known drift reads 0 even if another read failed; otherwise anything unread is missing | pass | 0 | 1 | 2 | no (was yes until 2026-11-05) | 1 |
| `stop_budgets_ok` | quality | 1 when four products have a product-level $0 stopping budget at organization or enterprise scope, Actions among them, and no budget allows spend | pass | 0 | 1 | 2 | yes | 1 |
| `planted_drift_detected` | quality | The drill on invented responses: every planted drift caught, refused reads missing, unused names withheld, the clock right | pass | 0 | 1 | 1 | no | 1 |
| `drift_fix_hours` | speed | Worst time from a drift flagged to a read showing it fixed, last 30 days; an open drift counts its age. "No events" scores 100 only while the drill passes, and a log younger than 7 days keeps it missing | hours, lower | 336 | 48 | 2 | no | 1 |
| `read_gap_hours` | speed | Longest gap between complete reads in the last 14 days, the worst-case time to catch a change | hours, lower | 168 | 26 | 1 | no | 7 |

| Change, 2026-11-05, #645 | Why |
|---|---|
| No metric caps the page | The owner's ruling, 9 Nov: every page scores on its own metrics, so a missing `stop_budgets_ok` lowers Quality like any other row |

All age limits are 48 hours. Goals: 0 drift and both gates at 1 because the file is the target; 26 hours is a daily run plus GitHub's
delay at busy times; 48 hours to fix allows one day to act, since reads are daily. Floors sit at roughly half, a week and two weeks.

Dropped: secret scanning and push protection (paid, not bought), alert counts and Scorecard (Security page), CI spend (Actions page),
per-person activity, and, after round 3, the baseline percentage, the read percentage and detection time, each of which another metric
already measures.

### Independent review

| Round | Verdict | What changed |
|---|---|---|
| 1 | Not signed off | setup-bun in the allowlist and nested actions followed; `visibility`; a `claude_review_enabled` gate; the key permission list; `guard.ts`; budgets by product; environments main-only; secrets placement; organization Pages, visibility and webhooks; names withheld unless a workflow uses them |
| 2 | Signed off with changes | the Dependabot copy of the review key; job permissions; `CLAUDE_ENABLED` read outside any environment, ignoring case; budgets by scope; no Pages site reads as private |
| 3 | Signed off with changes, against `BRIEF.md` | three metrics cut, with the baseline conditions, ruleset timing and their drill cases |

Declined, with the reviewer's agreement: a `non_fast_forward` rule on tags (`update` already blocks every tag update); blocking document
extensions in the push rule (`qs-room-gold` writes invented documents); Codespaces secrets (listing needs write); workflow lockfiles (a
workflow change, not a setting); short-lived changes to repository settings (the audit log isn't open to fine-grained keys).

## Chart per metric

| Metric | Chart |
|---|---|
| `gates_intact`, `stop_budgets_ok`, `planted_drift_detected` | Pass tiles |
| `settings_drift_count`, `drift_fix_hours`, `read_gap_hours` | Bullets against goal and floor |

**Infographic:** a pictogram of the 74 expected settings, solid when it reads as expected, a red outline when not. The expected settings
are a sortable table one click away (`expected.html`), each with its status from the last read. Road to 100 comes from the chart kit.

## CI lane

`lanes.json`: one lane, `settings`, daily, on GitHub's runner (`linux-hosted`), `admin: true`, collector `collect.ts`. It reads with
`QS_SETTINGS_TOKEN`, the read-only key, when the job has it, and otherwise with `GH_TOKEN`, the job's own token, which also reads Pages
(`pages: read`). The drift log is the lane's memory in `facts/`; each setting's status goes to `page/settings-status.json`, which the
build copies beside `page.ts` for the expected-settings table.

Two things `lanes.json` can't express, for the workflow:

| Needs | Why |
|---|---|
| `CLAUDE_ENABLED_VAR: ${{ vars.CLAUDE_ENABLED }}` in the Collect step's `env` (in since 9 November) | `claude_review_enabled` is a gate. The lane's job has no environment, so it sees the repository's value, as `claude-review` does. Without it `gates_intact` reads missing |
| The key as `QS_SETTINGS_TOKEN` in the admin lane's `env`, in the owner-merged change | The collector makes its own GET reads, a closed list in `reads.ts`, and keeps closed fields only |

**The key** is the `legallas-automation` App's token from the Settings token step: read-only, this repository only. Five settings it
still can't read, after the 9 November fixes below:

| Unread | Why | Needs | Who |
|---|---|---|---|
| `branch_bypass` (a gate), `tag_bypass` | GitHub returns a ruleset's `bypass_actors` only to a caller with write access to it (REST docs, "Get a repository ruleset"). GraphQL gives a reader the count, each actor null | A token with ruleset write, or another way to read who may bypass | orchestrator: a security call, since this lane holds read keys only |
| `secrets_unused`, `secrets_stale` | Environment secrets need the Environments permission (read). The App has none | Environments read on the App, then `permission-environments: read` in the Settings token step | owner adds it to the App; then a pull request |
| `actions_allowlist_covers_main` | `git-crafter/actions/pages` is in another repository, and the key reads this repository only | The App on `git-crafter`, then a contents read through the key | owner adds the repository; then a pull request |

Until all five read, no read is complete: `settings_drift_count`, `drift_fix_hours` and `read_gap_hours` read missing, and
`gates_intact` stays missing unless a gate drifts. Never Variables, Codespaces secrets or any write.

## Baseline

Run for real on 2026-11-02 at 07:22 UTC, before any fix, on main at `35c58d4d1209f0600901d045b0fd915a76170f3d`, through this session's
proxy, which has no key: 37 of 74 settings read, 30 as expected, 7 drifted.

| Metric | Baseline | Score |
|---|---|---|
| `settings_drift_count` | missing (37 unread) | 0 |
| `gates_intact`, `stop_budgets_ok` | missing | 0 |
| `planted_drift_detected` | 1, 92 cases | 100 |
| `drift_fix_hours`, `read_gap_hours` | missing | 0 |

Quality 12, speed 0, consumption 0 (no consumption metric yet), total **4**.

Drifted: `web_commit_signoff_required`, `immutable_releases`, `branch_rule_linear_history`, `branch_checks_strict`,
`branch_dismiss_stale_reviews`, `push_ruleset_case_paths`, `push_ruleset_max_file_mb`. Known from the brief and certain to drift once the
key reads them: `actions_allowed`, `actions_sha_pinning_required` and the three selected-actions settings. That is 12.

## Fixes

Ranked by score gained, estimated from the weights (quality: drift 37.5, each gate 25, drill 12.5; speed: fix time 66.7, read gap 33.3),
with today's 12 known drifts. This session changes no setting: the exact REST calls are under "Orchestrator to do" in the pull request.

| # | Fix | Who | Quality | Speed | Total |
|---|---|---|---|---|---|
| 1 | Read-only key and the lane: gates and budgets read, the read gap fills in a week | owner, orchestrator | +50 | +33.3 | +44.4 |
| 2 | Actions policy: drift 12 to 7 | orchestrator | +11.25 | | +7.5 |
| 3 | Branch rules: drift 7 to 4 | orchestrator | +11.25 | | +7.5 |
| 4 | Push rules: drift 4 to 2 | orchestrator | +7.5 | | +5 |
| 5 | Sign-off and immutable releases: drift 2 to 0, every drift fixed within 48 hours of the first full read | orchestrator | +7.5 | +66.7 | +27.2 |

Anything the first full read shows among the 37 settings not yet read is fixed the same way.

Done, from the 8 November run's 13 unread:

| Date | Fix | Where | Unread |
|---|---|---|---|
| 9 Nov | The seven merge settings read through one GraphQL query. REST left all seven out for the key; GraphQL gave the same values as REST for an admin | `reads.ts` `merge` | 13 to 6 |
| 9 Nov | `CLAUDE_ENABLED_VAR` passed to the Collect step | `quality-speed.yml` | 6 to 5 |

## Public repository, 2026-11-16 (#18)

The repository opened on 2026-11-17 UTC. The expected file now describes it; each loosening has a `changes` entry.

| Setting | Was | Now | Why |
|---|---|---|---|
| `repo_visibility` | private | public | Apache-2.0, open to contributors |
| `allow_forking`, `has_discussions` | false | true | Contributors work from forks; ideas start in Discussions |
| `allow_auto_merge` | true | false | A merge names the commit whose checks passed |
| `branch_bypass` | admin role, by pull request | none | Read with an admin login: both branch rulesets list no bypass |
| `push_ruleset_case_paths`, `push_ruleset_max_file_mb`, `push_ruleset_bypass` | scored | removed | GitHub offers push rulesets on private and internal repositories only (the rulesets source above). Fix 4 goes with them |
| `actions_access_level` | none | removed | The API answers 422 on a public repository |
| `pages_private` | true | removed | A public repository's site is public; `QUALITY_SPEED_PUBLISH` decides what it shows |
| `secret_scanning`, `secret_scanning_push_protection` | dropped as paid | gates, enabled | Free on a public repository |
| `fork_pr_approval` | not possible, forking off | gate, `all_external_contributors` | A fork's pull request runs nothing until approved |
| `branch_rule_merge_queue` | none | gate, true | Ruleset `main-merge-queue` |

Still drifting on the 16 November read, each a goal no one has applied yet: the four Actions policy settings, `branch_rule_linear_history`,
`branch_checks_strict`, `branch_dismiss_stale_reviews`, `claude_review_enabled`, `dependabot_secrets` and four organization settings.

## Final

Not reached yet.
