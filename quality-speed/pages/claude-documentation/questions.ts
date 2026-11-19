// SPDX-License-Identifier: Apache-2.0
// questions_true: the fixed start questions (questions.json), checked without an AI. Each answer must be stated where the
// set says (doc), be true in the code (truth), and no doc or config comment may contradict it (conflicts). Moved from the
// Documentation page with its question set, unchanged; the corpus here keeps only what the check reads.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';

export type Truth =
  | { kind: 'file'; path: string }
  | { kind: 'script'; name: string }
  | { kind: 'grep'; path: string; pattern: string; comments?: boolean }
  | { kind: 'count'; path: string; pattern: string; equals: number; comments?: boolean }
  /** The code's count of `pattern` equals the number the doc states (the doc pattern's first group), whatever it is. */
  | { kind: 'count_as_doc'; path: string; pattern: string; comments?: boolean };

export interface Question {
  id: string;
  audience: 'agent' | 'person';
  question: string;
  accept: string[];
  reject?: string[];
  doc: { path: string; pattern: string };
  truth: Truth[];
  conflicts?: string[];
}

export interface QuestionResult { id: string; stated: boolean; true: boolean; conflicts: number; pass: boolean }

/** What the check reads: tracked files, each Markdown doc's lines, and the full-line comments agents read in .github. */
export interface Corpus {
  fileSet: Set<string>;
  docs: Map<string, string[]>;
  comments: Map<string, string[]>;
  read(path: string): string;
}

/** Every tracked Markdown file but this site's own folder, which must not raise its own score. */
const isDoc = (f: string) => f.endsWith('.md') && !f.startsWith('quality-speed/');
const isCommented = (f: string) => f.startsWith('.github/') && /\.(ya?ml|sh|py)$/.test(f);

export function loadCorpus(root: string): Corpus {
  const out = execFileSync('git', ['-C', root, 'ls-files', '-s', '-z'], { encoding: 'utf8', maxBuffer: 64 << 20 });
  const fileSet = new Set<string>();
  const links = new Set<string>();
  for (const rec of out.split('\0')) {
    if (!rec || rec.includes(' commit ')) continue;
    const path = rec.slice(rec.indexOf('\t') + 1);
    fileSet.add(path);
    // AGENTS.md links to CLAUDE.md: read once, by its real path.
    if (rec.startsWith('120000')) links.add(path);
  }
  const read = (p: string) => readFileSync(posix.join(root, p), 'utf8');
  const docs = new Map<string, string[]>();
  const comments = new Map<string, string[]>();
  for (const p of [...fileSet].sort()) {
    if (links.has(p)) continue;
    if (isDoc(p)) docs.set(p, read(p).split(/\r?\n/));
    else if (isCommented(p)) {
      const lines = read(p)
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((t) => t.startsWith('#') && !t.startsWith('#!'))
        .map((t) => t.replace(/^#+\s?/, ''))
        .filter(Boolean);
      if (lines.length) comments.set(p, lines);
    }
  }
  return { fileSet, docs, comments, read };
}

export function loadQuestions(path: string): Question[] {
  return (JSON.parse(readFileSync(path, 'utf8')) as { questions: Question[] }).questions;
}

/** A doc's lines, or a commented config file's with the comment markers removed. */
function readableLines(c: Corpus, path: string): string[] | null {
  if (!c.fileSet.has(path)) return null;
  return c.docs.get(path) ?? c.read(path).split(/\r?\n/).map((l) => (l.trim().startsWith('#') ? l.trim().replace(/^#+\s?/, '') : ''));
}

/** The only places this file compiles a pattern, one per way of matching. Each comes from this page's own questions.json, which is reviewed like code. */
const anyCase = (pattern: string) => new RegExp(pattern, 'i');
const perLine = (pattern: string) => new RegExp(pattern, 'm');
const everyLine = (pattern: string) => new RegExp(pattern, 'gm');

/** First line where `pattern` matches, joining each line with the next so a phrase may wrap. */
export function findLine(lines: string[], pattern: string): number | null {
  const re = anyCase(pattern);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const next = lines[i + 1] ?? '';
    if (re.test(line) || (line.trim() !== '' && re.test(`${line} ${next}`) && !re.test(next))) return i + 1;
  }
  return null;
}

/** The code without its comments, so a truth proves what the code does; lines keep their places. */
export function stripComments(path: string, text: string): string {
  if (/\.(ya?ml|sh|py|toml)$|(^|\/)\.gitignore$/.test(path)) {
    return text.split('\n').map((l) => (/^\s*#/.test(l) ? '' : l.replace(/\s+#\s.*$/, ''))).join('\n');
  }
  if (/\.(ts|tsx|js|mjs|swift|jsonc)$/.test(path)) {
    return text
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ''))
      .split('\n')
      .map((l) => (/^\s*\/\//.test(l) ? '' : l.replace(/\s\/\/\s.*$/, '')))
      .join('\n');
  }
  return text;
}

const codeOf = (c: Corpus, path: string, comments?: boolean) => (comments ? c.read(path) : stripComments(path, c.read(path)));

/** The doc pattern's first capture group where the doc states the answer, or null. */
export function docValue(c: Corpus, q: Question): string | null {
  const lines = readableLines(c, q.doc.path);
  const line = lines ? findLine(lines, q.doc.pattern) : null;
  if (!lines || line === null) return null;
  const re = anyCase(q.doc.pattern);
  const m = re.exec(lines[line - 1] ?? '') ?? re.exec(`${lines[line - 1] ?? ''} ${lines[line] ?? ''}`);
  return m?.[1] ?? null;
}

export function checkTruth(c: Corpus, t: Truth, stated: string | null = null): boolean {
  const count = (path: string, pattern: string, comments?: boolean) => (codeOf(c, path, comments).match(everyLine(pattern)) ?? []).length;
  switch (t.kind) {
    case 'file':
      return c.fileSet.has(t.path);
    case 'script':
      return c.fileSet.has('web/package.json') && Object.hasOwn(JSON.parse(c.read('web/package.json')).scripts ?? {}, t.name);
    case 'grep':
      return c.fileSet.has(t.path) && perLine(t.pattern).test(codeOf(c, t.path, t.comments));
    case 'count':
      return c.fileSet.has(t.path) && count(t.path, t.pattern, t.comments) === t.equals;
    case 'count_as_doc':
      return stated !== null && c.fileSet.has(t.path) && count(t.path, t.pattern, t.comments) === Number(stated);
  }
}

/** Lines in any doc or config comment that say what a conflict pattern matches. */
function conflictsOf(c: Corpus, patterns: string[]): number {
  const res = patterns.map((p) => anyCase(p));
  let n = 0;
  for (const lines of [...c.docs.values(), ...c.comments.values()]) {
    for (let i = 0; i < lines.length; i++) {
      const next = lines[i + 1] ?? '';
      if (res.some((r) => r.test(lines[i] ?? '') || (r.test(`${lines[i]} ${next}`) && !r.test(next)))) n++;
    }
  }
  return n;
}

export function checkQuestions(c: Corpus, questions: Question[]): QuestionResult[] {
  return questions.map((q) => {
    const lines = readableLines(c, q.doc.path);
    const stated = (lines ? findLine(lines, q.doc.pattern) : null) !== null;
    const isTrue = q.truth.every((t) => checkTruth(c, t, docValue(c, q)));
    const conflicts = conflictsOf(c, q.conflicts ?? []);
    return { id: q.id, stated, true: isTrue, conflicts, pass: stated && isTrue && conflicts === 0 };
  });
}
