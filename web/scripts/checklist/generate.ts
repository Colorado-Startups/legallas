// SPDX-License-Identifier: Apache-2.0
// Writes what's generated from the checklist, docs/checklist/baseline.toml: the README beside it, and worker/checklist-baseline.ts,
// the copy the room serves. Run `npm run checklist` after any change to the toml or README.template.md. Never edit either
// by hand: generate.test.ts fails when they differ.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBaseline } from './baseline.ts';
import { renderReadme } from './readme.ts';

const here = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url));
export const README_PATH = here('../../../docs/checklist/README.md');

/** Each generated path with the text it must hold. */
export function expectedFiles(): [path: string, text: string][] {
  const baseline = parseBaseline(readFileSync(here('../../../docs/checklist/baseline.toml'), 'utf8'));
  return [
    [README_PATH, renderReadme(readFileSync(here('../../../docs/checklist/README.template.md'), 'utf8'), baseline)],
    [
      here('../../worker/checklist-baseline.ts'),
      [
        '// SPDX-License-Identifier: Apache-2.0',
        '// Generated from docs/checklist/baseline.toml by scripts/checklist/generate.ts. Never edit this by hand.',
        "import type { ChecklistBaseline } from './checklist-types.ts';",
        '',
        `export const BASELINE: ChecklistBaseline = ${JSON.stringify(baseline, null, 2)};`,
        '',
      ].join('\n'),
    ],
  ];
}

if (import.meta.main) for (const [path, text] of expectedFiles()) writeFileSync(path, text);
