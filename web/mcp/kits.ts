// SPDX-License-Identifier: Apache-2.0
// The six kits as data, with no imports, so the public /connect page (pages/connect.ts) names them without loading the
// MCP prompts (prompts.ts, which re-exports them).

/**
 * The six kits, in the order clients list them: the prompt's name, its reference in connect/skill/legallas/references/,
 * and the task line it opens with. No arguments: a kit that needs the user's words (the grid's columns, the draft for a
 * cite check) asks for them, so nothing the user types enters the template.
 */
export const KITS = [
  { prompt: 'matter_board', file: 'board', title: 'Matter board', task: 'Build a matter board', description: 'Each matter, track or open item with its owner, next step and next deadline, with cites.' },
  { prompt: 'review_grid', file: 'grid', title: 'Review grid', task: 'Build a review grid', description: 'One row per document, one column per question; each cell a value, state, quote and location.' },
  { prompt: 'cite_check', file: 'cite-check', title: 'Cite check', task: 'Check every cite in a draft', description: 'Every cite in a draft checked against the record and the law library: supported, wrong page, misquoted or not found.' },
  { prompt: 'matter_chronology', file: 'chronology', title: 'Chronology', task: 'Build a chronology of the matter', description: "The matter's dated events, weighted, with sources and gaps." },
  { prompt: 'entity_matrix', file: 'entity-matrix', title: 'Entity-choice matrix', task: 'Compare a Colorado LLC, a Colorado C corporation and a Delaware C corporation for this company', description: 'Three company forms side by side on fees, tax, stock, voting and investors, each cell cited.' },
  { prompt: 'deviation_board', file: 'deviation', title: 'Deviation board', task: "Compare the deal documents' terms with the standard terms", description: 'Each deal term as standard, deviation or missing against standard SAFE, note, side letter and Series Seed terms, with quotes.' },
] as const;
export type Kit = (typeof KITS)[number];
