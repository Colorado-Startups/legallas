// SPDX-License-Identifier: Apache-2.0
// The fixed question set, checked without an AI: each answer must be stated
// where the set says (doc), be true in the code (truth), and no doc or config
// comment may contradict it (conflicts). Each question's accept and reject
// patterns, and grade(), are for an agent answering the same set, a lane
// for later.

import { readFileSync } from 'node:fs';
import { type Corpus } from './corpus.ts';

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
  /** An answer matching any of these is wrong, whatever it also says. */
  reject?: string[];
  doc: { path: string; pattern: string };
  truth: Truth[];
  conflicts?: string[];
}

export interface QuestionResult {
  id: string;
  stated: boolean;
  true: boolean;
  conflicts: { path: string; line: number }[];
  pass: boolean;
  /** 1-based line of the answer in `doc`, for the reading-time model. */
  line: number | null;
}

export function loadQuestions(path: string): Question[] {
  return (JSON.parse(readFileSync(path, 'utf8')) as { questions: Question[] }).questions;
}

/** Text lines of a doc or a commented config file, as a reader sees them (comments with their markers removed). */
export function readableLines(c: Corpus, path: string): string[] | null {
  if (!c.fileSet.has(path)) return null;
  const doc = c.docs.get(path);
  if (doc) return doc.lines;
  return c.read(path).split(/\r?\n/).map((l) => (l.trim().startsWith('#') ? l.trim().replace(/^#+\s?/, '') : ''));
}

/** First line where `pattern` matches, joining each line with the next so a phrase may wrap. */
export function findLine(lines: string[], pattern: string): number | null {
  const re = new RegExp(pattern, 'i');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const next = lines[i + 1] ?? '';
    // The joined form counts only when the match truly wraps, not when it sits wholly on the next line.
    if (re.test(line) || (line.trim() !== '' && re.test(`${line} ${next}`) && !re.test(next))) return i + 1;
  }
  return null;
}

/**
 * The code without its comments, so a truth proves what the code does, not what a comment says. Line comments
 * (`//` at a line's start or after a space), block comments and `#` comments are dropped; lines keep their places.
 */
export function stripComments(path: string, text: string): string {
  if (/\.(ya?ml|sh|py|toml)$|(^|\/)\.gitignore$/.test(path)) {
    return text
      .split('\n')
      .map((l) => (/^\s*#/.test(l) ? '' : l.replace(/\s+#\s.*$/, '')))
      .join('\n');
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

function codeOf(c: Corpus, path: string, comments?: boolean): string {
  const raw = c.read(path);
  return comments ? raw : stripComments(path, raw);
}

/** The doc pattern's first capture group where the doc states the answer, as a number in text, or null. */
export function docValue(c: Corpus, q: Question): string | null {
  const lines = readableLines(c, q.doc.path);
  const line = lines ? findLine(lines, q.doc.pattern) : null;
  if (!lines || line === null) return null;
  const re = new RegExp(q.doc.pattern, 'i');
  const m = re.exec(lines[line - 1] ?? '') ?? re.exec(`${lines[line - 1] ?? ''} ${lines[line] ?? ''}`);
  return m?.[1] ?? null;
}

export function checkTruth(c: Corpus, t: Truth, stated: string | null = null): boolean {
  switch (t.kind) {
    case 'file':
      return c.fileSet.has(t.path);
    case 'script': {
      if (!c.fileSet.has('web/package.json')) return false;
      return Object.hasOwn(JSON.parse(c.read('web/package.json')).scripts ?? {}, t.name);
    }
    case 'grep':
      return c.fileSet.has(t.path) && new RegExp(t.pattern, 'm').test(codeOf(c, t.path, t.comments));
    case 'count':
      return c.fileSet.has(t.path) && (codeOf(c, t.path, t.comments).match(new RegExp(t.pattern, 'gm')) ?? []).length === t.equals;
    case 'count_as_doc':
      return stated !== null && c.fileSet.has(t.path) && (codeOf(c, t.path, t.comments).match(new RegExp(t.pattern, 'gm')) ?? []).length === Number(stated);
  }
}

function conflictsOf(c: Corpus, patterns: string[]): { path: string; line: number }[] {
  if (patterns.length === 0) return [];
  const res = patterns.map((p) => new RegExp(p, 'i'));
  const out: { path: string; line: number }[] = [];
  const scan = (path: string, lines: string[]) => {
    for (let i = 0; i < lines.length; i++) {
      const joined = `${lines[i]} ${lines[i + 1] ?? ''}`;
      if (res.some((r) => r.test(lines[i] ?? '') || (r.test(joined) && !r.test(lines[i + 1] ?? '')))) out.push({ path, line: i + 1 });
    }
  };
  for (const doc of c.docs.values()) scan(doc.path, doc.lines);
  const byFile = new Map<string, string[]>();
  for (const cm of c.comments) {
    const lines = byFile.get(cm.path) ?? [];
    lines.push(cm.text);
    byFile.set(cm.path, lines);
  }
  for (const [path, lines] of byFile) scan(path, lines);
  return out;
}

/** The doc's value only when the code proves it, so grading never credits a number a drifted doc gives. */
export function provenValue(c: Corpus, q: Question): string | null {
  const value = docValue(c, q);
  return value !== null && q.truth.every((t) => checkTruth(c, t, value)) ? value : null;
}

export function checkQuestions(c: Corpus, questions: Question[]): QuestionResult[] {
  return questions.map((q) => {
    const lines = readableLines(c, q.doc.path);
    const line = lines ? findLine(lines, q.doc.pattern) : null;
    const value = docValue(c, q);
    const isTrue = q.truth.every((t) => checkTruth(c, t, value));
    const conflicts = conflictsOf(c, q.conflicts ?? []);
    const stated = line !== null;
    return { id: q.id, stated, true: isTrue, conflicts, pass: stated && isTrue && conflicts.length === 0, line };
  });
}

/**
 * Grades an agent's answer: every accept pattern must match, and no reject pattern may. `{doc}` in an accept pattern
 * stands for the value the doc states and the code proves (provenValue), so a count can grow without the question
 * changing; with no proven value, every answer to it is wrong.
 */
export function grade(q: Question, answer: string, stated: string | null = null): boolean {
  if ((q.reject ?? []).some((p) => new RegExp(p, 'i').test(answer))) return false;
  return q.accept.every((p) => {
    if (!p.includes('{doc}')) return new RegExp(p, 'i').test(answer);
    return stated !== null && new RegExp(p.replaceAll('{doc}', stated.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'i').test(answer);
  });
}
