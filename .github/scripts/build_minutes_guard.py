#!/usr/bin/env python3
"""Build minutes guard: the runner for CI's Linux jobs, and whether main must run the Mac jobs again.

GitHub's docs give Colorado Startups $300 of GitHub-hosted compute a month, about 50,000 Linux or 4,800 macOS minutes,
so macOS costs about 10x. We may use all of it (the owner, 2026-11-06; CLAUDE.md). At the limit the organization's $0 Stop-usage budget
stops CI, and the required checks with it. Blacksmith gives the organization 3,000 minutes free but has no hard stop:
past them it bills, so this guard is its stop. The `choose-runner` job in quality-speed.yml runs it first on every run,
and in ci.yml on each push to main and manual run: while Blacksmith is off, a pull request skips it (ci.yml says why). It needs no token of its own: the job's GITHUB_TOKEN reads GitHub's job records, and an Actions cache keeps what was already read.
Only main saves that cache, and GitHub keeps each branch's cache apart, so a pull request reads main's count and cannot
change it.

Those free minutes are per organization, and the organization's other repository runs CI on them too, so each repository has a share: 1,800
here and 900 there, which is 2,700 together, 90 % of the 3,000. This guard holds this repository to its share. It can't
see or stop the other repository's minutes.

Each run it:

1. Adds up the Blacksmith minutes of this repository's counted workflows over the last 31 days, rolling, which covers any billing month whatever
   day Blacksmith's resets on. Each job counts rounded up to a whole minute and weighted as Blacksmith counts its free
   minutes (x64 2 vCPU = 1). A run still going counts at its worst case, the jobs' timeouts added up. A finished run
   past this pass's reads (a limit, so the GITHUB_TOKEN calls stay few) counts the most it could have used: its Blacksmith
   jobs all ran inside its own start and end, at most so many at once, each rounded up, and never past its worst case.
   quality-speed.yml's lanes run side by side, so its runs take the reads first. Listing stops at
   the first page with nothing new, so a re-run of a very old run can go uncounted; the 10 % the shares leave covers that.
2. Chooses Blacksmith under this repository's share and GitHub-hosted otherwise. Anything it cannot read means
   GitHub-hosted: unknown never means Blacksmith. It is not a check, so it never fails CI: if this script or its job dies,
   ci.yml falls back to GitHub-hosted too.
3. On a push to main, reports whether that push is exactly what CI already passed: `ci-ok` green on the pushed commit
   itself (the merge queue ran CI on the merge group, and main moves to that very commit), or on the merged pull
   request's head with the same tree. Then main's Mac jobs would only repeat it, at 10x, so they are skipped. A pull
   request merged while behind main, outside the queue, has a different tree, so its Mac jobs run on main.

The count covers COUNTED_WORKFLOWS in this repository, and no other workflow here uses Blacksmith. Any other Colorado
Startups repository that does shares the same free minutes, so it must have a share of them before it starts.

Off for now (BLACKSMITH_ALLOWED): Git Crafter rules/compute-detail.md says no job runs on Blacksmith until an org-wide meter
merges and its Apps exist (Colorado-Startups/.github#7, closed unmerged 2026-11-05), and a repository share like this one is
not that meter. The count still runs, so the stop is warm when it turns back on.

The CI_RUNNER repository variable is the off switch: a runner set there by hand wins, unless it names Blacksmith.

Environment: GH_TOKEN (the job's token), CI_RUNNER, and GitHub's own GITHUB_REPOSITORY, GITHUB_EVENT_NAME, GITHUB_REF,
GITHUB_SHA and GITHUB_OUTPUT. Writes runner= (JSON, for fromJSON in `runs-on`) and tested= to GITHUB_OUTPUT. Always
exits 0.
"""

from __future__ import annotations

import datetime as dt
import json
import math
import os
import re
import sys
import urllib.parse
import urllib.request

API = "https://api.github.com"
BLACKSMITH_RUNNER = "blacksmith-2vcpu-ubuntu-2404"
GITHUB_HOSTED = "ubuntu-latest"
# The only labels CI_RUNNER may set (hand_set_runner).
HAND_SET_RUNNERS = frozenset({"ubuntu-latest", "ubuntu-24.04", "ubuntu-22.04", "ubuntu-slim"})
# Blacksmith's free tier: 3,000 x64 2-vCPU minutes a month per organization; bigger runners count in proportion
# (docs.blacksmith.sh/blacksmith-runners/overview, read 2026-11-01).
BLACKSMITH_FREE_MINUTES = 3000
# This repository's share, 1,800. The other repository's is 900, so the two come to 2,700, 90 % of the free minutes.
STOP_MINUTES = BLACKSMITH_FREE_MINUTES * 60 // 100
WINDOW_DAYS = 31
# Git Crafter rules/compute-detail.md: no job on Blacksmith until the org-wide meter merges (the docstring says why). True
# again only with that meter, by a reviewed change, which also runs ci.yml's choose-runner on pull requests again
# (build_minutes_guard_test.py fails until it does). quality-speed/core/merge.test.ts fails too, until the accepted risk in
# quality-speed/pages/security/PLAN.md is read again (#373).
BLACKSMITH_ALLOWED = False
# The most one attempt of a CI run can use on Blacksmith: `checks` at its timeout in ci.yml. `ci-ok` runs on ubuntu-slim.
WORST_CASE_MINUTES = 20
# The most one Blacksmith lane of quality-speed.yml can use, at its timeout there, and the most lanes lanes.ts sends there.
LANE_WORST_CASE_MINUTES = 10
MAX_LANES = 30
# Every workflow here that can use Blacksmith: the most one job and one attempt of a run can use there, how many of its
# Blacksmith jobs can run at once, and how many it has. quality-speed.yml comes first, so its runs take the reads.
COUNTED_WORKFLOWS = {
    "quality-speed.yml": (LANE_WORST_CASE_MINUTES, MAX_LANES * LANE_WORST_CASE_MINUTES, MAX_LANES, MAX_LANES),
    # `checks` only: `ci-ok` runs on ubuntu-slim (#397).
    "ci.yml": (WORST_CASE_MINUTES, WORST_CASE_MINUTES, 1, 1),
}
# Job records one pass may read. A pull request's pass reads what is new since main last saved the ledger, usually 5 runs
# and at most 74 so far, so 30 reads plus each unread run's own time keep the count near the truth; main's pass can also
# rebuild a lost ledger over a few merges.
READS_PULL_REQUEST = 30
READS_MAIN = 300
PAGE_SIZE = 100
MAX_PAGES = 60
LABEL_RE = re.compile(r"blacksmith-(\d+)vcpu-ubuntu-\d+")
LEDGER_FILE = "build-minutes-ledger.json"


class Unreadable(Exception):
    """A reading the guard cannot trust. It never counts as under the limit."""


class Api:
    """The GitHub REST reads the guard makes. Tests pass a fake with the same method."""

    def __init__(self, token: str):
        self.token = token

    def get(self, path: str, params: dict | None = None):
        url = API + path + ("?" + urllib.parse.urlencode(params) if params else "")
        request = urllib.request.Request(url, headers={
            "Authorization": f"Bearer {self.token}", "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "legallas-build-minutes-guard"})
        try:
            with urllib.request.urlopen(request, timeout=15) as response:
                return json.load(response)
        except Exception as exc:  # noqa: BLE001  (any failed read is unknown, not a crash)
            raise Unreadable(f"GET {path} failed: {type(exc).__name__}: {exc}") from None


def parse_time(value: str) -> dt.datetime:
    return dt.datetime.fromisoformat(value.replace("Z", "+00:00"))


def weight(label: str) -> float:
    """Free minutes one minute on this runner uses (x64 2 vCPU = 1). Any other label is Unreadable: never a low guess."""
    match = LABEL_RE.fullmatch(label)
    if not match or int(match[1]) <= 0:
        raise Unreadable(f"unknown Blacksmith runner label {label!r}")
    return int(match[1]) / 2


def job_minutes(job: dict, job_worst_case: int = WORST_CASE_MINUTES) -> float:
    """Free minutes one job of a finished run used: 0 unless it got a Blacksmith runner."""
    labels = [str(label) for label in job.get("labels") or [] if str(label).startswith("blacksmith-")]
    if not labels or not job.get("runner_name") or not job.get("started_at"):
        return 0.0
    if not job.get("completed_at"):
        return float(job_worst_case)
    seconds = (parse_time(job["completed_at"]) - parse_time(job["started_at"])).total_seconds()
    return math.ceil(max(seconds, 1.0) / 60) * max(weight(label) for label in labels)


def load_ledger(path: str) -> dict:
    """{run id: {"updated": the run's updated_at, "day": UTC day, "minutes": n}} for finished runs. A missing or malformed
    ledger starts over: runs are read again, and the ones past the read limit count at their worst case."""
    try:
        with open(path, encoding="utf-8") as handle:
            runs = json.load(handle)["runs"]
        for entry in runs.values():
            dt.date.fromisoformat(entry["day"])
            if not isinstance(entry["updated"], str) or isinstance(entry["minutes"], bool):
                return {}
            if not 0 <= entry["minutes"] < math.inf:
                return {}
        return runs
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return {}


def save_ledger(path: str, ledger: dict) -> None:
    with open(path, "w", encoding="utf-8") as handle:
        json.dump({"runs": ledger}, handle, separators=(",", ":"))


def read_run(api, repo: str, run: dict, job_worst_case: int = WORST_CASE_MINUTES) -> dict:
    data = api.get(f"/repos/{repo}/actions/runs/{run['id']}/jobs", {"filter": "all", "per_page": PAGE_SIZE})
    if not isinstance(data.get("jobs"), list) or data.get("total_count", 0) > len(data["jobs"]):
        raise Unreadable(f"the jobs of run {run['id']} did not all arrive")
    return {"updated": run["updated_at"], "day": run["updated_at"][:10],
            "minutes": sum(job_minutes(job, job_worst_case) for job in data["jobs"])}


def finished_bound(run: dict, run_worst_case: int, at_once: int, jobs: int) -> float:
    """The most the latest attempt of a finished, unread run can have used: its Blacksmith jobs ran between its start and
    its last update, at most `at_once` together, and each rounds up by under a minute. No start time means the worst case."""
    try:
        seconds = (parse_time(run["updated_at"]) - parse_time(run["run_started_at"])).total_seconds()
    except (KeyError, TypeError, ValueError, AttributeError):
        return float(run_worst_case)
    return float(min(run_worst_case, math.ceil(max(seconds, 0.0) / 60) * at_once + jobs))


def count_minutes(api, repo: str, ledger: dict, now: dt.datetime, reads: int) -> float:
    """Blacksmith minutes in the window, finished runs read so far added to `ledger` as it goes."""
    oldest = now - dt.timedelta(days=WINDOW_DAYS)
    unread = 0.0
    for workflow, (job_worst_case, run_worst_case, at_once, jobs) in COUNTED_WORKFLOWS.items():
        for page in range(1, MAX_PAGES + 1):
            data = api.get(f"/repos/{repo}/actions/workflows/{workflow}/runs", {"per_page": PAGE_SIZE, "page": page})
            runs = data.get("workflow_runs")
            if not isinstance(runs, list):
                raise Unreadable(f"the {workflow} runs did not arrive")
            anything_new = False
            past_window = False
            for run in runs:
                if parse_time(run["created_at"]) < oldest:
                    past_window = True
                    break
                key = str(run["id"])
                if key in ledger and ledger[key]["updated"] == run["updated_at"]:
                    continue
                anything_new = True
                if run["status"] == "completed" and reads > 0:
                    reads -= 1
                    ledger[key] = read_run(api, repo, run, job_worst_case)
                else:
                    ledger.pop(key, None)
                    attempts = max(int(run.get("run_attempt") or 1), 1)
                    # Earlier attempts left no times in the listing, so each counts its worst case.
                    latest = finished_bound(run, run_worst_case, at_once, jobs) if run["status"] == "completed" else run_worst_case
                    unread += (attempts - 1) * run_worst_case + latest
            if past_window or not anything_new or len(runs) < PAGE_SIZE:
                break
        else:
            raise Unreadable(f"the {workflow} runs go past {MAX_PAGES} pages")
    for key in [key for key, entry in ledger.items() if dt.date.fromisoformat(entry["day"]) < oldest.date()]:
        del ledger[key]
    return sum(entry["minutes"] for entry in ledger.values()) + unread


def hand_set_runner(text: str) -> str | None:
    """CI_RUNNER as JSON, when it is one standard GitHub-hosted label; otherwise None.

    Git Crafter rules/compute.md lets a job read CI_RUNNER only through a validator that accepts standard GitHub-hosted
    labels, and this list matches the org's one definition, `runner()` in Colorado-Startups/.github
    cloud-test/cloud_test.py. Everything else is refused: self-hosted, larger runners (billed per minute past the
    included usage), macOS, arm, Blacksmith and any list of labels (#398).
    """
    try:
        value = json.loads(text)
    except ValueError:
        return None
    if not isinstance(value, str) or value not in HAND_SET_RUNNERS:
        return None
    return json.dumps(value)


def choose(minutes: float | None) -> tuple[str, str]:
    """(runner as JSON, why) from the count; None is unknown."""
    if minutes is None:
        return json.dumps(GITHUB_HOSTED), "Blacksmith's use is unknown, so GitHub-hosted"
    reading = f"Blacksmith: {minutes:.0f} of this repository's {STOP_MINUTES} minutes in the last {WINDOW_DAYS} days"
    if minutes >= STOP_MINUTES:
        return json.dumps(GITHUB_HOSTED), f"{reading}, at its stop, so GitHub-hosted"
    return json.dumps(BLACKSMITH_RUNNER), f"{reading}, under its stop, so Blacksmith"


def ci_ok_passed(api, repo: str, sha: str) -> bool:
    """True when a `ci-ok` check run on this commit succeeded."""
    checks = api.get(f"/repos/{repo}/commits/{sha}/check-runs", {"check_name": "ci-ok", "per_page": PAGE_SIZE})
    return any(check.get("conclusion") == "success" for check in checks["check_runs"])


def already_tested(api, repo: str, sha: str) -> bool:
    """True when `ci-ok` already passed on this commit (the merge queue's run on its group, which main moved to), or this
    push to main has the tree of the merged pull request's head and `ci-ok` passed on that head."""
    try:
        if ci_ok_passed(api, repo, sha):
            return True
        pulls = [pull for pull in api.get(f"/repos/{repo}/commits/{sha}/pulls")
                 if pull.get("merged_at") and pull["base"]["ref"] == "main" and pull.get("merge_commit_sha") == sha]
        if len(pulls) != 1:
            return False
        head = pulls[0]["head"]["sha"]
        if api.get(f"/repos/{repo}/git/commits/{sha}")["tree"]["sha"] != \
                api.get(f"/repos/{repo}/git/commits/{head}")["tree"]["sha"]:
            return False
        return ci_ok_passed(api, repo, head)
    except Exception:  # noqa: BLE001  (not proven tested means the Mac jobs run)
        return False


def run(api, repo: str, event: str, ref: str, sha: str, by_hand: str, ledger_path: str, now: dt.datetime,
        out=print) -> tuple[str, bool]:
    """One pass: (runner as JSON, whether this push's Mac jobs already passed). What it cannot read means GitHub-hosted
    and the Mac jobs running."""
    ledger = load_ledger(ledger_path)
    minutes = None
    try:
        minutes = count_minutes(api, repo, ledger, now, READS_MAIN if ref == "refs/heads/main" else READS_PULL_REQUEST)
    except Exception as exc:  # noqa: BLE001
        out(f"::warning title=Build minutes guard::counting Blacksmith's minutes failed: {exc}")
    runner, why = choose(minutes)
    if not BLACKSMITH_ALLOWED and runner == json.dumps(BLACKSMITH_RUNNER):
        runner, why = json.dumps(GITHUB_HOSTED), f"{why}; Blacksmith is off until the org-wide meter (Git Crafter compute-detail), so GitHub-hosted"
    if by_hand:
        chosen = hand_set_runner(by_hand)
        if chosen is None:
            out(f"::warning title=Build minutes guard::CI_RUNNER is {by_hand!r}, which is not one standard GitHub-hosted "
                "label, so it is ignored")
        else:
            runner, why = chosen, f"{why}; CI_RUNNER is {chosen}, set by hand, so that"
    out(f"::notice title=Build minutes guard::{why}")
    tested = event == "push" and already_tested(api, repo, sha)
    if tested:
        out("::notice title=Build minutes guard::this push is what CI passed on the pull request; Mac jobs skipped")
    try:
        save_ledger(ledger_path, ledger)
    except OSError as exc:
        out(f"::warning title=Build minutes guard::saving the ledger failed: {exc}")
    return runner, tested


def main() -> int:
    env = os.environ
    try:
        runner, tested = run(Api(env.get("GH_TOKEN", "")), env.get("GITHUB_REPOSITORY", ""),
                             env.get("GITHUB_EVENT_NAME", ""), env.get("GITHUB_REF", ""), env.get("GITHUB_SHA", ""),
                             env.get("CI_RUNNER", ""), LEDGER_FILE, dt.datetime.now(dt.timezone.utc))
    except Exception as exc:  # noqa: BLE001
        print(f"::warning title=Build minutes guard::{type(exc).__name__}: {exc}; so GitHub-hosted")
        runner, tested = json.dumps(GITHUB_HOSTED), False
    with open(env["GITHUB_OUTPUT"], "a", encoding="utf-8") as handle:
        handle.write(f"runner={runner}\ntested={'true' if tested else 'false'}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
