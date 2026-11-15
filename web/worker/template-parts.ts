// SPDX-License-Identifier: Apache-2.0
// Which files under templates/ are templates, and how one splits into the parts an AI reads one at a time
// (mcp/templates.ts). The Templates page measures the same parts (quality-speed/pages/templates/collect.ts), so its
// number is what an AI gets. No imports: the MCP worker, the room and plain Node all load it.

/** The most tokens one part holds: Claude Code warns above 10,000 tokens of tool output (code.claude.com/docs/en/mcp). */
export const TEMPLATE_PART_TOKENS = 10_000;

/** Tokens as the Templates page counts them: characters over four. */
export const tokensOf = (text: string): number => Math.ceil(text.length / 4);

/**
 * True for a template: a .md file under templates/ (path relative to it, with /), except README.md files, the licence
 * record bundled-forms.md and held-back/ (not offered until a lawyer reviews it).
 */
export function isTemplateFile(path: string): boolean {
  return path.endsWith('.md') && !path.endsWith('README.md') && path !== 'bundled-forms.md' && !path.startsWith('held-back');
}

/**
 * Where a piece too big for one part may split, tried in turn: before a heading, after a blank line (a paragraph
 * break), then after a sentence's end. Never inside a sentence: one sentence over the limit stays whole.
 */
const BREAKS = [/(?=^#{1,6} )/m, /(?<=\n\n)(?=[^\n])/, /(?<=[.!?]["')\]]*\s)(?=[A-Z("'[])/];

function pieces(text: string, max: number, cost: (text: string) => number, level = 0): string[] {
  if (cost(text) <= max || level === BREAKS.length) return [text];
  return text.split(BREAKS[level]!).flatMap((piece) => pieces(piece, max, cost, level + 1));
}

/**
 * `text` in parts of at most `max`, as `cost` counts (characters by default), each part whole sections where they fit.
 * The parts joined give back `text` exactly. A sentence longer than `max` is the one part that may exceed it. A part's
 * cost is taken as the sum of its pieces' costs, so `cost` must not undercount a join (characters, or JSON escaping).
 */
export function splitText(text: string, max: number, cost: (text: string) => number = (t) => t.length): string[] {
  const parts: string[] = [];
  let [part, used] = ['', 0];
  for (const piece of pieces(text, max, cost)) {
    const size = cost(piece);
    if (part !== '' && used + size > max) {
      parts.push(part);
      [part, used] = ['', 0];
    }
    [part, used] = [part + piece, used + size];
  }
  return [...parts, part];
}

/** A template in parts of at most `maxTokens` tokens (tokensOf). */
export function templateParts(text: string, maxTokens: number = TEMPLATE_PART_TOKENS): string[] {
  return splitText(text, maxTokens * 4);
}
