#!/usr/bin/env python3
"""Moves the lanes that read with the Legallas Automation App's token into their own matrix, `app`.

quality-speed/core/lanes.ts prints matrix=, blacksmith= and hosted= (JSON {"include": [rows]}). On main, the rows of
APP_PAGES leave `blacksmith` and `hosted` for `app`, which quality-speed.yml's `collect-app` job runs in environment
`settings`, GitHub-hosted, with a read-only App token. Off main the environment's key is out of reach, so nothing moves
and `app` is empty: those lanes then read with the job's own token, as before. `matrix=`, the plan merge.ts reads, never
changes.

Usage: app_lanes.py <lanes.ts output file> <true|false: on main>. Prints matrix=, blacksmith=, hosted= and app= lines.
"""

from __future__ import annotations

import json
import sys

# The pages whose collectors read with the App's token (quality-speed/pages/github-app/expected.json lists its permissions).
APP_PAGES = ("settings", "projects", "github-app")
KEYS = ("matrix", "blacksmith", "hosted")


def split(text: str, on_main: bool) -> dict[str, dict]:
    """{matrix, blacksmith, hosted, app} from lanes.ts's lines. Raises on anything it doesn't recognise."""
    out = {}
    for line in text.splitlines():
        if not line.strip():
            continue
        key, _, value = line.partition("=")
        if key not in KEYS or key in out:
            raise ValueError(f"unexpected line from lanes.ts: {key!r}")
        out[key] = json.loads(value)
    if set(out) != set(KEYS):
        raise ValueError(f"lanes.ts printed {sorted(out)}, not {sorted(KEYS)}")
    app = []
    if on_main:
        for key in ("blacksmith", "hosted"):
            keep = []
            for row in out[key]["include"]:
                (app if row.get("slug") in APP_PAGES else keep).append(row)
            out[key] = {"include": keep}
    out["app"] = {"include": app}
    return out


def main(argv: list[str]) -> int:
    with open(argv[1], encoding="utf-8") as handle:
        result = split(handle.read(), argv[2] == "true")
    for key, value in result.items():
        print(f"{key}={json.dumps(value, separators=(',', ':'))}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
