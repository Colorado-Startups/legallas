// SPDX-License-Identifier: Apache-2.0
// Public symbols documented: the share of exported TypeScript declarations
// (web/, outside tests and generated types) with a /** */ comment right above
// them, and of Swift public declarations, @Model classes and views with ///.
// REVIEW.md names missing /// on public symbols, @Model classes and views.
// A comment counts from three words, so an empty block can't.

import { type Corpus } from './corpus.ts';
import { INPUTS } from './inputs.ts';

export interface SymbolRow { path: string; line: number; name: string; documented: boolean }

const TS_EXPORT = /^export\s+(?:default\s+)?(?:declare\s+)?(?:async\s+)?(?:abstract\s+)?(function\*?|const|let|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/;
const SWIFT_PUBLIC = /^\s*(?:@\w+(?:\([^)]*\))?\s+)*(?:public|open)\s+(?:(?:static|final|override|mutating|nonisolated|convenience|required|indirect)\s+)*(func|var|let|struct|class|enum|protocol|init|typealias|actor|extension|subscript)\b\s*([A-Za-z_][\w]*)?/;
const SWIFT_MODEL = /^\s*@Model\s*$|^\s*@Model\s+(?:final\s+)?class\s+(\w+)/;
const SWIFT_VIEW = /^\s*(?:public\s+|private\s+|fileprivate\s+|internal\s+)?struct\s+(\w+)\s*:\s*(?:[\w, ]*\b)?View\b/;

export function tsFiles(c: Corpus): string[] {
  return c.files.filter((f) => f.startsWith('web/') && /\.tsx?$/.test(f) && !/\.test\.tsx?$|\.d\.ts$|(^|\/)fixtures\//.test(f));
}

export function swiftFiles(c: Corpus): string[] {
  return c.files.filter((f) => /^(Sources|LegallasApp)\//.test(f) && f.endsWith('.swift'));
}

/** Words in a comment's text, its markers and JSDoc tags left out. */
export function commentWords(text: string): number {
  return text
    .replace(/\/\*\*|\*\/|^\s*\*|\/\/\//gm, ' ')
    .replace(/@\w+/g, ' ')
    .split(/\s+/)
    .filter((w) => /[\p{L}]/u.test(w)).length;
}

/** The text of the /** *\/ block that ends on line `end`, or null when that block is not a doc comment. */
function blockAbove(lines: string[], end: number): string | null {
  if (!/\*\/\s*$/.test(lines[end] ?? '')) return null;
  for (let k = end; k >= 0 && k > end - 200; k--) {
    if (/\/\*\*/.test(lines[k] ?? '')) return lines.slice(k, end + 1).join('\n');
    if (/\/\*(?!\*)/.test(lines[k] ?? '')) return null;
  }
  return null;
}

/**
 * Whether the declaration at index i has a doc comment directly above it (decorators and attributes skipped) of at
 * least `min_comment_words` words, so an empty block can't count.
 */
function documentedTs(lines: string[], i: number): boolean {
  let j = i - 1;
  while (j >= 0 && /^\s*@/.test(lines[j] ?? '')) j--;
  const block = j >= 0 ? blockAbove(lines, j) : null;
  return block !== null && commentWords(block) >= INPUTS.min_comment_words;
}

function documentedSwift(lines: string[], i: number): boolean {
  let j = i - 1;
  while (j >= 0 && /^\s*@\w+/.test(lines[j] ?? '')) j--;
  if (j < 0) return false;
  if (/^\s*\/\/\//.test(lines[j] ?? '')) {
    let k = j;
    while (k > 0 && /^\s*\/\/\//.test(lines[k - 1] ?? '')) k--;
    return commentWords(lines.slice(k, j + 1).join('\n')) >= INPUTS.min_comment_words;
  }
  const block = blockAbove(lines, j);
  return block !== null && commentWords(block) >= INPUTS.min_comment_words;
}

export function symbolRows(c: Corpus): SymbolRow[] {
  const out: SymbolRow[] = [];
  for (const f of tsFiles(c)) {
    const lines = c.read(f).split('\n');
    lines.forEach((l, i) => {
      const m = TS_EXPORT.exec(l);
      if (m) out.push({ path: f, line: i + 1, name: m[2] ?? '', documented: documentedTs(lines, i) });
    });
  }
  for (const f of swiftFiles(c)) {
    const lines = c.read(f).split('\n');
    lines.forEach((l, i) => {
      if (/^\s*\/\//.test(l)) return;
      const pub = SWIFT_PUBLIC.exec(l);
      const view = SWIFT_VIEW.exec(l);
      const model = SWIFT_MODEL.exec(l);
      // An extension documents nothing on its own; its members are counted one by one.
      if (pub && pub[1] !== 'extension') out.push({ path: f, line: i + 1, name: pub[2] ?? pub[1] ?? '', documented: documentedSwift(lines, i) });
      else if (view) out.push({ path: f, line: i + 1, name: view[1] ?? '', documented: documentedSwift(lines, i) });
      else if (model && model[1]) out.push({ path: f, line: i + 1, name: model[1], documented: documentedSwift(lines, i) });
      else if (model) {
        const next = lines[i + 1] ?? '';
        const cls = /class\s+(\w+)/.exec(next);
        if (cls) out.push({ path: f, line: i + 2, name: cls[1] ?? '', documented: documentedSwift(lines, i) });
      }
    });
  }
  return out;
}
