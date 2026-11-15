// SPDX-License-Identifier: Apache-2.0
// The setup guides, read as data: how many steps each AI's main path takes. Pure: the caller passes the files' text, so the
// tests need no install.

/** The four AIs a customer may connect (docs/product.md), in the page's order. */
export const AIS = ['claude', 'copilot', 'harvey', 'open_weight'] as const;
export type Ai = (typeof AIS)[number];

/** Each AI's main path: the member's steps, then the one-time admin steps, as sections of its guide. */
export const PATHS: Readonly<Record<Ai, readonly { file: string; heading: string }[]>> = {
  claude: [{ file: 'web/connect/claude-ai.md', heading: 'What you do' }],
  copilot: [
    { file: 'web/connect/copilot.md', heading: 'What you do' },
    { file: 'web/connect/copilot.md', heading: 'The Legallas agent for Microsoft 365' },
  ],
  harvey: [
    { file: 'web/connect/harvey.md', heading: 'What you do' },
    { file: 'web/connect/harvey.md', heading: 'What your Harvey admin does once' },
  ],
  open_weight: [
    { file: 'web/connect/open-weight.md', heading: 'What you do' },
    { file: 'web/connect/open-weight.md', heading: "What the room's owner does once" },
  ],
};

/** Every guide file the step count reads. */
export const GUIDE_FILES = ['web/connect/claude-ai.md', 'web/connect/copilot.md', 'web/connect/harvey.md', 'web/connect/open-weight.md'] as const;

/** The section under a heading of any level, up to the next heading; null when the heading is absent. */
export function section(markdown: string, heading: string): string[] | null {
  const lines = markdown.split('\n');
  const start = lines.findIndex((line) => /^#{1,6} /.test(line) && line.replace(/^#+ /, '').trim() === heading);
  if (start < 0) return null;
  const end = lines.findIndex((line, i) => i > start && /^#{1,6} /.test(line));
  return lines.slice(start + 1, end < 0 ? lines.length : end);
}

/**
 * Steps in a section: numbered list items that have no deeper numbered item under them, and bold numbered paragraphs
 * ("**2. Allow it.**") that have no numbered list before the next one. A parent is a group, counted by its children.
 */
export function countSteps(lines: readonly string[]): number {
  const items = lines.flatMap((line) => {
    const list = /^(\s*)\d+\.\s/.exec(line);
    if (list) return [{ bold: false, indent: list[1]!.length }];
    return /^\*\*\d+\.\s/.test(line) ? [{ bold: true, indent: -1 }] : [];
  });
  let steps = 0;
  items.forEach((item, i) => {
    const next = items[i + 1];
    if (item.bold) steps += next && !next.bold ? 0 : 1;
    else steps += next && !next.bold && next.indent > item.indent ? 0 : 1;
  });
  return steps;
}

/** An AI with no guide counts at the metric's floor, the worst, so the page reads red, not missing, until its guide lands. */
export const NO_GUIDE_STEPS = 20;

/**
 * Steps in each AI's main path. A missing guide file counts NO_GUIDE_STEPS; a missing section, or one with no counted step
 * (steps turned to prose), is null.
 */
export function stepsByAi(files: ReadonlyMap<string, string | null>): Record<Ai, number | null> {
  const out = {} as Record<Ai, number | null>;
  for (const ai of AIS) {
    if (PATHS[ai].some((part) => files.get(part.file) == null)) {
      out[ai] = NO_GUIDE_STEPS;
      continue;
    }
    let total: number | null = 0;
    for (const part of PATHS[ai]) {
      const text = files.get(part.file);
      const lines = text == null ? null : section(text, part.heading);
      const steps = lines === null ? 0 : countSteps(lines);
      total = steps === 0 || total === null ? null : total + steps;
    }
    out[ai] = total;
  }
  return out;
}

/** The worst AI's steps, the metric's value; null when any AI's count is missing. */
export function worstSteps(steps: Readonly<Record<Ai, number | null>>): number | null {
  return AIS.some((ai) => steps[ai] === null) ? null : Math.max(...AIS.map((ai) => steps[ai]!));
}
