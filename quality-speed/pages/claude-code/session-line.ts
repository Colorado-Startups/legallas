// Writes this Claude Code session's token line into its pull request's description, where the Claude Code page's
// collector reads it in CI. CI can't see a session's transcript, so the session reports its own count:
//
//   Claude Code session <first 8 of the session id>: <tokens> tokens, started <UTC time>
//
// Tokens: every input, cache write, cache read and output token in the session's transcript and its subagents', one
// count per API message. A forked or continued session's transcript also holds its parent's entries, under the
// parent's session id: those are left out, so no tokens count twice. Started: the session's own first entry. Only those
// numbers leave the transcript.
//
//   node quality-speed/pages/claude-code/session-line.ts [--pr <n>] [--dry-run]
//
// Run it after opening a pull request and after each push to it (the pull-request skill). It replaces this session's
// line, or adds one, so a pull request carries one line per session that worked on it. Needs CLAUDE_CODE_SESSION_ID,
// which Claude Code sets in its Bash tool, and gh signed in. Without --pr it uses the current branch's pull request.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export interface Tally {
  tokens: number;
  started: string | null;
}

/** Adds up a session's own entries in its transcripts: the main one first, then its subagents'. A message split over several lines counts once. */
export function tally(transcripts: string[], session: string): Tally {
  const seen = new Set<string>();
  let tokens = 0;
  let started: string | null = null;
  transcripts.forEach((text, i) => {
    for (const raw of text.split("\n")) {
      let entry: { sessionId?: unknown; timestamp?: unknown; message?: { id?: unknown; usage?: Record<string, unknown> } };
      try {
        entry = JSON.parse(raw);
      } catch {
        continue;
      }
      if (entry?.sessionId !== undefined && entry.sessionId !== session) continue;
      const at = typeof entry?.timestamp === "string" ? Date.parse(entry.timestamp) : NaN;
      if (i === 0 && Number.isFinite(at) && (started === null || at < Date.parse(started))) started = new Date(at).toISOString().replace(/\.\d+Z$/, "Z");
      const id = entry?.message?.id;
      const usage = entry?.message?.usage;
      if (typeof id !== "string" || !usage || seen.has(id)) continue;
      seen.add(id);
      for (const key of ["input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens", "output_tokens"]) {
        const n = usage[key];
        if (typeof n === "number" && Number.isFinite(n) && n > 0) tokens += n;
      }
    }
  });
  return { tokens, started };
}

export function lineFor(session: string, t: Tally): string {
  if (!/^[0-9a-f]{8}/.test(session) || t.started === null) throw new Error("no session id or no transcript entry to start from");
  return `Claude Code session ${session.slice(0, 8)}: ${t.tokens.toLocaleString("en-US")} tokens, started ${t.started}`;
}

/** The description with this session's line replaced, or added at the end after a blank line. */
export function upsert(body: string, line: string): string {
  const prefix = line.slice(0, line.indexOf(":") + 1);
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const at = lines.findIndex((l) => l.startsWith(prefix));
  if (at >= 0) {
    lines[at] = line;
    return lines.join("\n");
  }
  return `${body.replace(/\s+$/, "")}\n\n${line}\n`;
}

/** The session's transcript, then every transcript under its folder (subagents, workflows), from Claude Code's projects folder. */
export function transcriptsOf(session: string, projects: string): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".jsonl")) files.push(p);
    }
  };
  for (const project of existsSync(projects) ? readdirSync(projects) : []) {
    const main = join(projects, project, `${session}.jsonl`);
    if (!existsSync(main)) continue;
    files.push(main);
    if (existsSync(join(projects, project, session))) walk(join(projects, project, session));
  }
  return files;
}

function main() {
  const session = process.env.CLAUDE_CODE_SESSION_ID ?? "";
  if (!session) throw new Error("CLAUDE_CODE_SESSION_ID is not set: run this from a Claude Code session's Bash tool");
  const projects = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "projects");
  const files = transcriptsOf(session, projects);
  if (files.length === 0) throw new Error(`no transcript for this session under ${projects}`);
  const line = lineFor(session, tally(files.map((f) => readFileSync(f, "utf8")), session));
  const i = process.argv.indexOf("--pr");
  const pr = i > 0 ? process.argv[i + 1] : undefined;
  if (pr !== undefined && !/^[1-9]\d*$/.test(pr)) throw new Error("--pr takes a pull request number");
  if (process.argv.includes("--dry-run")) {
    console.log(line);
    return;
  }
  const view = JSON.parse(execFileSync("gh", ["pr", "view", ...(pr ? [pr] : []), "--json", "number,body"], { encoding: "utf8" })) as { number: number; body: string };
  execFileSync("gh", ["pr", "edit", String(view.number), "--body-file", "-"], { input: upsert(view.body ?? "", line), stdio: ["pipe", "ignore", "inherit"] });
  console.log(`#${view.number}: ${line}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main();
  } catch (e) {
    console.error(`session-line: ${(e as Error).message}`);
    process.exit(1);
  }
}
