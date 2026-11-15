// Rework by blame, on a throwaway repository with invented content.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { blamedCommits, deletedRanges, fixesByBlame, hasCommit, oldPath } from "../src/rework.ts";

const dir = mkdtempSync(join(tmpdir(), "qs-rework-"));
after(() => rmSync(dir, { recursive: true, force: true }));

function git(...args: string[]): string {
  return execFileSync("git", ["-C", dir, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", ...args], {
    encoding: "utf8",
  }).trim();
}

function commit(files: Record<string, string>, message: string): string {
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  git("add", "-A");
  git("commit", "-q", "-m", message);
  return git("rev-parse", "HEAD");
}

git("init", "-q", "-b", "main");
const base = commit({ "a.txt": "one\ntwo\n", "lock.json": "{}\n" }, "base");
const a = commit({ "a.txt": "one\ntwo\nlimit = 400\n}\nnote from A\n", "lock.json": '{"v":1}\n' }, "A");
const append = commit({ "a.txt": "one\ntwo\nlimit = 400\n}\nnote from A\nmore\n" }, "append only");
const change = commit({ "a.txt": "one\ntwo\nlimit = 500\n}\nnote from A\nmore\n" }, "change a line A wrote");
const lockOnly = commit({ "lock.json": '{"v":2}\n' }, "lock only");
const old = commit({ "a.txt": "uno\ntwo\nlimit = 500\n}\nnote from A\nmore\n" }, "change a line base wrote");
const sqlA = commit({ "m.sql": "select 1;\n-- note one\n-- note two\n" }, "A2 writes SQL");
const sqlB = commit({ "m.sql": "select 1;\n-- note two\n" }, "deletes an SQL comment");
git("mv", "a.txt", "b.txt");
const moved = commit({}, "pure rename");
const spaced = commit({ "x y.md": "first line here\nsecond line here\n" }, "a path with a space");
const spacedEdit = commit({ "x y.md": "first line here\nchanged line here\n" }, "edit it");
const siteA = commit({ "quality-speed/x.ts": "export const a = 1;\n" }, "site file");
const siteB = commit({ "quality-speed/x.ts": "export const a = 2;\n" }, "site file changed");
const movedEdit = commit({ "b.txt": "uno\ntwo\nlimit = 600\n}\nnote from A\nmore\n" }, "edit after the move");

test("deleted ranges come from the old side of hunk headers", () => {
  const diff = "diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -3 +3 @@\n-a\n+b\n@@ -7,2 +6,0 @@\n-c\n-d\n@@ -9,0 +10,2 @@\n+e\ndiff --git a/n b/n\n--- /dev/null\n+++ b/n\n@@ -0,0 +1 @@\n+f\n";
  assert.deepEqual([...deletedRanges(diff)], [["x", [[3, 3], [7, 8]]]]);
});

test("blamed commits skip blank lines", () => {
  const sha = "a".repeat(40);
  assert.deepEqual(blamedCommits(`${sha} 1 1 2\nauthor X\n\tcode\n${sha} 2 2\n\t   \n`), [sha]);
});

test("changing a line an earlier merge wrote is rework; appending after it is not", () => {
  const earlier = new Map([[a, 1]]);
  assert.deepEqual(fixesByBlame(dir, change, earlier, []), [1]);
  assert.deepEqual(fixesByBlame(dir, append, earlier, []), []);
});

test("only the earlier merges given count; generated files never do", () => {
  assert.deepEqual(fixesByBlame(dir, old, new Map([[a, 1]]), []), [], "the changed line was written by base");
  assert.deepEqual(fixesByBlame(dir, old, new Map([[base, 7]]), []), [7]);
  assert.deepEqual(fixesByBlame(dir, lockOnly, new Map([[a, 1]]), []), [1], "an ordinary file");
  assert.deepEqual(fixesByBlame(dir, lockOnly, new Map([[a, 1]]), ["lock.json"]), [], "marked generated");
  assert.deepEqual(fixesByBlame(dir, change, new Map(), []), [], "nothing to compare, no git call");
});

test("a deleted line starting with -- is a line, not a file header", () => {
  assert.deepEqual([...deletedRanges("diff --git a/m.sql b/m.sql\n--- a/m.sql\n+++ b/m.sql\n@@ -2 +1,0 @@\n--- note one\n")], [["m.sql", [[2, 2]]]]);
  assert.deepEqual(fixesByBlame(dir, sqlB, new Map([[sqlA, 2]]), []), [2]);
});

test("moving a file is not rework; editing it after the move is", () => {
  assert.deepEqual(fixesByBlame(dir, moved, new Map([[a, 1], [change, 3]]), []), []);
  assert.deepEqual(fixesByBlame(dir, movedEdit, new Map([[change, 3]]), []), [3]);
});

test("header paths: trailing tab, quotes, /dev/null", () => {
  assert.equal(oldPath("a/x y.md\t"), "x y.md");
  assert.equal(oldPath('"a/tab\\there.md"'), "tab\there.md");
  assert.equal(oldPath('"a/caf\\303\\251.md"'), "caf\u00e9.md");
  assert.equal(oldPath("/dev/null"), null);
  assert.equal(oldPath("a/plain.ts"), "plain.ts");
});

test("a path with a space is blamed, not broken", () => {
  assert.deepEqual(fixesByBlame(dir, spacedEdit, new Map([[spaced, 5]]), []), [5]);
});

test("this site's own files never count as rework", () => {
  assert.deepEqual(fixesByBlame(dir, siteB, new Map([[siteA, 8]]), []), []);
});

test("hasCommit", () => {
  assert.equal(hasCommit(dir, a), true);
  assert.equal(hasCommit(dir, "f".repeat(40)), false);
});

test("a commit git does not have throws, never reads as clean", () => {
  assert.throws(() => fixesByBlame(dir, "f".repeat(40), new Map([[a, 1]]), []));
});
