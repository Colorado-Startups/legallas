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
| `maps.json` | 11 maps (`ci` own, 10 from the Git Crafter library), 4 to 6 steps each, one metric a step |
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
| `measure` | collect `settings.read_gap_hours` · page `reliability.failed_main_runs_with_issue` · goal `issues.unranked` · fix `issues.closed_by_hand` · score dropped (no Legallas metric) |
| `deploy` | build `build.web_build_seconds_p50` · ship `insights.lead_time_p50` · verify `insights.change_failure_rate` · restore `insights.recovery_time_p50` |
| `adopt` | copy `actions.unpinned_dependencies` · require `actions.gates_intact` · check `actions.green_minutes_p50` · current `code.dependencies_current` · update dropped (no Legallas metric) |

| Legallas reading | On the Process page |
|---|---|
| `ok`, fresh, enough samples | Its value, rated by the manifest's `floor` and `goal` |
| `missing`, `stale`, `no_events`, past `max_age_hours`, under `min_samples` | Not measured, with the reason |

```bash
node quality-speed/process/adapt.ts --state <state dir>
```
