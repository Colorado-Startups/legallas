// SPDX-License-Identifier: Apache-2.0
// The pure half of the template page (src/pages/template.astro, src/scripts/template-page.ts): which file a link may open,
// and a template file's front matter split from its text. No DOM, so node --test covers it.

/** A founder template the room serves under /templates/ (integrations/template-assets.mjs): nothing else opens. */
const TEMPLATE_PATH = /^founders\/[a-z0-9][a-z0-9-]{0,80}\.md$/;

/** The template a page link names, or null for anything else. */
export function templatePath(value: string | null): string | null {
  return value !== null && TEMPLATE_PATH.test(value) ? value : null;
}

/** The file itself, as served: for download, and to edit. */
export const fileHref = (path: string): string => `/templates/${path}`;

/** The readable page for a template. */
export const pageHref = (path: string): string => `/template/?path=${encodeURIComponent(path)}`;

/** A template file split into its front matter and its body text. */
export interface TemplateFile {
  /** The front matter's top-level `key: value` lines; lists and nested keys are left out. */
  meta: Record<string, string>;
  /** The text after the front matter. */
  body: string;
}

/** Splits a template into the key-value lines of its front matter and the text after it. */
export function splitTemplate(text: string): TemplateFile {
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!match) return { meta: {}, body: text };
  const meta: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const pair = /^([a-z_]+):[ \t]*(\S.*)$/.exec(line);
    if (pair && !pair[2]!.startsWith('[')) meta[pair[1]!] = pair[2]!.trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return { meta, body: text.slice(match[0].length) };
}
