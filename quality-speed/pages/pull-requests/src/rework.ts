// Which earlier merges a merge rewrote, by position: the lines its squash
// commit deletes or changes, blamed at its parent, name the commits that last
// wrote them. Needs a clone with main's full history (the lane checks out with
// fetch-depth 0). Git runs with arguments, never a shell. Any git error throws.

import { execFileSync } from "node:child_process";
import { isGenerated, isSite } from "./facts.ts";

function git(dir: string, args: string[]): string {
  return execFileSync("git", ["-C", dir, "-c", "core.quotepath=false", ...args], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
}

/**
 * The path in a `--- ` header: null for /dev/null; a trailing tab (git adds
 * one after a path with a space) dropped; a C-quoted path unquoted.
 */
export function oldPath(header: string): string | null {
  let h = header.replace(/\t.*$/, "");
  if (h === "/dev/null") return null;
  if (h.startsWith('"') && h.endsWith('"')) {
    const bytes: number[] = [];
    const body = h.slice(1, -1);
    for (let i = 0; i < body.length; i++) {
      const c = body.charAt(i);
      if (c !== "\\") {
        bytes.push(...Buffer.from(c, "utf8"));
        continue;
      }
      const next = body.charAt(++i);
      if (/[0-7]/.test(next)) {
        bytes.push(parseInt(body.slice(i, i + 3), 8));
        i += 2;
      } else bytes.push(({ n: 10, t: 9, '"': 34, "\\": 92, a: 7, b: 8, f: 12, r: 13, v: 11 } as Record<string, number>)[next] ?? next.charCodeAt(0));
    }
    h = Buffer.from(bytes).toString("utf8");
  }
  return h.replace(/^a\//, "");
}

/**
 * Line ranges, in the old side of a `git diff -U0`, that a commit deletes or
 * changes, per old path. `--- ` is a file header only between `diff --git` and
 * that file's first hunk: inside a hunk it is a deleted line that starts with
 * "-- " (an SQL comment). A pure rename has no hunks, so moving a file is not
 * rework.
 */
export function deletedRanges(diff: string): Map<string, [number, number][]> {
  const out = new Map<string, [number, number][]>();
  let file: string | null = null;
  let inHeader = false;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      file = null;
      inHeader = true;
    } else if (inHeader && line.startsWith("--- ")) {
      file = oldPath(line.slice(4));
    } else if (line.startsWith("@@ ")) {
      inHeader = false;
      const m = /^@@ -(\d+)(?:,(\d+))? \+/.exec(line);
      if (!file || !m) continue;
      const start = Number(m[1]);
      const count = m[2] === undefined ? 1 : Number(m[2]);
      if (count > 0) {
        if (!out.has(file)) out.set(file, []);
        out.get(file)!.push([start, start + count - 1]);
      }
    }
  }
  return out;
}

/** Commit ids that last wrote each non-blank line in a `git blame --porcelain` output. */
export function blamedCommits(porcelain: string): string[] {
  const out: string[] = [];
  let current: string | null = null;
  for (const line of porcelain.split("\n")) {
    const header = /^([0-9a-f]{40}) \d+ \d+/.exec(line);
    if (header) current = header[1] ?? null;
    else if (line.startsWith("\t") && current && line.slice(1).trim() !== "") out.push(current);
  }
  return out;
}

/**
 * Earlier merges whose lines `mergeSha` deletes or changes. `earlier` maps an
 * earlier merge commit to its pull request number; only those count. Lock and
 * generated files are left out (they are rebuilt, not written), and so is
 * this site's own folder, which this page never counts.
 */
export function fixesByBlame(dir: string, mergeSha: string, earlier: Map<string, number>, generated: string[]): number[] {
  if (earlier.size === 0) return [];
  const parent = git(dir, ["rev-parse", `${mergeSha}^1`]).trim();
  // -M: a moved file is compared with where it came from, so only lines that changed count (GitClear counts moves apart from churn).
  const diff = git(dir, ["diff", "-U0", "-M", "--no-color", "--no-ext-diff", parent, mergeSha]);
  const found = new Set<number>();
  for (const [file, ranges] of deletedRanges(diff)) {
    if (isGenerated(file, generated) || isSite(file)) continue;
    const args = ["blame", "--porcelain", ...ranges.flatMap(([a, b]) => ["-L", `${a},${b}`]), parent, "--", file];
    for (const sha of blamedCommits(git(dir, args))) {
      const n = earlier.get(sha);
      if (n !== undefined) found.add(n);
    }
  }
  return [...found].sort((a, b) => a - b);
}

/** True when the clone has a commit. */
export function hasCommit(dir: string, sha: string): boolean {
  try {
    git(dir, ["cat-file", "-e", `${sha}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}
