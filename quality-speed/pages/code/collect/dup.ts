// SPDX-License-Identifier: Apache-2.0
// Duplicated code: the share of code lines that sit inside a block of at least BLOCK consecutive code lines repeated
// elsewhere, the way SonarQube defines a duplicated block (10 lines; its "Sonar way" gate allows at most 3 % on new
// code, and it measures main code, not tests). Lines are compared after trimming indentation, so moved or re-indented
// copies still match. Blank, comment-only and import lines never count: a shared import list is not a copied idea.

export const BLOCK = 10;

export interface DupInput {
  file: string;
  /** The file's code lines in order: 1-based line number and its text. */
  lines: { line: number; text: string }[];
}

export interface DupResult {
  codeLines: number;
  duplicatedLines: number;
  percent: number;
  /** Duplicated line counts per file, largest first. */
  byFile: { file: string; duplicatedLines: number }[];
}

const IMPORT_LINE = /^(import\b|export\s+(\*|\{[^}]*\})\s+from\b|@_?exported\s+import\b)/;

/** A file's comparable lines: code lines, trimmed, without imports. */
export function comparableLines(lines: { line: number; text: string }[]): { line: number; text: string }[] {
  return lines.map((l) => ({ line: l.line, text: l.text.trim() })).filter((l) => l.text !== '' && !IMPORT_LINE.test(l.text));
}

/** Finds duplicated blocks across all inputs (and within one file, where the copies do not overlap). */
export function duplication(inputs: DupInput[], block = BLOCK): DupResult {
  const files = inputs.map((f) => ({ file: f.file, lines: comparableLines(f.lines) }));
  const windows = new Map<string, { f: number; i: number }[]>();
  files.forEach((f, fi) => {
    for (let i = 0; i + block <= f.lines.length; i++) {
      const key = f.lines.slice(i, i + block).map((l) => l.text).join('\n');
      const list = windows.get(key) ?? [];
      list.push({ f: fi, i });
      windows.set(key, list);
    }
  });
  const marked = files.map((f) => new Array<boolean>(f.lines.length).fill(false));
  for (const list of windows.values()) {
    if (list.length < 2) continue;
    // Copies of one window inside one file that overlap (a run of identical lines) are one block, not two.
    const distinct = list.filter((w, k) => !list.some((o, j) => j < k && o.f === w.f && Math.abs(o.i - w.i) < block));
    if (distinct.length < 2) continue;
    for (const w of list) {
      const row = marked[w.f];
      if (row) for (let k = w.i; k < w.i + block; k++) row[k] = true;
    }
  }
  let codeLines = 0;
  let duplicatedLines = 0;
  const byFile: { file: string; duplicatedLines: number }[] = [];
  files.forEach((f, fi) => {
    codeLines += f.lines.length;
    const d = (marked[fi] ?? []).filter(Boolean).length;
    duplicatedLines += d;
    if (d > 0) byFile.push({ file: f.file, duplicatedLines: d });
  });
  byFile.sort((a, b) => b.duplicatedLines - a.duplicatedLines || a.file.localeCompare(b.file));
  return { codeLines, duplicatedLines, percent: codeLines === 0 ? 0 : (100 * duplicatedLines) / codeLines, byFile };
}
