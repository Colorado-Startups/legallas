#!/usr/bin/env python3
"""Tests for inputs_passed.py, offline: a fake GitHub API and a throwaway git repository. Run with
`python3 .github/scripts/inputs_passed_test.py` (`checks` in ci.yml runs them when anything under .github/ changes)."""

from __future__ import annotations

import os
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import inputs_passed as p  # noqa: E402
from build_minutes_guard import Unreadable  # noqa: E402

REPO = "owner/name"
NUMBER = 7
BRANCH = "claude/work"
RUN_ID = 900
OFFICE = "web/scripts/office.ts"
SYNC = "web/scripts/sync.ts"
# No one's git config: no signing, no hooks, a fixed name.
GIT_ENV = {**os.environ, "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1",
           "GIT_AUTHOR_NAME": "Test", "GIT_AUTHOR_EMAIL": "test@example.invalid",
           "GIT_COMMITTER_NAME": "Test", "GIT_COMMITTER_EMAIL": "test@example.invalid"}


class Repo:
    """main, a pull request branch off it, and this run's checkout: HEAD is the merge of the branch into main."""

    def __init__(self, root: str):
        self.root = root
        self.git("init", "-q", "-b", "main")
        for path, text in {OFFICE: "office 1", SYNC: "sync 1", "README.md": "readme 1",
                           ".github/workflows/ci.yml": "ci 1"}.items():
            self.write(path, text)
        self.base = self.commit("main")
        self.git("checkout", "-q", "-b", BRANCH)

    def git(self, *args: str) -> str:
        return subprocess.run(["git", *args], cwd=self.root, env=GIT_ENV, check=True, capture_output=True,
                              text=True).stdout.strip()

    def write(self, path: str, text: str) -> None:
        file = Path(self.root, path)
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(text)

    def commit(self, message: str, **files: str) -> str:
        for path, text in files.items():
            self.write(path, text)
        self.git("add", "-A")
        self.git("commit", "-q", "--allow-empty", "-m", message)
        return self.git("rev-parse", "HEAD")

    def on_main(self, message: str, **files: str) -> str:
        branch = self.git("rev-parse", "--abbrev-ref", "HEAD")
        self.git("checkout", "-q", "main")
        sha = self.commit(message, **files)
        self.git("checkout", "-q", branch)
        return sha

    def checkout_merge(self) -> str:
        """The run's checkout: GitHub's merge of the branch head into main, with origin/main as fetched."""
        head = self.git("rev-parse", BRANCH)
        self.git("update-ref", "refs/remotes/origin/main", self.git("rev-parse", "main"))
        self.git("checkout", "-q", "--detach", "main")
        self.git("merge", "-q", "--no-ff", "--no-edit", head)
        return head


def run(run_id: int, head: str, **extra) -> dict:
    return {"id": run_id, "head_sha": head, "path": p.WORKFLOW, "event": "pull_request",
            "head_repository": {"full_name": REPO}, **extra}


def jobs(**results: str) -> dict:
    listed = [{"name": name, "conclusion": conclusion} for name, conclusion in results.items()]
    return {"total_count": len(listed), "jobs": listed}


class FakeApi:
    def __init__(self, runs: list[dict], jobs_by_run: dict[int, dict], pulls: list[dict] | None = None,
                 events: list[dict] | None = None):
        self.runs, self.jobs_by_run = runs, jobs_by_run
        self.pulls = pulls if pulls is not None else [{"number": NUMBER, "base": {"ref": "main"}}]
        self.events = events or []
        self.job_reads = 0

    def get(self, path: str, params: dict | None = None):
        if path == f"/repos/{REPO}/pulls":
            assert params["head"] == f"owner:{BRANCH}" and params["state"] == "all"
            return self.pulls
        if path == f"/repos/{REPO}/issues/{NUMBER}/events":
            return self.events
        if path == f"/repos/{REPO}/actions/workflows/ci.yml/runs":
            assert params["branch"] == BRANCH and params["event"] == "pull_request"
            return {"workflow_runs": self.runs}
        if path.endswith("/jobs"):
            self.job_reads += 1
            return self.jobs_by_run[int(path.split("/")[-2])]
        raise Unreadable(f"GET {path}")


# Each job's inputs in the throwaway repository: one file of its own and the workflow. README.md is no one's.
INPUTS = {"office": re.compile(f"(?:{OFFICE}|\\.github/workflows/ci\\.yml)"),
          "sync": re.compile(f"(?:{SYNC}|\\.github/workflows/ci\\.yml)")}
# changed-paths.sh's own, which setUp swaps for INPUTS.
REAL_INPUTS = p.inputs


class InputsPassedTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = Repo(self.tmp.name)
        patcher = mock.patch.object(p, "inputs", lambda area: INPUTS[area])
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(self.tmp.cleanup)

    def passed(self, api, head: str) -> dict[str, bool]:
        return p.passed(api, self.repo.root, REPO, RUN_ID, NUMBER, head, BRANCH, "main", out=lambda _line: None)

    def test_a_push_that_leaves_the_inputs_alone_skips_both_jobs(self):
        first = self.repo.commit("first", **{OFFICE: "office 2"})
        self.repo.commit("docs", **{"README.md": "readme 2"})
        head = self.repo.checkout_merge()
        api = FakeApi([run(1, first)], {1: jobs(**{"office-mac": "success", "sync-windows": "success"})})
        self.assertEqual(self.passed(api, head), {"office": True, "sync": True})

    def test_a_symlinked_input_runs_its_job_even_with_the_link_unchanged(self):
        # The link's blob is the target's name, so a changed target leaves the key alone. Two commits: the input
        # becomes a link, then the target changes; the earlier run saw the same link.
        self.repo.commit("target", **{"web/target.ts": "target 1"})
        Path(self.repo.root, OFFICE).unlink()
        os.symlink("../target.ts", Path(self.repo.root, OFFICE))
        first = self.repo.commit("link")
        self.repo.commit("target changes", **{"web/target.ts": "target 2"})
        head = self.repo.checkout_merge()
        api = FakeApi([run(1, first)], {1: jobs(**{"office-mac": "success", "sync-windows": "success"})})
        self.assertIsNone(p.key(self.repo.root, INPUTS["office"], "HEAD"))
        self.assertEqual(self.passed(api, head), {"office": False, "sync": True})

    def test_a_changed_input_runs_that_job_only(self):
        first = self.repo.commit("first")
        self.repo.commit("office", **{OFFICE: "office 2"})
        head = self.repo.checkout_merge()
        api = FakeApi([run(1, first)], {1: jobs(**{"office-mac": "success", "sync-windows": "success"})})
        self.assertEqual(self.passed(api, head), {"office": False, "sync": True})

    def test_a_changed_workflow_runs_both(self):
        first = self.repo.commit("first")
        self.repo.commit("ci", **{".github/workflows/ci.yml": "ci 2"})
        head = self.repo.checkout_merge()
        api = FakeApi([run(1, first)], {1: jobs(**{"office-mac": "success", "sync-windows": "success"})})
        self.assertEqual(self.passed(api, head), {"office": False, "sync": False})

    def test_only_a_successful_job_of_that_name_counts(self):
        first = self.repo.commit("first")
        head = self.repo.checkout_merge()
        for result in ("failure", "skipped", "cancelled", None):
            api = FakeApi([run(1, first)], {1: jobs(**{"office-mac": result, "office-mac-x": "success"})})
            self.assertEqual(self.passed(api, head), {"office": False, "sync": False}, result)

    def test_a_base_change_the_earlier_head_lacked_runs_the_job_even_if_reverted(self):
        first = self.repo.commit("first")
        # Main changed the office reader and changed it back: an earlier merge may have tested the change.
        self.repo.on_main("change", **{OFFICE: "office from main"})
        self.repo.on_main("revert", **{OFFICE: "office 1"})
        head = self.repo.checkout_merge()
        api = FakeApi([run(1, first)], {1: jobs(**{"office-mac": "success", "sync-windows": "success"})})
        self.assertEqual(self.passed(api, head), {"office": False, "sync": True})

    def test_a_base_change_the_earlier_head_already_had_is_fine(self):
        self.repo.on_main("change", **{OFFICE: "office from main"})
        self.repo.git("merge", "-q", "--no-edit", "main")
        first = self.repo.git("rev-parse", "HEAD")
        self.repo.commit("docs", **{"README.md": "readme 2"})
        head = self.repo.checkout_merge()
        api = FakeApi([run(1, first)], {1: jobs(**{"office-mac": "success"})})
        self.assertEqual(self.passed(api, head), {"office": True, "sync": False})

    def test_runs_of_another_workflow_another_event_a_fork_or_this_run_never_count(self):
        first = self.repo.commit("first")
        head = self.repo.checkout_merge()
        passing = jobs(**{"office-mac": "success", "sync-windows": "success"})
        others = [run(1, first, path=".github/workflows/plant.yml"), run(2, first, event="workflow_dispatch"),
                  run(3, first, head_repository={"full_name": "fork/name"}), run(RUN_ID, first)]
        api = FakeApi(others, {1: passing, 2: passing, 3: passing, RUN_ID: passing})
        self.assertEqual(self.passed(api, head), {"office": False, "sync": False})
        self.assertEqual(api.job_reads, 0)

    def test_another_pull_request_from_this_branch_or_a_changed_base_counts_nothing(self):
        first = self.repo.commit("first")
        head = self.repo.checkout_merge()
        passing = {1: jobs(**{"office-mac": "success", "sync-windows": "success"})}
        for pulls, events in (([{"number": NUMBER, "base": {"ref": "main"}}, {"number": 3, "base": {"ref": "x"}}], []),
                              ([{"number": NUMBER, "base": {"ref": "other"}}], []),
                              ([{"number": NUMBER, "base": {"ref": "main"}}], [{"event": "base_ref_changed"}])):
            api = FakeApi([run(1, first)], passing, pulls=pulls, events=events)
            self.assertEqual(self.passed(api, head), {"office": False, "sync": False}, (pulls, events))

    def test_a_checkout_that_is_not_this_heads_merge_counts_nothing(self):
        first = self.repo.commit("first")
        self.repo.checkout_merge()
        api = FakeApi([run(1, first)], {1: jobs(**{"office-mac": "success", "sync-windows": "success"})})
        self.assertEqual(self.passed(api, "0" * 40), {"office": False, "sync": False})

    def test_a_head_this_checkout_lacks_is_passed_over(self):
        first = self.repo.commit("first")
        head = self.repo.checkout_merge()
        api = FakeApi([run(1, "1" * 40), run(2, first)], {2: jobs(**{"office-mac": "success"})})
        self.assertEqual(self.passed(api, head), {"office": True, "sync": False})

    def test_job_reads_stop_at_the_limit(self):
        first = self.repo.commit("first")
        head = self.repo.checkout_merge()
        runs = [run(i, first) for i in range(1, p.JOB_READS + 3)]
        api = FakeApi(runs, {i: jobs(**{"office-mac": "skipped"}) for i in range(1, p.JOB_READS + 3)})
        self.assertEqual(self.passed(api, head), {"office": False, "sync": False})
        self.assertEqual(api.job_reads, p.JOB_READS)

    def test_main_writes_false_for_both_on_any_failure(self):
        out = Path(self.tmp.name, "output")
        env = {"GITHUB_OUTPUT": str(out), "GITHUB_REPOSITORY": REPO, "GITHUB_RUN_ID": "1", "PR_NUMBER": "7",
               "PR_HEAD_SHA": "0" * 40, "PR_HEAD_REF": BRANCH, "PR_BASE_REF": "main"}
        with mock.patch.dict(os.environ, env, clear=True), mock.patch.object(p, "passed", side_effect=Unreadable("x")):
            self.assertEqual(p.main(), 0)
        self.assertEqual(out.read_text(), "office=false\nsync=false\n")

    def test_changed_paths_names_each_jobs_list_and_what_runs_it(self):
        for area, listed in (("office", "web/scripts/office-read.ts"), ("sync", "web/migrations/0001_init.sql")):
            pattern = REAL_INPUTS(area)
            for path in (listed, ".github/workflows/ci.yml", ".github/scripts/changed-paths.sh",
                         ".github/scripts/inputs_passed.py", ".gitattributes", "web/package.json"):
                self.assertTrue(pattern.fullmatch(path), (area, path))
            self.assertFalse(pattern.fullmatch("README.md"), area)


if __name__ == "__main__":
    unittest.main()
