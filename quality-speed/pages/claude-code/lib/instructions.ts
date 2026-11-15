// Broken references in the files coding agents are told to follow: every
// repository path and runnable command they name must exist. Scope: CLAUDE.md,
// AGENTS.md, REVIEW.md and everything under .claude/ (skills, agents), read at
// main's commit. Other docs belong to the Documentation page. Paths on a
// contributor's own computer (~/...), git refs, branch patterns, other
// repositories and the site's own quality-speed/ folder are left out by rule,
// before any count.

import { execFileSync } from "node:child_process";
import { posix } from "node:path";
import { git } from "./git.ts";
import type { Instructions } from "./types.ts";

/** Files REVIEW.md rule 1 says are never committed: named so agents keep them out, so absent is correct. */
const NEVER_COMMITTED = new Set([
  "web/wrangler.jsonc", "web/wrangler.mcp.jsonc", "web/legallas.config.json", ".dev.vars", "legallas-export.json", "CaseData/",
]);
const EXT = /\.(md|ts|tsx|js|mjs|json|jsonc|ya?ml|sh|py|swift|css|astro|toml|sql|html|txt)$/;
const OTHER_REPOS = /^(Colorado-Startups|anthropics|actions|github)\//;

export interface Ref {
  kind: "path" | "script" | "workflow";
  value: string;
  doc: string;
}

interface TreeEntry {
  mode: string;
  path: string;
}

/** Files tracked at a commit, so local leftovers never count as present. */
export function tree(repoDir: string, ref: string): TreeEntry[] {
  return git(repoDir, ["ls-tree", "-r", ref])
    .split("\n")
    .filter(Boolean)
    .map((l) => ({ mode: l.split(" ")[0] ?? "", path: l.split("\t")[1] ?? "" }));
}

/** The instruction files at a commit, leaving out symlinks (AGENTS.md points at CLAUDE.md). */
export function instructionFiles(entries: TreeEntry[]): string[] {
  return entries
    .filter((e) => e.mode !== "120000")
    .map((e) => e.path)
    .filter((f) => ["CLAUDE.md", "AGENTS.md", "REVIEW.md"].includes(f) || (f.startsWith(".claude/") && f.endsWith(".md")));
}

function pathLike(token: string): boolean {
  if (!/[A-Za-z]/.test(token) || /\s|[<>*{}$~@"'`=]|^[-/]|:\/\//.test(token)) return false;
  if (OTHER_REPOS.test(token) || /^(origin|\.git|quality-speed)\//.test(token)) return false;
  return token.includes("/") || EXT.test(token);
}

/** Commands whose target can be checked: node files, npm scripts, workflow runs, bash or python scripts. */
function commandRefs(cmd: string, doc: string): Ref[] {
  const c = cmd.trim().replace(/^\$\s*/, "");
  let m = /^node\s+(?:--test\s+)?(\S+\.(?:ts|js|mjs))\b/.exec(c);
  if (m) return [{ kind: "path", value: m[1]!, doc }];
  m = /^npm\s+(?:--prefix\s+(\S+)\s+)?run\s+([\w:.-]+)/.exec(c);
  if (m) return [{ kind: "script", value: `${m[1] ?? ""}#${m[2]}`, doc }];
  m = /^npm\s+(?:--prefix\s+(\S+)\s+)?test\b/.exec(c);
  if (m) return [{ kind: "script", value: `${m[1] ?? ""}#test`, doc }];
  m = /^gh\s+workflow\s+run\s+(\S+\.ya?ml)/.exec(c);
  if (m) return [{ kind: "workflow", value: m[1]!, doc }];
  m = /^(?:bash|python3?)\s+(\S+\.(?:sh|py))\b/.exec(c);
  if (m) return [{ kind: "path", value: m[1]!, doc }];
  return [];
}

/** References named in one instruction file: inline code and fenced shell lines. */
export function extractRefs(text: string, doc: string): Ref[] {
  const refs: Ref[] = [];
  const fences = /```(?:bash|sh|shell)?\n([\s\S]*?)```/g;
  for (const block of text.matchAll(fences)) {
    for (const line of (block[1] ?? "").split("\n")) refs.push(...commandRefs(line, doc));
  }
  const prose = text.replace(fences, "");
  for (const m of prose.matchAll(/`([^`\n]+)`/g)) {
    const token = (m[1] ?? "").trim();
    const cmd = commandRefs(token, doc);
    if (cmd.length > 0) refs.push(...cmd);
    else if (pathLike(token)) refs.push({ kind: "path", value: token, doc });
  }
  return refs.filter((r) => !/^(\.\/)?quality-speed\//.test(r.value));
}

export interface RepoView {
  files: string[];
  scripts: (pkgDir: string) => string[];
  /** True when .gitignore keeps the path local: named on purpose, absent by rule. */
  ignored: (path: string) => boolean;
}

function neverCommitted(v: string): boolean {
  return NEVER_COMMITTED.has(v) || [...NEVER_COMMITTED].some((n) => !v.includes("/") && posix.basename(n) === v);
}

/** Whether a reference resolves: from the root, from web/, from the doc's folder, or as a name exactly one tracked file has. */
export function resolves(ref: Ref, repo: RepoView): boolean {
  if (ref.kind === "workflow") return repo.files.includes(`.github/workflows/${ref.value}`);
  if (ref.kind === "script") {
    const [prefix, name] = ref.value.split("#");
    const dirs = prefix ? [prefix.replace(/\/$/, "")] : ["web", ".", "quality-speed"];
    return dirs.some((d) => repo.scripts(d).includes(name ?? ""));
  }
  const v = ref.value.replace(/^\.\//, "");
  const dir = v.endsWith("/");
  const docDir = posix.dirname(ref.doc);
  const candidates = [v, `web/${v}`, posix.normalize(posix.join(docDir, v))].map((p) => (dir && !p.endsWith("/") ? `${p}/` : p));
  if (neverCommitted(v)) return !repo.files.some((f) => candidates.some((p) => f === p || f.startsWith(p)) || posix.basename(f) === v);
  const hit = (p: string) => (dir ? repo.files.some((f) => f.startsWith(p)) : repo.files.includes(p));
  if (candidates.some(hit)) return true;
  if (candidates.some((p) => repo.ignored(p))) return true;
  if (dir && v.split("/").length === 2) {
    const parents = new Set(repo.files.filter((f) => `/${f}`.includes(`/${v}`)).map((f) => `/${f}`.slice(0, `/${f}`.indexOf(`/${v}`))));
    return parents.size === 1;
  }
  if (!v.includes("/")) return repo.files.filter((f) => posix.basename(f) === v).length === 1;
  return false;
}

/** Broken references in the instruction files at a commit (main's, so a past moment can be read again). */
export function checkInstructions(repoDir: string, ref: string): Instructions {
  const entries = tree(repoDir, ref);
  const files = entries.map((e) => e.path);
  const show = (path: string) => git(repoDir, ["show", `${ref}:${path}`]);
  const scripts = (d: string) => {
    const file = posix.join(d, "package.json");
    return files.includes(file) ? Object.keys((JSON.parse(show(file)) as { scripts?: object }).scripts ?? {}) : [];
  };
  const ignored = (p: string) => {
    try {
      execFileSync("git", ["-C", repoDir, "check-ignore", "-q", "--no-index", p]);
      return true;
    } catch {
      return false;
    }
  };
  const repo: RepoView = { files, scripts, ignored };
  const refs = instructionFiles(entries).flatMap((doc) => extractRefs(show(doc), doc));
  return { checked: refs.length, broken: refs.filter((r) => !resolves(r, repo)).map((r) => `${r.doc}: ${r.value}`) };
}
