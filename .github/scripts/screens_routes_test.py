#!/usr/bin/env python3
"""Tests for screens_routes.py, offline, on a throwaway pages folder. Run with
`python3 .github/scripts/screens_routes_test.py` (`checks` in ci.yml runs them when anything under .github/ changes)."""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import screens_routes as s  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
ROUTES = ["/", "/alpha/", "/beta/", "/data-room/", "/gallery/", "/gamma/", "/reliability/"]


class RoutesFor(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.pages = Path(self.tmp.name)
        for page in ("alpha", "beta", "gamma", "data-room", "reliability"):
            (self.pages / page).mkdir()
            (self.pages / page / "page.ts").write_text("import { x } from '../../core/charts/index.ts';\n")
        # gamma imports from beta, so a change to beta renders gamma too.
        (self.pages / "gamma" / "page.ts").write_text("import { y } from '../beta/list.ts';\n")
        # A test importing alpha changes nothing it renders.
        (self.pages / "beta" / "page.test.ts").write_text("import { z } from '../alpha/page.ts';\n")

    def tearDown(self):
        self.tmp.cleanup()

    def pick(self, changed):
        return s.routes_for(changed, ROUTES, self.pages)

    def test_unknown_shoots_everything(self):
        self.assertEqual(self.pick(None), ROUTES)

    def test_one_page_shoots_it_home_and_score_readers(self):
        self.assertEqual(self.pick(["quality-speed/pages/alpha/collect.ts", "quality-speed/pages/alpha/page.ts"]),
                         ["/", "/alpha/", "/data-room/", "/reliability/"])

    def test_importers_follow(self):
        self.assertEqual(self.pick(["quality-speed/pages/beta/list.ts"]),
                         ["/", "/beta/", "/data-room/", "/gamma/", "/reliability/"])

    def test_core_shoots_everything(self):
        self.assertEqual(self.pick(["quality-speed/pages/alpha/page.ts", "quality-speed/core/charts/ring.ts"]), ROUTES)

    def test_workflow_shoots_everything(self):
        self.assertEqual(self.pick([".github/workflows/quality-speed-screens.yml"]), ROUTES)

    def test_page_root_file_or_unknown_page_shoots_everything(self):
        self.assertEqual(self.pick(["quality-speed/pages/README.json"]), ROUTES)
        self.assertEqual(self.pick(["quality-speed/pages/deleted/page.ts"]), ROUTES)

    def test_markdown_alone_still_shoots_home(self):
        self.assertEqual(self.pick(["quality-speed/pages/alpha/PLAN.md"]), ["/", "/data-room/", "/reliability/"])

    def test_all_routes_reads_index_folders(self):
        with tempfile.TemporaryDirectory() as site:
            for rel in ("index.html", "alpha/index.html", "alpha/extra.html", "gallery/index.html"):
                path = Path(site) / rel
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("")
            self.assertEqual(s.all_routes(Path(site)), ["/", "/alpha/", "/gallery/"])


class Tree(unittest.TestCase):
    def test_score_readers_match_the_pages(self):
        """SCORE_READERS lists exactly the page.ts files that read other pages' scores."""
        readers = sorted(p.parent.name for p in (ROOT / s.PAGES).glob("*/page.ts") if "others" in p.read_text())
        self.assertEqual(readers, sorted(s.SCORE_READERS))


if __name__ == "__main__":
    unittest.main()
