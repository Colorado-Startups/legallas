// Local git reads for the Claude Code collector. They need a checkout of main with
// full history (actions/checkout with fetch-depth: 0).

import { execFileSync } from "node:child_process";

export function git(repoDir: string, args: string[]): string {
  return execFileSync("git", ["-C", repoDir, ...args], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
}

export function parentCount(repoDir: string, sha: string): number {
  return git(repoDir, ["rev-list", "--parents", "-n", "1", sha]).trim().split(/\s+/).length - 1;
}

export function subject(repoDir: string, sha: string): string {
  return git(repoDir, ["log", "-1", "--format=%s", sha]).trim();
}
