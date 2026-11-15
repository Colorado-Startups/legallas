#!/usr/bin/env python3
"""Tests for ci.yml's concurrency, offline: each push to main gets a run no later push cancels or replaces (#242, #235),
and a new push to a pull request still cancels the run it supersedes. Run with
`python3 .github/scripts/ci_concurrency_test.py` (`checks` in ci.yml runs them when anything under .github/ changes)."""

from __future__ import annotations

import re
import unittest
from pathlib import Path

CI = Path(__file__).resolve().parent.parent / "workflows" / "ci.yml"
# Before #242: every push to main shared this group, so a burst of merges cancelled the pending run.
SHARED_GROUP = "ci-${{ github.ref }}"

TOKEN = re.compile(r"\s*(?:'((?:[^']|'')*)'|(==|!=|&&|\|\||[!(),])|([A-Za-z_][A-Za-z0-9_.-]*))")


def text(value) -> str:
    """A value as GitHub writes it into a string."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


class Reader:
    """The part of GitHub's expression syntax the concurrency block uses: strings, true and false, context names, ==, !=,
    &&, ||, !, brackets and format(). Anything else is a ValueError, so a new construct can't pass unread."""

    def __init__(self, source: str, context: dict[str, str]):
        self.tokens: list[tuple[str, str]] = []
        source, at = source.strip(), 0
        while at < len(source):
            found = TOKEN.match(source, at)
            if not found:
                raise ValueError(f"can't read {source[at:]!r}")
            at = found.end()
            if found[1] is not None:
                self.tokens.append(("str", found[1].replace("''", "'")))
            elif found[2]:
                self.tokens.append(("op", found[2]))
            else:
                self.tokens.append(("name", found[3]))
        self.at = 0
        self.context = context

    def peek(self):
        return self.tokens[self.at] if self.at < len(self.tokens) else None

    def take(self, op: str | None = None) -> tuple[str, str]:
        token = self.peek()
        if token is None or (op is not None and token != ("op", op)):
            raise ValueError(f"expected {op or 'more'}, found {token}")
        self.at += 1
        return token

    def read(self):
        value = self.either()
        if self.peek() is not None:
            raise ValueError(f"unread {self.tokens[self.at:]}")
        return value

    def either(self):
        value = self.both()
        while self.peek() == ("op", "||"):
            self.take()
            right = self.both()
            value = value or right
        return value

    def both(self):
        value = self.compare()
        while self.peek() == ("op", "&&"):
            self.take()
            right = self.compare()
            value = value and right
        return value

    def compare(self):
        value = self.unary()
        while self.peek() in (("op", "=="), ("op", "!=")):
            op = self.take()[1]
            right = self.unary()
            # GitHub compares strings ignoring case.
            same = value.casefold() == right.casefold() if isinstance(value, str) and isinstance(right, str) else value == right
            value = same if op == "==" else not same
        return value

    def unary(self):
        if self.peek() == ("op", "!"):
            self.take()
            return not self.unary()
        return self.primary()

    def primary(self):
        kind, value = self.take()
        if (kind, value) == ("op", "("):
            inner = self.either()
            self.take(")")
            return inner
        if kind == "str":
            return value
        if kind == "name" and self.peek() == ("op", "("):
            return self.call(value)
        if kind == "name" and value in ("true", "false"):
            return value == "true"
        if kind == "name" and value in self.context:
            return self.context[value]
        raise ValueError(f"{value!r} is not in this test's contexts")

    def call(self, name: str) -> str:
        if name != "format":
            raise ValueError(f"unknown function {name}")
        self.take("(")
        args = [self.either()]
        while self.peek() == ("op", ","):
            self.take()
            args.append(self.either())
        self.take(")")
        template, *rest = args
        return re.sub(r"\{(\d+)\}", lambda found: text(rest[int(found[1])]), template)


def render(template: str, context: dict[str, str]) -> str:
    """A workflow string with each ${{ }} worked out for one event."""
    return re.sub(r"\$\{\{(.*?)\}\}", lambda found: text(Reader(found[1], context).read()), template)


def push(sha: str) -> dict[str, str]:
    return {"github.event_name": "push", "github.ref": "refs/heads/main", "github.sha": sha}


def pull_request(number: int, sha: str) -> dict[str, str]:
    return {"github.event_name": "pull_request", "github.ref": f"refs/pull/{number}/merge", "github.sha": sha}


def push_runs_share_a_group(group: str) -> bool:
    return render(group, push("aaa")) == render(group, push("bbb"))


def concurrency() -> tuple[str, str]:
    """ci.yml's workflow-level group and cancel-in-progress, as written."""
    workflow = CI.read_text(encoding="utf-8")
    keys = re.findall(r"^\s*concurrency:", workflow, re.M)
    if len(keys) != 1:
        raise AssertionError(f"ci.yml has {len(keys)} concurrency keys; a job-level one could cancel a push run unseen")
    found = re.search(r"^concurrency:\n  group: (.+)\n  cancel-in-progress: (.+)$", workflow, re.M)
    if not found:
        raise AssertionError("ci.yml's concurrency block is not a group line then a cancel-in-progress line")
    return found[1].strip(), found[2].strip()


class EachPushToMainFinishes(unittest.TestCase):
    """GitHub keeps one running and one pending run per group, and a newer run replaces the pending one."""

    def setUp(self):
        self.group, self.cancel = concurrency()

    def test_two_pushes_to_main_never_share_a_group(self):
        self.assertFalse(push_runs_share_a_group(self.group), self.group)

    def test_a_burst_of_three_pushes_has_no_replaced_run(self):
        # #235: one runs, one waits, and the third replaced the waiting one, whose areas then never ran on main.
        groups = {render(self.group, push(sha)) for sha in ("aaa", "bbb", "ccc")}
        self.assertEqual(len(groups), 3, groups)

    def test_no_other_event_takes_a_push_group(self):
        others = [pull_request(7, "aaa"),
                  {"github.event_name": "workflow_dispatch", "github.ref": "refs/heads/main", "github.sha": "aaa"},
                  {"github.event_name": "merge_group", "github.ref": "refs/heads/gh-readonly-queue/main/pr-7-aaa",
                   "github.sha": "aaa"}]
        for context in others:
            self.assertNotEqual(render(self.group, context), render(self.group, push("aaa")), context)

    def test_a_push_run_is_never_cancelled_in_progress(self):
        self.assertEqual(render(self.cancel, push("aaa")), "false")

    def test_the_old_shared_group_fails_here(self):
        self.assertTrue(push_runs_share_a_group(SHARED_GROUP))


class PullRequestsCancelSupersededRuns(unittest.TestCase):
    def setUp(self):
        self.group, self.cancel = concurrency()

    def test_a_new_push_to_a_pull_request_cancels_the_run_it_supersedes(self):
        self.assertEqual(render(self.group, pull_request(7, "aaa")), render(self.group, pull_request(7, "bbb")))
        self.assertEqual(render(self.cancel, pull_request(7, "bbb")), "true")

    def test_two_pull_requests_never_share_a_group(self):
        self.assertNotEqual(render(self.group, pull_request(7, "aaa")), render(self.group, pull_request(8, "aaa")))


class ReadsTheExpressions(unittest.TestCase):
    """The reader itself, so a pass above means what it says."""

    def test_operators_work_as_github_says(self):
        self.assertEqual(render("${{ github.event_name == 'push' && format('-{0}', github.sha) || '' }}", push("abc")), "-abc")
        self.assertEqual(render("x${{ github.event_name == 'push' && 'y' || '' }}", pull_request(1, "abc")), "x")
        self.assertEqual(render("${{ !(github.event_name != 'PUSH') }}", push("abc")), "true")
        self.assertEqual(render("${{ 'it''s' }}", push("abc")), "it's")

    def test_anything_it_cannot_read_fails(self):
        for source in ("${{ github.run_id }}", "${{ contains(github.ref, 'main') }}", "${{ github.ref[0] }}",
                       "${{ 1 }}", "${{ github.ref == }}", "${{ (github.ref }}"):
            with self.assertRaises(ValueError, msg=source):
                render(source, push("abc"))


if __name__ == "__main__":
    unittest.main()
