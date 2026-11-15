// SPDX-License-Identifier: Apache-2.0
// Writes what's generated from templates/, so the Workers read templates without a file system:
//   worker/templates.generated.ts      the list: each template's path, title and entity types (small; the room loads it)
//   mcp/template-text.generated.ts     each template's text, for legallas_template only
// Plain text, one source line per text line, so a diff shows the line that changed and the pre-push scan reads it.
// Run `npm run templates` after any change under templates/. Never edit either by hand: generate.test.ts fails when they
// differ.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isTemplateFile } from '../../worker/template-parts.ts';

const here = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url));
const DIR = here('../../../templates/');
const HEADER = '// Generated from templates/ by scripts/templates/generate.ts (npm run templates). Never edit this by hand.';

export interface Template {
  path: string;
  title: string;
  entity: string[];
  text: string;
}

/** Every template under templates/, sorted by path, with its title and entity types from its front matter. */
export function readTemplates(dir: string = DIR): Template[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .map((path) => path.split('\\').join('/'))
    .filter(isTemplateFile)
    .sort()
    .map((path) => {
      const text = readFileSync(join(dir, path), 'utf8');
      const front = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? '';
      const title = /^title: (.+)$/m.exec(front)?.[1]?.trim() ?? '';
      const entity = (/^entity: \[(.*)\]$/m.exec(front)?.[1] ?? '').split(',').map((type) => type.trim()).filter(Boolean);
      if (!title || entity.length === 0) throw new Error(`templates/${path}: front matter needs a title and an entity list`);
      return { path, title, entity, text };
    });
}

/** Each generated path with the text it must hold. */
export function expectedFiles(templates: readonly Template[] = readTemplates()): [path: string, text: string][] {
  return [
    [
      here('../../worker/templates.generated.ts'),
      [
        '// SPDX-License-Identifier: Apache-2.0',
        HEADER,
        '',
        '/** One template: its path under templates/, title and the entity types it is written for, from its front matter. */',
        'export interface TemplateEntry {',
        '  path: string;',
        '  title: string;',
        '  entity: readonly string[];',
        '}',
        '',
        '/** Every template (worker/template-parts.ts isTemplateFile), by path. */',
        'export const TEMPLATES: readonly TemplateEntry[] = [',
        ...templates.map(({ path, title, entity }) => `  ${JSON.stringify({ path, title, entity })},`),
        '];',
        '',
      ].join('\n'),
    ],
    [
      here('../../mcp/template-text.generated.ts'),
      [
        '// SPDX-License-Identifier: Apache-2.0',
        HEADER,
        '',
        '/** Each template\'s text, by its path in TEMPLATES (worker/templates.generated.ts). */',
        'export const TEMPLATE_TEXT: Readonly<Record<string, string>> = {',
        ...templates.map(({ path, text }) => `  ${JSON.stringify(path)}: [\n${text.split('\n').map((line) => `    ${JSON.stringify(line)},`).join('\n')}\n  ].join('\\n'),`),
        '};',
        '',
      ].join('\n'),
    ],
  ];
}

if (import.meta.main) for (const [path, text] of expectedFiles()) writeFileSync(path, text);
