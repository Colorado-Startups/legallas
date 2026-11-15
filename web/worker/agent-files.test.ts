// SPDX-License-Identifier: Apache-2.0
// The folder-guide rule in its two forms: isAgentFile (code) and AGENT_FILE_SQL (catalog queries) must agree on
// every path, so the index and the MCP's lists leave out exactly the same files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { AGENT_FILE_SQL, isAgentFile, NOT_AGENT_FILE_SQL } from './agent-files.ts';
import { isAgentFile as indexRule } from '../scripts/extract.ts';

const AGENT = [
  'CLAUDE.md', 'a/b/CLAUDE.md', 'a/claude.md', 'Claude.MD', 'AGENTS.md', 'a/AGENTS.md', 'a/agents.md',
  '.claude/notes.md', 'a/.claude/x/plan.csv', 'a/.CLAUDE/settings.json', 'a\\CLAUDE.md', 'a\\.claude\\x.md',
  'a\\b/AGENTS.md', 'from-counsel/d-up/CLAUDE.md', '07-Lawyer-Notes-PRIVILEGED/CLAUDE.md',
  // #257: the other AIs' names for the same file.
  'CLAUDE.local.md', 'a/claude.LOCAL.md', 'GEMINI.md', 'a/b/gemini.md', 'AGENTS.override.md', 'a\\agents.override.md',
  '.github/copilot-instructions.md', 'a/Copilot-Instructions.MD',
  // The rest of each AI's names: Copilot's path-specific files, Cursor, Windsurf, a .gemini folder.
  '.github/instructions/tests.instructions.md', 'a/.github/instructions/x/y/react.instructions.md',
  'a\\.GitHub\\Instructions\\Style.Instructions.MD', '.github/instructions/.instructions.md', '.cursorrules',
  'a/.CursorRules', 'a\\.cursorrules', '.cursor/rules/style.mdc', 'a/.cursor/rules/x/style.md', 'a\\.Cursor\\Rules\\y.mdc',
  '.windsurfrules', 'a/.WindsurfRules', '.windsurf/rules/style.md', 'a\\.windsurf\\rules\\x.md', '.gemini/settings.json',
  'a/.GEMINI/styleguide.md', 'a\\.gemini\\commands\\x.toml',
  // The follow-up: other tools' files and folders, and a name with trailing spaces.
  'a\\.cursor\\rules\\x.mdc', 'a/.cursor/mcp.json', 'a/b/.windsurfrules', '.clinerules', 'a/.clinerules',
  '.clinerules/01-style.md', 'a/.clinerules/x.md', '.github/instructions/web.instructions.md',
  'a/.GitHub/Instructions/x.instructions.md', 'a\\.github\\instructions\\y.md', 'a/.gemini/styleguide.md',
  '.junie/guidelines.md', 'a/.Junie/Guidelines.md', 'a\\.junie\\guidelines.md', 'CONVENTIONS.md', 'a/conventions.md',
  'a/CLAUDE.md ', 'a/GEMINI.md   ', 'a/.cursorrules ', 'a/.cursor/rules/x.mdc ',
  // Visible under #475's rule, hidden by the follow-up's whole .cursor and .github/instructions folders.
  'a/.github/instructions/x.instructions.md.pdf', 'a/.github/instructions/notes.md', 'a/.cursor/notes.md', 'a/.cursor/rules',
  'a/.cursor/rulesx/y.mdc',
];
const NOT_AGENT = [
  'a/CLAUDE-notes.md', 'a/MY_CLAUDE.md', 'a/claude/notes.md', 'a/Claude_Reply.pdf', 'a/AGENTS.md.pdf',
  'CLAUDE.md/Doe letter.pdf', '.claude', 'a/.claude', 'a/x.claude/y.md', 'a/.claudex/y.md', 'a/CLAUDExmd',
  'a/CLAUDE_md', 'a/%/claude.md.txt', '04-Letters/Doe letter.pdf', 'from-counsel/d-up/Roe reply.pdf', '',
  'a/CLAUDE.local.md.pdf', 'a/CLAUDE.locals.md', 'a/MY_GEMINI.md', 'a/GEMINI-notes.md', 'a/AGENTS.overrides.md',
  'a/AGENTS.override', 'a/copilot-instructions.md.txt', 'a/my-copilot-instructions.md', 'a/CLAUDExlocal.md',
  'a/tests.instructions.md', 'a/github/instructions/x.instructions.md', 'a/.github/instruction/x.instructions.md',
  'a/.github/instructions', 'a/.github/instructionsx/y.instructions.md', 'a/x.github/instructions/y.instructions.md',
  'a/.github/x.instructions.md', 'a/.cursorrules.bak', 'a/my.cursorrules', 'a/cursorrules', 'a/cursor/rules/y.mdc',
  'a/x.cursor/rules/y.mdc', 'a/.windsurfrules.txt', 'a/windsurfrules', 'a/.windsurf/notes.md', 'a/.windsurf/rules',
  'a/windsurf/rules/y.md', '.gemini', 'a/.gemini', 'a/.geminix/y.md', 'a/x.gemini/y.md', 'a/gemini/settings.json',
  // The follow-up's near misses.
  'a/.cursor', 'a/.cursorx/y.md', 'a/x.cursor/y.md', 'a/.windsurfrules.md', 'a/.clinerulesx', 'a/github/instructions/x.md',
  'a/.github/instructionsx/y.md', 'a/.github/x/instructions/y.md', 'a/guidelines.md', 'a/.junie/other.md',
  'a/.junieguidelines.md', 'a/CONVENTIONS.md.pdf', 'a/MY-CONVENTIONS.md', 'a/CLAUDE.md x', 'a/ CLAUDE.md.pdf ', 'a/.claude ',
];

const sqlite = new DatabaseSync(':memory:');
const sqlRule = (path: string) => {
  const row = sqlite.prepare(`SELECT ${AGENT_FILE_SQL} AS hit, ${NOT_AGENT_FILE_SQL} AS miss FROM (SELECT ? AS path)`).get(path) as { hit: number; miss: number };
  assert.equal(row.hit + row.miss, 1, `exactly one of the two conditions holds for ${path}`);
  return row.hit === 1;
};

test('isAgentFile knows the folder guides and nothing that only looks like one', () => {
  for (const path of AGENT) assert.equal(isAgentFile(path), true, path);
  for (const path of NOT_AGENT) assert.equal(isAgentFile(path), false, path);
});

test('AGENT_FILE_SQL agrees with isAgentFile on every path', () => {
  for (const path of [...AGENT, ...NOT_AGENT]) assert.equal(sqlRule(path), isAgentFile(path), path);
});

test('the index reads the same rule (scripts/extract.ts re-exports it)', () => {
  assert.equal(indexRule, isAgentFile);
});
