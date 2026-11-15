#!/usr/bin/env python3
"""Tests for app_lanes.py. Run with `python3 .github/scripts/app_lanes_test.py` (`checks` in ci.yml runs them when anything
under .github/ changes)."""

from __future__ import annotations

import json
import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app_lanes as a  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]


def row(slug, runner):
    return {"slug": slug, "lane": "x", "runner": runner, "install": False, "admin": False}


SETTINGS, PROJECTS, APP = row("settings", "ubuntu-latest"), row("projects", "ubuntu-latest"), row("github-app", "choose-runner")
OTHER_B, OTHER_H = row("issues", "choose-runner"), row("agents", "ubuntu-latest")
TEXT = "\n".join([
    "matrix=" + json.dumps({"include": [SETTINGS, PROJECTS, APP, OTHER_B, OTHER_H]}),
    "blacksmith=" + json.dumps({"include": [APP, OTHER_B]}),
    "hosted=" + json.dumps({"include": [SETTINGS, PROJECTS, OTHER_H]}),
]) + "\n"


class Split(unittest.TestCase):
    def test_on_main_app_pages_move(self):
        out = a.split(TEXT, True)
        self.assertEqual(out["blacksmith"]["include"], [OTHER_B])
        self.assertEqual(out["hosted"]["include"], [OTHER_H])
        self.assertEqual(out["app"]["include"], [APP, SETTINGS, PROJECTS])

    def test_matrix_never_changes(self):
        for on_main in (True, False):
            self.assertEqual(len(a.split(TEXT, on_main)["matrix"]["include"]), 5)

    def test_off_main_nothing_moves(self):
        out = a.split(TEXT, False)
        self.assertEqual(out["blacksmith"]["include"], [APP, OTHER_B])
        self.assertEqual(out["hosted"]["include"], [SETTINGS, PROJECTS, OTHER_H])
        self.assertEqual(out["app"], {"include": []})

    def test_unknown_or_missing_lines_raise(self):
        with self.assertRaises(ValueError):
            a.split(TEXT + "extra={}\n", True)
        with self.assertRaises(ValueError):
            a.split(TEXT.split("\n", 1)[1], True)


class Tree(unittest.TestCase):
    def test_app_pages_exist(self):
        for page in a.APP_PAGES:
            self.assertTrue((ROOT / "quality-speed/pages" / page / "lanes.json").is_file(), page)

    def test_workflow_mints_a_token_for_each_app_page_and_only_in_collect_app(self):
        text = (ROOT / ".github/workflows/quality-speed.yml").read_text(encoding="utf-8")
        jobs = re.split(r"^  ([A-Za-z0-9_-]+):[^\n]*\n", text.split("\njobs:\n", 1)[1], flags=re.M)
        blocks = dict(zip(jobs[1::2], jobs[2::2]))
        for name, block in blocks.items():
            if name != "collect-app":
                self.assertNotIn("CS_APP_PRIVATE_KEY", block, name)
        app = blocks["collect-app"]
        self.assertIn("environment: settings", app)
        self.assertIn("runs-on: ubuntu-latest", app)
        for page in a.APP_PAGES:
            self.assertIn(f"matrix.slug == '{page}'", app)


if __name__ == "__main__":
    unittest.main()
