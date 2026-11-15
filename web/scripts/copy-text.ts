// SPDX-License-Identifier: Apache-2.0
// Card Q2. Finds the text the room shows people, so copy-voice.test.ts can hold it to DESIGN.md section 9 and
// product notices A1. Copy is: text between tags and copy attributes (aria-label, title, placeholder, alt...) in .astro
// templates and in HTML built by scripts, string literals in .ts and .json and in .astro frontmatter and scripts, and
// Markdown prose.
// Comments, identifiers, imports and type positions are not copy, and neither is a string shaped like an
// identifier (a class name, an event name, an icon id such as `scroll`).
import ts from 'typescript';

export interface CopyText {
  line: number;
  text: string;
}

/** Attributes whose values people read or hear. Every other attribute (class, id, href, d...) is code. */
const COPY_ATTRIBUTES = new Set(['aria-label', 'aria-description', 'aria-placeholder', 'aria-roledescription', 'title', 'alt', 'placeholder', 'label', 'content', 'value', 'body']);

/** A class list such as "c-button c-button--quiet docs-key": every word lowercase, some hyphenated. */
function isClassList(text: string): boolean {
  const list = text.trim().split(/\s+/);
  return list.every((word) => /^[a-z0-9]+(?:[-_]{1,2}[a-z0-9]+)*[-_]*$/.test(word)) && list.some((word) => /[-_]/.test(word));
}

/** Two words, or one capitalized word: "No open discussions.", "Documents". Not "pdf-scroll", "scroll", "a.b". */
export function looksLikeCopy(text: string): boolean {
  if (isClassList(text)) return false;
  return /\p{L}[.,;:?!)'"]?\s+[('"]?\p{L}/u.test(text) || /^\s*\p{Lu}\p{Ll}/u.test(text);
}

function lineAt(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (source.charCodeAt(i) === 10) line++;
  return line;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&mdash;|&#8212;|&#x2014;/gi, '—')
    .replace(/&nbsp;/g, ' ')
    .replace(/&(?:amp|lt|gt|quot|apos|#39);/g, (m) => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&#39;': "'" })[m] ?? m);
}

/** Text nodes and copy attributes of an HTML or Astro template. Brace expressions are left to tsCopy. */
export function htmlCopy(html: string, firstLine = 1): CopyText[] {
  const out: CopyText[] = [];
  const push = (text: string, index: number) => {
    const clean = decodeEntities(text).replace(/\s+/g, ' ').trim();
    if (clean && looksLikeCopy(clean)) out.push({ line: firstLine - 1 + lineAt(html, index), text: clean });
  };
  const body = html.replace(/<!--[\s\S]*?-->|<(script|style)\b[\s\S]*?<\/\1>/gi, (m) => m.replace(/[^\n]/g, ' '));
  const tag = /<\/?[A-Za-z][\w.:-]*((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|\{[^}]*\}|[^\s>]+))?)*)\s*\/?>/g;
  let last = 0;
  for (let match = tag.exec(body); match; match = tag.exec(body)) {
    push(body.slice(last, match.index).replace(/\{[^{}]*\}/g, ' '), last);
    last = tag.lastIndex;
    const attr = /([^\s=>/]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    for (let a = attr.exec(match[1] ?? ''); a; a = attr.exec(match[1] ?? '')) {
      if (COPY_ATTRIBUTES.has(a[1]!.toLowerCase())) push(a[2] ?? a[3] ?? '', match.index);
    }
  }
  push(body.slice(last).replace(/\{[^{}]*\}/g, ' '), last);
  return out;
}

/** Whether a literal sits where it is code: a module path, a type, a property key or an element key. */
function isCodePosition(node: ts.Node): boolean {
  const parent = node.parent;
  if (!parent) return false;
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent) || ts.isExternalModuleReference(parent)) return true;
  if (ts.isLiteralTypeNode(parent) || ts.isImportTypeNode(parent)) return true;
  if ((ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent) || ts.isPropertyDeclaration(parent)) && parent.name === node) return true;
  return ts.isElementAccessExpression(parent) && parent.argumentExpression === node;
}

/** String literals and template text of TypeScript source that read as copy. HTML inside them is read as HTML. */
export function tsCopy(source: string, firstLine = 1): CopyText[] {
  const file = ts.createSourceFile('copy.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out: CopyText[] = [];
  const take = (text: string, node: ts.Node) => {
    const line = firstLine - 1 + file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
    if (/<[A-Za-z/!]/.test(text)) out.push(...htmlCopy(text, line));
    else if (looksLikeCopy(text)) out.push({ line, text: text.replace(/\s+/g, ' ').trim() });
  };
  const visit = (node: ts.Node): void => {
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && !isCodePosition(node)) take(node.text, node);
    else if (ts.isTemplateExpression(node)) {
      // The parts around ${} read as one sentence: "Key: ${name}" is checked as "Key: … ".
      take([node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(' … '), node);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return out;
}

/** A Markdown file's paragraphs. Fenced code, inline code, comments and link targets are code. */
export function mdCopy(source: string): CopyText[] {
  const blank = (code: string) => code.replace(/[^\n]/g, ' ');
  const prose = source
    .replace(/^[ \t]*(```|~~~)[\s\S]*?^[ \t]*\1/gm, blank)
    .replace(/<!--[\s\S]*?-->|`[^`\n]*`|(?<=\])\([^)\s]*\)/g, blank);
  const out: CopyText[] = [];
  for (const match of prose.matchAll(/\S[\s\S]*?(?=\n[ \t]*\n|$)/g)) {
    const text = match[0].replace(/\s+/g, ' ').trim();
    if (looksLikeCopy(text)) out.push({ line: lineAt(prose, match.index), text });
  }
  return out;
}

/** An .astro file: frontmatter and client scripts as TypeScript, the template as HTML. */
export function astroCopy(source: string): CopyText[] {
  const out: CopyText[] = [];
  let template = source;
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
  if (front) {
    out.push(...tsCopy(front[1]!, 2));
    template = source.slice(0, front.index) + front[0].replace(/[^\n]/g, ' ') + source.slice(front.index + front[0].length);
  }
  const script = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  for (let match = script.exec(template); match; match = script.exec(template)) {
    out.push(...tsCopy(match[1]!, lineAt(template, match.index)));
  }
  const expression = /\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g;
  for (let match = expression.exec(template); match; match = expression.exec(template)) {
    out.push(...tsCopy(match[1]!, lineAt(template, match.index)));
  }
  out.push(...htmlCopy(template));
  return out;
}
