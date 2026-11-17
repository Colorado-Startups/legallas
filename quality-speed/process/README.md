# Process page

Legallas's process maps, drawn by Git Crafter `actions/pages`, each step scored by a Legallas Quality and Speed metric.

```mermaid
flowchart LR
  S["state: records/&lt;page&gt;.json<br/>(quality-speed-history)"] --> A[adapt.ts]
  MF["pages/&lt;page&gt;/manifest.json<br/>goals"] --> A
  MP[maps.json] --> A
  A --> T["out/targets/legallas.json"]
  A --> L["out/data/latest.json"]
  T --> P["Git Crafter actions/pages<br/>pages: process"]
  L --> P
  MP --> P
  P --> D["dist/index.html"]
```

| File | Is |
|---|---|
| `maps.json` | 19 maps (9 own, 10 from the Git Crafter library), 4 to 6 steps each, one metric a step |
| `adapt.ts` | Legallas records and goals to Git Crafter's run format |
| `quality.json` | The Quality config the action reads: `out/` |
| `config.json` | The Process page config |
| `process.json` | The Maps tab's ideal |

| Sources left out | Why |
|---|---|
| One host in Git Crafter's `delivery` sources and `process.json` | The clone's pre-push case-pattern scan matches its name; `maps.json` and `process.json` list the rest |
| `out/`, `dist/` | Generated, not committed |

| Map | Steps → metric (`legallas.<page>.<id>`, shown without the prefix) |
|---|---|
| `ci` | route `actions.usd_per_merge` · skip `actions.billed_minutes_per_merge` · Blacksmith `actions.blacksmith_minutes_31d` · hosted `actions.allowance_forecast_usd` · ci-ok `actions.green_minutes_p50` · queue `ci-overview.repeat_runs_per_merge` |
| `delivery` | plan `pull-requests.small_changes` · build `claude-code.tokens_per_merged_change` · ci `ci-overview.pushes_per_merge` · review `ci-overview.reviews_per_merge` · merge `ci-overview.final_push_to_merge_p50` |
| `board` | card `projects.cards_ready` · split `pull-requests.small_changes` · start `projects.in_progress` · finish `pull-requests.open_to_merge_p50` · done `projects.done_with_pr` · watch `projects.oldest_active_hours` |
| `triage` | intake `issues.missing_parts` · issue `reliability.time_to_fix_high_p90` · card `projects.status_matches_state` · fix `reliability.fixes_with_test` · link `issues.closed_by_hand` |
| `contribute` | idea `issues.untyped` · approve `settings.settings_drift_count` · review `pull-requests.no_blocking_findings` · merge `pull-requests.required_gates_on_merged_head` · rebuild `pull-requests.open_to_merge_p90` · deploy `insights.change_failure_rate` |
| `secure` | keys `claude-documentation.deny_rules_kept` · scan `security.scan_minutes` · model `reliability.risky_areas_reviewed_in_time` · report `repo-documentation.community_files_ok` · alerts `security.time_to_fix_critical_high_hours` |
| `code` | measure `code.long_files` · simplify `code.long_functions` · delete `code.dead_code` · explain `code.public_symbols_documented` · check `code.web_loop_seconds` · hold `build.release_gzip_bytes` |
| `document` | write `repo-documentation.readme_visual_share` · lint `code.long_sentence_share` · map `code.doc_lag_hours_p90` · publish `code.broken_internal_links` · read `code.reading_minutes_p90` · load `claude-documentation.startup_tokens` |
| `measure` | collect `settings.read_gap_hours` · page `reliability.failed_main_runs_with_issue` · goal `issues.unranked` · fix `issues.closed_by_hand` · score `settings.planted_drift_detected` |
| `deploy` | build `build.web_build_seconds_p50` · ship `insights.lead_time_p50` · verify `insights.change_failure_rate` · restore `insights.recovery_time_p50` |
| `adopt` | copy `actions.unpinned_dependencies` · require `actions.gates_intact` · check `actions.green_minutes_p50` · current `code.dependencies_current` · update dropped (no Legallas metric) |
| `room` | search `data-room.forming.member.find.search_round_trip_p95` · open `…find.document_open_p95` · cite `…trust.exact_quotes` · gate `…founder.leak.stranger_refused` · complete `…founder.complete.journey_end_to_end` · cost `…member.cost.search_result_tokens_p95` |
| `law` | cover `sec.coverage` · verify `sec.verified` · rights `sec.rights` · refresh `sec.fresh` · lag `sec.change_lag` · look up `sec.law_lookup_tokens_p95` |
| `setup` | read `sync.mac_files_read` · index `sync.mac_change_to_index_text_max` · untouched `sync.mac_folder_unchanged` · guide `ai-connectors.setup_steps_worst_ai` · refuse `ai-connectors.unsupported_ai_refused` · tool list `ai-connectors.tool_list_tokens` |
| `template` | need `templates.coverage` · rights `templates.right_to_ship` · fields `templates.fields_work` · wording `templates.wording` · fill `templates.fill_ms_p95` · size `templates.template_part_tokens_max` |
| `test` | risk `testing.risks_proven` · mutate `testing.risk_mutation_score` · flaky `testing.flaky_tests` · fast `testing.web_test_step_p50` · CPU `testing.suite_cpu_minutes` |
| `session` | allow `claude-settings.settings_match` · load `claude-settings.startup_tokens` · set up `agents.env_setup_seconds_p50` · open a PR `agents.session_to_pr_p50` · merge `agents.sessions_merged` · minutes `agents.minutes_per_merged_change` |
| `release` | build `mac-app.swift_jobs_passing` · time `mac-app.swift_job_minutes_p50` · bundle `mac-app.app_bundle_verified` · repeat `build.release_reproducible` · conditions `launch-readiness.conditions_met` · minutes `launch-readiness.lane_minutes` |
| `assure` | cover `compliance.policy_areas_covered` · evidence `compliance.evidence_refs_dead` · review `compliance.policy_review_age_days` · restore `compliance.restore_drill_age_days` · least access `github-app.app_permissions_off` · minutes `compliance.lane_minutes` |

| Coverage | |
|---|---|
| Pages with a step on a map | 26 of 35 |
| The other 9 | Law pages. They run the `law` map's process; `sec` stands for all 10 |
| Steps with no metric | 1: `adopt` update. No page measures how long a dependency bump waits |
| Maps with an ideal and a dated source | 19 of 19: 9 own in `maps.json`, 10 from the library |
| Page size | Each map adds about 17 KB; the guard's limit, 384,000 bytes, holds about 19. `sync` and `connect` share one map to stay under it |
| Library maps not used | 2: `decide`, `guard`. Legallas has no blockers page for their metrics |

| Legallas reading | On the Process page |
|---|---|
| `ok`, fresh, enough samples | Its value, rated by the manifest's `floor` and `goal` |
| `missing`, `stale`, `no_events`, past `max_age_hours`, under `min_samples` | Not measured, with the reason |

```bash
node quality-speed/process/adapt.ts --state <state dir>
```
