#!/usr/bin/env python3
"""Whether `office-mac` and `sync-windows` already passed on this pull request, on the files this run would test.

macOS minutes cost about 10x Linux minutes, and a later push to a pull request often leaves those jobs' files as they
were. So on a pull request that changes either area, `checks` runs this, and ci.yml skips a job it reports as passed
(`ci-ok` accepts a skipped job).

Nothing a run writes counts: not a cache, an artifact, a log, a job name or an output, because any workflow in the pull
request can write those, and a later commit can delete that workflow. Only what GitHub records about a run (its
workflow file, event, head commit and each job's result) and the commits in git count. A job counts as passed when:

1. An earlier run of .github/workflows/ci.yml on this pull request has a successful job of that name.
2. That run tested the same inputs: the files `changed-paths.sh inputs office|sync` names, which are what the job's
   tests load (web/scripts/job-inputs.test.ts keeps that list whole), ci.yml, changed-paths.sh, this script,
   .gitattributes and web/package.json. ci.yml is among them, so the earlier run's job had the same steps as this one.
   The key is a hash of each input's mode, blob and path. An input that is a symlink has no key: its blob is the
   target's name, not the target's contents, so a changed target would read as unchanged (#434). Its job runs.
3. A pull request run tests GitHub's merge of its head into the base, and GitHub records only the head. So this run's
   key is its own merge's, and an earlier run counts only when its head has that key and no base commit the head lacks
   changes an input. Then any merge of that head into the base had the head's inputs.
4. Every run on this branch was a run of this pull request into this base: no other pull request ever had this branch
   as its head, and this one's base never changed. Otherwise an earlier run could have merged into another branch.

Anything it cannot read or check counts as not passed, so the job runs. It needs the checkout's full history (trees,
no file contents). Environment: GH_TOKEN, GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_OUTPUT, PR_NUMBER, PR_HEAD_SHA,
PR_HEAD_REF and PR_BASE_REF. Writes office= and sync= (true or false) to GITHUB_OUTPUT. Always exits 0.
"""

from __future__ import annotations

import hashlib
import os
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_minutes_guard import Api  # noqa: E402

SCRIPTS = Path(__file__).resolve().parent
WORKFLOW = ".github/workflows/ci.yml"
JOBS = {"office": "office-mac", "sync": "sync-windows"}
PAGE_SIZE = 100
# Job lists one pass may read, a few of GITHUB_TOKEN's API calls, shared with the build minutes guard.
JOB_READS = 10
# git reads only what the checkout fetched: a missing object is an error here, never a fetch.
GIT_ENV = {**os.environ, "GIT_NO_LAZY_FETCH": "1", "GIT_TERMINAL_PROMPT": "0"}


def git(cwd: str, *args: str) -> str:
    return subprocess.run(["git", *args], cwd=cwd, env=GIT_ENV, check=True, capture_output=True, text=True,
                          timeout=60).stdout


def inputs(area: str) -> re.Pattern:
    """The paths whose contents decide the job's result, from changed-paths.sh."""
    regex = subprocess.run(["bash", str(SCRIPTS / "changed-paths.sh"), "inputs", area], check=True,
                           capture_output=True, text=True, timeout=60).stdout.strip()
    return re.compile(f"(?:{regex})")


SYMLINK_MODE = "120000"


def key(cwd: str, pattern: re.Pattern, commit: str) -> str | None:
    """A hash of the mode, blob and path of each input in the commit's tree; None when an input is a symlink."""
    lines = []
    for entry in git(cwd, "ls-tree", "-r", "-z", "--full-tree", commit).split("\0"):
        if entry:
            meta, path = entry.split("\t", 1)
            mode, _kind, blob = meta.split(" ")
            if pattern.fullmatch(path):
                if mode == SYMLINK_MODE:
                    return None
                lines.append(f"{mode} {blob} {path}\n")
    return hashlib.sha256("".join(lines).encode()).hexdigest()


def base_changed(cwd: str, pattern: re.Pattern, head: str, bases: list[str]) -> bool:
    """True when a base commit that `head` lacks changes an input. Every commit, not only the net change: a merge
    taken between a change and its revert had the change."""
    out = git(cwd, "log", "-m", "--no-renames", "--format=", "--name-only", "-z", *bases, f"^{head}", "--")
    return any(pattern.fullmatch(path.strip("\n")) for path in out.split("\0") if path.strip("\n"))


def only_this_pull(api, repo: str, number: int, head_ref: str, base_ref: str) -> bool:
    """True when this pull request is the only one ever opened from this branch, and its base never changed."""
    owner = repo.split("/")[0]
    pulls = api.get(f"/repos/{repo}/pulls", {"head": f"{owner}:{head_ref}", "state": "all", "per_page": PAGE_SIZE})
    if [(pull["number"], pull["base"]["ref"]) for pull in pulls] != [(number, base_ref)]:
        return False
    events = api.get(f"/repos/{repo}/issues/{number}/events", {"per_page": PAGE_SIZE})
    return len(events) < PAGE_SIZE and not any(event.get("event") == "base_ref_changed" for event in events)


def passed(api, cwd: str, repo: str, run_id: int, number: int, head_sha: str, head_ref: str, base_ref: str,
           out=print) -> dict[str, bool]:
    """{area: whether its job already passed on this run's inputs}. Any failure raises; main() makes it all False."""
    result = {area: False for area in JOBS}
    if git(cwd, "rev-parse", "HEAD^2").strip() != head_sha:
        out("::notice title=Inputs passed::this checkout is not the merge of the pull request's head, so the jobs run")
        return result
    bases = [git(cwd, "rev-parse", "HEAD^1").strip(), f"refs/remotes/origin/{base_ref}"]
    git(cwd, "rev-parse", "--verify", bases[1])
    patterns = {area: inputs(area) for area in JOBS}
    keys = {area: key(cwd, patterns[area], "HEAD") for area in JOBS}
    if not only_this_pull(api, repo, number, head_ref, base_ref):
        out("::notice title=Inputs passed::another pull request used this branch, or this one's base changed, so "
            "the jobs run")
        return result
    runs = api.get(f"/repos/{repo}/actions/workflows/ci.yml/runs",
                   {"event": "pull_request", "branch": head_ref, "status": "completed", "per_page": PAGE_SIZE})
    reads = JOB_READS
    seen = {"earlier runs": 0, "heads not in this checkout": 0, "with an area's inputs unchanged": 0}
    for run in runs["workflow_runs"]:
        if all(result.values()) or reads == 0:
            break
        if run["id"] == run_id or run.get("path") != WORKFLOW or run.get("event") != "pull_request" or \
                (run.get("head_repository") or {}).get("full_name") != repo:
            continue
        seen["earlier runs"] += 1
        head = run["head_sha"]
        try:
            same = [area for area in JOBS if not result[area] and keys[area] is not None
                    and key(cwd, patterns[area], head) == keys[area]
                    and not base_changed(cwd, patterns[area], head, bases)]
        except subprocess.CalledProcessError:
            seen["heads not in this checkout"] += 1
            continue
        if not same:
            continue
        seen["with an area's inputs unchanged"] += 1
        reads -= 1
        data = api.get(f"/repos/{repo}/actions/runs/{run['id']}/jobs", {"filter": "all", "per_page": PAGE_SIZE})
        if data.get("total_count", 0) > len(data["jobs"]):
            continue
        for area in same:
            if any(job.get("name") == JOBS[area] and job.get("conclusion") == "success" for job in data["jobs"]):
                result[area] = True
                out(f"::notice title=Inputs passed::{JOBS[area]} passed in run {run['id']} on {head[:7]}, whose "
                    "inputs this run has unchanged, so it is skipped")
    out("Read " + ", ".join(f"{count} {what}" for what, count in seen.items()) + "; " +
        ", ".join(f"{JOBS[area]} {'skipped' if done else 'runs'}" for area, done in result.items()))
    return result


def main() -> int:
    env = os.environ
    try:
        result = passed(Api(env.get("GH_TOKEN", "")), ".", env["GITHUB_REPOSITORY"], int(env["GITHUB_RUN_ID"]),
                        int(env["PR_NUMBER"]), env["PR_HEAD_SHA"], env["PR_HEAD_REF"], env["PR_BASE_REF"])
    except Exception as exc:  # noqa: BLE001  (not proven passed means the jobs run)
        print(f"::warning title=Inputs passed::{type(exc).__name__}: {exc}; so the jobs run")
        result = {area: False for area in JOBS}
    with open(env["GITHUB_OUTPUT"], "a", encoding="utf-8") as handle:
        for area, value in result.items():
            handle.write(f"{area}={'true' if value else 'false'}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
