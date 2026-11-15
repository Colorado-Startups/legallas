import { test } from "node:test";
import assert from "node:assert/strict";
import { extractRefs, resolves } from "../lib/instructions.ts";
import type { RepoView } from "../lib/instructions.ts";

const repo: RepoView = {
  files: ["web/worker/sample.ts", "web/package.json", ".github/workflows/sample.yml", "docs/guide.md", "web/README.md", "README.md", "web/worker/util.ts", "docs/util.ts"],
  scripts: (d) => (d === "web" ? ["check", "test"] : []),
  ignored: (p) => p === "web/local.json",
};

test("paths and commands are taken from inline code and shell fences", () => {
  const text = [
    "Read `docs/guide.md` and `worker/sample.ts`. Run `npm run check` and `gh workflow run sample.yml`.",
    "Skip `~/code/x`, `claude/<name>`, `origin/main`, `Colorado-Startups/other`, `///`, `quality-speed/pages/x.ts` and `main`.",
    "```bash",
    "node --test worker/sample.ts",
    "git -C ~/code/x worktree add y",
    "```",
  ].join("\n");
  const refs = extractRefs(text, "CLAUDE.md").map((r) => `${r.kind}:${r.value}`);
  assert.deepEqual(refs.sort(), ["path:docs/guide.md", "path:worker/sample.ts", "path:worker/sample.ts", "script:#check", "workflow:sample.yml"].sort());
});

test("references resolve from the root, from web/, from the doc's folder, or by name", () => {
  const ok = (value: string, kind: "path" | "script" | "workflow" = "path", doc = "CLAUDE.md") => resolves({ kind, value, doc }, repo);
  assert.equal(ok("docs/guide.md"), true);
  assert.equal(ok("worker/sample.ts"), true);
  assert.equal(ok("../docs/guide.md", "path", "web/README.md"), true);
  assert.equal(ok("guide.md"), true);
  assert.equal(ok("README.md", "path", ".claude/skills/x/SKILL.md"), true);
  assert.equal(ok("util.ts"), false);
  assert.equal(ok("worker/"), true);
  assert.equal(ok("docs/missing.md"), false);
  assert.equal(ok("#check", "script"), true);
  assert.equal(ok("#deploy", "script"), false);
  assert.equal(ok("sample.yml", "workflow"), true);
  assert.equal(ok("other.yml", "workflow"), false);
});

test("never-committed and ignored files count as correct only while absent", () => {
  assert.equal(resolves({ kind: "path", value: "web/wrangler.jsonc", doc: "CLAUDE.md" }, repo), true);
  const leaked = { ...repo, files: [...repo.files, "web/wrangler.jsonc"] };
  assert.equal(resolves({ kind: "path", value: "web/wrangler.jsonc", doc: "CLAUDE.md" }, leaked), false);
  assert.equal(resolves({ kind: "path", value: "local.json", doc: "web/README.md" }, repo), true);
});
