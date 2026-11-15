#!/usr/bin/env python3
"""Which routes of the Quality and Speed site `quality-speed-screens.yml` shoots.

Shooting every route at two widths and two themes takes about 2 of the job's 3 billed minutes (5 Nov 2026). Most pull
requests change one page's folder, and a page's own files render only that page. So:

| Changed | Shot |
|---|---|
| Only files under quality-speed/pages/<slug>/ | Those pages, every page that imports from their folders, the home page, and the
  pages that draw other pages' scores (SCORE_READERS) |
| Anything else (core/, contract/, the workflow, a shooter, a deleted page...) | Every route |
| Unknown: a manual run, a checkout that is not the pull request's merge, a git error | Every route |

Markdown is left out, as the workflow's path filter leaves it out. A route is the folder of an index.html, so a page's
extra .html files are shot with it only when the page is.

Usage: screens_routes.py <site dir>. Environment: EVENT_NAME, PR_HEAD_SHA. Prints the routes, one line, space separated.
Never fails: anything it cannot decide prints every route.
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path

PAGES = "quality-speed/pages/"
# page.ts files that read PageContext.others, the other pages' scores (core/build.ts). Keep in step with
# `grep -l others quality-speed/pages/*/page.ts`; screens_routes_test.py checks it against the tree.
SCORE_READERS = ("data-room", "reliability")
PAGE_FILE = re.compile(r"quality-speed/pages/([a-z0-9-]+)/.+")
IMPORT = re.compile(r"""['"]\.\./(?:\.\./pages/)?([a-z0-9-]+)/""")


def all_routes(site: Path) -> list[str]:
    """Every folder with an index.html, as /a/b/, sorted."""
    routes = []
    for index in site.rglob("index.html"):
        rel = index.parent.relative_to(site).as_posix()
        routes.append("/" if rel == "." else f"/{rel}/")
    return sorted(routes)


def importers(pages_dir: Path, slugs: set[str]) -> set[str]:
    """Pages whose .ts files import from a folder in `slugs`, followed until nothing new turns up."""
    found = set(slugs)
    while True:
        more = set()
        for ts in pages_dir.glob("*/**/*.ts"):
            page = ts.relative_to(pages_dir).parts[0]
            if page in found or ts.name.endswith(".test.ts"):
                continue
            if any(target in found for target in IMPORT.findall(ts.read_text(encoding="utf-8", errors="replace"))):
                more.add(page)
        if not more:
            return found
        found |= more


def routes_for(changed: list[str] | None, routes: list[str], pages_dir: Path) -> list[str]:
    """The routes to shoot for these changed paths; None means unknown, so every route."""
    if changed is None:
        return routes
    files = [path for path in changed if not path.endswith(".md")]
    slugs = set()
    for path in files:
        match = PAGE_FILE.fullmatch(path)
        if not match or not (pages_dir / match.group(1)).is_dir():
            return routes
        slugs.add(match.group(1))
    wanted = importers(pages_dir, slugs) | set(SCORE_READERS)
    picked = [route for route in routes if route == "/" or route.split("/")[1] in wanted]
    return picked or routes


def changed_files() -> list[str] | None:
    """The pull request's changes: its merge checkout against the base parent. None when that can't be shown."""
    if os.environ.get("EVENT_NAME") != "pull_request":
        return None
    try:
        git = lambda *args: subprocess.run(["git", *args], check=True, capture_output=True, text=True, timeout=60).stdout  # noqa: E731
        if git("rev-parse", "HEAD^2").strip() != os.environ.get("PR_HEAD_SHA", ""):
            return None
        return [line for line in git("diff", "--name-only", "--no-renames", "HEAD^1", "HEAD").splitlines() if line]
    except (subprocess.SubprocessError, OSError):
        return None


def main(argv: list[str]) -> int:
    site = Path(argv[1])
    routes = all_routes(site)
    try:
        picked = routes_for(changed_files(), routes, Path(PAGES))
    except Exception as exc:  # noqa: BLE001  (unknown means every route)
        print(f"::warning title=Screens routes::{type(exc).__name__}: {exc}; so every route", file=sys.stderr)
        picked = routes
    print(f"::notice title=Screens routes::{len(picked)} of {len(routes)} routes", file=sys.stderr)
    print(" ".join(picked))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
