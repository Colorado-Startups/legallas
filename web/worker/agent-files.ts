// SPDX-License-Identifier: Apache-2.0
// Agent instruction files, the folder guides: each AI tool's file of instructions for the folder it sits in. By name,
// in any folder and any ASCII case, after trimming trailing spaces: CLAUDE.md, CLAUDE.local.md, AGENTS.md,
// AGENTS.override.md, GEMINI.md, copilot-instructions.md (matched .github/ or not), CONVENTIONS.md (Aider), .cursorrules,
// .windsurfrules, .clinerules and .junie/guidelines.md. By folder, everything under .claude/, .cursor/ (its rules/*.mdc
// and the rest), .gemini/, .clinerules/ (Cline's folder form), .windsurf/rules/ and .github/instructions/ (Copilot's
// path-specific *.instructions.md). #257 and its follow-ups. The sync mirrors them, so counsel can still open them, and
// the room shows a folder's CLAUDE.md as its "Folder guide" (files-catalog.ts GUIDE_NAME). They never reach the index:
// they summarize and instruct, and Ask Legallas must not read them as case evidence (one ranked first for a filing-date
// question, eval of 2026-10-02). The MCP leaves them out of what it lists for the same reason, and a deal room's guest
// never sees one (rooms.ts). One rule in two forms: isAgentFile for code (the index uses it through scripts/extract.ts)
// and AGENT_FILE_SQL for catalog queries, both built from the two lists below; agent-files.test.ts keeps the two equal.
// No imports, so the scripts and both Workers can use it.

/** The file names, lowercase. A name with a slash is a path ending (a file in that folder). */
const AGENT_NAMES = [
  'claude.md', 'claude.local.md', 'agents.md', 'agents.override.md', 'gemini.md', 'copilot-instructions.md', 'conventions.md',
  '.cursorrules', '.windsurfrules', '.clinerules', '.junie/guidelines.md',
];

/** The folders whose every file is one, lowercase, as a path inside the shared folder. */
const AGENT_FOLDERS = ['.claude', '.cursor', '.gemini', '.clinerules', '.windsurf/rules', '.github/instructions'];

/** A list as regex alternatives: literal, with either slash between parts. */
const alternatives = (list: readonly string[]) =>
  list.map((entry) => entry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\//g, '[\\\\/]')).join('|');

const AGENT_FILE = new RegExp(`(?:^|[\\\\/])(?:${alternatives(AGENT_NAMES)})$|(?:^|[\\\\/])(?:${alternatives(AGENT_FOLDERS)})[\\\\/]`, 'i');

/**
 * True for an agent instruction file. `rel` is the path inside the shared folder, never an absolute path, whose
 * parents could be anything (this repo's own worktrees live under .claude/).
 */
export function isAgentFile(rel: string): boolean {
  return AGENT_FILE.test(rel.replace(/ +$/, ''));
}

/**
 * documents.path as isAgentFile reads it: trailing spaces trimmed, lowercase (ASCII only, like the non-Unicode /i
 * above), every backslash a slash, and a slash in front, so "start of path or after a separator" is just "after a slash".
 */
const AGENT_PATH = "('/' || replace(lower(rtrim(path, ' ')), '\\', '/'))";

const AGENT_PATTERNS = [...AGENT_NAMES.map((name) => `'%/${name}'`), ...AGENT_FOLDERS.map((folder) => `'%/${folder}/%'`)];

/** isAgentFile(path) as a SQL condition on a documents row. The patterns hold no LIKE wildcard (_ or %) of their own. */
export const AGENT_FILE_SQL = `(${AGENT_PATTERNS.map((pattern) => `${AGENT_PATH} LIKE ${pattern}`).join(' OR ')})`;

/** Every row but the agent instruction files. */
export const NOT_AGENT_FILE_SQL = `NOT ${AGENT_FILE_SQL}`;
