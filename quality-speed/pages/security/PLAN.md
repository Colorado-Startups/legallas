# Security: page plan

## Sources

Read on 2026-11-01 and 2026-11-02.

| Source | What it gives this page |
|---|---|
| [CISA BOD 26-04, Table 1](https://www.cisa.gov/news-events/directives/bod-26-04-prioritizing-security-updates-based-risk) (2026-06-10; replaces BOD 19-02 and 22-01, both revoked) | Remediation deadlines of 3, 14 and 60 days, or "fix on system upgrade", by exposure, known exploitation, automatability and impact. Its guidance says critical and high labels don't set a deadline, so this page's use of it is our mapping, not CISA's |
| [OpenSSF Best Practices, `vulnerabilities_fixed_60_days`](https://www.bestpractices.dev/en/criteria) | No unpatched weakness of medium or higher severity publicly known for more than 60 days |
| [OpenSSF Scorecard checks](https://github.com/ossf/scorecard/blob/main/docs/checks.md) and [scoring](https://github.com/ossf/scorecard#scoring) | Each check's risk level. Its own docs warn that an aggregate says little about specific behaviours, and that SAST credits only CodeQL and SonarCloud |
| [NIST SP 800-218 (SSDF)](https://csrc.nist.gov/projects/ssdf) | PW.7 analyse code with tools; RV.2 remediate in line with risk |
| [NIST SP 800-53 Rev. 5, SI-4(9)](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final) | Test monitoring tools at a set frequency, which is what a planted drill does |
| [OWASP Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html) | 8.1 catch secrets before a commit or pull request; 2.7.2 and 3.2 rotate them regularly. It sets no interval |
| [CWE-798](https://cwe.mitre.org/data/definitions/798.html) and [CWE-540](https://cwe.mitre.org/data/definitions/540.html) | Hard-coded credentials, and sensitive information in source code, as named weaknesses |
| [GitHub: storing secrets safely](https://docs.github.com/en/get-started/learning-to-code/storing-your-secrets-safely) and [removing sensitive data](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository) | An exposed secret counts as compromised, however briefly. Commits stay reachable through pull request refs after a force push |
| [GitHub: Dependabot alerts API](https://docs.github.com/en/rest/dependabot/alerts), [workflow permissions](https://docs.github.com/en/actions/writing-workflows/workflow-syntax-for-github-actions#permissions) | `vulnerability-alerts: read` lets the built-in token read alerts |
| [osv-scanner output](https://github.com/google/osv-scanner/blob/main/docs/output.md) | Exit 0 clean, 1 found, 127 error, 128 no packages. Its report lists only sources with findings |
| [gitleaks](https://github.com/gitleaks/gitleaks) | Which commits it reads, and what can blind it: `.gitleaks.toml`, `.gitleaksignore` and inline allow comments |
| The owner's key rule (2026-10-31) | Every key expires within 90 days |
| [AWS Security Hub, control IAM.3](https://docs.aws.amazon.com/securityhub/latest/userguide/iam-controls.html) | Access keys rotated within 90 days: the public control behind the same 90-day goal |

## Tools

First-pass licence review for CI-only use. No practice profile exists for `ip-legal:oss-review`, and its interview would need
the owner, so the terms were read directly. Each tool runs as a separate process and none ships with the product.

| Tool | Licence, from the text | Decision |
|---|---|---|
| gitleaks 8.30.1 | MIT | Already in use. Reused through `.github/scripts/secret-scan.sh` |
| osv-scanner 2.7.0 | Apache-2.0 | Adopted |
| OpenSSF Scorecard 5.6.0 | Apache-2.0 | Adopted, command line only |
| Semgrep 1.182.1 engine, in its container | LGPL-2.1 | Adopted. Not linked and not distributed, so nothing is triggered |
| Semgrep rules, pinned commit | Semgrep Rules License v1.0, not an open source licence | Adopted for internal use, which it allows. Guards: downloaded at run time, never committed or shipped, never offered to customers, only counts reach the site. The Opengrep fork is no alternative: archived, and under Commons Clause |

## Ideal state

No known weakness stays open, and secrets and case data can't get in.

## Metrics

A reading must prove its scan happened, or it writes `missing`. Floors of 4, 8 and 42 are the first day's readings, so the score shows progress from
there. Lanes are in `lanes.json`: `gate` daily on the free minutes, `keys` daily, and `scan` nightly because `scan.sh` took 6 minutes (6 Nov 2026). One Semgrep pass now covers the repository and its planted drill, and Semgrep's download runs behind the quicker scans, which should bring it to about 4.5. `scan` and `keys` stay on GitHub's own runners, because the free ones can't read alerts or admin read-outs.

| Metric | Why it serves the ideal state | Source | Floor | Goal, and what it rests on | Weight |
|---|---|---|---|---|---|
| `alerts_critical_high_open` | A known serious weakness left open | Dependabot alerts API. Closed only if fixed, or dismissed as `inaccurate` or `not_used` with a real comment | 4 | 0: the ideal state, and OpenSSF's rule | 5 |
| `alerts_medium_low_open` | The same, lower severity | The same | 4 | 0: the same | 2 |
| `osv_vulnerabilities_open` | A second database over every lockfile. Its log must name each tracked lockfile, because its report lists only those with findings | `osv-scanner` | 8 | 0: the same | 3 |
| `sast_findings_open` | Weaknesses in our own code | Semgrep, pinned engine and rules, no network, inline suppressions off. Every security finding in shipped code, less those judged in `triage.json`, plus any judgment whose finding has gone | 42 | 0: NIST SSDF PW.7 and RV.2 | 3 |
| `scorecard_checks_at_goal` | Practices that keep weaknesses out, by name, because Scorecard's own docs warn off the aggregate | Scorecard command line, on the commit checked out. The share of held checks in `scorecard-checks.json` at goal. An inconclusive one makes the reading `missing` | 0 | 100: each check's top score of 10 | 3 |
| `secrets_in_history` | Zero tolerance. An exposed secret counts as compromised, however briefly | The secret scan CI gates on, over every ref and pull request head. Must reach every commit with text to read | 1 | 0: CWE-798 and GitHub's guidance | 5 |
| `forbidden_paths_in_history` | Zero tolerance. Case data, a room's settings and credential files can't enter by path | Every path any commit ever added, quoting off and any case, against `forbidden-paths.json` | 1 | 0: CWE-540, and CWE-798 for credential files | 5 |
| `case_paths_ignored` | Zero tolerance. `.gitignore` still covers each of those paths, so a weakened file shows the day it changes | `git check-ignore --no-index` on 35 sample paths | 0 | 1: CWE-540. Stopping the file at the source is the cheapest way to stop it entering | 2 |
| `secret_scan_gate_coverage` | The gate really ran on what landed | CI job records: each of the newest 50 commits on `main`, scanned by its own run or its pull request's. At least 20 must have an answer | 90 | 100: OWASP 8.1, which wants secrets caught before a commit or pull request lands | 3 |
| `key_age_max_days` | A long-lived key is a weakness left open | Admin read-outs of stored keys: when each was last set, from a read made in the last 30 hours. Values are never readable | 180 | 90: the owner's key rule. OWASP asks for regular rotation and sets no interval | 2 |
| `scanner_drills_passing` | Zero tolerance. Proves the zeros above mean something: a planted secret, two forbidden paths (one with a name git would quote), a vulnerable lockfile and a code flaw must all be found, with the same flags, on every scan | `scan.sh` drills in a temporary folder | 0 | 1: NIST SI-4(9), at a frequency of every scan | 3 |
| `time_to_fix_critical_high_hours` | How long a serious weakness stays open | p90 of alerts open now or closed in the last 30 days, from when it was public or the alert was raised, whichever came first. A still-open alert counts at its age so far. A rolling 30 days shows how fixes are going now: a fast fix is forgotten sooner, and one still open never leaves | 336 | 72: our mapping onto BOD 26-04's 3 and 14 day tiers, since GitHub doesn't report the inputs its table uses | 3 |
| `time_to_fix_medium_low_hours` | The same, lower severity | The same | 1440 | 336: our mapping onto BOD 26-04's 14 days. The floor is its 60 days, which is also OpenSSF's limit | 2 |
| `scan_minutes` | Consumption: the runner time the scans cost every night | Minutes `scan.sh` took on the lane, rounded up as a runner bills a job. A scan that didn't finish reads `missing` | 10 | 5: half the ten-minute build Fowler names, as Git Crafter's scan budget sets it | 1 |

Both time-to-fix metrics read `no_events` when nothing is in the window, which scores 100 only while `scanner_drills_passing` holds. The mapping is coarse: a medium flaw on CISA's exploited list would be 3 days there and gets 14 here, because these metrics read severity only.

**How a clean reading is proven.** All three scans read `missing` if a file in the repository could blind them: `.gitleaks.toml`, `.gitleaksignore`, `.semgrepignore`, `osv-scanner.toml`, or a `.gitattributes` line hiding text as binary, beyond the two generated files and the Rive binaries already marked. The drills run in empty folders and couldn't notice these, so this check is separate. Inline comments can't excuse anything: Semgrep runs with `--disable-nosem`, the secret scan with `--ignore-gitleaks-allow`, and the planted secret carries such a comment and must still be found. A shallow checkout or a failed fetch of pull request heads makes both history metrics `missing`. If `osv-scanner` reports an advisory with no open Dependabot alert, both alert counts and both time-to-fix metrics read `missing`, because Dependabot has gone quiet. An unreadable date on any alert in the window makes that time-to-fix metric `missing`.

**Seeds dropped or changed.** "Open alerts by severity" became two metrics, since fixing urgency differs. The Scorecard aggregate is replaced by named checks. Of its 18, 11 aren't held, each with its reason in `scorecard-checks.json`, and all stay visible in a table.

**What guards the lists.** `triage.json`, `forbidden-paths.json`, `scorecard-checks.json` and the rule folders in `scan.sh` could lift a score just by shrinking, and the goal check reads only `manifest.json`. `config.test.ts` pins them, with exact pattern strings and with comments stripped before it looks for a flag, and `REVIEW.md` rule 4 blocks weakening a test. Tests can't judge a new reason in `triage.json`, so `REVIEW.md` rule 7 also counts these files once the page is signed off.

**What this can't measure.**
- **Case words.** The patterns stay in the clone's `.git/info` and may never reach CI, so only paths are scored. The local hook covered the whole history once by hand (see Baseline).
- **Dependabot itself can't be drilled,** because an alert needs a real vulnerable package on `main`. The comparison with `osv-scanner` is what catches it going quiet, and only while `osv-scanner` has something to report.
- **Four metrics move together on a dependency advisory:** both alert counts, OSV, and Scorecard's Vulnerabilities. They are separate detectors, so the overlap is deliberate, and it means dependencies weigh more than code on this page.

## The audit behind the one unscored rule

Semgrep's `html-in-template-string` fires on every HTML template, so it says nothing about any one of them. It is the only rule named as unscored, and its counts stay in a table. Every other finding in shipped code must be judged line by line. Its limit is the hits the latest audit read (171 on 2026-11-02, 268 on 2026-11-19), in non-test code outside `quality-speed/`, and any other count reads as open until someone reads the difference. The site's own templates under `quality-speed/` are left out of that limit. The site is public since 2026-11-17, so the first reason for that (members only) ended; the 2026-11-19 audit read its page code instead: each value drawn is a constant, a number, or text escaped by the chart kit's `esc()`, each page carries a strict Content-Security-Policy, and the publish guard refuses markup and links outside its allow-lists. The Process page is drawn by an outside action (Git Crafter `actions/pages`, pinned in `quality-speed.yml`), and a separate read-only audit the same day read it at its pin: it draws only the committed process maps and validated lane numbers, escapes text with its own `esc()`, and its workflow never runs on a pull request, so no outsider text reaches it. It carries no Content-Security-Policy; re-read it when the pin moves or its `tabs` widen. To earn the first limit, two independent read-only audits on 2026-11-02 traced each interpolated value to its escaping:

- **First:** all non-test files in `web/mcp/pages/`, `web/worker/routes/rooms.ts`, `web/worker/email-signature.ts`, `web/worker/public.ts`, and the three patterns built from variables in code a remote user can reach. No exploitable injection. Key claims were re-read against the code.
- **Second:** `web/mcp/pro.ts`, `web/scripts/matter/report.ts`, `web/scripts/dev-pdf.ts`, `web/scripts/mcp-testkit.ts` and the other non-test files holding an HTML template. No exploitable injection.
- **Not read in full:** `web/mcp/format.ts`, `web/mcp/tools/search-law.ts` and `web/worker/files-http.ts` (matched lines only, and none builds HTML from outside values), and the `visualtheme-*` helpers. Nothing was run in a browser.

## Chart per metric

| Metric | Chart |
|---|---|
| Both alert counts, OSV, Semgrep and Scorecard | Bullets against goal |
| Both time to fix | Bullets running from floor to goal, in hours |
| `key_age_max_days` | Meter against 90 days |
| `scanner_drills_passing` | Four pass marks, one per planted problem |
| The history and gate metrics | The infographic's bands |
| Everything | Tables behind a disclosure: every metric, every Scorecard check, every Semgrep rule by count |
| The page | **Infographic:** a shield of 8 nested bands, one per layer: solid when proven at goal, outlined when part of the way there, and dashed red at 0. Road to 100 below it |

## Baseline

Taken on 2026-11-02 at 04:40Z, before anything was fixed: `main` at `1f688d5` for the scanners, `ededebb` for Scorecard. `scan.sh` ran in a throwaway job with these same scopes, because the daily workflow hadn't landed. The first version of this page read 70. The independent review rejected its rules, and the numbers below are those same scans read under the corrected rules.

| Metric | Baseline | Score |
|---|---|---|
| `alerts_critical_high_open` | 4 | 0 |
| `alerts_medium_low_open` | 4 | 0 |
| `osv_vulnerabilities_open` | 8, the same 8 Dependabot reports | 0 |
| `sast_findings_open` | 42, across 39 rule and path pairs, reading 1,082 code files against 1,080 tracked at that commit | 0 |
| `scorecard_checks_at_goal` | 71.4, 5 of 7 held. Aggregate 5.2 of 10 | 71.4 |
| `secrets_in_history` | 0, across all 119 commits and 43 pull request heads | 100 |
| `forbidden_paths_in_history` | 0 | 100 |
| `case_paths_ignored` | 0, only 19 of 34: `.gitignore` missed credential files | 0, **gate failing** |
| `secret_scan_gate_coverage` | 100, 38 of 38. 2 commits had no scan of their own because a burst of merges cancelled the run; both passed their pull request's | 100 |
| `key_age_max_days` | `missing` until the admin job exists. 1 day, read by hand | 0 |
| `scanner_drills_passing` | 1, the 4 then planted | 100 |
| `time_to_fix_critical_high_hours` | 222.4, still open, from the advisory's date. The alert itself was 9 hours old | 43 |
| `time_to_fix_medium_low_hours` | 222.5, still open | 100 |

**Total: 38.** Quality 50.4, Speed 65.8, Consumption 0 (no consumption metric yet), held to at most 59 by a failing gate.

Also on that day, by hand on this Mac because the patterns may never leave it: the local case-pattern hook over `main` and every pull request head, 107 commits and 325,699 diff lines, found 0 hits. A one-off, so it isn't a metric.

## Fixes

Ranked by total points gained, from the baseline's 55.

| Fix | Gains | State |
|---|---|---|
| Bump `wrangler`, which clears all 8 alerts and Scorecard's Vulnerabilities | +19.3 | #75, merged |
| Judge the Semgrep findings line by line, and fix the ones that were real: `robots.txt` matching, the closing-line pattern and the confinement job's installer, which also takes Pinned-Dependencies to 10 | +5.6 | #84, and #153 and #179 inside #316, all merged, and this page |
| Credential files in `.gitignore`, which also clears the failing gate | +3.7 | #153 inside #316, and #321, all merged |
| Key age: `Secrets: read` on the metrics key, and the admin read-outs | +3.7 | Asked of the orchestrator |
| A reporting link in `SECURITY.md`, which had none | +0.8 | #271, merged |
| Time to fix critical and high | +11.5 | Time only. These alerts took 9 days from the advisory, and count until 2026-12-02 |

Also fixed, not scored: the sanitizer tested a link before removing what a browser drops, so a tab could hide a link to another site (#153, inside #316).

Looked at and left alone, with the reason:

- **Build-time room settings reach some MCP pages unescaped** (`web/mcp/pages/html.ts`, `legal.ts`). Changing one takes build access, which can already ship code, so nothing is exploitable. They are bare constants on purpose, so a page that doesn't use one doesn't carry it, and wrapping them would work against that.
- **A burst of merges could cancel a pending CI run on `main`.** Both commits it touched passed their pull request's scan, and the nightly scan reads the whole history. Fixed since (#242, #235): each push to `main` has its own concurrency group.

| Accepted risk | Why it stands | Read again when |
|---|---|---|
| A lane's job uploads an artifact under another lane's name, or a process outliving a lane replaces the pages artifact before `deploy` (#373) | `core/merge.ts` reads a lane's records only from the artifact named for it. Only `main` publishes, so every lane behind the site runs reviewed code, on GitHub-hosted runners that start fresh for each job | `BLACKSMITH_ALLOWED` turns on: `core/merge.test.ts` then fails |

One open finding is reported to the orchestrator and not written here, because `SECURITY.md` says an unfixed weakness goes directly to the administrators, never in an issue, pull request or commit.

## Sign-off

**First review, 2026-11-02: rejected,** with 20 required changes. It ran its cases against this code rather than reading the plan's claims. The most serious: git quotes non-ASCII paths, so a forbidden file with an accented name passed; a config file in the repository could blind every scanner while the drills stayed green; a dismissal comment of one character closed an alert; and the clock started when the alert was raised, reading 9 hours for an advisory public for 9 days. All are fixed above and pinned by tests.

**Second review, 2026-11-02: signed off with 9 changes.** The list and its goals stood, and nearly all of the first review's fixes held when it ran them again. The changes: a count that could have left a gate `missing` for good, an inline comment that could read three metrics `missing`, one reason covering a copied line, tests that missed a narrowed pattern or a removed flag, no limit on the unscored rule, a false reason for the private eval set, and each environment's keys being required. It kept the 30-day window, and said the score was the wrong reason for choosing it, so the reason above is the real one. One choice here differs from what it asked: it suggested a limit of 257 hits across everything, and this page counts 171 outside `quality-speed/` instead, with the reason above.

**Third review, 2026-11-02: signed off, once `lane.ts` was named in rule 7.** It judged the limit of 171 fair, tighter than the 257 it had suggested, and noted that the private-site reason ends if the repository goes public. Its test of `lane.ts` found that breaking its error handling passed every test, so `lane.test.ts` now covers it.

Each guard in `readings.ts` and `lane.ts` was also broken on purpose, to check a test catches it.

## Final

Not final yet. Read on 2026-11-02 from the collectors' last real run on a stack over `main`, before the first scheduled run.

| Metric | Reading | Score |
|---|---|---|
| `alerts_critical_high_open`, `alerts_medium_low_open` | 0 and 0 | 100 |
| `osv_vulnerabilities_open` | 0, across both lockfiles | 100 |
| `sast_findings_open` | 2 | 95.2 |
| `scorecard_checks_at_goal` | `missing` on a branch, because Scorecard reads `main` | 0 |
| `secrets_in_history`, `forbidden_paths_in_history` | 0 and 0, with every commit and pull request head read | 100 |
| `case_paths_ignored`, `scanner_drills_passing` | 1 and 1 | 100 |
| `secret_scan_gate_coverage` | 100, 47 of 47 | 100 |
| `key_age_max_days` | `missing` until the admin job and its key exist | 0 |
| `time_to_fix_critical_high_hours` | 223.3 | 42.7 |
| `time_to_fix_medium_low_hours` | 223.3 | 100 |

**What stands between this and 100:**

- **Time:** both time-to-fix metrics carry the first alerts until 2026-12-02, and then read `no_events`.
- **`sast_findings_open`:** the audits read 171 hits of the HTML template rule, and any other count reads as open until someone reads the difference. A later merge took it to 173. Both are terminal messages in `web/scripts/pii-scan.ts` holding the text `<sha256>`, read and safe, and the number goes up in its own reviewed change. Expect about 4 next, not the 2 in the table: a rough count since that run finds 2 more hits, in `web/scripts/room.ts` and `web/worker/routes/rooms.ts`, and `web/scripts/extract-windows.ts` now imports `child_process`, which may add a finding of its own. This line and the table are updated after the first real run.
- **`sast_findings_open`, 2026-11-19:** the count had grown to 268 as the product grew, so 97 read as open. Three read-only audits read all 268 (134 in `web/mcp`, 60 in `web/worker` and `web/src`, 74 in `web/scripts`) and traced each value: 0 reach a page raw. Seven leaned on a check made elsewhere (a date format held at sync, counts that are numbers by type, a build-time name) and now escape where they land: `web/worker/routes/rooms.ts`, `web/worker/room.ts`, `web/scripts/matter/report.ts`. Room settings fixed at build stay unescaped in `web/mcp/pages`: `web/scripts/config.ts` stops a build whose setting holds `<`, `>` or `"`. The limit is now 268, and the scan prints each counted hit when the count moves (#79).
- **`scorecard_checks_at_goal`:** its first real value comes with the first scheduled run on `main`. Security-Policy, Pinned-Dependencies and Vulnerabilities should all read 10 by then, and the score depends on that.
- **`key_age_max_days`:** needs the owner's metrics key.
- **Detail:** the Scorecard and Semgrep tables fill from the first scan lane on `main`. `core/merge.ts` carries each lane's detail. A Semgrep rule's id longer than a detail id allows would drop the whole file, so rule names are cut to fit.

**What a good reading doesn't prove:**

- **`secrets_in_history`:** until #368 merges, the secret scan skips what only a merge commit adds, a `*.riv` file that holds text and a file with a NUL byte.
- **`sast_findings_open`:** the audited rule's limit is only a count, so a pull request that swaps one audited template for a new one moves nothing. Review has to catch that.
- **`key_age_max_days`:** it reads when each key was last set, so saving a key again resets its age without rotating it.

