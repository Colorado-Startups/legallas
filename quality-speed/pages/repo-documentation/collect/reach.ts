// SPDX-License-Identifier: Apache-2.0
// Reading time to the answer: how many words a reader must read, starting at
// the entry doc (CLAUDE.md for an agent, README.md for a person), to reach
// each question's answer, following the docs' own links and file mentions.
//
// The reader skims a doc's headings, then reads the one section that holds
// the link or the answer, from its heading down to that line. The cheapest
// path wins (Dijkstra). Words become minutes at 238 a minute, the average
// adult silent reading rate for English non-fiction (Brysbaert 2019).

import { posix } from 'node:path';
import { type Corpus, commentFiles } from './corpus.ts';
import { INPUTS } from './inputs.ts';
import { type Question, readableLines, findLine } from './questions.ts';

export const WORDS_PER_MINUTE = INPUTS.words_per_minute;
export const ENTRY = INPUTS.entry;

const FILE_TOKEN = /[\w.@/-]+\.(?:md|ya?ml)\b/g;
// A folder named with a trailing slash leads to its README.md, as GitHub shows it.
const DIR_TOKEN = /(?<![\w.@/-])([\w.@-]+(?:\/[\w.@-]+)*)\/(?![\w.@-])/g;

function words(line: string): number {
  return line.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

interface Readable {
  lines: string[];
  /** Line numbers (1-based) where a section starts. */
  starts: number[];
  headingWords: number;
}

function readable(c: Corpus, path: string, cache: Map<string, Readable | null>): Readable | null {
  if (cache.has(path)) return cache.get(path)!;
  let r: Readable | null = null;
  const doc = c.docs.get(path);
  if (doc) {
    r = { lines: doc.lines, starts: [1, ...doc.headings.map((h) => h.line)], headingWords: doc.headings.reduce((n, h) => n + words(h.text), 0) };
  } else {
    const lines = readableLines(c, path);
    if (lines) {
      // A commented config file: each run of comment lines is a section.
      const starts = [1];
      for (let i = 1; i < lines.length; i++) if (lines[i] && !lines[i - 1]) starts.push(i + 1);
      r = { lines, starts, headingWords: 0 };
    }
  }
  cache.set(path, r);
  return r;
}

/** Words read to reach `line` in a doc: its headings, then its section down to that line. */
export function costTo(r: Readable, line: number): number {
  let start = 1;
  for (const s of r.starts) if (s <= line) start = s;
  let n = r.headingWords;
  for (let i = start; i <= line; i++) n += words(r.lines[i - 1] ?? '');
  return n;
}

function targetsOf(c: Corpus, from: string, token: string, readableSet: Set<string>): string | null {
  const clean = token.replace(/^\.\//, '');
  const tries = [posix.join(posix.dirname(from), clean), clean, posix.join('web', clean), posix.join('.github/workflows', clean)];
  for (const t of tries) {
    const n = posix.normalize(t);
    if (readableSet.has(n)) return n;
  }
  return null;
}

export interface Reach { id: string; words: number | null; minutes: number | null; path: string[] }

export function reachAll(c: Corpus, questions: Question[]): Reach[] {
  const cache = new Map<string, Readable | null>();
  const readableSet = new Set([...c.docs.keys(), ...commentFiles(c.files)]);
  // Edges: from each line of each readable file to the files it names.
  const edges = new Map<string, { to: string; line: number }[]>();
  for (const path of readableSet) {
    const r = readable(c, path, cache);
    if (!r) continue;
    const list: { to: string; line: number }[] = [];
    r.lines.forEach((l, i) => {
      const tokens = [...l.matchAll(FILE_TOKEN)].map((m) => m[0]);
      for (const m of l.matchAll(DIR_TOKEN)) tokens.push(`${m[1]}/README.md`);
      for (const t of tokens) {
        const to = targetsOf(c, path, t, readableSet);
        if (to && to !== path) list.push({ to, line: i + 1 });
      }
    });
    edges.set(path, list);
  }
  const dist = new Map<string, Map<string, { cost: number; prev: string | null }>>();
  const shortest = (entry: string) => {
    if (dist.has(entry)) return dist.get(entry)!;
    const d = new Map<string, { cost: number; prev: string | null }>([[entry, { cost: 0, prev: null }]]);
    const done = new Set<string>();
    while (true) {
      let best: string | null = null;
      for (const [k, v] of d) if (!done.has(k) && (best === null || v.cost < d.get(best)!.cost)) best = k;
      if (best === null) break;
      done.add(best);
      const r = readable(c, best, cache)!;
      for (const e of edges.get(best) ?? []) {
        const cost = d.get(best)!.cost + costTo(r, e.line);
        if (!d.has(e.to) || cost < d.get(e.to)!.cost) d.set(e.to, { cost, prev: best });
      }
    }
    dist.set(entry, d);
    return d;
  };
  // The answer counts wherever the docs state it, so moving it somewhere quicker to reach
  // needs no change to the question set.
  return questions.map((q) => {
    const entry = ENTRY[q.audience];
    const d = shortest(entry);
    let best: { total: number; at: string } | null = null;
    for (const at of readableSet) {
      const r = readable(c, at, cache);
      const reached = d.get(at);
      if (!r || !reached) continue;
      const line = findLine(r.lines, q.doc.pattern);
      if (line === null) continue;
      const total = reached.cost + costTo(r, line);
      if (!best || total < best.total) best = { total, at };
    }
    if (!best) return { id: q.id, words: null, minutes: null, path: [] };
    const path: string[] = [];
    for (let p: string | null = best.at; p; p = d.get(p)?.prev ?? null) path.unshift(p);
    return { id: q.id, words: best.total, minutes: best.total / WORDS_PER_MINUTE, path };
  });
}

/** Nearest-rank percentile; a null (unreachable) value sorts last, as the slowest. */
export function percentile(values: (number | null)[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => (a === null ? 1 : b === null ? -1 : a - b));
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)] ?? null;
}
