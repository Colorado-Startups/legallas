#!/usr/bin/env python3
"""Tests for build_minutes_guard.py, offline: a fake GitHub API stands in for the network. Run with
`python3 .github/scripts/build_minutes_guard_test.py` (`checks` in ci.yml runs them when anything under .github/ changes)."""

from __future__ import annotations

import datetime as dt
import json
import os
import re
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_minutes_guard as g  # noqa: E402

NOW = dt.datetime(2026, 11, 20, 12, 0, tzinfo=dt.timezone.utc)
REPO = "owner/name"
BLACKSMITH = json.dumps(g.BLACKSMITH_RUNNER)
HOSTED = json.dumps(g.GITHUB_HOSTED)
UPDATED = "2026-11-20T10:00:00Z"


def job(minutes: float, label: str = g.BLACKSMITH_RUNNER, runner: str | None = "r1", done: bool = True) -> dict:
    end = dt.datetime(2026, 11, 20, 10, 0, tzinfo=dt.timezone.utc)
    start = end - dt.timedelta(minutes=minutes)
    return {"labels": [label], "runner_name": runner, "started_at": start.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "completed_at": end.strftime("%Y-%m-%dT%H:%M:%SZ") if done else None}


def ci_run(run_id: int, status: str = "completed", updated: str = UPDATED, created: str = UPDATED,
           attempt: int = 1, wall: float | None = None) -> dict:
    run = {"id": run_id, "status": status, "updated_at": updated, "created_at": created, "run_attempt": attempt}
    if wall is not None:
        start = dt.datetime.fromisoformat(updated.replace("Z", "+00:00")) - dt.timedelta(minutes=wall)
        run["run_started_at"] = start.strftime("%Y-%m-%dT%H:%M:%SZ")
    return run


class FakeApi:
    """CI runs newest first and jobs by run id, read as GitHub pages them; records each jobs read."""

    def __init__(self, runs=None, jobs=None, down=False, other=None, lane_runs=None):
        self.runs = runs or []
        self.lane_runs = lane_runs or []
        self.jobs = jobs or {}
        self.down = down
        self.other = other or {}
        self.job_reads: list[int] = []

    def get(self, path, params=None):
        if self.down:
            raise g.Unreadable(f"GET {path} failed: HTTP 502")
        if path.endswith("/runs") and "/actions/workflows/" in path:
            runs = self.runs if path.endswith("/ci.yml/runs") else self.lane_runs
            start = (params["page"] - 1) * params["per_page"]
            return {"workflow_runs": runs[start:start + params["per_page"]]}
        if path.endswith("/jobs"):
            run_id = int(path.split("/runs/")[1].split("/")[0])
            self.job_reads.append(run_id)
            jobs = self.jobs.get(run_id, [])
            return {"total_count": len(jobs), "jobs": jobs}
        return self.other[path]


WORKFLOWS = Path(__file__).resolve().parent.parent / "workflows"
CHOSEN_RUNNER = "needs.choose-runner.outputs.runner"


def chosen_runner_timeouts(workflow: str) -> dict[str, str | None]:
    """timeout-minutes of each job whose runner choose-runner picks, the only jobs that can get Blacksmith. None when a
    job names no plain number. Jobs are the two-space keys under `jobs:`, as in every workflow here."""
    body = (WORKFLOWS / workflow).read_text(encoding="utf-8").split("\njobs:\n", 1)[1]
    parts = re.split(r"^  ([A-Za-z0-9_-]+):[^\n]*\n", body, flags=re.M)
    timeouts = {}
    for name, block in zip(parts[1::2], parts[2::2]):
        runs_on = re.search(r"^    runs-on: (.*)$", block, re.M)
        if runs_on and CHOSEN_RUNNER in runs_on[1]:
            timeout = re.search(r"^    timeout-minutes: (\d+)\s*$", block, re.M)
            timeouts[name] = timeout[1] if timeout else None
    return timeouts


class WorstCasesMatchTheWorkflows(unittest.TestCase):
    """The worst cases are the timeouts of the jobs that can get Blacksmith, so a moved job or a changed timeout fails
    here instead of leaving the stop counting the wrong number."""

    def test_ci_worst_case_is_the_timeouts_of_its_jobs_on_the_chosen_runner_added_up(self):
        timeouts = chosen_runner_timeouts("ci.yml")
        self.assertIn("checks", timeouts)
        self.assertNotIn(None, timeouts.values(), timeouts)
        self.assertEqual(sum(int(minutes) for minutes in timeouts.values()), g.WORST_CASE_MINUTES, timeouts)

    def test_each_quality_speed_job_on_the_chosen_runner_is_a_lane_at_the_lane_worst_case(self):
        timeouts = chosen_runner_timeouts("quality-speed.yml")
        self.assertEqual(list(timeouts), ["collect"])
        self.assertEqual(timeouts["collect"], str(g.LANE_WORST_CASE_MINUTES))

    def test_only_counted_workflows_can_get_blacksmith(self):
        texts = {path.name: path.read_text(encoding="utf-8") for path in WORKFLOWS.glob("*.y*ml")}
        can = {name for name, text in texts.items() if CHOSEN_RUNNER in text or "blacksmith-" in text}
        self.assertEqual(can, set(g.COUNTED_WORKFLOWS))


class Guard(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.path = str(Path(folder.name) / g.LEDGER_FILE)
        self.lines: list[str] = []
        # These tests prove the stop itself, as it runs once Blacksmith is allowed again; BlacksmithOff covers today.
        allowed = mock.patch.object(g, "BLACKSMITH_ALLOWED", True)
        allowed.start()
        self.addCleanup(allowed.stop)

    def pass_(self, api, ref="refs/pull/1/merge", event="pull_request", by_hand="", sha="abc"):
        return g.run(api, REPO, event, ref, sha, by_hand, self.path, NOW, self.lines.append)


class BlacksmithOff(unittest.TestCase):
    """Today: under the stop still means GitHub-hosted, and the count still runs."""

    def test_off_by_default(self):
        self.assertFalse(g.BLACKSMITH_ALLOWED)

    def test_pull_requests_skip_choose_runner_only_while_blacksmith_is_off(self):
        # ci.yml's choose-runner is the only way a pull request's checks get Blacksmith, so turning it on must run the
        # job on pull requests again.
        body = (WORKFLOWS / "ci.yml").read_text(encoding="utf-8").split("\njobs:\n", 1)[1]
        block = re.split(r"^  ([A-Za-z0-9_-]+):[^\n]*\n", body, flags=re.M)
        jobs = dict(zip(block[1::2], block[2::2]))
        condition = re.search(r"^    if: (.*)$", jobs["choose-runner"], re.M)
        skips = bool(condition) and "github.event_name != 'pull_request'" in condition[1]
        self.assertTrue(skips, "ci.yml's choose-runner runs on pull requests again, so this test checks nothing; drop it")
        self.assertFalse(g.BLACKSMITH_ALLOWED and skips)

    def test_under_the_stop_is_github_hosted_while_off(self):
        with tempfile.TemporaryDirectory() as folder:
            lines: list[str] = []
            api = FakeApi([ci_run(1)], {1: [job(100)]})
            runner, _ = g.run(api, REPO, "pull_request", "refs/pull/1/merge", "abc", "", str(Path(folder) / g.LEDGER_FILE),
                              NOW, lines.append)
        self.assertEqual(runner, HOSTED)
        self.assertIn("100 of this repository's 1800", lines[-1])
        self.assertIn("Blacksmith is off", lines[-1])


class ThreeStates(Guard):
    """Under the limit, over it, and unknown: the guard's whole job."""

    def test_under_the_limit_is_blacksmith(self):
        api = FakeApi([ci_run(1)], {1: [job(100)]})
        self.assertEqual(self.pass_(api), (BLACKSMITH, False))
        self.assertIn("100 of this repository's 1800", self.lines[-1])

    def test_one_minute_under_the_stop_is_blacksmith(self):
        api = FakeApi([ci_run(1)], {1: [job(g.STOP_MINUTES - 1)]})
        self.assertEqual(self.pass_(api)[0], BLACKSMITH)

    def test_at_the_stop_is_github_hosted(self):
        self.assertEqual(g.STOP_MINUTES, 1800)
        api = FakeApi([ci_run(1)], {1: [job(1800)]})
        self.assertEqual(self.pass_(api)[0], HOSTED)

    def test_over_the_stop_is_github_hosted(self):
        api = FakeApi([ci_run(1)], {1: [job(5000)]})
        self.assertEqual(self.pass_(api)[0], HOSTED)

    def test_github_down_is_github_hosted(self):
        self.assertEqual(self.pass_(FakeApi(down=True))[0], HOSTED)
        self.assertIn("unknown", self.lines[-1])
        self.assertTrue(any(line.startswith("::warning") for line in self.lines))

    def test_garbled_answer_is_github_hosted(self):
        api = FakeApi()
        api.get = lambda path, params=None: {"message": "not what you asked for"}
        self.assertEqual(self.pass_(api)[0], HOSTED)

    def test_runner_label_it_cannot_weigh_is_github_hosted(self):
        api = FakeApi([ci_run(1)], {1: [job(1, label="blacksmith-6vcpu-macos-15")]})
        self.assertEqual(self.pass_(api)[0], HOSTED)

    def test_jobs_that_did_not_all_arrive_are_github_hosted(self):
        api = FakeApi([ci_run(1)])
        real_get = api.get
        api.get = lambda path, params=None: (
            {"total_count": 2, "jobs": [job(1)]} if path.endswith("/jobs") else real_get(path, params))
        self.assertEqual(self.pass_(api)[0], HOSTED)


class Counting(Guard):
    def count(self, api, ledger=None, reads=10):
        return g.count_minutes(api, REPO, ledger if ledger is not None else {}, NOW, reads)

    def test_rounds_each_job_up_and_weighs_bigger_runners(self):
        api = FakeApi([ci_run(1)], {1: [job(0.1), job(2.5), job(1, label="blacksmith-4vcpu-ubuntu-2404")]})
        self.assertEqual(self.count(api), 1 + 3 + 2)

    def test_github_hosted_and_never_started_jobs_count_nothing(self):
        api = FakeApi([ci_run(1)], {1: [job(9, label="ubuntu-latest"), job(9, label="xcode-27"), job(9, runner=None)]})
        self.assertEqual(self.count(api), 0)

    def test_a_job_with_no_end_counts_its_worst_case(self):
        api = FakeApi([ci_run(1)], {1: [job(1, done=False)]})
        self.assertEqual(self.count(api), g.WORST_CASE_MINUTES)

    def test_quality_speed_runs_count_with_the_ci_runs(self):
        api = FakeApi([ci_run(1)], {1: [job(2)], 2: [job(3), job(4), job(9, label="ubuntu-latest")]}, lane_runs=[ci_run(2)])
        self.assertEqual(self.count(api), 2 + 3 + 4)

    def test_a_quality_speed_run_still_going_counts_every_lane_at_its_timeout_for_each_attempt(self):
        api = FakeApi(lane_runs=[ci_run(2, status="in_progress", attempt=2)])
        self.assertEqual(self.count(api), 2 * g.MAX_LANES * g.LANE_WORST_CASE_MINUTES)

    def test_a_quality_speed_job_with_no_end_counts_a_lane_timeout(self):
        api = FakeApi(lane_runs=[ci_run(2)], jobs={2: [job(1, done=False)]})
        self.assertEqual(self.count(api), g.LANE_WORST_CASE_MINUTES)

    def test_a_quality_speed_count_it_cannot_read_is_github_hosted(self):
        class NoLaneRuns(FakeApi):
            def get(self, path, params=None):
                if "quality-speed.yml" in path:
                    raise g.Unreadable("HTTP 404")
                return super().get(path, params)
        self.assertEqual(self.pass_(NoLaneRuns())[0], HOSTED)

    def test_a_run_still_going_counts_its_worst_case_unread_and_is_not_kept(self):
        api, ledger = FakeApi([ci_run(1, status="in_progress")]), {}
        self.assertEqual(self.count(api, ledger), g.WORST_CASE_MINUTES)
        self.assertEqual((api.job_reads, ledger), ([], {}))

    def test_a_finished_run_is_read_once(self):
        api, ledger = FakeApi([ci_run(1)], {1: [job(5)]}), {}
        self.assertEqual(self.count(api, ledger), 5)
        self.assertEqual(self.count(api, ledger), 5)
        self.assertEqual(api.job_reads, [1])

    def test_a_re_run_is_read_again(self):
        api, ledger = FakeApi([ci_run(1)], {1: [job(5)]}), {}
        self.count(api, ledger)
        api.runs, api.jobs = [ci_run(1, updated="2026-11-20T11:00:00Z")], {1: [job(5), job(5)]}
        self.assertEqual(self.count(api, ledger), 10)

    def test_past_the_read_limit_runs_count_their_worst_case(self):
        api = FakeApi([ci_run(1), ci_run(2, attempt=2), ci_run(3)], {1: [job(1)]})
        self.assertEqual(self.count(api, reads=1), 1 + 2 * g.WORST_CASE_MINUTES + g.WORST_CASE_MINUTES)
        self.assertEqual(api.job_reads, [1])

    def test_a_finished_run_past_the_reads_counts_its_own_time_and_a_minute_a_job(self):
        # 2.5 minutes from start to end holds `checks` alone (`ci-ok` is on ubuntu-slim), so at most 3 + 1 rounded minutes.
        self.assertEqual(self.count(FakeApi([ci_run(1, wall=2.5)]), reads=0), 4)
        self.assertEqual(self.count(FakeApi([ci_run(1, wall=600)]), reads=0), g.WORST_CASE_MINUTES)

    def test_a_re_run_past_the_reads_counts_earlier_attempts_at_their_worst_case(self):
        self.assertEqual(self.count(FakeApi([ci_run(1, wall=2.5, attempt=2)]), reads=0), g.WORST_CASE_MINUTES + 4)

    def test_a_run_still_going_counts_its_worst_case_whatever_its_start(self):
        self.assertEqual(self.count(FakeApi([ci_run(1, status="in_progress", wall=1)]), reads=0), g.WORST_CASE_MINUTES)

    def test_quality_speed_runs_take_the_reads_first_and_their_lanes_run_side_by_side(self):
        api = FakeApi([ci_run(1, wall=1)], {2: [job(3)]}, lane_runs=[ci_run(2, wall=4), ci_run(3, wall=2)])
        # Lane run 2 is read (3); lane run 3 is two minutes of up to 30 lanes, each rounded up; CI run 1 is 1 + 1.
        self.assertEqual(self.count(api, reads=1), 3 + (2 * g.MAX_LANES + g.MAX_LANES) + 2)
        self.assertEqual(api.job_reads, [2])

    def test_runs_past_the_window_end_the_count_and_old_entries_go(self):
        old = "2026-10-19T00:00:00Z"
        ledger = {"99": {"updated": old, "day": old[:10], "minutes": 500}}
        api = FakeApi([ci_run(1), ci_run(2, created=old, updated=old)], {1: [job(5)], 2: [job(500)]})
        self.assertEqual(self.count(api, ledger), 5)
        self.assertEqual((api.job_reads, sorted(ledger)), ([1], ["1"]))

    def test_listing_stops_at_a_page_with_nothing_new(self):
        api = FakeApi([ci_run(n) for n in range(1, 151)], {n: [] for n in range(1, 151)})
        ledger = {str(n): {"updated": UPDATED, "day": UTC_DAY, "minutes": 0} for n in range(1, 101)}
        self.assertEqual(self.count(api, ledger), 0)
        self.assertEqual(api.job_reads, [])

    def test_too_many_pages_is_unknown(self):
        api = FakeApi([ci_run(n, status="queued") for n in range(g.PAGE_SIZE * g.MAX_PAGES + 1)])
        with self.assertRaises(g.Unreadable):
            self.count(api)


UTC_DAY = UPDATED[:10]


class Ledger(Guard):
    def test_a_saved_ledger_saves_the_next_pass_its_reads(self):
        self.pass_(FakeApi([ci_run(1)], {1: [job(5)]}), ref="refs/heads/main", event="push")
        api = FakeApi([ci_run(1)], {1: [job(5)]})
        self.assertEqual(self.pass_(api)[0], BLACKSMITH)
        self.assertEqual(api.job_reads, [])
        self.assertIn("5 of this repository's 1800", self.lines[-1])

    def test_a_missing_or_malformed_ledger_starts_over(self):
        self.assertEqual(g.load_ledger(self.path), {})
        for text in ("not json", "[]", '{"runs": 3}', '{"runs": {"1": {}}}',
                     '{"runs": {"1": {"updated": "x", "day": "not a day", "minutes": 1}}}',
                     '{"runs": {"1": {"updated": "x", "day": "2026-11-20", "minutes": -1}}}',
                     '{"runs": {"1": {"updated": "x", "day": "2026-11-20", "minutes": true}}}',
                     '{"runs": {"1": {"updated": 7, "day": "2026-11-20", "minutes": 1}}}'):
            Path(self.path).write_text(text, encoding="utf-8")
            self.assertEqual(g.load_ledger(self.path), {}, text)

    def test_main_may_read_far_more_than_a_pull_request(self):
        total = g.READS_PULL_REQUEST + 10
        runs = [ci_run(n) for n in range(1, total + 1)]
        api = FakeApi(runs)
        self.pass_(api)
        self.assertEqual(len(api.job_reads), g.READS_PULL_REQUEST)
        Path(self.path).unlink()
        api = FakeApi(runs)
        self.pass_(api, ref="refs/heads/main", event="push")
        self.assertEqual(len(api.job_reads), total)


class ByHand(Guard):
    def test_a_runner_set_by_hand_is_the_off_switch(self):
        api = FakeApi([ci_run(1)], {1: [job(5)]})
        self.assertEqual(self.pass_(api, by_hand=HOSTED)[0], HOSTED)
        for label in sorted(g.HAND_SET_RUNNERS):
            self.assertEqual(self.pass_(api, by_hand=json.dumps(label))[0], json.dumps(label), label)

    def test_a_hand_set_blacksmith_runner_is_ignored_over_the_limit(self):
        api = FakeApi([ci_run(1)], {1: [job(5000)]})
        self.assertEqual(self.pass_(api, by_hand=BLACKSMITH)[0], HOSTED)
        self.assertTrue(any("ignored" in line for line in self.lines))

    def test_a_value_runs_on_cannot_use_is_ignored(self):
        api = FakeApi()
        for bad in ("ubuntu-latest", "{}", "[]", '[""]', "3", '["a", 3]'):
            self.assertEqual(self.pass_(api, by_hand=bad)[0], BLACKSMITH, bad)

    def test_only_a_standard_github_hosted_label_is_accepted(self):
        api = FakeApi()
        for bad in ('"self-hosted"', '"ubuntu-latest-4-cores"', '"ubuntu-24.04-arm"', '"macos-latest"',
                    '["self-hosted", "linux"]', '["ubuntu-latest"]', '"ubuntu-latest\\n"', '""'):
            self.assertIsNone(g.hand_set_runner(bad), bad)
            self.assertEqual(self.pass_(api, by_hand=bad)[0], BLACKSMITH, bad)


class AlreadyTested(Guard):
    SHA, HEAD = "squashed", "prhead"

    def api(self, head_tree="tree1", conclusion="success", merged="2026-11-20T10:00:00Z", merge_sha=None, on_sha=None):
        return FakeApi(other={
            f"/repos/{REPO}/commits/{self.SHA}/check-runs": {"check_runs": [{"conclusion": on_sha}] if on_sha else []},
            f"/repos/{REPO}/commits/{self.SHA}/pulls": [{"merged_at": merged, "base": {"ref": "main"},
                                                        "merge_commit_sha": merge_sha or self.SHA,
                                                        "head": {"sha": self.HEAD}}],
            f"/repos/{REPO}/git/commits/{self.SHA}": {"tree": {"sha": "tree1"}},
            f"/repos/{REPO}/git/commits/{self.HEAD}": {"tree": {"sha": head_tree}},
            f"/repos/{REPO}/commits/{self.HEAD}/check-runs": {"check_runs": [{"conclusion": conclusion}]}})

    def test_the_same_tree_with_ci_ok_green_is_tested(self):
        self.assertTrue(g.already_tested(self.api(), REPO, self.SHA))

    def test_a_different_tree_is_not(self):
        self.assertFalse(g.already_tested(self.api(head_tree="tree2"), REPO, self.SHA))

    def test_ci_ok_not_green_is_not(self):
        self.assertFalse(g.already_tested(self.api(conclusion="failure"), REPO, self.SHA))

    def test_not_a_merge_of_that_pull_request_is_not(self):
        self.assertFalse(g.already_tested(self.api(merged=None), REPO, self.SHA))
        self.assertFalse(g.already_tested(self.api(merge_sha="another"), REPO, self.SHA))

    def test_a_push_with_no_pull_request_is_not(self):
        api = FakeApi(other={f"/repos/{REPO}/commits/{self.SHA}/pulls": []})
        self.assertFalse(g.already_tested(api, REPO, self.SHA))

    def test_github_down_is_not(self):
        self.assertFalse(g.already_tested(FakeApi(down=True), REPO, self.SHA))

    def test_ci_ok_green_on_the_pushed_commit_itself_is_tested(self):
        # The merge queue ran CI on its group, and main moved to that commit: no pull request head to compare.
        api = FakeApi(other={f"/repos/{REPO}/commits/{self.SHA}/check-runs": {"check_runs": [{"conclusion": "success"}]},
                             f"/repos/{REPO}/commits/{self.SHA}/pulls": []})
        self.assertTrue(g.already_tested(api, REPO, self.SHA))
        self.assertTrue(g.already_tested(self.api(head_tree="tree2", on_sha="success"), REPO, self.SHA))

    def test_ci_ok_not_green_on_the_pushed_commit_falls_back_to_the_head(self):
        for conclusion in ("failure", "cancelled", None):
            self.assertFalse(g.already_tested(self.api(head_tree="tree2", on_sha=conclusion), REPO, self.SHA), conclusion)
        self.assertTrue(g.already_tested(self.api(on_sha="failure"), REPO, self.SHA))

    def test_only_a_push_asks(self):
        api = self.api()
        api.runs = []
        self.assertTrue(self.pass_(api, event="push", ref="refs/heads/main", sha=self.SHA)[1])
        self.assertFalse(self.pass_(api, event="pull_request", sha=self.SHA)[1])
        self.assertFalse(self.pass_(api, event="workflow_dispatch", ref="refs/heads/main", sha=self.SHA)[1])


class Main(unittest.TestCase):
    def outputs(self, **patches) -> tuple[int, str]:
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / "output"
            output.touch()
            env = {"GITHUB_OUTPUT": str(output), "GITHUB_REPOSITORY": REPO, "GITHUB_EVENT_NAME": "pull_request"}
            with mock.patch.dict(os.environ, env), mock.patch.object(g, "LEDGER_FILE", str(Path(folder) / "ledger")), \
                    mock.patch("builtins.print"), mock.patch.object(g.Api, "get", **patches):
                code = g.main()
            return code, output.read_text(encoding="utf-8")

    def test_writes_both_outputs_for_fromjson(self):
        code, text = self.outputs(return_value={"workflow_runs": []})
        # GitHub-hosted while BLACKSMITH_ALLOWED is off.
        self.assertEqual((code, text), (0, f"runner={HOSTED}\ntested=false\n"))

    def test_any_failure_still_exits_zero_on_github_hosted(self):
        code, text = self.outputs(side_effect=RuntimeError("boom"))
        self.assertEqual((code, text), (0, f"runner={HOSTED}\ntested=false\n"))

    def test_a_crash_past_the_count_still_writes_github_hosted(self):
        with mock.patch.object(g, "run", side_effect=RuntimeError("boom")):
            code, text = self.outputs(return_value={})
        self.assertEqual((code, text), (0, f"runner={HOSTED}\ntested=false\n"))


if __name__ == "__main__":
    unittest.main()
